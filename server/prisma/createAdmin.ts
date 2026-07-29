import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Create (or reset) the single global ADMIN account WITHOUT running the full
 * seed. Use this on deploy so admin access appears without touching the live
 * menu, tables, or staff (the full seed re-imports the menu and would clobber
 * any edits made from the admin panel).
 *
 * Credentials come from env, with safe defaults:
 *   STAFF_ADMIN_USERNAME (default "admin")
 *   STAFF_ADMIN_PASSWORD (default "admin_1234")
 *
 * Run:  npm run admin:create   (in the server/ directory, e.g. Render Shell)
 */
const prisma = new PrismaClient();

async function main() {
  const username = process.env.STAFF_ADMIN_USERNAME || "admin";
  const password = process.env.STAFF_ADMIN_PASSWORD || "admin_1234";

  // Prefer Žižkov as the admin's home branch (matches the login default);
  // fall back to any active venue so this never fails on a fresh DB.
  const venue =
    (await prisma.venue.findFirst({ where: { slug: "zizkov" }, select: { id: true } })) ??
    (await prisma.venue.findFirst({ where: { isActive: true }, orderBy: { id: "asc" }, select: { id: true } }));

  if (!venue) {
    throw new Error("No venue found — seed venues first (npm run prisma:seed).");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.staffUser.upsert({
    where: { username },
    update: { role: "ADMIN", venueId: venue.id, passwordHash, isActive: true },
    create: { role: "ADMIN", venueId: venue.id, username, passwordHash, isActive: true },
  });

  console.log(`✅ Admin ready: username="${username}" (venue #${venue.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
