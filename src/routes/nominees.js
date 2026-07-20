const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

// Public: list nominees for a category, with live vote totals (only counting successful payments)
router.get('/category/:categoryId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.name, n.photo_url,
              COALESCE(SUM(v.vote_count) FILTER (WHERE v.status = 'success'), 0)::int AS total_votes
       FROM nominees n
       LEFT JOIN votes v ON v.nominee_id = n.id
       WHERE n.category_id = $1
       GROUP BY n.id
       ORDER BY total_votes DESC, n.name ASC`,
      [req.params.categoryId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch nominees' });
  }
});

// Admin: add nominee
router.post('/', requireAdmin, async (req, res) => {
  const { category_id, name, photo_url } = req.body;
  if (!category_id || !name) return res.status(400).json({ error: 'category_id and name are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO nominees (category_id, name, photo_url) VALUES ($1, $2, $3) RETURNING *',
      [category_id, name, photo_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create nominee' });
  }
});

// Admin: update nominee
router.patch('/:id', requireAdmin, async (req, res) => {
  const { name, photo_url } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE nominees SET name = COALESCE($1, name), photo_url = COALESCE($2, photo_url)
       WHERE id = $3 RETURNING *`,
      [name, photo_url, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nominee not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update nominee' });
  }
});

// Admin: delete nominee
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM nominees WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete nominee' });
  }
});

module.exports = router;
