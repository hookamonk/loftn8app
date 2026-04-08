export const VENUE_DEFS = [
  {
    slug: "zizkov",
    name: "Loft№8 Žižkov",
    aliases: ["pilot"],
  },
  {
    slug: "garden",
    name: "Loft№8 Garden",
    aliases: [],
  },
  {
    slug: "nekazanka",
    name: "Loft№8 Nekazanka",
    aliases: [],
  },
] as const;

export type AppVenueSlug = (typeof VENUE_DEFS)[number]["slug"];

export const DEFAULT_VENUE_SLUG: AppVenueSlug = "zizkov";

export function normalizeVenueSlug(raw?: string | null): AppVenueSlug {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (!value) return DEFAULT_VENUE_SLUG;

  const found = VENUE_DEFS.find(
    (venue) => venue.slug === value || (venue.aliases as readonly string[]).includes(value)
  );

  return found?.slug ?? DEFAULT_VENUE_SLUG;
}

export function venueNameBySlug(raw?: string | null) {
  const slug = normalizeVenueSlug(raw);
  return VENUE_DEFS.find((venue) => venue.slug === slug)?.name ?? "Loft№8 Žižkov";
}

export function venueCandidateSlugs(raw?: string | null) {
  const normalized = normalizeVenueSlug(raw);
  const rawValue = String(raw ?? "")
    .trim()
    .toLowerCase();

  const venue = VENUE_DEFS.find((item) => item.slug === normalized);

  const candidates = new Set<string>();
  candidates.add(normalized);
  if (rawValue) candidates.add(rawValue);

  for (const alias of venue?.aliases ?? []) {
    candidates.add(alias);
  }

  return Array.from(candidates);
}

export function buildInternalTableCode(venueSlug: string, publicCode: string) {
  return `${normalizeVenueSlug(venueSlug)}:${String(publicCode).trim().toUpperCase()}`;
}

export function publicTableCode(tableCode: string) {
  const raw = String(tableCode ?? "").trim();
  const idx = raw.indexOf(":");
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}
