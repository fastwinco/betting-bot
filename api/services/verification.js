const db = require('../../database');
require('dotenv').config();

async function verifyAndCredit(parsed, source, phone, sock) {
  const { utr, amount } = parsed;

  try {
    // ── STEP 1: Duplicate UTR check ───────────────────────
    const [existing] = await db.query(
      'SELECT id FROM transactions WHERE utr_number = ?',
      [utr]
    );

    if (existing.length > 0) {
      console.log(`⚠️ Duplicate UTR reject: ${utr}`);
      if (sock && phone) {
        await sendMsg(sock, phone,
          `❌ *Duplicate UTR!*\n\n` +
          `Yeh UTR already use ho chuka hai.\n` +
          `Support se contact karo.`
        );
      }
      return { success: false, reason: 'duplicate_utr' };
    }

    // ── STEP 2: User find karo ────────────────────────────
    let userId, userName, userPhone;

    if (source === 'screenshot' || source === 'manual') {
      // Phone se user find karo
      const [users] = await db.query(
        'SELECT * FROM users WHERE whatsapp_number = ?',
        [phone]
      );

      if (!users.length) {
        return { success: false, reason: 'user_not_found' };
      }

      userId    = users[0].id;
      userName  = users[0].name;
      userPhone = phone;

    } else if (source === 'sms') {
      // Amount aur time se pending deposit match karo
      const [pending] = await db.query(
        `SELECT d.*, u.whatsapp_number, u.name, u.id as uid
         FROM deposits d
         JOIN users u ON d.user_id = u.id
         WHERE d.status  = 'pending'
           AND d.amount  = ?
           AND d.created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         ORDER BY d.created_at DESC
         LIMIT 1`,
        [amount]
      );

      if (!pending.length) {
        // Koi match nahi — manual review queue mein daalo
        await db.query(
          `INSERT INTO manual_review 
            (utr_number, amount, source, status, created_at)
           VALUES (?, ?, 'sms', 'pending', NOW())`,
          [utr, amount]
        );
        console.log(`⚠️ No matching deposit for UTR: ${utr}, Amount: ${amount}`);
        return { success: false, reason: 'no_matching_deposit' };
      }

      userId    = pending[0].uid;
      userName  = pending[0].name;
      userPhone = pending[0].whatsapp_number;
    }

    // ── STEP 3: Balance update karo ───────────────────────
    await db.query(
      `UPDATE users 
       SET wallet_balance = wallet_balance + ? 
       WHERE id = ?`,
      [amount, userId]
    );

    // ── STEP 4: Transaction record ────────────────────────
    await db.query(
      `INSERT INTO transactions 
        (user_id, type, amount, utr_number, status, source, created_at)
       VALUES (?, 'deposit', ?, ?, 'approv
