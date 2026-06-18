const mysql = require('mysql2');
const dotenv = require('dotenv');

dotenv.config();

const user = process.env.MYSQL_USER;
const password = process.env.MYSQL_PASSWORD;
const host = process.env.MYSQL_HOST;
const database = process.env.MYSQL_DATABASE;
const port = process.env.MYSQL_PORT;

const db = mysql.createConnection({
    host: host,
    user: user,
    password: password,
    database: database,
    port: port
});

module.exports = db;