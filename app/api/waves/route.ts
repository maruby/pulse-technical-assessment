import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isActiveSessionTab, isSessionOwner } from "@/lib/session-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-json";
import { STALE_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) return Response.json({ error: "invalid body" }, { status: parsed.status });
  const body = (parsed.value ?? {}) as { id?: unknown; signalId?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const signalId = typeof body.signalId === "string" ? body.signalId : "";
  const tabId = request.headers.get("x-session-tab") ?? "";

  if (id.length < 8 || id.length > 64 || signalId.length < 8 || signalId.length > 64) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isActiveSessionTab(id, tabId, true))) {
    return Response.json({ error: "inactive session tab" }, { status: 409 });
  }

  const cutoff = new Date(Date.now() - STALE_MS);
  const [sender, activity] = await Promise.all([
    prisma.presence.findUnique({
      where: { id },
      select: { busy: true, pendingFrom: true, disconnectedAt: true },
    }),
    prisma.activitySignal.findFirst({
      where: {
        id: signalId,
        isActive: true,
        owner: {
          is: {
            disconnectedAt: null,
            lastSeen: { gte: cutoff },
            tabs: { some: { releasedAt: null, lastSeen: { gte: cutoff } } },
          },
        },
      },
      select: { id: true, ownerId: true },
    }),
  ]);
  if (!sender || sender.disconnectedAt || !activity) {
    return Response.json({ error: "signal unavailable" }, { status: 404 });
  }
  if (activity.ownerId === id) return Response.json({ error: "cannot wave to yourself" }, { status: 400 });
  if (sender.busy || sender.pendingFrom) return Response.json({ error: "session unavailable" }, { status: 409 });

  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: id, blockedId: activity.ownerId },
        { blockerId: activity.ownerId, blockedId: id },
      ],
    },
    select: { blockerId: true },
  });
  if (blocked) return Response.json({ error: "signal unavailable" }, { status: 404 });

  const cooldown = await prisma.waveRequest.findFirst({
    where: {
      senderId: id,
      recipientId: activity.ownerId,
      status: { in: ["DECLINED", "IGNORED"] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    select: { id: true },
  });
  if (cooldown) return Response.json({ error: "signal unavailable" }, { status: 409 });

  const minuteLimit = await consumeRateLimit(id, "connection-request-minute", 5, 60_000);
  const hourLimit = await consumeRateLimit(id, "connection-request-hour", 20, 60 * 60_000);
  if (!minuteLimit || !hourLimit) {
    return Response.json({ error: "wave rate limit exceeded" }, { status: 429 });
  }

  const reservation = await prisma.presence.updateMany({
    where: {
      id: activity.ownerId,
      busy: false,
      pendingFrom: null,
      disconnectedAt: null,
      lastSeen: { gte: cutoff },
      tabs: { some: { releasedAt: null, lastSeen: { gte: cutoff } } },
    },
    data: { pendingFrom: id, pendingAt: new Date() },
  });
  if (reservation.count !== 1) return Response.json({ error: "signal unavailable" }, { status: 409 });

  try {
    const wave = await prisma.waveRequest.create({
      data: { senderId: id, recipientId: activity.ownerId, signalId: activity.id },
      select: { id: true },
    });
    return Response.json({ ok: true, waveId: wave.id }, { status: 201 });
  } catch (error) {
    await prisma.presence.updateMany({
      where: { id: activity.ownerId, pendingFrom: id },
      data: { pendingFrom: null, pendingAt: null },
    });
    throw error;
  }
}
