const {
  createRawDealRoom,
  joinRawDealRoom,
  removeRoom,
  updateRawDealRoom,
  VALID_DECK_IDS,
} = require('../../utils/room');
const { newUser } = require('../../utils/user');
const { startGame, getGame, endGame, forfeitGame } = require('./gameService');

function emitStateToRoom(io, roomId) {
  const game = getGame(roomId);
  if (!game) return;

  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets) return;

  for (const socketId of roomSockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s?.data?.rdUsername) continue;
    const seat = game.getSeatForUsername(s.data.rdUsername);
    if (seat < 0) continue;
    game.bindSocket(seat, s.id);
    s.emit('rd-state', game.getStateForSeat(seat));
  }

  if (game.engine.clearAnimationEvents) {
    game.engine.clearAnimationEvents();
  }
}

function maybeStartRawDealGame(io, redisClient, roomId) {
  redisClient.get(roomId, (err, reply) => {
    if (err || !reply) return;
    const room = JSON.parse(reply);
    void tryStartRawDealGame(io, roomId, room);
  });
}

async function tryStartRawDealGame(io, roomId, room) {
  if (room.gameType !== 'rawdeal') return;
  if (!room.players[0] || !room.players[1]) return;
  if (getGame(roomId)) return;
  if (room.gameStarted) return;

  room.gameStarted = true;
  updateRawDealRoom(roomId, room);

  const game = await startGame(roomId, room);

  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets) return;

  for (const socketId of roomSockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s?.data?.rdUsername) continue;
    const seat = game.getSeatForUsername(s.data.rdUsername);
    if (seat < 0) continue;
    game.bindSocket(seat, s.id);
    s.emit('rd-game-started', {
      myIndex: seat,
      players: room.players.map((p) => ({
        username: p.username,
        deckId: p.deckId,
      })),
    });
    s.emit('rd-state', game.getStateForSeat(seat));
  }
}

function handleRawDealDisconnect(io, socket, redisClient, sendRoomAndUserCounts) {
  const socketId = socket.id;
  redisClient.get(socketId, (err, reply) => {
    if (err || !reply) return;
    const user = JSON.parse(reply);
    if (!user.room) return;

    redisClient.get(user.room, (err, reply) => {
      if (err || !reply) return;
      const room = JSON.parse(reply);
      if (room.gameType !== 'rawdeal' || !room.gameStarted) return;

      const game = getGame(user.room);
      if (!game) return;

      const seat = game.getSeatForUsername(user.username);
      if (seat < 0) return;

      const winner = seat === 0 ? 1 : 0;
      forfeitGame(user.room, winner);
      emitStateToRoom(io, user.room);
      io.to(user.room).emit('rd-game-over', { winner, reason: 'forfeit' });
      endGame(user.room);
      removeRoom(user.room);
      sendRoomAndUserCounts();
    });
  });
}

