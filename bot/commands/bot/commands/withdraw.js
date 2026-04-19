const db = require('../../database');
require('dotenv').config();

async function handle(sock, jid, phone, user, sessions) {
  const MIN = parseFloat(process.env.MIN_WITHDRAW || 200);

  // Balance check
  if (user.wallet_balance < MIN) {
    await sock.sendMessage(jid, {
      text:
        `❌ *Withdrawal nahi ho sakta*\n\n` +
        `Aapka balance: *Rs. ${user.wallet_balance}*\n` +
        `Minimum withdrawal: *Rs. ${MIN}*\n\n` +
        `_Pehle bet jeeto ya deposit karo_ 🎯`
    });
    return;
  }

  sessions[phone] = { command: 'withdraw', step: 'ask_amount' };

  await sock.sendMessage(jid, {
    text:
      `🏧 *Withdrawal*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `👛 Balance: *Rs. ${user.wallet_balance}*\n\n` +
      `Kitna withdraw karna hai?\n` +
      `• Minimum: Rs. ${MIN}\n` +
      `• Maximum: Rs. ${process.env.MAX_WITHDRAW || 25000}\n\n` +
      `_Sirf amount likho, jaise: 500_`
  });
}

async function handleStep(sock, jid, phone, user, text, sessions) {
  const session = sessions[phone];

  // Step 1 — Amount
  if (session.step === 'ask_amount') {
    const amount = parseFloat(text);
    const MIN = parseFloat(process.env.MIN_WITHDRAW || 200);
    const MAX = parseFloat(process.env.MAX_WITHDRAW || 25000);

    if (isNaN(amount) || amount < MIN) {
      await sock.sendMessage(jid, {
        text: `❌ Minimum withdrawal Rs. ${MIN} hai.`
      });
      return;
    }

    if (amount > MAX) {
      await sock.sendMessage(jid, {
        text: `❌ Maximum withdrawal Rs. ${MAX} hai.`
      });
      return;
    }

    if (amount > user.wallet_balance) {
      await sock.sendMessage(jid, {
        text:
          `❌ Balance kam hai!\n\n` +
          `Aapka balance: Rs. ${user.wallet_balance}\n` +
          `Aapne manga: Rs. ${amount}`
      });
      return;
    }

    sessions[phone].amount = amount;
    sessions[phone].step   = 'confirm';

    // User ka registered UPI dikhao
    await sock.sendMessage(jid, {
      text:
        `📋 *Confirm Withdrawal:*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `💰 Amount: *Rs. ${amount}*\n` +
        `📱 UPI: *${user.upi_id}*\n\n` +
        `Processing: 1-4 hours\n\n` +
        `Confirm karne ke liye *YES* bhejo\n` +
        `Cancel karne ke liye *NO* bhejo`
    });
    return;
  }

  // Step 2 — Confirm
  if (session.step === 'confirm') {
    if (text === 'NO' || text === 'CANCEL') {
      delete sessions[phone];
      await sock.sendMessage(jid, {
        text: '❌ Withdrawal cancel ho gaya.\n\n_MENU bhejo wapas jaane ke liye_'
      });
      return;
    }

    if (text !== 'YES') {
      await sock.sendMessage(jid, {
        text: '⚠️ *YES* ya *NO* bhejo.'
      });
      return;
    }

    const amount = session.amount;

    // Balance deduct karo
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
      [amount, user.id]
    );

    // Withdrawal record banao
    const [result] = await db.query(
      `INSERT INTO withdrawals 
        (user_id, amount, upi_id, status, created_at)
       VALUES (?, ?, ?, 'pending', NOW())`,
      [user.id, amount, user.upi_id]
    );

    // Transaction log
    await db.query(
      `INSERT INTO transactions 
        (user_id, type, amount, reference_id, note, created_at)
       VALUES (?, 'withdrawal', ?, ?, 'Withdrawal request', NOW())`,
      [user.id, amount, result.insertId]
    );

    delete sessions[phone];

    // User ko confirm
    await sock.sendMessage(jid, {
      text:
        `✅ *Withdrawal Request Submit!*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `💰 Amount: *Rs. ${amount}*\n` +
        `📱 UPI: *${user.upi_id}*\n` +
        `🕐 Processing: 1-4 hours\n\n` +
        `Payment hone par notification milega! 🔔`
    });

    // Admin ko alert
    const adminPhone = process.env.ADMIN_PHONE;
    if (adminPhone) {
      const adminJid = `${adminPhone}@s.whatsapp.net`;
      const sock2 = require('../index').getSock();
      if (sock2) {
        await sock2.sendMessage(adminJid, {
          text:
            `🔔 *New Withdrawal Request!*\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 User: ${user.name}\n` +
            `📱 UPI: ${user.upi_id}\n` +
            `💰 Amount: Rs. ${amount}\n\n` +
            `Admin panel check karo!`
        });
      }
    }
  }
}

module.exports = { handle, handleStep };
