let io = null;

function init(socketIoInstance) {
  io = socketIoInstance;
}

// Called whenever a vote's status changes (webhook, manual verify, or reconcile job).
// Frontend listens for this to update results/dashboard instantly, no polling.
function emitVoteUpdate(vote) {
  if (!io) return;
  io.emit('vote:updated', {
    id: vote.id,
    nominee_id: vote.nominee_id,
    status: vote.status,
    vote_count: vote.vote_count,
  });
}

// Called after any change that affects the earnings totals, so the admin
// dashboard's numbers update live without a manual refresh.
function emitEarningsUpdate() {
  if (!io) return;
  io.emit('earnings:updated', { at: new Date().toISOString() });
}

module.exports = { init, emitVoteUpdate, emitEarningsUpdate };
