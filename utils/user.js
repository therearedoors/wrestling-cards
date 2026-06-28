const redisClient = require('../config/redis');

const newUser = (socketId, user, roomId = null) => {
  if (roomId) {
    user.room = roomId;
  }
  redisClient.set(socketId, JSON.stringify(user));
  redisClient.incr('total-users', (err) => {
    if (err) {
      console.error('Error incrementing total-users:', err);
    }
  });
};

const removeUser = (socketId) => {
  redisClient.del(socketId);
  redisClient.decr('total-users', (err, newCount) => {
    if (err) {
      console.error('Error decrementing total-users:', err);
      return;
    }
    if (newCount <= 0) {
      redisClient.del('total-users');
    }
  });
};

module.exports = {
  newUser,
  removeUser,
};