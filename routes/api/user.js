const {Router} = require('express')
const { register, login, getInfo } = require('../../controllers/api/user')
const { check } = require('express-validator')

const router = Router()

router.post('/register', [
    check('username', 'Username is required').notEmpty(),
    check('email', 'Email is required').notEmpty(),
    check('email', 'Please enter a vaid email').isEmail(),
    check('password', 'Password is required').notEmpty(),
    check('confirmPassword', 'Please confirm password').notEmpty()
], register)

router.post('/login', [
    check('email', 'Email is required').notEmpty(),
    check('email', 'Please enter a vaid email').isEmail(),
    check('password', 'Password is required').notEmpty()
], login)

router.get('/user-info', getInfo)

module.exports = router