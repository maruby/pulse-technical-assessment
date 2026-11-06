import type { NextRequest } from "next/server";
import { isSessionOwner, releaseSessionTab } from "@/lib/session-auth";
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
  const body = parsed.value as { id?: unknown; token?: unknown; tabId?: unknown };
  const id = typeof body.id === "string" ? body.id : undefined;
  const token = typeof body.token === "string" ? body.token : undefined;
  const tabId = typeof body.tabId === "string" ? body.tabId : undefined;

  if (typeof id !== "string" || id.length > 64 || !tabId || tabId.length > 64) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!(await isSessionOwner(id, token ?? null))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Release this tab only. The shared anonymous session and its activity stay
  // resumable briefly and remain live while another tab is still heartbeating.
  await releaseSessionTab(id, tabId);

  return Response.json({ ok: true });
}
