import { PrismaClient } from "@prisma/client";
import { menuNameCs, menuDescriptionCs, menuCategoryCs } from "./menuTranslations";

type Db = Pick<PrismaClient, "menuCategory" | "menuItem">;

/**
 * Fill Czech translations (nameCs / descriptionCs) on existing menu rows by
 * matching their English text. Idempotent — safe to run repeatedly, and safe to
 * run against production (only sets the *Cs columns, never touches other data).
 */
export async function applyMenuTranslations(db: Db) {
  const categories = await db.menuCategory.findMany({ select: { id: true, name: true } });
  let cats = 0;
  for (const cat of categories) {
    const cs = menuCategoryCs[cat.name];
    if (cs) {
      await db.menuCategory.update({ where: { id: cat.id }, data: { nameCs: cs } });
      cats += 1;
    }
  }

  const items = await db.menuItem.findMany({ select: { id: true, name: true, description: true } });
  let updated = 0;
  for (const item of items) {
    const nameCs = menuNameCs[item.name] ?? null;
    const descriptionCs = item.description ? menuDescriptionCs[item.description] ?? null : null;
    if (nameCs || descriptionCs) {
      await db.menuItem.update({ where: { id: item.id }, data: { nameCs, descriptionCs } });
      updated += 1;
    }
  }

  return { cats, items: updated };
}

// Standalone runner: `npx tsx prisma/applyMenuTranslations.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  applyMenuTranslations(prisma)
    .then((r) => {
      console.log(`✅ Menu translations applied: ${r.cats} categories, ${r.items} items`);
    })
    .catch((e) => {
      console.error("Menu translations failed:", e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}