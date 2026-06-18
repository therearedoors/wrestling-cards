const redisClient = require('../config/redis')
// User Object -> {socket_id: {'username': 'testuser', 'user_rank': 'beginner', 'user_points': 1000, 'room': null}}
const newUser = (socketId, user, roomId=null) => {
    if (roomId) {
        user.room = roomId;
    }
    redisClient.set(socketId, JSON.stringify(user));
    // Use atomic INCR to avoid race conditions with multiple concurrent logins/tabs
    redisClient.incr('total-users', (err, newCount) => {
        if (err) {
            console.error('Error incrementing total-users:', err);
        }
    });
}

const removeUser = (socketId) => {
    redisClient.del(socketId);
    // Use atomic DECR; if it reaches <=0 clean up the key so reads return 0
    redisClient.decr('total-users', (err, newCount) => {
        if (err) {
            console.error('Error decrementing total-users:', err);
            return;
        }
        if (newCount <= 0) {
            redisClient.del('total-users');
        }
    });
}

module.exports = {
    newUser,
    removeUser
}