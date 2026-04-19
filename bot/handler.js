const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const db = require('../database');
require('dotenv').config();

// User sessions memory mein
const sessions = {};

async function handleMessage(sock, msg) {
  const jid   = msg.key.remoteJid;
  const phone = jid.replace('@s.whatsapp.net', '');

  // Group messages ignore karo
  if (jid.endsWith('@g.us')) return;

  const msgType = Object.keys(msg.message)[0];

  // ── IMAGE MESSAGE (Screenshot deposit) ──────────────────
  if (msgType === 'imageMessage') {
    const session = sessions[phone];
    if (session?.step === 'awaiting_screenshot') {
      await sock.sendMessage(jid, { text: '📷 Screenshot mil gaya! Check ho raha hai...' });
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const { processScreenshot } = require('../api/services/ocr');
        await processScreenshot(buffer, phone, session.depositAmount, sock);
      } catch (e) {
        await sock.sendMessage(jid, { text: '❌ Screenshot process nahi hua. Dobara bhejo.' });
      }
      delete sessions[phone];
    } else {
      await sock.sendMessage(jid, { text: '⚠️ Pehle DEPOSIT command bhejo, phir screenshot.' });
    }
    return;
  }

  // ── TEXT MESSAGE ─────────────────────────────────────────
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text || ''
  ).trim().toUpperCase();

  if (!text) return;

  // User check karo
  const user = await getUser(phone);

  // Register nahi hai
  if (!user) {
    if (['START', 'HI', 'HELLO', 'REG'].includes(text)) {
      await require('./commands/register').handle(sock, jid, phone, sessions);
    } else {
      await sock.sendMessage(jid, {
        text: '👋 Swagat hai!\n\n*START* bhejo register karne ke liye.'
      });
    }
    return;
  }

  // ── MAIN COMMANDS ────────────────────────────────────────
  switch (text) {
    case 'START':
    case 'HI':
    case 'HELLO':
      await sendMenu(sock, jid, user);
      break;

    case 'MENU':
    case 'M':
      await sendMenu(sock, jid, user);
      break;

    case 'BALANCE':
    case 'BAL':
    case '1':
      await require('./commands/balance').handle(sock, jid, user);
      break;

    case 'DEPOSIT':
    case 'DEP':
    case '2':
      await require('./commands/deposit').handle(sock, jid, phone, user, sessions);
      break;

    case 'WITHDRAW':
    case 'WD':
    case '3':
      await require('./commands/withdraw').handle(sock, jid, phone, user, sessions);
      break;

    case 'MARKETS':
    case 'MKT':
    case '4':
      await require('./commands/markets').handle(sock, jid);
      break;

    case 'PLAY':
    case 'P':
    case '5':
      await require('./commands/play').handle(sock, jid, phone, user, sessions);
      break;

    case 'HISTORY':
    case 'HIS':
    case '6':
      await require('./commands/history').handle(sock, jid, user);
      break;

    case 'RESULTS':
    case 'RES':
    case '7':
      await require('./commands/results').handle(sock, jid);
      break;

    case 'HELP':
    case '8':
      await sendHelp(sock, jid);
      break;

    default:
      await handleStep(sock, jid, phone, user, text, sessions);
      break;
  }
}

// ── SESSION STEP ROUTER ──────────────────────────────────────────────────
async function handleStep(sock, jid, phone, user, text, sessions) {
  const session = sessions[phone];

  if (!session) {
    await sock.sendMessage(jid, {
      text: '❓ Samajh nahi aaya.\n\n*MENU* bhejo options dekhne ke liye.'
    });
    return;
  }

  switch (session.command) {
    case 'register':
      await require('./commands/register').handleStep(sock, jid, phone, text, sessions);
      break;
    case 'deposit':
      await require('./commands/deposit').handleStep(sock, jid, phone, user, text, sessions);
      break;
    case 'withdraw':
      await require('./commands/withdraw').handleStep(sock, jid, phone, user, text, sessions);
      break;
    case 'play':
      await require('./commands/play').handleStep(sock, jid, phone, user, text, sessions);
      break;
    default:
      await sock.sendMessage(jid, { text: '❓ *MENU* bhejo.' });
  }
}

// ── MENU ──────────────────────────────────────────────────────────────────
async function sendMenu(sock, jid, user) {
  await sock.sendMessage(jid, {
    text:
      `🎯 *BETTING BOT*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👛 Balance: *Rs. ${user.wallet_balance}*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `1️⃣  BALANCE\n` +
      `2️⃣  DEPOSIT\n` +
      `3️⃣  WITHDRAW\n` +
      `4️⃣  MARKETS\n` +
      `5️⃣  PLAY\n` +
      `6️⃣  HISTORY\n` +
      `7️⃣  RESULTS\n` +
      `8️⃣  HELP\n\n` +
      `_Number ya command bhejo_ 👆`
  });
}

// ── HELP ──────────────────────────────────────────────────────────────────
async function sendHelp(sock, jid) {
  await sock.sendMessage(jid, {
    text:
      `❓ *HELP*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `*Play Types:*\n` +
      `• Open Single → 9x\n` +
      `• Jodi → 90x\n` +
      `• Open Pana → 150x\n` +
      `• Close Single → 9x\n` +
      `• Close Pana → 300x\n\n` +
      `*Deposit:* Min Rs. 100\n` +
      `*Withdraw:* Min Rs. 200\n` +
      `*Play:* Min Rs. 10\n\n` +
      `Support: ${process.env.ADMIN_PHONE || 'Admin se contact karein'}`
  });
}

// ── HELPER ────────────────────────────────────────────────────────────────
async function getUser(phone) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE whatsapp_number = ? AND status = ?',
    [phone, 'active']
  );
  return rows[0] || null;
}

module.exports = { handleMessage };
