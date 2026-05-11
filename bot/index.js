const TelegramBot = require('node-telegram-bot-api');
const db = require('../database');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 10 }
  }
});
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

const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: '🎮 Play' },      { text: '📜 Bet History' }],
      [{ text: '👛 Wallet' },    { text: '📋 Transaction' }],
      [{ text: '➕ Add Money' }, { text: '📊 Game Rate'   }],
      [{ text: '⚙️ Settings' }, { text: '❓ Help'         }],
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

// ── CALLBACK QUERY ────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  await bot.answerCallbackQuery(query.id);

  const user = await getUser(String(chatId));
  if (!user) {
    await send(chatId, '⚠️ Please register first. Send /start');
    return;
  }

  // ── MARKET FOR PLAY ────────────────────────────
  if (data.startsWith('market_')) {
    const marketId = parseInt(data.replace('market_', ''));
    const [markets] = await db.query(
      `SELECT * FROM markets WHERE id = ? AND status IN ('open','open_resulted')`,
      [marketId]
    );
    if (!markets.length) {
      await send(chatId, '❌ Market not available.');
      return;
    }
    const market  = markets[0];
    const isClose = market.status === 'open_resulted';
    sessions[chatId] = { step: 'play_enter_bets', market };
    const statusText = isClose ? '🟡 Close Betting Open' : '🟢 Open Betting';
    await send(chatId,
      `✅ *${market.name}*\n━━━━━━━━━━━━━━━━\n\n` +
      `${statusText}\n\nEnter bets:`
    );
    return;
  }

  // ── MARKET FOR HISTORY ─────────────────────────
  if (data.startsWith('history_')) {
    const marketId = parseInt(data.replace('history_', ''));
    const [markets] = await db.query('SELECT * FROM markets WHERE id = ?', [marketId]);
    if (!markets.length) { await send(chatId, '❌ Market not found.'); return; }
    await showBetHistory(chatId, user, markets[0]);
    return;
  }

  // ── WALLET ADD ─────────────────────────────────
  if (data === 'wallet_add') {
    sessions[chatId] = { step: 'deposit_amount' };
    await send(chatId,
      `➕ *Add Money*\n━━━━━━━━━━━━━━━━\n\n` +
      `Min: Rs. ${process.env.MIN_DEPOSIT || 100}\n` +
      `Max: Rs. ${process.env.MAX_DEPOSIT || 50000}\n\n` +
      `Enter amount:`
    );
    return;
  }

  // ── WALLET WITHDRAW ────────────────────────────
  if (data === 'wallet_withdraw') {
    const freshUser = await getUser(String(chatId));
    const MIN = parseFloat(process.env.MIN_WITHDRAW || 200);
    if (freshUser.wallet_balance < MIN) {
      await send(chatId,
        `❌ *Insufficient Balance*\n\n` +
        `Your balance: Rs. ${freshUser.wallet_balance}\n` +
        `Minimum: Rs. ${MIN}`
      );
      return;
    }
    sessions[chatId] = { step: 'withdraw_amount' };
    await send(chatId,
      `🏧 *Withdrawal*\n━━━━━━━━━━━━━━━━\n\n` +
      `Balance: *Rs. ${freshUser.wallet_balance}*\n` +
      `Min: Rs. ${MIN}\n` +
      `Max: Rs. ${process.env.MAX_WITHDRAW || 25000}\n\n` +
      `Enter amount:`
    );
    return;
  }

  // ── BET YES ────────────────────────────────────
  if (data === 'bet_yes') {
    const session = sessions[chatId];
    if (!session || session.step !== 'play_confirm') {
      await send(chatId, '⚠️ Session expired. Please place bets again.');
      return;
    }
    await confirmBets(chatId, user, session);
    return;
  }

  // ── BET NO ─────────────────────────────────────
  if (data === 'bet_no') {
    delete sessions[chatId];
    await send(chatId, '❌ Bets cancelled.', MAIN_MENU);
    return;
  }

  // ── WITHDRAW YES ───────────────────────────────
  if (data === 'wd_yes') {
    const session = sessions[chatId];
    if (!session || session.step !== 'withdraw_confirm') {
      await send(chatId, '⚠️ Session expired. Please try again.');
      return;
    }
    await processWithdraw(chatId, session);
    return;
  }

  // ── WITHDRAW NO ────────────────────────────────
  if (data === 'wd_no') {
    delete sessions[chatId];
    await send(chatId, '❌ Withdrawal cancelled.', MAIN_MENU);
    return;
  }

  // ── SETTINGS ───────────────────────────────────
  if (data === 'set_name') {
    sessions[chatId] = { step: 'update_name' };
    await send(chatId,
      `👤 *Change Name*\n\nEnter your new name:`
    );
    return;
  }

  if (data === 'set_upi') {
    sessions[chatId] = { step: 'update_upi' };
    await send(chatId,
      `📱 *Update UPI ID*\n\nEnter your new UPI ID:\n_Example: name@ybl_`
    );
    return;
  }

  if (data === 'set_bank') {
    sessions[chatId] = { step: 'update_bank_ac' };
    await send(chatId,
      `🏦 *Update Bank Account*\n\nEnter your *Account Number*:`
    );
    return;
  }
});

