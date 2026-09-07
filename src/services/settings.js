const pool = require('../db/pool');

async function getPricePerVoteKobo() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'price_per_vote_kobo'");
  return rows.length ? parseInt(rows[0].value, 10) : 10000; // default ₦100
}

async function getPlatformFeePercent() {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'platform_fee_percent'");
  return rows.length ? parseFloat(rows[0].value) : 30; // default 30%
}

// Given a total amount in kobo, split it into { platformFeeKobo, organizerPayoutKobo }
// using whatever the fee % is AT THIS MOMENT. Called only once per vote, at confirmation
// time, and the result is stored — so later fee % changes never retroactively affect it.
function splitAmount(amountKobo, feePercent) {
  const platformFeeKobo = Math.round(amountKobo * (feePercent / 100));
  const organizerPayoutKobo = amountKobo - platformFeeKobo;
  return { platformFeeKobo, organizerPayoutKobo };
}

module.exports = { getPricePerVoteKobo, getPlatformFeePercent, splitAmount };
