const express = require('express');
const router  = express.Router();
const db      = require('../../database');

router.get('/pending', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT d.*, u.name, u.whatsapp_number FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = ? ORDER BY d.created_at DESC',
      ['pending']
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const [deps] = await db.query('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deps.length) return res.status(404).json({ error: 'Not found' });
    const dep = deps[0];
    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [dep.amount, dep.user_id]);
    await db.query('UPDATE deposits SET status = ?, approved_at = NOW() WHERE id = ?', ['approved', req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    await db.query('UPDATE deposits SET status = ?, admin_note = ? WHERE id = ?', ['rejected', req.body.reason || 'Rejected', req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
