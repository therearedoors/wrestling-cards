const { loadRawDeal } = require('../server/rawdeal/bootstrap');

function cloneCard(RawDeal, id, instanceId) {
  return { ...RawDeal.CARDS[id], instanceId };
}

async function createTestEngine(RawDeal) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

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
  const { engine, player } = await createTestEngine(RawDeal);
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

async function testHeadButtCanDiscardHybridCard() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = await createTestEngine(RawDeal);

  const headButt = cloneCard(RawDeal, 'head-butt', 'hb-test');
  const hybridChop = cloneCard(RawDeal, 'chop', 'hb-chop');
  const filler = cloneCard(RawDeal, 'punch', 'hb-filler');

  player.hand = [headButt, hybridChop, filler];
  for (let i = 0; i < 5; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `hb-opp-${i}`));
  }

  await engine.playCard(0, headButt.instanceId, 'maneuver');

  assert(
    engine.cardEffectFlow?.type === 'discardFromHand',
    'Head Butt prompts discard before damage'
  );

  const ok = await engine.selectForCardEffect(0, hybridChop.instanceId);
  assert(ok, 'Head Butt can discard a Hybrid card from hand');
  assert(
    player.ringside.some((c) => c.instanceId === hybridChop.instanceId),
    'Hybrid discard goes to Ringside'
  );
}

async function testSpinningHeelKickDiscardBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await createTestEngine(RawDeal);
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
  const { engine, player, opponent } = await createTestEngine(RawDeal);

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
  const { engine, player, opponent } = await createTestEngine(RawDeal);

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

async function createHandReversalTest(RawDeal, options = {}) {
  const {
    maneuverId = 'punch',
    reversalId = 'elbow-to-the-face',
    arsenalCount = 10,
    afterIrishWhip = false,
    effectiveDamage = null,
    defenderFortitude = 0,
    defenderArsenalCount = 5,
  } = options;

  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];

  attacker.hand = [];
  defender.hand = [];
  attacker.arsenal = [];
  defender.arsenal = [];

  const maneuver = cloneCard(RawDeal, maneuverId, 'maneuver-test');
  const reversal = cloneCard(RawDeal, reversalId, 'reversal-test');

  if (afterIrishWhip) {
    attacker.turnState = engine._emptyTurnState();
    attacker.turnState.irishWhipPlayed = true;
  }
  attacker.fortitude = engine._calcFortitude(attacker);
  defender.fortitude = defenderFortitude;

  for (let i = 0; i < arsenalCount; i++) {
    attacker.arsenal.push(cloneCard(RawDeal, 'chop', `atk-arsenal-${i}`));
  }
  for (let i = 0; i < defenderArsenalCount; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `def-arsenal-${i}`));
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
    damage: effectiveDamage ?? maneuver.damage ?? 0,
  };

  return { engine, attacker, defender, maneuver, reversal };
}

async function testElbowReversalRingPlacementAndDamage() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, maneuver, reversal } = await createHandReversalTest(RawDeal);
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
  assert(
    attacker.ringside.some((c) => c.instanceId === maneuver.instanceId),
    'Reversed maneuver goes to attacker Ringside'
  );
  assert(
    !attacker.ring.maneuvers.some((c) => c.instanceId === maneuver.instanceId),
    'Reversed maneuver is not left in Ring'
  );
  assert(defender.fortitude === 2, 'Elbow in Ring adds +2F');
  assert(
    attacker.arsenal.length === arsenalBefore - 2,
    'Elbow deals 2D to attacker Arsenal'
  );
}

async function testDeferredManeuverNotInRingDuringWindow() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  attacker.hand = [punch];
  attacker.fortitude = 20;
  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, punch.instanceId, 'maneuver');

  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Maneuver opens reversal priority window'
  );
  assert(
    !attacker.ring.maneuvers.some((c) => c.instanceId === punch.instanceId),
    'Maneuver is not placed in Ring during reversal window'
  );
}

async function testPassPriorityPlacesManeuverInRing() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  attacker.hand = [punch];
  attacker.fortitude = 20;
  defender.hand = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `def-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, punch.instanceId, 'maneuver');
  await engine.passPriority(1);

  assert(
    attacker.ring.maneuvers.some((c) => c.instanceId === punch.instanceId),
    'Maneuver enters Ring after defender passes priority'
  );
}

async function testShoulderBlockReversalDamage() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, reversal } = await createHandReversalTest(RawDeal, {
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
  const { engine, reversal } = await createHandReversalTest(RawDeal, { arsenalCount: 1 });

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(engine.stateMachine.phase === RawDeal.PHASES.GAME_OVER, 'Reversal damage pinfall ends game');
  assert(engine.winner === 1, 'Reversal player wins by pinfall');
  assert(engine.winReason === RawDeal.WIN_REASONS.PINFALL, 'Win reason is pinfall');
}

async function testReversalSvBeforeDamage() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = await createHandReversalTest(RawDeal, { maneuverId: 'haymaker' });
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

async function testAtomicDropNextCardManeuverBonus() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const atomicDrop = cloneCard(RawDeal, 'atomic-drop', 'atomic-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  player.hand = [atomicDrop, punch];
  player.fortitude = 20;
  opponent.hand = [];
  for (let i = 0; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  let punchDamage = null;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    if (args[2]?.instanceId === punch.instanceId) {
      punchDamage = args[3];
    }
    return origDamage(...args);
  };

  await engine.playCard(0, atomicDrop.instanceId, 'maneuver');
  assert(
    player.turnState?.nextCardManeuverBonus === 2,
    'Atomic Drop sets +2D on next card if it is a maneuver'
  );

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(punchDamage === 5, 'Next maneuver gets +2D after Atomic Drop (Punch 3D + 2)');
  assert(
    !player.turnState?.nextCardManeuverBonus,
    'Next-card maneuver bonus is consumed after use'
  );
}

function stunnerFortitudeCost(RawDeal, player) {
  const stunner = cloneCard(RawDeal, 'stone-cold-stunner', 'scs-cost');
  return RawDeal.CardUtils.playFortitudeCost(stunner, 'maneuver', player);
}

async function setupStunnerDiscountEngine(RawDeal) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  opponent.hand = [];
  for (let i = 0; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, opponent };
}

async function testStoneColdStunnerDiscountAfterKick() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupStunnerDiscountEngine(RawDeal);

  const kick = cloneCard(RawDeal, 'kick', 'kick-0');
  player.hand = [kick];
  player.arsenal.push(cloneCard(RawDeal, 'chop', 'arsenal-top'));

  await engine.playCard(0, kick.instanceId, 'maneuver');

  assert(
    player.turnState?.lastPlayedCardId === 'kick',
    'Kick is recorded as the last played card'
  );
  assert(
    stunnerFortitudeCost(RawDeal, player) === 24,
    'Stunner is 24F immediately after Kick'
  );
}

async function testStoneColdStunnerNoDiscountAfterPunch() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupStunnerDiscountEngine(RawDeal);

  const kick = cloneCard(RawDeal, 'kick', 'kick-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');
  player.hand = [kick, punch];
  player.arsenal.push(cloneCard(RawDeal, 'chop', 'arsenal-top'));

  await engine.playCard(0, kick.instanceId, 'maneuver');
  await engine.playCard(0, punch.instanceId, 'maneuver');

  assert(
    player.turnState?.lastPlayedCardId === 'punch',
    'Punch replaces Kick as the last played card'
  );
  assert(
    stunnerFortitudeCost(RawDeal, player) === 30,
    'Stunner is 30F after Kick then Punch'
  );
}

async function testStoneColdStunnerNoDiscountAfterAction() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupStunnerDiscountEngine(RawDeal);

  const kick = cloneCard(RawDeal, 'kick', 'kick-0');
  const chop = cloneCard(RawDeal, 'chop', 'chop-0');
  player.hand = [kick, chop];
  player.arsenal.push(cloneCard(RawDeal, 'chop', 'arsenal-top'));

  await engine.playCard(0, kick.instanceId, 'maneuver');
  await engine.playCard(0, chop.instanceId, 'action');

  assert(
    player.turnState?.lastPlayedCardId === 'chop',
    'Chop action replaces Kick as the last played card'
  );
  assert(
    stunnerFortitudeCost(RawDeal, player) === 30,
    'Stunner is 30F after Kick then Chop action'
  );
}

async function testStoneColdStunnerNoDiscountWithoutKick() {
  const RawDeal = loadRawDeal();
  const { player } = await setupStunnerDiscountEngine(RawDeal);

  assert(
    player.turnState?.lastPlayedCardId == null,
    'Turn starts with no last played card'
  );
  assert(
    stunnerFortitudeCost(RawDeal, player) === 30,
    'Stunner is 30F without prior Kick'
  );
}

function tombstoneFortitudeCost(RawDeal, player) {
  const tombstone = cloneCard(RawDeal, 'kanes-tombstone-piledriver', 'ktp-cost');
  return RawDeal.CardUtils.playFortitudeCost(tombstone, 'maneuver', player);
}

async function setupKaneTombstoneDiscountEngine(RawDeal) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('kane', 'hhh');

  const player = engine.players[0];
  const opponent = engine.players[1];
  opponent.hand = [];
  opponent.arsenal = Array.from({ length: 20 }, (_, i) =>
    cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`)
  );

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, opponent };
}

function preloadRingFortitude(engine, player, RawDeal, minimum) {
  let i = 0;
  while (engine._calcFortitude(player) < minimum) {
    player.ring.maneuvers.push(cloneCard(RawDeal, 'spear', `preload-spear-${i++}`));
  }
  engine._syncFortitude(player);
}

async function testKaneTombstoneDiscountAfterChokeslam() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupKaneTombstoneDiscountEngine(RawDeal);

  const chokeslam = cloneCard(RawDeal, 'kanes-chokeslam', 'chokeslam-0');
  player.hand = [chokeslam];
  preloadRingFortitude(engine, player, RawDeal, 12);

  await engine.playCard(0, chokeslam.instanceId, 'maneuver');

  assert(
    player.turnState?.lastPlayedCardId === 'kanes-chokeslam',
    "Kane's Chokeslam is recorded as the last played card"
  );
  assert(
    tombstoneFortitudeCost(RawDeal, player) === 24,
    "Tombstone is 24F immediately after Kane's Chokeslam"
  );
}

async function testKaneTombstoneNoDiscountAfterPunch() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupKaneTombstoneDiscountEngine(RawDeal);

  const chokeslam = cloneCard(RawDeal, 'kanes-chokeslam', 'chokeslam-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');
  player.hand = [chokeslam, punch];
  preloadRingFortitude(engine, player, RawDeal, 12);

  assert(
    await engine.playCard(0, chokeslam.instanceId, 'maneuver'),
    "Kane's Chokeslam plays successfully before Punch"
  );
  assert(
    await engine.playCard(0, punch.instanceId, 'maneuver'),
    'Punch plays successfully after Chokeslam'
  );

  assert(
    player.turnState?.lastPlayedCardId === 'punch',
    'Punch replaces Chokeslam as the last played card'
  );
  assert(
    tombstoneFortitudeCost(RawDeal, player) === 30,
    "Tombstone is 30F after Chokeslam then Punch"
  );
}

async function testKaneTombstoneNoDiscountAfterAction() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupKaneTombstoneDiscountEngine(RawDeal);

  const chokeslam = cloneCard(RawDeal, 'kanes-chokeslam', 'chokeslam-0');
  const chop = cloneCard(RawDeal, 'chop', 'chop-0');
  player.hand = [chokeslam, chop];
  preloadRingFortitude(engine, player, RawDeal, 12);

  await engine.playCard(0, chokeslam.instanceId, 'maneuver');
  await engine.playCard(0, chop.instanceId, 'action');

  assert(
    player.turnState?.lastPlayedCardId === 'chop',
    'Chop action replaces Chokeslam as the last played card'
  );
  assert(
    tombstoneFortitudeCost(RawDeal, player) === 30,
    'Tombstone is 30F after Chokeslam then Chop action'
  );
}

async function testKaneTombstoneNoDiscountWithoutChokeslam() {
  const RawDeal = loadRawDeal();
  const { player } = await setupKaneTombstoneDiscountEngine(RawDeal);

  assert(
    player.turnState?.lastPlayedCardId == null,
    'Turn starts with no last played card'
  );
  assert(
    tombstoneFortitudeCost(RawDeal, player) === 30,
    "Tombstone is 30F without prior Kane's Chokeslam"
  );
}

async function testKaneTombstoneCanPlayAtDiscountedCost() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupKaneTombstoneDiscountEngine(RawDeal);

  const chokeslam = cloneCard(RawDeal, 'kanes-chokeslam', 'chokeslam-0');
  const tombstone = cloneCard(RawDeal, 'kanes-tombstone-piledriver', 'ktp-0');
  player.hand = [chokeslam, tombstone];
  preloadRingFortitude(engine, player, RawDeal, 12);

  await engine.playCard(0, chokeslam.instanceId, 'maneuver');
  engine._syncFortitude(player);

  assert(
    player.fortitude === 27,
    'Ring fortitude is 27 after Chokeslam follows preloaded maneuvers'
  );
  assert(
    engine.canPlayCard(0, tombstone.instanceId, 'maneuver'),
    "Tombstone is playable at 24F immediately after Chokeslam with 27F in ring"
  );

  const preloadIdx = player.ring.maneuvers.findIndex((c) => c.instanceId.startsWith('preload-spear-'));
  player.ring.maneuvers.splice(preloadIdx, 1);
  engine._syncFortitude(player);
  assert(
    player.fortitude === 22,
    'Ring fortitude drops to 22 after removing one preloaded maneuver'
  );
  assert(
    !engine.canPlayCard(0, tombstone.instanceId, 'maneuver'),
    'Tombstone is not playable at 24F when only 22F is available'
  );
}

async function testStoneColdStunnerCanPlayAtDiscountedCost() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await setupStunnerDiscountEngine(RawDeal);

  const kick = cloneCard(RawDeal, 'kick', 'kick-0');
  const stunner = cloneCard(RawDeal, 'stone-cold-stunner', 'scs-0');
  player.hand = [kick, stunner];
  player.arsenal.push(cloneCard(RawDeal, 'chop', 'arsenal-top'));

  for (let i = 0; i < 4; i++) {
    player.ring.maneuvers.push(cloneCard(RawDeal, 'spear', `ring-spear-${i}`));
  }
  engine._syncFortitude(player);

  await engine.playCard(0, kick.instanceId, 'maneuver');
  engine._syncFortitude(player);

  assert(
    player.fortitude === 25,
    'Ring fortitude is 25 after Kick follows preloaded maneuvers'
  );
  assert(
    engine.canPlayCard(0, stunner.instanceId, 'maneuver'),
    'Stunner is playable at 24F immediately after Kick with 25F in ring'
  );

  player.ring.maneuvers.pop();
  engine._syncFortitude(player);
  assert(
    player.fortitude === 20,
    'Ring fortitude drops to 20 after removing one maneuver'
  );
  assert(
    !engine.canPlayCard(0, stunner.instanceId, 'maneuver'),
    'Stunner is not playable at 24F when only 20F is available'
  );
}

async function testAtomicDropBonusLostOnNonManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const atomicDrop = cloneCard(RawDeal, 'atomic-drop', 'atomic-0');
  const chop = cloneCard(RawDeal, 'chop', 'chop-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  player.hand = [atomicDrop, chop, punch];
  player.fortitude = 20;
  opponent.hand = [];
  for (let i = 0; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  let punchDamage = null;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    if (args[2]?.instanceId === punch.instanceId) {
      punchDamage = args[3];
    }
    return origDamage(...args);
  };

  await engine.playCard(0, atomicDrop.instanceId, 'maneuver');
  await engine.playCard(0, chop.instanceId, 'action');
  assert(
    !player.turnState?.nextCardManeuverBonus,
    'Playing an action as the next card clears the pending bonus'
  );

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(punchDamage === 3, 'Later maneuver does not get +2D after a non-maneuver was played next');
}

async function testSnapMareNextCardStrikeBonus() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const snapMare = cloneCard(RawDeal, 'snap-mare', 'snap-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  player.hand = [snapMare, punch];
  player.fortitude = 20;
  opponent.hand = [];
  for (let i = 0; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  let punchDamage = null;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    if (args[2]?.instanceId === punch.instanceId) {
      punchDamage = args[3];
    }
    return origDamage(...args);
  };

  await engine.playCard(0, snapMare.instanceId, 'maneuver');
  assert(
    player.turnState?.nextCardSubtypeBonus?.subtype === 'strike' &&
      player.turnState.nextCardSubtypeBonus.value === 2,
    'Snap Mare sets +2D when the next card is a Strike maneuver'
  );

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(punchDamage === 5, 'Next Strike maneuver gets +2D after Snap Mare (Punch 3D + 2)');
  assert(
    !player.turnState?.nextCardSubtypeBonus,
    'Next-card Strike bonus is consumed after use'
  );
}

async function testSnapMareBonusLostOnNonStrikeNextCard() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const snapMare = cloneCard(RawDeal, 'snap-mare', 'snap-0');
  const chop = cloneCard(RawDeal, 'chop', 'chop-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  player.hand = [snapMare, chop, punch];
  player.fortitude = 20;
  opponent.hand = [];
  for (let i = 0; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  let punchDamage = null;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    if (args[2]?.instanceId === punch.instanceId) {
      punchDamage = args[3];
    }
    return origDamage(...args);
  };

  await engine.playCard(0, snapMare.instanceId, 'maneuver');
  await engine.playCard(0, chop.instanceId, 'action');
  assert(
    !player.turnState?.nextCardSubtypeBonus,
    'Playing an action as the next card clears the pending Strike bonus'
  );

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(punchDamage === 3, 'Later Strike does not get +2D after a non-Strike card was played next');
}

