const db = require('../../config/db');
const { loadRawDeal, resolveDeck } = require('./bootstrap');

function fetchOverridesForUsers(userIds) {
  return new Promise((resolve, reject) => {
    const ids = userIds.filter(Boolean);
    if (!ids.length) return resolve({});

    const placeholders = ids.map(() => '?').join(',');
    const query = `SELECT user_id, deck_id, name, superstar_id, default_opponent, cards
      FROM rawdeal_deck_overrides WHERE user_id IN (${placeholders})`;

    db.query(query, ids, (err, rows) => {
      if (err) {
        console.warn('rawdeal deck overrides unavailable:', err.message);
        return resolve({});
      }

      const byUser = {};
      for (const row of rows) {
        if (!byUser[row.user_id]) byUser[row.user_id] = {};
        byUser[row.user_id][row.deck_id] = {
          name: row.name,
          superstarId: row.superstar_id,
          defaultOpponent: row.default_opponent,
          cards: typeof row.cards === 'string' ? JSON.parse(row.cards) : row.cards,
        };
      }
      resolve(byUser);
    });
  });
}

async function resolveDecksForMatch(player0, player1) {
  const RawDeal = loadRawDeal();
  const overridesByUser = await fetchOverridesForUsers([player0?.id, player1?.id]);

  const deck0 = resolveDeck(
    player0.deckId,
    overridesByUser[player0?.id]?.[player0.deckId],
    RawDeal
  );
  const deck1 = resolveDeck(
    player1.deckId,
    overridesByUser[player1?.id]?.[player1.deckId],
    RawDeal
  );

  return { deck0, deck1, RawDeal };
}

module.exports = { resolveDecksForMatch };