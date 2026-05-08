const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const cron       = require('node-cron');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../admin')));

// Routes
app.use('/api/sms',      require('./routes/sms'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api/market',   require('./routes/market'));
app.use('/api/deposit',  require('./routes/deposit'));
app.use('/api/withdraw', require('./routes/withdraw'));

// Admin panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// ── CRON — Market auto close ──────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const db  = require('../database');
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2,'0');
    const mm  = String(now.getMinutes()).padStart(2,'0');
    const timeStr = `${hh}:${mm}`;

    await db.query(
      `UPDATE markets SET status = 'closed'
       WHERE status = 'open' AND close_time <= ?`,
      [timeStr]
    );
  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

// ── START SERVER ──────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// ── START TELEGRAM BOT ────────────────────────────
setTimeout(() => {
  try {
    require('../bot/index');
    console.log('🤖 Telegram Bot starting...');
  } catch (e) {
    console.error('Bot start error:', e.message);
  }
}, 3000);

module.exports = app;