async function testSnapMareBonusLostOnGrappleNextCard() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const snapMare = cloneCard(RawDeal, 'snap-mare', 'snap-0');
  const gutBuster = cloneCard(RawDeal, 'gut-buster', 'gb-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');

  player.hand = [snapMare, gutBuster, punch];
  player.fortitude = 20;
  opponent.hand = [];
  for (let i = 0; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `opp-arsenal-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  let punchDamage = null;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    if (args[2]?.instanceId === punch.instanceId) {
      punchDamage = args[3];
    }
    return origDamage(...args);
  };

  await engine.playCard(0, snapMare.instanceId, 'maneuver');
  await engine.playCard(0, gutBuster.instanceId, 'maneuver');
  assert(
    !player.turnState?.nextCardSubtypeBonus,
    'Playing a Grapple as the next card clears the pending Strike bonus'
  );

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(
    punchDamage === 3,
    'Later Strike does not get +2D after a non-Strike maneuver was played next'
  );
}

async function testRockPreDrawAbilityOpensModal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  assert(player.superstar.id === 'the-rock', 'Player 0 uses The Rock');

  const ringsideCard = cloneCard(RawDeal, 'chop', 'rock-rs-1');
  player.ringside.push(ringsideCard);
  player.preDrawSuperstarResolved = false;
  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;
  engine.abilityFlow = null;

  await engine._runAutoPhases();

  assert(engine.abilityFlow?.step === 'rockRingside', 'Rock pre-draw ability opens before draw');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.DRAW,
    'Draw step waits while Rock ability modal is open'
  );
}

async function testRockPreDrawConfirmMovesCardToArsenalBottom() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const ringsideCard = cloneCard(RawDeal, 'punch', 'rock-rs-2');
  player.ringside.push(ringsideCard);
  player.preDrawSuperstarResolved = false;
  const handBefore = player.hand.length;

  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;
  engine.abilityFlow = {
    playerIndex: 0,
    superstarId: 'the-rock',
    step: 'rockRingside',
    selectedId: ringsideCard.instanceId,
  };

  await engine.confirmSuperstarAbilityPrompt(0, ringsideCard.instanceId);

  assert(
    player.arsenal[0]?.instanceId === ringsideCard.instanceId,
    'Chosen Ringside card goes to bottom of Arsenal'
  );
  assert(
    player.hand.length === handBefore + 1,
    'Draw step still runs after Rock ability confirm'
  );
  assert(
    !player.ringside.some((c) => c.instanceId === ringsideCard.instanceId),
    'Card leaves Ringside after confirm'
  );
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Draw step completes after Rock ability confirm'
  );
}

async function testRockPreDrawPassKeepsRingside() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const ringsideCard = cloneCard(RawDeal, 'kick', 'rock-rs-3');
  player.ringside.push(ringsideCard);
  player.preDrawSuperstarResolved = false;

  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;
  engine.abilityFlow = {
    playerIndex: 0,
    superstarId: 'the-rock',
    step: 'rockRingside',
    selectedId: null,
  };

  await engine.passSuperstarAbilityPrompt(0);

  assert(
    player.ringside.some((c) => c.instanceId === ringsideCard.instanceId),
    'Pass leaves Ringside unchanged'
  );
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Draw step completes after Rock ability pass'
  );
}

async function testKanePreDrawOverturnsOpponentArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('kane', 'austin');

  const kane = engine.players[0];
  const opponent = engine.players[1];
  assert(kane.superstar.id === 'kane', 'Player 0 uses Kane');

  const topCard = cloneCard(RawDeal, 'chop', 'kane-opp-top');
  opponent.arsenal.push(topCard);
  const arsenalBefore = opponent.arsenal.length;

  kane.preDrawSuperstarResolved = false;
  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;
  engine.abilityFlow = null;

  let reversalChecked = false;
  const origReversal = engine._reversalStops.bind(engine);
  engine._reversalStops = (...args) => {
    reversalChecked = true;
    return origReversal(...args);
  };

  await engine._runAutoPhases();

  assert(
    opponent.ringside.some((c) => c.instanceId === topCard.instanceId),
    'Kane puts opponent top Arsenal card into Ringside'
  );
  assert(
    opponent.arsenal.length === arsenalBefore - 1,
    'Opponent Arsenal loses the overturned card'
  );
  assert(!reversalChecked, 'Kane overturn is not a reversible damage step');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Draw step completes after Kane pre-draw overturn'
  );
}

async function testShaneOMacPreDrawOverturnsOpponentArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const shane = cloneCard(RawDeal, 'shane-omac', 'shane-ring-test');
  player.ring.actions.push(shane);

  const topCard = cloneCard(RawDeal, 'chop', 'shane-opp-top');
  opponent.arsenal.push(topCard);
  const arsenalBefore = opponent.arsenal.length;

  player.preDrawSuperstarResolved = false;
  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;
  engine.abilityFlow = null;

  await engine._runAutoPhases();

  assert(
    opponent.ringside.some((c) => c.instanceId === topCard.instanceId),
    'Shane O\'Mac puts opponent top Arsenal card into Ringside'
  );
  assert(
    opponent.arsenal.length === arsenalBefore - 1,
    'Opponent Arsenal loses the overturned card'
  );
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Draw step completes after Shane O\'Mac pre-draw overturn'
  );
}

async function testShaneOMacPreDrawSkipsWhenOpponentArsenalEmpty() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const shane = cloneCard(RawDeal, 'shane-omac', 'shane-empty-test');
  player.ring.actions.push(shane);

  opponent.arsenal = [];
  const ringsideBefore = opponent.ringside.length;
  player.preDrawSuperstarResolved = false;
  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;

  await engine._runAutoPhases();

  assert(
    opponent.ringside.length === ringsideBefore,
    'Shane O\'Mac does not add Ringside cards when opponent Arsenal is empty'
  );
  assert(
    engine.actionLog.some((e) => e.message.includes("opponent's Arsenal is empty")),
    'Shane O\'Mac logs empty opponent Arsenal'
  );
}

async function testShaneOMacNoEffectWhenNotInRing() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const topCard = cloneCard(RawDeal, 'chop', 'shane-no-ring-top');
  opponent.arsenal.push(topCard);

  player.preDrawSuperstarResolved = false;
  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;

  await engine._runAutoPhases();

  assert(
    !opponent.ringside.some((c) => c.instanceId === topCard.instanceId),
    'No Shane O\'Mac in Ring — opponent top Arsenal stays'
  );
  assert(
    opponent.arsenal.some((c) => c.instanceId === topCard.instanceId),
    'Opponent Arsenal unchanged without Shane O\'Mac'
  );
}

async function testShaneOMacPlayedToRingActions() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  const shane = cloneCard(RawDeal, 'shane-omac', 'shane-play-test');
  player.hand.push(shane);

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, shane.instanceId, 'action');

  assert(
    player.ring.actions.some((c) => c.instanceId === shane.instanceId),
    'Shane O\'Mac is placed in Ring actions'
  );
  assert(!engine.cardEffectFlow, 'Shane O\'Mac has no immediate effect pipeline');
  assert(!engine.effectPipelineFlow?.paused, 'Shane O\'Mac does not pause the effect pipeline');
}

async function testKanePreDrawSkipsWhenOpponentArsenalEmpty() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('kane', 'austin');

  const opponent = engine.players[1];
  const ringsideBefore = opponent.ringside.length;
  opponent.arsenal = [];
  engine.players[0].preDrawSuperstarResolved = false;
  engine.stateMachine.phase = RawDeal.PHASES.DRAW;
  engine.stateMachine.activePlayer = 0;

  await engine._runAutoPhases();

  assert(
    opponent.ringside.length === ringsideBefore,
    'No Ringside card added when Arsenal is empty'
  );
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Turn still advances to Main when opponent Arsenal is empty'
  );
}

async function testJerichoSuperstarAbilityForcesOpponentDiscard() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('jericho', 'austin');

  const jericho = engine.players[0];
  const opponent = engine.players[1];
  assert(jericho.superstar.id === 'jericho', 'Player 0 uses Chris Jericho');

  const selfDiscard = cloneCard(RawDeal, 'chop', 'jericho-hand-0');
  const oppCard = cloneCard(RawDeal, 'punch', 'opp-hand-0');
  jericho.hand = [selfDiscard];
  opponent.hand = [oppCard];
  jericho.fortitude = 20;
  opponent.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  assert(engine.beginSuperstarAbility(0), 'Jericho ability can begin');
  assert(engine.selectForAbility(0, selfDiscard.instanceId), 'Jericho discards chosen card');

  assert(
    jericho.ringside.some((c) => c.instanceId === selfDiscard.instanceId),
    'Jericho card goes to Ringside'
  );
  assert(
    opponent.ringside.some((c) => c.instanceId === oppCard.instanceId),
    'Opponent discards a card to Ringside'
  );
  assert(!opponent.hand.length, 'Opponent hand loses discarded card');
  assert(jericho.superstarAbilityUsed, 'Jericho ability marked used after resolving');
}

async function testJerichoAbilityWhenOpponentHandEmpty() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('jericho', 'austin');

  const jericho = engine.players[0];
  const opponent = engine.players[1];
  const selfDiscard = cloneCard(RawDeal, 'kick', 'jericho-hand-1');

  jericho.hand = [selfDiscard];
  opponent.hand = [];
  jericho.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  engine.beginSuperstarAbility(0);
  engine.selectForAbility(0, selfDiscard.instanceId);

  assert(
    jericho.ringside.some((c) => c.instanceId === selfDiscard.instanceId),
    'Jericho still discards when opponent hand is empty'
  );
  assert(jericho.superstarAbilityUsed, 'Ability completes when opponent has nothing to discard');
}

async function testPatAndGerrySetsSkipFlag() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await createTestEngine(RawDeal);

  const patAndGerry = cloneCard(RawDeal, 'pat-and-gerry', 'pag-0');
  player.hand = [patAndGerry];
  for (let i = 0; i < 4; i++) {
    player.ring.maneuvers.push(cloneCard(RawDeal, 'spear', `ring-spear-${i}`));
  }
  engine._syncFortitude(player);

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, patAndGerry.instanceId, 'action');

  assert(
    player.turnState?.skipOpponentNextTurn === true,
    'Pat and Gerry sets skipOpponentNextTurn on the active player'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === patAndGerry.instanceId),
    'Pat and Gerry is placed in the Ring actions area'
  );
}

async function testPatAndGerryGrantsExtraTurn() {
  const RawDeal = loadRawDeal();
  const { engine, player } = await createTestEngine(RawDeal);

  const patAndGerry = cloneCard(RawDeal, 'pat-and-gerry', 'pag-0');
  player.hand = [patAndGerry];
  for (let i = 0; i < 4; i++) {
    player.ring.maneuvers.push(cloneCard(RawDeal, 'spear', `ring-spear-${i}`));
  }
  engine._syncFortitude(player);

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;
  engine.stateMachine.turnNumber = 1;

  await engine.playCard(0, patAndGerry.instanceId, 'action');
  await engine.endTurn(0);

  assert(
    engine.stateMachine.activePlayer === 0,
    'Player keeps the turn after Pat and Gerry when opponent is skipped'
  );
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Skipped opponent returns play to the same player in main phase'
  );
  assert(
    engine.stateMachine.turnNumber === 1,
    'Turn number does not advance when opponent turn is skipped'
  );
  assert(
    !player.turnState?.skipOpponentNextTurn,
    'Skip flag is consumed after granting the extra turn'
  );

  await engine.endTurn(0);

  assert(
    engine.stateMachine.turnNumber === 2,
    'Turn number advances after a normal end turn following the extra turn'
  );
}

async function testWhoopCanReversalTaxFromHand() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];

  const whoop = cloneCard(RawDeal, 'open-up-a-can', 'whoop-0');
  const grapple = cloneCard(RawDeal, 'double-leg-takedown', 'dlt-whoop');
  const escapeMove = cloneCard(RawDeal, 'escape-move', 'escape-whoop');

  attacker.hand = [whoop, grapple];
  attacker.fortitude = 20;
  defender.hand = [escapeMove];
  defender.fortitude = 0;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, whoop.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  assert(
    attacker.turnState?.nextManeuverReversalTax === 20,
    'Open Up a Can sets +20F reversal tax on next maneuver'
  );

  await engine.playCard(0, grapple.instanceId, 'maneuver');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Boosted grapple opens reversal window'
  );
  assert(
    !engine.canPlayReversalFromHand(1, escapeMove.instanceId),
    'Opponent cannot reverse from hand without 20F'
  );

  defender.fortitude = 20;
  assert(
    engine.canPlayReversalFromHand(1, escapeMove.instanceId),
    'Opponent can reverse from hand with 20F'
  );
}

async function testPedigreeBonusAfterStrike() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const pedigree = cloneCard(RawDeal, 'pedigree', 'ped-bonus');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'ped-kick');
  player.hand.push(pedigree);
  player.fortitude = 35;

  assert(
    engine._peekManeuverDamage(player, opponent, pedigree) === 27,
    'Pedigree +2D after successful Strike (25D + 2)'
  );
}

async function testPedigreeNoBonusWithoutStrike() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const grapple = cloneCard(RawDeal, 'double-leg-takedown', 'ped-grapple');
  const pedigree = cloneCard(RawDeal, 'pedigree', 'ped-no-bonus');

  player.hand.push(grapple);
  player.fortitude = 15;
  opponent.arsenal = opponent.arsenal.filter((c) => !c.reverses?.length);
  for (let i = opponent.arsenal.length; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `ped-gr-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, grapple.instanceId, 'maneuver');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  player.hand.push(pedigree);
  player.fortitude = 35;

  assert(
    engine._peekManeuverDamage(player, opponent, pedigree) === 25,
    'Pedigree has no bonus without prior successful Strike'
  );
}

async function testPedigreeNoBonusAfterReversedStrike() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'ped-punch-rev');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'ped-elbow');
  const pedigree = cloneCard(RawDeal, 'pedigree', 'ped-after-rev');

  attacker.hand = [punch, pedigree];
  attacker.fortitude = 35;
  defender.hand = [elbow];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `ped-rev-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, punch.instanceId, 'maneuver');
  await engine.playReversalFromHand(1, elbow.instanceId);

  assert(
    !attacker.turnState?.lastSuccessfulManeuverSubtype,
    'Reversed Strike does not set last successful maneuver subtype'
  );
  assert(
    engine._peekManeuverDamage(attacker, defender, pedigree) === 25,
    'Pedigree has no +2D after Strike reversed from hand'
  );
}

async function testPedigreeReversesBackBodyDrop() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const irishWhip = cloneCard(RawDeal, 'irish-whip', 'ped-iw');
  const backBodyDrop = cloneCard(RawDeal, 'back-body-drop', 'ped-bbd');
  const pedigree = cloneCard(RawDeal, 'pedigree', 'ped-rev-bbd');

  attacker.hand = [irishWhip, backBodyDrop];
  attacker.fortitude = 20;
  defender.hand = [pedigree];
  defender.fortitude = 35;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `ped-bbd-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, irishWhip.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  assert(attacker.turnState?.irishWhipPlayed, 'Irish Whip action enables Back Body Drop');

  await engine.playCard(0, backBodyDrop.instanceId, 'maneuver');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Back Body Drop opens reversal window'
  );
  assert(
    engine.canPlayReversalFromHand(1, pedigree.instanceId),
    'Pedigree can reverse Back Body Drop from hand'
  );

  await engine.playReversalFromHand(1, pedigree.instanceId);

  assert(
    defender.ring.reversals.some((c) => c.instanceId === pedigree.instanceId),
    'Pedigree lands in Ring reversals after reversing Back Body Drop'
  );
}

async function testPedigreeCannotReverseOtherManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'ped-punch-only');
  const pedigree = cloneCard(RawDeal, 'pedigree', 'ped-no-punch-rev');

  attacker.hand = [punch];
  attacker.fortitude = 10;
  defender.hand = [pedigree];
  defender.fortitude = 35;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, punch.instanceId, 'maneuver');

  assert(
    !engine.canPlayReversalFromHand(1, pedigree.instanceId),
    'Pedigree cannot reverse maneuvers other than Back Body Drop'
  );
}

async function testChynaInterferesReversesAnyManeuver() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, maneuver, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'punch',
    reversalId: 'chyna-interferes',
    defenderFortitude: 10,
  });

  assert(
    engine.canPlayReversalFromHand(1, reversal.instanceId),
    'Chyna Interferes can reverse any maneuver from hand'
  );

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    defender.ring.reversals.some((c) => c.instanceId === reversal.instanceId),
    'Chyna Interferes lands in Ring reversals'
  );
  assert(
    attacker.ringside.some((c) => c.instanceId === maneuver.instanceId),
    'Reversed maneuver goes to attacker Ringside'
  );
  assert(
    engine.stateMachine.activePlayer === 1,
    'Chyna Interferes ends attacker turn'
  );
}

async function testChynaInterferesDeals3DAndDraws2() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'punch',
    reversalId: 'chyna-interferes',
    defenderFortitude: 10,
    arsenalCount: 10,
    defenderArsenalCount: 5,
  });
  const arsenalBefore = attacker.arsenal.length;
  const defenderArsenalBefore = defender.arsenal.length;

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    attacker.arsenal.length === arsenalBefore - 3,
    'Chyna Interferes deals 3D to attacker Arsenal'
  );
  assert(
    defender.hand.length === 3,
    'Chyna Interferes draws 2 cards from hand plus 1 from draw segment'
  );
  assert(
    defender.arsenal.length === defenderArsenalBefore - 3,
    'Chyna Interferes draw comes from defender Arsenal'
  );
  assert(
    engine.actionLog.some((entry) => entry.message.includes('drew 2')),
    'Chyna Interferes logs draw 2'
  );
}

async function testManagerInterferesDeals1DAndDraws1() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'kick',
    reversalId: 'manager-interferes',
    defenderFortitude: 15,
    arsenalCount: 10,
    defenderArsenalCount: 3,
  });
  const arsenalBefore = attacker.arsenal.length;

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    attacker.arsenal.length === arsenalBefore - 1,
    'Manager Interferes deals 1D to attacker Arsenal'
  );
  assert(
    defender.hand.length === 2,
    'Manager Interferes draws 1 card from hand plus 1 from draw segment'
  );
  assert(
    engine.stateMachine.activePlayer === 1,
    'Manager Interferes ends attacker turn'
  );
}

async function playMrSocko(engine, RawDeal, instanceId = 'socko-play', pick = null) {
  const socko = cloneCard(RawDeal, 'mr-socko', instanceId);
  const player = engine.players[0];
  player.hand.push(socko);
  player.fortitude = Math.max(player.fortitude, 25);
  await engine.playCard(0, socko.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  if (engine.cardEffectFlow?.type === 'pickArsenalOrRingsideToHand') {
    let pickId = pick?.instanceId;
    let pickZone = pick?.zone;
    if (!pickId) {
      if (player.ringside.length > 0) {
        pickId = player.ringside[0].instanceId;
        pickZone = 'ringside';
      } else if (player.arsenal.length > 0) {
        pickId = player.arsenal[0].instanceId;
        pickZone = 'arsenal';
      }
    }
    if (pickId && pickZone) {
      await engine.pickArsenalOrRingsideToHand(0, pickId, pickZone);
    }
  }

  return socko;
}

async function testMrSockoPickFromArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('mankind', 'austin');

  const player = engine.players[0];
  const arsenalCard = cloneCard(RawDeal, 'chop', 'socko-ars-pick');
  player.ringside = [];
  player.arsenal = [arsenalCard];
  const arsenalBefore = [...player.arsenal.map((c) => c.instanceId)];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  const socko = await playMrSocko(engine, RawDeal, 'socko-ars');

  assert(
    player.hand.some((c) => c.instanceId === arsenalCard.instanceId),
    'Mr. Socko puts chosen Arsenal card in hand'
  );
  assert(
    !player.arsenal.some((c) => c.instanceId === arsenalCard.instanceId),
    'Mr. Socko removes chosen card from Arsenal'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === socko.instanceId),
    'Mr. Socko is in Ring actions'
  );
  const arsenalAfter = player.arsenal.map((c) => c.instanceId);
  assert(
    arsenalAfter.length === arsenalBefore.length - 1,
    'Mr. Socko Arsenal count drops by 1 after pick'
  );
}

async function testMrSockoPickFromRingside() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('mankind', 'austin');

  const player = engine.players[0];
  const ringsideCard = cloneCard(RawDeal, 'punch', 'socko-rs-pick');
  player.ringside = [ringsideCard];
  player.arsenal = [cloneCard(RawDeal, 'chop', 'socko-ars-remain')];
  const arsenalOrderBefore = player.arsenal.map((c) => c.instanceId);

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playMrSocko(engine, RawDeal, 'socko-rs', {
    instanceId: ringsideCard.instanceId,
    zone: 'ringside',
  });

  assert(
    player.hand.some((c) => c.instanceId === ringsideCard.instanceId),
    'Mr. Socko puts chosen Ringside card in hand'
  );
  assert(
    !player.ringside.some((c) => c.instanceId === ringsideCard.instanceId),
    'Mr. Socko removes chosen card from Ringside'
  );
  assert(
    player.arsenal.length === arsenalOrderBefore.length,
    'Mr. Socko still shuffles Arsenal after Ringside pick'
  );
}

async function testMrSockoEmptyZones() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('mankind', 'austin');

  const player = engine.players[0];
  player.arsenal = [];
  player.ringside = [];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  const socko = await playMrSocko(engine, RawDeal, 'socko-empty');

  assert(
    engine.actionLog.some((e) => e.message.includes('no cards in Arsenal or Ringside')),
    'Mr. Socko logs when both zones are empty'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === socko.instanceId),
    'Mr. Socko still enters Ring when zones are empty'
  );
}

async function testMrSockoRingPassiveDamage() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('mankind', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const socko = cloneCard(RawDeal, 'mr-socko', 'socko-passive');
  player.ring.actions.push(socko);

  const punch = cloneCard(RawDeal, 'punch', 'socko-punch');
  assert(
    engine._peekManeuverDamage(player, opponent, punch) === 4,
    'Mr. Socko in Ring gives all maneuvers +1D (Punch 3D + 1)'
  );
}

async function testMrSockoPassivePersistsNextTurn() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('mankind', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const socko = cloneCard(RawDeal, 'mr-socko', 'socko-persist');
  player.ring.actions.push(socko);

  engine.stateMachine.phase = RawDeal.PHASES.END_OF_TURN;
  engine.stateMachine.activePlayer = 0;
  await engine._runAutoPhases();

  const kick = cloneCard(RawDeal, 'kick', 'socko-kick');
  assert(
    engine._peekManeuverDamage(player, opponent, kick) === 6,
    'Mr. Socko +1D persists on following turn (Kick 5D + 1)'
  );
}

async function testMandibleClawDiscountWithSockoInRing() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('mankind', 'austin');

  const player = engine.players[0];
  const socko = cloneCard(RawDeal, 'mr-socko', 'socko-discount');
  player.ring.actions.push(socko);

  const mandible = RawDeal.CARDS['mandible-claw'];
  const cost = RawDeal.CardUtils.playFortitudeCost(mandible, 'maneuver', player);

  assert(cost === 24, 'Mandible Claw costs 24F when Mr. Socko is in Ring (30F - 6F)');
}

