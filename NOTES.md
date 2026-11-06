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

- Pending.

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

- Pending.
