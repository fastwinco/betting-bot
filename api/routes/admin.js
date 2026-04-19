const express = require('express');
const router  = express.Router();
const db      = require('../../database');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
require('dotenv').config();

// ── AUTH MIDDLEWARE ───────────────────────────────────────
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

// ── LOGIN ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [admins] = await db.query(
      'SELECT * FROM admins WHERE username = ?', [username]
    );
    if (!admins.length) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    const admin = admins[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    await db.query(
      'UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]
    );
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

// ── DASHBOARD STATS ───────────────────────────────────────
router.get('/stats', authCheck, async (req, res) => {
  try {
    const [[users]]    = await db.query('SELECT COUNT(*) as count FROM users');
    const [[deposits]] = await db.query(
      `SELECT COALESCE(SUM(amount),0) as total 
       FROM deposits 
       WHERE status='approved' AND DATE(created_at)=CURDATE()`
    );
    const [[bets]]     = await db.query(
      `SELECT COUNT(*) as count 
       FROM bets WHERE DATE(placed_at)=CURDATE()`
    );
    const [[pending]]  = await db.query(
      `SELECT COUNT(*) as count 
       FROM withdrawals WHERE status='pending'`
    );
    const [[pendingDep]] = await db.query(
      `SELECT COUNT(*) as count 
       FROM deposits WHERE status='pending'`
    );

    res.json({
      totalUsers:          users.count,
      todayDeposit:        deposits.total,
      todayBets:           bets.count,
      pendingWithdrawals:  pending.count,
      pendingDeposits:     pendingDep.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PENDING DEPOSITS ──────────────────────────────────────
router.get('/deposits/pending', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, u.name, u.whatsapp_number
       FROM deposits d
       JOIN users u ON d.user_id = u.id
       WHERE d.status = 'pending'
       ORDER BY d.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── APPROVE DEPOSIT ───────────────────────────────────────
router.post('/deposits/:id/approve', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { utr } = req.body;

    const [deps] = await db.query(
      `SELECT d.*, u.whatsapp_number 
       FROM deposits d 
       JOIN users u ON d.user_id = u.id
       WHERE d.id = ?`, [id]
    );
    if (!deps.length) return res.status(404).json({ error: 'Not found' });

    const dep = deps[0];

    // Wallet credit
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
      [dep.amount, dep.user_id]
    );

    // Deposit approve
    await db.query(
      `UPDATE deposits 
       SET status='approved', utr_number=?, approved_at=NOW() 
       WHERE id=?`,
      [utr || 'MANUAL', id]
    );

    // Transaction log
    await db.query(
      `INSERT INTO transactions 
        (user_id, type, amount, utr_number, status, source, created_at)
       VALUES (?, 'deposit', ?, ?, 'approved', 'manual', NOW())`,
      [dep.user_id, dep.amount, utr || 'MANUAL']
    );

    // WhatsApp notify
    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        const [updated] = await db.query(
          'SELECT wallet_balance FROM users WHERE id=?', [dep.user_id]
        );
        await sock.sendMessage(
          `${dep.whatsapp_number}@s.whatsapp.net`,
          {
            text:
              `✅ *Deposit Approved!*\n` +
              `━━━━━━━━━━━━━━━━━━\n\n` +
              `💰 Amount: *Rs. ${dep.amount}*\n` +
              `👛 Balance: *Rs. ${updated[0].wallet_balance}*\n\n` +
              `_BET bhejo aur jeeto!_ 🎯`
          }
        );
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REJECT DEPOSIT ────────────────────────────────────────
router.post('/deposits/:id/reject', authCheck, async (req, res) => {
  try {
    const { id }     = req.params;
    const { reason } = req.body;

    const [deps] = await db.query(
      `SELECT d.*, u.whatsapp_number 
       FROM deposits d 
       JOIN users u ON d.user_id = u.id 
       WHERE d.id=?`, [id]
    );
    if (!deps.length) return res.status(404).json({ error: 'Not found' });
    const dep = deps[0];

    await db.query(
      `UPDATE deposits 
       SET status='rejected', admin_note=? 
       WHERE id=?`,
      [reason || 'Rejected by admin', id]
    );

    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        await sock.sendMessage(
          `${dep.whatsapp_number}@s.whatsapp.net`,
          {
            text:
              `❌ *Deposit Rejected*\n\n` +
              `Amount: Rs. ${dep.amount}\n` +
              `Reason: ${reason || 'Invalid payment'}\n\n` +
              `Support se contact karo.`
          }
        );
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PENDING WITHDRAWALS ───────────────────────────────────
router.get('/wi
