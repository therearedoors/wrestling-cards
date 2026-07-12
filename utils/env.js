function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isDevModeQuery(req) {
  return req.query.dev === '1';
}

function isDevModeAllowed(req) {
  return isDevelopment() && isDevModeQuery(req);
}

module.exports = {
  isDevelopment,
  isProduction,
  isDevModeQuery,
  isDevModeAllowed,
};