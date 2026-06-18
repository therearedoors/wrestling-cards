exports.getRegisterPage = (req, res) => {
    if (req.cookies.token) {
        return res.redirect('/')
    }
    res.render("auth/register", {authorized: false})
}

exports.getLoginPage = (req, res) => {
    if (req.cookies.token) {
        return res.redirect('/')
    }
    res.render("auth/login", {authorized: false})
}

exports.getLobbyPage = (req, res) => {
    if (!req.cookies.token) {
        return res.redirect('/login')
    }
    res.render("lobby", {authorized: true})
}

exports.getGamesPage = (req, res) => {
    if (!req.cookies.token) {
        return res.redirect('/login')
    }
    res.render("games", {authorized: true})
}

exports.getRoomPage = (req, res) => {
    if(!req.cookies.token){
        return res.redirect("/login")
    }

    res.render("room", {authorized: true});
} 
