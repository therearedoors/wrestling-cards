const db = require('../../config/db');
const fs = require('fs');
const path = require('path');

const DECK_IDS = new Set(['rock', 'austin', 'undertaker', 'mankind', 'hhh', 'kane', 'jericho']);
const SUPERSTAR_IDS = new Set([
  'the-rock',
  'stone-cold',
  'undertaker',
  'mankind',
  'hhh',
  'kane',
  'jericho',
]);

let cardCatalog = null;

function loadCatalog() {
  if (cardCatalog) return cardCatalog;
  const catalogPath = path.join(__dirname, '../../data/rawdeal-card-catalog.json');
  try {
    cardCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  } catch {
    cardCatalog = {};
  }
  return cardCatalog;
}

function validateDeckPayload(body) {
  const errors = [];
  const { superstarId, defaultOpponent, cards, name } = body;

  if (!name || typeof name !== 'string') errors.push('name is required');
  if (!superstarId || !SUPERSTAR_IDS.has(superstarId)) errors.push('invalid superstarId');
  if (!defaultOpponent || !DECK_IDS.has(defaultOpponent)) errors.push('invalid defaultOpponent');
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) {
    errors.push('cards must be an object');
    return errors;
  }

  const catalog = loadCatalog();
  let total = 0;

  for (const [cardId, count] of Object.entries(cards)) {
    if (typeof count !== 'number' || count < 0 || count > 3) {
      errors.push(`${cardId}: count must be 0–3`);
      continue;
    }
    if (count === 0) continue;
    if (catalog[cardId] === undefined && Object.keys(catalog).length > 0) {
      errors.push(`${cardId}: unknown card id`);
      continue;
    }
    if (catalog[cardId]?.unique && count > 1) {
      errors.push(`${cardId}: unique card limit 1`);
    }
    total += count;
  }

  if (total !== 60) errors.push(`deck must have 60 cards (has ${total})`);
  return errors;
}

exports.listDecks = (req, res) => {
  const userId = req.user.id;
  const query = `SELECT deck_id, name, superstar_id, default_opponent, cards, updated_at
    FROM rawdeal_deck_overrides WHERE user_id = ?`;

  db.query(query, [userId], (err, rows) => {
    if (err) {
      console.error('listDecks:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const overrides = {};
    for (const row of rows) {
      overrides[row.deck_id] = {
        name: row.name,
        superstarId: row.superstar_id,
        defaultOpponent: row.default_opponent,
        cards: typeof row.cards === 'string' ? JSON.parse(row.cards) : row.cards,
        updatedAt: row.updated_at,
      };
    }
    res.json({ overrides });
  });
};

exports.saveDeck = (req, res) => {
  const deckId = req.params.deckId;
  if (!DECK_IDS.has(deckId)) {
    return res.status(400).json({ error: 'Invalid deck id' });
  }

  const errors = validateDeckPayload(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const userId = req.user.id;
  const { name, superstarId, defaultOpponent, cards } = req.body;
  const cardsJson = JSON.stringify(cards);

  const query = `INSERT INTO rawdeal_deck_overrides
    (user_id, deck_id, name, superstar_id, default_opponent, cards)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      superstar_id = VALUES(superstar_id),
      default_opponent = VALUES(default_opponent),
      cards = VALUES(cards)`;

  db.query(
    query,
    [userId, deckId, name, superstarId, defaultOpponent, cardsJson],
    (err) => {
      if (err) {
        console.error('saveDeck:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ ok: true, deckId });
    }
  );
};

exports.deleteDeck = (req, res) => {
  const deckId = req.params.deckId;
  if (!DECK_IDS.has(deckId)) {
    return res.status(400).json({ error: 'Invalid deck id' });
  }

  const userId = req.user.id;
  db.query(
    'DELETE FROM rawdeal_deck_overrides WHERE user_id = ? AND deck_id = ?',
    [userId, deckId],
    (err, result) => {
      if (err) {
        console.error('deleteDeck:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ ok: true, deleted: result.affectedRows > 0 });
    }
  );
};