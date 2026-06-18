const {Router} = require('express');
const {getRegisterPage, getLoginPage, getLobbyPage, getGamesPage, getRoomPage } = require('../../controllers/views/index')

const router = Router();

router.get("/register", getRegisterPage)

router.get("/login", getLoginPage)

router.get("/", getLobbyPage)

router.get("/games", getGamesPage)

router.get("/room", getRoomPage)

module.exports = router;