import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwner } from "@/lib/session-auth";
import { readJsonBody } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Explicit logout ends the shared anonymous session in every open tab.
export async function POST(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) return Response.json({ error: "invalid body" }, { status: parsed.status });
  const body = (parsed.value ?? {}) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";

  if (id.length < 8 || id.length > 64) {
    return Response.json({ error: "invalid session" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  await prisma.signal.deleteMany({ where: { OR: [{ fromId: id }, { toId: id }] } });
  await prisma.presence.deleteMany({ where: { id } });
  return Response.json({ ok: true });
}
