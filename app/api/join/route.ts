import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { createSessionToken, isSessionOwner, registerSessionTab } from "@/lib/session-auth";
import { STALE_MS, RECONNECT_GRACE_MS } from "@/lib/presence";
import { readJsonBody } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { id, lat, lng } (raw coords).
// Applies a 1–3 km privacy offset and creates a presence row. Raw
// coordinates are never stored.
export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) {
    return Response.json({ error: "invalid body" }, { status: parsed.status });
  }
  const body = parsed.value;

  const { id, lat, lng, tabId } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || id.length < 8 || id.length > 64) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }
  if (typeof tabId !== "string" || tabId.length < 16 || tabId.length > 64) {
    return Response.json({ error: "invalid tab id" }, { status: 400 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);
  const suppliedToken = request.headers.get("x-session-token");
  const owned = suppliedToken ? await isSessionOwner(id, suppliedToken) : false;

  if (owned) {
    const existing = await prisma.presence.findUnique({
      where: { id },
      select: { lastSeen: true, disconnectedAt: true },
    });
    if (existing) {
      const now = Date.now();
      const stale = existing.lastSeen.getTime() < now - STALE_MS;
      const graceEnded = existing.disconnectedAt !== null &&
        existing.disconnectedAt.getTime() < now - RECONNECT_GRACE_MS;
      if (stale || graceEnded) {
        await prisma.signal.deleteMany({ where: { OR: [{ fromId: id }, { toId: id }] } });
        await prisma.presence.delete({ where: { id } });
      } else {
        const registered = await registerSessionTab(id, tabId);
        if (!registered) {
          return Response.json({ error: "tab already belongs to another session" }, { status: 409 });
        }
        await prisma.presence.update({
          where: { id },
          data: { lat: offset.lat, lng: offset.lng, lastSeen: new Date(), disconnectedAt: null },
        });
        const current = await prisma.presence.findUnique({ where: { id }, select: { leaderTabId: true } });
        return Response.json({ ok: true, token: suppliedToken, resumed: true, isLeader: current?.leaderTabId === tabId });
      }
    }
  } else {
    const existing = await prisma.presence.findUnique({ where: { id }, select: { id: true } });
    if (existing) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { token, tokenHash } = createSessionToken();

  try {
    await prisma.presence.create({
      data: {
        id,
        tokenHash,
        leaderTabId: tabId,
        lat: offset.lat,
        lng: offset.lng,
        busy: false,
        lastSeen: new Date(),
      },
    });
    await prisma.presenceTab.create({
      data: { id: tabId, presenceId: id, lastSeen: new Date() },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return Response.json({ error: "session already exists" }, { status: 409 });
    }
    throw error;
  }

  return Response.json({ ok: true, token, resumed: false, isLeader: true });
}
