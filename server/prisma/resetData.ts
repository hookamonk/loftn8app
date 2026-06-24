/**
 * Fresh-start data reset.
 *
 * Wipes all runtime / user data (guest accounts, sessions, shifts, orders,
 * calls, payments, loyalty, ratings, OTP codes, staff push subscriptions) so
 * the app behaves like brand new — WITHOUT touching configuration that the app
 * needs to run: venues, tables, menu categories/items and staff logins.
 *
 * No cascade deletes exist in the schema, so rows are removed children-first
 * inside a single transaction. If any FK ordering is wrong the whole thing
 * rolls back and nothing is changed.
 *
 *   npm run prisma:reset
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function counts() {
  const [
    users,
    sessions,
    shifts,
    orders,
    calls,
    payments,
    loyalty,
    ratings,
    pushSubs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.guestSession.count(),
    prisma.shift.count(),
    prisma.order.count(),
    prisma.staffCall.count(),
    prisma.paymentRequest.count(),
    prisma.loyaltyTransaction.count(),
    prisma.rating.count(),
    prisma.staffPushSubscription.count(),
  ]);
  return { users, sessions, shifts, orders, calls, payments, loyalty, ratings, pushSubs };
}

async function main() {
  const before = await counts();
  console.log("→ before:", before);

  // Preserved config (NOT deleted):
  const [venues, tables, categories, items, staff] = await Promise.all([
    prisma.venue.count(),
    prisma.table.count(),
    prisma.menuCategory.count(),
    prisma.menuItem.count(),
    prisma.staffUser.count(),
  ]);
  console.log("→ keeping config:", { venues, tables, categories, items, staff });

  // Children first → parents. No cascades in the schema, so order matters.
  await prisma.$transaction([
    prisma.loyaltyTransaction.deleteMany({}),
    prisma.paymentConfirmation.deleteMany({}),
    prisma.paymentRequest.deleteMany({}),
    prisma.orderItem.deleteMany({}),
    prisma.order.deleteMany({}),
    prisma.staffCall.deleteMany({}),
    prisma.rating.deleteMany({}),
    prisma.shiftParticipant.deleteMany({}),
    prisma.guestSession.deleteMany({}),
    prisma.shift.deleteMany({}),
    prisma.otpCode.deleteMany({}),
    prisma.staffPushSubscription.deleteMany({}),
    prisma.user.deleteMany({}),
  ]);

  const after = await counts();
  console.log("→ after:", after);
  console.log("✅ Data reset done — venues, tables, menu and staff logins kept intact.");
}

main()
  .catch((e) => {
    console.error("❌ Reset failed (no changes committed):", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });