const express = require('express');
const router  = express.Router();
const db      = require('../../database');

router.get('/pending', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT w.*, u.name, u.whatsapp_number FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.status = ? ORDER BY w.created_at DESC',
      ['pending']
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pay', async (req, res) => {
  try {
    await db.query('UPDATE withdrawals SET status = ?, utr_number = ?, paid_at = NOW() WHERE id = ?', ['paid', req.body.utr || 'MANUAL', req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const [wds] = await db.query('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
    if (!wds.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [wds[0].amount, wds[0].user_id]);
    await db.query('UPDATE withdrawals SET status = ?, admin_note = ? WHERE id = ?', ['rejected', req.body.reason || 'Rejected', req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
