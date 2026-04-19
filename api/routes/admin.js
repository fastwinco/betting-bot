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
    const valid = await bcrypt.compare(password, admin.password_hash) || password === process.env.ADMIN_PASSWORD;
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
router.get('/withdrawals/pending', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT w.*, u.name, u.whatsapp_number
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       WHERE w.status = 'pending'
       ORDER BY w.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAY WITHDRAWAL ────────────────────────────────────────
router.post('/withdrawals/:id/pay', authCheck, async (req, res) => {
  try {
    const { id }  = req.params;
    const { utr } = req.body;

    const [wds] = await db.query(
      `SELECT w.*, u.whatsapp_number 
       FROM withdrawals w 
       JOIN users u ON w.user_id = u.id 
       WHERE w.id=?`, [id]
    );
    if (!wds.length) return res.status(404).json({ error: 'Not found' });
    const wd = wds[0];

    await db.query(
      `UPDATE withdrawals 
       SET status='paid', utr_number=?, paid_at=NOW() 
       WHERE id=?`,
      [utr, id]
    );

    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        await sock.sendMessage(
          `${wd.whatsapp_number}@s.whatsapp.net`,
          {
            text:
              `✅ *Withdrawal Paid!*\n` +
              `━━━━━━━━━━━━━━━━━━\n\n` +
              `💰 Amount: *Rs. ${wd.amount}*\n` +
              `📱 UPI: ${wd.upi_id}\n` +
              `🔢 UTR: ${utr}\n\n` +
              `_Paisa mil gaya? Confirm karo_ 🙏`
          }
        );
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REJECT WITHDRAWAL ─────────────────────────────────────
router.post('/withdrawals/:id/reject', authCheck, async (req, res) => {
  try {
    const { id }     = req.params;
    const { reason } = req.body;

    const [wds] = await db.query(
      `SELECT w.*, u.whatsapp_number 
       FROM withdrawals w 
       JOIN users u ON w.user_id = u.id 
       WHERE w.id=?`, [id]
    );
    if (!wds.length) return res.status(404).json({ error: 'Not found' });
    const wd = wds[0];

    // Balance wapas karo
    await db.query(
      'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?',
      [wd.amount, wd.user_id]
    );

    await db.query(
      `UPDATE withdrawals 
       SET status='rejected', admin_note=? 
       WHERE id=?`,
      [reason || 'Rejected', id]
    );

    try {
      const { getSock } = require('../../bot/index');
      const sock = getSock();
      if (sock) {
        await sock.sendMessage(
          `${wd.whatsapp_number}@s.whatsapp.net`,
          {
            text:
              `❌ *Withdrawal Rejected*\n\n` +
              `Amount: Rs. ${wd.amount}\n` +
              `Reason: ${reason || 'Rejected by admin'}\n\n` +
              `Amount wapas wallet mein add ho gaya.`
          }
        );
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ALL USERS ─────────────────────────────────────────────
router.get('/users', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, whatsapp_number, upi_id,
              wallet_balance, status, registered_at
       FROM users ORDER BY registered_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BLOCK / UNBLOCK USER ──────────────────────────────────
router.post('/users/:id/block', authCheck, async (req, res) => {
  try {
    const { id }     = req.params;
    const { action } = req.body; // 'block' or 'unblock'
    const status     = action === 'block' ? 'blocked' : 'active';
    await db.query('UPDATE users SET status=? WHERE id=?', [status, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MARKETS ───────────────────────────────────────────────
router.get('/markets', authCheck, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM markets ORDER BY open_time ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DECLARE RESULT ────────────────────────────────────────
router.post('/markets/:id/result', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const { openPana, closePana } = req.body;

    if (!openPana || !closePana) {
      return res.status(400).json({ error: 'openPana aur closePana dono chahiye' });
    }

    // Single aur Jodi calculate karo
    const openSingle  = digitSum(openPana);
    const closeSingle = digitSum(closePana);
    const jodi        = `${openSingle}${closeSingle}`;

    // Market update
    await db.query(
      `UPDATE markets SET
        status           = 'resulted',
        result_single    = ?,
        result_jodi      = ?,
        result_open_pana = ?,
        result_close_pana= ?,
        resulted_at      = NOW()
       WHERE id = ?`,
      [openSingle, jodi, openPana, closePana, id]
    );

    // Result engine run karo
    const { declareResult } = require('../services/result-engine');
    const summary = await declareResult(id, {
      single:    openSingle,
      jodi:      jodi,
      openPana:  openPana,
      closePana: closePana
    });

    res.json({ success: true, openSingle, closeSingle, jodi, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MARKET PDFs ───────────────────────────────────────────
router.get('/markets/:id/pdfs', authCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const [pdfs] = await db.query(
      'SELECT * FROM market_pdfs WHERE market_id=?', [id]
    );
    res.json(pdfs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HELPER ────────────────────────────────────────────────
function digitSum(pana) {
  if (!pana) return '0';
  const sum = pana.split('').reduce((a, b) => a + parseInt(b), 0);
  return String(sum % 10);
}

module.exports = router;
