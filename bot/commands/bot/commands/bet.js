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
        `•
