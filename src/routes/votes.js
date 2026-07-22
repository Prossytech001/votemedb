const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Helper: get current price per vote (in kobo) from settings table
async function getPricePerVote() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'price_per_vote_kobo'");
  return rows.length ? parseInt(rows[0].value, 10) : 10000; // default ₦100
}

// Public: initiate a vote purchase -> returns Paystack authorization_url (or use Paystack Inline on frontend)
router.post('/initiate', async (req, res) => {
  const { nominee_id, vote_count, voter_name, voter_phone, voter_email } = req.body;

  if (!nominee_id || !vote_count || vote_count < 1) {
    return res.status(400).json({ error: 'nominee_id and vote_count (>=1) are required' });
  }
  if (!voter_email) {
    return res.status(400).json({ error: 'voter_email is required (Paystack requires an email)' });
  }

  try {
    const pricePerVote = await getPricePerVote();
    const amount = pricePerVote * vote_count; // kobo
    const reference = `vote_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Record a pending vote row first so we never lose track of the attempt
    await pool.query(
      `INSERT INTO votes (nominee_id, voter_name, voter_phone, vote_count, amount_paid, payment_ref, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [nominee_id, voter_name || null, voter_phone || null, vote_count, amount, reference]
    );

    // Initialize transaction with Paystack
    const paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: voter_email,
        amount,
        reference,
        callback_url: `${process.env.FRONTEND_URL}/payment-success`,
        metadata: { nominee_id, vote_count },
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    res.json({
      authorization_url: paystackRes.data.data.authorization_url,
      access_code: paystackRes.data.data.access_code,
      reference,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

// Paystack webhook: confirms payment and finalizes vote status
// IMPORTANT: configure this exact URL in your Paystack dashboard webhook settings
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(req.body)
      .digest('hex');

    if (hash !== signature) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      const { reference } = event.data;

      // Idempotency: only update if still pending, prevents double-processing on webhook retries
      await pool.query(
        `UPDATE votes SET status = 'success' WHERE payment_ref = $1 AND status = 'pending'`,
        [reference]
      );
    } else if (event.event === 'charge.failed') {
      const { reference } = event.data;
      await pool.query(
        `UPDATE votes SET status = 'failed' WHERE payment_ref = $1 AND status = 'pending'`,
        [reference]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.sendStatus(500);
  }
});

// Public: verify a transaction manually (useful right after redirect from Paystack)
router.get('/verify/:reference', async (req, res) => {
  try {
    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${req.params.reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const status = paystackRes.data.data.status; // 'success' | 'failed' | 'abandoned'
    if (status === 'success') {
      await pool.query(
        `UPDATE votes SET status = 'success' WHERE payment_ref = $1 AND status = 'pending'`,
        [req.params.reference]
      );
    }
    res.json({ status });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

// Admin: reconcile pending payments — checks every 'pending' vote directly against Paystack
// and updates its status. Fixes cases where the webhook never reached the backend even
// though the payment actually succeeded on Paystack's side.
router.post('/admin/reconcile-pending', requireAdmin, async (req, res) => {
  try {
    const { rows: pendingVotes } = await pool.query(
      `SELECT id, payment_ref FROM votes WHERE status = 'pending' ORDER BY created_at ASC`
    );

    const results = { checked: pendingVotes.length, confirmed: 0, stillPending: 0, failed: 0, errors: [] };

    for (const vote of pendingVotes) {
      try {
        const paystackRes = await axios.get(
          `https://api.paystack.co/transaction/verify/${vote.payment_ref}`,
          { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
        );
        const status = paystackRes.data.data.status;

        if (status === 'success') {
          await pool.query(`UPDATE votes SET status = 'success' WHERE id = $1`, [vote.id]);
          results.confirmed++;
        } else if (status === 'failed' || status === 'abandoned') {
          await pool.query(`UPDATE votes SET status = 'failed' WHERE id = $1`, [vote.id]);
          results.failed++;
        } else {
          results.stillPending++;
        }
      } catch (err) {
        results.errors.push({ payment_ref: vote.payment_ref, error: err.response?.data?.message || err.message });
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reconcile pending payments' });
  }
});

// Admin: view all vote transactions
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*, n.name AS nominee_name, c.name AS category_name
      FROM votes v
      JOIN nominees n ON n.id = v.nominee_id
      JOIN categories c ON c.id = n.category_id
      ORDER BY v.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch votes' });
  }
});

module.exports = router;
