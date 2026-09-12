const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');
const paystack = require('../services/paystack');
const { getPricePerVoteKobo, getPlatformFeePercent, splitAmount } = require('../services/settings');
const realtime = require('../lib/realtime');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Shared helper: marks a vote as successful, calculates + stores the fee split,
// and emits a realtime update. Used by the webhook, manual verify, the pending
// reconciler, and the full reconciler — one place, so the split logic can never
// drift between the four confirmation paths.
async function markVoteSuccess({ id = null, paymentRef = null, amountPaid, confirmedVia }) {
  const feePercent = await getPlatformFeePercent();
  const { platformFeeKobo, organizerPayoutKobo } = splitAmount(amountPaid, feePercent);

  const whereClause = id ? 'id = $4' : 'payment_ref = $4';
  const whereValue = id || paymentRef;

  const { rows } = await pool.query(
    `UPDATE votes
     SET status = 'success', platform_fee_kobo = $1, organizer_payout_kobo = $2, confirmed_via = $3
     WHERE ${whereClause} AND status = 'pending'
     RETURNING *`,
    [platformFeeKobo, organizerPayoutKobo, confirmedVia, whereValue]
  );

  if (rows.length) {
    realtime.emitVoteUpdate(rows[0]);
    realtime.emitEarningsUpdate();
  }
  return rows[0] || null;
}

async function markVoteFailed({ id = null, paymentRef = null, reason = null, confirmedVia }) {
  const whereClause = id ? 'id = $3' : 'payment_ref = $3';
  const whereValue = id || paymentRef;

  const { rows } = await pool.query(
    `UPDATE votes
     SET status = 'failed', failure_reason = $1, confirmed_via = $2
     WHERE ${whereClause} AND status = 'pending'
     RETURNING *`,
    [reason, confirmedVia, whereValue]
  );

  if (rows.length) realtime.emitVoteUpdate(rows[0]);
  return rows[0] || null;
}

// Public: initiate a vote purchase -> returns Paystack authorization_url
router.post('/initiate', async (req, res) => {
  const { nominee_id, vote_count, voter_name, voter_phone, voter_email } = req.body;

  if (!nominee_id || !vote_count || vote_count < 1) {
    return res.status(400).json({ error: 'nominee_id and vote_count (>=1) are required' });
  }
  if (!voter_email) {
    return res.status(400).json({ error: 'voter_email is required (Paystack requires an email)' });
  }

  try {
    const pricePerVote = await getPricePerVoteKobo();
    const amount = pricePerVote * vote_count; // kobo
    const reference = `vote_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Record a pending vote row first so we never lose track of the attempt
    const { rows: inserted } = await pool.query(
      `INSERT INTO votes (nominee_id, voter_name, voter_phone, vote_count, amount_paid, payment_ref, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
      [nominee_id, voter_name || null, voter_phone || null, vote_count, amount, reference]
    );

    try {
      const { authorization_url, access_code } = await paystack.initializeTransaction({
        email: voter_email,
        amount,
        reference,
        callback_url: `${process.env.FRONTEND_URL}/payment-success`,
        metadata: { nominee_id, vote_count },
      });

      res.json({ authorization_url, access_code, reference });
    } catch (err) {
      await pool.query(
        `UPDATE votes SET status = 'failed', failure_reason = $1 WHERE id = $2`,
        ['Paystack init failed', inserted[0].id]
      );
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: 'Failed to initiate payment' });
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});


// Paystack webhook: primary, real-time confirmation path.
// IMPORTANT: configure this exact URL in your Paystack dashboard webhook settings
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');

    if (hash !== signature) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      await markVoteSuccess({
        paymentRef: event.data.reference,
        amountPaid: event.data.amount,
        confirmedVia: 'webhook',
      });
    } else if (event.event === 'charge.failed') {
      await markVoteFailed({
        paymentRef: event.data.reference,
        reason: event.data.gateway_response || 'Payment failed',
        confirmedVia: 'webhook',
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.sendStatus(500);
  }
});

