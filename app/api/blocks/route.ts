import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isActiveSessionTab, isSessionOwner } from "@/lib/session-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBlockRequest(request: NextRequest) {
  const parsed = await readJsonBody(request, 2 * 1024);
  if (!parsed.ok) return { response: Response.json({ error: "invalid body" }, { status: parsed.status }) };
  const body = (parsed.value ?? {}) as { id?: unknown; targetId?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  if (id.length < 8 || id.length > 64 || targetId.length < 8 || targetId.length > 64 || id === targetId) {
    return { response: Response.json({ error: "invalid request" }, { status: 400 }) };
  }
  if (!(await isSessionOwner(id, request.headers.get("x-session-token")))) {
    return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const tabId = request.headers.get("x-session-tab") ?? "";
  if (!(await isActiveSessionTab(id, tabId, true))) {
    return { response: Response.json({ error: "inactive session tab" }, { status: 409 }) };
  }
  const target = await prisma.presence.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) return { response: Response.json({ error: "peer unavailable" }, { status: 404 }) };
  return { id, targetId };
}

export async function POST(request: NextRequest) {
  const parsed = await readBlockRequest(request);
  if ("response" in parsed) return parsed.response;
  const limit = await consumeRateLimit(parsed.id, "block", 10, 60 * 60_000);
  if (!limit) return Response.json({ error: "block rate limit exceeded" }, { status: 429 });

  await prisma.$transaction(async (tx) => {
    // Share the same ordered Presence locks as Wave creation so a new request
    // cannot slip between the block check and the block write.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Presence"
      WHERE "id" = ${parsed.id} OR "id" = ${parsed.targetId}
      ORDER BY "id"
      FOR UPDATE
    `;
    await tx.block.upsert({
      where: { blockerId_blockedId: { blockerId: parsed.id, blockedId: parsed.targetId } },
      create: { blockerId: parsed.id, blockedId: parsed.targetId },
      update: {},
    });

    const [pending, connection] = await Promise.all([
      tx.waveRequest.findMany({
        where: {
          status: { in: ["PENDING", "ACCEPTING"] },
          OR: [
            { senderId: parsed.id, recipientId: parsed.targetId },
            { senderId: parsed.targetId, recipientId: parsed.id },
          ],
        },
        select: { id: true, senderId: true, recipientId: true },
      }),
      tx.presence.findUnique({ where: { id: parsed.id }, select: { connectedTo: true } }),
    ]);
    for (const wave of pending) {
      await tx.waveRequest.updateMany({ where: { id: wave.id, status: { in: ["PENDING", "ACCEPTING"] } }, data: { status: "EXPIRED" } });
      await tx.presence.updateMany({
        where: { id: wave.recipientId, pendingFrom: wave.senderId },
        data: { pendingFrom: null, pendingAt: null },
      });
    }
    if (connection?.connectedTo === parsed.targetId) {
      await tx.presence.updateMany({
        where: { id: { in: [parsed.id, parsed.targetId] } },
        data: { connectedTo: null, busy: false },
      });
      // Discard queued connection messages so no offer/ICE arrives after block.
      await tx.signal.deleteMany({
        where: {
          OR: [
            { fromId: parsed.id, toId: parsed.targetId },
            { fromId: parsed.targetId, toId: parsed.id },
          ],
        },
      });
      await tx.signal.createMany({
        data: [
          { fromId: parsed.id, toId: parsed.targetId, type: "end" },
          { fromId: parsed.targetId, toId: parsed.id, type: "end" },
        ],
      });
    }
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const parsed = await readBlockRequest(request);
  if ("response" in parsed) return parsed.response;
  await prisma.block.deleteMany({ where: { blockerId: parsed.id, blockedId: parsed.targetId } });
  return Response.json({ ok: true });
}
