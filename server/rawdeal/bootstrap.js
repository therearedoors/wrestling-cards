const fs = require('fs');
const path = require('path');
const vm = require('vm');

let loaded = false;

function loadRawDeal() {
  if (loaded) return global.window.RawDeal;

  const root = path.join(__dirname, '../../public/js/games/rawdeal');
  global.window = { RawDeal: {} };

  const files = [
    'data/cards.js',
    'data/decks.js',
    'engine/constants.js',
    'engine/cardUtils.js',
    'engine/stateMachine.js',
    'engine/effectPipeline.js',
    'engine/gameEngine.js',
    'dev/devCommands.js',
  ];

  const sandbox = {
    window: global.window,
    console,
    setTimeout,
    clearTimeout,
  };

  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: file });
  }

  loaded = true;
  return global.window.RawDeal;
}

function buildDeck(counts, RawDeal) {
  const arsenal = [];
  let i = 0;
  for (const [id, count] of Object.entries(counts)) {
    const base = RawDeal.CARDS[id];
    if (!base) continue;
    for (let c = 0; c < count; c++) {
      arsenal.push({ ...base, instanceId: `${id}-${i++}` });
    }
  }
  return arsenal;
}

function arsenalToCounts(arsenal) {
  const counts = {};
  for (const card of arsenal) {
    counts[card.id] = (counts[card.id] || 0) + 1;
  }
  return counts;
}

function resolveDeck(deckId, override, RawDeal) {
  const defaultDeck = RawDeal.DECKS[deckId];
  if (!defaultDeck) return null;

  const cards = override?.cards ?? arsenalToCounts(defaultDeck.arsenal);
  return {
    id: deckId,
    name: override?.name ?? defaultDeck.name,
    superstarId: override?.superstarId ?? defaultDeck.superstarId,
    defaultOpponent: override?.defaultOpponent ?? defaultDeck.defaultOpponent,
    arsenal: buildDeck(cards, RawDeal),
  };
}

module.exports = { loadRawDeal, resolveDeck, buildDeck, arsenalToCounts };