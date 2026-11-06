import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearPendingConnection } from "@/lib/connection-state";
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

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Presence"
      WHERE "id" = ${id} OR "id" = ${wave.senderId}
      ORDER BY "id"
      FOR UPDATE
    `;
    const current = await tx.waveRequest.findFirst({
      where: { id: wave.id, recipientId: id, status: "PENDING" },
      select: { id: true, senderId: true, signalId: true },
    });
    if (!current) return false;

    const cutoff = new Date(Date.now() - STALE_MS);
    const [blocked, requester, activity] = await Promise.all([
      tx.block.findFirst({
        where: {
          OR: [
            { blockerId: id, blockedId: current.senderId },
            { blockerId: current.senderId, blockedId: id },
          ],
        },
        select: { blockerId: true },
      }),
      tx.presence.findFirst({
        where: {
          id: current.senderId,
          disconnectedAt: null,
          lastSeen: { gte: cutoff },
          tabs: { some: { releasedAt: null, lastSeen: { gte: cutoff } } },
        },
        select: { id: true, busy: true, connectedTo: true, pendingFrom: true },
      }),
      current.signalId
        ? tx.activitySignal.findFirst({ where: { id: current.signalId, isActive: true }, select: { id: true } })
        : null,
    ]);
    if (blocked || !requester || requester.busy || requester.connectedTo || requester.pendingFrom || !activity) {
      await tx.waveRequest.updateMany({ where: { id: current.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      await tx.presence.updateMany({ where: { id, pendingFrom: current.senderId }, data: { pendingFrom: null, pendingAt: null } });
      return false;
    }

    const recipient = await tx.presence.findUnique({ where: { id }, select: { busy: true, pendingFrom: true } });
    if (!recipient || recipient.busy || recipient.pendingFrom !== current.senderId) {
      await tx.waveRequest.updateMany({ where: { id: current.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      await tx.presence.updateMany({ where: { id, pendingFrom: current.senderId }, data: { pendingFrom: null, pendingAt: null } });
      return false;
    }
    const claim = await tx.waveRequest.updateMany({
      where: { id: current.id, recipientId: id, status: "PENDING" },
      data: { status: "ACCEPTING" },
    });
    if (claim.count !== 1) return false;

    const acceptRecipient = await tx.presence.updateMany({
      where: { id, pendingFrom: current.senderId, busy: false },
      data: { pendingFrom: null, pendingAt: null, connectedTo: current.senderId, busy: true },
    });
    const acceptSender = acceptRecipient.count === 1 && await tx.presence.updateMany({
      where: { id: current.senderId, busy: false, connectedTo: null, pendingFrom: null },
      data: { connectedTo: id, busy: true },
    });
    if (!acceptSender || acceptSender.count !== 1) {
      await tx.presence.updateMany({ where: { id, connectedTo: current.senderId }, data: { connectedTo: null, busy: false } });
      await tx.waveRequest.updateMany({ where: { id: current.id, status: "ACCEPTING" }, data: { status: "EXPIRED" } });
      return false;
    }
    await tx.waveRequest.updateMany({ where: { id: current.id, status: "ACCEPTING" }, data: { status: "ACCEPTED" } });
    await tx.signal.create({ data: { fromId: id, toId: current.senderId, type: "accept", payload: null } });
    return true;
  });
  if (!outcome) return Response.json({ error: "request unavailable" }, { status: 409 });
  return Response.json({ ok: true, peerId: wave.senderId });
}
