(function () {
  const setupScreen = document.getElementById('rd-setup');
  const gameScreen = document.getElementById('rd-game');
  const boardRoot = document.getElementById('rd-board');
  const startBtn = document.getElementById('rd-start-btn');
  const deckSelect = document.getElementById('rd-deck-select');
  const overrideNote = document.getElementById('rd-override-note');
  const devConsoleRoot = document.getElementById('rd-dev-console');

  if (!setupScreen || !gameScreen || !boardRoot) return;

  const devMode = setupScreen.closest('[data-rd-dev]')?.dataset.rdDev === '1';
  let engine = null;
  let board = null;
  let devConsole = null;
  let decksReady = false;

  const previewRoot = document.getElementById('rd-card-preview');
  const cardPreview = previewRoot ? new window.RawDeal.CardPreview(previewRoot) : null;
  const choiceModalRoot = document.getElementById('rd-choice-modal');
  const choiceModal = choiceModalRoot ? new window.RawDeal.ChoiceModal(choiceModalRoot) : null;
  const handRevealModalRoot = document.getElementById('rd-hand-reveal-modal');
  const handRevealModal = handRevealModalRoot
    ? new window.RawDeal.HandRevealModal(handRevealModalRoot)
    : null;

  async function loadDecks() {
    await window.RawDeal.DeckStore.load();
    decksReady = true;

    if (overrideNote && window.RawDeal.DeckStore.hasOverrides()) {
      overrideNote.classList.remove('hidden');
    }
  }

  function initGame(playerDeckId) {
    const resolvedDecks = window.RawDeal.DeckStore.getResolvedDecks();

    board = new window.RawDeal.Board(boardRoot, cardPreview, choiceModal, handRevealModal);

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
      await engine.playCard(0, instanceId, playAs);
    };

    board.onEndTurn = async () => {
      await engine.endTurn(0);
    };

    board.onUseSuperstarAbility = () => {
      engine.beginSuperstarAbility(0);
    };

    board.onAbilitySelect = async (instanceId) => {
      if (!(await engine.selectForCardEffect(0, instanceId))) {
        engine.selectForAbility(0, instanceId);
      }
    };

    board.onChoiceSelect = async (optionId) => {
      await engine.selectChoice(0, optionId);
    };

    board.onDismissHandReveal = () => {
      engine.dismissHandReveal(0);
    };

    board.onSkipHandReveal = () => {
      engine.skipHandReveal(0);
    };

    board.onConfirmHandReveal = (instanceIds) => {
      engine.confirmHandRevealSelection(0, instanceIds);
    };

    board.onToggleHandRevealSelect = (instanceId) => {
      engine.toggleHandRevealSelection(0, instanceId);
    };

    board.onRestart = () => {
      setupScreen.classList.remove('hidden');
      gameScreen.classList.add('hidden');
      engine.reset();
      devConsole = null;
    };

    const map = window.RawDeal.OPPONENT_MAP || {};
    const playerDeck = resolvedDecks[playerDeckId];
    const opponentDeckId =
      map[playerDeckId] ||
      playerDeck?.defaultOpponent ||
      'austin';
    engine.startGame(playerDeckId, opponentDeckId, resolvedDecks);

    if (devMode && devConsoleRoot) {
      devConsole = new window.RawDeal.DevConsole(devConsoleRoot, engine);
      devConsole.log('Dev console ready. Type help for commands.');
    }

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
  }

  startBtn.addEventListener('click', async () => {
    if (!decksReady) {
      startBtn.disabled = true;
      await loadDecks();
      startBtn.disabled = false;
    }
    const deck = deckSelect.value || 'rock';
    initGame(deck);
  });

  loadDecks().catch((err) => console.warn('goldfish deck load:', err));
})();