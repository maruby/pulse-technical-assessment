import { prisma } from "@/lib/prisma";

/** Promote an already-reserved request to the existing reciprocal connection state. */
export async function acceptPendingConnection(recipientId: string, requesterId: string) {
  const [recipient, requester] = await Promise.all([
    prisma.presence.findUnique({ where: { id: recipientId } }),
    prisma.presence.findUnique({ where: { id: requesterId } }),
  ]);
  if (!recipient || !requester || recipient.pendingFrom !== requesterId || recipient.busy || requester.busy) {
    return false;
  }

  const acceptedRecipient = await prisma.presence.updateMany({
    where: { id: recipientId, pendingFrom: requesterId, busy: false },
    data: { pendingFrom: null, pendingAt: null, connectedTo: requesterId, busy: true },
  });
  if (acceptedRecipient.count !== 1) return false;

  const pairedRequester = await prisma.presence.updateMany({
    where: { id: requesterId, busy: false, connectedTo: null, pendingFrom: null },
    data: { connectedTo: recipientId, busy: true },
  });
  if (pairedRequester.count === 1) return true;

  await prisma.presence.updateMany({
    where: { id: recipientId, connectedTo: requesterId },
    data: { connectedTo: null, busy: false },
  });
  return false;
}

export async function clearPendingConnection(recipientId: string, requesterId: string) {
  await prisma.presence.updateMany({
    where: { id: recipientId, pendingFrom: requesterId },
    data: { pendingFrom: null, pendingAt: null },
  });
}
