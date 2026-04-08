export const VENUE_CHANGE_EVENT = "loftn8:venue-change";

export const VENUE_OPTIONS = [{ slug: "pilot", name: "Loft№8 Žižkov", shortName: "Žižkov" }] as const;

export function getVenueSlug() {
  return "pilot";
}

export function setVenueSlug(_slug: string | null) {
  // single-venue mode
}

export function getVenueName(_slug?: string | null) {
  return "Loft№8 Žižkov";
}

export function getVenueShortName(_slug?: string | null) {
  return "Žižkov";
}
