import { PrismaClient, MenuSection } from "@prisma/client";
import bcrypt from "bcryptjs";
import { branchTables } from "../src/config/tables";

const prisma = new PrismaClient();

type SeedItem = {
  name: string;
  description?: string;
  priceCzk: number;
  sort: number;
  imageUrl?: string | null; // ✅
};

const VENUES = [
  {
    slug: "zizkov",
    name: "LoftN8 Žižkov",
    staffPrefix: "ZIZKOV",
    legacyPrefix: null,
    defaults: {
      waiter: "zizkov_waiter",
      hookah: "zizkov_hookah",
      manager: "zizkov_manager",
    },
  },
  {
    slug: "garden",
    name: "LoftN8 Garden",
    staffPrefix: "GARDEN",
    legacyPrefix: null,
    defaults: {
      waiter: "garden_waiter",
      hookah: "garden_hookah",
      manager: "garden_manager",
    },
  },
  {
    slug: "nekazanka",
    name: "LoftN8 Nekázanka",
    staffPrefix: "NEKAZANKA",
    legacyPrefix: null,
    defaults: {
      waiter: "nekazanka_waiter",
      hookah: "nekazanka_hookah",
      manager: "nekazanka_manager",
    },
  },
] as const;

function internalTableCode(venueSlug: string, code: string) {
  return `${venueSlug}:${String(code).trim().toUpperCase()}`;
}

async function seedVenueTables(venueId: number, venueSlug: string) {
  for (const table of branchTables(venueSlug)) {
    const publicCode = table.legacyCode ?? table.slug.toUpperCase();
    await prisma.table.upsert({
      where: { code: internalTableCode(venueSlug, publicCode) },
      update: {
        venueId,
        label: table.displayName,
        displayName: table.displayName,
        slug: table.slug,
      },
      create: {
        venueId,
        code: internalTableCode(venueSlug, publicCode),
        label: table.displayName,
        displayName: table.displayName,
        slug: table.slug,
      },
    });
  }
}

async function resolveSeedVenue(target: (typeof VENUES)[number]) {
  const candidates = Array.from(
    new Set([target.slug, ...(target.slug === "zizkov" ? ["pilot"] : [])])
  );

  const existing = await prisma.venue.findFirst({
    where: {
      slug: { in: candidates },
    },
    orderBy: { id: "asc" },
    select: { id: true, slug: true, name: true, isActive: true },
  });

  if (existing) {
    return prisma.venue.update({
      where: { id: existing.id },
      data: {
        name: target.name,
        isActive: true,
      },
      select: { id: true, slug: true, name: true },
    });
  }

  return prisma.venue.create({
    data: {
      slug: target.slug,
      name: target.name,
      isActive: true,
    },
    select: { id: true, slug: true, name: true },
  });
}

async function cloneVenueMenu(baseVenueId: number, targetVenueId: number) {
  const categories = await prisma.menuCategory.findMany({
    where: { venueId: baseVenueId },
    orderBy: [{ section: "asc" }, { sort: "asc" }],
    include: {
      items: {
        orderBy: { sort: "asc" },
      },
    },
  });

  for (const category of categories) {
    const targetCategory = await upsertCategory(
      targetVenueId,
      category.name,
      category.sort,
      category.section
    );

    await prisma.menuItem.updateMany({
      where: { categoryId: targetCategory.id },
      data: { isActive: false },
    });

    for (const item of category.items) {
      await upsertItemInCategory(targetCategory.id, {
        name: item.name,
        description: item.description ?? undefined,
        priceCzk: item.priceCzk,
        sort: item.sort,
        imageUrl: (item as any).imageUrl ?? null,
      });
    }
  }
}

function envOrFallback(primary: string, fallback: string | null, defaultValue: string) {
  return process.env[primary] || (fallback ? process.env[fallback] : undefined) || defaultValue;
}

async function seedVenueStaff(
  venueId: number,
  staffPrefix: string,
  defaults: { waiter: string; hookah: string; manager: string },
  legacyPrefix: string | null
) {
  const waiterUser = envOrFallback(
    `STAFF_${staffPrefix}_WAITER_USERNAME`,
    legacyPrefix ? `STAFF_${legacyPrefix}_WAITER_USERNAME` : null,
    defaults.waiter
  );
  const waiterPass = envOrFallback(
    `STAFF_${staffPrefix}_WAITER_PASSWORD`,
    legacyPrefix ? `STAFF_${legacyPrefix}_WAITER_PASSWORD` : null,
    `${defaults.waiter}_1234`
  );

  const hookahUser = envOrFallback(
    `STAFF_${staffPrefix}_HOOKAH_USERNAME`,
    legacyPrefix ? `STAFF_${legacyPrefix}_HOOKAH_USERNAME` : null,
    defaults.hookah
  );
  const hookahPass = envOrFallback(
    `STAFF_${staffPrefix}_HOOKAH_PASSWORD`,
    legacyPrefix ? `STAFF_${legacyPrefix}_HOOKAH_PASSWORD` : null,
    `${defaults.hookah}_1234`
  );

  const managerUser = envOrFallback(
    `STAFF_${staffPrefix}_MANAGER_USERNAME`,
    legacyPrefix ? `STAFF_${legacyPrefix}_MANAGER_USERNAME` : null,
    defaults.manager
  );
  const managerPass = envOrFallback(
    `STAFF_${staffPrefix}_MANAGER_PASSWORD`,
    legacyPrefix ? `STAFF_${legacyPrefix}_MANAGER_PASSWORD` : null,
    `${defaults.manager}_1234`
  );

  const staffSeed: Array<{ role: "WAITER" | "HOOKAH" | "MANAGER"; username: string; password: string }> = [
    { role: "WAITER", username: waiterUser, password: waiterPass },
    { role: "HOOKAH", username: hookahUser, password: hookahPass },
    { role: "MANAGER", username: managerUser, password: managerPass },
  ];

  for (const s of staffSeed) {
    const passwordHash = await bcrypt.hash(s.password, 10);
    await prisma.staffUser.upsert({
      where: { username: s.username },
      update: { role: s.role as any, venueId, passwordHash, isActive: true },
      create: { role: s.role as any, venueId, username: s.username, passwordHash, isActive: true },
    });
  }
}

async function upsertCategory(
  venueId: number,
  name: string,
  sort: number,
  section: MenuSection
) {
  const existing = await prisma.menuCategory.findFirst({ where: { venueId, name } });
  if (existing) {
    return prisma.menuCategory.update({
      where: { id: existing.id },
      data: { sort, section },
    });
  }
  return prisma.menuCategory.create({ data: { venueId, name, sort, section } });
}

async function upsertItemInCategory(categoryId: number, data: SeedItem) {
  const desc = data.description?.trim() ? data.description.trim() : null;

  // ✅ FIX: ищем по (categoryId + name + description),
  // чтобы одинаковые названия с разными объёмами НЕ перетирали друг друга
  const existing = await prisma.menuItem.findFirst({
    where: { categoryId, name: data.name, description: desc },
  });

  if (existing) {
    // if imageUrl omitted => keep previous image
    const nextImageUrl =
      data.imageUrl !== undefined ? data.imageUrl : ((existing as any).imageUrl ?? null);

    return prisma.menuItem.update({
      where: { id: existing.id },
      data: {
        description: desc,
        priceCzk: data.priceCzk,
        sort: data.sort,
        isActive: true,
        imageUrl: nextImageUrl as any,
      } as any,
    });
  }

  return prisma.menuItem.create({
    data: {
      categoryId,
      name: data.name,
      description: desc,
      priceCzk: data.priceCzk,
      sort: data.sort,
      isActive: true,
      imageUrl: (data.imageUrl ?? null) as any,
    } as any,
  });
}

