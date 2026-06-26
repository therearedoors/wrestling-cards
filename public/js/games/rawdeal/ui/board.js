window.RawDeal = window.RawDeal || {};

window.RawDeal.Board = class Board {
  constructor(rootEl, cardPreview, choiceModal = null, handRevealModal = null) {
    this.root = rootEl;
    this.cardPreview = cardPreview;
    this.choiceModal = choiceModal;
    this.handRevealModal = handRevealModal;
    if (this.choiceModal) {
      this.choiceModal.onSelect = (optionId) => {
        if (this.onChoiceSelect) this.onChoiceSelect(optionId);
      };
    }
    if (this.handRevealModal) {
      this.handRevealModal.onDismiss = () => {
        if (this.onDismissHandReveal) this.onDismissHandReveal();
      };
    }
    this._state = null;
    this._hoveredCardEl = null;
    this.els = {
      phase: rootEl.querySelector('#rd-phase'),
      turn: rootEl.querySelector('#rd-turn'),
      playerSuperstar: rootEl.querySelector('#rd-player-superstar'),
      playerFortitude: rootEl.querySelector('#rd-player-fortitude'),
      opponentSuperstar: rootEl.querySelector('#rd-opponent-superstar'),
      opponentArsenalCount: rootEl.querySelector('#rd-opponent-arsenal-count'),
      opponentHandCount: rootEl.querySelector('#rd-opponent-hand-count'),
      playerArsenalCount: rootEl.querySelector('#rd-player-arsenal-count'),
      playerHandCount: rootEl.querySelector('#rd-player-hand-count'),
      opponentSuperstarCard: rootEl.querySelector('#rd-opponent-superstar-card'),
      playerSuperstarCard: rootEl.querySelector('#rd-player-superstar-card'),
      playerHand: rootEl.querySelector('#rd-player-hand'),
      playerManeuvers: rootEl.querySelector('#rd-player-maneuvers'),
      playerActions: rootEl.querySelector('#rd-player-actions'),
      playerReversals: rootEl.querySelector('#rd-player-reversals'),
      opponentArsenal: rootEl.querySelector('#rd-opponent-arsenal'),
      opponentRingside: rootEl.querySelector('#rd-opponent-ringside'),
      playerArsenal: rootEl.querySelector('#rd-player-arsenal'),
      playerRingside: rootEl.querySelector('#rd-player-ringside'),
      endTurnBtn: rootEl.querySelector('#rd-end-turn'),
      passPriorityBtn: rootEl.querySelector('#rd-pass-priority'),
      reversalPrompt: rootEl.querySelector('#rd-reversal-prompt'),
      reversalPromptText: rootEl.querySelector('#rd-reversal-prompt-text'),
      superstarAbilityBtn: rootEl.querySelector('#rd-superstar-ability'),
      abilityPrompt: rootEl.querySelector('#rd-ability-prompt'),
      abilityPromptText: rootEl.querySelector('#rd-ability-prompt-text'),
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
    this.onUseSuperstarAbility = null;
    this.onAbilitySelect = null;
    this.onChoiceSelect = null;
    this.onPlayReversal = null;
    this.onPassPriority = null;
    this._lastLogLength = 0;
    this._lastActionLogLength = 0;
    this._reversalBannerTimer = null;

    this.els.endTurnBtn.addEventListener('click', () => {
      if (this.onEndTurn) this.onEndTurn();
    });
    if (this.els.passPriorityBtn) {
      this.els.passPriorityBtn.addEventListener('click', () => {
        if (this.onPassPriority) this.onPassPriority();
      });
    }
    if (this.els.superstarAbilityBtn) {
      this.els.superstarAbilityBtn.addEventListener('click', () => {
        if (this.onUseSuperstarAbility) this.onUseSuperstarAbility();
      });
    }
    if (this.els.restartBtn) {
      this.els.restartBtn.addEventListener('click', () => {
        if (this.onRestart) this.onRestart();
      });
    }

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
    if (cardId) {
      for (const player of players) {
        if (player?.superstar?.id === cardId) return player.superstar;
      }
    }
    if (instanceId) {
      const revealCards = this._state.handReveal?.cards;
      if (revealCards) {
        const revealed = revealCards.find((c) => c.instanceId === instanceId);
        if (revealed) return revealed;
      }

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
    if (this.els.opponentHandCount) {
      this.els.opponentHandCount.textContent = opponent.handSize;
    }
    if (this.els.playerHandCount) {
      this.els.playerHandCount.textContent = player.handSize;
    }

    this._renderSuperstarCard(this.els.opponentSuperstarCard, opponent.superstar);
    this._renderSuperstarCard(this.els.playerSuperstarCard, player.superstar);

    const ability = state.superstarAbility || {};
    const activePrompt = state.selectionPrompt || ability.prompt;

    this._renderChoiceModal(activePrompt);
    this._renderHandReveal(state.handReveal);
    this._renderSuperstarAbility(player, ability, state.canPlay, activePrompt);
    this._renderAbilityPrompt(activePrompt);
    this._renderReversalPrompt(state.reversalWindow);
    this._renderHand(player, state.canPlay, activePrompt, state.reversalWindow, state.handReveal);
    this._renderRing(this.els.playerManeuvers, player.ring.maneuvers);
    this._renderRing(this.els.playerActions, player.ring.actions);
    this._renderRing(this.els.playerReversals, player.ring.reversals);
    this._renderRingside(this.els.opponentRingside, opponent.ringside);
    this._renderRingside(this.els.playerRingside, player.ringside, activePrompt);

    this.els.endTurnBtn.disabled =
      !state.canPlay || !!activePrompt || !!state.handReveal || !!state.reversalWindow?.canRespond;
    if (this.els.passPriorityBtn) {
      this.els.passPriorityBtn.classList.toggle('hidden', !state.reversalWindow?.canRespond);
      this.els.passPriorityBtn.disabled = !state.reversalWindow?.canRespond;
    }
    this.els.gameOverPanel.classList.toggle('hidden', state.phase !== window.RawDeal.PHASES.GAME_OVER);

    if (state.phase === window.RawDeal.PHASES.GAME_OVER) {
      this.els.gameOverMessage.textContent = this._winMessage(state);
    }

    if (state.damageLog.length > this._lastLogLength) {
      const last = state.damageLog[state.damageLog.length - 1];
      this._appendLog(this._formatDamageLog(last));
      this._lastLogLength = state.damageLog.length;
    }

    if (state.actionLog && state.actionLog.length > this._lastActionLogLength) {
      const last = state.actionLog[state.actionLog.length - 1];
      this._appendLog(last.message);
      this._lastActionLogLength = state.actionLog.length;
    }
  }

  _renderSuperstarAbility(player, ability, canPlay, activePrompt) {
    const btn = this.els.superstarAbilityBtn;
    if (!btn) return;

    const show = ability.supported && canPlay;
    btn.classList.toggle('hidden', !show);

    if (!show) return;

    const label = ability.label || 'Superstar Ability';
    btn.textContent = label;
    btn.title = player.superstar.ability || label;
    btn.disabled = !ability.canUse || ability.used || !!activePrompt;
  }

  _renderChoiceModal(prompt) {
    if (!this.choiceModal) return;
    if (prompt?.mode === 'choice') {
      this.choiceModal.show(prompt);
    } else {
      this.choiceModal.hide();
    }
  }

  _renderHandReveal(handReveal) {
    if (!this.handRevealModal) return;
    if (handReveal) {
      this.handRevealModal.show(handReveal);
    } else {
      this.handRevealModal.hide();
    }
  }

  _renderAbilityPrompt(prompt) {
    const panel = this.els.abilityPrompt;
    const text = this.els.abilityPromptText;
    if (!panel || !text) return;

    const active = !!prompt && prompt.mode !== 'choice';
    panel.classList.toggle('hidden', !active);
    if (active) {
      text.textContent = prompt.message;
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
      reversalPriority: 'Reversal Window',
      resolvingDamage: 'Resolving Damage…',
      endOfTurn: 'End of Turn',
      opponentTurn: "Opponent's Turn",
      gameOver: 'Match Over',
    };
    return labels[phase] || phase;
  }

  _winMessage(state) {
    const myIndex = state.myIndex ?? 0;
    if (state.winner === myIndex) {
      if (state.winReason === 'pinfall') return 'PINFALL! You win!';
      if (state.winReason === 'forfeit') return 'Opponent left — you win!';
      return 'Count-out! You win!';
    }
    if (state.winReason === 'forfeit') return 'You left the match.';
    if (state.winReason === 'pinfall') return 'PINFALL! You lose.';
    return 'You got counted out. Try again!';
  }

  _renderReversalPrompt(reversalWindow) {
    const panel = this.els.reversalPrompt;
    const text = this.els.reversalPromptText;
    if (!panel || !text) return;

    const active = !!reversalWindow?.active;
    panel.classList.toggle('hidden', !active);
    if (!active) return;

    const m = reversalWindow.maneuver;
    if (reversalWindow.canRespond) {
      if (reversalWindow.kind === 'action') {
        text.textContent = `Opponent played ${m.name} as an Action — play a Reversal from hand or Pass.`;
      } else {
        text.textContent = `Opponent played ${m.name} (${m.damage}D) — play a Reversal from hand or Pass.`;
      }
    } else if (reversalWindow.kind === 'action') {
      text.textContent = `Waiting for opponent to respond to ${m.name} (Action)…`;
    } else {
      text.textContent = `Waiting for opponent to respond to ${m.name}…`;
    }
  }

  _renderHand(player, canPlay, abilityPrompt, reversalWindow, handReveal = null) {
    const container = this.els.playerHand;
    window.RawDeal.CardRenderer.clearContainer(container);

    const abilityHandMode = abilityPrompt?.mode === 'hand';
    const reversalMode = reversalWindow?.canRespond;
    const handRevealActive = !!handReveal;

    const utils = window.RawDeal.CardUtils;

    for (const card of player.hand) {
      const isReversalCard = utils.hasType(card, 'reversal') || (card.reverses && card.reverses.length > 0);
      const canReversal =
        reversalMode &&
        isReversalCard &&
        reversalWindow.maneuver &&
        (reversalWindow.kind === 'action'
          ? this._canReverseAction(card, reversalWindow.maneuver, player)
          : this._canReverseManeuver(card, reversalWindow.maneuver, player, reversalWindow));
      const maneuverCost = utils.playFortitudeCost(card, 'maneuver');
      const actionCost = utils.playFortitudeCost(card, 'action');
      const affordableManeuver = player.fortitude >= maneuverCost;
      const affordableAction = player.fortitude >= actionCost;
      const meetsManeuverReq = utils.meetsPlayRequirement(player, card, 'maneuver');
      const canManeuver =
        canPlay &&
        !abilityPrompt &&
        !handRevealActive &&
        utils.canPlayFromHandAs(card, 'maneuver') &&
        affordableManeuver &&
        meetsManeuverReq;
      const canAction =
        canPlay &&
        !abilityPrompt &&
        !handRevealActive &&
        utils.canPlayFromHandAs(card, 'action') &&
        affordableAction;
      const selected = abilityPrompt?.selectedIds?.includes(card.instanceId);
      const selectedCount = abilityPrompt?.selectedIds?.length || 0;
      const selectable =
        abilityHandMode && !selected && selectedCount < (abilityPrompt.count || 1);
      const isHybrid = utils.isHybrid(card);

      const playZones = isHybrid
        ? this._buildHybridPlayZones(card, { canManeuver, canAction, canReversal })
        : null;

      const el = window.RawDeal.CardRenderer.createCardEl(card, {
        clickable: !isHybrid && (canManeuver || canAction || selectable || canReversal),
        playZones,
        onClick: !isHybrid && canReversal
          ? () => {
              if (this.onPlayReversal) this.onPlayReversal(card.instanceId);
            }
          : !isHybrid && canManeuver
            ? () => {
                if (this.onPlayCard) this.onPlayCard(card.instanceId, 'maneuver');
              }
            : !isHybrid && canAction
              ? () => {
                  if (this.onPlayCard) this.onPlayCard(card.instanceId, 'action');
                }
              : selectable
                ? () => {
                    if (this.onAbilitySelect) this.onAbilitySelect(card.instanceId);
                  }
                : undefined,
      });

      if (
        canPlay &&
        !abilityPrompt &&
        !isHybrid &&
        ((utils.canPlayFromHandAs(card, 'maneuver') && !affordableManeuver) ||
          (utils.canPlayFromHandAs(card, 'action') && !affordableAction))
      ) {
        el.classList.add('rd-card--unaffordable');
      }
      if (
        canPlay &&
        !abilityPrompt &&
        utils.canPlayFromHandAs(card, 'maneuver') &&
        !meetsManeuverReq
      ) {
        el.classList.add('rd-card--blocked');
        el.title = 'Requires Irish Whip this turn';
      }
      if (selected) {
        el.classList.add('rd-card--selected');
      }
      if (selectable || canReversal) {
        el.classList.add('rd-card--ability-target');
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

  _buildHybridPlayZones(card, { canManeuver, canAction, canReversal = false }) {
    const zones = {};
    const utils = window.RawDeal.CardUtils;

    for (const type of utils.getTypes(card)) {
      if (type === 'reversal') {
        zones[type] = {
          playable: canReversal,
          onClick: canReversal
            ? () => {
                if (this.onPlayReversal) this.onPlayReversal(card.instanceId);
              }
            : undefined,
        };
        continue;
      }

      if (!utils.HAND_PLAY_MODES.includes(type)) {
        zones[type] = { playable: false };
        continue;
      }
      const playable = type === 'maneuver' ? canManeuver : type === 'action' ? canAction : false;
      zones[type] = {
        playable,
        onClick: playable
          ? () => {
              if (this.onPlayCard) this.onPlayCard(card.instanceId, type);
            }
          : undefined,
      };
    }
    return zones;
  }

  _cardCost(player, card, playAs = 'maneuver') {
    return window.RawDeal.CardUtils.playFortitudeCost(card, playAs);
  }

  _canReverseManeuver(card, maneuver, player, reversalWindow = null) {
    return window.RawDeal.CardUtils.canReverseManeuver(
      card,
      maneuver,
      player.fortitude,
      maneuver.damage,
      {
        afterIrishWhip: reversalWindow?.maneuver?.afterIrishWhip ?? false,
        reversalFortitudeTax: reversalWindow?.maneuver?.reversalFortitudeTax ?? 0,
      }
    );
  }

  _canReverseAction(card, action, player) {
    return window.RawDeal.CardUtils.canReverseAction(
      card,
      { id: action.id, types: action.types || ['action'] },
      player.fortitude
    );
  }

  _renderSuperstarCard(container, superstar) {
    if (!container) return;
    window.RawDeal.CardRenderer.clearContainer(container);
    if (!superstar) return;

    const el = window.RawDeal.CardRenderer.createCardEl(superstar, { small: true });
    el.classList.add('rd-card--superstar-board');
    container.appendChild(el);
  }

  _renderRing(container, cards) {
    window.RawDeal.CardRenderer.clearContainer(container);
    for (const card of cards.slice(-8)) {
      container.appendChild(window.RawDeal.CardRenderer.createCardEl(card, { small: true }));
    }
  }

  _renderRingside(container, cards, abilityPrompt) {
    window.RawDeal.CardRenderer.clearContainer(container);
    const ringsideMode = abilityPrompt?.mode === 'ringside';
    const visible = ringsideMode ? cards : cards.slice(-6);

    for (const card of visible) {
      const selectable = ringsideMode;
      const el = window.RawDeal.CardRenderer.createCardEl(card, {
        small: true,
        clickable: selectable,
        onClick: selectable
          ? () => {
              if (this.onAbilitySelect) this.onAbilitySelect(card.instanceId);
            }
          : undefined,
      });
      if (selectable) {
        el.classList.add('rd-card--ability-target');
      }
      container.appendChild(el);
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

  /**
   * Append one card to ringside when a flip animation reveals it (multiplayer).
   * viewerPlayerIndex: 0 = you, 1 = opponent (remapped viewer coordinates).
   */
  revealFlippedCard(viewerPlayerIndex, card) {
    const container =
      viewerPlayerIndex === 0 ? this.els.playerRingside : this.els.opponentRingside;
    const arsenalCountEl =
      viewerPlayerIndex === 0 ? this.els.playerArsenalCount : this.els.opponentArsenalCount;

    const el = window.RawDeal.CardRenderer.createCardEl(card, { small: true });
    container.appendChild(el);

    const cards = container.querySelectorAll('.rd-card');
    const excess = cards.length - 6;
    for (let i = 0; i < excess; i++) {
      cards[i].remove();
    }

    if (arsenalCountEl) {
      const n = parseInt(arsenalCountEl.textContent, 10) || 0;
      arsenalCountEl.textContent = Math.max(0, n - 1);
    }

    const player = this._state?.players?.[viewerPlayerIndex];
    if (player) {
      player.ringside = [...(player.ringside || []), card];
      player.arsenalSize = Math.max(0, (player.arsenalSize || 0) - 1);
    }
  }

  getOpponentArsenalEl() {
    return this.els.opponentArsenal;
  }

  getOpponentRingsideEl() {
    return this.els.opponentRingside;
  }

  getPlayerArsenalEl() {
    return this.els.playerArsenal;
  }

  getPlayerRingsideEl() {
    return this.els.playerRingside;
  }
};