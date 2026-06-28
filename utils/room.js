const redisClient = require('../config/redis');

const VALID_DECK_IDS = new Set(['rock', 'austin', 'undertaker', 'mankind', 'hhh', 'kane', 'jericho']);

const createRawDealRoom = (roomId, user, deckId, password = null, onDone = null) => {
  if (!VALID_DECK_IDS.has(deckId)) {
    throw new Error('Invalid deck id');
  }

  const host = { ...user, deckId };
  const room = {
    id: roomId,
    gameType: 'rawdeal',
    players: [host, null],
    gameStarted: false,
    gameState: null,
  };

  if (password) {
    room.password = password;
  }

  const finish = (err) => {
    if (typeof onDone === 'function') onDone(err);
  };

  redisClient.set(roomId, JSON.stringify(room), (err) => {
    if (err) return finish(err);

    redisClient.get('rooms', (err, reply) => {
      if (err) return finish(err);

      let rooms;
      let index;

      if (reply) {
        rooms = JSON.parse(reply);
        index = rooms.length;
        rooms.push(room);
      } else {
        index = 0;
        rooms = [room];
      }

      redisClient.set('rooms', JSON.stringify(rooms), (err) => {
        if (err) return finish(err);

        redisClient.get('roomIndices', (err, reply) => {
          if (err) return finish(err);

          const roomIndices = reply ? JSON.parse(reply) : {};
          roomIndices[`${roomId}`] = index;
          redisClient.set('roomIndices', JSON.stringify(roomIndices), (err) => {
            if (err) return finish(err);
            redisClient.incr('total-rooms');
            finish();
          });
        });
      });
    });
  });
};

const joinRawDealRoom = (roomId, user, deckId, onDone = null) => {
  if (!VALID_DECK_IDS.has(deckId)) {
    throw new Error('Invalid deck id');
  }

  const finish = (err) => {
    if (typeof onDone === 'function') onDone(err);
  };

  redisClient.get(roomId, (err, reply) => {
    if (err) return finish(err);

    if (!reply) return finish(new Error('Room not found'));

    const room = JSON.parse(reply);
    room.players[1] = { ...user, deckId };
    redisClient.set(roomId, JSON.stringify(room), (err) => {
      if (err) return finish(err);

      redisClient.get('roomIndices', (err, reply) => {
        if (err) return finish(err);

        if (!reply) return finish();

        const roomIndices = JSON.parse(reply);
        redisClient.get('rooms', (err, reply) => {
          if (err) return finish(err);

          if (reply) {
            const rooms = JSON.parse(reply);
            const idx = roomIndices[`${roomId}`];
            if (idx !== undefined && rooms[idx]) {
              rooms[idx].players[1] = { ...user, deckId };
              redisClient.set('rooms', JSON.stringify(rooms), finish);
              return;
            }
          }
          finish();
        });
      });
    });
  });
};

const updateRawDealRoom = (roomId, room) => {
  redisClient.set(roomId, JSON.stringify(room));

  redisClient.get('roomIndices', (err, reply) => {
    if (err) throw err;
    if (!reply) return;

    const roomIndices = JSON.parse(reply);
    redisClient.get('rooms', (err, reply) => {
      if (err) throw err;
      if (!reply) return;

      const rooms = JSON.parse(reply);
      const idx = roomIndices[roomId];
      if (idx !== undefined && rooms[idx]) {
        rooms[idx] = room;
        redisClient.set('rooms', JSON.stringify(rooms));
      }
    });
  });
};

const removeRoom = (roomId) => {
  redisClient.get(roomId, (err, roomReply) => {
    if (err) throw err;
    if (!roomReply) return;

    redisClient.del(roomId);

    redisClient.get('roomIndices', (err, reply) => {
      if (err) throw err;

      if (reply) {
        const roomIndices = JSON.parse(reply);
        const removeIndex = roomIndices[roomId];

        redisClient.get('rooms', (err, reply) => {
          if (err) throw err;

          if (reply) {
            const rooms = JSON.parse(reply);

            if (removeIndex !== undefined && removeIndex >= 0 && removeIndex < rooms.length) {
              rooms.splice(removeIndex, 1);

              for (let i = removeIndex; i < rooms.length; i++) {
                if (rooms[i] && rooms[i].id) {
                  roomIndices[rooms[i].id] = i;
                }
              }
            }
            delete roomIndices[roomId];

            redisClient.set('rooms', JSON.stringify(rooms));
            redisClient.set('roomIndices', JSON.stringify(roomIndices));
          }
        });
      }
    });

    redisClient.get('total-rooms', (err, reply) => {
      if (err) throw err;

      if (reply) {
        let totalRooms = parseInt(reply, 10);
        totalRooms = Math.max(0, totalRooms - 1);
        if (totalRooms === 0) {
          redisClient.del('total-rooms');
        } else {
          redisClient.set('total-rooms', String(totalRooms));
        }
      }
    });
  });
};

module.exports = {
  removeRoom,
  createRawDealRoom,
  joinRawDealRoom,
  updateRawDealRoom,
  VALID_DECK_IDS,
};