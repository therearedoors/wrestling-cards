const { resolveDecksForMatch } = require('./deckResolver');
const { updateRawDealRoom } = require('../../utils/room');

const activeGames = new Map();

function remapStateForViewer(state, viewerIndex) {
  const me = state.players[viewerIndex];
  const opp = state.players[1 - viewerIndex];
  return {
    ...state,
    myIndex: viewerIndex,
    players: [me, opp],
    canPlay: state.canPlay,
    reversalWindow: state.reversalWindow,
  };
}

class RoomGame {
  constructor(roomId, room, engine, seatByUsername) {
    this.roomId = roomId;
    this.room = room;
    this.engine = engine;
    this.seatByUsername = seatByUsername;
    this.socketBySeat = [null, null];
  }

  getSeatForUsername(username) {
    if (this.room.players[0]?.username === username) return 0;
    if (this.room.players[1]?.username === username) return 1;
    return -1;
  }

  bindSocket(seat, socketId) {
    this.socketBySeat[seat] = socketId;
  }

  getStateForSeat(seat) {
    const raw = this.engine.getPublicState(seat);
    return remapStateForViewer(raw, seat);
  }

  async applyAction(username, action) {
    const seat = this.getSeatForUsername(username);
    if (seat < 0) return { ok: false, error: 'Not in this game' };

    const engine = this.engine;
    let ok = false;

    switch (action.type) {
      case 'playCard':
        ok = await engine.playCard(seat, action.instanceId, action.playAs);
        break;
      case 'endTurn':
        await engine.endTurn(seat);
        ok = true;
        break;
      case 'playReversal':
        ok = await engine.playReversalFromHand(seat, action.instanceId);
        break;
      case 'passPriority':
        ok = await engine.passPriority(seat);
        break;
      case 'superstarAbility':
        ok = engine.beginSuperstarAbility(seat);
        break;
      case 'abilitySelect': {
        const abilityOk = engine.selectForAbility(seat, action.instanceId);
        ok = abilityOk || (await engine.selectForCardEffect(seat, action.instanceId));
        break;
      }
      case 'choiceSelect':
        ok = await engine.selectChoice(seat, action.optionId);
        break;
      case 'adjustDrawCount':
        ok = engine.adjustDrawCount(seat, action.delta ?? 0);
        break;
      case 'confirmDrawCount':
        ok = await engine.confirmDrawCount(seat);
        break;
      case 'adjustDiscardCount':
        ok = engine.adjustDiscardCount(seat, action.delta ?? 0);
        break;
      case 'confirmDiscardCount':
        ok = await engine.confirmDiscardCount(seat);
        break;
      case 'dismissHandReveal':
        ok = await engine.dismissHandReveal(seat);
        break;
      case 'skipHandReveal':
        ok = await engine.skipHandReveal(seat);
        break;
      case 'confirmHandRevealSelection':
        ok = await engine.confirmHandRevealSelection(seat, action.instanceIds || []);
        break;
      case 'toggleHandRevealSelection':
        ok = engine.toggleHandRevealSelection(seat, action.instanceId);
        break;
      case 'passSuperstarAbility':
        ok = await engine.passSuperstarAbilityPrompt(seat);
        break;
      case 'confirmSuperstarAbility':
        ok = await engine.confirmSuperstarAbilityPrompt(seat, action.instanceId);
        break;
      case 'toggleSuperstarAbilitySelection':
        ok = engine.toggleSuperstarAbilitySelection(seat, action.instanceId);
        break;
      case 'shuffleArsenalReorder':
        ok = await engine.shuffleArsenalFromPrompt(seat);
        break;
      case 'confirmArsenalReorder':
        ok = await engine.confirmArsenalReorder(seat, action.orderedIds || []);
        break;
      case 'updateArsenalReorder':
        ok = engine.updateArsenalReorderOrder(seat, action.orderedIds || []);
        break;
      case 'toggleRemoveOpponentRingSelect':
        ok = engine.toggleRemoveOpponentRingSelect(
          seat,
          action.instanceId,
          action.ringArea
        );
        break;
      case 'confirmRemoveOpponentRingCard':
        ok = await engine.confirmRemoveOpponentRingCard(seat);
        break;
      case 'devCommand': {
        const { loadRawDeal } = require('./bootstrap');
        const RawDeal = loadRawDeal();
        const devResult = RawDeal.DevCommands.execute(engine, action.line, { mySeat: seat });
        const cmd = (action.line || '').trim().split(/\s+/)[0]?.toLowerCase();
        const mutates = devResult.ok && (cmd === 'draw' || cmd === 'stack');
        return { ok: true, devResult, mutates };
      }
      default:
        return { ok: false, error: 'Unknown action' };
    }

    if (!ok && action.type !== 'endTurn') {
      return { ok: false, error: 'Action not allowed' };
    }

    return { ok: true };
  }
}

function serialAnimCard(card) {
  return {
    id: card.id,
    name: card.name,
    instanceId: card.instanceId,
    subtype: card.subtype,
    damage: card.damage,
    fortitude: card.fortitude,
    type: card.type,
    types: card.types,
  };
}

async function startGame(roomId, room) {
  if (activeGames.has(roomId)) return activeGames.get(roomId);

  const [p0, p1] = room.players;
  const { deck0, deck1, RawDeal } = await resolveDecksForMatch(p0, p1);

  const engine = new RawDeal.GameEngine({
    engineMode: 'multiplayer',
    onDamageStep: async ({ card, maneuver, reversed, playerSeat, onReveal }) => {
      engine.animationEvents.push({
        type: 'damageFlip',
        seat: playerSeat,
        card: serialAnimCard(card),
        reversed: !!reversed,
        maneuver: maneuver ? { id: maneuver.id, name: maneuver.name } : null,
      });
      if (onReveal) onReveal();
    },
    onArsenalToRingside: async ({ card, playerSeat, onReveal }) => {
      engine.animationEvents.push({
        type: 'arsenalToRingside',
        seat: playerSeat,
        card: serialAnimCard(card),
      });
      if (onReveal) onReveal();
    },
  });

  const deckMap = {
    [p0.deckId]: deck0,
    [p1.deckId]: deck1,
  };

  await engine.startGame(p0.deckId, p1.deckId, deckMap, {
    player0: { username: p0.username, userId: p0.id },
    player1: { username: p1.username, userId: p1.id },
  });

  const game = new RoomGame(roomId, room, engine, {
    [p0.username]: 0,
    [p1.username]: 1,
  });

  activeGames.set(roomId, game);
  return game;
}

function getGame(roomId) {
  return activeGames.get(roomId) || null;
}

function endGame(roomId) {
  activeGames.delete(roomId);
}

function forfeitGame(roomId, winnerSeat) {
  const game = activeGames.get(roomId);
  if (!game) return null;
  const { loadRawDeal } = require('./bootstrap');
  game.engine.winner = winnerSeat;
  game.engine.winReason = 'forfeit';
  game.engine.stateMachine.phase = loadRawDeal().PHASES.GAME_OVER;
  return game;
}

module.exports = {
  startGame,
  getGame,
  endGame,
  forfeitGame,
  remapStateForViewer,
};