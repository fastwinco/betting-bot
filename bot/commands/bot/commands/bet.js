const db = require('../../database');

const BET_TYPES = {
  '1': { key: 'open_single',  label: 'Open Single',  multiplier: 9,    digits: 1 },
  '2': { key: 'open_pana',    label: 'Open Pana',    multiplier: 150,  digits: 3 },
  '3': { key: 'jodi',         label: 'Jodi',         multiplier: 90,   digits: 2 },
  '4': { key: 'close_single', label: 'Close Single', multiplier: 9,    digits: 1 },
  '5': { key: 'close_pana',   label: 'Close Pana',   multiplier: 300,  digits: 3 },
};

async function handle(sock, jid, phone, user, sessions) {
  // Active markets fetch karo
  const [markets] = await db.query(
    `SELECT * FROM markets 
     WHERE status = 'open' 
     ORDER BY open_time ASC`
  );

  if (!markets.length) {
    await sock.sendMessage(jid, {
      text:
        `⏰ *Abhi koi market open nahi hai*\n\n` +
        `_Market open hone par bet laga sakte ho_\n\n` +
        `MARKETS bhejo schedule dekhne ke liye`
    });
    return;
  }

  let msg =
    `🎯 *Bet Lagao*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `*Market chunо:*\n\n`;

  markets.forEach((m, i) => {
    msg += `${i + 1}. *${m.name}*\n`;
    msg += `   Close: ${formatTime(m.close_time)}\n\n`;
  });

  msg += `_Number bhejo market select karne ke liye_`;

  sessions[phone] = {
    command: 'bet',
    step: 'select_market',
    markets
  };

  await sock.sendMessage(jid, { text: msg });
}

async function handleStep(sock, jid, phone, user, text, sessions) {
  const session = sessions[phone];

  // ── STEP 1: Market select ─────────────────────────────────
  if (session.step === 'select_market') {
    const idx = parseInt(text) - 1;

    if (isNaN(idx) || !session.markets[idx]) {
      await sock.sendMessage(jid, {
        text: `❌ Sahi number bhejo (1 se ${session.markets.length})`
      });
      return;
    }

    session.market = session.markets[idx];
    session.step   = 'select_type';

    await sock.sendMessage(jid, {
      text:
        `✅ *${session.market.name}*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `*Bet type chunо:*\n\n` +
        `1. Open Single  → 9x\n` +
        `2. Open Pana    → 150x\n` +
        `3. Jodi         → 90x\n` +
        `4. Close Single → 9x\n` +
        `5. Close Pana   → 300x\n\n` +
        `_Number bhejo_`
    });
    return;
  }

  // ── STEP 2: Bet type select ───────────────────────────────
  if (session.step === 'select_type') {
    const betType = BET_TYPES[text];

    if (!betType) {
      await sock.sendMessage(jid, {
        text: '❌ 1 se 5 number bhejo.'
      });
      return;
    }

    // Close bets sirf open result ke baad
    if (
      (betType.key === 'close_single' || betType.key === 'close_pana') &&
      session.market.status !== 'open_resulted'
    ) {
      await sock.sendMessage(jid, {
        text:
          `⏰ *Close betting abhi band hai*\n\n` +
          `Close betting Open result aane ke\n` +
          `baad shuru hoti hai.\n\n` +
          `_Thodi der baad dobara try karo_`
      });
      return;
    }

    session.betType = betType;
    session.step    = 'enter_number';

    const hint =
      betType.digits === 1 ? '0 se 9 (ek number)' :
      betType.digits === 2 ? '00 se 99 (do number)' :
                             '000 se 999 (teen number)';

    await sock.sendMessage(jid, {
      text:
        `✅ *${betType.label}* (${betType.multiplier}x)\n\n` +
        `Number bhejo:\n` +
        `_${hint}_`
    });
    return;
  }

  // ── STEP 3: Number enter ──────────────────────────────────
  if (session.step === 'enter_number') {
    const num = text.trim();

    if (!isValidNumber(num, session.betType)) {
      const hint =
        session.betType.digits === 1 ? '0-9'   :
        session.betType.digits === 2 ? '00-99' : '000-999';
      await sock.sendMessage(jid, {
        text: `❌ Invalid number!\n${hint} ke beech hona chahiye.`
      });
      return;
    }

    session.number = num;
    session.step   = 'enter_amount';

    await sock.sendMessage(jid, {
      text:
        `✅ Number: *${num}*\n\n` +
        `Amount bhejo:\n` +
        `• Minimum: Rs. ${process.env.MIN_BET || 10}\n` +
        `• Aapka Balance: Rs. ${user.wallet_balance}`
    });
    return;
  }

  // ── STEP 4: Amount enter ──────────────────────────────────
  if (session.step === 'enter_amount') {
    const amount  = parseFloat(text);
    const MIN_BET = parseFloat(process.env.MIN_BET || 10);

    if (isNaN(amount) || amount < MIN_BET) {
      await sock.sendMessage(jid, {
        text: `❌ Minimum bet Rs. ${MIN_BET} hai.`
      });
      return;
    }

    if (amount > user.wallet_balance) {
      await sock.sendMessage(jid, {
        text:
          `❌ *Balance kam hai!*\n\n` +
          `Aapka balance: Rs. ${user.wallet_balance}\n` +
          `Aapne dala: Rs. ${amount}\n\n` +
          `_DEPOSIT karo aur dobara try karo_`
      });
      return;
    }

    session.amount = amount;
    session.step   = 'confirm';

    const possibleWin = amount * session.betType.multiplier;

    await sock.sendMessage(jid, {
      text:
        `📋 *Bet Confirm karo:*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🏪 Market:  *${session.market.name}*\n` +
        `🎮 Type:    *${session.betType.label}*\n` +
        `🔢 Number:  *${session.number}*\n` +
        `💰 Amount:  *Rs. ${amount}*\n` +
        `🏆 Jeetoge: *Rs. ${possibleWin}*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `*YES* bhejo confirm karne ke liye\n` +
        `*NO* bhejo cancel karne ke liye`
    });
    return;
  }

  // ── STEP 5: Confirm ───────────────────────────────────────
  if (session.step === 'confirm') {
    if (text === 'NO' || text === 'CANCEL') {
      delete sessions[phone];
      await sock.sendMessage(jid, {
        text: '❌ Bet cancel ho gayi.\n\n_MENU bhejo wapas jaane ke liye_'
      });
      return;
    }

    if (text !== 'YES') {
      await sock.sendMessage(jid, {
        text: '⚠️ *YES* ya *NO* bhejo.'
      });
      return;
    }

    const amount      = session.amount;
    const possibleWin = amount * session.betType.multiplier;

    // Balance deduct karo
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
      [amount, user.id]
    );

    // Bet save karo
    await db.query(
      `INSERT INTO bets 
        (user_id, market_id, bet_type, number, 
         amount, multiplier, possible_win, status, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        user.id,
        session.market.id,
        session.betType.key,
        session.number,
        amount,
        session.betType.multiplier,
        possibleWin
      ]
    );

    // Transaction log
    await db.query(
      `INSERT INTO transactions 
        (user_id, type, amount, note, created_at)
       VALUES (?, 'bet', ?, ?, NOW())`,
      [user.id, amount, `${session.betType.label} - ${session.number}`]
    );

    // Updated balance
    const [updated] = await db.query(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [user.id]
    );

    delete sessions[phone];

    await sock.sendMessage(jid, {
      text:
        `✅ *Bet Laga Di!*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🏪 *${session.market.name}*\n` +
        `🎮 ${session.betType.label} → *${session.number}*\n` +
        `💰 Amount: Rs. ${amount}\n` +
        `🏆 Possible Win: Rs. ${possibleWin}\n\n` +
        `👛 Balance: Rs. ${updated[0].wallet_balance}\n\n` +
        `_Result ka wait karo! Best of luck_ 🤞`
    });
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────
function isValidNumber(num, betType) {
  if (betType.digits === 1) return /^[0-9]$/.test(num);
  if (betType.digits === 2) return /^[0-9]{2}$/.test(num);
  if (betType.digits === 3) return /^[0-9]{3}$/.test(num);
  return false;
}

function formatTime(timeStr) {
  if (!timeStr) return 'N/A';
  const [hours, minutes] = timeStr.split(':');
  const h    = parseInt(hours);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

module.exports = { handle, handleStep };
