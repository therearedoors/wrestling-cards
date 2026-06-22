const express = require('express')
const dotenv = require('dotenv')
const db = require('./config/db')
const redisClient = require('./config/redis')
const cookieParser = require('cookie-parser')
const http = require('http')
const socketIo = require('socket.io')
const path = require('path')
const { newUser, removeUser } = require('./utils/user')

dotenv.config()

//Routes
const viewRoutes = require('./routes/views')
const userRoutes = require('./routes/api/user')
const rawdealRoutes = require('./routes/api/rawdeal')
const { createRoom, joinRoom, removeRoom } = require('./utils/room')

const app = express()

const server = http.createServer(app)

db.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        process.exit(1); // Exit the application if the database connection fails
        return;
    }
    console.log('Connected to the MySQL database...');
});

app.use(cookieParser('secret'))
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))
app.use(express.static(path.join(__dirname, "public")))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use("/", viewRoutes)
app.use("/api", userRoutes)
app.use("/api/rawdeal", rawdealRoutes)

const io = socketIo(server);

// Helper to read current counts from redis and either reply to one socket or broadcast to all
function sendRoomAndUserCounts(targetSocket = null) {
    redisClient.get('total-users', (err, reply) => {
        if (err) { console.error(err); return; }
        let totalUsers = reply ? parseInt(reply) : 0;
        let totalRooms = 0;
        let numberOfRooms = [0, 0, 0, 0];

        redisClient.get('total-rooms', (err, reply) => {
            if (err) { console.error(err); /* continue */ }
            if (reply) totalRooms = parseInt(reply);

            redisClient.get('number-of-rooms', (err, reply) => {
                if (err) { console.error(err); }
                if (reply) {
                    try { numberOfRooms = JSON.parse(reply); } catch(e){}
                }
                const payload = [numberOfRooms, totalRooms, totalUsers];
                if (targetSocket) {
                    targetSocket.emit('receive-number-of-rooms-and-users', ...payload);
                } else {
                    io.emit('receive-number-of-rooms-and-users', ...payload);
                }
            });
        });
    });
}

