# Pulse — Take-Home Assessment Notes

## Phase 1 — Make it run

- **Problems and causes**
  - Closed tabs could leave stale presence because they could not reliably send a clean leave.
  - Connection busy state could persist after decline or disconnect because state transitions and teardown paths were inconsistent.
  - Chat messages were dropped when sender and receiver used different payload shapes; ICE candidates could arrive before remote-description setup.
  - Join failures had no clear user feedback, making failed requests appear to hang.
- **Fixes**
  - Polling refreshes active presence and prunes stale sessions and old signaling messages.
  - Accept, decline, end, disconnect, and WebRTC failure paths now update busy state and tear down connections consistently.
  - Chat uses a shared `{ t: "chat", text }` payload. Early ICE candidates are queued until the remote description is set.
  - Join errors are surfaced to the user.
- **Verification**
  - Live API checks covered stale-session expiry and busy-state reset.
  - Two Edge contexts exercised discovery, acceptance, chat, fake-media video, hang-up, peer-tab closure, and reconnect.

## Phase 2 — Make it good

- **Design direction:** A warm, restrained orange-cat identity uses cream backgrounds, white surfaces, rounded components, subtle shadows, clean typography, and orange accents. The globe remains the primary experience.
- **UI/UX:** Design tokens and shared controls establish consistent styling. Paw-print markers replace generic location dots, with online, selected, and clustered states. Navigation, chat, video controls, connection prompts, notifications, and empty states were redesigned around the same visual system.
- **Interactions and accessibility:** Signal and connection dialogs support keyboard focus, Escape, and tab navigation. Responsive sheets, loading and feedback states, subtle motion, and reduced-motion handling improve smaller-screen and accessibility behavior.
- **Preserved behavior:** The work reused the existing Mapbox globe, location flow, APIs, and WebRTC connection/chat/video components. Markers retain the existing approximate location placement; the redesign did not change backend APIs or data models.

## Phase 3 — Make it secure

- **High — session impersonation and unauthorized access:** Client-generated IDs were treated as credentials, allowing callers to act on another session's presence or signaling mailbox. Join now issues a random bearer token, stores only its SHA-256 hash, rejects duplicate IDs, and requires token ownership on poll, signal, and leave operations. Tokens are not placed in URLs or sent to peers.
- **High — signaling state tampering:** Authenticated clients could previously alter busy state or inject connection signaling outside a valid relationship. Requests now reserve recipients; accept/decline must match the pending pair; and WebRTC/hang-up signals require the reciprocal active connection.
- **Medium — unbounded request bodies and weak input handling:** JSON POST bodies are bounded before parsing (2 KiB for join/leave and 68 KiB for signaling), with oversized input rejected. Phase 4 APIs add field/category/message validation and enforce ownership and active-tab checks.
- **Medium — abuse through repeated actions:** Shared database-backed rate limits and request cooldowns were added with Phase 4 safety work (details below), instead of relying on process-local counters.
- **Low — operational report handling:** Reports are stored for review, but there is no moderation dashboard or in-app review workflow. No separate low-severity API vulnerability was confirmed in the recorded review.
- **Remaining risks:** Bearer tokens persisted in browser storage remain exposed to same-origin script compromise. Anonymous users can create a new identity to bypass session-scoped blocks and rate limits. Reports require manual operational review; abuse monitoring and account-level enforcement are not implemented. Existing deployments must apply the Presence schema changes, and stale rows without token hashes cannot authenticate.

## Phase 4 — Make it better

- **Purpose:** Pulse Signals let a person publish one temporary, categorized activity with an optional short note, making nearby discovery more expressive. Other people can view details and send a Wave to request a connection.
- **Backend and data model:** Added `ActivitySignal`, `WaveRequest`, `PresenceTab`, `Block`, `SignalReport`, and `RateLimitBucket` models through an additive Prisma migration. The pre-existing `Signal` model remains the transient WebRTC signaling mailbox. Authenticated APIs publish/update/delete a Signal, retrieve nearby active Signals through polling, send/respond to Waves, block sessions, and file reports. Discovery uses the existing privacy-offset coordinates and omits inactive, disconnected, or blocked sessions.
- **Session lifecycle and presence:** A shared anonymous browser identity is paired with per-tab leases and an elected tab for draining the WebRTC mailbox. Existing HTTP polling (about every 1.5 seconds) remains the coordination transport; there is no server WebSocket service. Missing heartbeats make sessions undiscoverable after about 30 seconds, with a 10-second refresh grace. Another live tab keeps the session online; logout removes the session and its dependent records. Signals do not have a fixed-duration expiry.
- **Waves and connections:** Wave creation serializes competing requests and checks availability, active Signal ownership, blocks, cooldowns, and duplicate pending requests. The receiver sees incoming Waves through polling and can accept, decline, or ignore; cancel and timeout clear the pending Wave. Acceptance hands off to the existing WebRTC signaling and `PeerSession` flows, reusing existing chat and video rather than adding a second messaging system.
- **Safety and rate limits:** Blocking is transactional with pending-Wave cleanup and connection teardown; both-direction blocks hide discovery and prevent new interactions. Reports validate the target Signal and reason, reject self/blocked cases, and retain session references and a Signal snapshot for 30 days. Shared limits include six Signal publishes/hour, five Wave requests/minute and 20/hour, three reports/hour, and ten blocks/hour; declined/ignored requests have a 24-hour repeat cooldown.
- **Frontend:** Reused the map and existing connection UI for category markers, a Signal composer/details view, active-Signal controls, Wave prompts, report/block flows, and feedback states. M6 adds connecting/reconnecting status and pending/failure feedback for safety actions. README describes the actual server-side records and lifecycle. No new dependencies were introduced for these features.
- **Verification:** Recorded implementation checks include `npm run lint`, production `npm run build`, `npx prisma validate`, and `git diff --check`. On disposable Neon branches, two-session browser tests covered Signal publish/discovery/details/update/delete, Wave delivery and duplicate rejection, acceptance, existing chat and fake-media video; API checks covered unauthorized/invalid requests, rate limits, blocking, and poll exclusion. Production database changes were not part of those test runs. The M6 continuation passed lint, build, Prisma validation, and whitespace checks.
- **Limitations and next steps:** The full 17-scenario Phase 4 acceptance matrix was not rerun during M6. Refresh/closure/network-loss timeout, multi-tab handoff, mobile visual inspection, and multi-user performance remain unverified as a complete acceptance pass. Real camera/microphone and strict-network WebRTC behavior were not covered; the app uses STUN without TURN. Reports have no moderation interface, and anonymous identity limits durable abuse prevention. Run the remaining lifecycle, responsive, and load scenarios against a disposable database and two independent browser sessions before calling the whole phase fully verified.