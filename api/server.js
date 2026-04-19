const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const cron       = require('node-cron');
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../admin')));

// ── ROUTES ────────────────────────────────────────────────
app.use('/api/sms',      require('./routes/sms'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api/market',   require('./routes/market'));
app.use('/api/deposit',  require('./routes/deposit'));
app.use('/api/withdraw', require('./routes/withdraw'));

// ── ADMIN PANEL ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// ── CRON JOBS ─────────────────────────────────────────────

// Har minute market status check karo
cron.schedule('* * * * *', async () => {
  try {
    const db = require('../database');
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5); // HH:MM

    // Markets jo close ho gaye
    await db.query(
      `UPDATE markets 
       SET status = 'closed'
       WHERE status = 'open'
       AND close_time <= ?`,
      [timeStr]
    );

    // PDF generate karo jab market close ho
    const [closedMarkets] = await db.query(
      `SELECT * FROM markets 
       WHERE status = 'closed'
       AND pdf_generated = 0`
    );

    for (const market of closedMarkets) {
      await generateMarketPDFs(market);
      await db.query(
        'UPDATE markets SET pdf_generated = 1 WHERE id = ?',
        [market.id]
      );
    }

  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

// ── PDF GENERATOR ─────────────────────────────────────────
async function generateMarketPDFs(market) {
  try {
    const { generateAllPDFs } = require('./services/pdf-generator');
    await generateAllPDFs(market);
    console.log(`✅ PDFs generated for market: ${market.name}`);
  } catch (err) {
    console.error('PDF generation error:', err.message);
  }
}

// ── START SERVER ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}`);
});

module.exports = app;
