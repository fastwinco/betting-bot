const db = require('../../database');

async function handle(sock, jid, phone, sessions) {
  // Pehle check karo already registered toh nahi
  const [existing] = await db.query(
    'SELECT * FROM users WHERE whatsapp_number = ?', [phone]
  );

  if (existing.length > 0) {
    await sock.sendMessage(jid, {
      text:
        `✅ Aap already registered hain!\n\n` +
        `*MENU* bhejo options dekhne ke liye.`
    });
    return;
  }

  sessions[phone] = { command: 'register', step: 'ask_name' };

  await sock.sendMessage(jid, {
    text:
      `👋 *Swagat hai Betting Bot mein!*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `Register karne ke liye apna\n` +
      `*naam* bhejo 👇`
  });
}

async function handleStep(sock, jid, phone, text, sessions) {
  const session = sessions[phone];

  // Step 1 — Naam liya
  if (session.step === 'ask_name') {
    if (text.length < 2) {
      await sock.sendMessage(jid, { text: '❌ Sahi naam bhejo.' });
      return;
    }

    sessions[phone].name = text;
    sessions[phone].step = 'ask_upi';

    await sock.sendMessage(jid, {
      text:
        `✅ Naam: *${text}*\n\n` +
        `Ab apna *UPI ID* bhejo\n` +
        `_(jaise: name@ybl, name@paytm)_`
    });
    return;
  }

  // Step 2 — UPI ID liya
  if (session.step === 'ask_upi') {
    if (!text.includes('@')) {
      await sock.sendMessage(jid, {
        text: '❌ Sahi UPI ID bhejo.\nExample: name@ybl'
      });
      return;
    }

    const name   = sessions[phone].name;
    const upiId  = text.toLowerCase();

    // Database mein save karo
    await db.query(
      `INSERT INTO users (whatsapp_number, name, upi_id, wallet_balance, status, registered_at)
       VALUES (?, ?, ?, 0, 'active', NOW())`,
      [phone, name, upiId]
    );

    delete sessions[phone];

    await sock.sendMessage(jid, {
      text:
        `🎉 *Registration Complete!*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 Naam: *${name}*\n` +
        `💳 UPI: *${upiId}*\n` +
        `👛 Balance: *Rs. 0*\n\n` +
        `Shuru karne ke liye *MENU* bhejo! 🎯`
    });
  }
}

module.exports = { handle, handleStep };
