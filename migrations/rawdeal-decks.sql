-- Raw Deal deck overrides (per user)
USE online_chess;

CREATE TABLE IF NOT EXISTS rawdeal_deck_overrides (
  user_id INT NOT NULL,
  deck_id VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  superstar_id VARCHAR(64) NOT NULL,
  default_opponent VARCHAR(32) NOT NULL,
  cards JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, deck_id),
  CONSTRAINT fk_rd_deck_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);