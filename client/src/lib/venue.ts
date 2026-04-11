export const VENUE_CHANGE_EVENT = "loftn8:venue-change";
export const STAFF_VENUE_CHANGE_EVENT = "loftn8:staff-venue-change";

export const VENUE_OPTIONS = [
  { slug: "loft-zizkov", name: "LoftN8 Žižkov", shortName: "Žižkov" },
  { slug: "loft-garden", name: "LoftN8 Garden", shortName: "Garden" },
  { slug: "loft-nekazanka", name: "LoftN8 Nekázanka", shortName: "Nekázanka" },
] as const;

export type VenueSlug = (typeof VENUE_OPTIONS)[number]["slug"];
export type VenueOption = {
  slug: VenueSlug;
  name: string;
  shortName: string;
  internalSlug?: string;
};

const DEFAULT_VENUE_SLUG: VenueSlug = "loft-zizkov";
const GUEST_STORAGE_KEY = "selectedGuestVenueSlug";
const LEGACY_STORAGE_KEY = "selectedVenueSlug";
const STAFF_STORAGE_KEY = "selectedStaffVenueSlug";
const TABLE_STORAGE_KEY = "tableCode";
const CATALOG_STORAGE_KEY = "loftn8VenueCatalog";

let venueCatalogCache: VenueOption[] | null = null;

const VENUE_ALIAS_MAP: Record<string, VenueSlug> = {
  pilot: "loft-zizkov",
  zizkov: "loft-zizkov",
  "loft-zizkov": "loft-zizkov",
  garden: "loft-garden",
  "loft-garden": "loft-garden",
  nekazanka: "loft-nekazanka",
  "loft-nekazanka": "loft-nekazanka",
};

export function resolveVenueSlug(raw?: string | null): VenueSlug | null {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (!key) return null;
  return VENUE_ALIAS_MAP[key] ?? null;
}

function normalizeVenueSlug(raw?: string | null): VenueSlug {
  return resolveVenueSlug(raw) ?? DEFAULT_VENUE_SLUG;
}

function byDefaultOrder(options: VenueOption[]) {
  const rank = new Map(VENUE_OPTIONS.map((venue, index) => [venue.slug, index]));
  return [...options].sort((a, b) => (rank.get(a.slug) ?? 999) - (rank.get(b.slug) ?? 999));
}

function normalizeVenueCatalog(input: unknown): VenueOption[] {
  if (!Array.isArray(input)) return [...VENUE_OPTIONS];

  const deduped = new Map<VenueSlug, VenueOption>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    const rawSlug = "slug" in item ? (item as any).slug : null;
    const slug = normalizeVenueSlug(rawSlug);
    if (deduped.has(slug)) continue;

    const fallback = VENUE_OPTIONS.find((venue) => venue.slug === slug);
    deduped.set(slug, {
      slug,
      name:
        typeof (item as any).name === "string" && (item as any).name.trim()
          ? String((item as any).name).trim()
          : fallback?.name ?? "LoftN8 Žižkov",
      shortName:
        typeof (item as any).shortName === "string" && (item as any).shortName.trim()
          ? String((item as any).shortName).trim()
          : fallback?.shortName ?? "Žižkov",
      internalSlug:
        typeof (item as any).internalSlug === "string" && (item as any).internalSlug.trim()
          ? String((item as any).internalSlug).trim()
          : undefined,
    });
  }

  for (const fallback of VENUE_OPTIONS) {
    if (!deduped.has(fallback.slug)) {
      deduped.set(fallback.slug, { ...fallback });
    }
  }

  return byDefaultOrder(Array.from(deduped.values()));
}

function readStoredCatalog(): VenueOption[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return null;
    return normalizeVenueCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredCatalog(catalog: VenueOption[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // ignore storage failures
  }
}

export function getVenueCatalog(): VenueOption[] {
  if (venueCatalogCache) return venueCatalogCache;

  const stored = readStoredCatalog();
  venueCatalogCache = stored ?? [...VENUE_OPTIONS];
  return venueCatalogCache;
}

export async function refreshVenueCatalog(): Promise<VenueOption[]> {
  if (typeof window === "undefined") return getVenueCatalog();

  try {
    const res = await fetch("/api/guest/branches", {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      return getVenueCatalog();
    }

    const data = await res.json();
    const catalog = normalizeVenueCatalog(data?.branches);
    venueCatalogCache = catalog;
    writeStoredCatalog(catalog);
    return catalog;
  } catch {
    return getVenueCatalog();
  }
}

function readStoredSlug(key: string): VenueSlug | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(key);
    return value ? normalizeVenueSlug(value) : null;
  } catch {
    return null;
  }
}

function writeStoredSlug(key: string, slug: string | null) {
  if (typeof window === "undefined") return;

  if (!slug) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, normalizeVenueSlug(slug));
}

export function getStoredVenueSlug(): VenueSlug | null {
  return readStoredSlug(GUEST_STORAGE_KEY) ?? readStoredSlug(LEGACY_STORAGE_KEY);
}

export function getStoredStaffVenueSlug(): VenueSlug | null {
  return readStoredSlug(STAFF_STORAGE_KEY) ?? getStoredVenueSlug();
}

export function hasVenueSelection() {
  return getStoredVenueSlug() !== null;
}

export function getVenueSlug() {
  return getStoredVenueSlug() ?? DEFAULT_VENUE_SLUG;
}

export function getStaffVenueSlug() {
  return getStoredStaffVenueSlug() ?? DEFAULT_VENUE_SLUG;
}

export function setVenueSlug(slug: string | null) {
  if (typeof window === "undefined") return;

  try {
    const prev = getStoredVenueSlug();
    const resolved = resolveVenueSlug(slug);

    if (!resolved) {
      window.localStorage.removeItem(GUEST_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      window.localStorage.removeItem(TABLE_STORAGE_KEY);
    } else {
      const next = resolved;
      writeStoredSlug(GUEST_STORAGE_KEY, next);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      if (prev && prev !== next) {
        window.localStorage.removeItem(TABLE_STORAGE_KEY);
      }
    }

    window.dispatchEvent(
      new CustomEvent(VENUE_CHANGE_EVENT, {
        detail: {
          prevSlug: prev,
          slug: getStoredVenueSlug(),
        },
      })
    );
  } catch {
    // ignore storage failures
  }
}

export function setStaffVenueSlug(slug: string | null) {
  if (typeof window === "undefined") return;

  try {
    const prev = getStoredStaffVenueSlug();
    const resolved = resolveVenueSlug(slug);
    writeStoredSlug(STAFF_STORAGE_KEY, resolved);
    window.dispatchEvent(
      new CustomEvent(STAFF_VENUE_CHANGE_EVENT, {
        detail: {
          prevSlug: prev,
          slug: getStoredStaffVenueSlug(),
        },
      })
    );
  } catch {
    // ignore storage failures
  }
}

export function getVenueName(raw?: string | null) {
  const slug = normalizeVenueSlug(raw ?? getVenueSlug());
  return getVenueCatalog().find((venue) => venue.slug === slug)?.name ?? "LoftN8 Žižkov";
}

export function getVenueShortName(raw?: string | null) {
  const slug = normalizeVenueSlug(raw ?? getVenueSlug());
  return getVenueCatalog().find((venue) => venue.slug === slug)?.shortName ?? "Žižkov";
}
