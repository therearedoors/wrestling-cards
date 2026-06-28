# Wrestling Cards

A web app for playing **Raw Deal** — the WWE trading card game — solo (goldfish) or multiplayer.

## Prerequisites

- Node.js 18+
- MySQL 8+
- Redis

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment (`.env`):

```
PORT=3000
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=wrestling_cards
MYSQL_PORT=3306
JWT_SECRET=your_jwt_secret_key
```

3. Create the database schema (run migrations in order):

```bash
mysql -u root -p < migrations/001_initial_schema.sql
mysql -u root -p < migrations/002_rawdeal_decks.sql
```

4. Start Redis, then run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Routes

| Path | Description |
|------|-------------|
| `/` | Home lobby |
| `/practice` | Solo goldfish mode |
| `/games` | Multiplayer room lobby |
| `/room?id=...` | Live match |
| `/decks` | Deck builder |

## Tests

```bash
npm run test:rawdeal
```

## Card data

Premiere Edition card/deck data is generated from `data/premiere.txt`:

```bash
python3 scripts/build-premiere-data.py
```