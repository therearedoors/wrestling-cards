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
  const origTop = engine._topArsenalToRingside.bind(engine);
  const origDiscard = engine._applyOpponentDiscardFromHandEffect.bind(engine);
  const origDamage = engine._resolveDamage.bind(engine);

  engine._topArsenalToRingside = async (...args) => {
    order.push('topArsenal');
    return origTop(...args);
  };
  engine._applyOpponentDiscardFromHandEffect = async (...args) => {
    order.push('opponentDiscard');
    return origDiscard(...args);
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

  assert(damageResolved, 'Bulldog resolves damage after onSuccess pipeline completes');
}

async function main() {
  await testKickArsenalBeforeDamage();
  await testSpinningHeelKickDiscardBeforeDamage();
  await testBulldogChainBeforeDamage();

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