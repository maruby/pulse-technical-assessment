import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { acceptPendingConnection, clearPendingConnection } from "@/lib/connection-state";
import { isActiveSessionTab, isSessionOwner } from "@/lib/session-auth";
import { readJsonBody } from "@/lib/request-json";
import { STALE_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaveAction = "accept" | "decline" | "ignore" | "cancel";

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) return Response.json({ error: "invalid body" }, { status: parsed.status });
  const body = (parsed.value ?? {}) as { id?: unknown; waveId?: unknown; action?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const waveId = typeof body.waveId === "string" ? body.waveId : "";
  const action = body.action as WaveAction;
  const tabId = request.headers.get("x-session-tab") ?? "";

  if (id.length < 8 || id.length > 64 || waveId.length < 8 || waveId.length > 64 || !["accept", "decline", "ignore", "cancel"].includes(action)) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isActiveSessionTab(id, tabId, true))) {
    return Response.json({ error: "inactive session tab" }, { status: 409 });
  }

  if (action === "cancel") {
    const wave = await prisma.waveRequest.findFirst({
      where: { id: waveId, senderId: id, status: "PENDING" },
      select: { id: true, senderId: true, recipientId: true },
    });
    if (!wave) return Response.json({ error: "wave unavailable" }, { status: 404 });
    const cancelled = await prisma.waveRequest.updateMany({
      where: { id: wave.id, senderId: id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (cancelled.count === 1) await clearPendingConnection(wave.recipientId, id);
    return Response.json({ ok: true });
  }

  const wave = await prisma.waveRequest.findFirst({
    where: { id: waveId, recipientId: id, status: "PENDING" },
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      signalId: true,
      activity: { select: { isActive: true } },
    },
  });
  if (!wave) return Response.json({ error: "wave unavailable" }, { status: 404 });
  if (action !== "ignore" && !wave.activity?.isActive) {
    await prisma.waveRequest.updateMany({ where: { id: wave.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    await clearPendingConnection(id, wave.senderId);
    return Response.json({ error: "signal unavailable" }, { status: 409 });
  }

  if (action === "decline" || action === "ignore") {
    const status = action === "decline" ? "DECLINED" : "IGNORED";
    const changed = await prisma.waveRequest.updateMany({
      where: { id: wave.id, recipientId: id, status: "PENDING" },
      data: { status },
    });
    if (changed.count !== 1) return Response.json({ error: "wave already handled" }, { status: 409 });
    await clearPendingConnection(id, wave.senderId);
    return Response.json({ ok: true });
  }

  const claimed = await prisma.waveRequest.updateMany({
    where: { id: wave.id, recipientId: id, status: "PENDING" },
    data: { status: "ACCEPTING" },
  });
  if (claimed.count !== 1) return Response.json({ error: "wave already handled" }, { status: 409 });

  const cutoff = new Date(Date.now() - STALE_MS);
  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: id, blockedId: wave.senderId },
        { blockerId: wave.senderId, blockedId: id },
      ],
    },
    select: { blockerId: true },
  });
  const requester = await prisma.presence.findFirst({
    where: {
      id: wave.senderId,
      disconnectedAt: null,
      lastSeen: { gte: cutoff },
      tabs: { some: { releasedAt: null, lastSeen: { gte: cutoff } } },
    },
    select: { id: true },
  });
  const accepted = !blocked && requester && await acceptPendingConnection(id, wave.senderId);
  if (!accepted) {
    await prisma.waveRequest.updateMany({ where: { id: wave.id, status: "ACCEPTING" }, data: { status: "EXPIRED" } });
    await clearPendingConnection(id, wave.senderId);
    return Response.json({ error: "request unavailable" }, { status: 409 });
  }

  await prisma.waveRequest.updateMany({ where: { id: wave.id, status: "ACCEPTING" }, data: { status: "ACCEPTED" } });
  await prisma.signal.create({
    data: { fromId: id, toId: wave.senderId, type: "accept", payload: null },
  });
  return Response.json({ ok: true, peerId: wave.senderId });
}