async function playPowerOfDarkness(engine, RawDeal, instanceId = 'pod-play') {
  const pod = cloneCard(RawDeal, 'power-of-darkness', instanceId);
  const player = engine.players[0];
  player.hand.push(pod);
  player.fortitude = Math.max(player.fortitude, 15);
  await engine.playCard(0, pod.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  return pod;
}

async function testPowerOfDarknessAppliesTurnBonuses() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('undertaker', 'austin');

  const attacker = engine.players[0];
  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playPowerOfDarkness(engine, RawDeal, 'pod-bonuses');

  assert(
    engine.turnDamageBonus[0].all === 5,
    'Power of Darkness gives +5D to all maneuvers for the turn'
  );
  assert(
    attacker.turnState?.turnOpponentReversalTax === 20,
    'Power of Darkness gives +20F to opponent reversals for the turn'
  );
  assert(
    attacker.ring.actions.some((c) => c.id === 'power-of-darkness'),
    'Power of Darkness is in Ring actions'
  );
}

async function testPowerOfDarknessDamageAllManeuvers() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('undertaker', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'pod-punch');
  const kick = cloneCard(RawDeal, 'kick', 'pod-kick');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playPowerOfDarkness(engine, RawDeal, 'pod-damage');

  assert(
    engine._peekManeuverDamage(player, opponent, punch) === 8,
    'Power of Darkness +5D applies to first maneuver (Punch 3D + 5)'
  );
  assert(
    engine._peekManeuverDamage(player, opponent, kick) === 10,
    'Power of Darkness +5D applies to second maneuver (Kick 5D + 5)'
  );
}

async function testPowerOfDarknessReversalTaxPersists() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('undertaker', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch1 = cloneCard(RawDeal, 'punch', 'pod-punch-tax-1');
  const punch2 = cloneCard(RawDeal, 'punch', 'pod-punch-tax-2');
  const stepAside = cloneCard(RawDeal, 'step-aside', 'pod-step');

  attacker.fortitude = 20;
  defender.hand = [stepAside];
  defender.fortitude = 0;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playPowerOfDarkness(engine, RawDeal, 'pod-tax');

  attacker.hand.push(punch1);
  await engine.playCard(0, punch1.instanceId, 'maneuver');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'First boosted maneuver opens reversal window'
  );
  assert(
    !engine.canPlayReversalFromHand(1, stepAside.instanceId),
    'Power of Darkness blocks first maneuver reversal below +20F tax'
  );
  await engine.passPriority(1);

  attacker.hand.push(punch2);
  await engine.playCard(0, punch2.instanceId, 'maneuver');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Second maneuver still opens reversal window'
  );
  assert(
    !engine.canPlayReversalFromHand(1, stepAside.instanceId),
    'Power of Darkness reversal tax persists for second maneuver'
  );
}

async function testPowerOfDarknessActionReversalTax() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('undertaker', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const hmmm = cloneCard(RawDeal, 'hmmm', 'pod-hmmm');
  const noChance = cloneCard(RawDeal, 'no-chance-in-hell', 'pod-nch');

  attacker.fortitude = 20;
  defender.hand = [noChance];
  defender.fortitude = 31;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playPowerOfDarkness(engine, RawDeal, 'pod-action-tax');

  attacker.hand.push(hmmm);
  await engine.playCard(0, hmmm.instanceId, 'action');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Follow-up action opens reversal window'
  );
  assert(
    !engine.canPlayReversalFromHand(1, noChance.instanceId),
    'Power of Darkness blocks action reversal below +20F tax (12F + 20F)'
  );

  defender.fortitude = 32;
  assert(
    engine.canPlayReversalFromHand(1, noChance.instanceId),
    'Power of Darkness allows action reversal at 32F (12F + 20F)'
  );
}

async function testWhoopCanReversalTaxFromArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = RawDeal.CARDS['punch'];
  const stepAside = cloneCard(RawDeal, 'step-aside', 'step-aside-0');

  attacker.turnState = engine._emptyTurnState();
  attacker.turnState.nextManeuverReversalTax = 20;
  defender.fortitude = 0;

  assert(
    !engine._reversalStops(stepAside, punch, defender, { attacker }),
    'Arsenal reversal blocked by +20F tax'
  );

  defender.fortitude = 20;
  assert(
    engine._reversalStops(stepAside, punch, defender, { attacker }),
    'Arsenal reversal allowed at 20F'
  );
}

async function testHmmmOpensReorderPrompt() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  for (let i = 0; i < 5; i++) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', `hmmm-arsenal-${i}`));
  }

  const hmmm = cloneCard(RawDeal, 'hmmm', 'hmmm-test');
  player.hand.push(hmmm);

  await engine.playCard(0, hmmm.instanceId, 'action');

  assert(engine.cardEffectFlow?.type === 'arsenalReorder', 'Hmmm opens arsenal reorder prompt');
  assert(engine.cardEffectFlow.count === 5, 'Hmmm shows top 5 cards');
  assert(
    engine.cardEffectFlow.orderedIds.length === 5,
    'Hmmm prompt includes 5 ordered card ids'
  );
}

async function testHmmmConfirmReordersTopCards() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  const bottomIds = ['hmmm-a', 'hmmm-b', 'hmmm-c', 'hmmm-d', 'hmmm-e'];
  for (const id of bottomIds) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', id));
  }

  const hmmm = cloneCard(RawDeal, 'hmmm', 'hmmm-confirm-test');
  player.hand.push(hmmm);

  await engine.playCard(0, hmmm.instanceId, 'action');
  await engine.confirmArsenalReorder(0, ['hmmm-a', 'hmmm-b', 'hmmm-c', 'hmmm-d', 'hmmm-e']);

  const topId = player.arsenal[player.arsenal.length - 1].instanceId;
  assert(topId === 'hmmm-a', 'Hmmm confirm puts chosen card on top of Arsenal');
  assert(!engine.cardEffectFlow, 'Hmmm prompt clears after confirm');
}

async function testHmmmShuffleRandomizesArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  player.arsenal = [];
  const ids = ['shuffle-a', 'shuffle-b', 'shuffle-c'];
  for (const id of ids) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', id));
  }

  engine._shuffle = (array) => {
    array.reverse();
    return array;
  };

  const hmmm = cloneCard(RawDeal, 'hmmm', 'hmmm-shuffle-test');
  player.hand.push(hmmm);

  await engine.playCard(0, hmmm.instanceId, 'action');
  await engine.shuffleArsenalFromPrompt(0);

  const after = player.arsenal.map((c) => c.instanceId);
  assert(
    after.join(',') === 'shuffle-c,shuffle-b,shuffle-a',
    'Hmmm shuffle reorders entire Arsenal'
  );
  assert(
    engine.actionLog.some((entry) => entry.message.includes('shuffled your Arsenal')),
    'Hmmm shuffle logs shuffled Arsenal'
  );
}

async function testDontThinkTooHardOpensOpponentPrompt() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  opponent.arsenal = [];
  for (let i = 0; i < 5; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `dttth-opp-${i}`));
  }

  const card = cloneCard(RawDeal, 'don-t-think-too-hard', 'dttth-test');
  player.hand.push(card);

  await engine.playCard(0, card.instanceId, 'action');

  assert(engine.cardEffectFlow?.type === 'arsenalReorder', 'DTTTH opens arsenal reorder prompt');
  assert(engine.cardEffectFlow?.target === 'opponent', 'DTTTH targets opponent Arsenal');
  assert(engine.cardEffectFlow?.targetPlayerIndex === 1, 'DTTTH targetPlayerIndex is opponent');
  assert(engine.cardEffectFlow?.playerIndex === 0, 'DTTTH acting player controls modal');
}

async function testDontThinkTooHardConfirmReordersOpponentTop() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  opponent.arsenal = [];
  const bottomIds = ['dttth-a', 'dttth-b', 'dttth-c', 'dttth-d', 'dttth-e'];
  for (const id of bottomIds) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', id));
  }

  const card = cloneCard(RawDeal, 'don-t-think-too-hard', 'dttth-confirm-test');
  player.hand.push(card);

  await engine.playCard(0, card.instanceId, 'action');
  await engine.confirmArsenalReorder(0, ['dttth-a', 'dttth-b', 'dttth-c', 'dttth-d', 'dttth-e']);

  const topId = opponent.arsenal[opponent.arsenal.length - 1].instanceId;
  assert(topId === 'dttth-a', 'DTTTH confirm puts chosen card on top of opponent Arsenal');
}

async function testDontThinkTooHardShuffleOpponentArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  opponent.arsenal = [];
  for (const id of ['opp-shuf-a', 'opp-shuf-b', 'opp-shuf-c']) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', id));
  }

  engine._shuffle = (array) => {
    array.reverse();
    return array;
  };

  const card = cloneCard(RawDeal, 'don-t-think-too-hard', 'dttth-shuffle-test');
  player.hand.push(card);

  await engine.playCard(0, card.instanceId, 'action');
  await engine.shuffleArsenalFromPrompt(0);

  const after = opponent.arsenal.map((c) => c.instanceId);
  assert(
    after.join(',') === 'opp-shuf-c,opp-shuf-b,opp-shuf-a',
    'DTTTH shuffle reorders entire opponent Arsenal'
  );
  assert(
    engine.actionLog.some((entry) => entry.message.includes("shuffled opponent's Arsenal")),
    'DTTTH shuffle logs opponent Arsenal shuffle'
  );
}

async function testHmmmFewerThanFiveCards() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  player.arsenal = [cloneCard(RawDeal, 'chop', 'only-top')];

  const hmmm = cloneCard(RawDeal, 'hmmm', 'hmmm-short-test');
  player.hand.push(hmmm);

  await engine.playCard(0, hmmm.instanceId, 'action');

  assert(engine.cardEffectFlow?.count === 1, 'Hmmm shows all Arsenal cards when fewer than 5');
}

async function testMarkingOutOpensChoice() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  player.arsenal.push(cloneCard(RawDeal, 'chop', 'mo-arsenal-0'));

  const markingOut = cloneCard(RawDeal, 'marking-out', 'mo-choice-test');
  player.hand.push(markingOut);

  await engine.playCard(0, markingOut.instanceId, 'action');

  assert(engine.cardEffectFlow?.type === 'choice', 'Marking Out opens choice prompt');
  assert(engine.cardEffectFlow?.choiceId === 'markingOut', 'Marking Out choice id is markingOut');
}

async function testMarkingOutOwnArsenalEndsTurn() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');
  engine._runAutoPhases = async () => {};

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  player.arsenal = [
    cloneCard(RawDeal, 'chop', 'mo-pick-a'),
    cloneCard(RawDeal, 'punch', 'mo-pick-b'),
  ];

  engine._shuffle = (array) => {
    array.reverse();
    return array;
  };

  const markingOut = cloneCard(RawDeal, 'marking-out', 'mo-own-test');
  player.hand.push(markingOut);

  await engine.playCard(0, markingOut.instanceId, 'action');
  await engine.selectChoice(0, 'ownArsenalToHand');
  await engine.confirmArsenalSearch(0, ['mo-pick-a']);

  assert(
    player.hand.some((c) => c.instanceId === 'mo-pick-a'),
    'Marking Out puts chosen Arsenal card in hand'
  );
  assert(player.arsenal.length === 1, 'Marking Out removes picked card from Arsenal');
  assert(
    player.arsenal[0].instanceId === 'mo-pick-b',
    'Marking Out leaves other Arsenal cards'
  );
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.END_OF_TURN,
    'Marking Out own Arsenal branch ends turn'
  );
  assert(
    engine.actionLog.some((e) => e.message.includes('shuffled your Arsenal')),
    'Marking Out shuffles own Arsenal'
  );
}

async function testMarkingOutOpponentArsenalContinuesTurn() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  opponent.arsenal = [];
  for (let i = 0; i < 5; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `mo-opp-${i}`));
  }

  const markingOut = cloneCard(RawDeal, 'marking-out', 'mo-opp-test');
  player.hand.push(markingOut);

  await engine.playCard(0, markingOut.instanceId, 'action');
  await engine.selectChoice(0, 'opponentArsenalToRingside');

  assert(engine.cardEffectFlow?.type === 'arsenalSearch', 'Marking Out opens opponent arsenal search');
  assert(engine.cardEffectFlow?.selectCount === 3, 'Marking Out selects up to 3 cards');

  await engine.confirmArsenalSearch(0, ['mo-opp-0', 'mo-opp-1', 'mo-opp-2']);

  assert(opponent.arsenal.length === 2, 'Marking Out removes 3 cards from opponent Arsenal');
  assert(opponent.ringside.length === 3, 'Marking Out puts 3 cards in opponent Ringside');
  assert(engine.stateMachine.activePlayer === 0, 'Marking Out opponent branch continues turn');
  assert(engine.stateMachine.canPlayCards(0), 'Marking Out opponent branch can still play cards');
  assert(
    engine.actionLog.some((e) => e.message.includes("shuffled opponent's Arsenal")),
    'Marking Out shuffles opponent Arsenal'
  );
}

async function testMarkingOutShortOpponentArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  opponent.arsenal = [
    cloneCard(RawDeal, 'chop', 'mo-short-a'),
    cloneCard(RawDeal, 'punch', 'mo-short-b'),
  ];

  const markingOut = cloneCard(RawDeal, 'marking-out', 'mo-short-test');
  player.hand.push(markingOut);

  await engine.playCard(0, markingOut.instanceId, 'action');
  await engine.selectChoice(0, 'opponentArsenalToRingside');

  assert(engine.cardEffectFlow?.selectCount === 2, 'Marking Out picks both when opponent has fewer than 3');

  await engine.confirmArsenalSearch(0, ['mo-short-a', 'mo-short-b']);

  assert(opponent.arsenal.length === 0, 'Marking Out empties short opponent Arsenal');
  assert(opponent.ringside.length === 2, 'Marking Out puts all short opponent cards in Ringside');
}

async function testMarkingOutEmptyArsenals() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');
  engine._runAutoPhases = async () => {};

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  player.arsenal = [];
  opponent.arsenal = [];

  const markingOut = cloneCard(RawDeal, 'marking-out', 'mo-empty-test');
  player.hand.push(markingOut);

  await engine.playCard(0, markingOut.instanceId, 'action');
  await engine.selectChoice(0, 'ownArsenalToHand');

  assert(
    engine.stateMachine.phase === RawDeal.PHASES.END_OF_TURN,
    'Marking Out empty own Arsenal still ends turn'
  );

  const engine2 = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine2.startGame('austin', 'rock');
  const player2 = engine2.players[0];
  const opponent2 = engine2.players[1];
  player2.hand = [];
  player2.fortitude = 20;
  opponent2.arsenal = [];
  const markingOut2 = cloneCard(RawDeal, 'marking-out', 'mo-empty-opp-test');
  player2.hand.push(markingOut2);

  await engine2.playCard(0, markingOut2.instanceId, 'action');
  await engine2.selectChoice(0, 'opponentArsenalToRingside');

  assert(engine2.stateMachine.activePlayer === 0, 'Marking Out empty opponent Arsenal continues turn');
  assert(opponent2.ringside.length === 0, 'Marking Out empty opponent Arsenal adds no Ringside cards');
}

async function testFiremansCarryHandRevealViewOnlyDone() {
  const RawDeal = loadRawDeal();
  const prompt = RawDeal.EffectPipeline.publicHandReveal(
    await (async () => {
      const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
      await engine.startGame('austin', 'rock');
      engine.handRevealFlow = {
        viewerIndex: 0,
        opponentIndex: 1,
        sourceName: "Fireman's Carry",
        cards: [{ id: 'punch', name: 'Punch', instanceId: 'x' }],
        mode: 'view',
        allowSkip: true,
        selectCount: 0,
        selectedIds: [],
      };
      engine.effectPipelineFlow = { paused: true, playerIndex: 0 };
      return engine;
    })(),
    0
  );

  assert(prompt?.mode === 'view', 'Fireman\'s Carry hand reveal is view-only');
  assert(prompt?.allowSkip === true, 'Fireman\'s Carry reveal is optional at engine level');
}

async function testFiremansCarryDamageAfterHandRevealDismiss() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = await createTestEngine(RawDeal);

  let damageResolved = false;
  const origDamage = engine._resolveDamage.bind(engine);
  engine._resolveDamage = async (...args) => {
    damageResolved = true;
    return origDamage(...args);
  };

  const fmc = cloneCard(RawDeal, 'fireman-s-carry', 'fmc-test');
  player.hand.push(fmc);
  opponent.hand = [cloneCard(RawDeal, 'kick', 'opp-reveal-0')];

  await engine.playCard(0, fmc.instanceId, 'maneuver');

  assert(!damageResolved, 'Fireman\'s Carry damage waits during hand reveal');
  assert(engine.handRevealFlow, 'Fireman\'s Carry opens hand reveal');
  assert(!engine.handRevealFlow.allowSkip || engine.handRevealFlow.mode === 'view', 'Fireman\'s Carry uses view reveal');

  await engine.dismissHandReveal(0);

  assert(damageResolved, 'Fireman\'s Carry resolves damage after hand reveal dismiss');
  assert(!engine.handRevealFlow, 'Hand reveal clears before damage completes');
}

async function testFiremansCarryThreeDamageStepsAfterDismiss() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = await createTestEngine(RawDeal);

  let damageSteps = 0;
  engine.onDamageStep = async ({ onReveal }) => {
    damageSteps += 1;
    onReveal();
  };

  const fmc = cloneCard(RawDeal, 'fireman-s-carry', 'fmc-3d-test');
  player.hand.push(fmc);
  opponent.hand = [cloneCard(RawDeal, 'kick', 'opp-reveal-1')];

  await engine.playCard(0, fmc.instanceId, 'maneuver');
  assert(engine.handRevealFlow, 'Fireman\'s Carry pauses on hand reveal');

  await engine.dismissHandReveal(0);

  assert(damageSteps === 3, 'Fireman\'s Carry resolves all 3 damage steps after dismiss');
  const lastEntry = engine.damageLog[engine.damageLog.length - 1];
  assert(lastEntry?.cardsOverturned === 3, 'Fireman\'s Carry overturns 3 arsenal cards');
  assert(lastEntry?.result === 'hit', 'Fireman\'s Carry damage completes without reversal');
}

async function testFiremansCarryMultiplayerDamageAfterDismiss() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  engine.onDamageStep = async ({ card, reversed, playerSeat, onReveal }) => {
    engine.animationEvents.push({
      type: 'damageFlip',
      seat: playerSeat,
      card,
      reversed: !!reversed,
    });
    if (onReveal) onReveal();
  };
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand = [];
  player.fortitude = 20;
  opponent.hand = [cloneCard(RawDeal, 'kick', 'mp-opp-hand')];
  for (let i = 0; i < 12; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `mp-opp-arsenal-${i}`));
  }

  const fmc = cloneCard(RawDeal, 'fireman-s-carry', 'fmc-mp-test');
  player.hand.push(fmc);

  await engine.playCard(0, fmc.instanceId, 'maneuver');
  assert(engine.reversalWindow, 'Multiplayer opens reversal window for maneuver');
  await engine.passPriority(1);
  assert(engine.handRevealFlow, 'Multiplayer Fireman\'s Carry pauses on hand reveal');

  engine.clearAnimationEvents();
  await engine.dismissHandReveal(0);

  assert(engine.animationEvents.length === 3, 'Multiplayer batches 3 damage flip animations after dismiss');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.MAIN,
    'Multiplayer returns to MAIN after Fireman\'s Carry resolves'
  );
  const lastEntry = engine.damageLog[engine.damageLog.length - 1];
  assert(lastEntry?.cardsOverturned === 3, 'Multiplayer Fireman\'s Carry overturns 3 cards');
}

async function testNotYetOpensHandPrompt() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.fortitude = 20;
  player.hand.push(
    cloneCard(RawDeal, 'punch', 'not-yet-filler'),
    cloneCard(RawDeal, 'not-yet', 'not-yet-test')
  );

  await engine.playCard(0, 'not-yet-test', 'action');

  assert(
    engine.cardEffectFlow?.type === 'shuffleHandIntoArsenal',
    'Not Yet opens hand shuffle prompt before draw'
  );
  assert(engine.cardEffectFlow?.drawCount === 2, 'Not Yet will draw 2 after shuffle');
}

async function testNotYetShuffleAndDraw() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [];
  player.arsenal = [
    cloneCard(RawDeal, 'chop', 'arsenal-0'),
    cloneCard(RawDeal, 'chop', 'arsenal-1'),
    cloneCard(RawDeal, 'chop', 'arsenal-2'),
  ];
  player.fortitude = 20;
  player.hand.push(
    cloneCard(RawDeal, 'punch', 'shuffle-this'),
    cloneCard(RawDeal, 'not-yet', 'not-yet-complete')
  );

  const arsenalBefore = player.arsenal.length;

  engine._shuffleCardIntoArsenal = (p, card) => {
    p.arsenal.unshift(card);
  };

  await engine.playCard(0, 'not-yet-complete', 'action');
  await engine.selectForCardEffect(0, 'shuffle-this');

  assert(
    player.arsenal[0]?.instanceId === 'shuffle-this',
    'Not Yet shuffled chosen card into Arsenal'
  );
  assert(player.arsenal.length === arsenalBefore - 1, 'Not Yet net Arsenal after shuffle in and draw 2');
  assert(player.hand.length === 2, 'Not Yet drew 2 cards after shuffle');
  assert(
    engine.actionLog.some((entry) => entry.message.includes('shuffled Punch from hand into Arsenal')),
    'Not Yet logs shuffle into Arsenal'
  );
  assert(
    engine.actionLog.some((entry) => entry.message.includes('drew 2 cards')),
    'Not Yet logs drawing 2 cards'
  );
  assert(!engine.cardEffectFlow, 'Not Yet prompt clears after completion');
}

