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

async function testWhoopCanReversalTaxFromHand() {
  const RawDeal = loadRawDeal();
  const engine = new RawDeal.GameEngine({ engineMode: 'multiplayer' });
  await engine.startGame('austin', 'rock');

  const attacker = engine.players[0];
  const defender = engine.players[1];

  const whoop = cloneCard(RawDeal, 'open-up-a-can', 'whoop-0');
  const punch = cloneCard(RawDeal, 'punch', 'punch-0');
  const elbow = cloneCard(RawDeal, 'elbow-to-the-face', 'elbow-0');

  attacker.hand = [whoop, punch];
  attacker.fortitude = 20;
  defender.hand = [elbow];
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

  await engine.playCard(0, punch.instanceId, 'maneuver');
  assert(
    engine.stateMachine.phase === RawDeal.PHASES.REVERSAL_PRIORITY,
    'Boosted punch opens reversal window'
  );
  assert(
    !engine.canPlayReversalFromHand(1, elbow.instanceId),
    'Opponent cannot reverse from hand without 20F'
  );

  defender.fortitude = 20;
  assert(
    engine.canPlayReversalFromHand(1, elbow.instanceId),
    'Opponent can reverse from hand with 20F'
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

async function main() {
  await testKickArsenalBeforeDamage();
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
  await testJerichoSuperstarAbilityForcesOpponentDiscard();
  await testJerichoAbilityWhenOpponentHandEmpty();
  await testAtomicDropNextCardManeuverBonus();
  await testAtomicDropBonusLostOnNonManeuver();
  await testWhoopCanReversalTaxFromHand();
  await testWhoopCanReversalTaxFromArsenal();

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