io.on('connection', (socket) => {

    socket.on('user-connected', (user, roomId=null, password=null) => {
    if (roomId) {
        redisClient.get(roomId, (err, reply) => {
            if (err) throw err;
            if (reply) {
                let room = JSON.parse(reply);
                if (room.gameStarted) {
                    socket.emit('error', 'The game has already started');
                    return;
                }
                if (room.password && (!password || room.password !== password)) {
                    socket.emit('error', 'To join the room you need the correct password');
                    return;
                }

                socket.join(roomId);
                newUser(socket.id, user, roomId);
                sendRoomAndUserCounts(); // live update totals for other open lobbies

                if (room.players[0].username === user.username) {
                    return;
                }

                if (room.players[1] === null) {
                    room.players[1] = user;
                }

                room.gameStarted = true;
                redisClient.set(roomId, JSON.stringify(room));
                socket.to(roomId).emit('game-started', user);

                redisClient.get('roomIndices', (err, reply) => {
                    if (err) throw err;

                    if (reply) {
                        let roomIndices = JSON.parse(reply);
                        redisClient.get('rooms', (err, reply) => {
                            if (err) throw err;

                            if (reply) {
                                let rooms = JSON.parse(reply);
                                rooms[roomIndices[roomId]] = room;
                                redisClient.set('rooms', JSON.stringify(rooms));
                            }
                        });
                    }
                });
            } else {
                socket.emit('error', `Room with id '${roomId}' does not exist`);
            }
            });
    } else {
        newUser(socket.id, user);
        sendRoomAndUserCounts();
    }
    });

    socket.on('get-game-details', (roomId, user) => {
        redisClient.get(roomId, (err, reply) => {
            if (err) throw err;
            if (reply) {
                let room = JSON.parse(reply);
                let details = {
                    players: room.players,
                    time: room.time
                }
                socket.emit('receive-game-details', details);
            }
        });
    });

    socket.on('send-total-rooms-and-users', () => {
        sendRoomAndUserCounts(socket);
    });

    socket.on('create-room', (roomId, time, user, password=null) => {
        redisClient.get(roomId, (err, reply) => {
            if (err) throw err;
            if (reply) {
                socket.emit('error', `Room with id '${roomId}' already exists`);
            } else {
                if (password) {
                    createRoom(roomId, user, time, password);
                } else {
                    createRoom(roomId, user, time);
                }
                socket.emit('room-created', roomId);
                sendRoomAndUserCounts(); // broadcast updated room/user counts to open lobbies
            }
        });
    });

    socket.on('join-room', (roomId, user, password=null) => {
        console.log("Joining room with id:", roomId, "user:", user, "password:", password);
        redisClient.get(roomId, (err, reply) => {
            if (err) throw err;
            if (reply) {
                let room = JSON.parse(reply);
                if (room.players[1] === null) {
                    if (room.password && (!password || room.password !== password)) {
                        socket.emit('error', 'To join the room you need the correct password');
                        return;
                    }
                    joinRoom(roomId, user);
                    if (room.password && room.password !== "") {
                        socket.emit('room-joined', roomId, password);
                    } else socket.emit('room-joined', roomId);
                } else {
                    socket.emit('error', `Room with id '${roomId}' is full`);
                    return;
                }
            } else {
                socket.emit('error', `Room with id '${roomId}' does not exist`);
            }
        });
    });

    socket.on('join-random', (user) => {
        redisClient.get('rooms', (err, reply) => {
            if (err) throw err;
            if (reply) {
                let rooms = JSON.parse(reply);
                let room = rooms.find(r => r.players[1] === null && !r.password);
                if (room) {
                    joinRoom(room.id, user);
                    socket.emit('room-joined', room.id);
                } else {
                    socket.emit('error', 'No rooms available to join');
                    return;
                }
            } else {
                socket.emit('error', 'No rooms available to join');
                return;
            }
        });
    });

    socket.on('get-rooms', (rank) => {
        redisClient.get('rooms', (err, reply) => {
            if (err) throw err;
            let rooms = [];
        
            if (reply) {
                let rooms = JSON.parse(reply);
                if (rank === "all") {
                    socket.emit('receive-rooms', rooms);
                } else {
                    let filteredRooms = rooms.filter(room => room.players[0].user_rank === rank);
                    socket.emit('receive-rooms', filteredRooms);
                }
            } else {
                socket.emit('receive-rooms', []);
            }
        });
    });

    socket.on('send-message', (message, user, roomId=null) => {
        if (roomId) {
            socket.to(roomId).emit('receive-message', message, user);
        } else {
            socket.broadcast.emit('receive-message', message, user, true);
        }
    });

    socket.on('move-made', (roomId, move, pawnPromotion=null, castling=null, elPassantPerformed=false) => {
        redisClient.get(roomId, (err, reply) => {
            if(err) throw err;

            if(reply){
                let room = JSON.parse(reply);

                room.moves.push(move);

                redisClient.set(roomId, JSON.stringify(room));

                if(pawnPromotion){
                    socket.to(roomId).emit('enemy-moved_pawn-promotion', move, pawnPromotion);
                }else if(castling){
                    socket.to(roomId).emit("enemy-moved_castling", castling);
                }else if(elPassantPerformed){
                    socket.to(roomId).emit('enemy-moved_el-passant', move)
                }else{
                    socket.to(roomId).emit('enemy-moved', move)
                }
            }else{
                socket.emit("error", "Something went wrong with the connection")
            }
        })
    })

    socket.on("update-timer", (roomId, minutes, seconds) => {
        socket.to(roomId).emit('enemy-timer-updated', minutes, seconds)
    })

    socket.on('check', (roomId) => {
        socket.to(roomId).emit('king-is-attacked')
    })

    // Game termination relays (so both players see checkmate / draw / timeout)
    socket.on('checkmate', (roomId, winner, myScore, gameStartedAtTimestamp) => {
        io.to(roomId).emit('checkmate', winner, myScore, gameStartedAtTimestamp)
        // Clean up the room immediately on normal end so counters are correct
        // and later disconnects of the players don't double-decrement.
        removeRoom(roomId);
        sendRoomAndUserCounts();
    })

    socket.on('draw', (roomId) => {
        io.to(roomId).emit('draw')
        removeRoom(roomId);
        sendRoomAndUserCounts();
    })

    socket.on('game-draw', (roomId) => {
        io.to(roomId).emit('game-draw')
        removeRoom(roomId);
        sendRoomAndUserCounts();
    })

    socket.on('timer-ended', (roomId, username, gameStartedAtTimestamp) => {
        io.to(roomId).emit('timer-ended', username, gameStartedAtTimestamp)
        removeRoom(roomId);
        sendRoomAndUserCounts();
    })

    // Draw offer flow (WebSocket request/response style between players)
    socket.on('offer-draw', (roomId) => {
        socket.to(roomId).emit('draw-offered')
    })

    socket.on('accept-draw', (roomId) => {
        io.to(roomId).emit('draw-accepted')
    })

    socket.on('decline-draw', (roomId) => {
        socket.to(roomId).emit('draw-declined')
    })

    socket.on('disconnect', () => {
        let socketId = socket.id;
        redisClient.get(socketId, (err, reply) => {
            if (err) throw err;
            if (reply) {
                let user = JSON.parse(reply);
                if (user.room) {
                    redisClient.get(user.room, (err, reply) => {
                        if (err) throw err;
                        if (reply) {
                            let room = JSON.parse(reply);
                            if (!room.gameFinished) {
                                io.to(user.room).emit('error', 'The other player has left the game');
                            }
                        }
                    });
                    removeRoom(user.room, user.user_rank);
                }
            }
        });
        removeUser(socket.id);
        sendRoomAndUserCounts();
    });

});
const  PORT = process.env.PORT || 3000

server.listen(PORT, () => console.log('Server is running on at http://localhost:' + PORT))