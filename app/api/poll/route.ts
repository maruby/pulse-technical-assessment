import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  RECONNECT_GRACE_MS,
  REPORT_RETENTION_MS,
  SIGNAL_TTL_MS,
  STALE_MS,
  WAVE_RETENTION_MS,
} from "@/lib/presence";
import type { ActivityCategory, PollResponse } from "@/lib/types";
import { isSessionOwner, touchSessionTab } from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polling remains the real-time transport. Only the elected tab drains the
// shared signaling mailbox and receives actionable Wave notifications.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  const tabId = params.get("tabId");

  if (!id || id.length > 64 || !tabId || tabId.length > 64) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const isLeader = await touchSessionTab(id, tabId);
  if (!isLeader && !(await prisma.presenceTab.findFirst({ where: { id: tabId, presenceId: id, releasedAt: null } }))) {
    return Response.json({ error: "inactive tab" }, { status: 409 });
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);
  const disconnectedCutoff = new Date(now - RECONNECT_GRACE_MS);

  // Detect crashed tabs from server-observed heartbeats; browser unload is only
  // a faster hint and is never the sole lifecycle mechanism.
  await prisma.presence.updateMany({
    where: {
      disconnectedAt: null,
      tabs: { none: { releasedAt: null, lastSeen: { gte: staleCutoff } } },
    },
    data: { disconnectedAt: new Date(now), leaderTabId: null },
  });

  await prisma.presence.updateMany({
    where: { pendingAt: { lt: signalCutoff } },
    data: { pendingFrom: null, pendingAt: null },
  });
  await prisma.waveRequest.updateMany({
    where: { status: { in: ["PENDING", "ACCEPTING"] }, createdAt: { lt: signalCutoff } },
    data: { status: "EXPIRED" },
  });

  const expired = await prisma.presence.findMany({
    where: { disconnectedAt: { lt: disconnectedCutoff } },
    select: { id: true },
  });
  if (expired.length > 0) {
    const expiredIds = expired.map((session) => session.id);
    await prisma.signal.deleteMany({ where: { OR: [{ toId: { in: expiredIds } }, { fromId: { in: expiredIds } }] } });
    await prisma.presence.deleteMany({ where: { id: { in: expiredIds } } });
  }

  await prisma.presenceTab.deleteMany({ where: { lastSeen: { lt: new Date(now - 24 * 60 * 60 * 1000) } } });
  await prisma.waveRequest.deleteMany({ where: { createdAt: { lt: new Date(now - WAVE_RETENTION_MS) } } });
  await prisma.signalReport.deleteMany({ where: { createdAt: { lt: new Date(now - REPORT_RETENTION_MS) } } });
  await prisma.rateLimitBucket.deleteMany({ where: { bucketAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } } });
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: id }, { blockedId: id }] },
    select: { blockerId: true, blockedId: true },
  });
  const hiddenIds = new Set(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
  hiddenIds.delete(id);

  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id, ...(hiddenIds.size > 0 ? { notIn: [...hiddenIds] } : {}) },
      lastSeen: { gte: staleCutoff },
      disconnectedAt: null,
      tabs: { some: { releasedAt: null, lastSeen: { gte: staleCutoff } } },
    },
    select: {
      id: true,
      lat: true,
      lng: true,
      busy: true,
      activity: { select: { id: true, category: true, message: true, isActive: true } },
    },
  });

  const myActivityRow = await prisma.activitySignal.findFirst({
    where: { ownerId: id, isActive: true },
    select: { id: true, category: true, message: true, owner: { select: { lat: true, lng: true } } },
  });

  // Other tabs still render discovery state; only the leader consumes events.
  const inbox = isLeader
    ? await prisma.signal.findMany({ where: { toId: id }, orderBy: { createdAt: "asc" } })
    : [];
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({ where: { id: { in: inbox.map((signal) => signal.id) } } });
  }

  const incomingWaves = isLeader
    ? await prisma.waveRequest.findMany({
        where: {
          recipientId: id,
          status: "PENDING",
          createdAt: { gte: signalCutoff },
          activity: { is: { isActive: true } },
          sender: { is: {
            disconnectedAt: null,
            lastSeen: { gte: staleCutoff },
            tabs: { some: { releasedAt: null, lastSeen: { gte: staleCutoff } } },
          } },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, senderId: true, createdAt: true, activity: { select: { category: true, message: true } } },
      })
    : [];

  const response: PollResponse = {
    peers: peers.map((peer) => ({
      id: peer.id,
      lat: peer.lat,
      lng: peer.lng,
      busy: peer.busy,
      activity: peer.activity?.isActive
        ? { id: peer.activity.id, category: peer.activity.category as ActivityCategory, message: peer.activity.message }
        : null,
    })),
    signals: inbox.map((signal) => ({
      id: signal.id,
      fromId: signal.fromId,
      toId: signal.toId,
      type: signal.type as PollResponse["signals"][number]["type"],
      payload: signal.payload,
      createdAt: signal.createdAt.toISOString(),
    })),
    myActivity: myActivityRow
      ? { id: myActivityRow.id, category: myActivityRow.category as ActivityCategory, message: myActivityRow.message, lat: myActivityRow.owner.lat, lng: myActivityRow.owner.lng }
      : null,
    waves: incomingWaves.flatMap((wave) => wave.activity ? [{
      id: wave.id,
      senderId: wave.senderId,
      category: wave.activity.category as PollResponse["waves"][number]["category"],
      message: wave.activity.message,
      createdAt: wave.createdAt.toISOString(),
    }] : []),
    isLeader,
  };

  return Response.json(response, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
