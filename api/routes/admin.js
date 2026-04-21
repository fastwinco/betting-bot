const express = require('express');
const router  = express.Router();
const db      = require('../../database');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
require('dotenv').config();

function authCheck(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
    if (!admins.length) return res.status(401).json({ error: 'Wrong credentials' });
    const admin = admins[0];
    const valid = await bcrypt.compare(password, admin.password_hash) ||
                  password === process.env.ADMIN_PASSWORD;
    if (!valid) return res.status(401).json({ error: 'Wrong credentials' });
    await db.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);
    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '24h' }
    );
    res.json({ token, username: admin.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STATS
router.get('/stats', authCheck, async (req, res) => {
  try {
    const [[users]]    = await db.query('SELECT COUNT(*) as count FROM users');
    const [[deposits]] = await db.query(`SELECT COALESCE(SUM(amount),0) as total FROM deposits WHERE status='approved' AND DATE(created_at)=CURDATE()`);
    const [[bets]]     = await db.query(`SELECT COUNT(*) as count FROM bets WHERE DATE(placed_at)=CURDATE()`);
    const [[pending]]  = await db.query(`SELECT COUNT(*) as count FROM withdrawals WHERE status='pending'`);
    const [[pendingDep]] = await db.query(`SELECT COUNT(*) as count FROM deposits WHERE status='pending'`);
    res.json({
      totalUsers: users.count,
      todayDeposit: deposits.total,
      todayBets: bets.count,
      pendingWithdrawals: pending.count,
      pendingDeposits: pendingDep.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PENDING DEPOSITS
router.get('/deposits/pending', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, u.name, u.whatsapp_number FROM deposits d
       JOIN users u ON d.user_id = u.id
       WHERE d.status = 'pending' ORDER BY d.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// APPROVE DEPOSIT
router.post('/deposits/:id/approve', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { utr } = req.body;
    const [deps] = await db.query(
      `SELECT d.*, u.whatsapp_number FROM deposits d
       JOIN users u ON d.user_id = u.id WHERE d.id = ?`, [id]
    );
    if (!deps.length) return res.status(404).json({ error: 'Not found' });
    const dep = deps[0];
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [dep.amount, dep.user_id]);
    await db.query(`UPDATE deposits SET status='approved', utr_number=?, approved_at=NOW() WHERE id=?`, [utr || 'MANUAL', id]);
    await db.query(`INSERT INTO transactions (user_id, type, amount, utr_number, status, source, created_at) VALUES (?, 'deposit', ?, ?, 'approved', 'manual', NOW())`, [dep.user_id, dep.amount, utr || 'MANUAL']);
    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        const [updated] = await db.query('SELECT wallet_balance FROM users WHERE id=?', [dep.user_id]);
        await sock.sendMessage(`${dep.whatsapp_number}@s.whatsapp.net`, {
          text: `✅ *Deposit Approved!*\n━━━━━━━━━━━━━━━━━━\n\n💰 Amount: *Rs. ${dep.amount}*\n👛 Balance: *Rs. ${updated[0].wallet_balance}*\n\n_BET bhejo aur jeeto!_ 🎯`
        });
      }
    } catch (e) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REJECT DEPOSIT
router.post('/deposits/:id/reject', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const [deps] = await db.query(`SELECT d.*, u.whatsapp_number FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id=?`, [id]);
    if (!deps.length) return res.status(404).json({ error: 'Not found' });
    await db.query(`UPDATE deposits SET status='rejected', admin_note=? WHERE id=?`, [reason || 'Rejected', id]);
    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        await sock.sendMessage(`${deps[0].whatsapp_number}@s.whatsapp.net`, {
          text: `❌ *Deposit Rejected*\n\nAmount: Rs. ${deps[0].amount}\nReason: ${reason || 'Invalid'}\n\nSupport se contact karo.`
        });
      }
    } catch (e) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PENDING WITHDRAWALS
router.get('/withdrawals/pending', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT w.*, u.name, u.whatsapp_number FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.status = 'pending' ORDER BY w.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PAY WITHDRAWAL
router.post('/withdrawals/:id/pay', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { utr } = req.body;
    const [wds] = await db.query(`SELECT w.*, u.whatsapp_number FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id=?`, [id]);
    if (!wds.length) return res.status(404).json({ error: 'Not found' });
    await db.query(`UPDATE withdrawals SET status='paid', utr_number=?, paid_at=NOW() WHERE id=?`, [utr, id]);
    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        await sock.sendMessage(`${wds[0].whatsapp_number}@s.whatsapp.net`, {
          text: `✅ *Withdrawal Paid!*\n━━━━━━━━━━━━━━━━━━\n\n💰 Amount: *Rs. ${wds[0].amount}*\n📱 UPI: ${wds[0].upi_id}\n🔢 UTR: ${utr}\n\n_Paisa mil gaya? Confirm karo_ 🙏`
        });
      }
    } catch (e) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REJECT WITHDRAWAL
router.post('/withdrawals/:id/reject', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const [wds] = await db.query(`SELECT w.*, u.whatsapp_number FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id=?`, [id]);
    if (!wds.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [wds[0].amount, wds[0].user_id]);
    await db.query(`UPDATE withdrawals SET status='rejected', admin_note=? WHERE id=?`, [reason || 'Rejected', id]);
    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        await sock.sendMessage(`${wds[0].whatsapp_number}@s.whatsapp.net`, {
          text: `❌ *Withdrawal Rejected*\n\nAmount: Rs. ${wds[0].amount}\nReason: ${reason || 'Rejected'}\n\nAmount wapas wallet mein add ho gaya.`
        });
      }
    } catch (e) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ALL USERS
router.get('/users', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, whatsapp_number, upi_id, wallet_balance, status, registered_at
       FROM users ORDER BY registered_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BLOCK/UNBLOCK USER
router.post('/users/:id/block', authCheck, async (req, res) => {
  try {
    const status = req.body.action === 'block' ? 'blocked' : 'active';
    await db.query('UPDATE users SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WALLET ADJUST
router.post('/users/:id/adjust', authCheck, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [amount, req.params.id]);
    await db.query(`INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?, 'deposit', ?, ?, NOW())`, [req.params.id, Math.abs(amount), reason]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ALL MARKETS
router.get('/markets', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM markets ORDER BY open_time ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD MARKET
router.post('/markets', authCheck, async (req, res) => {
  try {
    const { name, open_time, close_time, result_time, status } = req.body;
    await db.query(
      `INSERT INTO markets (name, open_time, close_time, result_time, status)
       VALUES (?, ?, ?, ?, ?)`,
      [name, open_time, close_time, result_time, status || 'open']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// EDIT MARKET ← YEH FIX HAI
router.put('/markets/:id', authCheck, async (req, res) => {
  try {
    const { name, open_time, close_time, result_time, status } = req.body;
    const fields = [];
    const values = [];
    if (name)        { fields.push('name=?');        values.push(name); }
    if (open_time)   { fields.push('open_time=?');   values.push(open_time); }
    if (close_time)  { fields.push('close_time=?');  values.push(close_time); }
    if (result_time) { fields.push('result_time=?'); values.push(result_time); }
    if (status)      { fields.push('status=?');      values.push(status); }
    if (!fields.length) return res.json({ success: true });
    values.push(req.params.id);
    await db.query(`UPDATE markets SET ${fields.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DECLARE RESULT ← FIXED ORDER: Open > Jodi > Close
router.post('/markets/:id/result', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { openPana, closePana } = req.body;
    if (!openPana) {
  return res.status(400).json({ error: 'Open Pana required hai' });
    }

const openAnk  = String(openPana.split('').reduce((a,b) => a + parseInt(b), 0) % 10);
const closeAnk = closePana ? String(closePana.split('').reduce((a,b) => a + parseInt(b), 0) % 10) : null;
const jodi     = closeAnk ? `${openAnk}${closeAnk}` : null;
const status   = closePana ? 'resulted' : 'open_resulted';

    await db.query(
      `UPDATE markets SET
        status=?,
        result_single=?,
        result_jodi=?,
        result_open_pana=?,
        result_close_pana=?,
        resulted_at=NOW()
       WHERE id=?`,
      [status, openAnk, jodi, openPana, closePana||null, id]
    );

    const { declareResult } = require('../services/result-engine');
    const summary = await declareResult(id, {
      single: openAnk, jodi, openPana, closePana
    });

    // WhatsApp par result broadcast
    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        const [mkt] = await db.query('SELECT * FROM markets WHERE id=?', [id]);
        const [users] = await db.query(`SELECT whatsapp_number FROM users WHERE status='active'`);
        const msg =
          `🎲 *RESULT DECLARED!*\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `🏪 *${mkt[0].name}*\n\n` +
          `*OPEN*\n` +
          `Pana: *${openPana}*\n` +
          `Ank: *${openAnk}*\n\n` +
          `*JODI: ${jodi}*\n\n` +
          `*CLOSE*\n` +
          `Pana: *${closePana}*\n` +
          `Ank: *${closeAnk}*\n\n` +
          `_Agli market ke liye MARKETS bhejo_ 🎯`;
        for (const u of users) {
          try {
            await sock.sendMessage(`${u.whatsapp_number}@s.whatsapp.net`, { text: msg });
            await new Promise(r => setTimeout(r, 100));
          } catch (e) {}
        }
      }
    } catch (e) {}

    res.json({ success: true, openAnk, closeAnk, jodi, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BETS BY MARKET ← PDF ke liye
router.get('/bets/by-market/:id', authCheck, async (req, res) => {
  try {
    const [bets] = await db.query(
      `SELECT bet_type, number, SUM(amount) as total_amount, COUNT(*) as count
       FROM bets WHERE market_id=? AND status != 'cancelled'
       GROUP BY bet_type, number ORDER BY bet_type, number ASC`,
      [req.params.id]
    );
    res.json(bets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CHANGE CREDENTIALS
router.post('/change-credentials', authCheck, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const [admins] = await db.query('SELECT * FROM admins WHERE id=?', [req.admin.id]);
    if (!admins.length) return res.status(404).json({ error: 'Admin not found' });
    const valid = await bcrypt.compare(currentPassword, admins[0].password_hash) ||
                  currentPassword === process.env.ADMIN_PASSWORD;
    if (!valid) return res.status(401).json({ error: 'Current password galat hai' });
    const updates = [];
    const values  = [];
    if (username) { updates.push('username=?'); values.push(username); }
    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 10);
      updates.push('password_hash=?');
      values.push(hash);
    }
    if (!updates.length) return res.json({ success: true });
    values.push(req.admin.id);
    await db.query(`UPDATE admins SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GAME RATES
router.post('/rates', authCheck, async (req, res) => {
  try {
    res.json({ success: true, rates: req.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function digitSum(p) {
  if (!p) return '0';
  return String(p.split('').reduce((a,b) => a + parseInt(b), 0) % 10);
}

module.exports = router;