async function testNotYetEmptyHandSkipsEffect() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  player.hand = [cloneCard(RawDeal, 'not-yet', 'not-yet-only')];
  player.arsenal = [cloneCard(RawDeal, 'chop', 'only-arsenal')];
  player.fortitude = 20;

  await engine.playCard(0, 'not-yet-only', 'action');

  assert(!engine.cardEffectFlow, 'Not Yet does not prompt when hand is empty after playing');
  assert(
    engine.actionLog.some((entry) => entry.message.includes('no cards in hand to shuffle')),
    'Not Yet logs empty hand for shuffle step'
  );
  assert(player.hand.length === 0, 'Not Yet left hand empty');
  assert(player.arsenal.length === 1, 'Not Yet did not draw when shuffle was skipped');
}

async function testJfpGrappleReversalTaxFromArsenal() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = await createTestEngine(RawDeal);

  const jfp = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-arsenal-tax');
  const grapple = cloneCard(RawDeal, 'double-leg-takedown', 'jfp-grapple-tax');
  const escapeMove = cloneCard(RawDeal, 'escape-move', 'jfp-escape-move');

  player.hand = [jfp, grapple];
  player.fortitude = 20;

  await engine.playCard(0, jfp.instanceId, 'action');
  assert(
    engine.cardEffectFlow?.choiceId === 'jockeyingForPosition',
    'JFP action opens jockeying choice'
  );
  await engine.selectChoice(0, 'grappleReversalTax');
  assert(player.turnState.nextGrappleReversalTax === 8, 'JFP sets +8F grapple reversal tax');

  opponent.fortitude = 7;
  assert(
    !engine._reversalStops(escapeMove, grapple, opponent, { attacker: player }),
    'Arsenal reversal blocked by JFP +8F tax at 7F'
  );
  opponent.fortitude = 8;
  assert(
    engine._reversalStops(escapeMove, grapple, opponent, { attacker: player }),
    'Arsenal reversal allowed by JFP +8F tax at 8F'
  );

  await engine.playCard(0, grapple.instanceId, 'maneuver');
  assert(
    player.turnState.nextGrappleReversalTax === 0,
    'JFP grapple reversal tax clears after maneuver resolves'
  );
}

async function testJfpGrappleDamageBonus() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent } = await createTestEngine(RawDeal);

  const jfp = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-dmg-bonus');
  const grapple = cloneCard(RawDeal, 'double-leg-takedown', 'jfp-grapple-dmg');

  player.hand = [jfp];
  player.fortitude = 20;

  await engine.playCard(0, jfp.instanceId, 'action');
  await engine.selectChoice(0, 'grappleDamage');

  const damage = engine._peekManeuverDamage(player, opponent, grapple);
  assert(damage === 7, 'JFP next Grapple is +4D (3 + 4)');
}

async function testJfpSelfReverseOpensChoice() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const jfpAttacker = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-atk');
  const jfpDefender = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-def');

  attacker.hand = [jfpAttacker];
  attacker.fortitude = 20;
  defender.hand = [jfpDefender];
  defender.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, jfpAttacker.instanceId, 'action');
  assert(engine.reversalWindow?.kind === 'action', 'JFP action opens reversal window');
  assert(
    engine.canPlayReversalFromHand(1, jfpDefender.instanceId),
    'JFP can reverse JFP action from hand'
  );

  await engine.playReversalFromHand(1, jfpDefender.instanceId);

  assert(engine.stateMachine.phase === RawDeal.PHASES.MAIN, 'Self-reverse returns to MAIN');
  assert(engine.stateMachine.activePlayer === 1, 'Turn passes to reversal player');
  assert(
    engine.cardEffectFlow?.choiceId === 'jockeyingForPosition',
    'JFP self-reverse opens jockeying choice on incoming turn'
  );
}

async function testJfpSelfReverseTaxAppliesToNextGrapple() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const jfpAttacker = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-atk-tax');
  const jfpDefender = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-def-tax');
  const grapple = cloneCard(RawDeal, 'double-leg-takedown', 'jfp-self-grapple');
  const escapeMove = cloneCard(RawDeal, 'escape-move', 'jfp-self-escape');

  attacker.hand = [jfpAttacker];
  attacker.fortitude = 20;
  defender.hand = [jfpDefender, grapple];
  defender.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, jfpAttacker.instanceId, 'action');
  await engine.playReversalFromHand(1, jfpDefender.instanceId);
  await engine.selectChoice(1, 'grappleReversalTax');

  attacker.fortitude = 7;
  assert(
    !engine._reversalStops(escapeMove, grapple, attacker, { attacker: defender }),
    'Self-reverse JFP tax blocks arsenal reversal at 7F'
  );
  attacker.fortitude = 8;
  assert(
    engine._reversalStops(escapeMove, grapple, attacker, { attacker: defender }),
    'Self-reverse JFP tax allows arsenal reversal at 8F'
  );
}

async function testCleanBreakReversesJfp() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const jfp = cloneCard(RawDeal, 'jockeying-for-position', 'jfp-clean');
  const cleanBreak = cloneCard(RawDeal, 'clean-break', 'clean-break-test');

  attacker.hand = [
    jfp,
    cloneCard(RawDeal, 'punch', 'jfp-filler-0'),
    cloneCard(RawDeal, 'punch', 'jfp-filler-1'),
    cloneCard(RawDeal, 'punch', 'jfp-filler-2'),
    cloneCard(RawDeal, 'punch', 'jfp-filler-3'),
  ];
  attacker.fortitude = 20;
  defender.hand = [cleanBreak];
  defender.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, jfp.instanceId, 'action');
  assert(
    engine.canPlayReversalFromHand(1, cleanBreak.instanceId),
    'Clean Break can reverse JFP action from hand'
  );

  await engine.playReversalFromHand(1, cleanBreak.instanceId);

  if (engine.cardEffectFlow?.type === 'opponentDiscardFromHand') {
    const toDiscard = [...attacker.hand];
    for (const card of toDiscard) {
      await engine.selectForCardEffect(0, card.instanceId);
    }
  }

  assert(attacker.hand.length === 0, 'Clean Break forces attacker to discard 4 hand cards');
  assert(defender.hand.length >= 1, 'Clean Break reversal player draws at least 1 card');
  assert(!engine.cardEffectFlow, 'Clean Break does not open jockeying choice');
  assert(engine.stateMachine.activePlayer === 1, 'Clean Break ends attacker turn');
  assert(
    engine.actionLog.some((entry) => entry.message.includes('opponent discarded')),
    'Clean Break logs opponent discard'
  );
  assert(
    engine.actionLog.some((entry) => entry.message.includes('drew 1 card')),
    'Clean Break logs draw'
  );
}

async function testElbowBlocksManeuverOver7D() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'bulldog',
    effectiveDamage: 8,
  });

  assert(
    !engine.canPlayReversalFromHand(1, reversal.instanceId),
    'Elbow cannot reverse a maneuver dealing more than 7D'
  );
}

async function testElbowAllowsManeuverAt7D() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'kick',
    effectiveDamage: 7,
  });

  assert(
    engine.canPlayReversalFromHand(1, reversal.instanceId),
    'Elbow can reverse a maneuver dealing 7D or less'
  );
}

async function testKneeBlockedWhenEffectiveDamageOver7() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'punch',
    reversalId: 'knee-to-the-gut',
    effectiveDamage: 8,
    afterIrishWhip: true,
    defenderFortitude: 5,
  });

  assert(
    !engine.canPlayReversalFromHand(1, reversal.instanceId),
    'Knee cannot reverse Strike when Irish Whip bonus pushes damage above 7D'
  );
}

async function testKneeAllowedAt7DWithIrishWhip() {
  const RawDeal = loadRawDeal();
  const { engine, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'chop',
    reversalId: 'knee-to-the-gut',
    effectiveDamage: 7,
    afterIrishWhip: true,
    defenderFortitude: 5,
  });

  assert(
    engine.canPlayReversalFromHand(1, reversal.instanceId),
    'Knee can reverse Strike at exactly 7D with Irish Whip bonus'
  );
}

async function testKneeDealsManeuverDamageFromHand() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'kick',
    reversalId: 'knee-to-the-gut',
    effectiveDamage: 5,
    defenderFortitude: 5,
    arsenalCount: 10,
  });
  const arsenalBefore = attacker.arsenal.length;

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    attacker.arsenal.length === arsenalBefore - 5,
    'Knee deals irreversible damage equal to reversed maneuver D'
  );
}

async function testRollingDealsManeuverDamageFromHand() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, reversal } = await createHandReversalTest(RawDeal, {
    maneuverId: 'double-leg-takedown',
    reversalId: 'rolling-takedown',
    effectiveDamage: 3,
    defenderFortitude: 5,
    arsenalCount: 10,
  });
  const arsenalBefore = attacker.arsenal.length;

  await engine.playReversalFromHand(1, reversal.instanceId);

  assert(
    attacker.arsenal.length === arsenalBefore - 3,
    'Rolling Takedown deals irreversible damage equal to reversed maneuver D'
  );
}

async function testArsenalReversalBlockedOver7D() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const kick = cloneCard(RawDeal, 'kick', 'cap-kick');
  const knee = cloneCard(RawDeal, 'knee-to-the-gut', 'cap-knee');

  attacker.turnState = engine._emptyTurnState();
  attacker.turnState.irishWhipPlayed = true;
  attacker.turnState.nextStrikeBonus = 5;
  defender.fortitude = 20;

  assert(
    !engine._reversalStops(knee, kick, defender, {
      attacker,
      effectiveDamage: 10,
    }),
    'Arsenal Knee cannot reverse 10D effective Strike'
  );
  assert(
    engine._reversalStops(knee, kick, defender, {
      attacker,
      effectiveDamage: 7,
    }),
    'Arsenal Knee can reverse 7D effective Strike'
  );
}

async function createPostIwStrikeDamageTest(RawDeal, { reversalId, reversalInstanceId }) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'iw-8d-punch');
  const reversal = cloneCard(RawDeal, reversalId, reversalInstanceId);

  attacker.turnState = engine._emptyTurnState();
  attacker.turnState.irishWhipPlayed = true;
  attacker.turnState.nextStrikeBonus = 5;
  attacker.fortitude = 20;
  defender.fortitude = 20;

  for (let i = 0; i < 10; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `iw-fill-${reversalId}-${i}`));
  }
  defender.arsenal.push(reversal);

  const damage = engine._calcManeuverDamage(attacker, defender, punch);
  assert(damage === 8, 'Punch deals 8D after Irish Whip self-reverse setup');
  assert(
    attacker.turnState.nextStrikeBonus === 0,
    'Strike bonus consumed before arsenal damage resolution'
  );
  assert(
    engine._peekManeuverDamage(attacker, defender, punch) === 3,
    'Peek shows base Punch damage after bonus consumed'
  );

  return { engine, attacker, defender, punch, reversal, damage };
}

async function testArsenalElbowCannotReverse8DPunchAfterIwSelfReverse() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, punch, damage } = await createPostIwStrikeDamageTest(
    RawDeal,
    { reversalId: 'elbow-to-the-face', reversalInstanceId: 'iw-elbow-8d' }
  );

  const result = await engine._resolveDamage(attacker, defender, punch, damage);

  assert(result.result === 'hit', 'Arsenal Elbow cannot reverse 8D Punch after IW self-reverse');
  assert(result.cardsOverturned === 8, '8D Punch overturns 8 Arsenal cards without reversal');
}

async function testArsenalKneeCannotReverse8DPunchAfterIwSelfReverse() {
  const RawDeal = loadRawDeal();
  const { engine, attacker, defender, punch, damage } = await createPostIwStrikeDamageTest(
    RawDeal,
    { reversalId: 'knee-to-the-gut', reversalInstanceId: 'iw-knee-8d' }
  );

  const result = await engine._resolveDamage(attacker, defender, punch, damage);

  assert(result.result === 'hit', 'Arsenal Knee cannot reverse 8D Punch after IW self-reverse');
  assert(result.cardsOverturned === 8, '8D Punch overturns 8 Arsenal cards without reversal');
}

async function testIrishWhipSelfReverseEligible() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const iwAttacker = cloneCard(RawDeal, 'irish-whip', 'iw-atk');
  const iwDefender = cloneCard(RawDeal, 'irish-whip', 'iw-def');

  attacker.hand = [iwAttacker];
  attacker.fortitude = 20;
  defender.hand = [iwDefender];
  defender.fortitude = 6;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, iwAttacker.instanceId, 'action');
  assert(engine.reversalWindow?.kind === 'action', 'Irish Whip action opens reversal window');
  assert(
    engine.canPlayReversalFromHand(1, iwDefender.instanceId),
    'Irish Whip can reverse Irish Whip action from hand at 6F'
  );
}

async function testIrishWhipSelfReverseGrantsStrikeBonus() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const iwAttacker = cloneCard(RawDeal, 'irish-whip', 'iw-atk-bonus');
  const iwDefender = cloneCard(RawDeal, 'irish-whip', 'iw-def-bonus');

  attacker.hand = [iwAttacker];
  attacker.fortitude = 20;
  defender.hand = [iwDefender];
  defender.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, iwAttacker.instanceId, 'action');
  await engine.playReversalFromHand(1, iwDefender.instanceId);

  assert(
    defender.turnState.nextStrikeBonus === 5,
    'Irish Whip self-reverse grants +5D on next Strike'
  );
}

async function testIrishWhipCannotReversePostIwManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'iw-post-punch');
  const irishWhip = cloneCard(RawDeal, 'irish-whip', 'iw-post-iw');
  const shoulderBlock = cloneCard(RawDeal, 'shoulder-block', 'iw-post-sb');

  attacker.hand = [punch];
  attacker.fortitude = 20;
  attacker.turnState = engine._emptyTurnState();
  attacker.turnState.irishWhipPlayed = true;

  defender.hand = [irishWhip, shoulderBlock];
  defender.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(engine.reversalWindow?.kind === 'maneuver', 'Strike opens maneuver reversal window');

  assert(
    !engine.canPlayReversalFromHand(1, irishWhip.instanceId),
    'Irish Whip cannot reverse a maneuver played after Irish Whip setup'
  );
  assert(
    engine.canPlayReversalFromHand(1, shoulderBlock.instanceId),
    'Shoulder Block can reverse a maneuver played after Irish Whip setup'
  );
}

async function createShakeItOffTest(RawDeal) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('austin', 'rock');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const shake = cloneCard(RawDeal, 'shake-it-off', 'sio-test');

  player.hand = [shake];
  player.ring = { maneuvers: [], reversals: [], actions: [] };
  opponent.ring = { maneuvers: [], reversals: [], actions: [] };

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, opponent, shake };
}

async function testShakeItOffPlayableWhenLowerFortitude() {
  const RawDeal = loadRawDeal();
  const { engine, shake } = await createShakeItOffTest(RawDeal);
  const player = engine.players[0];
  const opponent = engine.players[1];

  const punch = cloneCard(RawDeal, 'punch', 'sio-opp-punch');
  opponent.ring.maneuvers.push(punch);
  engine._syncFortitude(opponent);

  player.fortitude = 3;
  opponent.fortitude = 6;

  assert(
    engine.canPlayCard(0, shake.instanceId, 'action'),
    'Shake It Off playable when your Fortitude is lower and a valid Ring target exists'
  );
}

async function testShakeItOffNotPlayableWhenFortitudeNotLower() {
  const RawDeal = loadRawDeal();
  const { engine, shake } = await createShakeItOffTest(RawDeal);
  const player = engine.players[0];
  const opponent = engine.players[1];

  const punch = cloneCard(RawDeal, 'punch', 'sio-opp-punch-block');
  opponent.ring.maneuvers.push(punch);
  engine._syncFortitude(opponent);

  player.fortitude = 6;
  opponent.fortitude = 6;

  assert(
    !engine.canPlayCard(0, shake.instanceId, 'action'),
    'Shake It Off not playable when Fortitude is not less than opponent'
  );
}

async function testShakeItOffPlayableWhenBehindWithoutRemovableTarget() {
  const RawDeal = loadRawDeal();
  const { engine, shake } = await createShakeItOffTest(RawDeal);
  const player = engine.players[0];
  const opponent = engine.players[1];

  const clothesline = cloneCard(RawDeal, 'clothesline', 'sio-opp-clothesline');
  opponent.ring.maneuvers.push(clothesline);
  engine._syncFortitude(opponent);

  player.fortitude = 3;
  opponent.fortitude = 7;

  assert(
    engine.canPlayCard(0, shake.instanceId, 'action'),
    'Shake It Off playable when behind even if no opponent Ring card is within your Fortitude cap'
  );
  assert(
    !RawDeal.CardUtils.hasRemovableOpponentRingTarget(player, opponent),
    'No removable opponent Ring target at 3F vs 7D Clothesline'
  );
}

async function testShakeItOffRemovesOpponentRingCard() {
  const RawDeal = loadRawDeal();
  const { engine, shake } = await createShakeItOffTest(RawDeal);
  const player = engine.players[0];
  const opponent = engine.players[1];

  const punch = cloneCard(RawDeal, 'punch', 'sio-remove-punch');
  const clothesline = cloneCard(RawDeal, 'clothesline', 'sio-remove-clothesline');
  opponent.ring.maneuvers.push(punch, clothesline);
  engine._syncFortitude(opponent);

  player.fortitude = 5;
  opponent.fortitude = 12;

  await engine.playCard(0, shake.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'removeOpponentRingCard',
    'Shake It Off opens opponent Ring selection prompt'
  );

  assert(
    engine.toggleRemoveOpponentRingSelect(0, punch.instanceId, 'maneuvers'),
    'Can select opponent Ring card within Fortitude cap'
  );
  assert(
    !engine.toggleRemoveOpponentRingSelect(0, clothesline.instanceId, 'maneuvers'),
    'Cannot select opponent Ring card above Fortitude cap'
  );

  await engine.confirmRemoveOpponentRingCard(0);

  assert(
    !opponent.ring.maneuvers.some((c) => c.instanceId === punch.instanceId),
    'Removed maneuver leaves opponent Ring'
  );
  assert(
    opponent.ringside.some((c) => c.instanceId === punch.instanceId),
    'Removed maneuver goes to opponent Ringside'
  );
  assert(opponent.fortitude === 7, 'Opponent Fortitude drops after removing maneuver');
  assert(
    player.ring.actions.some((c) => c.instanceId === shake.instanceId),
    'Shake It Off is placed in your Ring actions area'
  );
}

async function createOfferHandshakeTest(RawDeal, { arsenalCount = 10 } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const handshake = cloneCard(RawDeal, 'offer-handshake', 'oh-test');

  player.hand = [handshake];
  player.arsenal = [];
  for (let i = 0; i < arsenalCount; i++) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', `oh-arsenal-${i}`));
  }
  player.fortitude = 5;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, handshake };
}

async function testOfferHandshakeDrawTwoThenDiscard() {
  const RawDeal = loadRawDeal();
  const { engine, player, handshake } = await createOfferHandshakeTest(RawDeal, {
    arsenalCount: 10,
  });
  const filler = cloneCard(RawDeal, 'punch', 'oh-discard');
  player.hand.push(filler);

  const arsenalBefore = player.arsenal.length;
  const handBefore = player.hand.length;

  await engine.playCard(0, handshake.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'drawCountChoice',
    'Offer Handshake opens draw count choice'
  );

  engine.adjustDrawCount(0, 2);
  await engine.confirmDrawCount(0);

  assert(
    engine.cardEffectFlow?.type === 'discardFromHand',
    'Offer Handshake prompts discard after drawing'
  );
  assert(player.arsenal.length === arsenalBefore - 2, 'Offer Handshake drew 2 from Arsenal');

  await engine.selectForCardEffect(0, filler.instanceId);

  assert(
    player.ringside.some((c) => c.instanceId === filler.instanceId),
    'Offer Handshake discards chosen card to Ringside'
  );
  assert(
    player.hand.length === handBefore - 1 + 2 - 1,
    'Offer Handshake net hand change: -played card, +2 draw, -1 discard'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === handshake.instanceId),
    'Offer Handshake is in Ring actions'
  );
}

