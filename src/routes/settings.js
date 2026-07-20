const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

// Public: get current price per vote (in Naira, for display)
router.get('/price-per-vote', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'price_per_vote_kobo'");
    const kobo = rows.length ? parseInt(rows[0].value, 10) : 10000;
    res.json({ price_per_vote_naira: kobo / 100 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

// Admin: update price per vote
router.patch('/price-per-vote', requireAdmin, async (req, res) => {
  const { price_naira } = req.body;
  if (!price_naira || price_naira <= 0) return res.status(400).json({ error: 'price_naira required' });
  try {
    const kobo = Math.round(price_naira * 100);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('price_per_vote_kobo', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [kobo.toString()]
    );
    res.json({ price_per_vote_naira: price_naira });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

module.exports = router;
