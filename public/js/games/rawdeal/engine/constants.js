window.RawDeal = window.RawDeal || {};

window.RawDeal.PHASES = {
  SETUP: 'setup',
  START_OF_TURN: 'startOfTurn',
  REFRESH: 'refresh',
  DRAW: 'draw',
  MAIN: 'main',
  RESOLVING_DAMAGE: 'resolvingDamage',
  END_OF_TURN: 'endOfTurn',
  OPPONENT_TURN: 'opponentTurn',
  GAME_OVER: 'gameOver',
};

window.RawDeal.EVENTS = {
  START_GAME: 'START_GAME',
  REFRESH_DONE: 'REFRESH_DONE',
  DRAW_DONE: 'DRAW_DONE',
  PLAY_CARD: 'PLAY_CARD',
  DAMAGE_DONE: 'DAMAGE_DONE',
  END_TURN: 'END_TURN',
  OPPONENT_DONE: 'OPPONENT_DONE',
  RESTART: 'RESTART',
};

window.RawDeal.WIN_REASONS = {
  PINFALL: 'pinfall',
  COUNT_OUT: 'countOut',
};

window.RawDeal.CARD_COLORS = {
  maneuver: '#d4a017',
  reversal: '#c0392b',
  action: '#2980b9',
  superstar: '#7d3c98',
};