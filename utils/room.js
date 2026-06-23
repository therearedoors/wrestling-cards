const redisClient = require("../config/redis");

/*
    roomObj = { 
        'room_id': {
            'id': 'room_id',
            'players': [user1, user2], 
            'moves': [], 
            'time': 60 (in minutes), 
            'password': 'password', 
            gameStarted: false 
        } 
    }
*/

let numberOfRoomIndices = {
    'beginner': 0,
    'intermediate': 1,
    'advanced': 2,
    'expert': 3
}

const createRoom = (roomId, user, time, password=null) => {
    console.log("Creating room with id:", roomId, "time:", time, "user:", user, "password:", password);
    let room = {id: roomId, players: [null, null], moves: [], time, gameStarted: false}
    room.players[0] = user

    if(password){
        room.password = password;
    }

    redisClient.set(roomId, JSON.stringify(room));

    redisClient.get('rooms', (err, reply) => {
        if(err) throw err;

        let rooms;
        let index;

        if(reply){
            rooms = JSON.parse(reply);

            index = rooms.length;

            rooms.push(room);
        }else{
            index = 0;
            rooms = [room]
        }

        redisClient.set('rooms', JSON.stringify(rooms));

        redisClient.get('roomIndices', (err, reply) => {
            if(err) throw err;

            let roomIndices;

            if(reply){
                roomIndices = JSON.parse(reply);
            }else{
                roomIndices = {}
            }

            roomIndices[`${roomId}`] = index;

            redisClient.set('roomIndices', JSON.stringify(roomIndices));
        })
    })

    // Atomic increment for total-rooms (no race with concurrent creates)
    redisClient.incr('total-rooms');

    redisClient.get('number-of-rooms', (err, reply) => {
        if(err) throw err;

        let numberOfRooms = [0, 0, 0, 0]

        if(reply){
            numberOfRooms = JSON.parse(reply)
        }
        const idx = numberOfRoomIndices[user?.user_rank];
        if (idx !== undefined && idx >= 0 && idx < numberOfRooms.length) {
            numberOfRooms[idx] += 1;
        } else {
            // fallback to beginner bucket if rank missing
            numberOfRooms[0] += 1;
        }

        redisClient.set('number-of-rooms', JSON.stringify(numberOfRooms));
    })
}

const joinRoom = (roomId, user) => {
    redisClient.get(roomId, (err, reply) => {
    if(err) throw err;
    
    if(reply){
        let room = JSON.parse(reply);

        room.players[1] = user;

        redisClient.set(roomId, JSON.stringify(room));

        redisClient.get('roomIndices', (err, reply) => {
            if(err) throw err;

            if (reply){
                let roomIndices = JSON.parse(reply);

                redisClient.get('rooms', (err, reply) => {
                    if(err) throw err;

                    if(reply){
                        let rooms = JSON.parse(reply);
                        rooms[roomIndices[`${roomId}`]].players[1] = user;
                        
                        redisClient.set('rooms', JSON.stringify(rooms));
                    }
                });
            }
        });
    };
});
};

const removeRoom = (roomId, userRank) => {
    // First check if the room still exists. If not (e.g. already removed on normal game end
    // or previous disconnect), do nothing to avoid double-decrementing counters.
    redisClient.get(roomId, (err, roomReply) => {
        if (err) throw err;
        if (!roomReply) {
            return; // already cleaned up
        }

        // Determine the authoritative rank for this room (the creator's rank used at creation time)
        let rankForCount = userRank;
        try {
            const roomData = JSON.parse(roomReply);
            if (roomData && roomData.players && roomData.players[0] && roomData.players[0].user_rank) {
                rankForCount = roomData.players[0].user_rank;
            }
        } catch (e) {}

        redisClient.del(roomId);

        redisClient.get('roomIndices', (err, reply) => {
            if(err) throw err;

            if(reply){
                let roomIndices = JSON.parse(reply);
                const removeIndex = roomIndices[roomId];

                redisClient.get('rooms', (err, reply) => {
                    if(err) throw err;

                    if(reply){
                        let rooms = JSON.parse(reply);

                        if (removeIndex !== undefined && removeIndex >= 0 && removeIndex < rooms.length) {
                            rooms.splice(removeIndex, 1);

                            // Fix indices for all rooms that shifted after the removal
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
                })
            }
        })

        // Decrement total rooms (use correct key, clamp to >=0, clean when zero)
        redisClient.get('total-rooms', (err, reply) => {
            if(err) throw err;

            if(reply){
                let totalRooms = parseInt(reply);
                totalRooms = Math.max(0, totalRooms - 1);
                if (totalRooms === 0) {
                    redisClient.del('total-rooms');
                } else {
                    redisClient.set('total-rooms', totalRooms + "");
                }
            }
        })

        // Decrement per-rank count (use correct rank, declare properly, clamp >=0)
        redisClient.get('number-of-rooms', (err, reply) => {
            if(err) throw err;

            let numberOfRooms = [0, 0, 0, 0];
            if(reply){
                numberOfRooms = JSON.parse(reply);
            }
            const idx = numberOfRoomIndices[rankForCount];
            if (idx !== undefined && idx >= 0 && idx < numberOfRooms.length) {
                numberOfRooms[idx] = Math.max(0, numberOfRooms[idx] - 1);
            }
            redisClient.set('number-of-rooms', JSON.stringify(numberOfRooms));
        })
    });
}

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

module.exports = {
    createRoom,
    joinRoom,
    removeRoom,
    createRawDealRoom,
    joinRawDealRoom,
    updateRawDealRoom,
    VALID_DECK_IDS,
}