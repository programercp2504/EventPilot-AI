
import { prisma } from "@/lib/prisma";

export async function getOwnedEvent(
  eventId: string,
  userId: string
) {
  if (!eventId || !userId) {
    return null;
  }

  return prisma.event.findFirst({
    where: {
      id: eventId,
      userId,
    },
    select: {
      id: true,
      name: true,
      type: true,
      date: true,
      guests: true,
      budget: true,
      userId: true,
    },
  });
}
