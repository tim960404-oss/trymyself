const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'mahjong.db'));

db.exec(`CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player1 TEXT, player2 TEXT, player3 TEXT, player4 TEXT,
  base_score INTEGER,
  unit_price INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME
)`);

// 舊版資料庫遷移：補上 base_score 欄位
try { db.exec(`ALTER TABLE games ADD COLUMN base_score INTEGER DEFAULT 0`); } catch (e) {}

db.exec(`CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER,
  winner TEXT,
  loser TEXT,
  tai INTEGER,
  amount INTEGER,
  is_self_draw INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(game_id) REFERENCES games(id)
)`);

// 舊版資料庫遷移：補上缺少的欄位
try { db.exec(`ALTER TABLE rounds ADD COLUMN winner TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE rounds ADD COLUMN loser TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE rounds ADD COLUMN tai INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE rounds ADD COLUMN amount INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE rounds ADD COLUMN is_self_draw INTEGER DEFAULT 0`); } catch (e) {}

// 建立新對局 (4位玩家 + 底分 + 每台金額)
app.post('/api/games', (req, res) => {
  try {
    const { players, baseScore, unitPrice } = req.body;
    if (!Array.isArray(players) || players.length !== 4 || !unitPrice) {
      return res.status(400).json({ error: '需要4位玩家名稱與每台金額' });
    }
    const [p1, p2, p3, p4] = players;
    const base = baseScore || 0;
    const stmt = db.prepare(
      `INSERT INTO games (player1, player2, player3, player4, base_score, unit_price) VALUES (?,?,?,?,?,?)`
    );
    const info = stmt.run(p1, p2, p3, p4, base, unitPrice);
    res.json({ id: info.lastInsertRowid, players, baseScore: base, unitPrice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取得對局資訊
app.get('/api/games/:id', (req, res) => {
  try {
    const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id);
    if (!game) return res.status(404).json({ error: '找不到對局' });
    const rounds = db.prepare(`SELECT * FROM rounds WHERE game_id = ? ORDER BY id ASC`).all(req.params.id);
    res.json({ game, rounds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增一局結果 (贏家 / 輸家 / 台數 / 是否自摸)
app.post('/api/games/:id/rounds', (req, res) => {
  try {
    const { winner, loser, tai, isSelfDraw } = req.body;
    const gameId = req.params.id;
    const selfDraw = !!isSelfDraw;

    if (!winner || tai === undefined || tai < 0) {
      return res.status(400).json({ error: '請提供贏家與台數' });
    }
    if (!selfDraw && (!loser || winner === loser)) {
      return res.status(400).json({ error: '請提供有效的輸家' });
    }

    const game = db.prepare(`SELECT unit_price, base_score FROM games WHERE id = ?`).get(gameId);
    if (!game) return res.status(404).json({ error: '找不到對局' });

    const perPerson = (game.base_score || 0) + tai * game.unit_price;
    const amount = selfDraw ? perPerson * 3 : perPerson;
    const loserValue = selfDraw ? null : loser;

    const stmt = db.prepare(
      `INSERT INTO rounds (game_id, winner, loser, tai, amount, is_self_draw) VALUES (?,?,?,?,?,?)`
    );
    const info = stmt.run(gameId, winner, loserValue, tai, amount, selfDraw ? 1 : 0);

    res.json({ id: info.lastInsertRowid, winner, loser: loserValue, tai, amount, isSelfDraw: selfDraw, perPerson });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除最後一局 (撤回)
app.delete('/api/games/:id/rounds/last', (req, res) => {
  try {
    const gameId = req.params.id;
    const row = db.prepare(`SELECT id FROM rounds WHERE game_id = ? ORDER BY id DESC LIMIT 1`).get(gameId);
    if (!row) return res.json({ deleted: false });
    db.prepare(`DELETE FROM rounds WHERE id = ?`).run(row.id);
    res.json({ deleted: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 結束對局
app.post('/api/games/:id/end', (req, res) => {
  try {
    db.prepare(`UPDATE games SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
    res.json({ ended: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 歷史對局列表
app.get('/api/games', (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM games ORDER BY id DESC`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`麻將記帳伺服器運行於 http://localhost:${PORT}`);
});