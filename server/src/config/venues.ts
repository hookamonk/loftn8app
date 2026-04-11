export const VENUE_DEFS = [
  {
    slug: "zizkov",
    name: "LoftN8 Žižkov",
    shortName: "Žižkov",
    publicSlug: "loft-zizkov",
    aliases: ["pilot", "loft-zizkov"],
  },
  {
    slug: "garden",
    name: "LoftN8 Garden",
    shortName: "Garden",
    publicSlug: "loft-garden",
    aliases: ["loft-garden"],
  },
  {
    slug: "nekazanka",
    name: "LoftN8 Nekázanka",
    shortName: "Nekázanka",
    publicSlug: "loft-nekazanka",
    aliases: ["loft-nekazanka"],
  },
] as const;

export type AppVenueSlug = (typeof VENUE_DEFS)[number]["slug"];

export const DEFAULT_VENUE_SLUG: AppVenueSlug = "zizkov";

export function resolveVenueSlug(raw?: string | null): AppVenueSlug | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (!value) return null;

  const found = VENUE_DEFS.find(
    (venue) => venue.slug === value || (venue.aliases as readonly string[]).includes(value)
  );

  return found?.slug ?? null;
}

export function normalizeVenueSlug(raw?: string | null): AppVenueSlug {
  return resolveVenueSlug(raw) ?? DEFAULT_VENUE_SLUG;
}

export function venueNameBySlug(raw?: string | null) {
  const slug = normalizeVenueSlug(raw);
  return VENUE_DEFS.find((venue) => venue.slug === slug)?.name ?? "LoftN8 Žižkov";
}

export function venueShortNameBySlug(raw?: string | null) {
  const slug = normalizeVenueSlug(raw);
  return VENUE_DEFS.find((venue) => venue.slug === slug)?.shortName ?? "Žižkov";
}

export function publicVenueSlug(raw?: string | null) {
  const slug = normalizeVenueSlug(raw);
  return VENUE_DEFS.find((venue) => venue.slug === slug)?.publicSlug ?? "loft-zizkov";
}

export function publicVenueCatalog() {
  return VENUE_DEFS.map((venue) => ({
    slug: venue.publicSlug,
    internalSlug: venue.slug,
    name: venue.name,
    shortName: venue.shortName,
  }));
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
