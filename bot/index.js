const TelegramBot = require('node-telegram-bot-api');
const db = require('../database');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const sessions = {};

console.log('✅ FastWin Telegram Bot started!');

// ── HELPERS ──────────────────────────────────────
async function send(chatId, text, opts = {}) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  } catch (e) {
    console.error('Send error:', e.message);
  }
}

async function getUser(telegramId) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE whatsapp_number = ? AND status = ?',
    [String(telegramId), 'active']
  );
  return rows[0] || null;
}

// ── MAIN MENU ────────────────────────────────────
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: '🎮 Play' },      { text: '📜 Bet History' }],
      [{ text: '👛 Wallet' },    { text: '📋 Transaction' }],
      [{ text: '➕ Add Money' }, { text: '📊 Game Rate' }],
      [{ text: '❓ Help' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  }
};

// ── START ─────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await getUser(String(chatId));

  if (user) {
    await send(chatId,
      `⚡ *Welcome back, ${user.name}!*\n\n` +
      `💰 Balance: *Rs. ${user.wallet_balance}*`,
      MAIN_MENU
    );
    return;
  }

  sessions[chatId] = { step: 'ask_name' };
  await send(chatId,
    `⚡ *Welcome to FastWin!*\n\n` +
    `Please enter your *full name* to register:`
  );
});

// ── MESSAGE HANDLER ──────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  const photo  = msg.photo;

  if (!text && !photo) return;

  // Photo — deposit screenshot
  if (photo) {
    const session = sessions[chatId];
    if (session?.step === 'awaiting_screenshot') {
      await send(chatId, '📷 Screenshot received! Verifying...');
      try {
        const fileId   = photo[photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const axios    = require('axios');
        const resp     = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer   = Buffer.from(resp.data);
        const { parseSMS } = require('../api/services/sms-parser');
        const { verifyAndCredit } = require('../api/services/verification');
        const Tesseract = require('tesseract.js');
        const sharp     = require('sharp');
        const enhanced  = await sharp(buffer).greyscale().normalize().sharpen().toBuffer();
        const { data: { text: ocrText } } = await Tesseract.recognize(enhanced, 'eng', { logger: () => {} });
        const parsed = parseSMS(ocrText);
        if (!parsed) {
          await send(chatId, '❌ Could not read screenshot. Please enter UTR manually.');
          sessions[chatId] = { step: 'manual_utr', depositAmount: session.depositAmount };
          return;
        }
        await verifyAndCredit(parsed, 'screenshot', String(chatId), bot, 'telegram');
      } catch (e) {
        await send(chatId, '❌ Error processing screenshot. Please enter UTR manually.');
        sessions[chatId] = { step: 'manual_utr', depositAmount: sessions[chatId]?.depositAmount };
      }
      return;
    }
    return;
  }

  if (text?.startsWith('/')) return;

  const user    = await getUser(String(chatId));
  const session = sessions[chatId];

  // ── REGISTRATION ────────────────────────────
  if (session?.step === 'ask_name') {
    if (text.length < 2) { await send(chatId, '❌ Enter a valid name.'); return; }
    sessions[chatId] = { step: 'ask_upi', name: text };
    await send(chatId, `✅ Name: *${text}*\n\nEnter your *UPI ID*:\n_Example: name@ybl_`);
    return;
  }

  if (session?.step === 'ask_upi') {
    if (!text.includes('@')) { await send(chatId, '❌ Invalid UPI ID. Example: name@ybl'); return; }
    await db.query(
      `INSERT INTO users (whatsapp_number, name, upi_id, wallet_balance, status, registered_at)
       VALUES (?, ?, ?, 0, 'active', NOW())`,
      [String(chatId), session.name, text.toLowerCase()]
    );
    delete sessions[chatId];
    await send(chatId,
      `🎉 *Registration Complete!*\n\n` +
      `👤 Name: *${session.name}*\n` +
      `💳 UPI: *${text.toLowerCase()}*\n` +
      `💰 Balance: *Rs. 0*\n\n` +
      `Use the menu below to get started! 🎯`,
      MAIN_MENU
    );
    return;
  }

  if (!user && !session) {
    await send(chatId, '⚠️ Please register first. Send /start');
    return;
  }

  // ── MENU COMMANDS ────────────────────────────
  switch (text) {
    case '🎮 Play':
      await handlePlay(chatId, user);
      break;
    case '📜 Bet History':
      await handleBetHistoryMarkets(chatId, user);
      break;
    case '👛 Wallet':
      await handleWallet(chatId, user);
      break;
    case '📋 Transaction':
      await handleTransaction(chatId, user);
      break;
    case '➕ Add Money':
      await handleAddMoney(chatId, user);
      break;
    case '📊 Game Rate':
      await handleGameRate(chatId);
      break;
    case '❓ Help':
      await handleHelp(chatId);
      break;
    default:
      if (session) await handleStep(chatId, user, text, session);
      break;
  }
});

