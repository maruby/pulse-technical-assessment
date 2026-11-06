# Pulse assessment notes

## Phase 1 — Make it run

- **Presence cleanup:** A closed tab could leave a stale dot because it could not send a clean leave. The polling API refreshes `lastSeen` for active clients and deletes rows older than 15 seconds (`STALE_MS`). It also removes undelivered signaling rows older than 60 seconds.

  ```ts
  await prisma.presence.updateMany({ where: { id }, data: { lastSeen: new Date(now) } });
  await prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } });
  ```

- **Busy state and disconnects:** Both users become busy on accept and are freed on decline or hang-up. If polling shows the peer has disappeared, the client sends an `end` signal and tears down its local session; WebRTC failure or data-channel closure also triggers teardown.

  ```ts
  if (signalType === "accept") set both peers busy;
  else if (signalType === "decline" || signalType === "end") clear both busy flags;
  ```

- **Chat and ICE setup:** Chat could be dropped when the sender's message shape did not match the receiver's parser. Both sides now use `{ t: "chat", text }`. ICE candidates that arrive before `remoteDescription` are queued, then flushed after `setRemoteDescription` succeeds.

  ```ts
  if (!this.pc.remoteDescription) this.pendingCandidates.push(data);
  // After setting the remote description:
  await this.flushPendingCandidates();
  ```

- **Join feedback and verification:** Join errors are surfaced to the user so a failed request does not appear to hang. I checked stale-session expiry and busy-state reset against the live Neon API, then used two Edge contexts to verify discovery, acceptance, chat, fake-media video, hang-up, peer-tab closure, and reconnect.

## Phase 2 — Make it good

### Phase 2 UI/UX design specification

## Design Direction: Cozy Cat Theme

Transform Pulse into a warm, playful, modern social discovery application inspired by orange tabby cats.

The application should feel welcoming, minimal, polished, and premium.

Avoid:
- Cosmic or space aesthetics.
- Neon colors.
- Cyberpunk styling.
- Excessive gradients.
- Overly playful children's game interfaces.

## 1. Color Palette

| Element | Color |
|---|---|
| Background | #FFF9F1 |
| Surface | #FFFFFF |
| Primary | #F28C38 |
| Secondary | #FFB66D |
| Soft Accent | #FCE8D5 |
| Text | #39332E |
| Muted Text | #8C8177 |
| Border | #F0E7DC |

Use orange strategically. Avoid making the entire interface orange.

## 2. Design Language

- Light cream backgrounds.
- White surfaces with subtle shadows.
- Rounded UI components.
- Warm orange accents.
- Clean typography.
- Generous whitespace.
- Minimalist navigation.
- Subtle and intentional animations.

## 3. Signature Element: Paw Print Locations

Paw prints must be the primary location indicators throughout the globe.

Replace traditional map pins and generic location dots with stylized cat paw-print icons.

### States

**Default**
- Orange paw print.
- Subtle cream circular background.

**Online**
- Gentle pulsing animation.
- Indicates an active user.

**Selected**
- Expanding circular ripple.
- Highlight the selected paw.

**Clustered**
- Larger paw indicator.
- Display the number of users nearby.

**Hover / Tap**
- Display a small user information popover.
- Provide an option to initiate a connection.

### Requirements
- Maintain recognizable paw shapes at different zoom levels.
- Ensure sufficient contrast against the map.
- Avoid excessive animations.
- Preserve accurate geographic positioning.
- Do not expose exact user coordinates to other users.

## 4. Phase 2 Priorities

### P0 — Design Foundation
- Establish design tokens.
- Implement the light color palette.
- Update typography, buttons, icons, and reusable components.
- Apply consistent styling throughout the application.

### P1 — Globe Experience
- Replace location pins with paw-print indicators.
- Implement online and selected states.
- Add clustered paw indicators.
- Add subtle animations and selection effects.
- Preserve existing globe functionality.

### P2 — Core UI
- Redesign floating navigation and quick actions.
- Restyle chat bubbles and messaging interactions.
- Redesign video call controls.
- Improve connection and disconnection animations.
- Polish notifications and empty states.

### P3 — Final Polish
- Add subtle paw-inspired micro-interactions.
- Improve loading states.
- Optimize desktop and mobile layouts.
- Support reduced-motion accessibility.

## 5. Technical Constraints

1. Inspect the existing codebase before implementation.
2. Preserve all existing functionality.
3. Do not modify backend APIs or database schemas.
4. Do not break WebSocket, WebRTC, authentication, or location tracking.
5. Reuse existing components and dependencies.
6. Keep components modular and maintainable.
7. Implement incrementally from P0 to P3.
8. Run builds and tests after changes.

