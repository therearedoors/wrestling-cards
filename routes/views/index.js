const {Router} = require('express');
const {getRegisterPage, getLoginPage, getLobbyPage, getGamesPage, getRoomPage, getRawDealGoldfishPage } = require('../../controllers/views/index')

const router = Router();

router.get("/register", getRegisterPage)

router.get("/login", getLoginPage)

router.get("/", getLobbyPage)

router.get("/games", getGamesPage)

router.get("/room", getRoomPage)

router.get("/rawdeal/goldfish", getRawDealGoldfishPage)

module.exports = router;