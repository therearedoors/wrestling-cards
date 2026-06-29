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