// ══════════════════════════════════════════════════
// 🎮 PLAY
// ══════════════════════════════════════════════════
async function handlePlay(chatId, user) {
  const [markets] = await db.query(
    `SELECT * FROM markets WHERE status IN ('open','open_resulted') ORDER BY open_time`
  );
  if (!markets.length) {
    await send(chatId, '⏰ No markets are open right now.\n\nCheck back later!');
    return;
  }
  const buttons = markets.map((m, i) => ([{
    text: `${m.status === 'open' ? '🟢' : '🟡'} ${m.name}`,
    callback_data: `market_${m.id}`
  }]));
  await bot.sendMessage(chatId,
    `🎮 *Select Market:*\n━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }
  );
}
  // ── PLAY FLOW ──────────────────────────────
  if (session.step === 'play_select_market') {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || !session.markets[idx]) {
      await send(chatId, `❌ Enter number 1 to ${session.markets.length}`);
      return;
    }
    const market = session.markets[idx];
    sessions[chatId] = { step: 'play_enter_bets', market };

    const isOpenResulted = market.status === 'open_resulted';
    let msg = `✅ *${market.name}*\n━━━━━━━━━━━━━━━━\n\n`;

    if (!isOpenResulted) {
      msg +=
        `*Format:* \`Number=Amount\`\n\n` +
        `*Examples:*\n` +
        `\`4=50\` → Open Single 4, Rs.50\n` +
        `\`12=25\` → Jodi 12, Rs.25\n` +
        `\`126=10\` → Open Pana 126, Rs.10\n\n` +
        `📝 *Enter multiple bets (one per line):*`;
    } else {
      msg +=
        `🟡 *Open result declared — Close betting open*\n\n` +
        `*Format:* \`Number=Amount\`\n\n` +
        `*Examples:*\n` +
        `\`4=50\` → Close Single 4, Rs.50\n` +
        `\`126=10\` → Close Pana 126, Rs.10\n\n` +
        `📝 *Enter multiple bets (one per line):*`;
    }
    await send(chatId, msg);
    return;
  }

  if (session.step === 'play_enter_bets') {
    await processBets(chatId, user, text, session.market);
    return;
  }

  if (session.step === 'play_confirm') {
    if (text.toUpperCase() === 'NO') {
      delete sessions[chatId];
      await send(chatId, '❌ Bets cancelled.', MAIN_MENU);
      return;
    }
    if (text.toUpperCase() === 'YES') {
      await confirmBets(chatId, user, session);
      return;
    }
    await send(chatId, 'Send *YES* to confirm or *NO* to cancel');
    return;
  }

  // ── HISTORY MARKET SELECT ──────────────────
  if (session.step === 'history_select_market') {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || !session.markets[idx]) {
      await send(chatId, `❌ Enter number 1 to ${session.markets.length}`);
      return;
    }
    await showBetHistory(chatId, user, session.markets[idx]);
    delete sessions[chatId];
    return;
  }

  // ── DEPOSIT FLOW ───────────────────────────
  if (session.step === 'deposit_amount') {
    const amount = parseFloat(text);
    const MIN    = parseFloat(process.env.MIN_DEPOSIT || 100);
    const MAX    = parseFloat(process.env.MAX_DEPOSIT || 50000);
    if (isNaN(amount) || amount < MIN || amount > MAX) {
      await send(chatId, `❌ Amount must be between Rs. ${MIN} and Rs. ${MAX}`);
      return;
    }
    await db.query(
      `INSERT INTO deposits (user_id, amount, status, created_at) VALUES (?, ?, 'pending', NOW())`,
      [user.id, amount]
    );
    const adminUPI  = process.env.ADMIN_UPI  || 'admin@upi';
    const adminName = process.env.ADMIN_NAME || 'FastWin';
    const upiLink   = `upi://pay?pa=${adminUPI}&pn=${encodeURIComponent(adminName)}&am=${amount}&cu=INR`;
    sessions[chatId] = { step: 'awaiting_screenshot', depositAmount: amount };
    await send(chatId,
      `💰 *Pay Rs. ${amount}*\n━━━━━━━━━━━━━━━━\n\n` +
      `📱 UPI ID: \`${adminUPI}\`\n` +
      `👤 Name: *${adminName}*\n` +
      `💰 Amount: *Rs. ${amount}*\n\n` +
      `[👆 Tap to Pay](${upiLink})\n\n` +
      `After payment, send *screenshot* here.\n` +
      `⏳ Valid for 30 minutes.`
    );
    return;
  }

  if (session.step === 'manual_utr') {
    const utr = text.trim().toUpperCase();
    if (utr.length < 10) {
      await send(chatId, '❌ Invalid UTR. Please enter correct UTR number.');
      return;
    }
    const { verifyAndCredit } = require('../api/services/verification');
    await verifyAndCredit(
      { utr, amount: session.depositAmount },
      'manual', String(chatId), bot, 'telegram'
    );
    delete sessions[chatId];
    return;
  }

  // ── WITHDRAWAL FLOW ────────────────────────
  if (session.step === 'withdraw_amount') {
    const amount = parseFloat(text);
    const MIN    = parseFloat(process.env.MIN_WITHDRAW || 200);
    const MAX    = parseFloat(process.env.MAX_WITHDRAW || 25000);
    if (isNaN(amount) || amount < MIN) {
      await send(chatId, `❌ Minimum withdrawal is Rs. ${MIN}`);
      return;
    }
    if (amount > MAX) {
      await send(chatId, `❌ Maximum withdrawal is Rs. ${MAX}`);
      return;
    }
    if (amount > user.wallet_balance) {
      await send(chatId, `❌ Insufficient balance!\n\nYour balance: Rs. ${user.wallet_balance}`);
      return;
    }
    sessions[chatId] = { step: 'withdraw_confirm', amount };
    await send(chatId,
      `📋 *Confirm Withdrawal:*\n━━━━━━━━━━━━━━━━\n\n` +
      `💰 Amount: *Rs. ${amount}*\n` +
      `📱 UPI: *${user.upi_id}*\n\n` +
      `Send *YES* to confirm or *NO* to cancel`
    );
    return;
  }

  if (session.step === 'withdraw_confirm') {
    if (text.toUpperCase() === 'NO') {
      delete sessions[chatId];
      await send(chatId, '❌ Withdrawal cancelled.', MAIN_MENU);
      return;
    }
    if (text.toUpperCase() !== 'YES') {
      await send(chatId, 'Send *YES* or *NO*');
      return;
    }
    await db.query('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [session.amount, user.id]);
    const [result] = await db.query(
      `INSERT INTO withdrawals (user_id, amount, upi_id, status, created_at) VALUES (?, ?, ?, 'pending', NOW())`,
      [user.id, session.amount, user.upi_id]
    );
    delete sessions[chatId];
    await send(chatId,
      `✅ *Withdrawal Request Submitted!*\n━━━━━━━━━━━━━━━━\n\n` +
      `💰 Amount: *Rs. ${session.amount}*\n` +
      `📱 UPI: *${user.upi_id}*\n` +
      `🕐 Processing: 1-4 hours\n\n` +
      `You will be notified when payment is done! 🔔`,
      MAIN_MENU
    );
    // Notify admin
    try {
      const adminId = process.env.ADMIN_TELEGRAM_ID;
      if (adminId) {
        await send(adminId,
          `🔔 *New Withdrawal Request!*\n━━━━━━━━━━━━━━━━\n\n` +
          `👤 User: ${user.name}\n` +
          `📱 UPI: ${user.upi_id}\n` +
          `💰 Amount: Rs. ${session.amount}\n\n` +
          `Check admin panel!`
        );
      }
    } catch (e) {}
    return;
  }
}

