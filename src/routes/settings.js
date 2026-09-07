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

// Public: current platform fee % (so the frontend can show "₦30 of every ₦100 goes to ProxAfrica")
router.get('/platform-fee', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'platform_fee_percent'");
    const percent = rows.length ? parseFloat(rows[0].value) : 30;
    res.json({ platform_fee_percent: percent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch platform fee' });
  }
});

// Admin: update platform fee % — only affects votes confirmed AFTER this change;
// past votes keep the split that was locked in at the time they were confirmed.
router.patch('/platform-fee', requireAdmin, async (req, res) => {
  const { fee_percent } = req.body;
  if (fee_percent === undefined || fee_percent < 0 || fee_percent > 100) {
    return res.status(400).json({ error: 'fee_percent required, must be between 0 and 100' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('platform_fee_percent', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [fee_percent.toString()]
    );
    res.json({ platform_fee_percent: fee_percent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update platform fee' });
  }
});

module.exports = router;
