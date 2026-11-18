import type { CallType, MenuSection, StaffRole } from "@prisma/client";

/**
 * Who does what on the floor. Every permission check of the staff API goes
 * through these helpers, so a role's reach is defined in one place.
 *
 *   WAITER       punches food, drinks and hookahs, carries food + drinks out,
 *                takes the bill (sees hookahs being made, does nothing with them)
 *   HOOKAH       punches hookahs, prepares and carries them, hookah calls only
 *   KITCHEN      tablet: accepts and finishes food tickets
 *   BAR          tablet: drink tickets on the left, hookah tickets and hookah
 *                calls on the right — there is no separate hookah-zone tablet
 *   HOOKAH_ZONE  tablet: hookah tickets and hookah calls (if one is ever set up)
 *   MANAGER      sees everything, can move any ticket, the only one who cancels
 *
 * A hookah is carried out by whoever made it: its «Готово» puts it on the
 * table at once (see moveTicket) — there is no «Выдано» step for hookahs.
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

/** What a station tablet works on. The bar tablet takes the hookahs too. */
export function stationSectionsOfRole(role: StaffRole): MenuSection[] {
  if (role === "KITCHEN") return ["DISHES"];
  if (role === "BAR") return ["DRINKS", "HOOKAH"];
  if (role === "HOOKAH_ZONE") return ["HOOKAH"];
  return [];
}

export function isStationRole(role: StaffRole) {
  return stationSectionsOfRole(role).length > 0;
}

/** Roles that accept a ticket and mark it ready. */
export function prepareRolesFor(section: MenuSection): StaffRole[] {
  return section === "HOOKAH" ? ["BAR", "HOOKAH_ZONE", "HOOKAH"] : [STATION_ROLE_BY_SECTION[section]];
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
  const stations = stationSectionsOfRole(role);
  if (stations.length) return stations;
  if (role === "HOOKAH") return ["HOOKAH"];
  // Waiters see hookahs too (status and ready time only — no button, no alert).
  return ALL_SECTIONS;
}

/** Menu sections the role may punch in at a table. Stations punch nothing. */
export function orderSectionsForRole(role: StaffRole): MenuSection[] {
  if (isStationRole(role)) return [];
  if (role === "HOOKAH") return ["HOOKAH"];
  // Waiters punch hookahs too (the hookah goes on the table's bill).
  return ALL_SECTIONS;
}

/**
 * Service calls each role answers. A guest asking to order (WAITER call) is not
 * listed here — it lands in the Orders tab of whoever takes order requests.
 */
export function callTypesForRole(role: StaffRole): CallType[] {
  if (role === "WAITER") return ["BILL", "HELP"];
  // Hookah calls: hookah masters and the tablet that takes the hookahs.
  if (role === "HOOKAH" || role === "HOOKAH_ZONE" || role === "BAR") return ["HOOKAH"];
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
