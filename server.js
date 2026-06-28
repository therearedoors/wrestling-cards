const express = require('express');
const dotenv = require('dotenv');
const db = require('./config/db');
const redisClient = require('./config/redis');
const cookieParser = require('cookie-parser');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { newUser, removeUser } = require('./utils/user');

dotenv.config();

const viewRoutes = require('./routes/views');
const userRoutes = require('./routes/api/user');
const rawdealRoutes = require('./routes/api/rawdeal');
const { attachRawDealHandlers, handleRawDealDisconnect } = require('./server/rawdeal/sockets');

const app = express();
const server = http.createServer(app);

db.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    process.exit(1);
    return;
  }
  console.log('Connected to the MySQL database...');
});

app.use(cookieParser('secret'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', viewRoutes);
app.use('/api', userRoutes);
app.use('/api/rawdeal', rawdealRoutes);

const io = socketIo(server);

function sendRoomAndUserCounts(targetSocket = null) {
  redisClient.get('total-users', (err, usersReply) => {
    if (err) {
      console.error(err);
      return;
    }
    const totalUsers = usersReply ? parseInt(usersReply, 10) : 0;

    redisClient.get('total-rooms', (err, roomsReply) => {
      if (err) console.error(err);
      const totalRooms = roomsReply ? parseInt(roomsReply, 10) : 0;
      const payload = [totalRooms, totalUsers];
      if (targetSocket) {
        targetSocket.emit('receive-number-of-rooms-and-users', ...payload);
      } else {
        io.emit('receive-number-of-rooms-and-users', ...payload);
      }
    });
  });
}

io.on('connection', (socket) => {
  attachRawDealHandlers(socket, io, redisClient, sendRoomAndUserCounts);

  socket.on('user-connected', (user) => {
    newUser(socket.id, user);
    sendRoomAndUserCounts();
  });

  socket.on('send-total-rooms-and-users', () => {
    sendRoomAndUserCounts(socket);
  });

  socket.on('send-message', (message, user, roomId = null) => {
    if (roomId) {
      socket.to(roomId).emit('receive-message', message, user);
    } else {
      socket.broadcast.emit('receive-message', message, user, true);
    }
  });

  socket.on('disconnect', () => {
    handleRawDealDisconnect(io, socket, redisClient, sendRoomAndUserCounts);
    removeUser(socket.id);
    sendRoomAndUserCounts();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server is running at http://localhost:${PORT}`));