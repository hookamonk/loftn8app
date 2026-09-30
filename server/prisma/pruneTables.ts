/**
 * Remove Table rows that are no longer in the branch config
 * (src/config/tables.ts). The seed only upserts, so a table dropped from the
 * config stays in the DB and its old QR keeps working until it is removed.
 *
 * Only rows with NO history (sessions, orders, calls, payments, ratings) are
 * deleted; the rest are printed so they can be handled by hand. Safe to re-run.
 *
 *   npm run prisma:prune-tables            # dry run: prints what would go
 *   npm run prisma:prune-tables -- --apply # actually deletes
 */
import { PrismaClient } from "@prisma/client";
import { branchTables } from "../src/config/tables";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const venues = await prisma.venue.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { id: "asc" },
  });

  for (const venue of venues) {
    const keep = new Set(branchTables(venue.slug).map((table) => table.slug));
    const tables = await prisma.table.findMany({
      where: { venueId: venue.id },
      select: {
        id: true,
        code: true,
        slug: true,
        _count: {
          select: { sessions: true, orders: true, calls: true, payments: true, ratings: true },
        },
      },
      orderBy: { id: "asc" },
    });

    const stale = tables.filter((table) => !table.slug || !keep.has(table.slug));
    if (stale.length === 0) {
      console.log(`${venue.name}: ok (${tables.length} tables, nothing stale)`);
      continue;
    }

    for (const table of stale) {
      const used = Object.values(table._count).reduce((sum, n) => sum + n, 0);
      if (used > 0) {
        console.log(`${venue.name}: KEEP ${table.code} — has history ${JSON.stringify(table._count)}`);
        continue;
      }
      if (apply) {
        await prisma.table.delete({ where: { id: table.id } });
        console.log(`${venue.name}: deleted ${table.code}`);
      } else {
        console.log(`${venue.name}: would delete ${table.code}`);
      }
    }
  }

  if (!apply) console.log("Dry run — nothing changed. Re-run with --apply to delete.");
}

main()
  .catch((e) => {
    console.error("❌ Prune failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
