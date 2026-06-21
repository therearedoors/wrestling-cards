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
      onDamageStep: async ({ card, maneuver, reversed, onReveal }) => {
        await window.RawDeal.Animations.flipArsenalToRingside(
          card,
          board.getOpponentArsenalEl(),
          board.getOpponentRingsideEl(),
          {
            onReveal: () => {
              onReveal();
              if (reversed) {
                board.showReversalNotice(maneuver, card);
              } else {
                window.RawDeal.Animations.pulseEl(board.getOpponentRingsideEl());
              }
            },
            isReversal: reversed,
          }
        );
      },
      onArsenalToRingside: async ({ card, onReveal }) => {
        await window.RawDeal.Animations.flipArsenalToRingside(
          card,
          board.getPlayerArsenalEl(),
          board.getPlayerRingsideEl(),
          {
            onReveal: () => {
              onReveal();
              window.RawDeal.Animations.pulseEl(board.getPlayerRingsideEl());
            },
          }
        );
      },
    });

    board.onPlayCard = async (instanceId, playAs) => {
      if (!engine.canPlayCard(0, instanceId, playAs)) return;
      await engine.playCard(instanceId, playAs);
    };

    board.onEndTurn = async () => {
      await engine.endTurn();
    };

    board.onUseSuperstarAbility = () => {
      engine.beginSuperstarAbility(0);
    };

    board.onAbilitySelect = (instanceId) => {
      if (!engine.selectForCardEffect(instanceId)) {
        engine.selectForAbility(instanceId);
      }
    };

    board.onRestart = () => {
      setupScreen.classList.remove('hidden');
      gameScreen.classList.add('hidden');
      engine.reset();
    };

    const map = window.RawDeal.OPPONENT_MAP || {};
    const opponentDeck =
      map[playerDeckId] ||
      window.RawDeal.DECKS[playerDeckId]?.defaultOpponent ||
      'austin';
    engine.startGame(playerDeckId, opponentDeck);

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
  }

  startBtn.addEventListener('click', () => {
    const deck = deckSelect.value || 'rock';
    initGame(deck);
  });
})();