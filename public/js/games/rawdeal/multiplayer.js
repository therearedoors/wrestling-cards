(function () {
  const waitingScreen = document.getElementById('rd-waiting');
  const waitingText = document.getElementById('rd-waiting-text');
  const gameScreen = document.getElementById('rd-game');
  const boardRoot = document.getElementById('rd-board');

  if (!waitingScreen || !gameScreen || !boardRoot) return;

  const pageRoot = waitingScreen.closest('.rd-page');
  const devMode = pageRoot?.dataset.rdDev === '1';
  const devConsoleRoot = document.getElementById('rd-dev-console');
  const devModeLink = document.getElementById('rd-dev-mode-link');

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('id');
  const password = params.get('password') || null;

  if (!roomId) {
    window.location.href = '/games';
    return;
  }

  let user = null;
  let myIndex = 0;
  let board = null;
  let devConsole = null;
  let pendingDevResolve = null;
  let lastDamageLogLen = 0;
  let lastBoardState = null;
  let animChain = Promise.resolve();

  const previewRoot = document.getElementById('rd-card-preview');
  const cardPreview = previewRoot ? new window.RawDeal.CardPreview(previewRoot) : null;
  const choiceModalRoot = document.getElementById('rd-choice-modal');
  const choiceModal = choiceModalRoot ? new window.RawDeal.ChoiceModal(choiceModalRoot) : null;
  const handRevealModalRoot = document.getElementById('rd-hand-reveal-modal');
  const handRevealModal = handRevealModalRoot
    ? new window.RawDeal.HandRevealModal(handRevealModalRoot)
    : null;
  const pileViewModalRoot = document.getElementById('rd-pile-view-modal');
  const pileViewModal = pileViewModalRoot
    ? new window.RawDeal.PileViewModal(pileViewModalRoot)
    : null;
  const superstarAbilityModalRoot = document.getElementById('rd-superstar-ability-modal');
  const superstarAbilityModal = superstarAbilityModalRoot
    ? new window.RawDeal.SuperstarAbilityModal(superstarAbilityModalRoot)
    : null;
  const arsenalReorderModalRoot = document.getElementById('rd-arsenal-reorder-modal');
  const arsenalReorderModal = arsenalReorderModalRoot
    ? new window.RawDeal.ArsenalReorderModal(arsenalReorderModalRoot)
    : null;
  const opponentRingModalRoot = document.getElementById('rd-opponent-ring-modal');
  const opponentRingSelectModal = opponentRingModalRoot
    ? new window.RawDeal.OpponentRingSelectModal(opponentRingModalRoot)
    : null;

  function emitAction(action) {
    socket.emit('rd-action', roomId, action);
  }

  function resolveAnimCard(eventCard) {
    const base = window.RawDeal.CARDS[eventCard.id] || {};
    return { ...base, ...eventCard };
  }

  function getAnimPiles(seat) {
    const isMe = seat === myIndex;
    return {
      from: isMe ? board.getPlayerArsenalEl() : board.getOpponentArsenalEl(),
      to: isMe ? board.getPlayerRingsideEl() : board.getOpponentRingsideEl(),
    };
  }

  function onCardRevealed(ev, card) {
    const viewerPlayerIndex = ev.seat === myIndex ? 0 : 1;
    board.revealFlippedCard(viewerPlayerIndex, card);
  }

  async function playAnimationEvent(ev) {
    const { from, to } = getAnimPiles(ev.seat);
    const card = resolveAnimCard(ev.card);
    const Animations = window.RawDeal.Animations;
    const onReveal = () => onCardRevealed(ev, card);

    if (ev.type === 'damageFlip') {
      await Animations.flipArsenalToRingside(card, from, to, {
        isReversal: !!ev.reversed,
        onReveal,
      });
      if (ev.reversed && ev.maneuver) {
        board.showReversalNotice(ev.maneuver, card);
      } else {
        Animations.pulseEl(to);
      }
      return;
    }

    if (ev.type === 'arsenalToRingside') {
      await Animations.flipArsenalToRingside(card, from, to, { onReveal });
      Animations.pulseEl(to);
    }
  }

  function setupBoard() {
    board = new window.RawDeal.Board(
      boardRoot,
      cardPreview,
      choiceModal,
      handRevealModal,
      pileViewModal,
      superstarAbilityModal,
      arsenalReorderModal,
      opponentRingSelectModal
    );

    board.onPlayCard = (instanceId, playAs) => {
      emitAction({ type: 'playCard', instanceId, playAs });
    };

    board.onEndTurn = () => {
      emitAction({ type: 'endTurn' });
    };

    board.onUseSuperstarAbility = () => {
      emitAction({ type: 'superstarAbility' });
    };

    board.onPassSuperstarAbility = () => {
      emitAction({ type: 'passSuperstarAbility' });
    };

    board.onConfirmSuperstarAbility = (selection) => {
      emitAction({
        type: 'confirmSuperstarAbility',
        instanceId: Array.isArray(selection) ? undefined : selection,
        instanceIds: Array.isArray(selection) ? selection : undefined,
      });
    };

    board.onToggleSuperstarAbilitySelect = (instanceId) => {
      emitAction({ type: 'toggleSuperstarAbilitySelection', instanceId });
    };

    board.onAbilitySelect = (instanceId) => {
      emitAction({ type: 'abilitySelect', instanceId });
    };

    board.onChoiceSelect = (optionId) => {
      emitAction({ type: 'choiceSelect', optionId });
    };

    board.onAdjustDrawCount = (delta) => {
      emitAction({ type: 'adjustDrawCount', delta });
    };

    board.onConfirmDrawCount = () => {
      emitAction({ type: 'confirmDrawCount' });
    };

    board.onAdjustDiscardCount = (delta) => {
      emitAction({ type: 'adjustDiscardCount', delta });
    };

    board.onConfirmDiscardCount = () => {
      emitAction({ type: 'confirmDiscardCount' });
    };



    board.onShuffleArsenalReorder = () => {
      emitAction({ type: 'shuffleArsenalReorder' });
    };

    board.onConfirmArsenalReorder = (orderedIds) => {
      emitAction({ type: 'confirmArsenalReorder', orderedIds });
    };

    board.onArsenalReorderChange = (orderedIds) => {
      emitAction({ type: 'updateArsenalReorder', orderedIds });
    };

    board.onPlayReversal = (instanceId) => {
      emitAction({ type: 'playReversal', instanceId });
    };

    board.onPassPriority = () => {
      emitAction({ type: 'passPriority' });
    };

    board.onDismissHandReveal = () => {
      if (lastBoardState) {
        lastBoardState = stateWithoutBlockingModals(lastBoardState);
        board.render(lastBoardState);
      }
      emitAction({ type: 'dismissHandReveal' });
    };

    board.onSkipHandReveal = () => {
      emitAction({ type: 'skipHandReveal' });
    };

    board.onConfirmHandReveal = (instanceIds) => {
      emitAction({ type: 'confirmHandRevealSelection', instanceIds });
    };

    board.onToggleHandRevealSelect = (instanceId) => {
      emitAction({ type: 'toggleHandRevealSelection', instanceId });
    };

    board.onToggleOpponentRingSelect = (instanceId, ringArea) => {
      emitAction({ type: 'toggleRemoveOpponentRingSelect', instanceId, ringArea });
    };

    board.onConfirmOpponentRingSelect = () => {
      emitAction({ type: 'confirmRemoveOpponentRingCard' });
    };
  }

  function initDevConsole() {
    if (!devMode || !devConsoleRoot || devConsole) return;

    devConsole = new window.RawDeal.DevConsole(devConsoleRoot, (line) => {
      return new Promise((resolve) => {
        pendingDevResolve = resolve;
        emitAction({ type: 'devCommand', line });
      });
    });
    devConsole.log('Dev console ready. Type help for commands.');
  }

  function showGame() {
    waitingScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    if (!board) setupBoard();
    initDevConsole();
  }

  function processDamageLog(state, showedReversalFromAnim) {
    if (!state.damageLog || state.damageLog.length <= lastDamageLogLen) return;

    if (showedReversalFromAnim) {
      lastDamageLogLen = state.damageLog.length;
      return;
    }

    const entry = state.damageLog[state.damageLog.length - 1];
    if (entry.result === 'reversed' && entry.reversedBy) {
      board.showReversalNotice(
        { name: entry.card },
        { name: entry.reversedBy }
      );
    }
    lastDamageLogLen = state.damageLog.length;
  }

  function stateWithoutBlockingModals(baseState) {
    if (!baseState) return baseState;
    return {
      ...baseState,
      handReveal: null,
      selectionPrompt: null,
    };
  }

  async function applyState(state) {
    if (!board) setupBoard();
    showGame();

    const events = state.animationEvents || [];
    const hasAnims = events.length > 0 && lastBoardState;

    if (hasAnims) {
      board.render(stateWithoutBlockingModals(lastBoardState));
      for (const ev of events) {
        await playAnimationEvent(ev);
      }
    }

    board.render(state);
    lastBoardState = state;

    const showedReversalFromAnim = events.some(
      (e) => e.type === 'damageFlip' && e.reversed
    );
    processDamageLog(state, showedReversalFromAnim);
  }

  function handleState(state) {
    if (state.myIndex !== undefined) {
      myIndex = state.myIndex;
    }

    animChain = animChain.then(() => applyState(state)).catch((err) => {
      console.warn('rawdeal animation:', err);
      if (board) board.render(state);
      lastBoardState = state;
    });
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

  socket.on('rd-dev-result', (result) => {
    if (pendingDevResolve) {
      pendingDevResolve(result);
      pendingDevResolve = null;
    }
  });

  socket.on('rd-error', (msg) => {
    if (pendingDevResolve) {
      pendingDevResolve({ ok: false, message: msg });
      pendingDevResolve = null;
      return;
    }
    alert(msg);
    if (msg.includes('not exist') || msg.includes('not in')) {
      window.location.href = '/games';
    }
  });

  if (devModeLink) {
    devModeLink.addEventListener('click', (e) => {
      e.preventDefault();
      const next = new URLSearchParams(window.location.search);
      next.set('dev', '1');
      window.location.search = next.toString();
    });
  }
})();