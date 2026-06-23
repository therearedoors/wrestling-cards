(function () {
  const waitingScreen = document.getElementById('rd-waiting');
  const waitingText = document.getElementById('rd-waiting-text');
  const gameScreen = document.getElementById('rd-game');
  const boardRoot = document.getElementById('rd-board');

  if (!waitingScreen || !gameScreen || !boardRoot) return;

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('id');
  const password = params.get('password') || null;

  if (!roomId) {
    window.location.href = '/rawdeal/games';
    return;
  }

  let user = null;
  let myIndex = 0;
  let board = null;
  let lastDamageLogLen = 0;

  const previewRoot = document.getElementById('rd-card-preview');
  const cardPreview = previewRoot ? new window.RawDeal.CardPreview(previewRoot) : null;
  const choiceModalRoot = document.getElementById('rd-choice-modal');
  const choiceModal = choiceModalRoot ? new window.RawDeal.ChoiceModal(choiceModalRoot) : null;

  function emitAction(action) {
    socket.emit('rd-action', roomId, action);
  }

  function setupBoard() {
    board = new window.RawDeal.Board(boardRoot, cardPreview, choiceModal);

    board.onPlayCard = (instanceId, playAs) => {
      emitAction({ type: 'playCard', instanceId, playAs });
    };

    board.onEndTurn = () => {
      emitAction({ type: 'endTurn' });
    };

    board.onUseSuperstarAbility = () => {
      emitAction({ type: 'superstarAbility' });
    };

    board.onAbilitySelect = (instanceId) => {
      emitAction({ type: 'abilitySelect', instanceId });
    };

    board.onChoiceSelect = (optionId) => {
      emitAction({ type: 'choiceSelect', optionId });
    };

    board.onPlayReversal = (instanceId) => {
      emitAction({ type: 'playReversal', instanceId });
    };

    board.onPassPriority = () => {
      emitAction({ type: 'passPriority' });
    };
  }

  function showGame() {
    waitingScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    if (!board) setupBoard();
  }

  function handleState(state) {
    if (!board) setupBoard();
    showGame();
    board.render(state);

    if (state.damageLog && state.damageLog.length > lastDamageLogLen) {
      const entry = state.damageLog[state.damageLog.length - 1];
      if (entry.result === 'reversed' && entry.reversedBy) {
        board.showReversalNotice(
          { name: entry.card },
          { name: entry.reversedBy }
        );
      }
      lastDamageLogLen = state.damageLog.length;
    }
  }

  fetch('/api/user-info', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((data) => {
      user = data;
      if (password) {
        socket.emit('rd-user-connected', user, roomId, password);
      } else {
        socket.emit('rd-user-connected', user, roomId);
      }
    })
    .catch(() => {
      window.location.href = '/login';
    });

  socket.on('rd-waiting', (payload) => {
    const players = payload.players || [];
    const guest = players[1];
    if (guest) {
      waitingText.textContent = `Opponent ${guest.username} joined. Starting match…`;
    } else {
      waitingText.textContent = 'Share this room ID — waiting for an opponent to join.';
    }
  });

  socket.on('rd-game-started', (payload) => {
    myIndex = payload.myIndex;
    showGame();
  });

  socket.on('rd-state', handleState);

  socket.on('rd-game-over', (payload) => {
    if (board && payload?.winner !== undefined) {
      const state = board._state;
      if (state && state.phase !== window.RawDeal.PHASES.GAME_OVER) {
        board.render({
          ...state,
          phase: window.RawDeal.PHASES.GAME_OVER,
          winner: payload.winner,
          winReason: payload.reason || state.winReason,
          myIndex,
        });
      }
    }
  });

  socket.on('rd-error', (msg) => {
    alert(msg);
    if (msg.includes('not exist') || msg.includes('not in')) {
      window.location.href = '/rawdeal/games';
    }
  });
})();