import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { createSessionToken } from "@/lib/session-auth";
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

  const { id, lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || id.length < 8 || id.length > 64) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);
  const { token, tokenHash } = createSessionToken();

  try {
    await prisma.presence.create({
      data: {
        id,
        tokenHash,
        lat: offset.lat,
        lng: offset.lng,
        busy: false,
        lastSeen: new Date(),
      },
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

  return Response.json({ ok: true, token });
}
