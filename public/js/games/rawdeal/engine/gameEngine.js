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
    // Superstar Value provides base Fortitude each refresh (goldfish simplification).
    let total = player.superstar.superstarValue || 0;
    for (const card of [...player.ring.maneuvers, ...player.ring.reversals]) {
      total += card.fortitude || 0;
    }
    return total;
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
        active.fortitude = this._calcFortitude(active);
        this.stateMachine.transition(EVENTS.REFRESH_DONE);
        continue;
      }

      if (phase === PHASES.DRAW) {
        this._drawCard(active);
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
    let cost = card.fortitude || 0;
    if (card.type === 'action' && player.deckId === 'rock') {
      cost = Math.max(0, cost - 1);
    }
    return cost;
  }

  canPlayCard(playerIndex, instanceId) {
    if (!this.stateMachine.canPlayCards() || playerIndex !== 0) return false;

    const player = this.players[0];
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;
    if (card.type === 'reversal') return false;

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

    if (card.type === 'maneuver') {
      player.ring.maneuvers.push(card);
      player.fortitude = this._calcFortitude(player);

      let damage = card.damage || 0;
      if (card.subtype === 'strike' && player.deckId === 'austin') {
        damage += 1;
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
    if (maneuver.subtype && card.reverses.includes(maneuver.subtype)) {
      return true;
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