async function testOfferHandshakeDrawCappedByArsenal() {
  const RawDeal = loadRawDeal();
  const { engine, handshake } = await createOfferHandshakeTest(RawDeal, { arsenalCount: 1 });

  await engine.playCard(0, handshake.instanceId, 'action');

  const prompt = engine._publicSelectionPrompt(0);
  assert(prompt?.mode === 'drawCount', 'Offer Handshake shows draw count prompt');
  assert(prompt.max === 1, 'Draw count capped at Arsenal size when fewer than 3');

  engine.adjustDrawCount(0, 5);
  assert(engine.cardEffectFlow.selectedCount === 1, 'Draw count cannot exceed Arsenal size');
}

async function testOfferHandshakeDrawZeroStillDiscards() {
  const RawDeal = loadRawDeal();
  const { engine, player, handshake } = await createOfferHandshakeTest(RawDeal, {
    arsenalCount: 5,
  });
  const filler = cloneCard(RawDeal, 'kick', 'oh-zero-discard');
  player.hand.push(filler);

  await engine.playCard(0, handshake.instanceId, 'action');
  await engine.confirmDrawCount(0);

  assert(
    engine.cardEffectFlow?.type === 'discardFromHand',
    'Offer Handshake still prompts discard after drawing 0'
  );

  await engine.selectForCardEffect(0, filler.instanceId);

  assert(
    player.ringside.some((c) => c.instanceId === filler.instanceId),
    'Offer Handshake discards after drawing 0'
  );
}

async function createRollOutTest(RawDeal, { handCards = [], ringsideCards = [] } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const rollOut = cloneCard(RawDeal, 'roll-out-of-the-ring', 'ro-test');

  player.hand = [rollOut, ...handCards];
  player.ringside = [...ringsideCards];
  player.fortitude = 5;
  player.arsenal = [cloneCard(RawDeal, 'chop', 'ro-arsenal')];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, rollOut };
}

async function testRollOutFullSwap() {
  const RawDeal = loadRawDeal();
  const discard1 = cloneCard(RawDeal, 'punch', 'ro-discard-1');
  const discard2 = cloneCard(RawDeal, 'kick', 'ro-discard-2');
  const extra = cloneCard(RawDeal, 'chop', 'ro-extra');
  const return1 = cloneCard(RawDeal, 'elbow', 'ro-return-1');
  const return2 = cloneCard(RawDeal, 'shoulder-block', 'ro-return-2');

  const { engine, player, rollOut } = await createRollOutTest(RawDeal, {
    handCards: [discard1, discard2, extra],
    ringsideCards: [return1, return2],
  });

  const handBefore = player.hand.length;
  const ringsideBefore = player.ringside.length;

  await engine.playCard(0, rollOut.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'discardCountChoice',
    'Roll Out opens discard count choice'
  );

  engine.adjustDiscardCount(0, 2);
  await engine.confirmDiscardCount(0);

  assert(
    engine.cardEffectFlow?.type === 'discardFromHand',
    'Roll Out prompts hand discard after choosing 2'
  );

  await engine.selectForCardEffect(0, discard1.instanceId);
  await engine.selectForCardEffect(0, discard2.instanceId);

  assert(
    player.ringside.some((c) => c.instanceId === discard1.instanceId),
    'Roll Out discards first card to Ringside'
  );
  assert(
    player.ringside.some((c) => c.instanceId === discard2.instanceId),
    'Roll Out discards second card to Ringside'
  );

  assert(
    engine.cardEffectFlow?.type === 'returnFromRingside',
    'Roll Out prompts Ringside return after discarding'
  );
  const returnPrompt = engine._publicSelectionPrompt(0);
  assert(returnPrompt?.mode === 'ringsideModal', 'Roll Out opens Ringside return modal');
  assert(returnPrompt.cards.length === 4, 'Roll Out modal lists all Ringside cards');

  engine.toggleSuperstarAbilitySelection(0, return1.instanceId);
  engine.toggleSuperstarAbilitySelection(0, return2.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, [return1.instanceId, return2.instanceId]);

  assert(
    player.hand.some((c) => c.instanceId === return1.instanceId),
    'Roll Out returns first Ringside card to hand'
  );
  assert(
    player.hand.some((c) => c.instanceId === return2.instanceId),
    'Roll Out returns second Ringside card to hand'
  );
  assert(
    !player.ringside.some((c) => c.instanceId === return1.instanceId),
    'Returned card leaves Ringside'
  );
  assert(
    player.hand.length === handBefore - 1 - 2 + 2,
    'Roll Out net hand: -played, -2 discard, +2 return'
  );
  assert(
    player.ringside.length === ringsideBefore + 2 - 2,
    'Roll Out net Ringside: +2 discard, -2 return'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === rollOut.instanceId),
    'Roll Out is in Ring actions'
  );
  assert(!engine.cardEffectFlow, 'Roll Out effect completes');
}

async function testRollOutDiscardZero() {
  const RawDeal = loadRawDeal();
  const { engine, player, rollOut } = await createRollOutTest(RawDeal, {
    handCards: [cloneCard(RawDeal, 'punch', 'ro-zero-extra')],
    ringsideCards: [cloneCard(RawDeal, 'elbow', 'ro-zero-rs')],
  });

  const handBefore = player.hand.length;
  const ringsideBefore = player.ringside.length;

  await engine.playCard(0, rollOut.instanceId, 'action');
  await engine.confirmDiscardCount(0);

  assert(!engine.cardEffectFlow, 'Roll Out completes after discarding 0');
  assert(player.hand.length === handBefore - 1, 'Roll Out discard 0: only played card leaves hand');
  assert(player.ringside.length === ringsideBefore, 'Roll Out discard 0: Ringside unchanged');
}

async function testRollOutCapByHand() {
  const RawDeal = loadRawDeal();
  const { engine, rollOut } = await createRollOutTest(RawDeal, {
    handCards: [cloneCard(RawDeal, 'punch', 'ro-cap')],
  });

  await engine.playCard(0, rollOut.instanceId, 'action');

  const prompt = engine._publicSelectionPrompt(0);
  assert(prompt?.mode === 'discardCount', 'Roll Out shows discard count prompt');
  assert(prompt.max === 1, 'Roll Out discard count capped by hand size when fewer than 2');

  engine.adjustDiscardCount(0, 5);
  assert(engine.cardEffectFlow.selectedCount === 1, 'Roll Out discard count cannot exceed hand size');
}

async function testRollOutDiscardCappedReturnsOne() {
  const RawDeal = loadRawDeal();
  const discard1 = cloneCard(RawDeal, 'punch', 'ro-cap-discard');
  const preExisting = cloneCard(RawDeal, 'elbow', 'ro-cap-rs');

  const { engine, player, rollOut } = await createRollOutTest(RawDeal, {
    handCards: [discard1],
    ringsideCards: [preExisting],
  });

  await engine.playCard(0, rollOut.instanceId, 'action');
  engine.adjustDiscardCount(0, 2);
  assert(engine.cardEffectFlow.selectedCount === 1, 'Roll Out cannot discard more than hand allows');
  await engine.confirmDiscardCount(0);
  await engine.selectForCardEffect(0, discard1.instanceId);

  const prompt = engine._publicSelectionPrompt(0);
  assert(prompt?.mode === 'ringsideModal', 'Roll Out shows Ringside return modal');
  assert(prompt.selectCount === 1, 'Roll Out returns equal to actual discarded count when capped');
  assert(prompt.cards.length === 2, 'Roll Out modal shows all Ringside cards');

  engine.toggleSuperstarAbilitySelection(0, preExisting.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, preExisting.instanceId);

  assert(
    player.hand.some((c) => c.instanceId === preExisting.instanceId),
    'Roll Out can return a pre-existing Ringside card'
  );
  assert(
    player.ringside.some((c) => c.instanceId === discard1.instanceId),
    'Discarded card remains in Ringside when another card is returned'
  );
  assert(!engine.cardEffectFlow, 'Roll Out completes after capped swap');
}

async function createRecoveryTest(RawDeal, { ringsideCards = [], arsenalCount = 5 } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const recovery = cloneCard(RawDeal, 'recovery', 'rec-test');

  player.hand = [recovery];
  player.ringside = [...ringsideCards];
  player.arsenal = [];
  for (let i = 0; i < arsenalCount; i++) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', `rec-arsenal-${i}`));
  }
  player.fortitude = 6;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, recovery };
}

async function createPeoplesEyebrowTest(RawDeal, { ringsideCards = [], arsenalCount = 5 } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const eyebrow = cloneCard(RawDeal, 'peoples-eyebrow', 'eyebrow-test');

  player.hand = [eyebrow];
  player.ringside = [...ringsideCards];
  player.arsenal = [];
  for (let i = 0; i < arsenalCount; i++) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', `eyebrow-arsenal-${i}`));
  }
  player.fortitude = 7;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, eyebrow };
}

async function testPeoplesEyebrowTakeTwoThenShuffleTwo() {
  const RawDeal = loadRawDeal();
  const rs1 = cloneCard(RawDeal, 'punch', 'eyebrow-rs-1');
  const rs2 = cloneCard(RawDeal, 'kick', 'eyebrow-rs-2');
  const rs3 = cloneCard(RawDeal, 'elbow', 'eyebrow-rs-3');
  const rs4 = cloneCard(RawDeal, 'chop', 'eyebrow-rs-4');
  const { engine, player, eyebrow } = await createPeoplesEyebrowTest(RawDeal, {
    ringsideCards: [rs1, rs2, rs3, rs4],
    arsenalCount: 3,
  });

  const arsenalBefore = player.arsenal.length;
  const handBefore = player.hand.length;

  await engine.playCard(0, eyebrow.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'returnFromRingside',
    "People's Eyebrow opens Ringside return modal first"
  );
  const takePrompt = engine._publicSelectionPrompt(0);
  assert(takePrompt?.mode === 'ringsideModal', "People's Eyebrow uses Ringside modal to take cards");
  assert(takePrompt.selectCount === 2, "People's Eyebrow takes 2 when Ringside has 4");

  engine.toggleSuperstarAbilitySelection(0, rs1.instanceId);
  engine.toggleSuperstarAbilitySelection(0, rs2.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, [rs1.instanceId, rs2.instanceId]);

  assert(player.hand.some((c) => c.instanceId === rs1.instanceId), 'First taken card is in hand');
  assert(player.hand.some((c) => c.instanceId === rs2.instanceId), 'Second taken card is in hand');
  assert(player.ringside.length === 2, 'Two cards remain in Ringside after taking 2');

  assert(
    engine.cardEffectFlow?.type === 'shuffleRingsideIntoArsenal',
    "People's Eyebrow opens shuffle modal after taking cards"
  );
  const shufflePrompt = engine._publicSelectionPrompt(0);
  assert(shufflePrompt?.selectCount === 2, "People's Eyebrow shuffles 2 when 2 remain in Ringside");

  engine.toggleSuperstarAbilitySelection(0, rs3.instanceId);
  engine.toggleSuperstarAbilitySelection(0, rs4.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, [rs3.instanceId, rs4.instanceId]);

  assert(player.arsenal.length === arsenalBefore + 2, 'Two cards are shuffled into Arsenal');
  assert(!player.ringside.some((c) => c.instanceId === rs3.instanceId), 'Shuffled card leaves Ringside');
  assert(!player.ringside.some((c) => c.instanceId === rs4.instanceId), 'Second shuffled card leaves Ringside');
  assert(player.hand.length === handBefore - 1 + 2, 'Net hand gain is +2 after playing the action');
  assert(
    player.ring.actions.some((c) => c.instanceId === eyebrow.instanceId),
    "People's Eyebrow is in Ring actions"
  );
  assert(!engine.cardEffectFlow, "People's Eyebrow effect completes");
}

async function testPeoplesEyebrowTakeOneWhenOnlyOneInRingside() {
  const RawDeal = loadRawDeal();
  const rs1 = cloneCard(RawDeal, 'punch', 'eyebrow-one-rs');
  const { engine, player, eyebrow } = await createPeoplesEyebrowTest(RawDeal, {
    ringsideCards: [rs1],
    arsenalCount: 2,
  });

  await engine.playCard(0, eyebrow.instanceId, 'action');

  const takePrompt = engine._publicSelectionPrompt(0);
  assert(takePrompt?.selectCount === 1, "People's Eyebrow takes only 1 when Ringside has 1");

  engine.toggleSuperstarAbilitySelection(0, rs1.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, rs1.instanceId);

  assert(player.hand.some((c) => c.instanceId === rs1.instanceId), 'Only Ringside card is taken to hand');
  assert(player.ringside.length === 0, 'Ringside is empty after taking the only card');
  assert(!engine.cardEffectFlow, "People's Eyebrow skips shuffle when Ringside is empty");
}

async function createPeoplesElbowTest(RawDeal, { ringCards = [] } = {}) {
  const { engine, player, opponent } = await createTestEngine(RawDeal);

  player.hand = [];
  player.arsenal = [];
  for (let i = 0; i < 6; i++) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', `elbow-arsenal-${i}`));
  }
  opponent.hand = [];

  for (const { card, area } of ringCards) {
    player.ring[area].push(card);
  }

  return { engine, player, opponent };
}

async function testPeoplesElbowManeuverRequiresRockBottom() {
  const RawDeal = loadRawDeal();
  const elbow = cloneCard(RawDeal, 'peoples-elbow', 'elbow-no-rb');
  const { engine } = await createPeoplesElbowTest(RawDeal);

  engine.players[0].hand = [elbow];

  assert(
    !engine.canPlayCard(0, elbow.instanceId, 'maneuver'),
    "People's Elbow maneuver requires Rock Bottom in Ring"
  );
  assert(
    engine.canPlayCard(0, elbow.instanceId, 'action'),
    "People's Elbow action does not require Rock Bottom"
  );
}

async function testPeoplesElbowManeuverWithRockBottomInRing() {
  const RawDeal = loadRawDeal();
  const elbow = cloneCard(RawDeal, 'peoples-elbow', 'elbow-maneuver');
  const rockBottom = cloneCard(RawDeal, 'rock-bottom', 'rb-ring');
  const { engine, player, opponent } = await createPeoplesElbowTest(RawDeal, {
    ringCards: [{ card: rockBottom, area: 'maneuvers' }],
  });

  player.hand = [elbow];
  const arsenalBefore = opponent.arsenal.length;

  assert(
    engine.canPlayCard(0, elbow.instanceId, 'maneuver'),
    "People's Elbow maneuver is playable with Rock Bottom in Ring"
  );

  await engine.playCard(0, elbow.instanceId, 'maneuver');

  assert(
    player.ring.maneuvers.some((c) => c.instanceId === elbow.instanceId),
    "People's Elbow enters Ring as maneuver"
  );
  assert(
    opponent.arsenal.length === arsenalBefore - 10,
    "People's Elbow maneuver deals 10 damage"
  );
}

async function testPeoplesElbowManeuverWithRockBottomInReversals() {
  const RawDeal = loadRawDeal();
  const elbow = cloneCard(RawDeal, 'peoples-elbow', 'elbow-rb-rev');
  const rockBottom = cloneCard(RawDeal, 'rock-bottom', 'rb-reversal');
  const { engine } = await createPeoplesElbowTest(RawDeal, {
    ringCards: [{ card: rockBottom, area: 'reversals' }],
  });

  engine.players[0].hand = [elbow];

  assert(
    engine.canPlayCard(0, elbow.instanceId, 'maneuver'),
    "People's Elbow maneuver counts Rock Bottom in reversals Ring area"
  );
}

async function testPeoplesElbowActionShufflesIntoArsenalAndDrawsTwo() {
  const RawDeal = loadRawDeal();
  const elbow = cloneCard(RawDeal, 'peoples-elbow', 'elbow-action');
  const { engine, player } = await createPeoplesElbowTest(RawDeal);

  player.hand = [elbow];
  const arsenalBefore = player.arsenal.length;

  await engine.playCard(0, elbow.instanceId, 'action');

  assert(
    player.arsenal.some((c) => c.instanceId === elbow.instanceId),
    "People's Elbow action shuffles itself into Arsenal"
  );
  assert(
    player.arsenal.length === arsenalBefore - 1,
    "People's Elbow action shuffles into Arsenal then draws 2 (net -1 in Arsenal)"
  );
  assert(
    !player.ring.actions.some((c) => c.instanceId === elbow.instanceId),
    "People's Elbow action does not remain in Ring actions"
  );
  assert(player.hand.length === 2, "People's Elbow action draws 2 cards");
  assert(
    engine.actionLog.some((entry) => entry.message.includes('shuffled into Arsenal')),
    "People's Elbow action logs shuffle into Arsenal"
  );
}

async function testPeoplesEyebrowEmptyRingsideSkipsBothSteps() {
  const RawDeal = loadRawDeal();
  const { engine, player, eyebrow } = await createPeoplesEyebrowTest(RawDeal, {
    ringsideCards: [],
    arsenalCount: 2,
  });

  const arsenalBefore = player.arsenal.length;

  await engine.playCard(0, eyebrow.instanceId, 'action');

  assert(!engine.cardEffectFlow, "People's Eyebrow skips both steps when Ringside is empty");
  assert(player.arsenal.length === arsenalBefore, 'Arsenal unchanged when Ringside is empty');
  assert(player.hand.length === 0, 'Only the played action leaves hand');
}

async function testRecoveryShuffleTwoThenDraw() {
  const RawDeal = loadRawDeal();
  const rs1 = cloneCard(RawDeal, 'punch', 'rec-rs-1');
  const rs2 = cloneCard(RawDeal, 'kick', 'rec-rs-2');
  const { engine, player, recovery } = await createRecoveryTest(RawDeal, {
    ringsideCards: [rs1, rs2],
    arsenalCount: 4,
  });

  const arsenalBefore = player.arsenal.length;
  const handBefore = player.hand.length;

  await engine.playCard(0, recovery.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'shuffleRingsideIntoArsenal',
    'Recovery opens Ringside shuffle modal for 2 cards'
  );
  const shufflePrompt = engine._publicSelectionPrompt(0);
  assert(shufflePrompt?.mode === 'ringsideModal', 'Recovery uses Ringside modal');
  assert(shufflePrompt.selectCount === 2, 'Recovery requires 2 Ringside cards when available');

  engine.toggleSuperstarAbilitySelection(0, rs1.instanceId);
  engine.toggleSuperstarAbilitySelection(0, rs2.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, [rs1.instanceId, rs2.instanceId]);

  assert(
    player.arsenal.length === arsenalBefore + 1,
    'Recovery shuffles 2 into Arsenal then draws 1 (net +1)'
  );
  const inDeckOrHand = (card) =>
    player.arsenal.some((c) => c.instanceId === card.instanceId) ||
    player.hand.some((c) => c.instanceId === card.instanceId);
  assert(inDeckOrHand(rs1), 'Recovery keeps first shuffled card in Arsenal or hand');
  assert(inDeckOrHand(rs2), 'Recovery keeps second shuffled card in Arsenal or hand');
  assert(
    !player.ringside.some((c) => c.instanceId === rs1.instanceId),
    'Shuffled card leaves Ringside'
  );
  assert(
    player.hand.length === handBefore - 1 + 1,
    'Recovery draws 1 after shuffling (-played card, +1 draw)'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === recovery.instanceId),
    'Recovery is in Ring actions'
  );
  assert(!engine.cardEffectFlow, 'Recovery effect completes');
}

async function testRecoveryShuffleOneWhenOnlyOneInRingside() {
  const RawDeal = loadRawDeal();
  const rs1 = cloneCard(RawDeal, 'elbow', 'rec-one-rs');
  const { engine, player, recovery } = await createRecoveryTest(RawDeal, {
    ringsideCards: [rs1],
    arsenalCount: 3,
  });

  const arsenalBefore = player.arsenal.length;

  await engine.playCard(0, recovery.instanceId, 'action');

  const prompt = engine._publicSelectionPrompt(0);
  assert(prompt?.mode === 'ringsideModal', 'Recovery opens Ringside modal with 1 card');
  assert(prompt.selectCount === 1, 'Recovery shuffles only 1 when Ringside has 1 card');

  engine.toggleSuperstarAbilitySelection(0, rs1.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, rs1.instanceId);

  assert(!player.ringside.some((c) => c.instanceId === rs1.instanceId), 'Only Ringside card is shuffled');
  assert(player.arsenal.length === arsenalBefore, 'Recovery shuffles 1 then draws 1 (net 0 Arsenal change)');
  assert(player.hand.length === 1, 'Recovery draws 1 after shuffling 1 Ringside card');
  assert(!engine.cardEffectFlow, 'Recovery completes after shuffling 1');
}

