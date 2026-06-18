window.RawDeal = window.RawDeal || {};

/**
 * Turn-phase state machine for Raw Deal goldfish.
 * Player 0 = human, Player 1 = passive opponent.
 */
window.RawDeal.StateMachine = class StateMachine {
  constructor() {
    this.phase = window.RawDeal.PHASES.SETUP;
    this.activePlayer = 0;
    this.turnNumber = 0;
    this.listeners = [];
  }

  onTransition(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  _emit(prevPhase, event) {
    for (const cb of this.listeners) {
      cb({
        phase: this.phase,
        prevPhase,
        event,
        activePlayer: this.activePlayer,
        turnNumber: this.turnNumber,
      });
    }
  }

  transition(event, context = {}) {
    const prevPhase = this.phase;
    const { PHASES, EVENTS } = window.RawDeal;

    switch (this.phase) {
      case PHASES.SETUP:
        if (event === EVENTS.START_GAME) {
          this.turnNumber = 1;
          this.activePlayer = context.firstPlayer ?? 0;
          this.phase = PHASES.START_OF_TURN;
        }
        break;

      case PHASES.START_OF_TURN:
        this.phase = PHASES.REFRESH;
        break;

      case PHASES.REFRESH:
        if (event === EVENTS.REFRESH_DONE) {
          this.phase = PHASES.DRAW;
        }
        break;

      case PHASES.DRAW:
        if (event === EVENTS.DRAW_DONE) {
          if (this.activePlayer === 0) {
            this.phase = PHASES.MAIN;
          } else {
            this.phase = PHASES.OPPONENT_TURN;
          }
        }
        break;

      case PHASES.MAIN:
        if (event === EVENTS.PLAY_CARD) {
          this.phase = PHASES.RESOLVING_DAMAGE;
        } else if (event === EVENTS.END_TURN) {
          this.phase = PHASES.END_OF_TURN;
        }
        break;

      case PHASES.RESOLVING_DAMAGE:
        if (event === EVENTS.DAMAGE_DONE) {
          this.phase = PHASES.MAIN;
        }
        break;

      case PHASES.OPPONENT_TURN:
        if (event === EVENTS.OPPONENT_DONE) {
          this.phase = PHASES.END_OF_TURN;
        }
        break;

      case PHASES.END_OF_TURN:
        if (context.gameOver) {
          this.phase = PHASES.GAME_OVER;
        } else {
          this.activePlayer = 1 - this.activePlayer;
          if (this.activePlayer === 0) this.turnNumber += 1;
          this.phase = PHASES.START_OF_TURN;
        }
        break;

      case PHASES.GAME_OVER:
        if (event === EVENTS.RESTART) {
          this.phase = PHASES.SETUP;
          this.activePlayer = 0;
          this.turnNumber = 0;
        }
        break;

      default:
        break;
    }

    if (prevPhase !== this.phase) {
      this._emit(prevPhase, event);
    }

    return this.phase;
  }

  isPlayerTurn(playerIndex) {
    return (
      this.activePlayer === playerIndex &&
      [window.RawDeal.PHASES.MAIN, window.RawDeal.PHASES.RESOLVING_DAMAGE].includes(this.phase)
    );
  }

  canPlayCards() {
    return this.phase === window.RawDeal.PHASES.MAIN && this.activePlayer === 0;
  }
};