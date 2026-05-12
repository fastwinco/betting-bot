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
    const timeStr = `${hh}:${mm}:00`;

    // Open time aane par market open karo
    await db.query(
      `UPDATE markets SET status = 'open'
       WHERE status = 'closed'
       AND open_time <= ? AND close_time > ?`,
      [timeStr, timeStr]
    );

    // Close time aane par market band karo
    await db.query(
      `UPDATE markets SET status = 'closed'
       WHERE status = 'open'
       AND close_time <= ?`,
      [timeStr]
    );

    // Raat 12 baje — resulted markets reset karo agle din ke liye
    if (hh === '00' && mm === '00') {
      await db.query(
        `UPDATE markets SET
          status = 'open',
          result_single = NULL,
          result_jodi = NULL,
          result_open_pana = NULL,
          result_close_pana = NULL,
          resulted_at = NULL,
          pdf_generated = 0
         WHERE status = 'resulted'`
      );
      console.log('✅ Markets reset for new day');
    }

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
