import { prisma } from "@/lib/prisma";

/** Increment a shared Postgres time bucket so limits work across serverless instances. */
export async function consumeRateLimit(
  presenceId: string,
  action: string,
  maxCount: number,
  windowMs: number,
) {
  const bucketAt = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const bucket = await prisma.rateLimitBucket.upsert({
    where: { presenceId_action_bucketAt: { presenceId, action, bucketAt } },
    create: { presenceId, action, bucketAt, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return bucket.count <= maxCount;
}
