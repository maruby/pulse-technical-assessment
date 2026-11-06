// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types";

export async function join(
  id: string,
  lat: number,
  lng: number,
  tabId: string,
  token?: string,
): Promise<{ token: string; isLeader: boolean }> {
  const response = await fetch("/api/join", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: JSON.stringify({ id, lat, lng, tabId }),
  });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "session expired" : `join failed: ${response.status}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  const data = (await response.json()) as { token: string; isLeader: boolean };
  return data;
}

export async function poll(id: string, token: string, tabId: string): Promise<PollResponse> {
  const res = await fetch(`/api/poll?id=${encodeURIComponent(id)}&tabId=${encodeURIComponent(tabId)}`, {
    cache: "no-store",
    headers: { "X-Session-Token": token },
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  fromId: string,
  toId: string,
  type: SignalType,
  token: string,
  payload?: string,
  tabId?: string,
): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    // Bearer credential is not included in URLs or exposed to other peers.
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": token,
      ...(tabId ? { "X-Session-Tab": tabId } : {}),
    },
    body: JSON.stringify({ fromId, toId, type, payload }),
  });
}

function sessionHeaders(token: string, tabId: string) {
  return {
    "Content-Type": "application/json",
    "X-Session-Token": token,
    "X-Session-Tab": tabId,
  };
}

async function postSessionJson<T>(path: string, id: string, token: string, tabId: string, body: Record<string, unknown>, method = "POST"): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: sessionHeaders(token, tabId),
    body: JSON.stringify({ id, ...body }),
  });
  if (!response.ok) {
    const error = new Error(`${path} failed: ${response.status}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export async function publishActivity(
  id: string,
  token: string,
  tabId: string,
  category: string,
  message: string,
) {
  return postSessionJson<{ ok: true }>("/api/pulse-signal", id, token, tabId, { category, message });
}

export async function removeActivity(id: string, token: string, tabId: string) {
  return postSessionJson<{ ok: true }>("/api/pulse-signal", id, token, tabId, {}, "DELETE");
}

export async function sendWave(id: string, signalId: string, token: string, tabId: string) {
  return postSessionJson<{ ok: true; waveId: string }>("/api/waves", id, token, tabId, { signalId });
}

export async function respondToWave(
  id: string,
  waveId: string,
  action: "accept" | "decline" | "ignore" | "cancel",
  token: string,
  tabId: string,
) {
  return postSessionJson<{ ok: true; peerId?: string }>("/api/waves/respond", id, token, tabId, { waveId, action });
}

export async function reportActivity(
  id: string,
  signalId: string,
  reason: string,
  token: string,
  tabId: string,
) {
  return postSessionJson<{ ok: true }>("/api/reports", id, token, tabId, { signalId, reason });
}

export async function blockPeer(id: string, targetId: string, token: string, tabId: string) {
  return postSessionJson<{ ok: true }>("/api/blocks", id, token, tabId, { targetId });
}

export async function unblockPeer(id: string, targetId: string, token: string, tabId: string) {
  return postSessionJson<{ ok: true }>("/api/blocks", id, token, tabId, { targetId }, "DELETE");
}

// Fire-and-forget leave that survives the tab closing.
export function leave(id: string, token: string, tabId: string): void {
  const body = JSON.stringify({ id, token, tabId });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}

export async function logout(id: string, token: string): Promise<void> {
  const response = await fetch("/api/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Token": token },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(`logout failed: ${response.status}`);
}
