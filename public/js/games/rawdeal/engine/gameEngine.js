window.RawDeal = window.RawDeal || {};

window.RawDeal.GameEngine = class GameEngine {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.onDamageStep = options.onDamageStep || (async () => {});
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
      canPlay: this.stateMachine.canPlayCards(),
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
      ringside: player.ringside.slice(-8),
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

  _effectiveFortitudeCost(player, card) {
    return card.fortitude || 0;
  }

  canPlayCard(playerIndex, instanceId) {
    if (!this.stateMachine.canPlayCards() || playerIndex !== 0) return false;

    const player = this.players[0];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;
    const cost = this._effectiveFortitudeCost(player, card);
    return player.fortitude >= cost;
  }

  async playCard(instanceId) {
    if (!this.canPlayCard(0, instanceId)) return false;

    const player = this.players[0];
    const opponent = this.players[1];
    const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
    const card = player.hand.splice(handIndex, 1)[0];
    const cost = this._effectiveFortitudeCost(player, card);

    this.stateMachine.transition(window.RawDeal.EVENTS.PLAY_CARD);
    this._notify();

    if (card.type === 'maneuver' || card.type === 'reversal') {
      const ringArea = card.type === 'reversal' ? player.ring.reversals : player.ring.maneuvers;
      ringArea.push(card);
      this._syncFortitude(player);

      let damage = card.damage || 0;
      if (opponent.superstar.id === 'mankind' && damage > 0) {
        damage = Math.max(0, damage - 1);
      }
      damage += this.nextManeuverBonus[0];
      this.nextManeuverBonus[0] = 0;

      if (damage > 0) {
        const damageResult = await this._resolveDamage(opponent, card, damage);
        this.damageLog.push({
          card: card.name,
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
    } else if (card.type === 'action') {
      player.ring.actions.push(card);
      this._resolveAction(player, card);
    }

    this.stateMachine.transition(window.RawDeal.EVENTS.DAMAGE_DONE);
    this._notify();
    return true;
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

      const reversed = this._reversalStops(overturned, maneuver);

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

  _reversalStops(card, maneuver) {
    if (card.type !== 'reversal') return false;
    if (!card.reverses) return false;

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

  async endTurn() {
    if (!this.stateMachine.canPlayCards()) return;
    this.stateMachine.transition(window.RawDeal.EVENTS.END_TURN);
    await this._runAutoPhases();
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};