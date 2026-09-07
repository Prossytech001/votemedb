const pool = require('../db/pool');
const paystack = require('../services/paystack');
const { getPlatformFeePercent, splitAmount } = require('../services/settings');
const realtime = require('../lib/realtime');

// How long a vote can sit as 'pending' before we treat it as possibly stuck
// (webhook may have failed silently — see the technical handover, Section 8.1).
const STUCK_AFTER_MINUTES = 3;

// How often the job runs.
const RUN_EVERY_MS = 90 * 1000; // 90 seconds

async function reconcileStuckPending() {
  try {
    const { rows: stuckVotes } = await pool.query(
      `SELECT id, payment_ref FROM votes
       WHERE status = 'pending' AND created_at < now() - interval '${STUCK_AFTER_MINUTES} minutes'
       ORDER BY created_at ASC`
    );

    if (stuckVotes.length === 0) return;

    console.log(`[reconcileJob] checking ${stuckVotes.length} stuck pending vote(s)...`);

    for (const vote of stuckVotes) {
      try {
        const data = await paystack.verifyTransaction(vote.payment_ref);

        if (data.status === 'success') {
          const feePercent = await getPlatformFeePercent();
          const { platformFeeKobo, organizerPayoutKobo } = splitAmount(data.amount, feePercent);

          const { rows } = await pool.query(
            `UPDATE votes
             SET status = 'success', platform_fee_kobo = $1, organizer_payout_kobo = $2, confirmed_via = 'reconcile_job'
             WHERE id = $3 AND status = 'pending'
             RETURNING *`,
            [platformFeeKobo, organizerPayoutKobo, vote.id]
          );
          if (rows.length) {
            realtime.emitVoteUpdate(rows[0]);
            realtime.emitEarningsUpdate();
            console.log(`[reconcileJob] recovered a stuck payment -> success (vote #${vote.id})`);
          }
        } else if (data.status === 'failed' || data.status === 'abandoned') {
          const { rows } = await pool.query(
            `UPDATE votes
             SET status = 'failed', failure_reason = $1, confirmed_via = 'reconcile_job'
             WHERE id = $2 AND status = 'pending'
             RETURNING *`,
            [data.gateway_response || data.status, vote.id]
          );
          if (rows.length) realtime.emitVoteUpdate(rows[0]);
        }
        // if still 'pending' on Paystack's side too, leave it — it may just be genuinely in progress
      } catch (err) {
        console.error(`[reconcileJob] error checking ${vote.payment_ref}:`, err.response?.data?.message || err.message);
      }
    }
  } catch (err) {
    console.error('[reconcileJob] fatal error:', err.message);
  }
}

function start() {
  console.log(`[reconcileJob] started — checking every ${RUN_EVERY_MS / 1000}s for payments stuck pending longer than ${STUCK_AFTER_MINUTES}min`);
  setInterval(reconcileStuckPending, RUN_EVERY_MS);
}

module.exports = { start, reconcileStuckPending };
