import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { isSessionOwner } from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024;

// POST /api/signal — sender must own the session and follow its persisted
// pending/active connection state before signaling the peer.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { fromId, toId, type, payload } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof fromId !== "string" ||
    typeof toId !== "string" ||
    fromId.length > 64 ||
    toId.length > 64 ||
    fromId === toId
  ) {
    return Response.json({ error: "invalid ids" }, { status: 400 });
  }
  if (!(await isSessionOwner(fromId, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;
  const [sender, recipient] = await Promise.all([
    prisma.presence.findUnique({
      where: { id: fromId },
      select: { id: true, busy: true, pendingFrom: true, connectedTo: true },
    }),
    prisma.presence.findUnique({
      where: { id: toId },
      select: { id: true, busy: true, pendingFrom: true, connectedTo: true },
    }),
  ]);
  if (!sender || !recipient) {
    return Response.json({ error: "peer offline" }, { status: 404 });
  }

  if (signalType === "request") {
    if (sender.busy || sender.pendingFrom || recipient.busy || recipient.pendingFrom) {
      return Response.json({ error: "peer busy" }, { status: 409 });
    }
    const reserved = await prisma.presence.updateMany({
      where: { id: toId, busy: false, pendingFrom: null },
      data: { pendingFrom: fromId, pendingAt: new Date() },
    });
    if (reserved.count !== 1) {
      return Response.json({ error: "peer busy" }, { status: 409 });
    }
  } else if (signalType === "accept") {
    if (sender.pendingFrom !== toId || sender.busy || recipient.busy) {
      return Response.json({ error: "no matching pending request" }, { status: 409 });
    }
    const accepted = await prisma.presence.updateMany({
      where: { id: fromId, pendingFrom: toId, busy: false },
      data: { pendingFrom: null, pendingAt: null, connectedTo: toId, busy: true },
    });
    if (accepted.count !== 1) {
      return Response.json({ error: "request expired" }, { status: 409 });
    }
    const paired = await prisma.presence.updateMany({
      where: { id: toId, busy: false, connectedTo: null },
      data: { connectedTo: fromId, busy: true },
    });
    if (paired.count !== 1) {
      await prisma.presence.updateMany({
        where: { id: fromId, connectedTo: toId },
        data: { connectedTo: null, busy: false },
      });
      return Response.json({ error: "peer is no longer available" }, { status: 409 });
    }
  } else if (signalType === "decline") {
    if (sender.pendingFrom !== toId) {
      return Response.json({ error: "no matching pending request" }, { status: 403 });
    }
    await prisma.presence.updateMany({
      where: { id: fromId, pendingFrom: toId },
      data: { pendingFrom: null, pendingAt: null },
    });
  } else if (signalType === "end") {
    const activePair = sender.connectedTo === toId && recipient.connectedTo === fromId;
    const pendingPair = recipient.pendingFrom === fromId;
    if (!activePair && !pendingPair) {
      return Response.json({ error: "no matching connection" }, { status: 403 });
    }
    if (activePair) {
      await prisma.presence.updateMany({
        where: { id: { in: [fromId, toId] }, connectedTo: { not: null } },
        data: { connectedTo: null, busy: false },
      });
    } else {
      await prisma.presence.updateMany({
        where: { id: toId, pendingFrom: fromId },
        data: { pendingFrom: null, pendingAt: null },
      });
    }
  } else if (sender.connectedTo !== toId || recipient.connectedTo !== fromId) {
    return Response.json({ error: "no active connection" }, { status: 403 });
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });
  return Response.json({ ok: true });
}
