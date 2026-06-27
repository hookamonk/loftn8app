import type { GuestSession, User } from "@prisma/client";

type RequestGuestSession = Pick<
  GuestSession,
  "id" | "tableId" | "userId" | "shiftId" | "startedAt" | "endedAt" | "stayOptIn"
> & {
  table: {
    id: number;
    code: string;
    label: string | null;
    displayName: string | null;
    slug: string | null;
    venueId: number;
    venue?: {
      slug: string;
      name: string;
    };
  };
};

declare global {
  namespace Express {
    interface Request {
      guestSession?: RequestGuestSession;
      user?: User;
    }
  }
}

export {};  