// Public: verify a transaction manually (used right after redirect from Paystack, as a
// second confirmation path in case the webhook is delayed)
router.get('/verify/:reference', async (req, res) => {
  try {
    const data = await paystack.verifyTransaction(req.params.reference);

    if (data.status === 'success') {
      await markVoteSuccess({
        paymentRef: req.params.reference,
        amountPaid: data.amount,
        confirmedVia: 'manual_verify',
      });
    } else if (data.status === 'failed' || data.status === 'abandoned') {
      await markVoteFailed({
        paymentRef: req.params.reference,
        reason: data.gateway_response || data.status,
        confirmedVia: 'manual_verify',
      });
    }

    res.json({ status: data.status });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

// Admin: reconcile pending payments — checks every 'pending' vote directly against
// Paystack. Kept as a manual backup button; the automatic job (src/jobs/reconcileJob.js)
// is now the primary safety net, running every few minutes on its own.
router.post('/admin/reconcile-pending', requireAdmin, async (req, res) => {
  try {
    const { rows: pendingVotes } = await pool.query(
      `SELECT id, payment_ref, amount_paid FROM votes WHERE status = 'pending' ORDER BY created_at ASC`
    );

    const results = { checked: pendingVotes.length, confirmed: 0, stillPending: 0, failed: 0, errors: [] };

    for (const vote of pendingVotes) {
      try {
        const data = await paystack.verifyTransaction(vote.payment_ref);

        if (data.status === 'success') {
          await markVoteSuccess({ id: vote.id, amountPaid: data.amount, confirmedVia: 'reconcile_job' });
          results.confirmed++;
        } else if (data.status === 'failed' || data.status === 'abandoned') {
          await markVoteFailed({ id: vote.id, reason: data.gateway_response || data.status, confirmedVia: 'reconcile_job' });
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

// Admin: FULL reconciliation against Paystack's transaction list. Pulls Paystack's actual
// transaction history and updates/inserts anything out of sync — catches payments that
// succeeded on Paystack but never made it into the database at all.
router.post('/admin/reconcile-full', requireAdmin, async (req, res) => {
  const results = { fetchedFromPaystack: 0, updated: 0, inserted: 0, skippedNoMetadata: 0, unchanged: 0, errors: [] };

  try {
    const transactions = await paystack.listAllTransactions();
    results.fetchedFromPaystack = transactions.length;

    for (const txn of transactions) {
      try {
        const reference = txn.reference;
        const psStatus = txn.status === 'success' ? 'success'
          : (txn.status === 'failed' || txn.status === 'abandoned') ? 'failed'
          : 'pending';

        const { rows: existing } = await pool.query(
          `SELECT id, status FROM votes WHERE payment_ref = $1`,
          [reference]
        );

        if (existing.length > 0) {
          if (existing[0].status !== psStatus) {
            if (psStatus === 'success') {
              await markVoteSuccess({ id: existing[0].id, amountPaid: txn.amount, confirmedVia: 'reconcile_full' });
            } else if (psStatus === 'failed') {
              await markVoteFailed({ id: existing[0].id, reason: txn.gateway_response || psStatus, confirmedVia: 'reconcile_full' });
            }
            results.updated++;
          } else {
            results.unchanged++;
          }
        } else {
          const metadata = txn.metadata || {};
          const nomineeId = metadata.nominee_id;
          const voteCount = metadata.vote_count;

          if (!nomineeId || !voteCount) {
            results.skippedNoMetadata++;
            results.errors.push({
              reference,
              issue: 'Missing nominee_id/vote_count in Paystack metadata — needs manual review',
              amount: txn.amount,
              paidAt: txn.paid_at,
            });
            continue;
          }

          const feePercent = await getPlatformFeePercent();
          const { platformFeeKobo, organizerPayoutKobo } = psStatus === 'success'
            ? splitAmount(txn.amount, feePercent)
            : { platformFeeKobo: 0, organizerPayoutKobo: 0 };

          await pool.query(
            `INSERT INTO votes (nominee_id, voter_name, voter_phone, vote_count, amount_paid, payment_ref, status, platform_fee_kobo, organizer_payout_kobo, confirmed_via, failure_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              nomineeId, txn.customer?.first_name || null, txn.customer?.phone || null,
              voteCount, txn.amount, reference, psStatus,
              platformFeeKobo, organizerPayoutKobo, 'reconcile_full',
              psStatus === 'failed' ? (txn.gateway_response || 'failed') : null,
            ]
          );
          results.inserted++;
        }
      } catch (innerErr) {
        results.errors.push({ reference: txn.reference, issue: innerErr.message });
      }
    }

    realtime.emitEarningsUpdate();
    res.json(results);
  } catch (err) {
    console.error('Full reconcile error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to run full reconciliation', detail: err.response?.data || err.message });
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

// Admin: earnings + payment-health summary for the dashboard
router.get('/admin/earnings-summary', requireAdmin, async (req, res) => {
  try {
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(vote_count) FILTER (WHERE status = 'success'), 0)::int AS total_votes,
        COALESCE(SUM(amount_paid) FILTER (WHERE status = 'success'), 0)::int AS total_collected_kobo,
        COALESCE(SUM(organizer_payout_kobo) FILTER (WHERE status = 'success'), 0)::int AS organizer_earned_kobo,
        COALESCE(SUM(platform_fee_kobo) FILTER (WHERE status = 'success'), 0)::int AS platform_fee_kobo,
        COUNT(*) FILTER (WHERE status = 'success')::int AS confirmed_count,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
      FROM votes
    `);

    const feePercent = await getPlatformFeePercent();
    res.json({ ...totals[0], platform_fee_percent: feePercent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch earnings summary' });
  }
});

module.exports = router;
