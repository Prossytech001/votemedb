const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

// Public: list all categories with nominee count
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.is_open, COUNT(n.id)::int AS nominee_count
      FROM categories c
      LEFT JOIN nominees n ON n.category_id = c.id
      GROUP BY c.id
      ORDER BY c.id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Admin: create category
router.post('/', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create category (may already exist)' });
  }
});

// Admin: open/close a category
router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_open, name } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE categories SET
        is_open = COALESCE($1, is_open),
        name = COALESCE($2, name)
       WHERE id = $3 RETURNING *`,
      [is_open, name, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Category not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Admin: delete category
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
