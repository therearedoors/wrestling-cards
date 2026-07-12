const { isDevModeAllowed, isDevelopment } = require('../../utils/env');

exports.getRegisterPage = (req, res) => {
  if (req.cookies.token) {
    return res.redirect('/');
  }
  res.render('auth/register', { authorized: false });
};

exports.getLoginPage = (req, res) => {
  if (req.cookies.token) {
    return res.redirect('/');
  }
  res.render('auth/login', { authorized: false });
};

exports.getLobbyPage = (req, res) => {
  if (!req.cookies.token) {
    return res.redirect('/login');
  }
  res.render('lobby', { authorized: true });
};

exports.getPracticePage = (req, res) => {
  if (!req.cookies.token) {
    return res.redirect('/login');
  }
  res.render('games/rawdeal/goldfish', {
    authorized: true,
    devMode: isDevModeAllowed(req),
    devModeAvailable: isDevelopment(),
  });
};

exports.getDecksPage = (req, res) => {
  if (!req.cookies.token) {
    return res.redirect('/login');
  }
  res.render('games/rawdeal/deck-builder', { authorized: true });
};

exports.getGamesPage = (req, res) => {
  if (!req.cookies.token) {
    return res.redirect('/login');
  }
  res.render('games/rawdeal/games', { authorized: true });
};

exports.getRoomPage = (req, res) => {
  if (!req.cookies.token) {
    return res.redirect('/login');
  }
  res.render('games/rawdeal/room', {
    authorized: true,
    devMode: isDevModeAllowed(req),
    devModeAvailable: isDevelopment(),
  });
};