async function testRecoveryEmptyRingsideSkipsShuffle() {
  const RawDeal = loadRawDeal();
  const { engine, player, recovery } = await createRecoveryTest(RawDeal, {
    ringsideCards: [],
    arsenalCount: 2,
  });

  const arsenalBefore = player.arsenal.length;

  await engine.playCard(0, recovery.instanceId, 'action');

  assert(!engine.cardEffectFlow, 'Recovery skips shuffle prompt when Ringside is empty');
  assert(player.arsenal.length === arsenalBefore - 1, 'Recovery draws 1 when Ringside is empty');
  assert(player.hand.length === 1, 'Recovery draw puts 1 card in hand when Ringside is empty');
}

async function createPuppiesTest(RawDeal, { ringsideCards = [], arsenalCount = 8 } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const puppies = cloneCard(RawDeal, 'puppies-puppies', 'puppies-test');

  player.hand = [puppies];
  player.ringside = [...ringsideCards];
  player.arsenal = [];
  for (let i = 0; i < arsenalCount; i++) {
    player.arsenal.push(cloneCard(RawDeal, 'chop', `puppies-arsenal-${i}`));
  }
  player.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, puppies };
}

async function testPuppiesOpensUpToFiveShuffleModal() {
  const RawDeal = loadRawDeal();
  const ringside = [];
  for (let i = 0; i < 6; i++) {
    ringside.push(cloneCard(RawDeal, 'punch', `puppies-rs-${i}`));
  }
  const { engine, player, puppies } = await createPuppiesTest(RawDeal, { ringsideCards: ringside });

  await engine.playCard(0, puppies.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'shuffleRingsideIntoArsenal',
    'Puppies opens Ringside shuffle modal'
  );
  assert(engine.cardEffectFlow.exact === false, 'Puppies uses up-to shuffle mode');
  assert(engine.cardEffectFlow.maxSelect === 5, 'Puppies caps selection at 5 cards');

  const prompt = engine._publicSelectionPrompt(0);
  assert(prompt?.mode === 'ringsideModal', 'Puppies uses Ringside modal');
  assert(prompt.upTo === true, 'Puppies prompt is up-to mode');
  assert(prompt.maxSelect === 5, 'Puppies prompt allows up to 5 cards');
}

async function testPuppiesShuffleThreeThenDrawTwo() {
  const RawDeal = loadRawDeal();
  const rs1 = cloneCard(RawDeal, 'punch', 'puppies-rs-a');
  const rs2 = cloneCard(RawDeal, 'kick', 'puppies-rs-b');
  const rs3 = cloneCard(RawDeal, 'chop', 'puppies-rs-c');
  const rs4 = cloneCard(RawDeal, 'elbow', 'puppies-rs-d');
  const { engine, player, puppies } = await createPuppiesTest(RawDeal, {
    ringsideCards: [rs1, rs2, rs3, rs4],
    arsenalCount: 6,
  });

  const arsenalBefore = player.arsenal.length;
  const handBefore = player.hand.length;

  await engine.playCard(0, puppies.instanceId, 'action');

  engine.toggleSuperstarAbilitySelection(0, rs1.instanceId);
  engine.toggleSuperstarAbilitySelection(0, rs2.instanceId);
  engine.toggleSuperstarAbilitySelection(0, rs3.instanceId);
  await engine.confirmSuperstarAbilityPrompt(0, [rs1.instanceId, rs2.instanceId, rs3.instanceId]);

  assert(
    player.arsenal.length === arsenalBefore + 3 - 2,
    'Puppies shuffles 3 into Arsenal then draws 2 (net +1)'
  );
  assert(
    !player.ringside.some((c) => ['puppies-rs-a', 'puppies-rs-b', 'puppies-rs-c'].includes(c.instanceId)),
    'Shuffled cards leave Ringside'
  );
  assert(
    player.ringside.some((c) => c.instanceId === 'puppies-rs-d'),
    'Unselected Ringside cards remain'
  );
  assert(
    player.hand.length === handBefore - 1 + 2,
    'Puppies draws 2 after shuffling (-played card, +2 draw)'
  );
  assert(!engine.cardEffectFlow, 'Puppies effect completes');
}

async function testPuppiesConfirmZeroShuffleStillDrawsTwo() {
  const RawDeal = loadRawDeal();
  const rs1 = cloneCard(RawDeal, 'punch', 'puppies-rs-only');
  const { engine, player, puppies } = await createPuppiesTest(RawDeal, {
    ringsideCards: [rs1],
    arsenalCount: 4,
  });

  const arsenalBefore = player.arsenal.length;

  await engine.playCard(0, puppies.instanceId, 'action');
  await engine.confirmSuperstarAbilityPrompt(0, []);

  assert(
    player.ringside.some((c) => c.instanceId === 'puppies-rs-only'),
    'Puppies can skip shuffling and leave Ringside unchanged'
  );
  assert(
    player.arsenal.length === arsenalBefore - 2,
    'Puppies draws 2 from Arsenal when 0 cards shuffled'
  );
  assert(player.hand.length === 2, 'Puppies puts 2 drawn cards in hand');
  assert(!engine.cardEffectFlow, 'Puppies completes after confirming 0 shuffle');
}

async function testPuppiesEmptyRingsideSkipsShuffle() {
  const RawDeal = loadRawDeal();
  const { engine, player, puppies } = await createPuppiesTest(RawDeal, {
    ringsideCards: [],
    arsenalCount: 4,
  });

  const arsenalBefore = player.arsenal.length;

  await engine.playCard(0, puppies.instanceId, 'action');

  assert(!engine.cardEffectFlow, 'Puppies skips shuffle prompt when Ringside is empty');
  assert(
    player.arsenal.length === arsenalBefore - 2,
    'Puppies draws 2 from Arsenal when Ringside is empty'
  );
  assert(player.hand.length === 2, 'Puppies puts 2 drawn cards in hand when Ringside empty');
}

async function createSpitAtOpponentTest(RawDeal, { opponentHandCount = 5 } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const spit = cloneCard(RawDeal, 'spit-at-opponent', 'spit-test');

  player.hand = [spit, cloneCard(RawDeal, 'punch', 'spit-self-discard')];
  player.fortitude = 6;
  opponent.hand = [];
  for (let i = 0; i < opponentHandCount; i++) {
    opponent.hand.push(cloneCard(RawDeal, 'kick', `spit-opp-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, opponent, spit };
}

async function testSpitAtOpponentDiscardFour() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, spit } = await createSpitAtOpponentTest(RawDeal, {
    opponentHandCount: 5,
  });
  const selfDiscard = player.hand.find((c) => c.instanceId === 'spit-self-discard');

  await engine.playCard(0, spit.instanceId, 'action');

  assert(
    engine.cardEffectFlow?.type === 'discardFromHand',
    'Spit At Opponent prompts you to discard 1 first'
  );

  await engine.selectForCardEffect(0, selfDiscard.instanceId);

  assert(
    player.ringside.some((c) => c.instanceId === selfDiscard.instanceId),
    'Spit At Opponent discards your chosen card to Ringside'
  );
  assert(opponent.hand.length === 1, 'Spit At Opponent makes opponent discard 4 cards');
  assert(
    opponent.ringside.length === 4,
    'Opponent discarded cards go to Ringside'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === spit.instanceId),
    'Spit At Opponent is in Ring actions'
  );
  assert(!engine.cardEffectFlow, 'Spit At Opponent effect completes');
}

async function testSpitAtOpponentDiscardsWholeHandWhenThreeOrLess() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, spit } = await createSpitAtOpponentTest(RawDeal, {
    opponentHandCount: 3,
  });
  const selfDiscard = player.hand.find((c) => c.instanceId === 'spit-self-discard');
  const opponentIds = opponent.hand.map((c) => c.instanceId);

  await engine.playCard(0, spit.instanceId, 'action');
  await engine.selectForCardEffect(0, selfDiscard.instanceId);

  assert(opponent.hand.length === 0, 'Spit At Opponent discards opponent whole hand when 3 or fewer');
  assert(
    opponentIds.every((id) => opponent.ringside.some((c) => c.instanceId === id)),
    'All opponent hand cards go to Ringside when hand is 3 or fewer'
  );
  assert(player.hand.length === 0, 'You have no cards left after playing and discarding');
}

async function testSpitAtOpponentPlayableWithEmptyOpponentHand() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, spit } = await createSpitAtOpponentTest(RawDeal, {
    opponentHandCount: 0,
  });
  const selfDiscard = player.hand.find((c) => c.instanceId === 'spit-self-discard');

  await engine.playCard(0, spit.instanceId, 'action');
  await engine.selectForCardEffect(0, selfDiscard.instanceId);

  assert(opponent.ringside.length === 0, 'No opponent discard when hand is empty');
  assert(
    player.ring.actions.some((c) => c.instanceId === spit.instanceId),
    'Spit At Opponent still resolves when opponent hand is empty'
  );
}

async function createComebackTest(RawDeal, { engineMode = 'goldfish', extraHandCount = 3 } = {}) {
  const engine = new RawDeal.GameEngine({ engineMode });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const comeback = cloneCard(RawDeal, 'comeback', 'comeback-test');

  player.hand = [comeback];
  for (let i = 0; i < extraHandCount; i++) {
    player.hand.push(cloneCard(RawDeal, 'chop', `comeback-discard-${i}`));
  }
  player.ring = { maneuvers: [], reversals: [], actions: [] };
  opponent.ring = { maneuvers: [], reversals: [], actions: [] };

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  return { engine, player, opponent, comeback };
}

async function discardComebackHandCards(engine, player) {
  const toDiscard = player.hand.filter((c) => c.id !== 'comeback').slice(0, 3);
  for (const card of toDiscard) {
    await engine.selectForCardEffect(0, card.instanceId);
  }
  return toDiscard;
}

async function testComebackNotPlayableWithoutFourCards() {
  const RawDeal = loadRawDeal();
  const { engine, comeback } = await createComebackTest(RawDeal, { extraHandCount: 2 });

  assert(
    !engine.canPlayCard(0, comeback.instanceId, 'action'),
    'Comeback not playable without 4 cards in hand'
  );
}

async function testComebackDiscardsThree() {
  const RawDeal = loadRawDeal();
  const { engine, player, comeback } = await createComebackTest(RawDeal);
  const ringsideBefore = player.ringside.length;

  await engine.playCard(0, comeback.instanceId, 'action');
  assert(
    engine.cardEffectFlow?.type === 'discardFromHand',
    'Comeback prompts discard 3 from hand'
  );

  const discarded = await discardComebackHandCards(engine, player);
  assert(discarded.length === 3, 'Comeback discards 3 cards');
  assert(
    discarded.every((c) => player.ringside.some((r) => r.instanceId === c.instanceId)),
    'Comeback discarded cards go to Ringside'
  );
  assert(
    player.ringside.length === ringsideBefore + 3,
    'Comeback adds 3 cards to Ringside'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === comeback.instanceId),
    'Comeback is in Ring actions'
  );
  assert(!engine.cardEffectFlow, 'Comeback effect completes when Fortitude is equal');
}

async function testComebackEqualFortitudeNoRemoval() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, comeback } = await createComebackTest(RawDeal);

  const playerPunch = cloneCard(RawDeal, 'punch', 'cb-player-punch');
  const opponentPunch = cloneCard(RawDeal, 'punch', 'cb-opp-punch');
  player.ring.maneuvers.push(playerPunch);
  opponent.ring.maneuvers.push(opponentPunch);
  engine._syncFortitude(player);
  engine._syncFortitude(opponent);

  const playerRingBefore = [...player.ring.maneuvers];
  const opponentRingBefore = [...opponent.ring.maneuvers];

  await engine.playCard(0, comeback.instanceId, 'action');
  await discardComebackHandCards(engine, player);

  assert(player.fortitude === 3 && opponent.fortitude === 3, 'Comeback equal Fortitude unchanged');
  assert(
    player.ring.maneuvers.length === playerRingBefore.length,
    'Comeback does not remove cards when Fortitude is equal (player)'
  );
  assert(
    opponent.ring.maneuvers.length === opponentRingBefore.length,
    'Comeback does not remove cards when Fortitude is equal (opponent)'
  );
}

async function testComebackGoldfishOpponentHigherRemovesHighestDamage() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, comeback } = await createComebackTest(RawDeal);

  const clothesline = cloneCard(RawDeal, 'clothesline', 'cb-opp-clothesline');
  const punch = cloneCard(RawDeal, 'punch', 'cb-opp-punch');
  opponent.ring.maneuvers.push(punch, clothesline);
  engine._syncFortitude(opponent);
  engine._syncFortitude(player);

  assert(opponent.fortitude === 10 && player.fortitude === 0, 'Opponent starts with higher Fortitude');

  await engine.playCard(0, comeback.instanceId, 'action');
  await discardComebackHandCards(engine, player);

  assert(
    opponent.ringside.some((c) => c.instanceId === clothesline.instanceId),
    'Comeback removes highest-D maneuver first (Clothesline 7D)'
  );
  assert(
    opponent.ringside.some((c) => c.instanceId === punch.instanceId),
    'Comeback removes remaining maneuvers until Fortitude is balanced (Punch 3D)'
  );
  assert(opponent.ring.maneuvers.length === 0, 'Opponent Ring maneuvers cleared');
  assert(opponent.fortitude === 0, 'Opponent Fortitude balanced to player Fortitude');
}

async function testComebackIgnoresRingActions() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, comeback } = await createComebackTest(RawDeal);

  const punch = cloneCard(RawDeal, 'punch', 'cb-opp-punch-only');
  const recovery = cloneCard(RawDeal, 'recovery', 'cb-opp-recovery');
  opponent.ring.maneuvers.push(punch);
  opponent.ring.actions.push(recovery);
  engine._syncFortitude(opponent);
  engine._syncFortitude(player);

  await engine.playCard(0, comeback.instanceId, 'action');
  await discardComebackHandCards(engine, player);

  assert(
    opponent.ring.actions.some((c) => c.instanceId === recovery.instanceId),
    'Comeback does not remove action cards from Ring'
  );
  assert(
    opponent.ringside.some((c) => c.instanceId === punch.instanceId),
    'Comeback still removes maneuver cards from Ring'
  );
  assert(opponent.fortitude === 0, 'Comeback balances Fortitude using maneuvers only');
}

async function testComebackMultiplayerManualRemoval() {
  const RawDeal = loadRawDeal();
  const { engine, player, opponent, comeback } = await createComebackTest(RawDeal, {
    engineMode: 'multiplayer',
  });

  const clothesline = cloneCard(RawDeal, 'clothesline', 'cb-player-clothesline');
  const punch = cloneCard(RawDeal, 'punch', 'cb-player-punch');
  player.ring.maneuvers.push(punch, clothesline);
  engine._syncFortitude(player);
  engine._syncFortitude(opponent);

  await engine.playCard(0, comeback.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  await discardComebackHandCards(engine, player);

  assert(
    engine.cardEffectFlow?.type === 'balanceFortitudeRingRemoval',
    'Comeback opens Ring removal prompt for higher-Fortitude player'
  );

  assert(
    engine.toggleRemoveOpponentRingSelect(0, clothesline.instanceId, 'maneuvers'),
    'Can select highest-D maneuver to remove'
  );
  await engine.confirmRemoveOpponentRingCard(0);

  assert(player.fortitude === 3, 'Fortitude drops after first removal');
  assert(
    engine.cardEffectFlow?.type === 'balanceFortitudeRingRemoval',
    'Comeback prompts another removal while still ahead'
  );

  assert(
    engine.toggleRemoveOpponentRingSelect(0, punch.instanceId, 'maneuvers'),
    'Can select remaining maneuver'
  );
  await engine.confirmRemoveOpponentRingCard(0);

  assert(player.fortitude === 0, 'Fortitude balanced after manual removals');
  assert(!engine.cardEffectFlow, 'Comeback effect completes after balancing');
}

async function testEgoBoostNextCardMinusFiveF() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const egoBoost = cloneCard(RawDeal, 'ego-boost', 'eb-discount');
  const snapMare = cloneCard(RawDeal, 'snap-mare', 'eb-snap-mare');

  player.hand = [egoBoost, snapMare];
  player.fortitude = 0;
  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  assert(
    !engine.canPlayCard(0, snapMare.instanceId, 'maneuver'),
    'Snap Mare not playable at 0F without Ego Boost discount (3F cost)'
  );

  await engine.playCard(0, egoBoost.instanceId, 'action');
  assert(
    player.turnState?.nextCardFortitudeDiscount === 5,
    'Ego Boost sets -5F on next card played'
  );
  assert(
    engine.canPlayCard(0, snapMare.instanceId, 'maneuver'),
    'Snap Mare playable at 0F with -5F discount (3F cost)'
  );

  await engine.playCard(0, snapMare.instanceId, 'maneuver');
  assert(
    player.turnState?.nextCardFortitudeDiscount === 0,
    'Ego Boost -5F discount consumed after next card'
  );
}

async function testEgoBoostNextCardAppliesToAction() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const egoBoost = cloneCard(RawDeal, 'ego-boost', 'eb-action');
  const flash = cloneCard(RawDeal, 'flash-in-the-pan', 'eb-flash');

  player.hand = [egoBoost, flash];
  player.fortitude = 1;
  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, egoBoost.instanceId, 'action');
  assert(
    engine.canPlayCard(0, flash.instanceId, 'action'),
    'Flash in the Pan playable at 1F with -5F discount (6F cost)'
  );

  await engine.playCard(0, flash.instanceId, 'action');
  assert(
    player.turnState?.nextCardFortitudeDiscount === 0,
    'Ego Boost -5F consumed after next action'
  );
}

async function testEgoBoostReactionReplacesOneOfFour() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const spit = cloneCard(RawDeal, 'spit-at-opponent', 'eb-spit');
  const egoBoost = cloneCard(RawDeal, 'ego-boost', 'eb-react');
  const selfDiscard = cloneCard(RawDeal, 'chop', 'eb-self-discard');

  attacker.hand = [spit, selfDiscard];
  attacker.fortitude = 6;
  defender.hand = [egoBoost];
  for (let i = 0; i < 5; i++) {
    defender.hand.push(cloneCard(RawDeal, 'kick', `eb-opp-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, spit.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  await engine.selectForCardEffect(0, selfDiscard.instanceId);

  assert(
    engine.cardEffectFlow?.choiceId === 'egoBoostOrDiscard',
    'Spit At Opponent offers Ego Boost reaction to defender'
  );

  await engine.selectChoice(1, 'egoBoost');
  assert(
    defender.ringside.some((c) => c.id === 'ego-boost'),
    'Ego Boost discarded to Ringside via reaction'
  );
  assert(
    engine.cardEffectFlow?.type === 'opponentDiscardFromHand',
    'Spit At Opponent discard prompt before Ego Boost draw'
  );

  const toDiscard = defender.hand.slice(0, 3);
  for (const card of toDiscard) {
    await engine.selectForCardEffect(1, card.instanceId);
  }

  assert(
    engine.cardEffectFlow?.type === 'drawCountChoice',
    'Ego Boost draw opens after forced discards resolve'
  );

  engine.adjustDrawCount(1, 0);
  await engine.confirmDrawCount(1);

  assert(defender.hand.length === 2, 'Defender discards 3 more after Ego Boost (6 - 4 total)');
}

async function testEgoBoostReactionDrawUpToTwo() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const heelKick = cloneCard(RawDeal, 'spinning-heel-kick', 'eb-shk');
  const egoBoost = cloneCard(RawDeal, 'ego-boost', 'eb-draw2');

  attacker.hand = [heelKick];
  attacker.fortitude = 6;
  defender.hand = [egoBoost, cloneCard(RawDeal, 'chop', 'eb-filler')];
  defender.arsenal = [
    cloneCard(RawDeal, 'punch', 'eb-arsenal-1'),
    cloneCard(RawDeal, 'kick', 'eb-arsenal-2'),
  ];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, heelKick.instanceId, 'maneuver');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  assert(
    engine.cardEffectFlow?.choiceId === 'egoBoostOrDiscard',
    'Spinning Heel Kick offers Ego Boost before opponent discard'
  );

  await engine.selectChoice(1, 'egoBoost');
  engine.adjustDrawCount(1, 2);
  const handBefore = defender.hand.length;
  const arsenalBefore = defender.arsenal.length;
  await engine.confirmDrawCount(1);

  assert(
    defender.hand.length === handBefore + 2,
    'Ego Boost reaction draws 2 after discarding Ego Boost'
  );
  assert(defender.arsenal.length === arsenalBefore - 2, 'Drew 2 from Arsenal');
}

async function testEgoBoostReactionFilterDiscard() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const flash = cloneCard(RawDeal, 'flash-in-the-pan', 'eb-flash-filter');
  const egoBoost = cloneCard(RawDeal, 'ego-boost', 'eb-filter');
  const heel1 = cloneCard(RawDeal, 'chair-shot', 'eb-heel-1');
  const heel2 = cloneCard(RawDeal, 'chair-shot', 'eb-heel-2');
  heel1.alignment = 'heel';
  heel2.alignment = 'heel';

  attacker.hand = [flash];
  attacker.fortitude = 6;
  defender.hand = [egoBoost, heel1, heel2];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, flash.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  if (engine.handRevealFlow) {
    await engine.dismissHandReveal(0);
  }

  assert(
    engine.cardEffectFlow?.choiceId === 'egoBoostOrDiscard',
    'Flash in the Pan offers Ego Boost before HEEL discard'
  );

  await engine.selectChoice(1, 'egoBoost');
  assert(
    defender.ringside.some((c) => c.id === 'ego-boost'),
    'Ego Boost used before filter discard'
  );
  assert(
    engine.cardEffectFlow?.type === 'opponentDiscardFromHand',
    'HEEL discard prompt before Ego Boost draw'
  );

  const heel = defender.hand.find((c) => c.alignment === 'heel');
  if (heel) await engine.selectForCardEffect(1, heel.instanceId);

  assert(
    engine.cardEffectFlow?.type === 'drawCountChoice',
    'Ego Boost draw opens after filter discard resolves'
  );

  engine.adjustDrawCount(1, 0);
  await engine.confirmDrawCount(1);

  assert(
    defender.hand.length === 1,
    'Only 1 HEEL card remains after Ego Boost replaces one filter discard'
  );
}

