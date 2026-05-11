const TelegramBot = require('node-telegram-bot-api');
const db = require('../database');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } }
});

const sessions = {};
console.log('✅ FastWin Bot: Part 1 Loaded!');

// ── HELPERS ──────────────────────────────────────
async function send(chatId, text, opts = {}) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  } catch (e) { console.error('Send error:', e.message); }
}

async function getUser(telegramId) {
  const [rows] = await db.query(
    'SELECT * FROM users WHERE whatsapp_number = ? AND status = ?',
    [String(telegramId), 'active']
  );
  return rows[0] || null;
}

const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: '🎮 Play' },      { text: '📜 Bet History' }],
      [{ text: '👛 Wallet' },    { text: '📋 Transaction' }],
      [{ text: '➕ Add Money' }, { text: '📊 Game Rate'   }],
      [{ text: '⚙️ Settings' },  { text: '❓ Help'         }],
    ],
    resize_keyboard: true,
  }
};

// ── START & REGISTRATION ──────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getUser(chatId);
  if (user) {
    return await send(chatId, `⚡ *Welcome back, ${user.name}!*\n💰 Balance: *Rs. ${user.wallet_balance}*`, MAIN_MENU);
  }
  sessions[chatId] = { step: 'ask_name' };
  await send(chatId, `⚡ *Welcome to FastWin!*\n\nPlease enter your *full name* to register:`);
});

// ── MAIN MESSAGE ROUTER ───────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const user = await getUser(chatId);
  const session = sessions[chatId];

  // Button Handling
  if (['🎮 Play', '📜 Bet History', '👛 Wallet', '📋 Transaction', '➕ Add Money', '📊 Game Rate', '⚙️ Settings', '❓ Help'].includes(text)) {
    if (!user) return send(chatId, '⚠️ Please register first.');
    switch (text) {
      case '🎮 Play': await handlePlay(chatId); break;
      case '📜 Bet History': await handleBetHistoryMarkets(chatId, user); break;
      case '👛 Wallet': await handleWallet(chatId, user); break;
      case '📋 Transaction': await handleTransaction(chatId, user); break;
      case '➕ Add Money': await handleAddMoney(chatId); break;
      case '📊 Game Rate': await handleGameRate(chatId); break;
      case '⚙️ Settings': await handleSettings(chatId, user); break;
      case '❓ Help': await handleHelp(chatId); break;
    }
    return;
  }

  // Registration Flow
  if (!user && session) {
    if (session.step === 'ask_name') {
      sessions[chatId] = { step: 'ask_upi', name: text };
      await send(chatId, `✅ Name: *${text}*\n\nEnter your *UPI ID* (e.g. name@apl):`);
    } else if (session.step === 'ask_upi') {
      if (!text.includes('@')) return send(chatId, '❌ Invalid UPI ID.');
      await db.query('INSERT INTO users (whatsapp_number, name, upi_id, wallet_balance, status, registered_at) VALUES (?, ?, ?, 0, "active", NOW())', [String(chatId), session.name, text.toLowerCase()]);
      delete sessions[chatId];
      await send(chatId, '🎉 Registration Complete!', MAIN_MENU);
    }
    return;
  }

  // Session Handler (Betting, Deposits, etc.)
  if (user && session) await handleMainSteps(chatId, user, text, session);
});

// ── CORE STEP HANDLER ─────────────────────────────
async function handleMainSteps(chatId, user, text, session) {
  // Betting Input
  if (session.step === 'play_enter_bets') return await processBets(chatId, user, text, session.market);

  // Deposit Logic
  if (session.step === 'deposit_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 100) return send(chatId, '❌ Min deposit Rs. 100');
    let adminUPI = process.env.ADMIN_UPI || 'admin@upi';
    sessions[chatId] = { step: 'await_utr', depositAmount: amount };
    await bot.sendMessage(chatId, `💰 Pay *Rs. ${amount}* to:\n\`${adminUPI}\`\n\nSend 12-digit *UTR Number* after payment:`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '💳 Pay Now', url: `upi://pay?pa=${adminUPI}&am=${amount}&cu=INR` }]] }
    });
  }

  // UTR Validation
  if (session.step === 'await_utr') {
    const utr = text.replace(/\s+/g, '');
    if (utr.length < 10) return send(chatId, '❌ Invalid UTR.');
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [session.depositAmount, user.id]);
    await db.query('INSERT INTO transactions (user_id, type, amount, utr_number, status, created_at) VALUES (?, "deposit", ?, ?, "approved", NOW())', [user.id, session.depositAmount, utr]);
    delete sessions[chatId];
    await send(chatId, `✅ Rs. ${session.depositAmount} Added!`, MAIN_MENU);
  }

  // Settings Update
  if (session.step === 'update_name') {
    await db.query('UPDATE users SET name = ? WHERE whatsapp_number = ?', [text, String(chatId)]);
    delete sessions[chatId];
    await send(chatId, '✅ Name updated!', MAIN_MENU);
  }
}

