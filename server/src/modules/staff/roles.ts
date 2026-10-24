import type { CallType, MenuSection, StaffRole } from "@prisma/client";

/**
 * Who does what on the floor. Every permission check of the staff API goes
 * through these helpers, so a role's reach is defined in one place.
 *
 *   WAITER       punches food + drinks, carries them out, takes the bill
 *   HOOKAH       punches hookahs, prepares and carries them, hookah calls only
 *                (the hookah-zone iPad sees those calls too)
 *   KITCHEN      iPad: accepts and finishes food tickets
 *   BAR          iPad: accepts and finishes drink tickets
 *   HOOKAH_ZONE  iPad: accepts and finishes hookah tickets
 *   MANAGER      sees everything, can move any ticket, the only one who cancels
 */

const ALL_SECTIONS: MenuSection[] = ["DISHES", "DRINKS", "HOOKAH"];

export const STATION_ROLE_BY_SECTION: Record<MenuSection, StaffRole> = {
  DISHES: "KITCHEN",
  DRINKS: "BAR",
  HOOKAH: "HOOKAH_ZONE",
};

export const SECTION_LABEL: Record<MenuSection, string> = {
  DISHES: "Кухня",
  DRINKS: "Бар",
  HOOKAH: "Кальян",
};

export function stationOfRole(role: StaffRole): MenuSection | null {
  if (role === "KITCHEN") return "DISHES";
  if (role === "BAR") return "DRINKS";
  if (role === "HOOKAH_ZONE") return "HOOKAH";
  return null;
}

export function isStationRole(role: StaffRole) {
  return stationOfRole(role) !== null;
}

/** Roles that accept a ticket and mark it ready. */
export function prepareRolesFor(section: MenuSection): StaffRole[] {
  return section === "HOOKAH" ? ["HOOKAH_ZONE", "HOOKAH"] : [STATION_ROLE_BY_SECTION[section]];
}

/** Roles that carry a ready ticket to the table. */
export function deliverRolesFor(section: MenuSection): StaffRole[] {
  return section === "HOOKAH" ? ["HOOKAH"] : ["WAITER"];
}

export function canPrepare(role: StaffRole, section: MenuSection) {
  return role === "MANAGER" || prepareRolesFor(section).includes(role);
}

export function canDeliver(role: StaffRole, section: MenuSection) {
  return role === "MANAGER" || deliverRolesFor(section).includes(role);
}

export function canCancelItems(role: StaffRole) {
  return role === "MANAGER";
}

/** Station tickets shown on the role's order screen. */
export function ticketSectionsForRole(role: StaffRole): MenuSection[] {
  const station = stationOfRole(role);
  if (station) return [station];
  if (role === "HOOKAH") return ["HOOKAH"];
  if (role === "WAITER") return ["DISHES", "DRINKS"];
  return ALL_SECTIONS;
}

/** Menu sections the role may punch in at a table. Stations punch nothing. */
export function orderSectionsForRole(role: StaffRole): MenuSection[] {
  if (isStationRole(role)) return [];
  if (role === "HOOKAH") return ["HOOKAH"];
  if (role === "WAITER") return ["DISHES", "DRINKS"];
  return ALL_SECTIONS;
}

/**
 * Service calls each role answers. A guest asking to order (WAITER call) is not
 * listed here — it lands in the Orders tab of whoever takes order requests.
 */
export function callTypesForRole(role: StaffRole): CallType[] {
  if (role === "WAITER") return ["BILL", "HELP"];
  if (role === "HOOKAH" || role === "HOOKAH_ZONE") return ["HOOKAH"];
  if (role === "MANAGER" || role === "ADMIN") return ["HOOKAH", "BILL", "HELP"];
  return [];
}

export function canTakeOrderRequests(role: StaffRole) {
  return role === "WAITER" || role === "MANAGER" || role === "ADMIN";
}

/** Bills, payment confirmation, card ↔ cash. */
export function canHandlePayments(role: StaffRole) {
  return role === "WAITER" || role === "MANAGER" || role === "ADMIN";
}

/** Tables board and table detail. */
export function canWorkTables(role: StaffRole) {
  return !isStationRole(role);
}
