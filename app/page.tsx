"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import SignalComposer from "./components/SignalComposer";
import IncomingWavePrompt from "./components/IncomingWavePrompt";
import Button from "./components/Button";
import PawIcon from "./components/PawIcon";
import {
  blockPeer,
  leave,
  logout,
  poll,
  publishActivity,
  removeActivity,
  reportActivity,
  respondToWave,
  sendSignal,
  sendWave as createWaveRequest,
} from "@/lib/api";
import { announceSessionLogout, joinOrResumeSession, onSessionLogout } from "@/lib/client-session";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type ActivityCategory, type PeerDot, type SignalMsg, type WaveNotification } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";
type PollStatus = "connecting" | "connected" | "reconnecting";

const REQUEST_TIMEOUT_MS = 30_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId, setSessionId] = useState("");
  const tabId = useRef(crypto.randomUUID());
  const [sessionToken, setSessionToken] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [pollStatus, setPollStatus] = useState<PollStatus>("connecting");
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [myActivity, setMyActivity] = useState<Awaited<ReturnType<typeof poll>>["myActivity"]>(null);
  const [incomingWave, setIncomingWave] = useState<WaveNotification | null>(null);
  const [signalComposerOpen, setSignalComposerOpen] = useState(false);
  const [signalBusy, setSignalBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  function isRequestingPeer(peerId: string) {
    const current = connRef.current;
    return current.kind === "requesting" && current.peerId === peerId;
  }

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWaveIdRef = useRef<string | null>(null);
  const waveRequestInFlightRef = useRef(false);
  const waveCancelRequestedRef = useRef(false);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function emitSignal(peerId: string, type: Parameters<typeof sendSignal>[2], payload?: string) {
    return sendSignal(sessionId, peerId, type, sessionToken, payload, tabId.current);
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function clearLocalSession() {
    teardown();
    setPhase("gate");
    setSessionId("");
    setSessionToken("");
    setIsLeader(false);
    setPeers([]);
    setMyActivity(null);
    setIncomingWave(null);
    setMyLocation(null);
    setSignalComposerOpen(false);
  }

  const clearLocalSessionRef = useRef(clearLocalSession);
  useEffect(() => {
    clearLocalSessionRef.current = clearLocalSession;
  });

  async function handleLogout() {
    try {
      await logout(sessionId, sessionToken);
      announceSessionLogout(sessionId);
      clearLocalSession();
    } catch {
      showNotice("Could not leave Pulse. Check your connection and try again.");
    }
  }

  useEffect(() => onSessionLogout((id) => {
    if (id === sessionId) clearLocalSessionRef.current();
  }), [sessionId]);

  function startPeer(peerId: string, initiator: boolean) {
    const handleDisconnect = () => {
      if (peerRef.current !== ps) return;
      void emitSignal(peerId, "end");
      teardown("Stranger disconnected.");
    };

    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void emitSignal(peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") handleDisconnect();
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
        showNotice("You’re connected. Say hello!");
      },
      onChannelClose: handleDisconnect,
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (!isLeader || connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void emitSignal(peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void emitSignal(peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  async function createWave(peerId: string, activityId: string) {
    if (!isLeader || connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    waveRequestInFlightRef.current = true;
    waveCancelRequestedRef.current = false;
    showNotice("Wave sent. Waiting for a reply…");
    try {
      const result = await createWaveRequest(sessionId, activityId, sessionToken, tabId.current);
      waveRequestInFlightRef.current = false;
      if (
        waveCancelRequestedRef.current ||
        !isRequestingPeer(peerId)
      ) {
        waveCancelRequestedRef.current = false;
        void respondToWave(sessionId, result.waveId, "cancel", sessionToken, tabId.current).catch(() => {});
        return;
      }
      pendingWaveIdRef.current = result.waveId;
      requestTimer.current = setTimeout(() => {
        if (connRef.current.kind !== "requesting" || connRef.current.peerId !== peerId) return;
        pendingWaveIdRef.current = null;
        void respondToWave(sessionId, result.waveId, "cancel", sessionToken, tabId.current).catch(() => {});
        teardown("No answer yet. You can wave again later.");
      }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      waveRequestInFlightRef.current = false;
      waveCancelRequestedRef.current = false;
      pendingWaveIdRef.current = null;
      if (!isRequestingPeer(peerId)) return;
      const status = (error as Error & { status?: number }).status;
      const message = status === 409
        ? "You already have a pending Wave, or this Signal is no longer available."
        : status === 429
          ? "You’re waving too quickly. Please try again later."
          : "That Signal is no longer available.";
      teardown(message);
    }
  }

  async function handleWaveResponse(action: "accept" | "decline" | "ignore") {
    const wave = incomingWave;
    if (!wave || !isLeader) return;
    setSignalBusy(true);
    try {
      await respondToWave(sessionId, wave.id, action, sessionToken, tabId.current);
      setIncomingWave(null);
      if (action === "accept") {
        startPeer(wave.senderId, false);
        setConn({ kind: "connecting", peerId: wave.senderId });
      }
    } catch {
      setIncomingWave(null);
      showNotice("That Wave is no longer available.");
    } finally {
      setSignalBusy(false);
    }
  }

  async function publishMyActivity(category: ActivityCategory, message: string) {
    if (!isLeader) return;
    setSignalBusy(true);
    try {
      await publishActivity(sessionId, sessionToken, tabId.current, category, message);
      setSignalComposerOpen(false);
      showNotice("Your Signal is live on the map.");
    } catch {
      showNotice("Couldn’t publish your Signal. Please try again.");
    } finally {
      setSignalBusy(false);
    }
  }

  async function removeMyActivity() {
    if (!isLeader) return;
    setSignalBusy(true);
    try {
      await removeActivity(sessionId, sessionToken, tabId.current);
      setMyActivity(null);
      setSignalComposerOpen(false);
      showNotice("Your Signal was removed.");
    } catch {
      showNotice("Couldn’t remove your Signal. Please try again.");
    } finally {
      setSignalBusy(false);
    }
  }

  async function reportPeerSignal(activityId: string, reason: string) {
    try {
      await reportActivity(sessionId, activityId, reason, sessionToken, tabId.current);
      showNotice("Thanks. The Signal was reported.");
      return true;
    } catch {
      showNotice("Couldn’t send the report. Please try again.");
      return false;
    }
  }

  async function blockPeerSession(peerId: string) {
    try {
      await blockPeer(sessionId, peerId, sessionToken, tabId.current);
      if (connRef.current.kind !== "idle" && connRef.current.peerId === peerId) teardown("This person is blocked.");
      setPeers((current) => current.filter((peer) => peer.id !== peerId));
      showNotice("This person is blocked.");
      return true;
    } catch {
      showNotice("Couldn’t block this person. Please try again.");
      return false;
    }
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      if (pendingWaveIdRef.current) {
        const waveId = pendingWaveIdRef.current;
        pendingWaveIdRef.current = null;
        void respondToWave(sessionId, waveId, "cancel", sessionToken, tabId.current).catch(() => {});
      } else if (waveRequestInFlightRef.current) {
        waveCancelRequestedRef.current = true;
      } else {
        void emitSignal(connRef.current.peerId, "end");
      }
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void emitSignal(peerId, "accept");
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void emitSignal(connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void emitSignal(c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void emitSignal(sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          pendingWaveIdRef.current = null;
          waveRequestInFlightRef.current = false;
          waveCancelRequestedRef.current = false;
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
          showNotice("Wave accepted. Connecting…");
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (c.kind !== "idle" && c.peerId === sig.fromId) {
          if (c.kind === "incoming") {
            setConn({ kind: "idle" });
          } else {
            if (requestTimer.current) clearTimeout(requestTimer.current);
            teardown("Stranger disconnected.");
          }
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId, sessionToken, tabId.current);
        if (!active) return;
        setPollStatus("connected");
        setPeers(data.peers);
        setMyActivity(data.myActivity);
        setIsLeader(data.isLeader);
        setIncomingWave(data.isLeader
          ? (current) => data.waves.find((wave) => wave.id === current?.id) ?? data.waves[0] ?? null
          : null);
        if (data.isLeader) {
          for (const s of data.signals) processSignalRef.current(s);
        }
      } catch {
        if (active) setPollStatus("reconnecting");
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId, sessionToken]);

  useEffect(() => {
    const active = connRef.current;
    if (
      active.kind === "idle" ||
      peers.some((peer) => peer.id === active.peerId)
    ) {
      return;
    }

    if (requestTimer.current) {
      clearTimeout(requestTimer.current);
      requestTimer.current = null;
    }
    if (active.kind === "incoming") {
      setConn({ kind: "idle" });
      return;
    }
    if (active.kind === "connecting" || active.kind === "connected") {
      void emitSignal(active.peerId, "end");
    }
    teardown("Stranger disconnected.");
    // `peers` is polled; the current callbacks/refs are intentionally read when
    // it changes rather than restarting the polling effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => leave(sessionId, sessionToken, tabId.current);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
    };
  }, [sessionId, phase, sessionToken]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    const session = await joinOrResumeSession(lat, lng, tabId.current);
    setSessionId(session.id);
    setSessionToken(session.token);
    setIsLeader(session.isLeader);
    setPollStatus("connecting");
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const activePeerId =
    conn.kind === "connecting" || conn.kind === "connected" ? conn.peerId : null;

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={isLeader && conn.kind === "idle"}
        activePeerId={activePeerId}
        myActivity={myActivity}
        isLeader={isLeader}
        pollStatus={pollStatus}
        onSignalWave={createWave}
        onReportSignal={reportPeerSignal}
        onBlockPeer={blockPeerSession}
        onCreateActivity={() => setSignalComposerOpen(true)}
        onRemoveActivity={() => void removeMyActivity()}
        onLogout={() => void handleLogout()}
      />

      {notice && (
        <div className="pulse-toast" role="status" aria-live="polite">
          <span className="pulse-toast__paw"><PawIcon /></span>
          <span>{notice}</span>
        </div>
      )}

      {conn.kind === "requesting" && (
        <div className="request-status" role="status">
          <PawIcon className="request-status__paw" />
          <span>Requesting connection…</span>
          <Button
            variant="secondary"
            onClick={cancelRequest}
          >
            Cancel
          </Button>
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A new paw wants to say hello"
          subtitle="A stranger nearby would like to chat."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {incomingWave && conn.kind === "idle" && (
        <IncomingWavePrompt
          wave={incomingWave}
          busy={signalBusy}
          onAccept={() => void handleWaveResponse("accept")}
          onDecline={() => void handleWaveResponse("decline")}
          onIgnore={() => void handleWaveResponse("ignore")}
        />
      )}

      {signalComposerOpen && (
        <SignalComposer
          currentCategory={myActivity?.category}
          currentMessage={myActivity?.message}
          busy={signalBusy}
          onPublish={publishMyActivity}
          onRemove={() => void removeMyActivity()}
          onClose={() => setSignalComposerOpen(false)}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <div className="video-request-toast" role="status" aria-live="polite">
          <span className="video-request-toast__paw"><PawIcon /></span>
          <span>Waiting for them to accept video…</span>
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start a video call?"
          subtitle="Your camera and microphone turn on only after you accept."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