// ══════════════════════════════════════════════════
// BET PROCESSING
// ══════════════════════════════════════════════════
async function processBets(chatId, user, text, market) {
  const lines  = text.split('\n').map(l => l.trim()).filter(l => l);
  const bets   = [];
  const errors = [];

  for (const line of lines) {
    // Accept =, -, ., : as separator
    const match = line.match(/^(\d+)\s*[=\-\.,:]\s*(\d+)$/);
    if (!match) {
      errors.push(`❌ Invalid format: \`${line}\``);
      continue;
    }
    const number = match[1];
    const amount = parseFloat(match[2]);
    const MIN    = parseFloat(process.env.MIN_BET || 10);

    if (amount < MIN) {
      errors.push(`❌ Min bet Rs.${MIN}: \`${line}\``);
      continue;
    }

    // Auto detect bet type
    const betType = detectBetType(number, market.status);
    if (!betType) {
      errors.push(`❌ Invalid number: \`${number}\``);
      continue;
    }

    bets.push({ number, amount, betType });
  }

  if (!bets.length) {
    await send(chatId,
      `❌ *No valid bets found!*\n\n` +
      `${errors.join('\n')}\n\n` +
      `*Format:* \`Number=Amount\`\n` +
      `Example:\n\`4=50\`\n\`12=25\`\n\`126=10\``
    );
    return;
  }

  const totalAmount = bets.reduce((s, b) => s + b.amount, 0);

  if (totalAmount > user.wallet_balance) {
    await send(chatId,
      `❌ *Insufficient balance!*\n\n` +
      `Total bet amount: Rs. ${totalAmount}\n` +
      `Your balance: Rs. ${user.wallet_balance}`
    );
    return;
  }

  // Show confirmation
  let msg = `📋 *Confirm Bets — ${market.name}*\n━━━━━━━━━━━━━━━━\n\n`;
  bets.forEach(b => {
    msg += `${b.betType.label}: *${b.number}* → Rs. ${b.amount} (${b.betType.multiplier}x)\n`;
  });

  if (errors.length) {
    msg += `\n⚠️ *Skipped:*\n${errors.join('\n')}\n`;
  }

  msg +=
    `\n💰 *Total: Rs. ${totalAmount}*\n` +
    `💰 Balance after: Rs. ${user.wallet_balance - totalAmount}\n\n` +
    `Send *YES* to confirm or *NO* to cancel`;

  sessions[chatId] = { step: 'play_confirm', market, bets, totalAmount };
  await send(chatId, msg);
}

