window.RawDeal = window.RawDeal || {};

window.RawDeal.Board = class Board {
  constructor(rootEl, cardPreview) {
    this.root = rootEl;
    this.cardPreview = cardPreview;
    this._state = null;
    this._hoveredCardEl = null;
    this.els = {
      phase: rootEl.querySelector('#rd-phase'),
      turn: rootEl.querySelector('#rd-turn'),
      playerSuperstar: rootEl.querySelector('#rd-player-superstar'),
      playerFortitude: rootEl.querySelector('#rd-player-fortitude'),
      opponentSuperstar: rootEl.querySelector('#rd-opponent-superstar'),
      opponentArsenalCount: rootEl.querySelector('#rd-opponent-arsenal-count'),
      playerArsenalCount: rootEl.querySelector('#rd-player-arsenal-count'),
      playerHand: rootEl.querySelector('#rd-player-hand'),
      playerManeuvers: rootEl.querySelector('#rd-player-maneuvers'),
      playerActions: rootEl.querySelector('#rd-player-actions'),
      playerReversals: rootEl.querySelector('#rd-player-reversals'),
      opponentArsenal: rootEl.querySelector('#rd-opponent-arsenal'),
      opponentRingside: rootEl.querySelector('#rd-opponent-ringside'),
      playerRingside: rootEl.querySelector('#rd-player-ringside'),
      endTurnBtn: rootEl.querySelector('#rd-end-turn'),
      gameOverPanel: rootEl.querySelector('#rd-game-over'),
      gameOverMessage: rootEl.querySelector('#rd-game-over-message'),
      restartBtn: rootEl.querySelector('#rd-restart'),
      log: rootEl.querySelector('#rd-log'),
      handScroll: rootEl.querySelector('#rd-hand-scroll'),
      reversalBanner: rootEl.querySelector('#rd-reversal-banner'),
      reversalBannerText: rootEl.querySelector('#rd-reversal-banner-text'),
    };
    this.onPlayCard = null;
    this.onEndTurn = null;
    this.onRestart = null;
    this._lastLogLength = 0;
    this._reversalBannerTimer = null;

    this.els.endTurnBtn.addEventListener('click', () => {
      if (this.onEndTurn) this.onEndTurn();
    });
    this.els.restartBtn.addEventListener('click', () => {
      if (this.onRestart) this.onRestart();
    });

    const hoverZone = rootEl.closest('.rd-play-layout') || rootEl;
    hoverZone.addEventListener('mouseover', (e) => this._onCardHover(e));
    hoverZone.addEventListener('mouseleave', () => {
      this._hoveredCardEl = null;
      if (this.cardPreview) this.cardPreview.clear();
    });

    window.addEventListener('resize', () => this._updateHandScroll());
  }

  _onCardHover(e) {
    const cardEl = e.target.closest('.rd-card[data-card-id]');
    if (!cardEl || cardEl.classList.contains('rd-card--preview')) return;
    if (!this.root.contains(cardEl)) return;
    if (cardEl === this._hoveredCardEl) return;

    this._hoveredCardEl = cardEl;
    const card = this._resolveCard(cardEl);
    if (card && this.cardPreview) this.cardPreview.show(card);
  }

  _resolveCard(cardEl) {
    const instanceId = cardEl.dataset.instanceId;
    const cardId = cardEl.dataset.cardId;
    if (!this._state) return window.RawDeal.CARDS[cardId] || null;

    const { players } = this._state;
    if (instanceId) {
      for (const player of players) {
        if (!player) continue;
        const pools = [
          player.hand,
          player.ring.maneuvers,
          player.ring.actions,
          player.ring.reversals,
          player.ringside,
        ];
        for (const pool of pools) {
          const found = pool.find((c) => c.instanceId === instanceId);
          if (found) return found;
        }
      }
    }
    return window.RawDeal.CARDS[cardId] || null;
  }

  render(state) {
    this._state = state;
    const player = state.players[0];
    const opponent = state.players[1];
    if (!player || !opponent) return;

    this.els.phase.textContent = this._formatPhase(state.phase);
    this.els.turn.textContent = `Turn ${state.turnNumber}`;
    this.els.playerSuperstar.textContent = player.superstar.name;
    this.els.playerFortitude.textContent = player.fortitude;
    this.els.opponentSuperstar.textContent = opponent.superstar.name;
    this.els.opponentArsenalCount.textContent = opponent.arsenalSize;
    this.els.playerArsenalCount.textContent = player.arsenalSize;

    this._renderHand(player, state.canPlay);
    this._renderRing(this.els.playerManeuvers, player.ring.maneuvers);
    this._renderRing(this.els.playerActions, player.ring.actions);
    this._renderRing(this.els.playerReversals, player.ring.reversals);
    this._renderRingside(this.els.opponentRingside, opponent.ringside);
    this._renderRingside(this.els.playerRingside, player.ringside);

    this.els.endTurnBtn.disabled = !state.canPlay;
    this.els.gameOverPanel.classList.toggle('hidden', state.phase !== window.RawDeal.PHASES.GAME_OVER);

    if (state.phase === window.RawDeal.PHASES.GAME_OVER) {
      this.els.gameOverMessage.textContent = this._winMessage(state);
    }

    if (state.damageLog.length > this._lastLogLength) {
      const last = state.damageLog[state.damageLog.length - 1];
      this._appendLog(this._formatDamageLog(last));
      this._lastLogLength = state.damageLog.length;
    }
  }

  _formatDamageLog(entry) {
    if (entry.result === 'reversed') {
      return `${entry.card} REVERSED by ${entry.reversedBy}!`;
    }
    if (entry.result === 'pinfall') {
      return `${entry.card} — PINFALL! (${entry.cardsOverturned} cards overturned)`;
    }
    return `${entry.card} — ${entry.damage} damage, ${entry.cardsOverturned} overturned`;
  }

  showReversalNotice(maneuver, reversalCard) {
    if (!this.els.reversalBanner) return;

    const text = `${maneuver.name} was reversed by ${reversalCard.name}!`;
    this.els.reversalBannerText.textContent = text;
    this.els.reversalBanner.classList.remove('hidden');
    this.els.reversalBanner.classList.add('rd-reversal-banner--active');

    clearTimeout(this._reversalBannerTimer);
    this._reversalBannerTimer = setTimeout(() => {
      this.els.reversalBanner.classList.remove('rd-reversal-banner--active');
      this.els.reversalBanner.classList.add('hidden');
    }, 3500);
  }

  _formatPhase(phase) {
    const labels = {
      setup: 'Setup',
      startOfTurn: 'Start of Turn',
      refresh: 'Refresh Step',
      draw: 'Draw Step',
      main: 'Main Step',
      resolvingDamage: 'Resolving Damage…',
      endOfTurn: 'End of Turn',
      opponentTurn: "Opponent's Turn",
      gameOver: 'Match Over',
    };
    return labels[phase] || phase;
  }

  _winMessage(state) {
    if (state.winner === 0) {
      return state.winReason === 'pinfall'
        ? 'PINFALL! You win!'
        : 'Count-out! You win!';
    }
    return 'You got counted out. Try again!';
  }

  _renderHand(player, canPlay) {
    const container = this.els.playerHand;
    window.RawDeal.CardRenderer.clearContainer(container);

    for (const card of player.hand) {
      const cost = this._cardCost(player, card);
      const affordable = player.fortitude >= cost;
      const playable = canPlay && card.type !== 'reversal' && affordable;
      const el = window.RawDeal.CardRenderer.createCardEl(card, {
        clickable: playable,
        onClick: playable
          ? () => {
              if (this.onPlayCard) this.onPlayCard(card.instanceId);
            }
          : undefined,
      });
      if (canPlay && card.type !== 'reversal' && !affordable) {
        el.classList.add('rd-card--unaffordable');
      }
      container.appendChild(el);
    }

    this._updateHandScroll();
  }

  _updateHandScroll() {
    const scrollEl = this.els.handScroll;
    if (!scrollEl) return;
    requestAnimationFrame(() => {
      const overflows = scrollEl.scrollWidth > scrollEl.clientWidth + 1;
      scrollEl.classList.toggle('rd-hand-scroll--overflow', overflows);
    });
  }

  _cardCost(player, card) {
    let cost = card.fortitude || 0;
    if (card.type === 'action' && player.deckId === 'rock') {
      cost = Math.max(0, cost - 1);
    }
    return cost;
  }

  _renderRing(container, cards) {
    window.RawDeal.CardRenderer.clearContainer(container);
    for (const card of cards.slice(-8)) {
      container.appendChild(window.RawDeal.CardRenderer.createCardEl(card, { small: true }));
    }
  }

  _renderRingside(container, cards) {
    window.RawDeal.CardRenderer.clearContainer(container);
    for (const card of cards.slice(-6)) {
      container.appendChild(window.RawDeal.CardRenderer.createCardEl(card, { small: true }));
    }
  }

  _appendLog(message) {
    const entry = document.createElement('div');
    entry.className = 'rd-log__entry';
    entry.textContent = message;
    this.els.log.prepend(entry);
    while (this.els.log.children.length > 4) {
      this.els.log.removeChild(this.els.log.lastChild);
    }
  }

  getOpponentArsenalEl() {
    return this.els.opponentArsenal;
  }

  getOpponentRingsideEl() {
    return this.els.opponentRingside;
  }
};