// Temporary guest-side maintenance mode. ON by default; turn OFF by setting
// NEXT_PUBLIC_MAINTENANCE_MODE=false on the client host (Vercel) and redeploying.
// Staff app is never affected.
export const MAINTENANCE_MODE =
  (process.env.NEXT_PUBLIC_MAINTENANCE_MODE ?? "true").toLowerCase() === "true";

// Where the "Menu" button on the maintenance screen sends guests.
export const MAINTENANCE_MENU_URL = "https://loftn8.cz/zizkov#!/tab/1752977501-1";
