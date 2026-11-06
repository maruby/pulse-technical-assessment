import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwner } from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id }. Removes the presence row and any pending
// signals to/from this user. Called via navigator.sendBeacon on tab close, so
// the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let id: string | undefined;
  let token: string | undefined;
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) as { id?: unknown; token?: unknown } : {};
    id = typeof body.id === "string" ? body.id : undefined;
    token = typeof body.token === "string" ? body.token : undefined;
  } catch {
    id = undefined;
  }

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
