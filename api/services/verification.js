const db = require('../../database');
require('dotenv').config();

async function verifyAndCredit(parsed, source, userId, bot, platform = 'telegram') {
  const { utr, amount } = parsed;

  try {
    // Duplicate UTR check
    const [existing] = await db.query(
      'SELECT id FROM transactions WHERE utr_number = ?', [utr]
    );
    if (existing.length > 0) {
      await notify(bot, userId, platform,
        `❌ *Duplicate UTR!*\n\nThis UTR has already been used.\nContact support.`
      );
      return { success: false, reason: 'duplicate_utr' };
    }

    // Find user
    let dbUserId, userPhone;

    if (source === 'screenshot' || source === 'manual') {
      const [users] = await db.query(
        'SELECT * FROM users WHERE whatsapp_number = ?', [userId]
      );
      if (!users.length) return { success: false, reason: 'user_not_found' };
      dbUserId  = users[0].id;
      userPhone = userId;

    } else if (source === 'sms') {
      const [pending] = await db.query(
        `SELECT d.*, u.whatsapp_number, u.id as uid
         FROM deposits d JOIN users u ON d.user_id = u.id
         WHERE d.status = 'pending' AND d.amount = ?
         AND d.created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         ORDER BY d.created_at DESC LIMIT 1`,
        [amount]
      );
      if (!pending.length) {
        await db.query(
          `INSERT INTO manual_review (utr_number, amount, source, status, created_at)
           VALUES (?, ?, 'sms', 'pending', NOW())`,
          [utr, amount]
        );
        return { success: false, reason: 'no_matching_deposit' };
      }
      dbUserId  = pending[0].uid;
      userPhone = pending[0].whatsapp_number;
    }

    // Credit wallet
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
      [amount, dbUserId]
    );

    // Transaction record
    await db.query(
      `INSERT INTO transactions
        (user_id, type, amount, utr_number, status, source, created_at)
       VALUES (?, 'deposit', ?, ?, 'approved', ?, NOW())`,
      [dbUserId, amount, utr, source]
    );

    // Update deposit status
    await db.query(
      `UPDATE deposits SET status = 'approved', utr_number = ?, approved_at = NOW()
       WHERE user_id = ? AND amount = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [utr, dbUserId, amount]
    );

    // Get new balance
    const [updated] = await db.query(
      'SELECT wallet_balance FROM users WHERE id = ?', [dbUserId]
    );
    const newBalance = updated[0].wallet_balance;

    // Notify user
    await notify(bot, userPhone, platform,
      `✅ *Deposit Successful!*\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `💰 Amount: *Rs. ${amount}*\n` +
      `🔢 UTR: \`${utr}\`\n` +
      `👛 New Balance: *Rs. ${newBalance}*\n\n` +
      `Place your bet now! 🎯`
    );

    console.log(`✅ Credited Rs.${amount} to user ${dbUserId} via ${source}`);
    return { success: true, dbUserId, amount, utr, newBalance };

  } catch (err) {
    console.error('Verification error:', err);
    return { success: false, reason: err.message };
  }
}

async function notify(bot, userId, platform, message) {
  try {
    if (!bot || !userId) return;
    if (platform === 'telegram') {
      await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    console.error('Notify error:', e.message);
  }
}

module.exports = { verifyAndCredit };
