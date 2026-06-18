const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

const redisClient = redis.createClient({
    host: redisHost,
    port: redisPort,
});

redisClient.on('error', (err) => {
    console.error('Redis error:', err);
    process.exit(1); // Exit the application if the Redis connection fails
});

redisClient.on('connect', () => {
    console.log('Connected to Redis server...');
});

module.exports = redisClient;