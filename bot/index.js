const TelegramBot = require('node-telegram-bot-api');
const db = require('../database');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

console.log('✅ Telegram Bot started!');

// User sessions
const sessions = {};

// Helper: Send message
async function send(chatId, text, opts = {}) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  } catch (e) {
    console.error('Send error:', e.message);
  }
}

// Helper: Get user
async function getUser(telegramId) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE whatsapp_number = ? AND status = ?',
    [String(telegramId), 'active']
  );
  return rows[0] || null;
}

// ── MAIN MENU ────────────────────────────────────
function mainMenu(balance) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '💰 Deposit' }, { text: '🏧 Withdraw' }],
        [{ text: '🎯 Bet' },     { text: '📊 Balance' }],
        [{ text: '🕐 Markets' }, { text: '📜 History' }],
        [{ text: '🏆 Results' }, { text: '❓ Help' }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    }
  };
}

// ── START / REGISTER ─────────────────────────────
bot.onText(/\/start|^Hi$|^hi$|^Hello$|^hello$/i, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(chatId);

  const user = await getUser(telegramId);

  if (user) {
    await send(chatId,
      `⚡ *Welcome back, ${user.name}!*\n\n` +
      `💰 Balance: *Rs. ${user.wallet_balance}*\n\n` +
      `Use the menu below:`,
      mainMenu(user.wallet_balance)
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

  // Photo — screenshot deposit
  if (photo) {
    const session = sessions[chatId];
    if (session?.step === 'awaiting_screenshot') {
      await send(chatId, '📷 Screenshot received! Verifying...');
      try {
        const fileId   = photo[photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const axios    = require('axios');
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer   = Buffer.from(response.data);
        const { processScreenshot } = require('./services/ocr-telegram');
        await processScreenshot(buffer, String(chatId), session.depositAmount, bot);
      } catch (e) {
        await send(chatId, '❌ Could not process screenshot. Please try again or enter UTR manually.');
      }
      delete sessions[chatId];
    } else {
      await send(chatId, '⚠️ Please use *DEPOSIT* command first, then send screenshot.');
    }
    return;
  }

  // Skip commands
  if (text?.startsWith('/')) return;

  const user = await getUser(String(chatId));
  const session = sessions[chatId];

  // ── REGISTRATION FLOW ────────────────────────
  if (session?.step === 'ask_name') {
    if (text.length < 2) {
      await send(chatId, '❌ Please enter a valid name.');
      return;
    }
    sessions[chatId] = { step: 'ask_upi', name: text };
    await send(chatId, `✅ Name: *${text}*\n\nPlease enter your *UPI ID*:\n_Example: name@ybl_`);
    return;
  }

  if (session?.step === 'ask_upi') {
    if (!text.includes('@')) {
      await send(chatId, '❌ Invalid UPI ID. Example: name@ybl');
      return;
    }
    const name = session.name;
    await db.query(
      `INSERT INTO users (whatsapp_number, name, upi_id, wallet_balance, status, registered_at)
       VALUES (?, ?, ?, 0, 'active', NOW())`,
      [String(chatId), name, text.toLowerCase()]
    );
    delete sessions[chatId];
    await send(chatId,
      `🎉 *Registration Complete!*\n\n` +
      `👤 Name: *${name}*\n` +
      `💳 UPI: *${text.toLowerCase()}*\n` +
      `💰 Balance: *Rs. 0*\n\n` +
      `Use the menu to get started! 🎯`,
      mainMenu(0)
    );
    return;
  }

  // ── REQUIRE LOGIN ────────────────────────────
  if (!user) {
    await send(chatId, '⚠️ Please register first. Send /start');
    return;
  }

  // ── COMMANDS ─────────────────────────────────
  switch (text) {
    case '📊 Balance':
      await handleBalance(chatId, user);
      break;
    case '💰 Deposit':
      await handleDeposit(chatId, user);
      break;
    case '🏧 Withdraw':
      await handleWithdraw(chatId, user);
      break;
    case '🕐 Markets':
      await handleMarkets(chatId);
      break;
    case '🎯 Bet':
      await handleBet(chatId, user);
      break;
    case '📜 History':
      await handleHistory(chatId, user);
      break;
    case '🏆 Results':
      await handleResults(chatId);
      break;
    case '❓ Help':
      await handleHelp(chatId);
      break;
    default:
      // Session step handler
      if (session) {
        await handleStep(chatId, user, text, session);
      }
      break;
  }
});

// ── BALANCE ──────────────────────────────────────
async function handleBalance(chatId, user) {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [user.id]);
  const u = rows[0];
  const [stats] = await db.query(
    `SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as bet_amount,
     COALESCE(SUM(actual_win),0) as won,
     COUNT(CASE WHEN status='won' THEN 1 END) as wins,
     COUNT(CASE WHEN status='lost' THEN 1 END) as losses,
     COUNT(CASE WHEN status='pending' THEN 1 END) as pending
     FROM bets WHERE user_id = ?`, [u.id]
  );
  const s = stats[0];
  await send(chatId,
    `💰 *Your Wallet*\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `Balance: *Rs. ${u.wallet_balance}*\n\n` +
    `📊 *Stats:*\n` +
    `• Total Bets: ${s.total}\n` +
    `• Total Wagered: Rs. ${s.bet_amount}\n` +
    `• Total Won: Rs. ${s.won}\n` +
    `• ✅ Wins: ${s.wins} | ❌ Losses: ${s.losses} | ⏳ Pending: ${s.pending}`
  );
}

// ── DEPOSIT ──────────────────────────────────────
async function handleDeposit(chatId, user) {
  const MIN = process.env.MIN_DEPOSIT || 100;
  const MAX = process.env.MAX_DEPOSIT || 50000;
  sessions[chatId] = { step: 'deposit_amount' };
  await send(chatId,
    `💰 *Deposit*\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `Minimum: Rs. ${MIN}\n` +
    `Maximum: Rs. ${MAX}\n\n` +
    `Enter amount:`
  );
}

// ── WITHDRAW ─────────────────────────────────────
async function handleWithdraw(chatId, user) {
  const MIN = parseFloat(process.env.MIN_WITHDRAW || 200);
  if (user.wallet_balance < MIN) {
    await send(chatId,
      `❌ *Insufficient Balance*\n\n` +
      `Your balance: Rs. ${user.wallet_balance}\n` +
      `Minimum withdrawal: Rs. ${MIN}`
    );
    return;
  }
  sessions[chatId] = { step: 'withdraw_amount' };
  await send(chatId,
    `🏧 *Withdrawal*\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `Balance: *Rs. ${user.wallet_balance}*\n` +
    `Minimum: Rs. ${MIN}\n\n` +
    `Enter amount:`
  );
}

// ── MARKETS ──────────────────────────────────────
async function handleMarkets(chatId) {
  const [markets] = await db.query(
    `SELECT * FROM markets WHERE status IN ('open','open_resulted') ORDER BY open_time`
  );
  if (!markets.length) {
    await send(chatId, '⏰ No markets are open right now.\n\nCheck back later.');
    return;
  }
  let msg = `🕐 *Active Markets*\n━━━━━━━━━━━━━━━━\n\n`;
  markets.forEach((m, i) => {
    msg += `${i + 1}. *${m.name}*\n`;
    msg += `   Open: ${m.open_time?.slice(0,5)} | Close: ${m.close_time?.slice(0,5)}\n\n`;
  });
  msg += `Send *BET* to place a bet 🎯`;
  await send(chatId, msg);
}

// ── BET ──────────────────────────────────────────
async function handleBet(chatId, user) {
  const [markets] = await db.query(
    `SELECT * FROM markets WHERE status = 'open' ORDER BY open_time`
  );
  if (!markets.length) {
    await send(chatId, '⏰ No markets are open for betting right now.');
    return;
  }
  let msg = `🎯
