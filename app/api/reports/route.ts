import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isActiveSessionTab, isSessionOwner } from "@/lib/session-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 4 * 1024);
  if (!parsed.ok) return Response.json({ error: "invalid body" }, { status: parsed.status });
  const body = (parsed.value ?? {}) as { id?: unknown; signalId?: unknown; reason?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const signalId = typeof body.signalId === "string" ? body.signalId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const tabId = request.headers.get("x-session-tab") ?? "";
  if (id.length < 8 || id.length > 64 || signalId.length < 8 || signalId.length > 64 || reason.length > 500) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isActiveSessionTab(id, tabId, true))) {
    return Response.json({ error: "inactive session tab" }, { status: 409 });
  }
  const limit = await consumeRateLimit(id, "signal-report", 3, 60 * 60_000);
  if (!limit) return Response.json({ error: "report rate limit exceeded" }, { status: 429 });

  const activity = await prisma.activitySignal.findUnique({
    where: { id: signalId },
    select: { ownerId: true, category: true, message: true },
  });
  if (!activity || activity.ownerId === id) {
    return Response.json({ error: "signal unavailable" }, { status: 404 });
  }
  await prisma.signalReport.create({
    data: {
      reporterId: id,
      targetId: activity.ownerId,
      activityId: signalId,
      category: activity.category,
      message: activity.message,
      reason: reason || null,
    },
  });
  return Response.json({ ok: true }, { status: 201 });
}
