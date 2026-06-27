const { loadRawDeal } = require('../server/rawdeal/bootstrap');

function cloneCard(RawDeal, id, instanceId) {
  return { ...RawDeal.CARDS[id], instanceId };
}

function createTestEngine(RawDeal) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];

  player.hand = [];
  player.fortitude = 20;
  opponent.hand = [cloneCard(RawDeal, 'punch', 'opp-punch-0')];
  for (let i = 0; i < 12; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  return { engine, player, opponent };
}

function trackEffectOrder(engine) {
  const order = [];
  const pipeline = window.RawDeal.EffectPipeline;
  const origStep = pipeline._runStep.bind(pipeline);
  const origDamage = engine._resolveDamage.bind(engine);

  pipeline._runStep = async (...args) => {
    const step = args[2];
    if (step?.op === 'topArsenalToRingside') order.push('topArsenal');
    if (step?.op === 'opponentDiscardFromHand') order.push('opponentDiscard');
    if (step?.op === 'opponentDraw') order.push('opponentDraw');
    return origStep(...args);
  };
  engine._resolveDamage = async (...args) => {
    order.push('damage');
    return origDamage(...args);
  };

  return order;
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok: ${message}`);
}

async function testKickArsenalBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, player } = createTestEngine(RawDeal);
  const order = trackEffectOrder(engine);

  const kick = cloneCard(RawDeal, 'kick', 'kick-test');
  player.hand.push(kick);
  player.arsenal.push(cloneCard(RawDeal, 'chop', 'arsenal-top'));

  await engine.playCard(0, kick.instanceId, 'maneuver');

  assert(order.indexOf('topArsenal') >= 0, 'Kick runs topArsenalToRingside');
  assert(order.indexOf('damage') >= 0, 'Kick resolves damage');
  assert(
    order.indexOf('topArsenal') < order.indexOf('damage'),
    'Kick arsenal-to-Ringside runs before damage'
  );
}

async function testSpinningHeelKickDiscardBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, player } = createTestEngine(RawDeal);
  const order = trackEffectOrder(engine);

  const shk = cloneCard(RawDeal, 'spinning-heel-kick', 'shk-test');
  player.hand.push(shk);

  await engine.playCard(0, shk.instanceId, 'maneuver');

  assert(order.indexOf('opponentDiscard') >= 0, 'Spinning Heel Kick discards from opponent hand');
  assert(order.indexOf('damage') >= 0, 'Spinning Heel Kick resolves damage');
  assert(
    order.indexOf('opponentDiscard') < order.indexOf('damage'),
    'Spinning Heel Kick opponent discard runs before damage'
  );
}

async function testHeadlockTakedownOpponentDrawBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = createTestEngine(RawDeal);

  const order = trackEffectOrder(engine);
  const handSizeBefore = opponent.hand.length;
  const card = cloneCard(RawDeal, 'headlock-takedown', 'headlock-test');
  player.hand.push(card);

  await engine.playCard(0, card.instanceId, 'maneuver');

  assert(order.indexOf('opponentDraw') >= 0, 'Headlock Takedown triggers opponent draw');
  assert(order.indexOf('damage') >= 0, 'Headlock Takedown resolves damage');
  assert(
    order.indexOf('opponentDraw') < order.indexOf('damage'),
    'Headlock Takedown opponent draw runs before damage'
  );
  assert(opponent.hand.length === handSizeBefore + 1, 'Opponent drew 1 card into hand');
  assert(
    engine.actionLog.some((entry) => entry.message.includes('opponent drew 1 card')),
    'Headlock Takedown logs opponent draw'
  );
}

async function testBulldogChainBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = createTestEngine(RawDeal);

  let damageResolved = false;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    damageResolved = true;
    return origDamage(...args);
  };

  const bulldog = cloneCard(RawDeal, 'bulldog', 'bulldog-test');
  const filler = cloneCard(RawDeal, 'punch', 'filler-discard');
  player.hand.push(bulldog, filler);
  opponent.hand = [cloneCard(RawDeal, 'kick', 'opp-kick-0')];

  await engine.playCard(0, bulldog.instanceId, 'maneuver');
  assert(!damageResolved, 'Bulldog damage not resolved before self-discard');

  await engine.selectForCardEffect(0, filler.instanceId);
  assert(!damageResolved, 'Bulldog damage not resolved during hand reveal');

  engine.confirmHandRevealSelection(0, [opponent.hand[0].instanceId]);
  await new Promise((resolve) => setImmediate(resolve));

  assert(damageResolved, 'Bulldog resolves damage after maneuverEffects pipeline completes');
}

function createHandReversalTest(RawDeal, options = {}) {
  const {
    maneuverId = 'punch',
    reversalId = 'elbow-to-the-face',
    arsenalCount = 10,
    afterIrishWhip = false,
  } = options;

  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];

  attacker.hand = [];
  defender.hand = [];
  attacker.arsenal = [];
  defender.arsenal = [];

  const maneuver = cloneCard(RawDeal, maneuverId, 'maneuver-test');
  const reversal = cloneCard(RawDeal, reversalId, 'reversal-test');

  attacker.ring.maneuvers.push(maneuver);
  if (afterIrishWhip) {
    attacker.turnState = engine._emptyTurnState();
    attacker.turnState.irishWhipPlayed = true;
  }
  attacker.fortitude = engine._calcFortitude(attacker);
  defender.fortitude = 0;

  for (let i = 0; i < arsenalCount; i++) {
    attacker.arsenal.push(cloneCard(RawDeal, 'chop', `atk-arsenal-${i}`));
  }

  defender.hand.push(reversal);

  engine.stateMachine.phase = RawDeal.PHASES.REVERSAL_PRIORITY;
  engine.reversalWindow = {
    kind: 'maneuver',
    attackerIndex: 0,
    defenderIndex: 1,
    player: attacker,
    opponent: defender,
    played: maneuver,
    damage: maneuver.damage || 0,
  };

  return { engine, attacker, defender, maneuver, reversal };
}

async function testElbowReversalRingPlacementAndDamage() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, reversal } = createHandReversalTest(RawDeal);
  const arsenalBefore = attacker.arsenal.length;

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    defender.ring.reversals.some((c) => c.instanceId === reversal.instanceId),
    'Elbow reversal goes to ring.reversals'
  );
  assert(
    !defender.ringside.some((c) => c.instanceId === reversal.instanceId),
    'Elbow reversal is not in Ringside'
  );
  assert(defender.fortitude === 2, 'Elbow in Ring adds +2F');
  assert(
    attacker.arsenal.length === arsenalBefore - 2,
    'Elbow deals 2D to attacker Arsenal'
  );
}

async function testShoulderBlockReversalDamage() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, reversal } = createHandReversalTest(RawDeal, {
    maneuverId: 'kick',
    reversalId: 'shoulder-block',
    afterIrishWhip: true,
  });
  const arsenalBefore = attacker.arsenal.length;

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    attacker.arsenal.length === arsenalBefore - 3,
    'Shoulder Block deals 3D to attacker Arsenal when played as reversal'
  );
}

async function testReversalDamagePinfall() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = createHandReversalTest(RawDeal, { arsenalCount: 1 });

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(engine.stateMachine.phase === RawDeal.PHASES.GAME_OVER, 'Reversal damage pinfall ends game');
  assert(engine.winner === 1, 'Reversal player wins by pinfall');
  assert(engine.winReason === RawDeal.WIN_REASONS.PINFALL, 'Win reason is pinfall');
}

async function testReversalSvBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = createHandReversalTest(RawDeal, { maneuverId: 'haymaker' });
  const order = [];

  const origSv = engine._applyStunValueDraw.bind(engine);
  engine._applyStunValueDraw = (...args) => {
    order.push('sv');
    return origSv(...args);
  };
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    if (args[4]?.allowArsenalReversals === false) order.push('reversalDamage');
    return origDamage(...args);
  };

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(order.indexOf('sv') >= 0, 'Maneuver SV draw runs on hand reversal');
  assert(order.indexOf('reversalDamage') >= 0, 'Reversal deals damage from hand');
  assert(
    order.indexOf('sv') < order.indexOf('reversalDamage'),
    'SV draw runs before reversal-from-hand damage'
  );
}

async function main() {
  await testKickArsenalBeforeDamage();
  await testSpinningHeelKickDiscardBeforeDamage();
  await testHeadlockTakedownOpponentDrawBeforeDamage();
  await testBulldogChainBeforeDamage();
  await testElbowReversalRingPlacementAndDamage();
  await testShoulderBlockReversalDamage();
  await testReversalDamagePinfall();
  await testReversalSvBeforeDamage();

  if (process.exitCode) {
    console.error('\nSome timing tests failed.');
    process.exit(1);
  }
  console.log('\nAll Raw Deal timing tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});