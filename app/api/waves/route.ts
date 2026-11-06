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

  const activity = await prisma.activitySignal.findFirst({
    where: {
      id: signalId,
      isActive: true,
      owner: { is: { disconnectedAt: null } },
    },
    select: { id: true, ownerId: true },
  });
  if (!activity) {
    return Response.json({ error: "signal unavailable" }, { status: 404 });
  }
  if (activity.ownerId === id) return Response.json({ error: "cannot wave to yourself" }, { status: 400 });

  const minuteLimit = await consumeRateLimit(id, "connection-request-minute", 5, 60_000);
  const hourLimit = await consumeRateLimit(id, "connection-request-hour", 20, 60 * 60_000);
  if (!minuteLimit || !hourLimit) {
    return Response.json({ error: "wave rate limit exceeded" }, { status: 429 });
  }

  // Serialize Waves from the same session (and competing Waves to the same
  // recipient). Checking and creating inside this lock prevents parallel tabs
  // or direct API callers from leaving multiple pending outgoing requests.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Presence"
      WHERE "id" = ${id} OR "id" = ${activity.ownerId}
      ORDER BY "id"
      FOR UPDATE
    `;
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ActivitySignal" WHERE "id" = ${signalId} FOR UPDATE
    `;

    const cutoff = new Date(Date.now() - STALE_MS);
    const [sender, recipient, currentActivity] = await Promise.all([
      tx.presence.findUnique({
        where: { id },
        select: {
          busy: true,
          pendingFrom: true,
          disconnectedAt: true,
          lastSeen: true,
          tabs: { where: { releasedAt: null, lastSeen: { gte: cutoff } }, take: 1, select: { id: true } },
        },
      }),
      tx.presence.findUnique({
        where: { id: activity.ownerId },
        select: {
          busy: true,
          pendingFrom: true,
          disconnectedAt: true,
          lastSeen: true,
          tabs: { where: { releasedAt: null, lastSeen: { gte: cutoff } }, take: 1, select: { id: true } },
        },
      }),
      tx.activitySignal.findUnique({ where: { id: signalId }, select: { ownerId: true, isActive: true } }),
    ]);

    if (
      !sender || sender.disconnectedAt || sender.lastSeen < cutoff || !sender.tabs.length ||
      !recipient || recipient.disconnectedAt || recipient.lastSeen < cutoff || !recipient.tabs.length ||
      !currentActivity?.isActive || currentActivity.ownerId !== activity.ownerId
    ) return { kind: "unavailable" as const };
    if (sender.busy || sender.pendingFrom || recipient.busy || recipient.pendingFrom) {
      return { kind: "session-unavailable" as const };
    }

    const pendingOutgoing = await tx.waveRequest.findFirst({
      where: { senderId: id, status: { in: ["PENDING", "ACCEPTING"] } },
      select: { id: true },
    });
    if (pendingOutgoing) return { kind: "duplicate" as const };

    const [blocked, cooldown] = await Promise.all([
      tx.block.findFirst({
        where: {
          OR: [
            { blockerId: id, blockedId: activity.ownerId },
            { blockerId: activity.ownerId, blockedId: id },
          ],
        },
        select: { blockerId: true },
      }),
      tx.waveRequest.findFirst({
        where: {
          senderId: id,
          recipientId: activity.ownerId,
          status: { in: ["DECLINED", "IGNORED"] },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
        select: { id: true },
      }),
    ]);
    if (blocked) return { kind: "unavailable" as const };
    if (cooldown) return { kind: "cooldown" as const };

    const reservation = await tx.presence.updateMany({
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
    if (reservation.count !== 1) return { kind: "unavailable" as const };

    const wave = await tx.waveRequest.create({
      data: { senderId: id, recipientId: activity.ownerId, signalId: activity.id },
      select: { id: true },
    });
    return { kind: "created" as const, waveId: wave.id };
  });

  if (outcome.kind === "duplicate") {
    return Response.json({ error: "wave already pending" }, { status: 409 });
  }
  if (outcome.kind === "session-unavailable") {
    return Response.json({ error: "session unavailable" }, { status: 409 });
  }
  if (outcome.kind === "cooldown") {
    return Response.json({ error: "signal unavailable" }, { status: 409 });
  }
  if (outcome.kind === "unavailable") {
    return Response.json({ error: "signal unavailable" }, { status: 409 });
  }
  return Response.json({ ok: true, waveId: outcome.waveId }, { status: 201 });
}
