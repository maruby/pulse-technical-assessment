import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

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

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
