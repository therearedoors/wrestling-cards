const {Router} = require('express');
const {getRegisterPage, 
    getLoginPage, 
    getLobbyPage, 
    getGamesPage, 
    getRoomPage, 
    getRawDealGoldfishPage, 
    getRawDealDeckBuilderPage,
    getRawDealGamesPage,
    getRawDealRoomPage,
    } = require('../../controllers/views/index')

const router = Router();

router.get("/register", getRegisterPage)

router.get("/login", getLoginPage)

router.get("/", getLobbyPage)

router.get("/games", getGamesPage)

router.get("/room", getRoomPage)

router.get("/rawdeal/goldfish", getRawDealGoldfishPage)

router.get("/rawdeal/decks", getRawDealDeckBuilderPage)

router.get("/rawdeal/games", getRawDealGamesPage)

router.get("/rawdeal/room", getRawDealRoomPage)

module.exports = router;