async function testEgoBoostTwoCopiesChainOnSpit() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const spit = cloneCard(RawDeal, 'spit-at-opponent', 'eb-spit-2x');
  const egoBoost1 = cloneCard(RawDeal, 'ego-boost', 'eb-react-1');
  const egoBoost2 = cloneCard(RawDeal, 'ego-boost', 'eb-react-2');
  const selfDiscard = cloneCard(RawDeal, 'chop', 'eb-self-discard-2x');

  attacker.hand = [spit, selfDiscard];
  attacker.fortitude = 6;
  defender.hand = [egoBoost1, egoBoost2];
  for (let i = 0; i < 4; i++) {
    defender.hand.push(cloneCard(RawDeal, 'kick', `eb-opp-2x-${i}`));
  }
  defender.arsenal = [
    cloneCard(RawDeal, 'punch', 'eb-ars-2x-1'),
    cloneCard(RawDeal, 'punch', 'eb-ars-2x-2'),
    cloneCard(RawDeal, 'punch', 'eb-ars-2x-3'),
    cloneCard(RawDeal, 'punch', 'eb-ars-2x-4'),
  ];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, spit.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  await engine.selectForCardEffect(0, selfDiscard.instanceId);

  await engine.selectChoice(1, 'egoBoost');
  assert(
    engine.cardEffectFlow?.choiceId === 'egoBoostOrDiscard',
    'Second Ego Boost offered after first is used'
  );

  await engine.selectChoice(1, 'egoBoost');
  assert(
    engine.cardEffectFlow?.type === 'opponentDiscardFromHand',
    'Normal discard prompt after both Ego Boosts consumed'
  );

  const toDiscard = defender.hand.slice(0, 2);
  for (const card of toDiscard) {
    await engine.selectForCardEffect(1, card.instanceId);
  }

  assert(
    engine.cardEffectFlow?.type === 'drawCountChoice',
    'First Ego Boost draw after all forced discards'
  );

  const handBeforeDraws = defender.hand.length;
  const arsenalBeforeDraws = defender.arsenal.length;
  engine.adjustDrawCount(1, 2);
  await engine.confirmDrawCount(1);
  assert(
    engine.cardEffectFlow?.type === 'drawCountChoice',
    'Second Ego Boost draw chains after first'
  );

  engine.adjustDrawCount(1, 2);
  await engine.confirmDrawCount(1);

  assert(
    defender.hand.length === handBeforeDraws + 4,
    'Two Ego Boosts draw up to 4 cards total after discards'
  );
  assert(
    defender.arsenal.length === arsenalBeforeDraws - 4,
    'Drew 4 from Arsenal across two Ego Boost reactions'
  );
  assert(
    defender.ringside.filter((c) => c.id === 'ego-boost').length === 2,
    'Both Ego Boosts discarded to Ringside'
  );
}

async function testEgoBoostDiscardNormallySkipsSecondOffer() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const spit = cloneCard(RawDeal, 'spit-at-opponent', 'eb-spit-skip');
  const egoBoost1 = cloneCard(RawDeal, 'ego-boost', 'eb-skip-1');
  const egoBoost2 = cloneCard(RawDeal, 'ego-boost', 'eb-skip-2');
  const selfDiscard = cloneCard(RawDeal, 'chop', 'eb-self-discard-skip');

  attacker.hand = [spit, selfDiscard];
  attacker.fortitude = 6;
  defender.hand = [egoBoost1, egoBoost2];
  for (let i = 0; i < 5; i++) {
    defender.hand.push(cloneCard(RawDeal, 'kick', `eb-opp-skip-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, spit.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  await engine.selectForCardEffect(0, selfDiscard.instanceId);

  await engine.selectChoice(1, 'egoBoost');
  assert(
    engine.cardEffectFlow?.choiceId === 'egoBoostOrDiscard',
    'Second Ego Boost offer after using first'
  );

  await engine.selectChoice(1, 'discardNormally');
  assert(
    engine.cardEffectFlow?.type === 'opponentDiscardFromHand',
    'Discard normally completes remaining forced discards'
  );
  assert(
    engine.cardEffectFlow?.count === 3,
    'Discard normally covers 3 remaining forced discards'
  );

  const toDiscard = defender.hand.filter((c) => c.id !== 'ego-boost').slice(0, 3);
  for (const card of toDiscard) {
    await engine.selectForCardEffect(1, card.instanceId);
  }

  assert(
    engine.cardEffectFlow?.type === 'drawCountChoice',
    'Only one Ego Boost draw after discard normally'
  );

  engine.adjustDrawCount(1, 0);
  await engine.confirmDrawCount(1);

  assert(
    defender.ringside.filter((c) => c.id === 'ego-boost').length === 1,
    'Only first Ego Boost was consumed'
  );
  assert(defender.hand.some((c) => c.id === 'ego-boost'), 'Second Ego Boost remains in hand');
  assert(!engine.cardEffectFlow, 'Ego Boost reaction flow completes after discard normally');
}

async function testEgoBoostNotInRingForReaction() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const heelKick = cloneCard(RawDeal, 'spinning-heel-kick', 'eb-no-ring');
  const egoBoost = cloneCard(RawDeal, 'ego-boost', 'eb-in-ring');

  attacker.hand = [heelKick];
  attacker.fortitude = 6;
  defender.hand = [cloneCard(RawDeal, 'chop', 'eb-only')];
  defender.ring.actions.push(egoBoost);

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, heelKick.instanceId, 'maneuver');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  assert(
    engine.cardEffectFlow?.type === 'opponentDiscardFromHand',
    'No Ego Boost reaction when Ego Boost is only in Ring'
  );
  assert(
    engine.cardEffectFlow?.choiceId !== 'egoBoostOrDiscard',
    'Ego Boost choice not offered without Ego Boost in hand'
  );
}

async function playKickSuccessfully(engine, RawDeal, instanceId = 'stag-kick') {
  const punch = cloneCard(RawDeal, 'punch', instanceId);
  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand.push(punch);
  player.fortitude = Math.max(player.fortitude, 5);
  opponent.arsenal = opponent.arsenal.filter((c) => !c.reverses?.length);
  for (let i = opponent.arsenal.length; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `${instanceId}-safe-ars-${i}`));
  }
  await engine.playCard(0, punch.instanceId, 'maneuver');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  return punch;
}

async function playStaggerAfterKick(engine, RawDeal, staggerInstanceId = 'stag-stagger') {
  const stagger = cloneCard(RawDeal, 'stagger', staggerInstanceId);
  const player = engine.players[0];
  player.hand.push(stagger);
  player.fortitude = Math.max(player.fortitude, 5);
  await engine.playCard(0, stagger.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  return stagger;
}

async function testStaggerNotPlayableWithoutManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-no-maneuver');

  player.hand = [stagger];
  player.fortitude = 5;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  assert(
    !engine.canPlayCard(0, stagger.instanceId, 'action'),
    'Stagger not playable without a successful maneuver this turn'
  );
}

async function testStaggerNotPlayableAfterHandReversal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const punch = cloneCard(RawDeal, 'punch', 'stag-punch-rev');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'stag-elbow');
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-after-rev');

  attacker.hand = [punch, stagger];
  attacker.fortitude = 10;
  defender.hand = [elbow];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `stag-rev-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, punch.instanceId, 'maneuver');
  await engine.playReversalFromHand(1, elbow.instanceId);

  assert(
    !attacker.turnState?.canPlayAfterSuccessfulManeuver,
    'Hand-reversed maneuver does not enable Stagger'
  );
  assert(
    !engine.canPlayCard(0, stagger.instanceId, 'action'),
    'Stagger not playable after maneuver reversed from hand'
  );
}

async function testStaggerPlayableAfterSuccessfulManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-playable');
  const opponent = engine.players[1];
  opponent.hand = [];
  for (let i = 0; i < 5; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `stag-opp-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'stag-kick-ok');

  player.hand.push(stagger);
  player.fortitude = 5;

  assert(
    engine.canPlayCard(0, stagger.instanceId, 'action'),
    'Stagger playable after successful maneuver'
  );

  await engine.playCard(0, stagger.instanceId, 'action');

  assert(
    player.turnState?.nextManeuverUnreversiblePending === true,
    'Stagger sets unreversible pending on next card played'
  );
  assert(
    player.turnState?.nextManeuverUnreversibleMaxDamage === 7,
    'Stagger sets 7D cap on next card played'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === stagger.instanceId),
    'Stagger is in Ring actions'
  );
}

async function testStaggerProtectsLowDamageManeuverFromHand() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-protect-hand');
  const punch = cloneCard(RawDeal, 'punch', 'stag-punch-hand');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'stag-elbow-hand');

  attacker.fortitude = 15;
  defender.hand = [elbow];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 5; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `stag-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'stag-kick-hand');
  attacker.hand.push(punch);
  await playStaggerAfterKick(engine, RawDeal, 'stag-protect-hand');
  await engine.playCard(0, punch.instanceId, 'maneuver');

  assert(
    !engine.reversalWindow,
    'Stagger skips reversal priority for protected low-damage maneuver'
  );
  assert(
    !engine.canPlayReversalFromHand(1, elbow.instanceId),
    'Elbow cannot reverse protected Punch after Stagger'
  );
}

async function testStaggerProtectsLowDamageManeuverFromArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-protect-ars');
  const punch = cloneCard(RawDeal, 'punch', 'stag-punch-ars');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'stag-elbow-ars');

  attacker.fortitude = 15;
  defender.arsenal = [
    cloneCard(RawDeal, 'chop', 'stag-chop-1'),
    cloneCard(RawDeal, 'chop', 'stag-chop-2'),
    cloneCard(RawDeal, 'chop', 'stag-chop-3'),
  ];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'stag-kick-ars');
  attacker.hand.push(punch);
  await playStaggerAfterKick(engine, RawDeal, 'stag-protect-ars');
  defender.arsenal.push(elbow);
  await engine.playCard(0, punch.instanceId, 'maneuver');

  const lastDamage = engine.damageLog[engine.damageLog.length - 1];
  assert(lastDamage?.result === 'hit', 'Arsenal Elbow does not reverse Punch protected by Stagger');
  assert(lastDamage?.cardsOverturned === 3, 'Protected Punch overturns 3 Arsenal cards');
}

async function testStaggerDoesNotProtectHighDamageManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const bulldog = cloneCard(RawDeal, 'bulldog', 'stag-bulldog');
  const escapeMove = cloneCard(RawDeal, 'escape-move', 'stag-escape-high');

  attacker.fortitude = 20;
  attacker.ring.maneuvers.push(cloneCard(RawDeal, 'kick', 'stag-preload-f'));
  engine._syncFortitude(attacker);
  defender.hand = [escapeMove];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `stag-high-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'stag-kick-high');
  attacker.hand.push(bulldog);
  await playStaggerAfterKick(engine, RawDeal, 'stag-high-d');
  await engine.playCard(0, bulldog.instanceId, 'maneuver');

  assert(
    engine.reversalWindow?.kind === 'maneuver',
    'Stagger does not protect Bulldog 8D — reversal window opens'
  );
  assert(
    engine.canPlayReversalFromHand(1, escapeMove.instanceId),
    'Escape Move can reverse Bulldog 8D when Stagger protection does not apply'
  );
}

async function testStaggerProtectsExactly7D() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-7d');
  const clothesline = cloneCard(RawDeal, 'clothesline', 'stag-clothesline');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'stag-elbow-7d');

  attacker.fortitude = 20;
  defender.hand = [elbow];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `stag-7d-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'stag-kick-7d');
  attacker.hand.push(clothesline);
  await playStaggerAfterKick(engine, RawDeal, 'stag-7d');
  await engine.playCard(0, clothesline.instanceId, 'maneuver');

  assert(
    !engine.reversalWindow,
    'Stagger protects exactly 7D Clothesline from hand reversal'
  );
}

function stripReversalsFromOpponentArsenal(opponent, RawDeal, prefix) {
  opponent.arsenal = opponent.arsenal.filter((c) => !c.reverses?.length);
  for (let i = opponent.arsenal.length; i < 8; i++) {
    opponent.arsenal.push(cloneCard(RawDeal, 'chop', `${prefix}-safe-ars-${i}`));
  }
}

async function playSubmissionSuccessfully(engine, RawDeal, instanceId = 'mh-chin-lock') {
  const chinLock = cloneCard(RawDeal, 'chin-lock', instanceId);
  const player = engine.players[0];
  const opponent = engine.players[1];
  player.hand.push(chinLock);
  player.fortitude = Math.max(player.fortitude, 5);
  stripReversalsFromOpponentArsenal(opponent, RawDeal, instanceId);
  await engine.playCard(0, chinLock.instanceId, 'maneuver');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  return chinLock;
}

async function passReversalWindowIfOpen(engine, RawDeal, defenderIndex = 1) {
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(defenderIndex);
  }
}

async function testMaintainHoldNotPlayableWithoutSubmission() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-no-sub');
  player.hand = [mh];
  player.fortitude = 15;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  assert(
    !engine.canPlayCard(0, mh.instanceId, 'action'),
    'Maintain Hold not playable without a successful Submission'
  );
}

async function testMaintainHoldNotPlayableAfterHandReversal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const chinLock = cloneCard(RawDeal, 'chin-lock', 'mh-chin-rev');
  const breakHold = cloneCard(RawDeal, 'break-the-hold', 'mh-break');
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-after-rev');

  attacker.hand = [chinLock, mh];
  attacker.fortitude = 15;
  defender.hand = [breakHold];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `mh-rev-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, chinLock.instanceId, 'maneuver');
  await engine.playReversalFromHand(1, breakHold.instanceId);

  assert(
    !attacker.turnState?.canPlayAfterSuccessfulSubmission,
    'Hand-reversed Submission does not enable Maintain Hold'
  );
  assert(
    !engine.canPlayCard(0, mh.instanceId, 'action'),
    'Maintain Hold not playable after Submission reversed from hand'
  );
}

async function testMaintainHoldPlayableAfterSubmission() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-playable');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playSubmissionSuccessfully(engine, RawDeal, 'mh-chin-ok');

  player.hand.push(mh);
  player.fortitude = 15;

  assert(
    engine.canPlayCard(0, mh.instanceId, 'action'),
    'Maintain Hold playable after successful Submission'
  );
}

async function testMaintainHoldNotPlayableAfterStrike() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-no-strike');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'mh-kick-only');

  player.hand.push(mh);
  player.fortitude = 15;

  assert(
    !engine.canPlayCard(0, mh.instanceId, 'action'),
    'Maintain Hold not playable after Strike maneuver'
  );
}

async function testMaintainHoldEndsTurnAndLocks() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-lock');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playSubmissionSuccessfully(engine, RawDeal, 'mh-chin-lock');
  player.hand.push(mh);
  player.fortitude = 15;

  const turnBefore = engine.stateMachine.turnNumber;
  await engine.playCard(0, mh.instanceId, 'action');
  await passReversalWindowIfOpen(engine, RawDeal);

  assert(
    player.ring.actions.some((c) => c.instanceId === mh.instanceId),
    'Maintain Hold is in Ring actions'
  );
  assert(
    engine.maintainedSubmissionFlow?.active && engine.maintainedSubmissionFlow?.abilityActive,
    'Maintain Hold flow is active'
  );
  assert(
    engine.stateMachine.activePlayer === 1,
    'Maintain Hold ends the turn'
  );
  assert(
    engine.stateMachine.turnNumber === turnBefore,
    'Maintain Hold ends the turn without advancing the turn counter yet'
  );
  assert(
    !engine.canPlayCard(0, mh.instanceId, 'action') &&
      !engine.canPlayCard(1, mh.instanceId, 'action'),
    'Both players locked from playing cards while hold is maintained'
  );
}

async function testMaintainHoldReappliesOnMaintainerTurn() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-reapply');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  const chinLock = await playSubmissionSuccessfully(engine, RawDeal, 'mh-chin-reapply');
  player.hand.push(mh);
  player.fortitude = 15;

  await engine.playCard(0, mh.instanceId, 'action');
  await passReversalWindowIfOpen(engine, RawDeal);

  const reappliedLogs = engine.actionLog.filter((e) =>
    e.message.includes('applies again')
  );
  const chinDamageEntries = engine.damageLog.filter((e) => e.card === chinLock.name);

  assert(reappliedLogs.length >= 1, 'Maintain Hold re-applies Submission on maintainer turn');
  assert(chinDamageEntries.length >= 2, 'Maintained Submission damage applied more than once');
}

async function testMaintainHoldHandReversalDisables() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-hand-rev');
  const breakHold = cloneCard(RawDeal, 'break-the-hold', 'mh-break-maint');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  const chinLock = await playSubmissionSuccessfully(engine, RawDeal, 'mh-chin-maint');
  attacker.hand.push(mh);
  attacker.fortitude = 15;
  defender.hand = [breakHold];
  defender.fortitude = 10;

  await engine.playCard(0, mh.instanceId, 'action');
  await passReversalWindowIfOpen(engine, RawDeal);

  await engine.endTurn(1);

  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY &&
      engine.reversalWindow?.kind === 'maintained',
    'Maintained Submission opens reversal window on maintainer turn'
  );

  await engine.playReversalFromHand(1, breakHold.instanceId);

  assert(
    !engine.maintainedSubmissionFlow?.abilityActive,
    'Maintain Hold ability disabled after hand reversal'
  );
  assert(
    attacker.ring.maneuvers.some((c) => c.instanceId === chinLock.instanceId),
    'Maintained Submission stays in Ring after reversal'
  );
  assert(
    attacker.ring.actions.some((c) => c.instanceId === mh.instanceId),
    'Maintain Hold stays in Ring after reversal'
  );
  assert(
    engine.stateMachine.activePlayer === 1,
    'Maintained hand reversal ends maintainer turn'
  );
  assert(
    !engine.maintainedSubmissionFlow?.active,
    'Maintain Hold lock lifted after maintained reversal'
  );
}

async function testMaintainHoldFinisherSetup() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const opponent = engine.players[1];
  const walls = cloneCard(RawDeal, 'walls-of-jericho', 'mh-walls');
  const mh = cloneCard(RawDeal, 'maintain-hold', 'mh-finisher');

  player.hand = [walls];
  player.fortitude = 35;
  stripReversalsFromOpponentArsenal(opponent, RawDeal, 'mh-walls');

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, walls.instanceId, 'maneuver');
  await passReversalWindowIfOpen(engine, RawDeal);

  player.hand.push(mh);

  assert(
    engine.canPlayCard(0, mh.instanceId, 'action'),
    'Walls of Jericho enables Maintain Hold as if Submission'
  );
}

async function testStaggerEffectConsumedByAction() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const stagger = cloneCard(RawDeal, 'stagger', 'stag-action-consume');
  const chop = cloneCard(RawDeal, 'chop', 'stag-chop-consume');
  const punch = cloneCard(RawDeal, 'punch', 'stag-punch-consume');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'stag-elbow-consume');

  attacker.fortitude = 20;
  defender.hand = [elbow];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 5; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'kick', `stag-consume-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playKickSuccessfully(engine, RawDeal, 'stag-kick-consume');
  attacker.hand.push(chop, punch);
  await playStaggerAfterKick(engine, RawDeal, 'stag-action-consume');
  await engine.playCard(0, chop.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  await engine.playCard(0, punch.instanceId, 'maneuver');

  assert(
    engine.reversalWindow?.kind === 'maneuver',
    'Stagger effect consumed by action — Punch opens reversal window'
  );
  assert(
    engine.canPlayReversalFromHand(1, elbow.instanceId),
    'Elbow can reverse Punch after Stagger was wasted on an action'
  );
}

