const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../config/db');
const { validationResult } = require('express-validator');
const redisClient = require('../../config/redis');

const dotenv = require('dotenv');

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

exports.register = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.redirect('/register?error=' + errors.array()[0].msg);
        }
        const { username, email, password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            return res.redirect('/register?error=Passwords do not match');
        }

        let query = `SELECT * FROM users WHERE username = '${username}' OR email = '${email}'`;

        db.query(query, async (err, results) => {
            if (err) {
                throw err;
            }
            if (results.length > 0) {
                return res.redirect('/register?error=Username or email already exists');
            }
            
            const hashedPassword = await bcrypt.hash(password, 10);

            query = `CALL createUser('${username}', '${email}', '${hashedPassword}')`;

            db.query(query, (err) => {
                if (err) {
                    throw err;
                }
            query = `SELECT id FROM users WHERE email = '${email}'`;
                db.query(query, (err, result) => {
                    if (err) {
                        throw err;
                    }
                if (result.length === 0) {
                    return res.redirect('/register?error=Something went wrong')
                }
                let userId = result[0].id;

                const payload = { id: userId, username, email };

                jwt.sign(payload, JWT_SECRET, (err, token) => {
                    if (err) {
                        throw err;
                    }
                    res.cookie('token', token, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
                    res.cookie('user_rank', 'beginner', { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
                    res.cookie('user_points', '1000', { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });

                    res.redirect('/?success=Registration successful')
                    //res.json({ user: { payload, token} });
            });
        });
    });
});
    } catch (error) {
        console.error('Error during registration:', error);
        //res.status(500).json({ error: error.message });
        res.redirect('/register?error=Something went wrong')
    }
}

exports.login = async (req, res) => {
    try {
        console.log('Login request received with body:', req.body);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.redirect('/login?error=' + errors.array()[0].msg);
        }
        const { email, password } = req.body;
        let query = `SELECT * FROM users WHERE email = '${email}'`;
        
        db.query(query, async (err, results) => {
            if (err) {
                throw err;
            }
            if (results.length === 0) {
                return res.redirect('/login?error=Invalid email or password');
            }
            const user = results[0];
            const isMatch = await bcrypt.compare(password, user.password);
            
            if (!isMatch) {
                return res.redirect('/login?error=Invalid email or password');
            }
            query = `SELECT user_rank, user_points FROM user_info WHERE user_id = ${user.id}`;
            db.query(query, (err, result) => {
                if (err) {
                    throw err;
                }
                const { user_rank, user_points } = result[0];
                const payload = { id: user.id, username: user.username, email: email };
                jwt.sign(payload, JWT_SECRET, (err, token) => {
                    if (err) {
                        throw err;
                    }
                    res.cookie('token', token, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
                    res.cookie('user_rank', user_rank, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
                    res.cookie('user_points', user_points, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
                    
                    res.redirect('/?success=Login successful')
                    //res.json({ user: { payload, token} });
                });
        });
    });
    } catch (error) {
        console.error('Error during login:', error);
        res.redirect('/login?error=Something went wrong');
    }
}

exports.getInfo = (req, res) => {
    try {
        jwt.verify(req.cookies.token, JWT_SECRET, (err, userPayload) => {
            if (err) throw err;
            const { id, email, username } = userPayload

            let user = {
                id,
                email,
                username,
                user_rank: req.cookies.user_rank,
                user_points: req.cookies.user_points
            }
            return res.json(user);
            //redisClient.get(id, (err, reply) => {
            // let query = `SELECT user_rank, user_points FROM user_info WHERE user_id = ${id}`;
            // db.query(query, (err, result) => {
            //     if (err) throw err;
            //     if (result.length === 0) {
            //         return res.status(404).json({ error: 'User not found' });
            //     }
            //     let userInfo = result[0];
            //     res.cookie('token', token, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
            //     res.cookie('user_rank', user_rank, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
            //     res.cookie('user_points', user_points, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false, sameSite: 'strict' });
                    
                //const { user_rank, user_points } = result[0];
                //res.json({ id, email, username, user_rank, user_points });
            });
    } catch (err) {
        console.log('Error fetching user info:', err);
        res.status(500).json({ error: 'Server error' });
    }
};