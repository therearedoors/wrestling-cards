(function () {
  const setupScreen = document.getElementById('rd-setup');
  const gameScreen = document.getElementById('rd-game');
  const boardRoot = document.getElementById('rd-board');
  const startBtn = document.getElementById('rd-start-btn');
  const deckSelect = document.getElementById('rd-deck-select');

  if (!setupScreen || !gameScreen || !boardRoot) return;

  let engine = null;
  let board = null;

  const previewRoot = document.getElementById('rd-card-preview');
  const cardPreview = previewRoot ? new window.RawDeal.CardPreview(previewRoot) : null;

  function initGame(playerDeckId) {
    board = new window.RawDeal.Board(boardRoot, cardPreview);

    engine = new window.RawDeal.GameEngine({
      onStateChange: (state) => board.render(state),
      onDamageStep: async ({ card }) => {
        await window.RawDeal.Animations.flipArsenalToRingside(
          card,
          board.getOpponentArsenalEl(),
          board.getOpponentRingsideEl()
        );
        window.RawDeal.Animations.pulseEl(board.getOpponentRingsideEl());
      },
    });

    board.onPlayCard = async (instanceId) => {
      if (!engine.canPlayCard(0, instanceId)) return;
      await engine.playCard(instanceId);
    };

    board.onEndTurn = async () => {
      await engine.endTurn();
    };

    board.onRestart = () => {
      setupScreen.classList.remove('hidden');
      gameScreen.classList.add('hidden');
      engine.reset();
    };

    const opponentDeck = playerDeckId === 'rock' ? 'austin' : 'rock';
    engine.startGame(playerDeckId, opponentDeck);

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
  }

  startBtn.addEventListener('click', () => {
    const deck = deckSelect.value || 'rock';
    initGame(deck);
  });
})();