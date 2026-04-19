const db = require('../../database');
require('dotenv').config();

async function verifyAndCredit(parsed, source, phone, sock) {
  const { utr, amount } = parsed;

  try {
    // STEP 1: Duplicate UTR check
    const [existing] = await db.query(
      'SELECT id FROM transactions WHERE utr_number = ?',
      [utr]
    );

    if (existing.length > 0) {
      console.log('Duplicate UTR: ' + utr);
      if (sock && phone) {
        await sendMsg(sock, phone,
          '❌ *Duplicate UTR!*\n\nYeh UTR already use ho chuka hai.\nSupport se contact karo.'
        );
      }
      return { success: false, reason: 'duplicate_utr' };
    }

    // STEP 2: User find karo
    var userId, userPhone;

    if (source === 'screenshot' || source === 'manual') {
      const [users] = await db.query(
        'SELECT * FROM users WHERE whatsapp_number = ?',
        [phone]
      );
      if (!users.length) {
        return { success: false, reason: 'user_not_found' };
      }
      userId    = users[0].id;
      userPhone = phone;

    } else if (source === 'sms') {
      const [pending] = await db.query(
        'SELECT d.*, u.whatsapp_number, u.id as uid FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = ? AND d.amount = ? AND d.created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) ORDER BY d.created_at DESC LIMIT 1',
        ['pending', amount]
      );

      if (!pending.length) {
        await db.query(
          'INSERT INTO manual_review (utr_number, amount, source, status, created_at) VALUES (?, ?, ?, ?, NOW())',
          [utr, amount, 'sms', 'pending']
        );
        console.log('No matching deposit for UTR: ' + utr);
        return { success: false, reason: 'no_matching_deposit' };
      }

      userId    = pending[0].uid;
      userPhone = pending[0].whatsapp_number;
    }

    // STEP 3: Balance update
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
      [amount, userId]
    );

    // STEP 4: Transaction record
    await db.query(
      'INSERT INTO transactions (user_id, type, amount, utr_number, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, 'deposit', amount, utr, 'approved', source]
    );

    // STEP 5: Deposit status update
    await db.query(
      'UPDATE deposits SET status = ?, utr_number = ?, approved_at = NOW() WHERE user_id = ? AND amount = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      ['approved', utr, userId, amount, 'pending']
    );

    // STEP 6: New balance fetch
    const [updated] = await db.query(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [userId]
    );
    const newBalance = updated[0].wallet_balance;

    // STEP 7: WhatsApp notify
    var notifySock = sock;
    if (!notifySock) {
      try {
        var botModule = require('../../bot/index');
        notifySock = botModule.getSock();
      } catch(e) {
        console.log('Bot sock not available');
      }
    }

    if (notifySock && userPhone) {
      await sendMsg(notifySock, userPhone,
        '✅ *Deposit Successful!*\n' +
        '━━━━━━━━━━━━━━━━━━\n\n' +
        '💰 Amount: *Rs. ' + amount + '*\n' +
        '🔢 UTR: ' + utr + '\n' +
        '👛 New Balance: *Rs. ' + newBalance + '*\n\n' +
        '_Bet lagane ke liye BET bhejo_ 🎯'
      );
    }

    console.log('Credited Rs.' + amount + ' to user ' + userId + ' via ' + source);
    return { success: true, userId: userId, amount: amount, utr: utr, newBalance: newBalance };

  } catch (err) {
    console.error('Verification error:', err);
    return { success: false, reason: err.message };
  }
}

async function sendMsg(sock, phone, text) {
  var jid = phone + '@s.whatsapp.net';
  await sock.sendMessage(jid, { text: text });
}

module.exports = { verifyAndCredit };
