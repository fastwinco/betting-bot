const express = require('express');
const router  = express.Router();
const { parseSMS }        = require('../services/sms-parser');
const { verifyAndCredit } = require('../services/verification');
require('dotenv').config();

// ── SMS RECEIVE ───────────────────────────────────────────
// Android app yahan SMS bhejti hai
router.post('/receive', async (req, res) => {
  try {
    const { from, body, timestamp } = req.body;

    console.log(`📱 SMS from: ${from}`);
    console.log(`📝 Body: ${body}`);

    // Secret key check karo
    const secret = req.headers['x-secret'] || req.body.secret;
    if (secret !== process.env.SMS_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Bank sender check karo
    if (!isBankSender(from)) {
      return res.json({ status: 'ignored', reason: 'Not bank SMS' });
    }

    // SMS parse karo
    const parsed = parseSMS(body);

    if (!parsed) {
      console.log('⚠️ Payment SMS nahi tha');
      return res.json({ status: 'ignored', reason: 'Not payment SMS' });
    }

    console.log(`💰 Parsed: UTR=${parsed.utr}, Amount=${parsed.amount}`);

    // Verify aur wallet credit karo
    const result = await verifyAndCredit(parsed, 'sms', null, null);

    res.json({ status: 'ok', result });

  } catch (err) {
    console.error('SMS receive error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── TEST ENDPOINT ─────────────────────────────────────────
// Test karne ke liye
router.post('/test', async (req, res) => {
  const { body } = req.body;
  const parsed = parseSMS(body || '');
  res.json({ parsed });
});

// ── BANK SENDER CHECK ─────────────────────────────────────
function isBankSender(sender) {
  if (!sender) return false;

  const BANK_SENDERS = [
    // Banks
    'HDFCBK', 'SBIINB', 'ICICIB', 'AXISBK',
    'PNBSMS', 'KOTAKB', 'YESBNK', 'IDFCBK',
    'BOIIND', 'UNIONB', 'CANBNK', 'CENTBK',
    'INDBNK', 'OBCBNK', 'SYNBNK', 'UCOBNK',
    // UPI Apps
    'PAYTM',  'PHONEPE', 'GPAY', 'BHIMUPI',
    'AMAZON', 'JIOPAY', 'MOBIKWIK', 'FREECHARGE',
    // Generic
    'ALERTS', 'CREDIT', 'DEBIT'
  ];

  const senderUpper = sender.toUpperCase();
  return BANK_SENDERS.some(b => senderUpper.includes(b));
}

module.exports = router;
