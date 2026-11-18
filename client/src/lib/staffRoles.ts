import type { StaffRole } from "@/providers/staffSession";
import type { MenuSection } from "@/types";

/**
 * Mirror of server/src/modules/staff/roles.ts — what each staff account sees
 * and may do. The server enforces it; the client only uses it to decide which
 * screen and which single button to show.
 */

export const STATION_LABEL: Record<MenuSection, string> = {
  DISHES: "Кухня",
  DRINKS: "Бар",
  HOOKAH: "Кальян",
};

const STATION_SCREEN_TITLE: Record<MenuSection, string> = {
  DISHES: "Кухня",
  DRINKS: "Бар",
  HOOKAH: "Кальянная зона",
};

export function roleLabel(role?: StaffRole | string | null) {
  switch (role) {
    case "WAITER":
      return "Официант";
    case "HOOKAH":
      return "Кальянщик";
    case "MANAGER":
      return "Менеджер";
    case "ADMIN":
      return "Администратор";
    case "KITCHEN":
      return "Кухня";
    case "BAR":
      return "Бар";
    case "HOOKAH_ZONE":
      return "Кальянная зона";
    default:
      return "Персонал";
  }
}

export function stationOfRole(role?: StaffRole | null): MenuSection | null {
  if (role === "KITCHEN") return "DISHES";
  if (role === "BAR") return "DRINKS";
  if (role === "HOOKAH_ZONE") return "HOOKAH";
  return null;
}

export function isStationRole(role?: StaffRole | null) {
  return stationOfRole(role) !== null;
}

export function stationScreenTitle(role?: StaffRole | null) {
  const station = stationOfRole(role);
  return station ? STATION_SCREEN_TITLE[station] : roleLabel(role);
}

/** Where an account lands after login. */
export function homeForRole(role?: StaffRole | null) {
  if (role === "ADMIN") return "/staff/admin";
  if (isStationRole(role)) return "/staff/station";
  return "/staff/summary";
}

export function canPrepare(role: StaffRole | undefined, section: MenuSection) {
  if (role === "MANAGER") return true;
  if (section === "HOOKAH") return role === "HOOKAH_ZONE" || role === "HOOKAH";
  return stationOfRole(role) === section;
}

export function canDeliver(role: StaffRole | undefined, section: MenuSection) {
  if (role === "MANAGER") return true;
  return section === "HOOKAH" ? role === "HOOKAH" : role === "WAITER";
}

export function canCancelItems(role?: StaffRole | null) {
  return role === "MANAGER";
}

export function canTakeOrderRequests(role?: StaffRole | null) {
  return role === "WAITER" || role === "MANAGER" || role === "ADMIN";
}

/** Menu sections the account may punch in. */
export function orderSectionsForRole(role?: StaffRole | null): MenuSection[] {
  if (isStationRole(role)) return [];
  if (role === "HOOKAH") return ["HOOKAH"];
  // Waiters punch hookahs too (the hookah goes on the table's bill).
  return ["DISHES", "DRINKS", "HOOKAH"];
}