function detectBetType(number, marketStatus) {
  const isClose = marketStatus === 'open_resulted';
  const len     = number.length;

  if (len === 1) {
    return isClose
      ? { key: 'close_single', label: 'Close Single', multiplier: 9 }
      : { key: 'open_single',  label: 'Open Single',  multiplier: 9 };
  }
  if (len === 2) {
    if (isClose) return null; // No jodi in close
    return { key: 'jodi', label: 'Jodi', multiplier: 90 };
  }
  if (len === 3) {
    // Triple pana check
    if (/^(\d)\1\1$/.test(number)) {
      return isClose
        ? { key: 'close_pana', label: 'Close Triple Pana', multiplier: 1000 }
        : { key: 'open_pana',  label: 'Open Triple Pana',  multiplier: 1000 };
    }
    return isClose
      ? { key: 'close_pana', label: 'Close Pana', multiplier: 300 }
      : { key: 'open_pana',  label: 'Open Pana',  multiplier: 150 };
  }
  return null;
}

async function confirmBets(chatId, user, session) {
  const { bets, market, totalAmount } = session;

  for (const bet of bets) {
    await db.query(
      `INSERT INTO bets (user_id, market_id, bet_type, number, amount, multiplier, possible_win, status, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [user.id, market.id, bet.betType.key, bet.number, bet.amount, bet.betType.multiplier, bet.amount * bet.betType.multiplier]
    );
  }

  await db.query('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [totalAmount, user.id]);
  const [updated] = await db.query('SELECT wallet_balance FROM users WHERE id = ?', [user.id]);
  delete sessions[chatId];

  let msg = `✅ *${bets.length} Bet(s) Placed!*\n━━━━━━━━━━━━━━━━\n\n`;
  bets.forEach(b => {
    msg += `${b.betType.label}: *${b.number}* → Rs. ${b.amount}\n`;
  });
  msg +=
    `\n💰 Total: Rs. ${totalAmount}\n` +
    `💰 Balance: Rs. ${updated[0].wallet_balance}\n\n` +
    `Good luck! 🤞`;

  await send(chatId, msg, MAIN_MENU);
}

// ══════════════════════════════════════════════════
// 📜 BET HISTORY
// ══════════════════════════════════════════════════
async function handleBetHistoryMarkets(chatId, user) {
  const [markets] = await db.query(
    'SELECT * FROM markets ORDER BY created_at DESC LIMIT 10'
  );
  if (!markets.length) {
    await send(chatId, '📜 No markets found.');
    return;
  }
  const buttons = markets.map(m => ([{
    text: `${m.name} (${m.status})`,
    callback_data: `history_${m.id}`
  }]));
  await bot.sendMessage(chatId,
    `📜 *Select Market for History:*\n━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }
  );
}

