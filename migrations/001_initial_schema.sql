-- Wrestling Cards — base auth schema
CREATE DATABASE IF NOT EXISTS wrestling_cards;
USE wrestling_cards;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL
);

DELIMITER $$
CREATE PROCEDURE IF NOT EXISTS createUser(
  IN _username VARCHAR(255),
  IN _email VARCHAR(255),
  IN _password VARCHAR(255)
)
BEGIN
  DECLARE userId INT;

  INSERT INTO users (username, email, password)
  VALUES (_username, _email, _password);

  SELECT id INTO userId FROM users WHERE username = _username;
END $$
DELIMITER ;