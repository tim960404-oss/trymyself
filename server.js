const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'mahjong.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player1 TEXT, player2 TEXT, player3 TEXT, player4 TEXT,
    base_score INTEGER,
    unit_price INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME
  )`);

  // 舊版資料庫遷移：補上 base_score 欄位
  db.run(`ALTER TABLE games ADD COLUMN base_score INTEGER DEFAULT 0`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS rounds (
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
  db.run(`ALTER TABLE rounds ADD COLUMN winner TEXT`, () => {});
  db.run(`ALTER TABLE rounds ADD COLUMN loser TEXT`, () => {});
  db.run(`ALTER TABLE rounds ADD COLUMN tai INTEGER`, () => {});
  db.run(`ALTER TABLE rounds ADD COLUMN amount INTEGER`, () => {});
  db.run(`ALTER TABLE rounds ADD COLUMN is_self_draw INTEGER DEFAULT 0`, () => {});
});

// 建立新對局 (4位玩家 + 每台金額)
app.post('/api/games', (req, res) => {
  const { players, baseScore, unitPrice } = req.body;
  if (!Array.isArray(players) || players.length !== 4 || !unitPrice) {
    return res.status(400).json({ error: '需要4位玩家名稱與每台金額' });
  }
  const [p1, p2, p3, p4] = players;
  const base = baseScore || 0;
  db.run(
    `INSERT INTO games (player1, player2, player3, player4, base_score, unit_price) VALUES (?,?,?,?,?,?)`,
    [p1, p2, p3, p4, base, unitPrice],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, players, baseScore: base, unitPrice });
    }
  );
});

// 取得對局資訊
app.get('/api/games/:id', (req, res) => {
  db.get(`SELECT * FROM games WHERE id = ?`, [req.params.id], (err, game) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!game) return res.status(404).json({ error: '找不到對局' });
    db.all(`SELECT * FROM rounds WHERE game_id = ? ORDER BY id ASC`, [req.params.id], (err2, rounds) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ game, rounds });
    });
  });
});

// 新增一局結果 (贏家 / 輸家 / 台數 / 是否自摸)
app.post('/api/games/:id/rounds', (req, res) => {
  const { winner, loser, tai, isSelfDraw } = req.body;
  const gameId = req.params.id;
  const selfDraw = !!isSelfDraw;

  if (!winner || tai === undefined || tai < 0) {
    return res.status(400).json({ error: '請提供贏家與台數' });
  }
  if (!selfDraw && (!loser || winner === loser)) {
    return res.status(400).json({ error: '請提供有效的輸家' });
  }

  db.get(`SELECT unit_price, base_score FROM games WHERE id = ?`, [gameId], (err, game) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!game) return res.status(404).json({ error: '找不到對局' });
    const perPerson = (game.base_score || 0) + tai * game.unit_price;
    const amount = selfDraw ? perPerson * 3 : perPerson;
    const loserValue = selfDraw ? null : loser;
    db.run(
      `INSERT INTO rounds (game_id, winner, loser, tai, amount, is_self_draw) VALUES (?,?,?,?,?,?)`,
      [gameId, winner, loserValue, tai, amount, selfDraw ? 1 : 0],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ id: this.lastID, winner, loser: loserValue, tai, amount, isSelfDraw: selfDraw, perPerson });
      }
    );
  });
});

// 刪除最後一局 (撤回)
app.delete('/api/games/:id/rounds/last', (req, res) => {
  const gameId = req.params.id;
  db.get(`SELECT id FROM rounds WHERE game_id = ? ORDER BY id DESC LIMIT 1`, [gameId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json({ deleted: false });
    db.run(`DELETE FROM rounds WHERE id = ?`, [row.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ deleted: true, id: row.id });
    });
  });
});

// 結束對局
app.post('/api/games/:id/end', (req, res) => {
  db.run(`UPDATE games SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ended: true });
  });
});

// 歷史對局列表
app.get('/api/games', (req, res) => {
  db.all(`SELECT * FROM games ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`麻將記帳伺服器運行於 http://localhost:${PORT}`);
}); 