async function showBetHistory(chatId, user, market) {
  const [bets] = await db.query(
    `SELECT * FROM bets WHERE user_id = ? AND market_id = ? ORDER BY placed_at DESC`,
    [user.id, market.id]
  );
  if (!bets.length) {
    await send(chatId, `📜 No bets found for *${market.name}*`, MAIN_MENU);
    return;
  }
  let msg = `📜 *${market.name} — Your Bets*\n━━━━━━━━━━━━━━━━\n\n`;
  let total = 0;
  let won   = 0;
  bets.forEach(b => {
    const icon = b.status === 'won' ? '✅' : b.status === 'lost' ? '❌' : '⏳';
    const type = b.bet_type.replace('_', ' ').toUpperCase();
    msg  += `${icon} ${type}: *${b.number}* → Rs. ${b.amount}`;
    if (b.status === 'won') msg += ` *(Won Rs. ${b.actual_win})*`;
    msg  += '\n';
    total += parseFloat(b.amount);
    if (b.status === 'won') won += parseFloat(b.actual_win);
  });
  msg +=
    `\n━━━━━━━━━━━━━━━━\n` +
    `💰 Total Bet: Rs. ${total}\n` +
    `🏆 Total Won: Rs. ${won}`;
  await send(chatId, msg, MAIN_MENU);
}

// ══════════════════════════════════════════════════
// 👛 WALLET
// ══════════════════════════════════════════════════
async function handleWallet(chatId, user) {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [user.id]);
  const u = rows[0];
  await send(chatId,
    `👛 *Your Wallet*\n━━━━━━━━━━━━━━━━\n\n` +
    `💰 Balance: *Rs. ${u.wallet_balance}*\n\n` +
    `What would you like to do?`,
    {
      reply_markup: {
        keyboard: [
          [{ text: '➕ Add Money' }, { text: '🏧 Withdraw' }],
          [{ text: '🏠 Main Menu' }],
        ],
        resize_keyboard: true,
      }
    }
  );
}

// ══════════════════════════════════════════════════
// 📋 TRANSACTION
// ══════════════════════════════════════════════════
async function handleTransaction(chatId, user) {
  const [deps] = await db.query(
    `SELECT 'deposit' as type, amount, status, created_at FROM deposits
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );
  const [wds] = await db.query(
    `SELECT 'withdrawal' as type, amount, status, created_at FROM withdrawals
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );

  const all = [...deps, ...wds].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (!all.length) {
    await send(chatId, '📋 No transactions yet.', MAIN_MENU);
    return;
  }

  let msg = `📋 *Recent Transactions*\n━━━━━━━━━━━━━━━━\n\n`;
  all.forEach(t => {
    const icon   = t.type === 'deposit' ? '💰' : '🏧';
    const status = t.status === 'approved' || t.status === 'paid' ? '✅' : t.status === 'rejected' ? '❌' : '⏳';
    const date   = new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    msg += `${icon} ${t.type.toUpperCase()} — Rs. ${t.amount} ${status} (${date})\n`;
  });

  await send(chatId, msg, MAIN_MENU);
}

// ══════════════════════════════════════════════════
// ➕ ADD MONEY
// ══════════════════════════════════════════════════
async function handleAddMoney(chatId, user) {
  sessions[chatId] = { step: 'deposit_amount' };
  await send(chatId,
    `➕ *Add Money*\n━━━━━━━━━━━━━━━━\n\n` +
    `Minimum: Rs. ${process.env.MIN_DEPOSIT || 100}\n` +
    `Maximum: Rs. ${process.env.MAX_DEPOSIT || 50000}\n\n` +
    `Enter amount:`
  );
}

// ══════════════════════════════════════════════════
// 📊 GAME RATE
// ══════════════════════════════════════════════════
async function handleGameRate(chatId) {
  await send(chatId,
    `📊 *Game Rates*\n━━━━━━━━━━━━━━━━\n\n` +
    `🔢 *Open Single* → 9x\n` +
    `🔵 *Open Pana* → 150x\n` +
    `🟡 *Jodi* → 90x\n` +
    `🔴 *Close Single* → 9x\n` +
    `🟠 *Close Pana* → 300x\n` +
    `⚫ *Triple Pana* → 1000x\n\n` +
    `_Example: Rs.100 bet on Jodi = Rs.9,000 win_`,
    MAIN_MENU
  );
}

