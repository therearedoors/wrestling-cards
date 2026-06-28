const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../config/db');
const { validationResult } = require('express-validator');

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

    const query = `SELECT * FROM users WHERE username = '${username}' OR email = '${email}'`;

    db.query(query, async (err, results) => {
      if (err) throw err;
      if (results.length > 0) {
        return res.redirect('/register?error=Username or email already exists');
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const insertQuery = `CALL createUser('${username}', '${email}', '${hashedPassword}')`;

      db.query(insertQuery, (err) => {
        if (err) throw err;

        db.query(`SELECT id FROM users WHERE email = '${email}'`, (err, result) => {
          if (err) throw err;
          if (result.length === 0) {
            return res.redirect('/register?error=Something went wrong');
          }

          const userId = result[0].id;
          const payload = { id: userId, username, email };

          jwt.sign(payload, JWT_SECRET, (err, token) => {
            if (err) throw err;
            res.cookie('token', token, {
              maxAge: 1000 * 60 * 60 * 24,
              httpOnly: true,
              secure: false,
              sameSite: 'strict',
            });
            res.redirect('/?success=Registration successful');
          });
        });
      });
    });
  } catch (error) {
    console.error('Error during registration:', error);
    res.redirect('/register?error=Something went wrong');
  }
};

exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect('/login?error=' + errors.array()[0].msg);
    }
    const { email, password } = req.body;
    const query = `SELECT * FROM users WHERE email = '${email}'`;

    db.query(query, async (err, results) => {
      if (err) throw err;
      if (results.length === 0) {
        return res.redirect('/login?error=Invalid email or password');
      }

      const user = results[0];
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.redirect('/login?error=Invalid email or password');
      }

      const payload = { id: user.id, username: user.username, email };
      jwt.sign(payload, JWT_SECRET, (err, token) => {
        if (err) throw err;
        res.cookie('token', token, {
          maxAge: 1000 * 60 * 60 * 24,
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
        });
        res.redirect('/?success=Login successful');
      });
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.redirect('/login?error=Something went wrong');
  }
};

exports.getInfo = (req, res) => {
  try {
    jwt.verify(req.cookies.token, JWT_SECRET, (err, userPayload) => {
      if (err) throw err;
      const { id, email, username } = userPayload;
      return res.json({ id, email, username });
    });
  } catch (err) {
    console.log('Error fetching user info:', err);
    res.status(500).json({ error: 'Server error' });
  }
};