window.RawDeal = window.RawDeal || {};

window.RawDeal.GameEngine = class GameEngine {
  constructor(options = {}) {
    this.engineMode = options.engineMode || 'goldfish';
    this.onStateChange = options.onStateChange || (() => {});
    this.onDamageStep = options.onDamageStep || (async () => {});
    this.onArsenalToRingside =
      options.onArsenalToRingside || (async ({ onReveal }) => { if (onReveal) onReveal(); });
    this.stateMachine = new window.RawDeal.StateMachine(this.engineMode);
    this.stateMachine.onTransition(() => this._notify());
    this.reset();
  }

  reset() {
    this.players = [null, null];
    this.winner = null;
    this.winReason = null;
    this.nextManeuverBonus = [0, 0];
    this.turnDamageBonus = [this._emptyTurnDamageBonus(), this._emptyTurnDamageBonus()];
    this.damageLog = [];
    this.actionLog = [];
    this.abilityFlow = null;
    this.cardEffectFlow = null;
    this.pendingManeuverResolution = null;
    this.reversalWindow = null;
    this.handRevealFlow = null;
    this.effectPipelineFlow = null;
    this.animationEvents = [];
    this.stateMachine.phase = window.RawDeal.PHASES.SETUP;
    this.stateMachine.activePlayer = 0;
    this.stateMachine.turnNumber = 0;
    this._notify();
  }

  _notify() {
    this.onStateChange(this.getPublicState());
  }

  _emptyTurnDamageBonus() {
    return { all: 0, strike: 0, grapple: 0, submission: 0 };
  }

  _emptyTurnState() {
    return {
      irishWhipPlayed: false,
      nextStrikeBonus: 0,
      nextGrappleBonus: 0,
      nextGrappleReversalTax: 0,
      nextManeuverReversalTax: 0,
      opponentReversalsBlocked: false,
    };
  }

  _clearTurnSetupEffects(player) {
    if (!player?.turnState) return;
    player.turnState.irishWhipPlayed = false;
    player.turnState.nextStrikeBonus = 0;
    player.turnState.nextGrappleBonus = 0;
    player.turnState.nextGrappleReversalTax = 0;
    player.turnState.nextManeuverReversalTax = 0;
    player.turnState.opponentReversalsBlocked = false;
  }

  _getManeuverReversalFortitudeTax(attacker, maneuver) {
    if (!attacker?.turnState) return 0;
    let tax = attacker.turnState.nextManeuverReversalTax || 0;
    if (maneuver.subtype === 'grapple') {
      tax += attacker.turnState.nextGrappleReversalTax || 0;
    }
    return tax;
  }

  _clearNextManeuverReversalTax(player) {
    if (player?.turnState?.nextManeuverReversalTax) {
      player.turnState.nextManeuverReversalTax = 0;
    }
  }

  _playerIndex(player) {
    if (player.seatIndex !== undefined) return player.seatIndex;
    return player.isHuman ? 0 : 1;
  }

  _activePlayerIndex() {
    return this.stateMachine.activePlayer;
  }

  _addTurnDamageBonus(player, { all = 0, subtype, value = 0, sourceName }) {
    const idx = this._playerIndex(player);
    const bonuses = this.turnDamageBonus[idx];

    if (all) {
      bonuses.all += all;
      this.actionLog.push({
        message: `${sourceName}: all maneuvers +${all}D for the rest of this turn.`,
      });
    }

    if (subtype && value) {
      bonuses[subtype] = (bonuses[subtype] || 0) + value;
      const label = subtype.charAt(0).toUpperCase() + subtype.slice(1);
      this.actionLog.push({
        message: `${sourceName}: ${label} maneuvers +${value}D for the rest of this turn.`,
      });
    }
  }

  getPublicState(viewerIndex = 0) {
    return {
      phase: this.stateMachine.phase,
      activePlayer: this.stateMachine.activePlayer,
      turnNumber: this.stateMachine.turnNumber,
      engineMode: this.engineMode,
      players: this.players.map((p) => (p ? this._publicPlayer(p, viewerIndex) : null)),
      winner: this.winner,
      winReason: this.winReason,
      damageLog: [...this.damageLog],
      actionLog: [...this.actionLog],
      canPlay: this.stateMachine.canPlayCards(viewerIndex),
      selectionPrompt: this._publicSelectionPrompt(viewerIndex),
      superstarAbility: this._publicSuperstarAbility(viewerIndex),
      reversalWindow: this._publicReversalWindow(viewerIndex),
      handReveal: this._publicHandReveal(viewerIndex),
      animationEvents: this.animationEvents.map((e) => ({ ...e })),
    };
  }

  _publicHandReveal(viewerIndex) {
    return window.RawDeal.EffectPipeline.publicHandReveal(this, viewerIndex);
  }

  async _startEffectPipeline(player, sourceName, steps, timing = 'action', sourceCard = null) {
    return window.RawDeal.EffectPipeline.start(
      this,
      player,
      sourceName,
      steps,
      timing,
      sourceCard
    );
  }

  dismissHandReveal(playerIndex) {
    return window.RawDeal.EffectPipeline.resume(this, playerIndex, { skipped: false });
  }

  skipHandReveal(playerIndex) {
    return window.RawDeal.EffectPipeline.resume(this, playerIndex, { skipped: true });
  }

  confirmHandRevealSelection(playerIndex, instanceIds) {
    return window.RawDeal.EffectPipeline.resume(this, playerIndex, { selectedIds: instanceIds });
  }

  toggleHandRevealSelection(playerIndex, instanceId) {
    return window.RawDeal.EffectPipeline.toggleSelection(this, playerIndex, instanceId);
  }

  clearAnimationEvents() {
    this.animationEvents = [];
  }

  _publicReversalWindow(viewerIndex) {
    if (!this.reversalWindow) return null;
    const { attackerIndex, defenderIndex, played, damage, kind = 'maneuver' } = this.reversalWindow;
    return {
      active: true,
      kind,
      attackerIndex,
      defenderIndex,
      canRespond: viewerIndex === defenderIndex,
      maneuver: {
        id: played.id,
        name: played.name,
        subtype: played.subtype,
        damage: kind === 'action' ? 0 : damage,
        afterIrishWhip: kind === 'maneuver'
          ? !!this.players[attackerIndex]?.turnState?.irishWhipPlayed
          : false,
        reversalFortitudeTax:
          kind === 'maneuver'
            ? this._getManeuverReversalFortitudeTax(
                this.players[attackerIndex],
                played
              )
            : 0,
      },
    };
  }

  _publicSelectionPrompt(viewerIndex = 0) {
    if (this.cardEffectFlow?.playerIndex !== viewerIndex) return null;

    const flow = this.cardEffectFlow;
    if (flow.type === 'choice') {
      return {
        mode: 'choice',
        message: flow.message,
        options: flow.options.map((o) => ({ ...o })),
      };
    }

    if (flow.type === 'discardFromHand') {
      const n = flow.count || 1;
      const picked = flow.selectedIds.length;
      const message =
        n === 1
          ? `${flow.sourceName}: discard 1 card from your hand to Ringside before damage is applied.`
          : `${flow.sourceName}: discard ${n} cards from your hand to Ringside before damage (${picked}/${n}).`;
      return {
        mode: 'hand',
        count: n,
        message,
        selectedIds: [...flow.selectedIds],
      };
    }

    if (flow.type === 'opponentDiscardFromHand') {
      const n = flow.count || 1;
      const picked = flow.selectedIds.length;
      const message =
        n === 1
          ? `${flow.sourceName}: choose 1 card from your hand to discard to Ringside.`
          : `${flow.sourceName}: choose ${n} cards from your hand to discard to Ringside (${picked}/${n}).`;
      return {
        mode: 'hand',
        count: n,
        message,
        selectedIds: [...flow.selectedIds],
      };
    }

    return null;
  }

  _publicSuperstarAbility(viewerIndex = 0) {
    const player = this.players[viewerIndex];
    if (!player) {
      return { supported: false, canUse: false, used: false, label: null, prompt: null };
    }

    const id = player.superstar.id;
    const supported = id === 'stone-cold' || id === 'undertaker';
    const labels = {
      'stone-cold': 'Draw & Bottom',
      'undertaker': 'Ringside Salvage',
    };

    let prompt = null;
    if (this.abilityFlow?.playerIndex === viewerIndex) {
      const flow = this.abilityFlow;
      if (flow.step === 'pickBottom') {
        prompt = {
          mode: 'hand',
          count: 1,
          message: 'Drew 1 card — choose a card from your hand to put on the bottom of your Arsenal.',
          selectedIds: [],
        };
      } else if (flow.step === 'pickDiscard') {
        prompt = {
          mode: 'hand',
          count: 2,
          message: `Choose 2 cards from your hand to discard to Ringside (${flow.discardSelected.length}/2).`,
          selectedIds: [...flow.discardSelected],
        };
      } else if (flow.step === 'pickRingside') {
        prompt = {
          mode: 'ringside',
          count: 1,
          message: 'Choose 1 card from your Ringside to put into your hand.',
          selectedIds: [],
        };
      }
    }

    return {
      supported,
      canUse: this.canUseSuperstarAbility(viewerIndex),
      used: player.superstarAbilityUsed,
      label: labels[id] || null,
      prompt,
    };
  }

  _publicPlayer(player, viewerIndex = 0) {
    const seat = this._playerIndex(player);
    const showHand = this.engineMode === 'multiplayer'
      ? seat === viewerIndex
      : player.isHuman;
    return {
      superstar: player.superstar,
      deckId: player.deckId,
      username: player.username || null,
      handSize: player.hand.length,
      arsenalSize: player.arsenal.length,
      ringsideSize: player.ringside.length,
      fortitude: player.fortitude,
      hand: showHand ? player.hand : [],
      ring: player.ring,
      ringside: player.ringside,
      arsenal: player.arsenal,
      turnState: player.turnState ? { ...player.turnState } : this._emptyTurnState(),
      isHuman: showHand,
      seatIndex: seat,
    };
  }

  startGame(playerDeckId, opponentDeckId = 'austin', decks = null, options = {}) {
    const { CARDS } = window.RawDeal;
    const deckMap = decks || window.RawDeal.DeckStore?.getResolvedDecks() || window.RawDeal.DECKS;
    const playerDeck = deckMap[playerDeckId];
    const opponentDeck = deckMap[opponentDeckId];

    const multiplayer = this.engineMode === 'multiplayer';
    this.players[0] = this._createPlayer(playerDeck, 0, true, options.player0);
    this.players[1] = this._createPlayer(
      opponentDeck,
      1,
      multiplayer,
      options.player1
    );

    const firstPlayer =
      this.players[0].superstar.superstarValue >= this.players[1].superstar.superstarValue ? 0 : 1;

    this._dealOpeningHands();
    this.stateMachine.transition(window.RawDeal.EVENTS.START_GAME, { firstPlayer });
    this._runAutoPhases();
  }

  _createPlayer(deck, seatIndex, isHuman, meta = {}) {
    const arsenal = this._shuffle([...deck.arsenal]);
    return {
      superstar: { ...window.RawDeal.CARDS[deck.superstarId] },
      arsenal,
      hand: [],
      ringside: [],
      ring: { maneuvers: [], actions: [], reversals: [] },
      fortitude: 0,
      superstarAbilityUsed: false,
      turnState: this._emptyTurnState(),
      isHuman,
      seatIndex,
      deckId: deck.id,
      username: meta.username || null,
      userId: meta.userId || null,
    };
  }

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  _dealOpeningHands() {
    for (const player of this.players) {
      const count = player.superstar.handSize;
      for (let i = 0; i < count; i++) {
        if (player.arsenal.length > 0) {
          player.hand.push(player.arsenal.pop());
        }
      }
    }
  }

  _calcFortitude(player) {
    let total = 0;
    for (const card of [...player.ring.maneuvers, ...player.ring.reversals]) {
      total += card.damage || 0;
    }
    return total;
  }

  _syncFortitude(player) {
    player.fortitude = this._calcFortitude(player);
  }

  _drawCard(player) {
    if (player.arsenal.length === 0) return null;
    const card = player.arsenal.pop();
    player.hand.push(card);
    return card;
  }

  async _runAutoPhases() {
    const { PHASES, EVENTS } = window.RawDeal;

    while (
      this.stateMachine.phase !== PHASES.MAIN &&
      this.stateMachine.phase !== PHASES.GAME_OVER &&
      this.stateMachine.phase !== PHASES.SETUP
    ) {
      const phase = this.stateMachine.phase;
      const active = this.players[this.stateMachine.activePlayer];

      if (phase === PHASES.START_OF_TURN) {
        this.stateMachine.transition(null);
        continue;
      }

      if (phase === PHASES.REFRESH) {
        if (active.isHuman) {
          active.superstarAbilityUsed = false;
          this.abilityFlow = null;
          this.cardEffectFlow = null;
          this.pendingManeuverResolution = null;
        }
        this.turnDamageBonus[this.stateMachine.activePlayer] = this._emptyTurnDamageBonus();
        active.turnState = this._emptyTurnState();
        this._syncFortitude(active);
        this.stateMachine.transition(EVENTS.REFRESH_DONE);
        continue;
      }

      if (phase === PHASES.DRAW) {
        const drawCount = active.superstar.id === 'mankind' ? 2 : 1;
        for (let d = 0; d < drawCount; d++) {
          this._drawCard(active);
        }
        this.stateMachine.transition(EVENTS.DRAW_DONE);
        continue;
      }

      if (phase === PHASES.OPPONENT_TURN) {
        if (this.engineMode === 'multiplayer') {
          break;
        }
        await this._delay(400);
        this.stateMachine.transition(EVENTS.OPPONENT_DONE);
        continue;
      }

      if (phase === PHASES.END_OF_TURN) {
        this._clearTurnSetupEffects(active);
        const opponent = this.players[1 - this.stateMachine.activePlayer];
        const gameOver = this._checkCountOut(opponent);
        this.stateMachine.transition(null, { gameOver });
        if (!gameOver) continue;
        break;
      }

      break;
    }

    this._notify();
  }

  _checkCountOut(player) {
    if (player.arsenal.length === 0) {
      this.winner = 1 - this._playerIndex(player);
      this.winReason = window.RawDeal.WIN_REASONS.COUNT_OUT;
      return true;
    }
    return false;
  }

  _effectiveFortitudeCost(player, card, playAs = 'maneuver') {
    return window.RawDeal.CardUtils.playFortitudeCost(card, playAs);
  }

  canPlayCard(playerIndex, instanceId, playAs) {
    if (
      !this.stateMachine.canPlayCards(playerIndex) ||
      this.cardEffectFlow ||
      this.reversalWindow ||
      window.RawDeal.EffectPipeline.isPaused(this, playerIndex)
    ) {
      return false;
    }

    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;

    const utils = window.RawDeal.CardUtils;
    const mode =
      playAs || (utils.canPlayFromHandAs(card, 'maneuver') ? 'maneuver' : utils.primaryType(card));
    if (!utils.canPlayFromHandAs(card, mode)) return false;
    if (!utils.meetsPlayRequirement(player, card, mode)) return false;

    const cost = this._effectiveFortitudeCost(player, card, mode);
    return player.fortitude >= cost;
  }

  async playCard(playerIndex, instanceId, playAs) {
    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    const utils = window.RawDeal.CardUtils;
    const mode =
      playAs || (utils.canPlayFromHandAs(card, 'maneuver') ? 'maneuver' : utils.primaryType(card));

    if (!this.canPlayCard(playerIndex, instanceId, mode)) return false;

    const opponent = this.players[1 - playerIndex];
    const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
    const played = player.hand.splice(handIndex, 1)[0];

    if (mode === 'action') {
      if (this._openActionReversalWindowOrPlay(player, opponent, played)) {
        return true;
      }
      await this._playFromHandAsAction(player, played);
      this._notify();
      return true;
    }

    if (mode === 'maneuver' || mode === 'reversal') {
      const ringArea = mode === 'reversal' ? player.ring.reversals : player.ring.maneuvers;
      ringArea.push(played);
      this._syncFortitude(player);

      const damage = this._calcManeuverDamage(player, opponent, played);

      return this._openReversalWindowOrApplyDamage(player, opponent, played, damage);
    } else if (window.RawDeal.CardUtils.hasType(played, 'action')) {
      await this._playFromHandAsAction(player, played);
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
  }

  async _playFromHandAsAction(player, card) {
    const firstOp = card.actionEffects?.[0]?.op;

    if (firstOp === 'discardSelfToDraw') {
      player.ringside.push(card);
      const draws = card.actionEffects[0].count || 1;
      for (let i = 0; i < draws; i++) {
        this._drawCard(player);
      }
      this.actionLog.push({
        message: `${card.name} (action): discarded to draw ${draws} card${draws === 1 ? '' : 's'}.`,
      });
      return;
    }

    player.ring.actions.push(card);
    this.actionLog.push({
      message: `${card.name} played as an action.`,
    });

    if (card.actionEffects?.length) {
      await this._startEffectPipeline(player, card.name, card.actionEffects, 'action');
    }
  }

  _peekManeuverDamage(player, opponent, played) {
    const idx = this._playerIndex(player);
    let damage = played.damage || 0;
    if (opponent.superstar.id === 'mankind' && damage > 0) {
      damage = Math.max(0, damage - 1);
    }
    damage += this.nextManeuverBonus[idx];

    const turnBonus = this.turnDamageBonus[idx];
    damage += turnBonus.all || 0;
    const subtype = played.subtype;
    if (subtype && turnBonus[subtype]) {
      damage += turnBonus[subtype];
    }

    if (played.subtype === 'strike' && player.turnState?.nextStrikeBonus) {
      damage += player.turnState.nextStrikeBonus;
    }

    if (played.subtype === 'grapple' && player.turnState?.nextGrappleBonus) {
      damage += player.turnState.nextGrappleBonus;
    }

    return damage;
  }

  _calcManeuverDamage(player, opponent, played) {
    const damage = this._peekManeuverDamage(player, opponent, played);
    const idx = this._playerIndex(player);
    this.nextManeuverBonus[idx] = 0;

    if (played.subtype === 'strike' && player.turnState?.nextStrikeBonus) {
      player.turnState.nextStrikeBonus = 0;
    }

    if (played.subtype === 'grapple' && player.turnState?.nextGrappleBonus) {
      player.turnState.nextGrappleBonus = 0;
    }

    return damage;
  }

  _applyNextStrikeBonus(player, sourceName, bonus) {
    if (!player.turnState) player.turnState = this._emptyTurnState();
    player.turnState.nextStrikeBonus = bonus;
    this.actionLog.push({
      message: `${sourceName}: your next Strike maneuver is +${bonus}D this turn.`,
    });
  }

  _applyIrishWhipSetup(player, card, strikeBonus = 5) {
    if (!player.turnState) player.turnState = this._emptyTurnState();
    player.turnState.irishWhipPlayed = true;
    this._applyNextStrikeBonus(player, card.name, strikeBonus);
  }

  _beginJockeyingChoice(player, playerIndex, sourceName) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'jockeyingForPosition',
      playerIndex,
      sourceName,
      message: `${sourceName}: choose an effect for your next Grapple maneuver.`,
      options: [
        { id: 'grappleDamage', label: 'Next Grapple +4D' },
        { id: 'grappleReversalTax', label: "Opponent's reversal to it +8F" },
      ],
    };
    this._notify();
    return true;
  }

  _beginDiscardFromHandPrompt(player, playerIndex, sourceName, count) {
    if (player.hand.length === 0) {
      this.actionLog.push({
        message: `${sourceName}: no cards in hand to discard.`,
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'discardFromHand',
      playerIndex,
      sourceName,
      count,
      selectedIds: [],
    };
    this._notify();
    return true;
  }

  _beginDrawOrOpponentChoice(player, playerIndex, sourceName, count) {
    this.cardEffectFlow = {
      type: 'choice',
      choiceId: 'drawOrOpponentDiscard',
      playerIndex,
      sourceName,
      count,
      message: `${sourceName}: choose one.`,
      options: [
        { id: 'draw', label: `Draw ${count} cards` },
        { id: 'opponentDiscard', label: `Opponent discards ${count} cards` },
      ],
    };
    this._notify();
    return true;
  }

  _drawForOpponent(player, sourceName, count) {
    const opponent = this.players[1 - this._playerIndex(player)];
    let drawn = 0;

    for (let i = 0; i < count; i++) {
      if (this._drawCard(opponent)) drawn += 1;
    }

    if (drawn > 0) {
      this.actionLog.push({
        message: `${sourceName}: opponent drew ${drawn} card${drawn === 1 ? '' : 's'}.`,
      });
    } else {
      this.actionLog.push({
        message: `${sourceName}: opponent had no cards in Arsenal to draw.`,
      });
    }
  }

  _beginOpponentDiscardFromHandEffect(player, opponent, sourceName, count) {
    const autoPick = this.engineMode === 'goldfish' || !opponent.isHuman;

    if (autoPick) {
      const { count: discarded, cards } = this._forceOpponentDiscardFromHand(opponent, count);
      if (discarded > 0) {
        const names = cards.map((c) => c.name).join(', ');
        this.actionLog.push({
          message: `${sourceName}: opponent discarded ${names} to Ringside.`,
        });
      } else {
        this.actionLog.push({
          message: `${sourceName}: opponent had no cards in hand to discard.`,
        });
      }
      return false;
    }

    return this._beginOpponentDiscardFromHandPrompt(
      opponent,
      this._playerIndex(opponent),
      sourceName,
      count
    );
  }

  _forceOpponentDiscard(opponent, count) {
    const autoPick = this.engineMode === 'goldfish' || !opponent.isHuman;
    const discardedCards = [];

    for (let i = 0; i < count; i++) {
      if (autoPick && opponent.hand.length > 0) {
        const idx = Math.floor(Math.random() * opponent.hand.length);
        discardedCards.push(opponent.hand.splice(idx, 1)[0]);
        continue;
      }
      if (opponent.arsenal.length === 0) break;
      discardedCards.push(opponent.arsenal.pop());
    }

    for (const card of discardedCards) {
      opponent.ringside.push(card);
    }

    return { count: discardedCards.length, cards: discardedCards };
  }

  _forceOpponentDiscardFromHand(opponent, count) {
    const discardedCards = [];

    for (let i = 0; i < count; i++) {
      if (opponent.hand.length === 0) break;
      const idx = Math.floor(Math.random() * opponent.hand.length);
      discardedCards.push(opponent.hand.splice(idx, 1)[0]);
    }

    for (const card of discardedCards) {
      opponent.ringside.push(card);
    }

    return { count: discardedCards.length, cards: discardedCards };
  }

  _beginOpponentDiscardFromHandPrompt(opponent, opponentIndex, sourceName, count) {
    if (opponent.hand.length === 0) {
      this.actionLog.push({
        message: `${sourceName}: opponent had no cards in hand to discard.`,
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'opponentDiscardFromHand',
      playerIndex: opponentIndex,
      sourceName,
      count,
      selectedIds: [],
    };
    this._notify();
    return true;
  }

  async _applyManeuverDamage(player, opponent, played, damage) {
    if (damage > 0) {
      const damageResult = await this._resolveDamage(player, opponent, played, damage);
      this._clearNextManeuverReversalTax(player);
      this.damageLog.push({
        card: played.name,
        damage,
        result: damageResult.result,
        reversedBy: damageResult.reversedBy?.name || null,
        cardsOverturned: damageResult.cardsOverturned,
      });

      if (damageResult.result === 'reversed') {
        this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
        this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
        this._notify();
        await this._runAutoPhases();
        return true;
      }

      if (damageResult.result === 'pinfall') {
        this.winner = this._playerIndex(player);
        this.winReason = window.RawDeal.WIN_REASONS.PINFALL;
        this.stateMachine.phase = window.RawDeal.PHASES.GAME_OVER;
        this._notify();
        return true;
      }
    }

    this._clearNextManeuverReversalTax(player);
    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
  }

  async _continueManeuverAfterReversal(player, opponent, played, damage, {
    skipManeuverEffects = false,
  } = {}) {
    if (played.subtype === 'grapple') {
      this._clearGrappleJockeyingTax(player);
    }

    if (!skipManeuverEffects && played.maneuverEffects?.length) {
      this.pendingManeuverResolution = { player, opponent, played, damage, resumeAt: 'maneuver' };
      const paused = await this._startEffectPipeline(player, played.name, played.maneuverEffects, 'maneuver');
      if (paused || this.cardEffectFlow || this.handRevealFlow) {
        return true;
      }
      this.pendingManeuverResolution = null;
      return true;
    }

    this.pendingManeuverResolution = null;
    return this._applyManeuverDamage(player, opponent, played, damage);
  }

  async _continuePendingManeuverDamage() {
    const pending = this.pendingManeuverResolution;
    this.pendingManeuverResolution = null;
    if (!pending) {
      this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
      this._notify();
      return;
    }

    const { player, opponent, played, damage } = pending;
    await this._applyManeuverDamage(player, opponent, played, damage);
  }

  _openActionReversalWindowOrPlay(player, opponent, played) {
    if (this.engineMode !== 'multiplayer') return false;

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD, {
      openReversalWindow: true,
      isAction: true,
    });
    this.reversalWindow = {
      kind: 'action',
      attackerIndex: this._playerIndex(player),
      defenderIndex: this._playerIndex(opponent),
      player,
      opponent,
      played,
      damage: 0,
    };
    this._notify();
    return true;
  }

  async _openReversalWindowOrApplyDamage(player, opponent, played, damage) {
    if (this.engineMode !== 'multiplayer') {
      return this._continueManeuverAfterReversal(player, opponent, played, damage);
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD, { openReversalWindow: true });
    this.reversalWindow = {
      kind: 'maneuver',
      attackerIndex: this._playerIndex(player),
      defenderIndex: this._playerIndex(opponent),
      player,
      opponent,
      played,
      damage,
    };
    this._notify();
    return true;
  }

  canPlayReversalFromHand(playerIndex, instanceId) {
    if (this.stateMachine.phase !== window.RawDeal.PHASES.REVERSAL_PRIORITY) return false;
    if (!this.reversalWindow || this.reversalWindow.defenderIndex !== playerIndex) return false;

    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;

    const { played, kind = 'maneuver' } = this.reversalWindow;
    if (kind === 'action') {
      return window.RawDeal.CardUtils.canReverseAction(card, played, player.fortitude);
    }

    const attacker = this.players[this.reversalWindow.attackerIndex];
    return this._reversalStops(card, played, player, {
      attacker,
      effectiveDamage: this.reversalWindow.damage,
    });
  }

  async playReversalFromHand(playerIndex, instanceId) {
    if (!this.canPlayReversalFromHand(playerIndex, instanceId)) return false;

    const player = this.players[playerIndex];
    const { player: attacker, played, kind = 'maneuver' } = this.reversalWindow;
    const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
    const reversal = player.hand.splice(handIndex, 1)[0];

    if (kind === 'action') {
      player.ringside.push(reversal);
      attacker.ringside.push(played);
      const reversalPlayerIndex = this._playerIndex(player);
      const grantIrishWhipSetup =
        reversal.id === 'irish-whip' && played.id === 'irish-whip';
      const grantJockeyingChoice =
        reversal.id === 'jockeying-for-position' && played.id === 'jockeying-for-position';

      this.actionLog.push({
        message: `${reversal.name} reversed ${played.name} — action has no effect.`,
      });
      this.reversalWindow = null;
      this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_REVERSAL);
      this._notify();
      await this._runAutoPhases();

      if (grantIrishWhipSetup) {
        this._applyIrishWhipSetup(player, reversal);
      } else if (grantJockeyingChoice) {
        this._beginJockeyingChoice(player, reversalPlayerIndex, reversal.name);
      }
      this._notify();
      return true;
    }

    player.ring.reversals.push(reversal);
    this._syncFortitude(player);

    this.actionLog.push({
      message: `${reversal.name} reversed ${played.name} from hand!`,
    });

    if (played.subtype === 'grapple') {
      this._clearGrappleJockeyingTax(attacker);
    }
    this._clearNextManeuverReversalTax(attacker);

    this._applyStunValueDraw(attacker, played);
    this.reversalWindow = null;

    if (reversal.reversalEffects?.length) {
      const paused = await this._startEffectPipeline(
        player,
        reversal.name,
        reversal.reversalEffects,
        'reversal',
        reversal
      );
      return true;
    }

    await this._finishHandReversalTurn();
    return true;
  }

  async _finishHandReversalTurn() {
    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_REVERSAL);
    this._notify();
    await this._runAutoPhases();
  }

  async _applyReversalFromHandDamage(reversalPlayer, attacker, reversal, damage) {
    if (damage <= 0) return { gameOver: false };

    const damageResult = await this._resolveDamage(reversalPlayer, attacker, reversal, damage, {
      allowArsenalReversals: false,
    });
    this.damageLog.push({
      card: reversal.name,
      damage,
      result: damageResult.result,
      reversedBy: null,
      cardsOverturned: damageResult.cardsOverturned,
    });

    if (damageResult.result === 'pinfall') {
      this.winner = this._playerIndex(reversalPlayer);
      this.winReason = window.RawDeal.WIN_REASONS.PINFALL;
      this.stateMachine.phase = window.RawDeal.PHASES.GAME_OVER;
      this._notify();
      return { gameOver: true };
    }

    return { gameOver: false };
  }

  async passPriority(playerIndex) {
    if (this.stateMachine.phase !== window.RawDeal.PHASES.REVERSAL_PRIORITY) return false;
    if (!this.reversalWindow || this.reversalWindow.defenderIndex !== playerIndex) return false;

    const { player, opponent, played, damage, kind = 'maneuver' } = this.reversalWindow;
    this.reversalWindow = null;

    if (kind === 'action') {
      this.stateMachine.transition(window.RawDeal.EVENTS.PASS_PRIORITY, { isAction: true });
      this._notify();
      await this._playFromHandAsAction(player, played);
      this._notify();
      return true;
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.PASS_PRIORITY);
    this._notify();
    return await this._continueManeuverAfterReversal(player, opponent, played, damage);
  }

  async _finishCardEffectResolution() {
    this.cardEffectFlow = null;
    if (this.effectPipelineFlow?.paused && this.pendingManeuverResolution) {
      await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
      return;
    }
    if (this.pendingManeuverResolution) {
      await this._continuePendingManeuverDamage();
      return;
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
  }

  async selectForCardEffect(playerIndex, instanceId) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;

    const player = this.players[playerIndex];
    const flow = this.cardEffectFlow;

    if (flow.type === 'discardFromHand' || flow.type === 'opponentDiscardFromHand') {
      if (flow.selectedIds.includes(instanceId)) return false;
      if (!player.hand.some((c) => c.instanceId === instanceId)) return false;

      flow.selectedIds.push(instanceId);
      const needed = flow.count || 1;

      if (flow.selectedIds.length < needed) {
        this._notify();
        return true;
      }

      const toDiscard = flow.selectedIds
        .map((id) => player.hand.find((c) => c.instanceId === id))
        .filter(Boolean);
      player.hand = player.hand.filter((c) => !flow.selectedIds.includes(c.instanceId));
      for (const discarded of toDiscard) {
        player.ringside.push(discarded);
      }

      const names = toDiscard.map((c) => c.name).join(', ');
      if (flow.type === 'opponentDiscardFromHand') {
        this.actionLog.push({
          message: `${flow.sourceName}: opponent discarded ${names} to Ringside.`,
        });
        await this._finishCardEffectResolution();
        return true;
      }

      this.actionLog.push({
        message: `${flow.sourceName}: discarded ${names} to Ringside.`,
      });
      await this._finishCardEffectResolution();
      return true;
    }

    return false;
  }

  async selectChoice(playerIndex, optionId) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== playerIndex) return false;
    if (this.cardEffectFlow.type !== 'choice') return false;

    const flow = this.cardEffectFlow;
    const player = this.players[playerIndex];
    const opponent = this.players[1 - playerIndex];

    if (flow.choiceId === 'jockeyingForPosition') {
      if (!player.turnState) player.turnState = this._emptyTurnState();
      if (optionId === 'grappleDamage') {
        player.turnState.nextGrappleBonus = 4;
        this.actionLog.push({
          message: `${flow.sourceName}: your next Grapple maneuver is +4D.`,
        });
      } else if (optionId === 'grappleReversalTax') {
        player.turnState.nextGrappleReversalTax = 8;
        this.actionLog.push({
          message: `${flow.sourceName}: opponent's reversal to your next Grapple is +8F.`,
        });
      } else {
        return false;
      }
      this.cardEffectFlow = null;
      if (this.effectPipelineFlow?.paused) {
        await window.RawDeal.EffectPipeline.resumeAfterCardEffect(this);
        return true;
      }
      this._notify();
      return true;
    }

    if (flow.choiceId === 'drawOrOpponentDiscard') {
      const n = flow.count || 2;
      if (optionId === 'draw') {
        for (let i = 0; i < n; i++) {
          this._drawCard(player);
        }
        this.actionLog.push({
          message: `${flow.sourceName}: drew ${n} cards.`,
        });
        this._notify();
      } else if (optionId === 'opponentDiscard') {
        const { count, cards } = this._forceOpponentDiscard(opponent, n);
        const names = cards.map((c) => c.name).join(', ');
        this.actionLog.push({
          message: count
            ? `${flow.sourceName}: opponent discarded ${names} to Ringside.`
            : `${flow.sourceName}: opponent had no cards to discard.`,
        });
      } else {
        return false;
      }
    } else {
      return false;
    }

    this._notify();
    await this._finishCardEffectResolution();
    return true;
  }

  async _topArsenalToRingside(player, sourceCard) {
    if (player.arsenal.length === 0) return;

    const top = player.arsenal.pop();
    this._notify();

    await this.onArsenalToRingside({
      card: top,
      sourceManeuver: sourceCard,
      playerSeat: this._playerIndex(player),
      onReveal: () => {
        player.ringside.push(top);
        this.actionLog.push({
          message: `${sourceCard.name}: put ${top.name} from Arsenal into Ringside.`,
        });
        this._notify();
      },
    });
  }

  async _resolveDamage(attacker, opponent, maneuver, damage, { allowArsenalReversals = true } = {}) {
    let cardsOverturned = 0;

    for (let i = 0; i < damage; i++) {
      if (opponent.arsenal.length === 0) {
        return { result: 'pinfall', cardsOverturned };
      }

      const overturned = opponent.arsenal.pop();
      cardsOverturned += 1;
      this._notify();

      const reversed = allowArsenalReversals
        ? this._reversalStops(overturned, maneuver, opponent, {
            attacker,
            effectiveDamage: this._peekManeuverDamage(attacker, opponent, maneuver),
          })
        : false;

      await this.onDamageStep({
        card: overturned,
        step: i + 1,
        total: damage,
        maneuver,
        reversed,
        playerSeat: this._playerIndex(opponent),
        onReveal: () => {
          opponent.ringside.push(overturned);
          this._notify();
        },
      });

      if (reversed) {
        this._applyStunValueDraw(attacker, maneuver);
        return { result: 'reversed', reversedBy: overturned, cardsOverturned };
      }
    }

    return { result: 'hit', cardsOverturned };
  }

  /** Draw for the maneuver's owner when their maneuver is reversed from opponent Arsenal. */
  _applyStunValueDraw(maneuverOwner, maneuver) {
    const sv = window.RawDeal.CardUtils.getStunValue(maneuver);
    if (sv <= 0) return;

    let drawn = 0;
    for (let i = 0; i < sv; i++) {
      if (this._drawCard(maneuverOwner)) drawn += 1;
    }

    if (drawn > 0) {
      const who = maneuverOwner.isHuman ? 'You draw' : 'Opponent draws';
      this.actionLog.push({
        message: `${maneuver.name} reversed (SV ${sv}): ${who} ${drawn} card${drawn === 1 ? '' : 's'}.`,
      });
      this._notify();
    }
  }

  _reversalStops(card, maneuver, opponent, options = {}) {
    const {
      attacker = null,
      effectiveDamage = null,
      afterIrishWhip = null,
      reversalFortitudeTax = 0,
    } = options;

    if (attacker?.turnState?.opponentReversalsBlocked) {
      return false;
    }
    const damage =
      effectiveDamage ??
      (attacker ? this._peekManeuverDamage(attacker, opponent, maneuver) : (maneuver.damage || 0));
    const playedAfterIrishWhip =
      afterIrishWhip ?? !!attacker?.turnState?.irishWhipPlayed;
    const tax = attacker
      ? this._getManeuverReversalFortitudeTax(attacker, maneuver)
      : reversalFortitudeTax || 0;

    return window.RawDeal.CardUtils.canReverseManeuver(
      card,
      maneuver,
      opponent.fortitude,
      damage,
      { afterIrishWhip: playedAfterIrishWhip, reversalFortitudeTax: tax }
    );
  }

  _clearGrappleJockeyingTax(player) {
    if (player?.turnState?.nextGrappleReversalTax) {
      player.turnState.nextGrappleReversalTax = 0;
    }
  }

  canUseSuperstarAbility(playerIndex) {
    if (!this.stateMachine.canPlayCards(playerIndex) || this.abilityFlow || this.cardEffectFlow || this.reversalWindow) {
      return false;
    }

    const player = this.players[playerIndex];
    if (!player || player.superstarAbilityUsed) return false;

    const id = player.superstar.id;
    if (id === 'stone-cold') return player.arsenal.length > 0;
    if (id === 'undertaker') return player.hand.length >= 2 && player.ringside.length >= 1;
    return false;
  }

  beginSuperstarAbility(playerIndex = 0) {
    if (!this.canUseSuperstarAbility(playerIndex)) return false;

    const player = this.players[playerIndex];
    const id = player.superstar.id;

    if (id === 'stone-cold') {
      const drawn = this._drawCard(player);
      if (!drawn) return false;
      this.abilityFlow = { playerIndex, superstarId: id, step: 'pickBottom' };
      this._notify();
      return true;
    }

    if (id === 'undertaker') {
      this.abilityFlow = { playerIndex, superstarId: id, step: 'pickDiscard', discardSelected: [] };
      this._notify();
      return true;
    }

    return false;
  }

  selectForAbility(playerIndex, instanceId) {
    if (!this.abilityFlow || this.abilityFlow.playerIndex !== playerIndex) return false;

    const player = this.players[playerIndex];
    const flow = this.abilityFlow;

    if (flow.step === 'pickBottom') {
      const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;
      const [card] = player.hand.splice(idx, 1);
      player.arsenal.unshift(card);
      player.superstarAbilityUsed = true;
      this.abilityFlow = null;
      this.actionLog.push({
        message: `Stone Cold drew 1 card and put ${card.name} on the bottom of your Arsenal.`,
      });
      this._notify();
      return true;
    }

    if (flow.step === 'pickDiscard') {
      if (flow.discardSelected.includes(instanceId)) return false;
      if (!player.hand.some((c) => c.instanceId === instanceId)) return false;

      flow.discardSelected.push(instanceId);
      if (flow.discardSelected.length < 2) {
        this._notify();
        return true;
      }

      const toDiscard = flow.discardSelected
        .map((id) => player.hand.find((c) => c.instanceId === id))
        .filter(Boolean);
      player.hand = player.hand.filter((c) => !flow.discardSelected.includes(c.instanceId));
      for (const card of toDiscard) {
        player.ringside.push(card);
      }

      flow.step = 'pickRingside';
      flow.discardSelected = [];
      flow.discardedNames = toDiscard.map((c) => c.name);
      this._notify();
      return true;
    }

    if (flow.step === 'pickRingside') {
      const idx = player.ringside.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;
      const [card] = player.ringside.splice(idx, 1);
      player.hand.push(card);
      player.superstarAbilityUsed = true;
      const discarded = (flow.discardedNames || []).join(' and ');
      this.actionLog.push({
        message: `Undertaker discarded ${discarded} and retrieved ${card.name} from Ringside.`,
      });
      this.abilityFlow = null;
      this._notify();
      return true;
    }

    return false;
  }

  async endTurn(playerIndex) {
    if (
      !this.stateMachine.canPlayCards(playerIndex) ||
      this.cardEffectFlow ||
      this.pendingManeuverResolution ||
      this.reversalWindow ||
      window.RawDeal.EffectPipeline.isPaused(this, playerIndex)
    ) {
      return;
    }
    this.abilityFlow = null;
    this.handRevealFlow = null;
    this.effectPipelineFlow = null;
    this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
    await this._runAutoPhases();
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _devCloneCard(cardId) {
    const base = window.RawDeal.CARDS[cardId];
    if (!base) return null;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { ...base, instanceId: `${cardId}-dev-${suffix}` };
  }

  devGiveCard(playerIndex, cardId) {
    const player = this.players[playerIndex];
    if (!player || this.winner !== null) return false;

    const card = this._devCloneCard(cardId);
    if (!card) return false;

    player.hand.push(card);
    this._notify();
    return true;
  }

  devStackArsenal(playerIndex, cardId, count = 1) {
    const player = this.players[playerIndex];
    if (!player || this.winner !== null) return 0;

    const base = window.RawDeal.CARDS[cardId];
    if (!base) return 0;

    let stacked = 0;
    for (let i = 0; i < count; i++) {
      const card = this._devCloneCard(cardId);
      if (!card) break;
      player.arsenal.push(card);
      stacked++;
    }

    if (stacked > 0) this._notify();
    return stacked;
  }
};