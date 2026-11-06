// How long a presence row survives without a heartbeat (poll). After this the
// dot is treated as offline and removed — implements "dot disappears when the
// user leaves" even if their tab closed without a clean leave.
export const STALE_MS = 30_000;

// Explicit tab close/reload keeps a session resumable briefly, while a lost
// network connection still becomes undiscoverable at the heartbeat timeout.
export const RECONNECT_GRACE_MS = 10_000;

// Orphan signals (mailbox messages never drained) are cleaned up after this.
export const SIGNAL_TTL_MS = 60_000;

export const WAVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Client poll interval. Kept here so client + server reason about the same cadence.
export const POLL_INTERVAL_MS = 1_500;
