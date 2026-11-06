import { join } from "@/lib/api";

const SESSION_KEY = "pulse.anonymous-session.v1";
const LOCK_KEY = "pulse.anonymous-session.lock";
const SESSION_LOGOUT_KEY = "pulse.anonymous-session.logout";
const SESSION_CHANNEL = "pulse-anonymous-session";

interface StoredSession {
  id: string;
  token: string;
  isLeader: boolean;
}

export async function joinOrResumeSession(lat: number, lng: number, tabId: string): Promise<StoredSession> {
  return withIdentityLock(tabId, async () => {
    let stored = readSession();
    if (!stored) {
      stored = { id: crypto.randomUUID(), token: "", isLeader: false };
      localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    }

    if (stored.token) {
      try {
        const result = await join(stored.id, lat, lng, tabId, stored.token);
        return saveSession(stored.id, result.token, result.isLeader);
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status === 401) {
          stored = { id: crypto.randomUUID(), token: "", isLeader: false };
          localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
        } else if (status !== 409) {
          throw error;
        }
      }
    }

    try {
      const result = await join(stored.id, lat, lng, tabId);
      return saveSession(stored.id, result.token, result.isLeader);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== 409) throw error;
      // A parallel first tab won the insert. Wait briefly for its bearer token
      // to appear in shared storage, then resume the same anonymous identity.
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const winner = readSession();
        if (winner?.id === stored.id && winner.token) {
          const result = await join(winner.id, lat, lng, tabId, winner.token);
          return saveSession(winner.id, result.token, result.isLeader);
        }
      }
      throw error;
    }
  });
}

export function announceSessionLogout(id: string) {
  try {
    const stored = readSession();
    if (stored?.id === id) localStorage.removeItem(SESSION_KEY);
  } catch {
    // Still notify open tabs if local storage is unavailable.
  }
  const message = { id, at: Date.now() };
  try {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.postMessage({ type: "logout", ...message });
    channel.close();
  } catch {
    // The storage event below covers browsers without BroadcastChannel.
  }
  try {
    localStorage.setItem(SESSION_LOGOUT_KEY, JSON.stringify(message));
  } catch {
    // Same-tab logout still completes if cross-tab storage is unavailable.
  }
}

export function onSessionLogout(callback: (id: string) => void) {
  const handleMessage = (value: unknown) => {
    if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") {
      callback(value.id);
    }
  };
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === "logout") {
        handleMessage(event.data);
      }
    });
  } catch {
    channel = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_LOGOUT_KEY || !event.newValue) return;
    try {
      handleMessage(JSON.parse(event.newValue) as unknown);
    } catch {
      // Ignore malformed cross-tab storage messages.
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

function readSession(): StoredSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    return typeof parsed.id === "string" && typeof parsed.token === "string"
      ? { id: parsed.id, token: parsed.token, isLeader: Boolean(parsed.isLeader) }
      : null;
  } catch {
    return null;
  }
}

function saveSession(id: string, token: string, isLeader: boolean): StoredSession {
  const value = { id, token, isLeader };
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  return value;
}

async function withIdentityLock<T>(tabId: string, operation: () => Promise<T>): Promise<T> {
  if (navigator.locks) {
    return navigator.locks.request("pulse-anonymous-session", { mode: "exclusive" }, operation);
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const now = Date.now();
    let lock: { owner: string; until: number } | null = null;
    try {
      const current = localStorage.getItem(LOCK_KEY);
      lock = current ? JSON.parse(current) as { owner: string; until: number } | null : null;
    } catch {
      lock = null;
    }
    if (!lock || lock.until < now || lock.owner === tabId) {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ owner: tabId, until: now + 20_000 }));
      const confirmed = localStorage.getItem(LOCK_KEY);
      if (confirmed && (JSON.parse(confirmed) as { owner: string }).owner === tabId) {
        try {
          return await operation();
        } finally {
          try {
            const current = JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null") as { owner?: string } | null;
            if (current?.owner === tabId) localStorage.removeItem(LOCK_KEY);
          } catch {}
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Could not initialize Pulse session.");
}
