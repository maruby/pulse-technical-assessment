import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { isActiveSessionTab, isSessionOwner } from "@/lib/session-auth";
import { readJsonBody } from "@/lib/request-json";
import { consumeRateLimit } from "@/lib/rate-limit";
import { acceptPendingConnection } from "@/lib/connection-state";
import { STALE_MS } from "@/lib/presence";

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
const MAX_BODY_BYTES = MAX_PAYLOAD + 4 * 1024;

// POST /api/signal — sender must own the session and follow its persisted
// pending/active connection state before signaling the peer.
export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return Response.json({ error: "invalid body" }, { status: parsed.status });
  }
  const body = parsed.value;

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
  const tabId = request.headers.get("x-session-tab");
  if (!tabId || !(await isActiveSessionTab(fromId, tabId, true))) {
    return Response.json({ error: "inactive session tab" }, { status: 409 });
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
  const cutoff = new Date(Date.now() - STALE_MS);
  const [sender, recipient] = await Promise.all([
    prisma.presence.findUnique({
      where: { id: fromId },
      select: { id: true, busy: true, pendingFrom: true, connectedTo: true, disconnectedAt: true, lastSeen: true, tabs: { where: { releasedAt: null, lastSeen: { gte: cutoff } }, take: 1, select: { id: true } } },
    }),
    prisma.presence.findUnique({
      where: { id: toId },
      select: { id: true, busy: true, pendingFrom: true, connectedTo: true, disconnectedAt: true, lastSeen: true, tabs: { where: { releasedAt: null, lastSeen: { gte: cutoff } }, take: 1, select: { id: true } } },
    }),
  ]);
  if (
    !sender || !recipient || sender.disconnectedAt || recipient.disconnectedAt ||
    sender.lastSeen < cutoff || recipient.lastSeen < cutoff || !recipient.tabs.length
  ) {
    return Response.json({ error: "peer offline" }, { status: 404 });
  }

  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: fromId, blockedId: toId },
        { blockerId: toId, blockedId: fromId },
      ],
    },
    select: { blockerId: true },
  });
  if (blocked) return Response.json({ error: "peer unavailable" }, { status: 403 });

  if (signalType === "request") {
    const cooldown = await prisma.waveRequest.findFirst({
      where: {
        senderId: fromId,
        recipientId: toId,
        status: { in: ["DECLINED", "IGNORED"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      select: { id: true },
    });
    if (cooldown) return Response.json({ error: "peer unavailable" }, { status: 409 });
    const withinMinute = await consumeRateLimit(fromId, "connection-request-minute", 5, 60_000);
    const withinHour = await consumeRateLimit(fromId, "connection-request-hour", 20, 60 * 60_000);
    if (!withinMinute || !withinHour) {
      return Response.json({ error: "request rate limit exceeded" }, { status: 429 });
    }
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
    try {
      await prisma.waveRequest.create({ data: { senderId: fromId, recipientId: toId } });
    } catch (error) {
      await prisma.presence.updateMany({ where: { id: toId, pendingFrom: fromId }, data: { pendingFrom: null, pendingAt: null } });
      throw error;
    }
  } else if (signalType === "accept") {
    if (sender.pendingFrom !== toId || sender.busy || recipient.busy) {
      return Response.json({ error: "no matching pending request" }, { status: 409 });
    }
    const accepted = await acceptPendingConnection(fromId, toId);
    if (!accepted) return Response.json({ error: "peer is no longer available" }, { status: 409 });
    await prisma.waveRequest.updateMany({
      where: { senderId: toId, recipientId: fromId, signalId: null, status: "PENDING" },
      data: { status: "ACCEPTED" },
    });
  } else if (signalType === "decline") {
    if (sender.pendingFrom !== toId) {
      return Response.json({ error: "no matching pending request" }, { status: 403 });
    }
    await prisma.presence.updateMany({
      where: { id: fromId, pendingFrom: toId },
      data: { pendingFrom: null, pendingAt: null },
    });
    await prisma.waveRequest.updateMany({
      where: { senderId: toId, recipientId: fromId, signalId: null, status: "PENDING" },
      data: { status: "DECLINED" },
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
      await prisma.waveRequest.updateMany({
        where: { senderId: fromId, recipientId: toId, signalId: null, status: "PENDING" },
        data: { status: "EXPIRED" },
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