async function main() {
  const baseVenueDef = VENUES[0];

  // ===== 0) Base Venue =====
  const venue = await resolveSeedVenue(baseVenueDef);

  // ===== 1) Tables =====
  await seedVenueTables(venue.id, venue.slug);

  // ===== 2) Categories structure =====
  const DISHES: Array<[string, number]> = [
    ["APPETIZERS / SNACKS", 1],
    ["SALADS / SOUPS", 2],
    ["FISH / MEAT", 3],
    ["BURGERS / SANDWICHES", 4],
    ["SUSHI", 5],
    ["SPECIALITY", 6],
    ["SIDE DISHES / SAUCES", 7],
    ["DESSERTS", 8],
  ];

  // ✅ ВАЖНО: separator должен быть ровно " · " (пробел-точка-пробел)
  // ✅ Тут мы делаем подкатегории для SPIRITS (7), WINE (4), HOT DRINKS (2)
  const DRINKS: Array<[string, number]> = [
    ["COCKTAILS", 10],

    // SPIRITS (7)
    ["SPIRITS · Rum", 20],
    ["SPIRITS · Cognac", 21],
    ["SPIRITS · Gin", 22],
    ["SPIRITS · Aperetiv", 23],
    ["SPIRITS · Tequila", 24],
    ["SPIRITS · Vodka", 25],
    ["SPIRITS · Whisky", 26],

    ["BEER", 30],

    // WINE (4)
    ["WINE · Red", 40],
    ["WINE · Rosé", 41],
    ["WINE · White", 42],
    ["WINE · Sparkling", 43],

    ["SOFT DRINKS", 50],

    // HOT DRINKS (2)
    ["HOT DRINKS · Tea", 60],
    ["HOT DRINKS · Coffee", 61],
  ];

  const HOOKAH: Array<[string, number]> = [
    ["CLASSIC HOOKAH", 1],
    ["WARP ELECTRONIC HOOKAH", 2],
    ["EXTRA", 3],
  ];

  // create/update categories
  const cats = new Map<string, { id: number }>();

  for (const [name, sort] of DISHES) {
    const c = await upsertCategory(venue.id, name, sort, MenuSection.DISHES);
    cats.set(name, c);
  }
  for (const [name, sort] of DRINKS) {
    const c = await upsertCategory(venue.id, name, sort, MenuSection.DRINKS);
    cats.set(name, c);
  }
  for (const [name, sort] of HOOKAH) {
    const c = await upsertCategory(venue.id, name, sort, MenuSection.HOOKAH);
    cats.set(name, c);
  }

  // ✅ SAFETY: если в базе остались старые "SPIRITS"/"WINE"/"HOT DRINKS"
  // - если в них НЕТ позиций -> удалим (чтобы не было бардака)
  // - если позиции есть -> просто отправим сорт в конец, ничего не трогаем
  for (const legacyName of ["SPIRITS", "WINE", "HOT DRINKS"] as const) {
    const legacy = await prisma.menuCategory.findFirst({
      where: { venueId: venue.id, name: legacyName },
    });
    if (!legacy) continue;

    const cnt = await prisma.menuItem.count({ where: { categoryId: legacy.id } });
    if (cnt === 0) {
      await prisma.menuCategory.delete({ where: { id: legacy.id } });
    } else {
      await prisma.menuCategory.update({
        where: { id: legacy.id },
        data: { sort: 9999 },
      });
    }
  }

  // ===== 3) Legacy categories (optional cleanup) =====
  const legacyKitchen = await prisma.menuCategory.findFirst({
    where: { venueId: venue.id, name: "Kitchen" },
  });
  const legacyBar = await prisma.menuCategory.findFirst({ where: { venueId: venue.id, name: "Bar" } });
  const legacyHookah = await prisma.menuCategory.findFirst({
    where: { venueId: venue.id, name: "Hookah" },
  });

  const burgersCat = cats.get("BURGERS / SANDWICHES");
  const softDrinksCat = cats.get("SOFT DRINKS");
  const classicHookahCat = cats.get("CLASSIC HOOKAH");

  if (!burgersCat || !softDrinksCat || !classicHookahCat) {
    throw new Error("Seed error: required categories not created");
  }

  if (legacyKitchen) {
    await prisma.menuItem.updateMany({
      where: { categoryId: legacyKitchen.id },
      data: { categoryId: burgersCat.id },
    });
  }
  if (legacyBar) {
    await prisma.menuItem.updateMany({
      where: { categoryId: legacyBar.id },
      data: { categoryId: softDrinksCat.id },
    });
  }
  if (legacyHookah) {
    await prisma.menuItem.updateMany({
      where: { categoryId: legacyHookah.id },
      data: { categoryId: classicHookahCat.id },
    });
  }

  await prisma.menuCategory.deleteMany({
    where: { venueId: venue.id, name: { in: ["Kitchen", "Bar", "Hookah"] } },
  });

  // ===== 4) MENU ITEMS =====
  const itemsByCategory: Record<string, SeedItem[]> = {
    // ============ DISHES ============
    "APPETIZERS / SNACKS": [
      {
        name: "KOREAN CARROT SALAD",
        description: "grated carrots in Korean spices with garlic / 100g",
        priceCzk: 85,
        sort: 1,
        imageUrl: "/menu/dishes/appetizers/KOREAN_CARROT.jpg",
      },
      {
        name: "WAKAME SEAWEED",
        description: "Wakame seaweed salad with sesame (1,5,6,8,11) / 100g",
        priceCzk: 110,
        sort: 2,
        imageUrl: "/menu/dishes/appetizers/WAKAME.jpg",
      },
      {
        name: "BEEF CARPACCIO",
        description:
          "Argentinian aged filet, parmesan, arugula, crispy baguette, olive oil (1,3,7,11) / 110g",
        priceCzk: 445,
        sort: 3,
        imageUrl: "/menu/dishes/appetizers/CARPACCIO.jpg",
      },
      {
        name: "BEEF TARTARE WITH TRUFFLE OIL",
        description:
          "Chopped Argentinian aged filet, capers, balsamic, olive oil, marinated cucumber, red onion, crispy garlic toast, quail eggs (1,3,6) / 110g",
        priceCzk: 435,
        sort: 4,
        imageUrl: "/menu/dishes/appetizers/TARTARE.jpg",
      },
      {
        name: "SALMON TARTARE",
        description:
          "salmon, capers, sweet onion, arugula, whole wheat baguette (1,3,4,6,7,11) / 100g",
        priceCzk: 285,
        sort: 5,
        imageUrl: "/menu/dishes/appetizers/SALMON_TARTARE.jpg",
      },
      {
        name: "FRIED TEMPURA SHRIMPS",
        description: "served with sweet chilli sauce (1,2,3) / 100g",
        priceCzk: 220,
        sort: 6,
        imageUrl: "/menu/dishes/appetizers/SHRIPS_TEMPURA.jpg",
      },
      {
        name: "FRIED TEMPURA CHICKEN STRIPS",
        description: "served with sweet chilli sauce (1,3) / 100g",
        priceCzk: 165,
        sort: 7,
        imageUrl: "/menu/dishes/appetizers/CHICKEN_TEMPURA.jpg",
      },
      {
        name: "CHEESE PLATTER",
        description: "4 types of cheese, honey, fig jam, apples, crackers (1,3,7)",
        priceCzk: 310,
        sort: 8,
        imageUrl: "/menu/dishes/appetizers/CHEESE_PLATTER.jpg",
      },
      {
        name: "PANCAKE ROLLS WITH CAVIAR",
        description: "Pancakes, red caviar, dill, mayo dip (1,3,4,7,10) / 4 pcs",
        priceCzk: 225,
        sort: 9,
        imageUrl: "/menu/dishes/appetizers/ROLLS_CAVIAR.jpg",
      },
      {
        name: "PANCAKE ROLLS WITH SALMON",
        description:
          "Pancakes, salmon, Philadelphia cheese, mayo, chives (1,3,4,7,10) / 4 pcs",
        priceCzk: 195,
        sort: 10,
        imageUrl: "/menu/dishes/appetizers/ROLLS_SALMON.jpg",
      },
      {
        name: "PANCAKES WITH BEEF",
        description: "Pancakes, beef, sour cream, dill (1,3,7) / 2 pcs",
        priceCzk: 195,
        sort: 11,
        imageUrl: "/menu/dishes/appetizers/BEEF_PANCAKES.jpg",
      },
      { name: "SPANISH OLIVES", description: "/ 100g", priceCzk: 175, sort: 12 },
      { name: "PISTACHIO", description: "(8) / 60g", priceCzk: 95, sort: 13 },
    ],

    "SALADS / SOUPS": [
      {
        name: "WARM SALAD WITH FILET",
        description:
          "110g Argentina aged filet (medium), baked vegetables, champions, olive oil, balsamico, microgreens (6) / 350g",
        priceCzk: 445,
        sort: 1,
        imageUrl: "/menu/dishes/salads/WARM_SALAD_FILET.jpg",
      },
      {
        name: "VEGAN WARM SALAD WITH GRILLED VEGETABLES",
        description: "baked vegetables, champions, olive oil, balsamico, microgreens (6) / 250g",
        priceCzk: 115,
        sort: 2,
      },
      {
        name: "VEGAN MIX SALAD",
        description: "kumato tomatoes, cucumber, red onions, dill, cilantro, olive oil / 200g",
        priceCzk: 125,
        sort: 3,
        imageUrl: "/menu/dishes/salads/VEGAN_MIX.jpg",
      },
      {
        name: "GREEK SALAD",
        description:
          "Feta cheese, kumato tomatoes, cucumber, red onions, pepper, dill, cilantro, Spanish olives, olive oil (7) / 410g",
        priceCzk: 285,
        sort: 4,
        imageUrl: "/menu/dishes/salads/GREEK.jpg",
      },
      {
        name: "OLIVIJE WITH BEEF",
        description: "potato salad with beef (3,7,10) / 300g",
        priceCzk: 220,
        sort: 5,
        imageUrl: "/menu/dishes/salads/OLIVJE_BEEF.jpg",
      },
      {
        name: "OLIVIJE WITH CHICKEN",
        description: "potato salad with chicken with chives (3,7,10) / 300g",
        priceCzk: 220,
        sort: 6,
        imageUrl: "/menu/dishes/salads/OLIVJE_CHICKEN.jpg",
      },
      {
        name: "SALMON ON A FUR COAT",
        description: "multilayer salad with salmon, vegetables and egg (3,4,5,7,10) / 400g",
        priceCzk: 295,
        sort: 7,
        imageUrl: "/menu/dishes/salads/SALMON.jpg",
      },
      {
        name: "MINI SALMON ON A FUR COAT",
        description: "multilayer salad with salmon, vegetables and egg (3,4,5,7,10) / 200g",
        priceCzk: 175,
        sort: 8,
        imageUrl: "/menu/dishes/salads/SALMON_MINI.jpg",
      },
      {
        name: "CAESAR SALAD",
        description:
          "little gem, caesar dip, cherry, parmesan, garlic crutons (1,2,3,4,7,10) / 200g",
        priceCzk: 130,
        sort: 9,
        imageUrl: "/menu/dishes/salads/CEASAR.jpg",
      },
      {
        name: "CAESAR SALAD + GRILLED CHICKEN BREAST",
        description:
          "little gem, caesar dip, cherry, parmesan, garlic crutons (1,2,3,4,7,10) / 320g",
        priceCzk: 295,
        sort: 10,
        imageUrl: "/menu/dishes/salads/CEASAR_CHICKEN.jpg",
      },
      {
        name: "CAESAR SALAD + GRILLED SALMON",
        description:
          "little gem, caesar dip, cherry, parmesan, garlic crutons (1,2,3,4,7,10) / 320g",
        priceCzk: 360,
        sort: 11,
        imageUrl: "/menu/dishes/salads/CAESAR_SALMON.jpg",
      },
      {
        name: "CAESAR SALAD + GRILLED SHRIMPS",
        description:
          "little gem, caesar dip, cherry, parmesan, garlic crutons (1,2,3,4,7,10) / 300g",
        priceCzk: 225,
        sort: 12,
        imageUrl: "/menu/dishes/salads/CEASAR_SHRIMPS.jpg",
      },
      {
        name: "TOM YAM KUNG",
        description: "shrimps, salmon, champignons, cilantro coconut milk, rice (2,4,11) / 0,45l",
        priceCzk: 225,
        sort: 13,
        imageUrl: "/menu/dishes/salads/TOM_YAM.jpg",
      },
      {
        name: "BORSCH",
        description: "served with garlic bread and sour cream (1,3,7)/ 0,4l",
        priceCzk: 175,
        sort: 14,
        imageUrl: "/menu/dishes/salads/BORSCH.jpg",
      },
      {
        name: "VEGAN BORSCH",
        description: "served with garlic bread and sour cream (1) / 0,4l",
        priceCzk: 125,
        sort: 15,
        imageUrl: "/menu/dishes/salads/BORSCH_VEGAN.jpg",
      },
      {
        name: "CHICKEN SOUP",
        description: "vegetables, chicken, noodles, chives (1,3,5,7) / 0,35l",
        priceCzk: 115,
        sort: 16,
        imageUrl: "/menu/dishes/salads/CHICKEN_SOUP.jpg",
      },
      {
        name: "OKROSHKA seasonal",
        description:
          "cold soup based on kefir, vegetables and beef, served with garlic bread, and lemon (1,3,7) / 0,35l",
        priceCzk: 145,
        sort: 17,
        imageUrl: "/menu/dishes/salads/OKROSHKA.jpg",
      },
    ],

    "FISH / MEAT": [
      {
        name: "BAKED SALMON STEAK WITH CREAM SAUCE AND CAVIAR",
        description: "recommended side dish: mashed potato (4,7) / 200g",
        priceCzk: 445,
        sort: 1,
        imageUrl: "/menu/dishes/meat/SALMON_STEAK.jpg",
      },
      {
        name: "HERB BUTTER GRILLED SALMON STEAK",
        description: "recommended side dish: grilled vegetables or mashed potatoes (4,7) / 200g",
        priceCzk: 385,
        sort: 2,
        imageUrl: "/menu/dishes/meat/GRILLED_SALMON_STEAK.jpg",
      },
      {
        name: "GRILLED CHICKEN STEAK",
        description: "recommended: cream sauce with mushrooms and onion (7) / 200g",
        priceCzk: 235,
        sort: 3,
        imageUrl: "/menu/dishes/meat/CHICKEN_STEAK.jpg",
      },
      {
        name: "JUICY BEEF PATTY TOPPED WITH EGG",
        description: "beef from farm Maso z pastvin, egg, microgreen (3,6,7) / 150g",
        priceCzk: 265,
        sort: 4,
        imageUrl: "/menu/dishes/meat/JUICY_BEEF.jpg",
      },
      {
        name: "BUFFALO WINGS",
        description:
          "Best seller! Juicy, moderately sweet and spicy wings baked in the oven, with Blue Cheese sauce and roughly chopped vegetables. Recommend French fries and sauce for them (7) / 500g",
        priceCzk: 295,
        sort: 5,
        imageUrl: "/menu/dishes/meat/BUFFALO_WINGS.jpg",
      },
    ],

    "BURGERS / SANDWICHES": [
      {
        name: "BURGER WITH BEEF, PROVOLONE AND BRIE",
        description:
          "smoked chicken jam, arugula, aioli (1,3,7,10,11) / 150g Recomended: french fries and Coca-Cola 0,3l ",
        priceCzk: 295,
        sort: 1,
        imageUrl: "/menu/dishes/burgers/BURGER_PROVOLONE.jpg",
      },
      {
        name: "CHEESEBURGER WITH PROVOLONE CHEESE",
        description:
          "cheddar, tomato, onion, Lollo salad, mayo, pickled cucumber (1,3,7,10,11) / 150g Recomended: french fries and Coca-Cola 0,3l",
        priceCzk: 285,
        sort: 2,
        imageUrl: "/menu/dishes/burgers/CHEESEBURGER.jpg",
      },
      {
        name: "JALAPEÑO SPICY BEEF BURGER",
        description:
          "provolone, parmesan, jalapeño, habañero, smoked chicken jam, slaw (1,3,7,10,11) / 150g Rewcomended: french fries and Coca-Cola 0,3l",
        priceCzk: 325,
        sort: 3,
        imageUrl: "/menu/dishes/burgers/JALAPENO_BURGER.jpg",
      },
    ],

    "SUSHI": [
      {
        name: "PHILLY MAKI",
        description: "salmon, Philadelphia, avocado (4,6,7) / 6 pcs",
        priceCzk: 210,
        sort: 1,
        imageUrl: "/menu/dishes/sushi/PHILLY_MAKI.jpg",
      },
      {
        name: "EBI PHILLY MAKI",
        description: "shrimps, Philadelphia, avocado (2,6,7) / 6 pcs",
        priceCzk: 185,
        sort: 2,
        imageUrl: "/menu/dishes/sushi/EBI_MAKI.jpg",
      },
      {
        name: "UNAGI MAKI",
        description:
          "BBQ eel, Japanese mayo, cucumber, sesame, unagi sauce (3,4,6,10,11) / 6 pcs",
        priceCzk: 245,
        sort: 3,
        imageUrl: "/menu/dishes/sushi/UNAGI_MAKI.jpg",
      },
      {
        name: "KOREAN KIMBAP",
        description: "Argentina aged filet, marinated carrot, cucumber, teriyaki, sesame (6,11) / 8 pcs",
        priceCzk: 325,
        sort: 4,
        imageUrl: "/menu/dishes/sushi/KOREAN_KIMBAP.jpg",
      },
      {
        name: "VEGAN KOREAN SUSHI",
        description: "marinated carrot, cucumber, pepper, teriyaki, sesame (6,11) / 8 pcs",
        priceCzk: 155,
        sort: 5,
        imageUrl: "/menu/dishes/sushi/VEGAN_SUSHI.jpg",
      },
      {
        name: "PHILADELPHIA FUSION ROLL",
        description: "salmon, Philadelphia, avocado, cucumber (4,6,7) / 8 pcs",
        priceCzk: 395,
        sort: 6,
        imageUrl: "/menu/dishes/sushi/PHILA_FUSION.jpg",
      },
      {
        name: "CHICKEN TEMPURA FUSION ROLL",
        description: "chicken, Philadelphia, cucumber, unagi, sesame (1,3,4,6,7,11) / 8 pcs",
        priceCzk: 275,
        sort: 7,
        imageUrl: "/menu/dishes/sushi/CHICKEN_TEMPURA_ROLL.jpg",
      },
      {
        name: "SAMURAI FUSION ROLL",
        description: "salmon, Philadelphia, avocado, cucumber (4,6,7) / 8 pcs",
        priceCzk: 425,
        sort: 8,
        imageUrl: "/menu/dishes/sushi/SAMURAI_ROLL.jpg",
      },
      {
        name: "TRIPPLE S FUSION ROLL",
        description: "salmon, Philadelphia, avocado, cucumber (4,6,7) / 8 pcs",
        priceCzk: 375,
        sort: 9,
        imageUrl: "/menu/dishes/sushi/TRIPPLE_ROLL.jpg",
      },
      { name: "SUSHI MENU 1", description: "ura maki, tom yam kung", priceCzk: 345, sort: 10 },
      { name: "SUSHI MENU 2", description: "fusion roll, tom yam kung", priceCzk: 375, sort: 11 },
      { name: "SUSHI SET", description: "2x fusion roll, 2x ura maki", priceCzk: 995, sort: 12 },
    ],

    "SPECIALITY": [
      {
        name: "HANDMADE BEEF PELMENI BOILED",
        description: "boiled handmade dumplings with beef, served with sour cream and chives (1,3,7) / 300g",
        priceCzk: 275,
        sort: 1,
        imageUrl: "/menu/dishes/special/Beef_PELMENI.jpg",
      },
      {
        name: "HANDMADE CHICKEN PELMENI BOILED",
        description:
          "boiled handmade dumplings with chicken and parmesan, served with sour cream and dill (1,3,7) / 300g",
        priceCzk: 255,
        sort: 2,
        imageUrl: "/menu/dishes/special/CHICKEN_PELMENI.jpg",
      },
      {
        name: "HANDMADE FRIED BEEF PELMENI",
        description: "fried handmade dumplings with beef, served with sweet chilli sauce (1,3,7) / 300g",
        priceCzk: 275,
        sort: 3,
        imageUrl: "/menu/dishes/special/FRIED_BEEF.jpg",
      },
      {
        name: "HANDMADE CHICKEN PELMENI FRIED",
        description:
          "fried handmade dumplings with chicken and parmesan, served with sweet chilli sauce (1,3,7) / 300g",
        priceCzk: 255,
        sort: 4,
        imageUrl: "/menu/dishes/special/FRIED_CHICKEN.jpg",
      },
      {
        name: "HANDMADE VARENIKI BOILED",
        description: "boiled handmade dumplings with potato and onions, served with sour cream (1,3,7) / 300g",
        priceCzk: 215,
        sort: 5,
        imageUrl: "/menu/dishes/special/VARENIKI.jpg",
      },
      {
        name: "HANDMADE VARENIKI FRIED",
        description: "fried handmade dumplings with potato and onions, served with sweet chilli sauce (1,3,7) / 300g",
        priceCzk: 215,
        sort: 6,
        imageUrl: "/menu/dishes/special/FRIED_VARENIKI.jpg",
      },
      {
        name: "HANDMADE SAMSA",
        description: "puff pastry with beef and lamb meat, onion, adjika (1,3,7,11)",
        priceCzk: 275,
        sort: 7,
        imageUrl: "/menu/dishes/special/SAMSA.jpg",
      },
    ],

    "SIDE DISHES / SAUCES": [
      {
        name: "FRESHLY BAKED WHOLEWHEAT BREAD",
        description: "freshly baked wholewheat bread with herb butter and olive oil dip with vegetables / 100g",
        priceCzk: 65,
        sort: 1,
        imageUrl: "/menu/dishes/side/BREAD.jpg",
      },
      { name: "BUCKWHEAT", description: "200g", priceCzk: 85, sort: 2, imageUrl: "/menu/dishes/side/BUCKWHEAT.jpg" },
      {
        name: "BAKED POTATOES",
        description: "200g",
        priceCzk: 75,
        sort: 3,
        imageUrl: "/menu/dishes/side/BAKED_POTATOES.jpg",
      },
      {
        name: "FRENCH FRIES",
        description: "200g",
        priceCzk: 85,
        sort: 4,
        imageUrl: "/menu/dishes/side/FRENCH_FRIES.jpg",
      },
      {
        name: "SWEET POTATO FRIES",
        description: "200g",
        priceCzk: 110,
        sort: 5,
        imageUrl: "/menu/dishes/side/SWEET_POTATO.jpg",
      },
      { name: "RICE", description: "200g", priceCzk: 65, sort: 6, imageUrl: "/menu/dishes/side/RICE.jpg" },
      {
        name: "GRILLED VEGETABLES",
        description: "250g",
        priceCzk: 105,
        sort: 7,
        imageUrl: "/menu/dishes/side/GRILLED_VEGE.jpg",
      },
      {
        name: "MASHED POTATOES",
        description: "(7) / 250g",
        priceCzk: 65,
        sort: 8,
        imageUrl: "/menu/dishes/side/MASHED_POTATOES.jpg",
      },
      { name: "TARTARE SAUCE", description: "(1,10) / 40g", priceCzk: 40, sort: 9, imageUrl: "#" },
      { name: "SOUR CREAM", description: "(7) / 40g", priceCzk: 30, sort: 10, imageUrl: "#" },
      { name: "CHILLI", description: "40g", priceCzk: 40, sort: 11, imageUrl: "#" },
      { name: "SWEET CHILLI", description: "40g", priceCzk: 40, sort: 12, imageUrl: "#" },
      { name: "KETCHUP", description: "40g", priceCzk: 30, sort: 13, imageUrl: "#" },
    ],

    "DESSERTS": [
      {
        name: "PANCAKES WITH SWEET COTTAGE CHEESE",
        description: "pancakes, cottage cheese, sour cream, vanila sugar (1,3,7) / 2 pcs",
        priceCzk: 135,
        sort: 1,
        imageUrl: "/menu/dishes/desserts/PANCAKES.jpg",
      },
      {
        name: "SYRNIKI",
        description: "cottage pancakes, strawberry jam, sour cream, chocolate topping (1,3,7) / 5 pcs",
        priceCzk: 195,
        sort: 2,
        imageUrl: "/menu/dishes/desserts/SYRNIKI.jpg",
      },
      {
        name: "CRISPY ROLLS WITH CONDENCED MILK 1PCS",
        description: "Our delicious crispy rolls with condensed milk and Philadelphia cheese. (1,3,7) / 1 pcs",
        priceCzk: 85,
        sort: 3,
        imageUrl: "/menu/dishes/desserts/ROLLS.jpg",
      },
      {
        name: "HOMEMADE SHORTBREAD COOKIES WITH CONDENSED MILK AND WALNUTS 1PCS",
        description: "Homemade shortbread cookies with condensed milk and walnuts. (1,3,7,8) / 1 pcs",
        priceCzk: 25,
        sort: 4,
        imageUrl: "/menu/dishes/desserts/COOKIES.jpg",
      },
    ],

    // ============ DRINKS ============
    "COCKTAILS": [
      {
        name: "HUGO",
        description: "Prosecco, Elderflower Syrup, Lime Juice, Sparkling Water, Lime Slice",
        priceCzk: 160,
        sort: 1,
        imageUrl: "/menu/drinks/cocktails/HUGO.jpg",
      },
      {
        name: "HUGO / 1L",
        description: "Prosecco, Elderflower Syrup, Lime Juice, Sparkling Water, Lime Slice.2l",
        priceCzk: 510,
        sort: 2,
        imageUrl: "/menu/drinks/cocktails/HUGO.jpg",
      },
      {
        name: "APEROL",
        description: "Prosecco, Sparkling Water, Aperol, Orange",
        priceCzk: 170,
        sort: 3,
        imageUrl: "/menu/drinks/cocktails/APEROL.jpg",
      },
      {
        name: "APEROL / 1L",
        description: "Prosecco, Sparkling Water, Aperol, Orange.2l",
        priceCzk: 540,
        sort: 4,
        imageUrl: "/menu/drinks/cocktails/APEROL.jpg",
      },
      {
        name: "WATERMELON APEROL",
        description: "Prosecco, Aperol, Watermelon Syrup, Raspberry Jam, Lemon Juice.2l",
        priceCzk: 195,
        sort: 5,
        imageUrl: "/menu/drinks/cocktails/WATERMLN_APEROL.jpg",
      },
      { name: "DAIQUIRI", description: "Rum, Lime Juice, Rich Syrup", priceCzk: 160, sort: 6, imageUrl: "/menu/drinks/cocktails/DAIQ.jpg" },
      { name: "CUBA LIBRE", description: "0.Rum, Lime Juice, Coca-cola", priceCzk: 170, sort: 7, imageUrl: "/menu/drinks/cocktails/CUBA.jpg" },
      { name: "MOJITO (non-alco)", description: "Lime Juice, Mint, Rich Syrup, Sparkling Water", priceCzk: 140, sort: 8, imageUrl: "/menu/drinks/cocktails/MOJITO.jpg" },
      { name: "MOJITO", description: "Lime Juice, Mint, Rich Syrup, Sparkling Water, Rum.2l", priceCzk: 185, sort: 9, imageUrl: "/menu/drinks/cocktails/MOJITO.jpg" },
      { name: "MOJITO STRAWBERRY", description: "0.Rum, Lime Juice, Strawberry Syrup, Mint, Sparkling Water", priceCzk: 195, sort: 10, imageUrl: "#" },
      { name: "MOJITO STRAWBERRY (non-alco)", description: "0.Lime Juice, Mint, Strawberry Syrup, Sparkling Water", priceCzk: 155, sort: 11, imageUrl: "#" },
      { name: "PORN STAR MARTINI", description: "Vodka, Passion Fruit Liqueur, Vanilla Syrup, Lime Juice, Prosecco.2l", priceCzk: 235, sort: 12, imageUrl: "/menu/drinks/cocktails/P_STAR.jpg" },
      { name: "MOSCOW MULE", description: "Vodka, Lime Juice, Rich Syrup, TH Ginger Beer.2l", priceCzk: 255, sort: 13, imageUrl: "/menu/drinks/cocktails/MULE.jpg" },
      { name: "COSMOPOLITAN", description: "Vodka, Triple Sec, Cranberry Juice, Lime Juice.2l", priceCzk: 170, sort: 14, imageUrl: "/menu/drinks/cocktails/COSMO.jpg" },
      { name: "CUPITO / 1", description: "Vodka, Lemon Juice, Rich Syrup", priceCzk: 90, sort: 15, imageUrl: "/menu/drinks/cocktails/CUPITO1ks.jpg" },
      { name: "CUPITO / 10", description: "Vodka, Lemon Juice, Rich Syrup", priceCzk: 630, sort: 16, imageUrl: "/menu/drinks/cocktails/CUPITO10ks.jpg" },
      { name: "MARGARITA ON THE ROCKS", description: "Tequila, Lime Juice, Rich Syrup, Triple Sec.2l", priceCzk: 205, sort: 17, imageUrl: "/menu/drinks/cocktails/MARGARITA.jpg" },
      { name: "MARGARITA ON THE ROCKS / 1L", description: "Tequila, Lime Juice, Rich Syrup, Triple Sec.2l", priceCzk: 665, sort: 18, imageUrl: "/menu/drinks/cocktails/MARGARITA.jpg" },
      { name: "WHISKEY SOUR", description: "Whiskey, Lemon Juice, Egg White, Angostura", priceCzk: 195, sort: 19, imageUrl: "/menu/drinks/cocktails/SOUR.jpg" },
      { name: "LONG ISLAND ICED TEA", description: "Vodka, Gin, Tequila, Triple Sec , Rum, Lemon Juice, Coca-cola", priceCzk: 215, sort: 20, imageUrl: "/menu/drinks/cocktails/LONG.jpg" },
      { name: "LONG ISLAND ICED TEA / 1L", description: "Vodka, Gin, Tequila, Triple Sec , Rum, Lemon Juice, Coca-cola", priceCzk: 690, sort: 21, imageUrl: "/menu/drinks/cocktails/LONG.jpg" },
      { name: "CLOVER CLUB", description: "Martini Extra Dry, Gin, Raspberry Jam, Lemon Juice, Egg White.2l", priceCzk: 190, sort: 22, imageUrl: "/menu/drinks/cocktails/CLOVER.jpg" },
      { name: "NEGRONI", description: "Gin, Bitter, Martini Rosso.2l", priceCzk: 190, sort: 23, imageUrl: "/menu/drinks/cocktails/NEGRONI.jpg" },
      { name: "CUCUMBER GIN SOUR", description: "Bombay Gin, Elderflower, Lime Juice, Sugar, Egg White.2l", priceCzk: 165, sort: 24, imageUrl: "/menu/drinks/cocktails/CUCUMBER.jpg" },
      { name: "BOMBAY&KINLEY", description: "", priceCzk: 225, sort: 25, imageUrl: "/menu/drinks/cocktails/BOMBAY.jpg" },
      { name: "HENDRICK’S&TH", description: "", priceCzk: 260, sort: 26, imageUrl: "/menu/drinks/cocktails/HENDRICK.jpg" },
      { name: "MALFY&TH", description: "", priceCzk: 240, sort: 27, imageUrl: "/menu/drinks/cocktails/MALFY.jpg" },
    ],

    "SPIRITS · Rum": [
      { name: "BACARDI CARTA BLANCA", description: "0,04L", priceCzk: 125, sort: 1 },
      { name: "BACARDI CARTA NEGRA", description: "0,04L", priceCzk: 125, sort: 2 },
      { name: "DON PAPA MASSKARA", description: "0,04L", priceCzk: 165, sort: 3 },
      { name: "DON PAPA MASSKARA", description: "0,7L", priceCzk: 2500, sort: 4 },
      { name: "ZACAPA 23", description: "0,04L", priceCzk: 250, sort: 5 },
      { name: "ZACAPA XO", description: "0,04L", priceCzk: 550, sort: 6 },
      { name: "BACARDI CARTA BLANCA", description: "1L", priceCzk: 2400, sort: 7 },
      { name: "BACARDI CARTA NEGRA", description: "1L", priceCzk: 2400, sort: 8 },
      { name: "ZACAPA 23", description: "1L", priceCzk: 5900, sort: 9 },
      { name: "ZACAPA XO", description: "0,7L", priceCzk: 7950, sort: 10 },
    ],

    "SPIRITS · Cognac": [
      { name: "HENNESSY VS", description: "0,04L", priceCzk: 185, sort: 1 },
      { name: "HENNESSY VSOP", description: "0,04L", priceCzk: 310, sort: 2 },
      { name: "MARTELL VSOP", description: "0,04L", priceCzk: 210, sort: 3 },
      { name: "HENNESSY VS", description: "0,7L", priceCzk: 2650, sort: 4 },
      { name: "HENNESSY VSOP", description: "0,7L", priceCzk: 4400, sort: 5 },
      { name: "MARTELL VSOP", description: "0,7L", priceCzk: 2950, sort: 6 },
    ],

    "SPIRITS · Gin": [
      { name: "BOTANIST", description: "0,04L", priceCzk: 190, sort: 1 },
      { name: "GIN MARE", description: "0,04L", priceCzk: 180, sort: 2 },
      { name: "MONKEY 47", description: "0,04L", priceCzk: 270, sort: 3 },
      { name: "MALFY", description: "0,04L", priceCzk: 155, sort: 4 },
      { name: "HENDRICK’S", description: "0,04L", priceCzk: 170, sort: 5 },
      { name: "BOMBAY SAPPHIRE", description: "0,04L", priceCzk: 135, sort: 6 },
      { name: "BOTANIST", description: "0,7L", priceCzk: 2850, sort: 7 },
      { name: "GIN MARE", description: "0,7L", priceCzk: 2500, sort: 8 },
      { name: "MONKEY 47", description: "0,5L", priceCzk: 2700, sort: 9 },
      { name: "MALFY", description: "0,7L", priceCzk: 2200, sort: 10 },
      { name: "HENDRICK’S", description: "1L", priceCzk: 3300, sort: 11 },
      { name: "BOMBAY SAPPHIRE", description: "1L", priceCzk: 2700, sort: 12 },
    ],

    "SPIRITS · Aperetiv": [
      { name: "MARTINI BIANCO", description: "0,1L", priceCzk: 125, sort: 1 },
      { name: "MARTINI ROSSO", description: "0,1L", priceCzk: 125, sort: 2 },
      { name: "MARTINI EXTRA DRY", description: "0,1L", priceCzk: 130, sort: 3 },
      { name: "MARTINI BIANCO", description: "1L", priceCzk: 950, sort: 4 },
      { name: "MARTINI ROSSO", description: "1L", priceCzk: 950, sort: 5 },
      { name: "MARTINI EXTRA DRY", description: "1L", priceCzk: 990, sort: 6 },
    ],

    "SPIRITS · Tequila": [
      { name: "EL JIMADOR SILVER", description: "0,04L", priceCzk: 135, sort: 1 },
      { name: "EL JIMADOR GOLD", description: "0,04L", priceCzk: 135, sort: 2 },
      { name: "PATRON", description: "0,04L", priceCzk: 230, sort: 3 },
      { name: "PATRON", description: "0,7L", priceCzk: 3400, sort: 4 },
      { name: "EL JIMADOR SILVER", description: "1L", priceCzk: 2700, sort: 5 },
      { name: "EL JIMADOR GOLD", description: "1L", priceCzk: 2700, sort: 6 },
    ],

    "SPIRITS · Vodka": [
      { name: "ABSOLUT", description: "0,04L", priceCzk: 120, sort: 1 },
      { name: "FINLANDIA", description: "0,04L", priceCzk: 120, sort: 2 },
      { name: "BELVEDERE", description: "0,04L", priceCzk: 170, sort: 3 },
      { name: "GREY GOOSE", description: "0,04L", priceCzk: 185, sort: 4 },
      { name: "BELUGA", description: "0,04L", priceCzk: 235, sort: 5 },
      { name: "ABSOLUT", description: "1L", priceCzk: 2200, sort: 6 },
      { name: "FINLANDIA", description: "1L", priceCzk: 2200, sort: 7 },
      { name: "BELVEDERE", description: "0,7L", priceCzk: 2550, sort: 8 },
      { name: "BELVEDERE B10", description: "0,7L", priceCzk: 11000, sort: 9 },
      { name: "GREY GOOSE", description: "1L", priceCzk: 3700, sort: 10 },
      { name: "BELUGA", description: "0,7L", priceCzk: 3290, sort: 11 },
    ],

    "SPIRITS · Whisky": [
      { name: "JACK DANIELS", description: "0,04L", priceCzk: 140, sort: 1 },
      { name: "JACK DANIELS HONEY", description: "0,04L", priceCzk: 140, sort: 2 },
      { name: "JAMESON", description: "0,04L", priceCzk: 120, sort: 3 },
      { name: "GLENFIDDICH 12", description: "0,04L", priceCzk: 195, sort: 4 },
      { name: "GLENFIDDICH 15", description: "0,04L", priceCzk: 260, sort: 5 },
      { name: "MACALLAN 12", description: "0,04L", priceCzk: 375, sort: 6 },
      { name: "JACK DANIELS", description: "1L", priceCzk: 2600, sort: 7 },
      { name: "JACK DANIELS HONEY", description: "1L", priceCzk: 2600, sort: 8 },
      { name: "JAMESON", description: "1L", priceCzk: 2400, sort: 9 },
      { name: "GLENFIDDICH 12", description: "0,7L", priceCzk: 2700, sort: 10 },
      { name: "GLENFIDDICH 15", description: "0,7L", priceCzk: 3600, sort: 11 },
      { name: "MACALLAN 12", description: "0,7L", priceCzk: 5200, sort: 12 },
    ],

    "BEER": [
      { name: "ALBIN ALE", description: "0,4L", priceCzk: 80, sort: 1 },
      { name: "LIGHT LAGER", description: "0,3L", priceCzk: 65, sort: 2 },
      { name: "LIGHT LAGER", description: "0,5L", priceCzk: 85, sort: 3 },
      { name: "SPECIAL BEER", description: "0,4L", priceCzk: 95, sort: 4 },
      { name: "BIRELL", description: "0,33L", priceCzk: 60, sort: 5 },
      { name: "KASTEEL ROUGE", description: "Belgian dark cherry Ale 8% / 0,33L ", priceCzk: 145, sort: 6 },
    ],

    "WINE · Red": [
      { name: "MULLED WINE KINDZMARAULI MARANI 2021", description: "Semi-sweet / 0,2L", priceCzk: 255, sort: 1 },
      { name: "KINDZMARAULI MARANI 2021", description: "Semi-sweet / 0,1L", priceCzk: 155, sort: 2 },
      { name: "KINDZMARAULI MARANI 2021", description: "Semi-sweet / 0,75L", priceCzk: 930, sort: 3 },
      { name: "PRIMITIVO PUGLIA IGT", description: "Dry / 0,1L", priceCzk: 135, sort: 4 },
      { name: "PRIMITIVO PUGLIA IGT", description: "Dry / 0,75L", priceCzk: 790, sort: 5 },
      { name: "BOURGOGNE PINOT NOIR 2022 VIEILLES VIGNES PHILIPPE LE HARDI", description: "Dry / 0,75L", priceCzk: 1490, sort: 6 },
      { name: "HOT WINE", description: "Kindzmarauli based hot, spiced, sweetened red wine / 0,2L", priceCzk: 255, sort: 7 },
    ],
    "WINE · Rosé": [
      { name: "CÔTES DE PROVENCE 2022 CHATEAU MINUTY M ROSÉ", description: "Dry / 0,75L", priceCzk: 1290, sort: 1 },
    ],
    "WINE · White": [
      { name: "MOSCATO MEZZACORONA DOC", description: "Dry / 0,1L", priceCzk: 140, sort: 1 },
      { name: "MOSCATO MEZZACORONA DOC", description: "Dry / 0,75L", priceCzk: 820, sort: 2 },
      { name: "PINOT GRIGIO DOC", description: "Dry / 0,1L", priceCzk: 135, sort: 3 },
      { name: "PINOT GRIGIO DOC/", description: "Dry / 0,75L", priceCzk: 790, sort: 4 },
      { name: "DOMAINE DE MISELLE CHARDONNAY", description: "Dry / 0,1L", priceCzk: 145, sort: 5 },
      { name: "DOMAINE DE MISELLE CHARDONNAY", description: "Dry / 0,75L", priceCzk: 850, sort: 6 },
      { name: "CHABLIS 2023 JEAN-MARC BROCARD", description: "Dry / 0,75L", priceCzk: 1490, sort: 7 },
    ],
    "WINE · Sparkling": [
      { name: "PROSECCO COLLIO BLU D.O.C. MILLESIMATO", description: "Extra Dry, Venetto (Italy) / 0,1L", priceCzk: 125, sort: 1 },
      { name: "PROSECCO COLLIO BLU D.O.C. MILLESIMATO", description: "Extra dry, Veneto (Italy) / 0,75L", priceCzk: 790, sort: 2 },
      { name: "PROSECCO ASOLO D.O.C.G EXTRA DRY SUPERIORE MILLESIMATO", description: "Extra Dry, Veneto (Italy) / 0,75L", priceCzk: 890, sort: 3 },
      { name: "PROSECCO VALDOBBIADENE BRUT D.O.C.G. SUPERIORE", description: "Combai, Veneto, Italy / 0,75L", priceCzk: 990, sort: 4 },
      { name: "CHANDON GARDEN SPRITZ", description: "Bittersweet / 0,75L", priceCzk: 830, sort: 5 },
      { name: "MOSCATO CAJO SPUMANTE DOLCE", description: "Sweet / 0,75L", priceCzk: 890, sort: 6 },
      { name: "ASTI MARTINI D.O.C.G", description: "Sweet / 0,75L", priceCzk: 990, sort: 7 },
      { name: "CREMANT DE BORDEAUX MISSION SAINT VINCENT BRUT", description: "Dry / 0,75L", priceCzk: 1090, sort: 8 },
      { name: "MOËT & CHANDON IMPERIAL", description: "Sweet / 0,75L", priceCzk: 2800, sort: 9 },
      { name: "MOËT & CHANDON IMPÉRIAL ROSÉ", description: "Semi-dry / 0,75L", priceCzk: 3600, sort: 10 },
      { name: "MOËT & CHANDON ICE IMPÉRIAL", description: "Sweet / 0,75L", priceCzk: 3200, sort: 11 },
      { name: "VEUVE CLICQUOT BRUT", description: "Dry / 0,75L", priceCzk: 3200, sort: 12 },
      { name: "DOM PÉRIGNON VINTAGE 2013", description: "Dry / 0,75L", priceCzk: 11100, sort: 13 },
      { name: "LOUIS RODERER BRUT CRISTAL 2016", description: "Dry / 0,75L", priceCzk: 14900, sort: 14 },
    ],

    "SOFT DRINKS": [
      { name: "CARAFE OF STILL WATER WITH LEMON AND MINT", description: "KARAFA VODY / 1L", priceCzk: 60, sort: 1 },
      { name: "CARAFE OF SPARKLING WATER", description: "KARAFA PERLIVÉ VODY / 1L", priceCzk: 95, sort: 2 },
      { name: "ROMERQUELLE", description: "0,75L", priceCzk: 130, sort: 3 },
      { name: "BORJOMI", description: "0,5L", priceCzk: 110, sort: 4 },
      { name: "NATURA", description: "0,33L", priceCzk: 65, sort: 5 },
      { name: "COCA-COLA", description: "0,33L", priceCzk: 85, sort: 6 },
      { name: "FANTA", description: "0,33L", priceCzk: 85, sort: 7 },
      { name: "SPRITE", description: "0,33L", priceCzk: 85, sort: 8 },
      { name: "CAPPY", description: "0,25L", priceCzk: 95, sort: 9 },
      { name: "CITRONADA", description: "0,4L", priceCzk: 105, sort: 10 },
      { name: "CITRONADA", description: "1L", priceCzk: 165, sort: 11 },
      { name: "THOMAS HENRY", description: "0,2L", priceCzk: 110, sort: 12 },
      { name: "KINLEY TONIC", description: "0,25L", priceCzk: 85, sort: 13 },
      { name: "LEMONADE MONIN", description: "0,5L", priceCzk: 115, sort: 14 },
      { name: "ICE TEA", description: "0,5L", priceCzk: 105, sort: 15 },
      { name: "FRESH", description: "0,3L", priceCzk: 130, sort: 16 },
      { name: "RED BULL", description: "0,25L", priceCzk: 115, sort: 17 },
    ],

    "HOT DRINKS · Tea": [
      { name: "BLACK TEA", description: "ČERNÝ ČAJ", priceCzk: 130, sort: 1 },
      { name: "GREEN TEA", description: "ZELENÝ ČAJ", priceCzk: 130, sort: 2 },
      { name: "JASMIN TEA", description: "JASMÍNOVÝ ČAJ", priceCzk: 130, sort: 3 },
      { name: "MOROCCAN MINT TEA", description: "MAROCKÁ MÁTA", priceCzk: 130, sort: 4 },
      { name: "FRESH MINT TEA", description: "ČAJ Z ČERSTVÉ MÁTY", priceCzk: 115, sort: 5 },
      { name: "FRESH GINGER TEA", description: "ČAJ Z ČERSTVÉHO ZÁZVORU", priceCzk: 115, sort: 6 },
      { name: "HEALTHY TEA", description: "0,6L", priceCzk: 135, sort: 7 },
      { name: "HEALTHY TEA", description: "1L", priceCzk: 195, sort: 8 },
      { name: "WILDBERRIES TEA", description: "0,6L", priceCzk: 145, sort: 9 },
      { name: "WILDBERRIES TEA", description: "1L", priceCzk: 205, sort: 10 },
      { name: "WINTER PUNCH TEA", description: "0,6L", priceCzk: 165, sort: 11 },
      { name: "WINTER PUNCH TEA", description: "1L", priceCzk: 225, sort: 12 },
      { name: "HERBAL STRAWBERRY TEA", description: "0,6L", priceCzk: 165, sort: 13 },
      { name: "HERBAL STRAWBERRY TEA", description: "1L", priceCzk: 225, sort: 14 },
      { name: "HONEY", description: "MED", priceCzk: 45, sort: 15 },
      { name: "FRESH MINT", description: "EXTRA MÁTA", priceCzk: 25, sort: 16 },
      { name: "FRESH GINGER", description: "EXTRA ZÁZVOR", priceCzk: 35, sort: 17 },
    ],
    "HOT DRINKS · Coffee": [
      { name: "ESPRESSO", priceCzk: 80, sort: 1 },
      { name: "ESPRESSO MACCHIATO", priceCzk: 85, sort: 2 },
      { name: "AMERICANO/LUNGO", priceCzk: 80, sort: 3 },
      { name: "CAPPUCCINO", description: "M", priceCzk: 95, sort: 4 },
      { name: "CAPPUCCINO", description: "L", priceCzk: 115, sort: 5 },
      { name: "ESPRESSO TONIC", priceCzk: 140, sort: 6 },
      { name: "CAFFE LATTE", priceCzk: 100, sort: 7 },
      { name: "FLAT WHITE", priceCzk: 105, sort: 8 },
      { name: "RAF", description: "POPCORN / LAVENDER", priceCzk: 125, sort: 9 },
      { name: "MATCHA LATTE", priceCzk: 135, sort: 10 },
      { name: "ICED STRAWBERRY MATCHA TEA LATTE", priceCzk: 165, sort: 11 },
      { name: "EXTRA SHOT", priceCzk: 20, sort: 12 },
      { name: "ALTERNATIVE MILK", priceCzk: 15, sort: 13 },
    ],

    // ============ HOOKAH ============
    "CLASSIC HOOKAH": [
      { name: "LIGHT", description: "", priceCzk: 470, sort: 1 },
      { name: "MEDIUM", description: "", priceCzk: 520, sort: 2 },
      { name: "STRONG", description: "", priceCzk: 560, sort: 3 },
      { name: "EXPRESS", description: "", priceCzk: 420, sort: 4 },
      { name: "Bowl replacement", description: "", priceCzk: 360, sort: 5 },
    ],
    "WARP ELECTRONIC HOOKAH": [
      { name: "LIGHT", description: "", priceCzk: 470, sort: 1 },
      { name: "MEDIUM", description: "", priceCzk: 520, sort: 2 },
      { name: "STRONG", description: "", priceCzk: 560, sort: 3 },
    ],
    "EXTRA": [
      { name: "HOOKAH RENTAL", description: "1h", priceCzk: 300, sort: 1 },
      { name: "BROKEN VASE NEBULLA", priceCzk: 2500, sort: 2 },
    ],
  };

  // ✅ ВАЖНО: НЕ ТРОГАЕМ категории с пустыми массивами
  // иначе они деактивируют существующие items в базе (и кажется что "пропало")
  for (const [catName, items] of Object.entries(itemsByCategory)) {
    const cat = cats.get(catName);
    if (!cat) throw new Error(`Seed error: category not found "${catName}"`);

    // ✅ если пока пусто — НЕ деактивируем и ничего не меняем
    if (!items || items.length === 0) continue;

    await prisma.menuItem.updateMany({
      where: { categoryId: cat.id },
      data: { isActive: false },
    });

    for (const item of items) {
      await upsertItemInCategory(cat.id, item);
    }
  }

  // ===== 5) STAFF =====
  await seedVenueStaff(venue.id, baseVenueDef.staffPrefix, baseVenueDef.defaults, baseVenueDef.legacyPrefix);

  for (const target of VENUES.slice(1)) {
    const targetVenue = await resolveSeedVenue(target);

    await seedVenueTables(targetVenue.id, targetVenue.slug);
    await cloneVenueMenu(venue.id, targetVenue.id);
    await seedVenueStaff(targetVenue.id, target.staffPrefix, target.defaults, target.legacyPrefix);
  }

  console.log("✅ Seed done (multi-venue tables + menu items + staff)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
