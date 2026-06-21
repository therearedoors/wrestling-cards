window.RawDeal = window.RawDeal || {};

window.RawDeal.GameEngine = class GameEngine {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.onDamageStep = options.onDamageStep || (async () => {});
    this.onArsenalToRingside =
      options.onArsenalToRingside || (async ({ onReveal }) => { if (onReveal) onReveal(); });
    this.stateMachine = new window.RawDeal.StateMachine();
    this.stateMachine.onTransition(() => this._notify());
    this.reset();
  }

  reset() {
    this.players = [null, null];
    this.winner = null;
    this.winReason = null;
    this.nextManeuverBonus = [0, 0];
    this.damageLog = [];
    this.actionLog = [];
    this.abilityFlow = null;
    this.cardEffectFlow = null;
    this.pendingManeuverResolution = null;
    this.stateMachine.phase = window.RawDeal.PHASES.SETUP;
    this.stateMachine.activePlayer = 0;
    this.stateMachine.turnNumber = 0;
    this._notify();
  }

  _notify() {
    this.onStateChange(this.getPublicState());
  }

  getPublicState() {
    return {
      phase: this.stateMachine.phase,
      activePlayer: this.stateMachine.activePlayer,
      turnNumber: this.stateMachine.turnNumber,
      players: this.players.map((p) => (p ? this._publicPlayer(p) : null)),
      winner: this.winner,
      winReason: this.winReason,
      damageLog: [...this.damageLog],
      actionLog: [...this.actionLog],
      canPlay: this.stateMachine.canPlayCards(),
      selectionPrompt: this._publicSelectionPrompt(),
      superstarAbility: this._publicSuperstarAbility(),
    };
  }

  _publicSelectionPrompt() {
    if (this.cardEffectFlow?.playerIndex !== 0) return null;

    const flow = this.cardEffectFlow;
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

    return null;
  }

  _publicSuperstarAbility() {
    const player = this.players[0];
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
    if (this.abilityFlow?.playerIndex === 0) {
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
      canUse: this.canUseSuperstarAbility(0),
      used: player.superstarAbilityUsed,
      label: labels[id] || null,
      prompt,
    };
  }

  _publicPlayer(player) {
    return {
      superstar: player.superstar,
      deckId: player.deckId,
      handSize: player.hand.length,
      arsenalSize: player.arsenal.length,
      ringsideSize: player.ringside.length,
      fortitude: player.fortitude,
      hand: player.isHuman ? player.hand : [],
      ring: player.ring,
      ringside: player.isHuman ? player.ringside : player.ringside.slice(-8),
      arsenal: player.arsenal,
      isHuman: player.isHuman,
    };
  }

  startGame(playerDeckId, opponentDeckId = 'austin') {
    const { DECKS, CARDS } = window.RawDeal;
    const playerDeck = DECKS[playerDeckId];
    const opponentDeck = DECKS[opponentDeckId];

    this.players[0] = this._createPlayer(playerDeck, true);
    this.players[1] = this._createPlayer(opponentDeck, false);

    const firstPlayer =
      this.players[0].superstar.superstarValue >= this.players[1].superstar.superstarValue ? 0 : 1;

    this._dealOpeningHands();
    this.stateMachine.transition(window.RawDeal.EVENTS.START_GAME, { firstPlayer });
    this._runAutoPhases();
  }

  _createPlayer(deck, isHuman) {
    const arsenal = this._shuffle([...deck.arsenal]);
    return {
      superstar: { ...window.RawDeal.CARDS[deck.superstarId] },
      arsenal,
      hand: [],
      ringside: [],
      ring: { maneuvers: [], actions: [], reversals: [] },
      fortitude: 0,
      superstarAbilityUsed: false,
      isHuman,
      deckId: deck.id,
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
        await this._delay(400);
        this.stateMachine.transition(EVENTS.OPPONENT_DONE);
        continue;
      }

      if (phase === PHASES.END_OF_TURN) {
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
      this.winner = player.isHuman ? 1 : 0;
      this.winReason = player.isHuman
        ? window.RawDeal.WIN_REASONS.COUNT_OUT
        : window.RawDeal.WIN_REASONS.COUNT_OUT;
      return true;
    }
    return false;
  }

  _effectiveFortitudeCost(player, card, playAs = 'maneuver') {
    return window.RawDeal.CardUtils.playFortitudeCost(card, playAs);
  }

  canPlayCard(playerIndex, instanceId, playAs) {
    if (!this.stateMachine.canPlayCards() || playerIndex !== 0 || this.cardEffectFlow) return false;

    const player = this.players[0];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;

    const utils = window.RawDeal.CardUtils;
    const mode =
      playAs || (utils.canPlayFromHandAs(card, 'maneuver') ? 'maneuver' : utils.primaryType(card));
    if (!utils.canPlayFromHandAs(card, mode)) return false;

    const cost = this._effectiveFortitudeCost(player, card, mode);
    return player.fortitude >= cost;
  }

  async playCard(instanceId, playAs) {
    const player = this.players[0];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    const utils = window.RawDeal.CardUtils;
    const mode =
      playAs || (utils.canPlayFromHandAs(card, 'maneuver') ? 'maneuver' : utils.primaryType(card));

    if (!this.canPlayCard(0, instanceId, mode)) return false;

    const opponent = this.players[1];
    const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
    const played = player.hand.splice(handIndex, 1)[0];

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD);
    this._notify();

    if (mode === 'action') {
      await this._playFromHandAsAction(player, played);
      this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
      this._notify();
      return true;
    }

    if (mode === 'maneuver' || mode === 'reversal') {
      const ringArea = mode === 'reversal' ? player.ring.reversals : player.ring.maneuvers;
      ringArea.push(played);
      this._syncFortitude(player);
      await this._resolveOnPlayManeuverEffects(player, played);

      const damage = this._calcManeuverDamage(player, opponent, played);

      if (this._beginPreDamageDiscardPrompt(player, played)) {
        this.pendingManeuverResolution = { player, opponent, played, damage };
        return true;
      }

      return await this._applyManeuverDamage(player, opponent, played, damage);
    } else if (window.RawDeal.CardUtils.hasType(played, 'action')) {
      player.ring.actions.push(played);
      this._resolveAction(player, played);
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
  }

  async _playFromHandAsAction(player, card) {
    player.ringside.push(card);

    if (card.actionEffect === 'discardToDraw') {
      const draws = card.actionEffectValue || 1;
      for (let i = 0; i < draws; i++) {
        this._drawCard(player);
      }
      this.actionLog.push({
        message: `${card.name} (action): discarded to draw ${draws} card${draws === 1 ? '' : 's'}.`,
      });
      return;
    }

    this._resolveAction(player, card);
    this.actionLog.push({
      message: `${card.name} played as an action.`,
    });
  }

  _hasTopArsenalToRingside(card) {
    if (card.effect === 'topArsenalToRingside') return true;
    const text = (card.text || '').toLowerCase();
    return text.includes('take the top card of your arsenal and put it into your ringside pile');
  }

  async _resolveOnPlayManeuverEffects(player, card) {
    if (!this._hasTopArsenalToRingside(card)) return;
    await this._topArsenalToRingside(player, card);
  }

  _calcManeuverDamage(player, opponent, played) {
    let damage = played.damage || 0;
    if (opponent.superstar.id === 'mankind' && damage > 0) {
      damage = Math.max(0, damage - 1);
    }
    damage += this.nextManeuverBonus[0];
    this.nextManeuverBonus[0] = 0;
    return damage;
  }

  _beginPreDamageDiscardPrompt(player, card) {
    if (card.effect !== 'discardFromHand') return false;

    const count = card.effectValue || 1;
    if (player.hand.length === 0) {
      this.actionLog.push({
        message: `${card.name}: no cards in hand to discard before damage.`,
      });
      return false;
    }

    this.cardEffectFlow = {
      type: 'discardFromHand',
      playerIndex: 0,
      sourceName: card.name,
      count,
      selectedIds: [],
    };
    this._notify();
    return true;
  }

  async _applyManeuverDamage(player, opponent, played, damage) {
    if (damage > 0) {
      const damageResult = await this._resolveDamage(opponent, played, damage);
      this.damageLog.push({
        card: played.name,
        damage,
        result: damageResult.result,
        reversedBy: damageResult.reversedBy?.name || null,
        cardsOverturned: damageResult.cardsOverturned,
      });

      if (damageResult.result === 'pinfall') {
        this.winner = 0;
        this.winReason = window.RawDeal.WIN_REASONS.PINFALL;
        this.stateMachine.phase = window.RawDeal.PHASES.GAME_OVER;
        this._notify();
        return true;
      }

      if (damageResult.result === 'reversed') {
        this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
        this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
        this._notify();
        await this._runAutoPhases();
        return true;
      }
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
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

  _finishCardEffectResolution() {
    this.cardEffectFlow = null;
    if (this.pendingManeuverResolution) {
      void this._continuePendingManeuverDamage();
      return;
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
  }

  selectForCardEffect(instanceId) {
    if (!this.cardEffectFlow || this.cardEffectFlow.playerIndex !== 0) return false;

    const player = this.players[0];
    const flow = this.cardEffectFlow;

    if (flow.type === 'discardFromHand') {
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
      this.actionLog.push({
        message: `${flow.sourceName}: discarded ${names} to Ringside.`,
      });
      this._finishCardEffectResolution();
      return true;
    }

    return false;
  }

  async _topArsenalToRingside(player, sourceCard) {
    if (player.arsenal.length === 0) return;

    const top = player.arsenal.pop();
    this._notify();

    await this.onArsenalToRingside({
      card: top,
      sourceManeuver: sourceCard,
      onReveal: () => {
        player.ringside.push(top);
        this.actionLog.push({
          message: `${sourceCard.name}: put ${top.name} from Arsenal into Ringside.`,
        });
        this._notify();
      },
    });

    if (sourceCard.alsoDraw) {
      this._drawCard(player);
      this._notify();
    }
  }

  _resolveAction(player, card) {
    if (card.effect === 'draw') {
      for (let i = 0; i < (card.effectValue || 1); i++) {
        this._drawCard(player);
      }
    } else if (card.effect === 'nextManeuverBonus') {
      const idx = player.isHuman ? 0 : 1;
      this.nextManeuverBonus[idx] += card.effectValue || 0;
    } else if (card.effect === 'smackdownHotel') {
      this._drawCard(player);
      const idx = player.isHuman ? 0 : 1;
      this.nextManeuverBonus[idx] += 6;
    } else if (card.effect === 'iAmTheGame') {
      const idx = player.isHuman ? 0 : 1;
      this.nextManeuverBonus[idx] += 3;
      this._drawCard(player);
      this._drawCard(player);
    }
  }

  async _resolveDamage(opponent, maneuver, damage) {
    let cardsOverturned = 0;

    for (let i = 0; i < damage; i++) {
      if (opponent.arsenal.length === 0) {
        return { result: 'pinfall', cardsOverturned };
      }

      const overturned = opponent.arsenal.pop();
      cardsOverturned += 1;
      this._notify();

      const reversed = this._reversalStops(overturned, maneuver, opponent);

      await this.onDamageStep({
        card: overturned,
        step: i + 1,
        total: damage,
        maneuver,
        reversed,
        onReveal: () => {
          opponent.ringside.push(overturned);
          this._notify();
        },
      });

      if (reversed) {
        return { result: 'reversed', reversedBy: overturned, cardsOverturned };
      }
    }

    return { result: 'hit', cardsOverturned };
  }

  _reversalStops(card, maneuver, opponent) {
    const utils = window.RawDeal.CardUtils;
    const canReverseFromArsenal =
      utils.hasType(card, 'reversal') || (card.reverses && card.reverses.length > 0);
    if (!canReverseFromArsenal || !card.reverses) return false;

    const reversalCost = card.fortitude || 0;
    if (opponent.fortitude < reversalCost) return false;

    if (card.reverses.includes('low-damage') && (maneuver.damage || 0) <= (card.maxDamage || 5)) {
      return true;
    }
    const subtype = maneuver.subtype || '';
    if (subtype && card.reverses.includes(subtype)) {
      return true;
    }
    if (card.reverses.includes('strike') && subtype === 'strike') return true;
    if (card.reverses.includes('grapple') && subtype === 'grapple') return true;
    if (card.reverses.includes('submission') && subtype === 'submission') return true;
    if (
      card.reverses.includes('strike') &&
      card.reverses.includes('grapple') &&
      card.reverses.includes('submission')
    ) {
      return ['strike', 'grapple', 'submission', 'high-risk'].includes(subtype);
    }
    return false;
  }

  canUseSuperstarAbility(playerIndex) {
    if (!this.stateMachine.canPlayCards() || playerIndex !== 0 || this.abilityFlow || this.cardEffectFlow) {
      return false;
    }

    const player = this.players[0];
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

  selectForAbility(instanceId) {
    if (!this.abilityFlow || this.abilityFlow.playerIndex !== 0) return false;

    const player = this.players[0];
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

  async endTurn() {
    if (!this.stateMachine.canPlayCards() || this.cardEffectFlow || this.pendingManeuverResolution) {
      return;
    }
    this.abilityFlow = null;
    this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
    await this._runAutoPhases();
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};