/**
 * Create / update the staff logins of every venue from env — nothing else
 * (menu, tables and orders are not touched, unlike the full seed).
 *
 *   npm run staff:sync          (Render shell: npm run staff:sync:built)
 *
 * For each of Žižkov, Garden and Nekázanka: waiter, hookah, manager and the
 * three station iPads (kitchen, bar, hookah zone). Credentials come from
 * STAFF_<VENUE>_<ROLE>_USERNAME / _PASSWORD, e.g. STAFF_GARDEN_KITCHEN_PASSWORD.
 * In production a role without a password is skipped, never given a weak one.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { upsertVenueStaffAccounts } from "./staffAccounts";

const prisma = new PrismaClient();

const VENUES = [
  { slug: "zizkov", envPrefix: "ZIZKOV", aliases: ["pilot"] },
  { slug: "garden", envPrefix: "GARDEN", aliases: [] as string[] },
  { slug: "nekazanka", envPrefix: "NEKAZANKA", aliases: [] as string[] },
];

async function main() {
  const allowDefaultPasswords = process.env.NODE_ENV !== "production";
  let skipped = 0;

  for (const def of VENUES) {
    const venue = await prisma.venue.findFirst({
      where: { slug: { in: [def.slug, ...def.aliases] } },
      orderBy: { id: "asc" },
      select: { id: true, slug: true, name: true },
    });
    if (!venue) {
      console.warn(`⚠️  ${def.slug}: точка не найдена в базе — пропущена (сначала npm run prisma:seed)`);
      continue;
    }

    const results = await upsertVenueStaffAccounts(prisma, {
      venueId: venue.id,
      venueSlug: def.slug,
      envPrefix: def.envPrefix,
      allowDefaultPasswords,
    });

    console.log(`\n${venue.name}`);
    for (const r of results) {
      const mark = r.status === "skipped" ? "⚠️ " : "✅";
      if (r.status === "skipped") skipped += 1;
      console.log(`  ${mark} ${r.label.padEnd(24)} ${r.username.padEnd(24)} ${r.status}${r.note ? ` · ${r.note}` : ""}`);
    }
  }

  console.log(skipped ? `\nГотово, пропущено: ${skipped}.` : "\nГотово.");
}

main()
  .catch((e) => {
    console.error("❌ staff:sync failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