async function playDiversion(engine, RawDeal, instanceId = 'div-play') {
  const diversion = cloneCard(RawDeal, 'diversion', instanceId);
  const player = engine.players[0];
  player.hand.push(diversion);
  player.fortitude = Math.max(player.fortitude, 17);
  await engine.playCard(0, diversion.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  return diversion;
}

async function testDiversionSetsUnreversibleOnNextManeuver() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  player.fortitude = 20;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playDiversion(engine, RawDeal, 'div-sets');

  assert(
    player.turnState?.nextManeuverUnreversiblePending === true,
    'Diversion sets unreversible pending for next maneuver'
  );
  assert(
    player.turnState?.nextManeuverUnreversibleMaxDamage == null,
    'Diversion has no damage cap'
  );
  assert(
    player.turnState?.nextManeuverUnreversibleManeuverOnly === true,
    'Diversion waits for next maneuver only'
  );
  assert(
    player.ring.actions.some((c) => c.id === 'diversion'),
    'Diversion is in Ring actions'
  );
}

async function testDiversionProtectsManeuverFromHand() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const bulldog = cloneCard(RawDeal, 'bulldog', 'div-bulldog');
  const escapeMove = cloneCard(RawDeal, 'escape-move', 'div-escape');

  attacker.fortitude = 20;
  defender.hand = [escapeMove];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'chop', `div-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playDiversion(engine, RawDeal, 'div-hand');
  attacker.hand.push(bulldog);
  await engine.playCard(0, bulldog.instanceId, 'maneuver');

  assert(
    !engine.reversalWindow,
    'Diversion skips reversal priority for protected maneuver'
  );
  assert(
    !engine.canPlayReversalFromHand(1, escapeMove.instanceId),
    'Escape Move cannot reverse Bulldog protected by Diversion'
  );
}

async function testDiversionProtectsManeuverFromArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const clothesline = cloneCard(RawDeal, 'clothesline', 'div-clothesline-ars');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'div-elbow-ars');

  attacker.fortitude = 20;
  defender.arsenal = [
    cloneCard(RawDeal, 'chop', 'div-chop-1'),
    cloneCard(RawDeal, 'chop', 'div-chop-2'),
    cloneCard(RawDeal, 'chop', 'div-chop-3'),
    cloneCard(RawDeal, 'chop', 'div-chop-4'),
    cloneCard(RawDeal, 'chop', 'div-chop-5'),
    cloneCard(RawDeal, 'chop', 'div-chop-6'),
    cloneCard(RawDeal, 'chop', 'div-chop-7'),
  ];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playDiversion(engine, RawDeal, 'div-ars');
  attacker.hand.push(clothesline);
  defender.arsenal.push(elbow);
  await engine.playCard(0, clothesline.instanceId, 'maneuver');

  const lastDamage = engine.damageLog[engine.damageLog.length - 1];
  assert(
    lastDamage?.result === 'hit',
    'Arsenal Elbow does not reverse Clothesline protected by Diversion'
  );
  assert(lastDamage?.cardsOverturned === 7, 'Protected Clothesline overturns 7 Arsenal cards');
}

async function testDiversionPersistsThroughAction() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const chop = cloneCard(RawDeal, 'chop', 'div-chop');
  const bulldog = cloneCard(RawDeal, 'bulldog', 'div-bulldog-after-action');
  const escapeMove = cloneCard(RawDeal, 'escape-move', 'div-escape-persist');

  attacker.fortitude = 20;
  defender.hand = [escapeMove];
  defender.fortitude = 10;
  defender.arsenal = [];
  for (let i = 0; i < 8; i++) {
    defender.arsenal.push(cloneCard(RawDeal, 'kick', `div-persist-ars-${i}`));
  }

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await playDiversion(engine, RawDeal, 'div-persist');
  attacker.hand.push(chop, bulldog);
  await engine.playCard(0, chop.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  assert(
    attacker.turnState?.nextManeuverUnreversiblePending === true,
    'Diversion effect persists after playing an action'
  );

  await engine.playCard(0, bulldog.instanceId, 'maneuver');

  assert(
    !engine.reversalWindow,
    'Diversion still protects next maneuver after an intervening action'
  );
}

async function testDeludingYourselfDrawsFour() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const deluding = cloneCard(RawDeal, 'deluding-yourself', 'dy-test');

  player.hand = [deluding];
  player.arsenal = [
    cloneCard(RawDeal, 'punch', 'dy-ars-1'),
    cloneCard(RawDeal, 'kick', 'dy-ars-2'),
    cloneCard(RawDeal, 'chop', 'dy-ars-3'),
    cloneCard(RawDeal, 'elbow', 'dy-ars-4'),
    cloneCard(RawDeal, 'punch', 'dy-ars-5'),
  ];
  player.fortitude = 10;

  const arsenalBefore = player.arsenal.length;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, deluding.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  assert(player.hand.length === 4, 'Deluding Yourself draws 4 cards');
  assert(player.arsenal.length === arsenalBefore - 4, 'Deluding Yourself draws from Arsenal');
  assert(
    player.turnState?.discardHandAtEndOfTurn === true,
    'Deluding Yourself schedules hand discard at end of turn'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === deluding.instanceId),
    'Deluding Yourself is in Ring actions'
  );
  assert(!engine.cardEffectFlow, 'Deluding Yourself effect completes on play');
}

async function testDeludingYourselfDiscardsHandAtEndOfTurn() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const deluding = cloneCard(RawDeal, 'deluding-yourself', 'dy-eot');
  const extra = cloneCard(RawDeal, 'punch', 'dy-extra');

  player.hand = [deluding, extra];
  player.arsenal = [
    cloneCard(RawDeal, 'kick', 'dy-eot-1'),
    cloneCard(RawDeal, 'kick', 'dy-eot-2'),
    cloneCard(RawDeal, 'kick', 'dy-eot-3'),
    cloneCard(RawDeal, 'kick', 'dy-eot-4'),
  ];
  player.fortitude = 10;

  const handIdsBeforeEnd = new Set();

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, deluding.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  for (const card of player.hand) {
    handIdsBeforeEnd.add(card.instanceId);
  }
  assert(player.hand.length === 5, 'Hand has 4 draws plus leftover card before end of turn');

  await engine.endTurn(0);

  assert(player.hand.length === 0, 'Deluding Yourself empties hand at end of turn');
  assert(
    [...handIdsBeforeEnd].every((id) => player.ringside.some((c) => c.instanceId === id)),
    'Deluding Yourself discards entire hand to Ringside at end of turn'
  );
  assert(
    !player.turnState?.discardHandAtEndOfTurn,
    'End-of-turn hand discard flag is consumed'
  );
  assert(
    engine.stateMachine.activePlayer === 1,
    'Turn passes to opponent after end-of-turn discard'
  );
}

async function testDeludingYourselfDoesNotDiscardNextTurn() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const deluding = cloneCard(RawDeal, 'deluding-yourself', 'dy-next');

  player.hand = [deluding];
  player.arsenal = [
    cloneCard(RawDeal, 'kick', 'dy-next-1'),
    cloneCard(RawDeal, 'kick', 'dy-next-2'),
    cloneCard(RawDeal, 'kick', 'dy-next-3'),
    cloneCard(RawDeal, 'kick', 'dy-next-4'),
  ];
  player.fortitude = 10;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, deluding.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }
  await engine.endTurn(0);

  const opponent = engine.players[1];
  opponent.hand = [cloneCard(RawDeal, 'chop', 'dy-opp-keep')];
  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 1;
  await engine.endTurn(1);

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;
  player.hand = [cloneCard(RawDeal, 'punch', 'dy-new-hand')];
  await engine.endTurn(0);

  assert(
    player.hand.some((c) => c.instanceId === 'dy-new-hand'),
    'Deluding Yourself does not discard hand on a later turn'
  );
}

async function testGetCrowdSupportDrawAndNextManeuverBoost() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'goldfish' });
  await engine.startGame('rock', 'austin');

  const player = engine.players[0];
  const crowdSupport = cloneCard(RawDeal, 'get-crowd-support', 'gcs-test');
  const punch = cloneCard(RawDeal, 'punch', 'gcs-punch');

  player.hand = [crowdSupport, punch];
  player.arsenal = [cloneCard(RawDeal, 'chop', 'gcs-arsenal')];
  player.fortitude = 12;

  const handBefore = player.hand.length;
  const arsenalBefore = player.arsenal.length;

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, crowdSupport.instanceId, 'action');

  assert(
    player.hand.length === handBefore - 1 + 1,
    'Get Crowd Support draws 1 card after being played'
  );
  assert(
    player.arsenal.length === arsenalBefore - 1,
    'Get Crowd Support draw comes from Arsenal'
  );
  assert(engine.nextManeuverBonus[0] === 4, 'Get Crowd Support sets +4D on next maneuver');
  assert(
    player.turnState?.nextManeuverReversalTax === 12,
    'Get Crowd Support sets +12F reversal tax on next maneuver'
  );
  assert(
    player.ring.actions.some((c) => c.instanceId === crowdSupport.instanceId),
    'Get Crowd Support is in Ring actions'
  );

  await engine.playCard(0, punch.instanceId, 'maneuver');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  assert(
    engine.damageLog.some((e) => e.damage === 7 && e.card === 'Punch'),
    'Get Crowd Support +4D applies to next maneuver (Punch 3D + 4)'
  );
  assert(engine.nextManeuverBonus[0] === 0, 'Get Crowd Support +4D is consumed after use');
}

async function testGetCrowdSupportReversalTaxFromHandAndArsenal() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('rock', 'austin');

  const attacker = engine.players[0];
  const defender = engine.players[1];
  const crowdSupport = cloneCard(RawDeal, 'get-crowd-support', 'gcs-tax');
  const grapple = cloneCard(RawDeal, 'double-leg-takedown', 'gcs-grapple');
  const escapeHand = cloneCard(RawDeal, 'escape-move', 'gcs-escape-hand');
  const escapeArsenal = cloneCard(RawDeal, 'escape-move', 'gcs-escape-arsenal');

  attacker.hand = [crowdSupport, grapple];
  attacker.fortitude = 20;
  defender.hand = [escapeHand];
  defender.fortitude = 0;
  defender.arsenal = [escapeArsenal];

  engine.stateMachine.phase = RawDeal.PHASES.MAIN;
  engine.stateMachine.activePlayer = 0;

  await engine.playCard(0, crowdSupport.instanceId, 'action');
  if (engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY) {
    await engine.passPriority(1);
  }

  await engine.playCard(0, grapple.instanceId, 'maneuver');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Get Crowd Support boosted grapple opens reversal window'
  );
  assert(
    !engine.canPlayReversalFromHand(1, escapeHand.instanceId),
    'Get Crowd Support blocks hand reversal below +12F tax'
  );

  defender.fortitude = 12;
  assert(
    engine.canPlayReversalFromHand(1, escapeHand.instanceId),
    'Get Crowd Support allows hand reversal at +12F tax'
  );

  defender.fortitude = 0;
  assert(
    !engine._reversalStops(escapeArsenal, grapple, defender, { attacker }),
    'Get Crowd Support blocks Arsenal reversal below +12F tax'
  );

  defender.fortitude = 12;
  assert(
    engine._reversalStops(escapeArsenal, grapple, defender, { attacker }),
    'Get Crowd Support allows Arsenal reversal at +12F tax'
  );
}

async function main() {
  await testKickArsenalBeforeDamage();
  await testHeadButtCanDiscardHybridCard();
  await testSpinningHeelKickDiscardBeforeDamage();
  await testHeadlockTakedownOpponentDrawBeforeDamage();
  await testBulldogChainBeforeDamage();
  await testDeferredManeuverNotInRingDuringWindow();
  await testPassPriorityPlacesManeuverInRing();
  await testElbowReversalRingPlacementAndDamage();
  await testShoulderBlockReversalDamage();
  await testReversalDamagePinfall();
  await testReversalSvBeforeDamage();
  await testRockPreDrawAbilityOpensModal();
  await testRockPreDrawConfirmMovesCardToArsenalBottom();
  await testRockPreDrawPassKeepsRingside();
  await testKanePreDrawOverturnsOpponentArsenal();
  await testKanePreDrawSkipsWhenOpponentArsenalEmpty();
  await testShaneOMacPreDrawOverturnsOpponentArsenal();
  await testShaneOMacPreDrawSkipsWhenOpponentArsenalEmpty();
  await testShaneOMacNoEffectWhenNotInRing();
  await testShaneOMacPlayedToRingActions();
  await testJerichoSuperstarAbilityForcesOpponentDiscard();
  await testJerichoAbilityWhenOpponentHandEmpty();
  await testAtomicDropNextCardManeuverBonus();
  await testAtomicDropBonusLostOnNonManeuver();
  await testSnapMareNextCardStrikeBonus();
  await testSnapMareBonusLostOnNonStrikeNextCard();
  await testSnapMareBonusLostOnGrappleNextCard();
  await testStoneColdStunnerDiscountAfterKick();
  await testStoneColdStunnerNoDiscountAfterPunch();
  await testStoneColdStunnerNoDiscountAfterAction();
  await testStoneColdStunnerNoDiscountWithoutKick();
  await testStoneColdStunnerCanPlayAtDiscountedCost();
  await testKaneTombstoneDiscountAfterChokeslam();
  await testKaneTombstoneNoDiscountAfterPunch();
  await testKaneTombstoneNoDiscountAfterAction();
  await testKaneTombstoneNoDiscountWithoutChokeslam();
  await testKaneTombstoneCanPlayAtDiscountedCost();
  await testPatAndGerrySetsSkipFlag();
  await testPatAndGerryGrantsExtraTurn();
  await testHmmmOpensReorderPrompt();
  await testHmmmConfirmReordersTopCards();
  await testHmmmShuffleRandomizesArsenal();
  await testHmmmFewerThanFiveCards();
  await testMarkingOutOpensChoice();
  await testMarkingOutOwnArsenalEndsTurn();
  await testMarkingOutOpponentArsenalContinuesTurn();
  await testMarkingOutShortOpponentArsenal();
  await testMarkingOutEmptyArsenals();
  await testDontThinkTooHardOpensOpponentPrompt();
  await testDontThinkTooHardConfirmReordersOpponentTop();
  await testDontThinkTooHardShuffleOpponentArsenal();
  await testFiremansCarryHandRevealViewOnlyDone();
  await testFiremansCarryDamageAfterHandRevealDismiss();
  await testFiremansCarryThreeDamageStepsAfterDismiss();
  await testFiremansCarryMultiplayerDamageAfterDismiss();
  await testNotYetOpensHandPrompt();
  await testNotYetShuffleAndDraw();
  await testNotYetEmptyHandSkipsEffect();
  await testWhoopCanReversalTaxFromHand();
  await testWhoopCanReversalTaxFromArsenal();
  await testPedigreeBonusAfterStrike();
  await testPedigreeNoBonusWithoutStrike();
  await testPedigreeNoBonusAfterReversedStrike();
  await testPedigreeReversesBackBodyDrop();
  await testPedigreeCannotReverseOtherManeuver();
  await testChynaInterferesReversesAnyManeuver();
  await testChynaInterferesDeals3DAndDraws2();
  await testManagerInterferesDeals1DAndDraws1();
  await testMrSockoPickFromArsenal();
  await testMrSockoPickFromRingside();
  await testMrSockoEmptyZones();
  await testMrSockoRingPassiveDamage();
  await testMrSockoPassivePersistsNextTurn();
  await testMandibleClawDiscountWithSockoInRing();
  await testPowerOfDarknessAppliesTurnBonuses();
  await testPowerOfDarknessDamageAllManeuvers();
  await testPowerOfDarknessReversalTaxPersists();
  await testPowerOfDarknessActionReversalTax();
  await testJfpGrappleReversalTaxFromArsenal();
  await testJfpGrappleDamageBonus();
  await testJfpSelfReverseOpensChoice();
  await testJfpSelfReverseTaxAppliesToNextGrapple();
  await testCleanBreakReversesJfp();
  await testElbowBlocksManeuverOver7D();
  await testElbowAllowsManeuverAt7D();
  await testKneeBlockedWhenEffectiveDamageOver7();
  await testKneeAllowedAt7DWithIrishWhip();
  await testKneeDealsManeuverDamageFromHand();
  await testRollingDealsManeuverDamageFromHand();
  await testArsenalReversalBlockedOver7D();
  await testArsenalElbowCannotReverse8DPunchAfterIwSelfReverse();
  await testArsenalKneeCannotReverse8DPunchAfterIwSelfReverse();
  await testIrishWhipSelfReverseEligible();
  await testIrishWhipSelfReverseGrantsStrikeBonus();
  await testIrishWhipCannotReversePostIwManeuver();
  await testShakeItOffPlayableWhenLowerFortitude();
  await testShakeItOffNotPlayableWhenFortitudeNotLower();
  await testShakeItOffPlayableWhenBehindWithoutRemovableTarget();
  await testShakeItOffRemovesOpponentRingCard();
  await testOfferHandshakeDrawTwoThenDiscard();
  await testOfferHandshakeDrawCappedByArsenal();
  await testOfferHandshakeDrawZeroStillDiscards();
  await testRollOutFullSwap();
  await testRollOutDiscardZero();
  await testRollOutCapByHand();
  await testRollOutDiscardCappedReturnsOne();
  await testPeoplesEyebrowTakeTwoThenShuffleTwo();
  await testPeoplesEyebrowTakeOneWhenOnlyOneInRingside();
  await testPeoplesEyebrowEmptyRingsideSkipsBothSteps();
  await testPeoplesElbowManeuverRequiresRockBottom();
  await testPeoplesElbowManeuverWithRockBottomInRing();
  await testPeoplesElbowManeuverWithRockBottomInReversals();
  await testPeoplesElbowActionShufflesIntoArsenalAndDrawsTwo();
  await testRecoveryShuffleTwoThenDraw();
  await testRecoveryShuffleOneWhenOnlyOneInRingside();
  await testRecoveryEmptyRingsideSkipsShuffle();
  await testPuppiesOpensUpToFiveShuffleModal();
  await testPuppiesShuffleThreeThenDrawTwo();
  await testPuppiesConfirmZeroShuffleStillDrawsTwo();
  await testPuppiesEmptyRingsideSkipsShuffle();
  await testSpitAtOpponentDiscardFour();
  await testSpitAtOpponentDiscardsWholeHandWhenThreeOrLess();
  await testSpitAtOpponentPlayableWithEmptyOpponentHand();
  await testMaintainHoldNotPlayableWithoutSubmission();
  await testMaintainHoldNotPlayableAfterHandReversal();
  await testMaintainHoldPlayableAfterSubmission();
  await testMaintainHoldNotPlayableAfterStrike();
  await testMaintainHoldEndsTurnAndLocks();
  await testMaintainHoldReappliesOnMaintainerTurn();
  await testMaintainHoldHandReversalDisables();
  await testMaintainHoldFinisherSetup();
  await testStaggerNotPlayableWithoutManeuver();
  await testStaggerNotPlayableAfterHandReversal();
  await testStaggerPlayableAfterSuccessfulManeuver();
  await testStaggerProtectsLowDamageManeuverFromHand();
  await testStaggerProtectsLowDamageManeuverFromArsenal();
  await testStaggerDoesNotProtectHighDamageManeuver();
  await testStaggerProtectsExactly7D();
  await testStaggerEffectConsumedByAction();
  await testDiversionSetsUnreversibleOnNextManeuver();
  await testDiversionProtectsManeuverFromHand();
  await testDiversionProtectsManeuverFromArsenal();
  await testDiversionPersistsThroughAction();
  await testDeludingYourselfDrawsFour();
  await testDeludingYourselfDiscardsHandAtEndOfTurn();
  await testDeludingYourselfDoesNotDiscardNextTurn();
  await testGetCrowdSupportDrawAndNextManeuverBoost();
  await testGetCrowdSupportReversalTaxFromHandAndArsenal();
  await testComebackNotPlayableWithoutFourCards();
  await testComebackDiscardsThree();
  await testComebackEqualFortitudeNoRemoval();
  await testComebackGoldfishOpponentHigherRemovesHighestDamage();
  await testComebackIgnoresRingActions();
  await testComebackMultiplayerManualRemoval();
  await testEgoBoostNextCardMinusFiveF();
  await testEgoBoostNextCardAppliesToAction();
  await testEgoBoostReactionReplacesOneOfFour();
  await testEgoBoostReactionDrawUpToTwo();
  await testEgoBoostReactionFilterDiscard();
  await testEgoBoostTwoCopiesChainOnSpit();
  await testEgoBoostDiscardNormallySkipsSecondOffer();
  await testEgoBoostNotInRingForReaction();

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