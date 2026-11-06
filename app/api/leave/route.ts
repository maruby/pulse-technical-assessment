import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwner } from "@/lib/session-auth";
import { readJsonBody } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id }. Removes the presence row and any pending
// signals to/from this user. Called via navigator.sendBeacon on tab close, so
// the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) {
    return Response.json({ error: "invalid body" }, { status: parsed.status });
  }
  const body = parsed.value as { id?: unknown; token?: unknown };
  const id = typeof body.id === "string" ? body.id : undefined;
  const token = typeof body.token === "string" ? body.token : undefined;

  if (typeof id !== "string" || id.length > 64) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, token ?? null))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  return Response.json({ ok: true });
}