## 6. Definition of Done

Pulse should feel like a welcoming social discovery application with a distinctive orange cat identity.

The globe remains the centerpiece.

Paw prints become the recognizable signature of user presence and location.

The interface must be beautiful, intuitive, responsive, and fully functional.

## Phase 3 — Make it secure

- **High — session ID spoofing / mailbox and presence access:** Public client generated IDs were treated as authentication. A caller could poll another session's signaling inbox, emit signals as it, or delete its presence. Join now issues a cryptographically random bearer token, stores only its SHA-256 hash, rejects duplicate IDs, and the poll, signal, and leave routes require proof of ownership. The token is sent in a request header except for `sendBeacon`, where it is in the body; it is never returned to peers or put in a URL.
- **High — signaling state tampering:** Arbitrary authenticated sessions could previously force a peer busy/free or inject SDP/ICE outside an accepted connection. Requests now reserve the recipient; accept/decline must match the pending relationship; WebRTC and hang-up signals require the reciprocal active pair. Abandoned requests expire after the signal TTL.
- **Medium — oversized request bodies:** Each JSON POST now reads at most a route-specific byte limit before parsing (2 KiB for join/leave and 68 KiB for SDP/ICE signaling); oversized requests receive `413`. This bounds memory use before field validation.
- **Remaining fixes:** Shared rate limits and abuse monitoring are still needed. A stolen in-memory bearer token controls its session until it expires. Apply all `Presence` schema changes before deploying; preexisting rows with an empty hash cannot authenticate and should expire or be removed.

### Manual security checks

- Apply the updated schema to a disposable development database with `npx prisma db push`, then run `npm run dev`. In the app's DevTools Console, run this setup to create two temporary sessions:

  ```js
  const joinTest = async () => {
    const id = crypto.randomUUID();
    const response = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, lat: 37.7749, lng: -122.4194 }),
    });
    return { id, ...(await response.json()) };
  };

  const a = await joinTest();
  const b = await joinTest();

  const call = async (url, body, token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Session-Token": token } : {}),
      },
      body: JSON.stringify(body),
    });
    console.log(response.status, await response.text());
  };

  const poll = async (session, token = session.token) => {
    const response = await fetch(`/api/poll?id=${session.id}`, {
      headers: token ? { "X-Session-Token": token } : {},
    });
    console.log(
      response.status,
      response.headers.get("cache-control"),
      await response.text(),
    );
  };
  ```

- Verify authentication: `await poll(a, null)` and `await poll(a, b.token)` should return `401`; `await poll(a)` should return `200` and `Cache-Control: no-store`.
- Verify connection state:

  ```js
  await call("/api/signal", { fromId: a.id, toId: b.id, type: "request" }, a.token); // 200
  await call("/api/signal", { fromId: a.id, toId: b.id, type: "offer", payload: "{}" }, a.token); // 403 before accept
  await call("/api/signal", { fromId: b.id, toId: a.id, type: "accept" }, b.token); // 200
  await call("/api/signal", { fromId: a.id, toId: b.id, type: "offer", payload: "{}" }, a.token); // 200
  ```

- Create a third session with `const c = await joinTest()`. An `end` from C to A should return `403`; a `request` from C to A while A is connected to B should return `409`. Joining again with `a.id` should return `409`.
- Verify request-size limits: a join or leave JSON body over 2 KiB and a signal JSON body over 68 KiB should return `413`. For example, create an oversized signal payload with `"x".repeat(70_000)`.
- When finished, remove temporary sessions with authenticated `POST /api/leave` calls using `{ id: a.id, token: a.token }` (and likewise for B and C), or wait for stale-session cleanup. Shared rate limiting is not implemented yet.

## Phase 4 — Make it better

### Pulse Signals — implementation log

#### Milestone 1: backend, session lifecycle, and safety APIs

