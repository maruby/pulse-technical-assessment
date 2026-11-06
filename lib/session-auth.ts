import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { STALE_MS } from "@/lib/presence";

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export async function isSessionOwner(id: string, token: string | null) {
  if (!token || token.length > 128) return false;
  const session = await prisma.presence.findUnique({
    where: { id },
    select: { tokenHash: true },
  });
  if (!session?.tokenHash) return false;
  const expected = Buffer.from(session.tokenHash, "hex");
  const supplied = Buffer.from(hashToken(token), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function registerSessionTab(id: string, tabId: string) {
  const now = new Date();
  const existing = await prisma.presenceTab.findUnique({ where: { id: tabId } });
  if (existing && existing.presenceId !== id) return false;

  await prisma.presenceTab.upsert({
    where: { id: tabId },
    create: { id: tabId, presenceId: id, lastSeen: now },
    update: { lastSeen: now, releasedAt: null },
  });
  await prisma.presence.update({
    where: { id },
    data: { lastSeen: now, disconnectedAt: null },
  });
  return true;
}

export async function touchSessionTab(id: string, tabId: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_MS);
  const tab = await prisma.presenceTab.findUnique({ where: { id: tabId } });
  if (!tab || tab.presenceId !== id || tab.releasedAt) return false;
  await prisma.presenceTab.update({ where: { id: tabId }, data: { lastSeen: now } });
  await prisma.presence.update({
    where: { id },
    data: { lastSeen: now, disconnectedAt: null },
  });

  const session = await prisma.presence.findUnique({
    where: { id },
    select: { leaderTabId: true },
  });
  if (!session) return false;
  if (session.leaderTabId === tabId) return true;

  if (session.leaderTabId) {
    const currentLeader = await prisma.presenceTab.findFirst({
      where: {
        id: session.leaderTabId,
        presenceId: id,
        releasedAt: null,
        lastSeen: { gte: cutoff },
      },
      select: { id: true },
    });
    if (currentLeader) return false;
  }

  const claimed = await prisma.presence.updateMany({
    where: { id, leaderTabId: session.leaderTabId },
    data: { leaderTabId: tabId },
  });
  if (claimed.count === 1) return true;
  const current = await prisma.presence.findUnique({
    where: { id },
    select: { leaderTabId: true },
  });
  return current?.leaderTabId === tabId;
}

export async function isActiveSessionTab(id: string, tabId: string, leaderOnly = false) {
  const cutoff = new Date(Date.now() - STALE_MS);
  const [session, tab] = await Promise.all([
    prisma.presence.findUnique({ where: { id }, select: { disconnectedAt: true, leaderTabId: true } }),
    prisma.presenceTab.findUnique({ where: { id: tabId }, select: { presenceId: true, lastSeen: true, releasedAt: true } }),
  ]);
  return Boolean(
    session && session.disconnectedAt === null &&
    tab?.presenceId === id && tab.releasedAt === null && tab.lastSeen >= cutoff &&
    (!leaderOnly || session.leaderTabId === tabId),
  );
}

export async function releaseSessionTab(id: string, tabId: string) {
  const now = new Date();
  const released = await prisma.presenceTab.updateMany({
    where: { id: tabId, presenceId: id, releasedAt: null },
    data: { releasedAt: now },
  });
  if (released.count === 0) return;

  const [otherTabs, session] = await Promise.all([
    prisma.presenceTab.count({
      where: { presenceId: id, id: { not: tabId }, releasedAt: null, lastSeen: { gte: new Date(now.getTime() - STALE_MS) } },
    }),
    prisma.presence.findUnique({ where: { id }, select: { leaderTabId: true } }),
  ]);
  await prisma.presence.updateMany({
    where: { id, ...(session?.leaderTabId === tabId ? { leaderTabId: tabId } : {}) },
    data: {
      ...(session?.leaderTabId === tabId ? { leaderTabId: null } : {}),
      ...(otherTabs === 0 ? { disconnectedAt: now } : {}),
    },
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