// ══════════════════════════════════════════════════
// ❓ HELP
// ══════════════════════════════════════════════════
async function handleHelp(chatId) {
  const supportNumber = process.env.SUPPORT_PHONE || '919999999999';
  await send(chatId,
    `❓ *Help & Support*\n━━━━━━━━━━━━━━━━\n\n` +
    `For any help, contact us on WhatsApp:\n\n` +
    `[👆 Click to WhatsApp](https://wa.me/${supportNumber})\n\n` +
    `📱 *${supportNumber}*\n\n` +
    `⏰ Support hours: 10 AM - 10 PM`,
    MAIN_MENU
  );
}

// ══════════════════════════════════════════════════
// RESULT NOTIFICATION (called from admin panel)
// ══════════════════════════════════════════════════
async function broadcastResult(marketName, openPana, openAnk, jodi, closePana, closeAnk) {
  try {
    const [users] = await db.query(`SELECT whatsapp_number FROM users WHERE status='active'`);
    const msg =
      `🎲 *RESULT DECLARED!*\n━━━━━━━━━━━━━━━━\n\n` +
      `🏪 *${marketName}*\n\n` +
      `*OPEN*\n` +
      `Pana: *${openPana}* | Ank: *${openAnk}*\n\n` +
      `*JODI: ${jodi || '—'}*\n\n` +
      `*CLOSE*\n` +
      `Pana: *${closePana || '—'}* | Ank: *${closeAnk || '—'}*\n\n` +
      `_Place your next bet!_ 🎯`;

    for (const u of users) {
      try {
        await bot.sendMessage(u.whatsapp_number, msg, { parse_mode: 'Markdown' });
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {}
    }
  } catch (e) {
    console.error('Broadcast error:', e.message);
  }
}

// ══════════════════════════════════════════════════
// WIN NOTIFICATION
// ══════════════════════════════════════════════════
async function notifyWin(telegramId, betType, number, betAmount, winAmount, newBalance) {
  try {
    await bot.sendMessage(telegramId,
      `🏆 *YOU WON!*\n━━━━━━━━━━━━━━━━\n\n` +
      `🎮 ${betType.replace('_',' ').toUpperCase()}: *${number}*\n` +
      `💰 Bet: Rs. ${betAmount}\n` +
      `🎉 Won: *Rs. ${winAmount}*\n\n` +
      `💰 New Balance: *Rs. ${newBalance}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {}
}

// ── CALLBACK QUERY HANDLER ────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;

  await bot.answerCallbackQuery(query.id);

  const user = await getUser(String(chatId));
  if (!user) {
    await send(chatId, '⚠️ Please register first. Send /start');
    return;
  }

  // Market selected for Play
  if (data.startsWith('market_')) {
    const marketId = parseInt(data.replace('market_', ''));
    const [markets] = await db.query(
      `SELECT * FROM markets WHERE status IN ('open','open_resulted')`
    );
    const market = markets.find(m => m.id === marketId);
    if (!market) {
      await send(chatId, '❌ Market not found.');
      return;
    }
    sessions[chatId] = { step: 'play_enter_bets', market };
    const isClose = market.status === 'open_resulted';
    let msg = `✅ *${market.name}*\n━━━━━━━━━━━━━━━━\n\n`;
    if (!isClose) {
      msg +=
        `*Format:* \`Number=Amount\`\n\n` +
        `*Examples:*\n` +
        `\`4=50\` → Open Single 4, Rs.50\n` +
        `\`12=25\` → Jodi 12, Rs.25\n` +
        `\`126=10\` → Open Pana 126, Rs.10\n\n` +
        `📝 *Enter bets (one per line):*`;
    } else {
      msg +=
        `🟡 *Close betting open*\n\n` +
        `*Format:* \`Number=Amount\`\n\n` +
        `*Examples:*\n` +
        `\`4=50\` → Close Single 4, Rs.50\n` +
        `\`126=10\` → Close Pana 126, Rs.10\n\n` +
        `📝 *Enter bets (one per line):*`;
    }
    await send(chatId, msg);
    return;
  }

  // Market selected for History
  if (data.startsWith('history_')) {
    const marketId = parseInt(data.replace('history_', ''));
    const [markets] = await db.query('SELECT * FROM markets WHERE id = ?', [marketId]);
    if (!markets.length) {
      await send(chatId, '❌ Market not found.');
      return;
    }
    await showBetHistory(chatId, user, markets[0]);
    return;
  }
});
module.exports = { bot, sessions, broadcastResult, notifyWin };