// ── MESSAGE HANDLER ──────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  const photo  = msg.photo;

  if (!text && !photo) return;

  // ── SCREENSHOT ─────────────────────────────────
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
        const { parseSMS }        = require('../api/services/sms-parser');
        const { verifyAndCredit } = require('../api/services/verification');
        const Tesseract = require('tesseract.js');
        const sharp     = require('sharp');
        const enhanced  = await sharp(buffer).greyscale().normalize().sharpen().toBuffer();
        const { data: { text: ocrText } } = await Tesseract.recognize(enhanced, 'eng', { logger: () => {} });
        const parsed = parseSMS(ocrText);
        if (!parsed) {
          await send(chatId, '❌ Could not read screenshot.\n\nPlease enter *UTR number* manually:');
          sessions[chatId] = { step: 'manual_utr', depositAmount: session.depositAmount };
          return;
        }
        await verifyAndCredit(parsed, 'screenshot', String(chatId), bot, 'telegram');
        delete sessions[chatId];
      } catch (e) {
        await send(chatId, '❌ Error processing screenshot.\n\nPlease enter *UTR number* manually:');
        sessions[chatId] = { step: 'manual_utr', depositAmount: sessions[chatId]?.depositAmount };
      }
    } else {
      await send(chatId, '⚠️ Please use *Add Money* first, then send screenshot.');
    }
    return;
  }

  if (text?.startsWith('/')) return;

  const user    = await getUser(String(chatId));
  const session = sessions[chatId];

  // ── REGISTRATION ───────────────────────────────
  if (session?.step === 'ask_name') {
    if (text.length < 2) { await send(chatId, '❌ Enter a valid name.'); return; }
    sessions[chatId] = { step: 'ask_upi', name: text };
    await send(chatId, `✅ Name: *${text}*\n\nEnter your *UPI ID*:\n_Example: name@ybl_`);
    return;
  }

  if (session?.step === 'ask_upi') {
    if (!text.includes('@')) {
      await send(chatId, '❌ Invalid UPI ID.\nExample: name@ybl');
      return;
    }
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
      `💰 Balance: *Rs. 0*`,
      MAIN_MENU
    );
    return;
  }

  if (!user && !session) {
    await send(chatId, '⚠️ Please register first. Send /start');
    return;
  }

  // ── MENU SWITCH ────────────────────────────────
  switch (text) {
    case '🎮 Play':        await handlePlay(chatId, user);              break;
    case '📜 Bet History': await handleBetHistoryMarkets(chatId, user); break;
    case '👛 Wallet':      await handleWallet(chatId, user);            break;
    case '📋 Transaction': await handleTransaction(chatId, user);       break;
    case '➕ Add Money':   await handleAddMoney(chatId, user);          break;
    case '📊 Game Rate':   await handleGameRate(chatId);                break;
    case '⚙️ Settings': await handleSettings(chatId, user);             break;
    case '❓ Help':        await handleHelp(chatId);                    break;
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
    await send(chatId, '⏰ No markets open right now. Check back later!');
    return;
  }
  const buttons = markets.map(m => ([{
    text: `${m.status === 'open' ? '🟢' : '🟡'} ${m.name}`,
    callback_data: `market_${m.id}`
  }]));
  await bot.sendMessage(chatId, `🎮 *Select Market:*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// ══════════════════════════════════════════════════
// STEP HANDLER
// ══════════════════════════════════════════════════
async function handleStep(chatId, user, text, session) {

  // ── PLAY ───────────────────────────────────────
  if (session.step === 'play_enter_bets') {
    await processBets(chatId, user, text, session.market);
    return;
  }

  if (session.step === 'play_confirm') {
    const t = text.toUpperCase();
    if (t === 'NO' || t === 'CANCEL') {
      delete sessions[chatId];
      await send(chatId, '❌ Bets cancelled.', MAIN_MENU);
      return;
    }
    if (t === 'YES' || t === 'Y') {
      await confirmBets(chatId, user, session);
      return;
    }
    await bot.sendMessage(chatId, 'Please use the buttons below:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ YES - Confirm', callback_data: 'bet_yes' },
          { text: '❌ NO - Cancel',   callback_data: 'bet_no'  }
        ]]
      }
    });
    return;
  }

  // ── DEPOSIT ────────────────────────────────────
  if (session.step === 'deposit_amount') {
    const amount = parseFloat(text);
    const MIN    = parseFloat(process.env.MIN_DEPOSIT || 100);
    const MAX    = parseFloat(process.env.MAX_DEPOSIT || 50000);
    if (isNaN(amount) || amount < MIN || amount > MAX) {
      await send(chatId, `❌ Amount must be between Rs. ${MIN} and Rs. ${MAX}`);
      return;
    }

    await db.query(
      `INSERT INTO deposits (user_id, amount, status, created_at)
       VALUES (?, ?, 'pending', NOW())`,
      [user.id, amount]
    );

    // Get active UPI
    let adminUPI  = process.env.ADMIN_UPI  || 'admin@upi';
    let adminName = process.env.ADMIN_NAME || 'FastWin';
    let bankMethods = [];
    try {
      const [upiList] = await db.query(
        `SELECT * FROM payment_methods WHERE is_active=1 AND type='upi' LIMIT 1`
      );
      if (upiList.length) {
        adminUPI  = upiList[0].value;
        adminName = upiList[0].name;
      }
      const [bankList] = await db.query(
        `SELECT * FROM payment_methods WHERE is_active=1 AND type='bank'`
      );
      bankMethods = bankList;
    } catch(e) {
      console.error('Payment fetch error:', e.message);
    }

    const upiLink = `upi://pay?pa=${adminUPI}&pn=${encodeURIComponent(adminName)}&am=${amount}&cu=INR&tn=FastWin`;

    sessions[chatId] = { step: 'await_utr', depositAmount: amount };

    let msg =
      `💰 *Pay Rs. ${amount}*\n━━━━━━━━━━━━━━━━\n\n` +
      `👆 Tap button to pay via any UPI app\n` +
      `_(GPay, PhonePe, Paytm etc.)_\n\n` +
      `📱 UPI: \`${adminUPI}\`\n` +
      `💰 Amount: *Rs. ${amount}*\n`;

    if (bankMethods.length) {
      msg += `\n🏦 *Bank Transfer:*\n`;
      bankMethods.forEach(b => {
        msg += `• *${b.name}*\n  ${b.extra}\n  Holder: ${b.value}\n`;
      });
    }

    msg += `\n━━━━━━━━━━━━━━━━\n✅ After payment enter *UTR number*:`;

    await bot.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{
          text: `💳 Pay Rs. ${amount} — Tap Here`,
          url: upiLink
        }]]
      }
    });
    return;
  }

  // ── UTR SUBMIT ─────────────────────────────────
  if (session.step === 'await_utr') {
    const utr = text.trim().replace(/\s+/g,'').toUpperCase();
    if (utr.length < 10) {
      await send(chatId,
        `❌ Invalid UTR.\n\n` +
        `UTR is 12 digit number from your payment app.\n` +
        `Please enter correct UTR:`
      );
      return;
    }

    await send(chatId, `🔍 Verifying UTR: \`${utr}\`\n_Please wait..._`);

    // Duplicate check
    const [existing] = await db.query(
      'SELECT id FROM transactions WHERE utr_number = ?', [utr]
    );
    if (existing.length) {
      await send(chatId,
        `❌ *This UTR is already used!*\n\n` +
        `Enter correct UTR or contact support.`
      );
      return;
    }

    // Credit wallet
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
      [session.depositAmount, user.id]
    );

    // Transaction record
    await db.query(
      `INSERT INTO transactions
        (user_id, type, amount, utr_number, status, source, created_at)
       VALUES (?, 'deposit', ?, ?, 'approved', 'utr', NOW())`,
      [user.id, session.depositAmount, utr]
    );

    // Update deposit
    await db.query(
      `UPDATE deposits SET status='approved', utr_number=?, approved_at=NOW()
       WHERE user_id=? AND amount=? AND status='pending'
       ORDER BY created_at DESC LIMIT 1`,
      [utr, user.id, session.depositAmount]
    );

    const [updated] = await db.query(
      'SELECT wallet_balance FROM users WHERE id=?', [user.id]
    );

    delete sessions[chatId];

    await send(chatId,
      `✅ *Payment Successful!*\n━━━━━━━━━━━━━━━━\n\n` +
      `💰 Added: *Rs. ${session.depositAmount}*\n` +
      `🔢 UTR: \`${utr}\`\n` +
      `👛 Balance: *Rs. ${updated[0].wallet_balance}*\n\n` +
      `Place your bet now! 🎯`,
      MAIN_MENU
    );

    // Admin notify
    try {
      const adminId = process.env.ADMIN_TELEGRAM_ID;
      if (adminId) {
        await bot.sendMessage(adminId,
          `💰 *New Deposit!*\n\n` +
          `👤 ${user.name}\n` +
          `💰 Rs. ${session.depositAmount}\n` +
          `🔢 UTR: ${utr}\n✅ Auto approved`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch(e) {}
    return;
  }

  // ── WITHDRAW ───────────────────────────────────
  if (session.step === 'withdraw_amount') {
    const amount    = parseFloat(text);
    const MIN       = parseFloat(process.env.MIN_WITHDRAW || 200);
    const MAX       = parseFloat(process.env.MAX_WITHDRAW || 25000);
    const freshUser = await getUser(String(chatId));
    if (isNaN(amount) || amount < MIN) {
      await send(chatId, `❌ Minimum withdrawal is Rs. ${MIN}`);
      return;
    }
    if (amount > MAX) {
      await send(chatId, `❌ Maximum withdrawal is Rs. ${MAX}`);
      return;
    }
    if (amount > freshUser.wallet_balance) {
      await send(chatId,
        `❌ Insufficient balance!\n\nBalance: Rs. ${freshUser.wallet_balance}`
      );
      return;
    }
    sessions[chatId] = { step: 'withdraw_confirm', amount };
    await bot.sendMessage(chatId,
      `📋 *Confirm Withdrawal*\n━━━━━━━━━━━━━━━━\n\n` +
      `💰 Amount: *Rs. ${amount}*\n` +
      `📱 UPI: *${freshUser.upi_id}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ YES - Confirm', callback_data: 'wd_yes' },
            { text: '❌ NO - Cancel',   callback_data: 'wd_no'  }
          ]]
        }
      }
    );
    return;
  }

  if (session.step === 'withdraw_confirm') {
    const t = text.toUpperCase();
    if (t === 'NO') { delete sessions[chatId]; await send(chatId, '❌ Cancelled.', MAIN_MENU); return; }
    if (t === 'YES') { await processWithdraw(chatId, session); return; }
    await send(chatId, 'Please use the buttons.');
    return;
  }
}

// ── UPDATE NAME ────────────────────────────────
  if (session.step === 'update_name') {
    const name = text.trim();
    if (name.length < 2) {
      await send(chatId, '❌ Name too short. Enter valid name:');
      return;
    }
    await db.query(
      'UPDATE users SET name = ? WHERE whatsapp_number = ?',
      [name, String(chatId)]
    );
    delete sessions[chatId];
    await send(chatId,
      `✅ *Name Updated!*\n\nNew Name: *${name}*`,
      MAIN_MENU
    );
    return;
  }

  // ── UPDATE UPI ─────────────────────────────────
  if (session.step === 'update_upi') {
    const upi = text.trim().toLowerCase();
    if (!upi.includes('@')) {
      await send(chatId, '❌ Invalid UPI ID.\nExample: name@ybl');
      return;
    }
    await db.query(
      'UPDATE users SET upi_id = ? WHERE whatsapp_number = ?',
      [upi, String(chatId)]
    );
    delete sessions[chatId];
    await send(chatId,
      `✅ *UPI Updated!*\n\nNew UPI: *${upi}*`,
      MAIN_MENU
    );
    return;
  }

  // ── UPDATE BANK — Step 1: Account Number ───────
  if (session.step === 'update_bank_ac') {
    if (!/^\d{9,18}$/.test(text.trim())) {
      await send(chatId, '❌ Invalid account number.\nEnter valid account number:');
      return;
    }
    sessions[chatId] = { step: 'update_bank_ifsc', ac: text.trim() };
    await send(chatId,
      `✅ Account: *${text.trim()}*\n\nEnter *IFSC Code*:\n_Example: HDFC0001234_`
    );
    return;
  }

  // ── UPDATE BANK — Step 2: IFSC ─────────────────
  if (session.step === 'update_bank_ifsc') {
    const ifsc = text.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      await send(chatId, '❌ Invalid IFSC code.\nExample: HDFC0001234');
      return;
    }
    sessions[chatId] = { ...session, step: 'update_bank_name', ifsc };
    await send(chatId,
      `✅ IFSC: *${ifsc}*\n\nEnter *Bank Name*:\n_Example: HDFC Bank_`
    );
    return;
  }

  // ── UPDATE BANK — Step 3: Bank Name ────────────
  if (session.step === 'update_bank_name') {
    const bankName = text.trim();
    if (bankName.length < 2) {
      await send(chatId, '❌ Enter valid bank name:');
      return;
    }
    const bankInfo = `${bankName}|${session.ac}|${session.ifsc}`;
    await db.query(
      'UPDATE users SET upi_id = ? WHERE whatsapp_number = ?',
      [bankInfo, String(chatId)]
    );
    delete sessions[chatId];
    await send(chatId,
      `✅ *Bank Account Updated!*\n━━━━━━━━━━━━━━━━\n\n` +
      `🏦 Bank: *${bankName}*\n` +
      `💳 AC: *${session.ac}*\n` +
      `📋 IFSC: *${session.ifsc}*`,
      MAIN_MENU
    );
    return;
  }

// ══════════════════════════════════════════════════
// PROCESS WITHDRAW
// ══════════════════════════════════════════════════
async function processWithdraw(chatId, session) {
  const freshUser = await getUser(String(chatId));
  await db.query(
    'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
    [session.amount, freshUser.id]
  );
  await db.query(
    `INSERT INTO withdrawals (user_id, amount, upi_id, status, created_at)
     VALUES (?, ?, ?, 'pending', NOW())`,
    [freshUser.id, session.amount, freshUser.upi_id]
  );
  delete sessions[chatId];
  await send(chatId,
    `✅ *Withdrawal Submitted!*\n━━━━━━━━━━━━━━━━\n\n` +
    `💰 Amount: *Rs. ${session.amount}*\n` +
    `📱 UPI: *${freshUser.upi_id}*\n` +
    `🕐 Processing: 1-4 hours\n\n` +
    `You will be notified when paid! 🔔`,
    MAIN_MENU
  );
  try {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (adminId) {
      await bot.sendMessage(adminId,
        `🔔 *New Withdrawal!*\n\n` +
        `👤 ${freshUser.name}\n` +
        `📱 ${freshUser.upi_id}\n` +
        `💰 Rs. ${session.amount}\n\nCheck admin panel!`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════
// BET PROCESSING
// ══════════════════════════════════════════════════
async function processBets(chatId, user, text, market) {
  const lines  = text.split('\n').map(l => l.trim()).filter(l => l);
  const bets   = [];
  const errors = [];

  for (const line of lines) {
    // Accept =, -, ., ,, :, space as separator
    const match = line.match(/^(\d+)\s*[=\-\.\,\:\s]\s*(\d+)$/);
    if (!match) { errors.push(`❌ \`${line}\``); continue; }
    const number = match[1];
    const amount = parseFloat(match[2]);
    const MIN    = parseFloat(process.env.MIN_BET || 10);
    if (isNaN(amount) || amount < MIN) {
      errors.push(`❌ Min Rs.${MIN}: \`${line}\``);
      continue;
    }
    const betType = detectBetType(number, market.status);
    if (!betType) { errors.push(`❌ Invalid: \`${number}\``); continue; }
    bets.push({ number, amount, betType });
  }

  if (!bets.length) {
    await send(chatId,
      `❌ No valid bets found.\n\n${errors.join('\n')}\n\nExample:\n4=50\n12=25\n126=10`
    );
    return;
  }

  const totalAmount = bets.reduce((s, b) => s + b.amount, 0);
  const freshUser   = await getUser(String(chatId));

  if (totalAmount > freshUser.wallet_balance) {
    await send(chatId,
      `❌ *Insufficient balance!*\n\nTotal: Rs. ${totalAmount}\nBalance: Rs. ${freshUser.wallet_balance}`
    );
    return;
  }

  let msg = `📋 *${market.name}*\n━━━━━━━━━━━━━━━━\n\n`;
  bets.forEach(b => {
    msg += `${b.betType.label}: *${b.number}* → Rs. ${b.amount}\n`;
  });
  if (errors.length) msg += `\n⚠️ Skipped:\n${errors.join('\n')}\n`;
  msg +=
    `\n💰 Total: *Rs. ${totalAmount}*\n` +
    `💰 After: Rs. ${freshUser.wallet_balance - totalAmount}`;

  sessions[chatId] = { step: 'play_confirm', market, bets, totalAmount };
  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ YES - Confirm', callback_data: 'bet_yes' },
        { text: '❌ NO - Cancel',   callback_data: 'bet_no'  }
      ]]
    }
  });
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
    if (isClose) return null;
    return { key: 'jodi', label: 'Jodi', multiplier: 90 };
  }
  if (len === 3) {
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
  const freshUser = await getUser(String(chatId));
  for (const bet of bets) {
    await db.query(
      `INSERT INTO bets
        (user_id, market_id, bet_type, number, amount, multiplier, possible_win, status, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [freshUser.id, market.id, bet.betType.key, bet.number,
       bet.amount, bet.betType.multiplier, bet.amount * bet.betType.multiplier]
    );
  }
  await db.query(
    'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
    [totalAmount, freshUser.id]
  );
  const [updated] = await db.query(
    'SELECT wallet_balance FROM users WHERE id = ?', [freshUser.id]
  );
  delete sessions[chatId];
  let msg = `✅ *${bets.length} Bet(s) Placed!*\n━━━━━━━━━━━━━━━━\n\n`;
  bets.forEach(b => {
    msg += `${b.betType.label}: *${b.number}* → Rs. ${b.amount}\n`;
  });
  msg +=
    `\n💰 Total: Rs. ${totalAmount}\n` +
    `💰 Balance: *Rs. ${updated[0].wallet_balance}*\n\n` +
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
  await bot.sendMessage(chatId, `📜 *Select Market:*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function showBetHistory(chatId, user, market) {
  const [bets] = await db.query(
    `SELECT * FROM bets WHERE user_id = ? AND market_id = ? ORDER BY placed_at DESC`,
    [user.id, market.id]
  );
  if (!bets.length) {
    await send(chatId, `📜 No bets for *${market.name}*`, MAIN_MENU);
    return;
  }
  let msg   = `📜 *${market.name}*\n━━━━━━━━━━━━━━━━\n\n`;
  let total = 0;
  let won   = 0;
  bets.forEach(b => {
    const icon = b.status === 'won' ? '✅' : b.status === 'lost' ? '❌' : '⏳';
    const type = b.bet_type.replace(/_/g, ' ').toUpperCase();
    msg  += `${icon} ${type}: *${b.number}* → Rs. ${b.amount}`;
    if (b.status === 'won') msg += ` *(Won Rs. ${b.actual_win})*`;
    msg  += '\n';
    total += parseFloat(b.amount);
    if (b.status === 'won') won += parseFloat(b.actual_win || 0);
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
  const [stats] = await db.query(
    `SELECT COUNT(*) as total,
     COALESCE(SUM(amount),0) as bet_amount,
     COALESCE(SUM(actual_win),0) as won,
     COUNT(CASE WHEN status='won' THEN 1 END) as wins,
     COUNT(CASE WHEN status='lost' THEN 1 END) as losses,
     COUNT(CASE WHEN status='pending' THEN 1 END) as pending
     FROM bets WHERE user_id = ?`,
    [u.id]
  );
  const s = stats[0];
  await bot.sendMessage(chatId,
    `👛 *Wallet*\n━━━━━━━━━━━━━━━━\n\n` +
    `💰 Balance: *Rs. ${u.wallet_balance}*\n\n` +
    `• Total Bets: ${s.total}\n` +
    `• Wagered: Rs. ${s.bet_amount}\n` +
    `• Won: Rs. ${s.won}\n` +
    `• ✅ ${s.wins} | ❌ ${s.losses} | ⏳ ${s.pending}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '➕ Add Money', callback_data: 'wallet_add'      },
          { text: '🏧 Withdraw',  callback_data: 'wallet_withdraw' }
        ]]
      }
    }
  );
}

// ══════════════════════════════════════════════════
// 📋 TRANSACTION
// ══════════════════════════════════════════════════
async function handleTransaction(chatId, user) {
  const [deps] = await db.query(
    `SELECT 'Deposit' as type, amount, status, created_at
     FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );
  const [wds] = await db.query(
    `SELECT 'Withdrawal' as type, amount, status, created_at
     FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );
  const all = [...deps, ...wds]
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);
  if (!all.length) {
    await send(chatId, '📋 No transactions yet.', MAIN_MENU);
    return;
  }
  let msg = `📋 *Transactions*\n━━━━━━━━━━━━━━━━\n\n`;
  all.forEach(t => {
    const icon   = t.type === 'Deposit' ? '💰' : '🏧';
    const status = (t.status === 'approved' || t.status === 'paid') ? '✅' :
                    t.status === 'rejected' ? '❌' : '⏳';
    const date   = new Date(t.created_at).toLocaleDateString('en-IN',
      { day: 'numeric', month: 'short' }
    );
    msg += `${icon} ${t.type}: *Rs. ${t.amount}* ${status} (${date})\n`;
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
    `Min: Rs. ${process.env.MIN_DEPOSIT || 100}\n` +
    `Max: Rs. ${process.env.MAX_DEPOSIT || 50000}\n\n` +
    `Enter amount:`
  );
}

// ══════════════════════════════════════════════════
// 📊 GAME RATE
// ══════════════════════════════════════════════════
async function handleGameRate(chatId) {
  // Get rates from DB or localStorage fallback
  let rates = {
    open_single: 9,
    open_pana: 150,
    jodi: 90,
    close_single: 9,
    close_pana: 300,
    triple_pana: 1000
  };

  try {
    const [rows] = await db.query(
      `SELECT * FROM game_rates LIMIT 1`
    );
    if (rows.length) rates = { ...rates, ...rows[0] };
  } catch(e) {
    // Table nahi hai to default use karo
  }

  await send(chatId,
    `📊 *Game Rates*\n━━━━━━━━━━━━━━━━\n\n` +
    `Open Single → *${rates.open_single}x*\n` +
    `Open Pana → *${rates.open_pana}x*\n` +
    `Jodi → *${rates.jodi}x*\n` +
    `Close Single → *${rates.close_single}x*\n` +
    `Close Pana → *${rates.close_pana}x*\n` +
    `Triple Pana → *${rates.triple_pana}x*\n\n` +
    `_Rs.100 on Jodi = Rs.${rates.jodi * 100} win_`,
    MAIN_MENU
  );
}

// ══════════════════════════════════════════════════
// ❓ HELP
// ══════════════════════════════════════════════════
async function handleHelp(chatId) {
  const num = process.env.SUPPORT_PHONE || '919999999999';
  await bot.sendMessage(chatId,
    `❓ *Help & Support*\n━━━━━━━━━━━━━━━━\n\nContact us on WhatsApp:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{
          text: '💬 WhatsApp Support',
          url: `https://wa.me/${num}`
        }]]
      }
    }
  );
}

// ══════════════════════════════════════════════════
// ⚙️ SETTINGS
// ══════════════════════════════════════════════════
async function handleSettings(chatId, user) {
  const freshUser = await getUser(String(chatId));
  await bot.sendMessage(chatId,
    `⚙️ *Settings*\n━━━━━━━━━━━━━━━━\n\n` +
    `👤 Name: *${freshUser.name}*\n` +
    `💳 UPI: *${freshUser.upi_id || '—'}*\n\n` +
    `What would you like to update?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '👤 Change Name',        callback_data: 'set_name' }],
          [{ text: '📱 Update UPI ID',       callback_data: 'set_upi'  }],
          [{ text: '🏦 Update Bank Account', callback_data: 'set_bank' }],
        ]
      }
    }
  );
}

module.exports = { bot, sessions };