// ── GAME FUNCTIONS ────────────────────────────────
async function handlePlay(chatId) {
  const [markets] = await db.query("SELECT * FROM markets WHERE status IN ('open','open_resulted')");
  if (!markets.length) return send(chatId, '⏰ No markets open.');
  const buttons = markets.map(m => ([{ text: `${m.name}`, callback_data: `market_${m.id}` }]));
  await bot.sendMessage(chatId, '🎮 *Select Market:*', { reply_markup: { inline_keyboard: buttons } });
}

async function processBets(chatId, user, text, market) {
  const lines = text.split('\n');
  let bets = [], total = 0;
  for (let line of lines) {
    const match = line.match(/^(\d+)\s*[=\-:\s]\s*(\d+)$/);
    if (match) { 
      bets.push({ number: match[1], amount: parseFloat(match[2]) }); 
      total += parseFloat(match[2]); 
    }
  }
  if (!bets.length) return send(chatId, '❌ Format: `Number=Amount`');
  if (total > user.wallet_balance) return send(chatId, '❌ Low balance.');

  sessions[chatId] = { step: 'play_confirm', market, bets, totalAmount: total };
  await bot.sendMessage(chatId, `📋 *Confirm Total: Rs. ${total}*`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: 'bet_yes' }, { text: '❌ Cancel', callback_data: 'bet_no' }]] }
  });
}

async function confirmBets(chatId, user, session) {
  if (!session?.bets) return;
  for (let b of session.bets) {
    await db.query('INSERT INTO bets (user_id, market_id, number, amount, status, placed_at) VALUES (?, ?, ?, ?, "pending", NOW())', [user.id, session.market.id, b.number, b.amount]);
  }
  await db.query('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [session.totalAmount, user.id]);
  delete sessions[chatId];
  await send(chatId, '✅ Bets placed!', MAIN_MENU);
}

// ── OTHER HANDLERS ────────────────────────────────
async function handleWallet(chatId, user) {
  await send(chatId, `👛 *Wallet*\nBalance: *Rs. ${user.wallet_balance}*`, {
    reply_markup: { inline_keyboard: [[{ text: '➕ Add Money', callback_data: 'wallet_add' }]] }
  });
}

async function handleSettings(chatId, user) {
  await bot.sendMessage(chatId, '⚙️ *Settings*', {
    reply_markup: { inline_keyboard: [[{ text: '👤 Change Name', callback_data: 'set_name' }], [{ text: '📱 Update UPI', callback_data: 'set_upi' }]] }
  });
}

// Global Callback Handler for Inline Buttons
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const user = await getUser(chatId);
  if (q.data === 'bet_yes') await confirmBets(chatId, user, sessions[chatId]);
  if (q.data.startsWith('market_')) {
    const mId = q.data.split('_')[1];
    const [m] = await db.query('SELECT * FROM markets WHERE id=?', [mId]);
    sessions[chatId] = { step: 'play_enter_bets', market: m[0] };
    await send(chatId, `🎯 *${m[0].name}*\nEnter your bets:`);
  }
  await bot.answerCallbackQuery(q.id);
});

// Stubs for missing functions
async function handleBetHistoryMarkets(chatId) { await send(chatId, '📜 History coming soon!', MAIN_MENU); }
async function handleTransaction(chatId) { await send(chatId, '📋 Transactions coming soon!', MAIN_MENU); }
async function handleGameRate(chatId) { await send(chatId, '📊 Rates: Single 1:9, Jodi 1:90', MAIN_MENU); }
async function handleHelp(chatId) { await send(chatId, '❓ Contact @Admin for support.', MAIN_MENU); }
async function handleAddMoney(chatId) { sessions[chatId] = { step: 'deposit_amount' }; await send(chatId, '➕ Enter amount:'); }

module.exports = { bot, sessions };