function attachRawDealHandlers(socket, io, redisClient, sendRoomAndUserCounts) {
  socket.on('rd-get-rooms', () => {
    redisClient.get('rooms', (err, reply) => {
      if (err) throw err;
      if (!reply) {
        socket.emit('rd-receive-rooms', []);
        return;
      }
      const rooms = JSON.parse(reply).filter((r) => r.gameType === 'rawdeal');
      const listing = rooms.map((r) => ({
        id: r.id,
        hostUsername: r.players[0]?.username,
        hostDeckId: r.players[0]?.deckId,
        players: r.players[1] ? 2 : 1,
        hasPassword: !!(r.password && r.password !== ''),
      }));
      socket.emit('rd-receive-rooms', listing);
    });
  });

  socket.on('rd-create-room', (roomId, user, deckId, password = null) => {
    if (!VALID_DECK_IDS.has(deckId)) {
      socket.emit('rd-error', 'Invalid deck');
      return;
    }
    redisClient.get(roomId, (err, reply) => {
      if (err) throw err;
      if (reply) {
        socket.emit('rd-error', `Room '${roomId}' already exists`);
        return;
      }
      try {
        createRawDealRoom(roomId, user, deckId, password || null, (err) => {
          if (err) {
            socket.emit('rd-error', 'Failed to create room');
            return;
          }
          socket.emit('rd-room-created', roomId);
          sendRoomAndUserCounts();
        });
      } catch (e) {
        socket.emit('rd-error', e.message);
      }
    });
  });

  socket.on('rd-join-room', (roomId, user, deckId, password = null) => {
    if (!VALID_DECK_IDS.has(deckId)) {
      socket.emit('rd-error', 'Invalid deck');
      return;
    }
    redisClient.get(roomId, (err, reply) => {
      if (err) throw err;
      if (!reply) {
        socket.emit('rd-error', `Room '${roomId}' does not exist`);
        return;
      }
      const room = JSON.parse(reply);
      if (room.gameType !== 'rawdeal') {
        socket.emit('rd-error', 'Not a Raw Deal room');
        return;
      }
      if (room.players[1] !== null) {
        socket.emit('rd-error', `Room '${roomId}' is full`);
        return;
      }
      if (room.password && (!password || room.password !== password)) {
        socket.emit('rd-error', 'Incorrect password');
        return;
      }
      joinRawDealRoom(roomId, user, deckId, (err) => {
        if (err) {
          socket.emit('rd-error', err.message || 'Failed to join room');
          return;
        }
        if (password) {
          socket.emit('rd-room-joined', roomId, password);
        } else {
          socket.emit('rd-room-joined', roomId);
        }
      });
    });
  });

  socket.on('rd-join-random', (user, deckId) => {
    if (!VALID_DECK_IDS.has(deckId)) {
      socket.emit('rd-error', 'Invalid deck');
      return;
    }
    redisClient.get('rooms', (err, reply) => {
      if (err) throw err;
      if (!reply) {
        socket.emit('rd-error', 'No rooms available');
        return;
      }
      const rooms = JSON.parse(reply);
      const room = rooms.find(
        (r) => r.gameType === 'rawdeal' && r.players[1] === null && !r.password
      );
      if (!room) {
        socket.emit('rd-error', 'No rooms available');
        return;
      }
      joinRawDealRoom(room.id, user, deckId, (err) => {
        if (err) {
          socket.emit('rd-error', err.message || 'Failed to join room');
          return;
        }
        socket.emit('rd-room-joined', room.id);
      });
    });
  });

  socket.on('rd-user-connected', (user, roomId, password = null) => {
    socket.data.rdUsername = user.username;

    redisClient.get(roomId, (err, reply) => {
      if (err) throw err;
      if (!reply) {
        socket.emit('rd-error', `Room '${roomId}' does not exist`);
        return;
      }

      const room = JSON.parse(reply);
      if (room.gameType !== 'rawdeal') {
        socket.emit('rd-error', 'Not a Raw Deal room');
        return;
      }
      if (room.password && (!password || room.password !== password)) {
        socket.emit('rd-error', 'Incorrect password');
        return;
      }

      const isHost = room.players[0]?.username === user.username;
      const isGuest = room.players[1]?.username === user.username;
      if (!isHost && !isGuest) {
        socket.emit('rd-error', 'You are not in this room');
        return;
      }

      socket.join(roomId);
      newUser(socket.id, user, roomId);

      if (room.gameStarted && getGame(roomId)) {
        const game = getGame(roomId);
        const seat = game.getSeatForUsername(user.username);
        game.bindSocket(seat, socket.id);
        socket.emit('rd-game-started', {
          myIndex: seat,
          players: room.players.map((p) => ({
            username: p.username,
            deckId: p.deckId,
          })),
        });
        socket.emit('rd-state', game.getStateForSeat(seat));
        return;
      }

      socket.emit('rd-waiting', {
        players: room.players.map((p) =>
          p ? { username: p.username, deckId: p.deckId } : null
        ),
      });

      maybeStartRawDealGame(io, redisClient, roomId);
    });
  });

  socket.on('rd-action', async (roomId, action) => {
    const game = getGame(roomId);
    if (!game) {
      socket.emit('rd-error', 'Game not started');
      return;
    }

    const username = socket.data.rdUsername;
    const result = await game.applyAction(username, action);
    if (!result.ok) {
      socket.emit('rd-error', result.error || 'Invalid action');
      return;
    }

    emitStateToRoom(io, roomId);

    if (game.engine.winner !== null) {
      io.to(roomId).emit('rd-game-over', {
        winner: game.engine.winner,
        reason: game.engine.winReason,
      });
      endGame(roomId);
      removeRoom(roomId);
      sendRoomAndUserCounts();
    }
  });

  socket.on('rd-resync', (roomId) => {
    const game = getGame(roomId);
    if (!game) return;
    const seat = game.getSeatForUsername(socket.data.rdUsername);
    if (seat < 0) return;
    game.bindSocket(seat, socket.id);
    socket.emit('rd-state', game.getStateForSeat(seat));
  });
}

module.exports = {
  attachRawDealHandlers,
  handleRawDealDisconnect,
};