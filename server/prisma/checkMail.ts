/**
 * Verify that outgoing e-mail actually works, without registering a guest.
 *
 *   npm run mail:check                 → connect + authenticate only
 *   npm run mail:check you@mail.com    → also send a real test message
 *
 * Run it in the Render shell after changing SMTP settings: if this passes,
 * guest sign-up codes will arrive.
 */
import "dotenv/config";
import { isEmailConfigured, missingEmailSettings, sendGuestOtpEmail, verifyEmailTransport } from "../src/utils/mailer";

async function main() {
  if (!isEmailConfigured()) {
    console.error(`❌ SMTP is not configured. Missing: ${missingEmailSettings().join(", ")}`);
    process.exit(1);
  }

  console.log(`→ connecting to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}…`);
  await verifyEmailTransport();
  console.log("✅ connection and login OK");

  const to = process.argv[2];
  if (!to) {
    console.log("ℹ️  Pass an address to also send a test message: npm run mail:check you@mail.com");
    return;
  }

  console.log(`→ sending a test code to ${to}…`);
  await sendGuestOtpEmail({ to, guestName: "Test", code: "123456", purpose: "verification" });
  console.log("✅ sent — check the inbox (and the spam folder)");
}

main().catch((error) => {
  console.error("❌ mail check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