- Added `ActivitySignal` (one active row per presence), `WaveRequest`, `PresenceTab`, `Block`, `SignalReport`, and shared `RateLimitBucket` models in `prisma/schema.prisma`, with the additive migration `prisma/migrations/20261106180000_pulse_signals/migration.sql`. The existing `Signal` table remains the transient WebRTC mailbox.
- Milestone 1 backend/database follow-up: the existing authenticated `POST`/`DELETE /api/pulse-signal` endpoints provide one-active-Signal upsert and owner-only deletion; `GET /api/poll` returns active, discoverable Signals alongside existing peers using privacy-offset Presence coordinates and the existing block/session filters. API validation checks category, trims optional notes, caps notes at 120 characters, and enforces active owner-tab authentication. The migration now also enforces the category allowlist and 120-character message bound in PostgreSQL, and the PresenceTab index now matches `(presenceId, releasedAt, lastSeen)` discovery/lease checks. No frontend or additional feature endpoints were added in this follow-up.
- Added authenticated `POST`/`DELETE /api/pulse-signal`, `POST /api/waves`, `POST /api/waves/respond`, `POST`/`DELETE /api/blocks`, and `POST /api/reports`. `GET /api/poll` now includes active nearby Signals, the current user's Signal, and incoming Waves; only the elected tab drains WebRTC events. `/api/signal` remains the existing connection protocol and now shares Wave cooldowns and request rate limits.
- Join/resume stores one anonymous browser identity in local storage and creates per-tab leases. Explicitly released tabs get a 10-second refresh grace; missed heartbeats become undiscoverable at 30 seconds. Reports retain only session references and Signal snapshots for 30 days; blocks end when either anonymous session is cleaned up. No fixed-duration Signal expiry was added.
- API safeguards include session-owner and active-leader checks, category/message bounds, shared Postgres rate buckets (6 Signal publishes/hour, 5 requests/minute and 20/hour, 3 reports/hour), a 24-hour repeat-request cooldown after decline/ignore, bidirectional block filtering, and cleanup for stale sessions and retained records.
- Files added/modified: `prisma/schema.prisma`, the migration above, `app/api/{join,poll,leave,signal,pulse-signal,waves,blocks,reports}`, `lib/{api,client-session,connection-state,presence,rate-limit,session-auth,types}`, and this note.
- Checks passed: `npm.cmd run lint`, `npm.cmd run build`, `npx.cmd prisma validate`, and `git diff --check`. The migration has **not** been applied to any database, and two-browser/API acceptance testing is still outstanding.
- Known limits: report intake has no moderation dashboard or authenticated review endpoint; review remains operational/manual. Browser-persisted bearer tokens increase exposure to same-origin script compromise, and session-scoped rate limits/blocks can be bypassed by creating a new anonymous identity.

#### Frontend follow-up: Signal presentation and connection handoff

- Added the Signal composer and edit/remove controls, category markers on the globe, Signal details, Wave actions, report and block flows, and an incoming Wave prompt. Accepting a Wave enters the existing connection signaling flow, so the established chat/video components are reused.
- Added keyboard focus handling and Escape/Tab behavior for the new dialogs, mobile sheet styling, and states for busy, leader/observer tabs, and no active Signal.
- Updated the polling cleanup to expire abandoned `ACCEPTING` Waves and to omit an empty `notIn` filter when no blocks exist.
- Local lint, build, Prisma schema validation, and whitespace checks passed. The migration remains unapplied; database-backed and multi-browser acceptance checks still need a disposable database.

#### Milestone 2: Session Lifecycle and Real-time Presence

- Presence is heartbeated by the existing 1.5-second `/api/poll` loop. There is no server WebSocket layer in this repository; polling remains the real-time coordination transport, while accepted chat/video uses the existing peer-to-peer WebRTC channel.
- A missing tab heartbeat marks a session disconnected after 30 seconds and makes it undiscoverable. Explicit tab close uses `pagehide` plus `/api/leave` to release only that tab. The Signal remains available through the 10-second refresh grace, and is visible again when a valid tab resumes. A Signal is discoverable only while its Presence has a live tab; it has no fixed-duration expiry.
- Per-tab leases keep the shared session active while any tab continues heartbeating. The elected leader is replaced when its lease is released or becomes stale. Manually removing a Signal continues to delete it immediately.
- Added explicit whole-session logout through authenticated `POST /api/logout`. It deletes the Presence (cascading the Signal, leases, and session-scoped safety data), clears the browser's shared anonymous identity, and notifies other open tabs via `BroadcastChannel` with a local-storage event fallback. Added a Leave control to the map HUD.
- Files changed for this milestone: `app/api/logout/route.ts`, `app/page.tsx`, `app/components/MapHud.tsx`, `app/components/WorldMap.tsx`, `app/globals.css`, `lib/api.ts`, `lib/client-session.ts`, and this note.
- Checks passed: `npm.cmd run lint` (no warnings), `npm.cmd run build`, `npx.cmd prisma validate`, and `git diff --check`. Lifecycle API/browser integration scenarios were not run: this checkout has no test script or local PostgreSQL service, and the configured Neon database/migration was left untouched. Verify refresh, multi-tab handoff, closure, 30-second timeout, logout propagation, and manual Signal removal against a disposable database before deployment.
