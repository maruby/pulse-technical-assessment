import type { NextRequest } from "next/server";
import { ACTIVITY_CATEGORIES } from "@/lib/types";
import { prisma } from "@/lib/prisma";
import { isActiveSessionTab, isSessionOwner } from "@/lib/session-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 120;

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 4 * 1024);
  if (!parsed.ok) return Response.json({ error: "invalid body" }, { status: parsed.status });
  const body = (parsed.value ?? {}) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const tabId = request.headers.get("x-session-tab") ?? "";
  const category = body.category;
  const rawMessage = body.message;

  if (id.length < 8 || id.length > 64) return Response.json({ error: "invalid session" }, { status: 400 });
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isActiveSessionTab(id, tabId, true))) {
    return Response.json({ error: "inactive session tab" }, { status: 409 });
  }
  if (typeof category !== "string" || !ACTIVITY_CATEGORIES.includes(category as (typeof ACTIVITY_CATEGORIES)[number])) {
    return Response.json({ error: "invalid category" }, { status: 400 });
  }
  if (rawMessage !== undefined && rawMessage !== null && typeof rawMessage !== "string") {
    return Response.json({ error: "invalid message" }, { status: 400 });
  }
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (message.length > MAX_MESSAGE_LENGTH) return Response.json({ error: "message too long" }, { status: 400 });

  const allowed = await consumeRateLimit(id, "activity-publish", 6, 60 * 60_000);
  if (!allowed) return Response.json({ error: "signal rate limit exceeded" }, { status: 429 });

  const presence = await prisma.presence.findUnique({
    where: { id },
    select: { lat: true, lng: true, disconnectedAt: true },
  });
  if (!presence || presence.disconnectedAt) {
    return Response.json({ error: "session unavailable" }, { status: 409 });
  }

  const activity = await prisma.activitySignal.upsert({
    where: { ownerId: id },
    create: { ownerId: id, category, message: message || null },
    update: { category, message: message || null, isActive: true },
    select: { id: true, category: true, message: true },
  });
  return Response.json({
    ok: true,
    activity: { ...activity, category: activity.category, lat: presence.lat, lng: presence.lng },
  });
}

export async function DELETE(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) return Response.json({ error: "invalid body" }, { status: parsed.status });
  const body = (parsed.value ?? {}) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const tabId = request.headers.get("x-session-tab") ?? "";
  if (id.length < 8 || id.length > 64) return Response.json({ error: "invalid session" }, { status: 400 });
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isActiveSessionTab(id, tabId, true))) {
    return Response.json({ error: "inactive session tab" }, { status: 409 });
  }

  const activity = await prisma.activitySignal.findUnique({ where: { ownerId: id }, select: { id: true } });
  if (activity) {
    const pending = await prisma.waveRequest.findMany({
      where: { signalId: activity.id, status: "PENDING" },
      select: { id: true, senderId: true, recipientId: true },
    });
    for (const wave of pending) {
      await prisma.waveRequest.updateMany({ where: { id: wave.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      await prisma.presence.updateMany({
        where: { id: wave.recipientId, pendingFrom: wave.senderId },
        data: { pendingFrom: null, pendingAt: null },
      });
    }
    await prisma.activitySignal.delete({ where: { id: activity.id } });
  }
  return Response.json({ ok: true });
}
