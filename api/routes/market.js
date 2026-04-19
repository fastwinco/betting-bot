const express = require('express');
const router  = express.Router();
const db      = require('../../database');

// All markets
router.get('/', async (req, res) => {
  try {
    const [markets] = await db.query(
      'SELECT * FROM markets ORDER BY open_time ASC'
    );
    res.json(markets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single market
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM markets WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
