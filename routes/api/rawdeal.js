const { Router } = require('express');
const { requireAuth } = require('../../utils/auth');
const { listDecks, saveDeck, deleteDeck } = require('../../controllers/api/rawdeal');

const router = Router();

router.use(requireAuth);

router.get('/decks', listDecks);
router.put('/decks/:deckId', saveDeck);
router.delete('/decks/:deckId', deleteDeck);

module.exports = router;