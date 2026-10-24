import type { PrismaClient, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * The shared staff logins of one venue: one account per role, credentials from
 * env (STAFF_<VENUE>_<ROLE>_USERNAME / _PASSWORD). Used by the full seed and by
 * `npm run staff:sync`, which touches staff accounts only.
 */
export const VENUE_STAFF_ROLES: Array<{ role: StaffRole; key: string; label: string }> = [
  { role: "WAITER", key: "WAITER", label: "официанты" },
  { role: "HOOKAH", key: "HOOKAH", label: "кальянщики" },
  { role: "MANAGER", key: "MANAGER", label: "менеджер" },
  { role: "KITCHEN", key: "KITCHEN", label: "кухня (айпад)" },
  { role: "BAR", key: "BAR", label: "бар (айпад)" },
  { role: "HOOKAH_ZONE", key: "HOOKAH_ZONE", label: "кальянная зона (айпад)" },
];

export type StaffAccountResult = {
  role: StaffRole;
  label: string;
  username: string;
  status: "created" | "updated" | "skipped";
  note?: string;
};

export async function upsertVenueStaffAccounts(
  prisma: PrismaClient,
  params: {
    venueId: number;
    venueSlug: string;
    envPrefix: string;
    /** Fall back to `<username>_1234` when no password is set (dev only). */
    allowDefaultPasswords: boolean;
  }
): Promise<StaffAccountResult[]> {
  const results: StaffAccountResult[] = [];

  for (const def of VENUE_STAFF_ROLES) {
    const username =
      process.env[`STAFF_${params.envPrefix}_${def.key}_USERNAME`]?.trim() ||
      `${params.venueSlug}_${def.key.toLowerCase()}`;
    const envPassword = process.env[`STAFF_${params.envPrefix}_${def.key}_PASSWORD`];
    const password = envPassword || (params.allowDefaultPasswords ? `${username}_1234` : null);

    if (!password) {
      results.push({
        role: def.role,
        label: def.label,
        username,
        status: "skipped",
        note: `нет STAFF_${params.envPrefix}_${def.key}_PASSWORD`,
      });
      continue;
    }

    const taken = await prisma.staffUser.findUnique({
      where: { username },
      select: { id: true, venueId: true, role: true },
    });
    if (taken && (taken.role === "ADMIN" || taken.venueId !== params.venueId)) {
      results.push({
        role: def.role,
        label: def.label,
        username,
        status: "skipped",
        note: taken.role === "ADMIN" ? "логин занят админом" : "логин занят на другой точке",
      });
      continue;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.staffUser.upsert({
      where: { username },
      update: { role: def.role, venueId: params.venueId, passwordHash, isActive: true },
      create: { role: def.role, venueId: params.venueId, username, passwordHash, isActive: true },
    });

    results.push({
      role: def.role,
      label: def.label,
      username,
      status: taken ? "updated" : "created",
      note: envPassword ? undefined : "пароль по умолчанию",
    });
  }

  return results;
}
