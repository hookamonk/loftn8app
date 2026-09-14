import { env } from "../config/env";
import { HttpError } from "./httpError";

/**
 * Transactional e-mail for guest sign-up and password reset.
 *
 * The one-time code IS the registration, so a silent mail failure means nobody
 * can sign up. Every failure path here therefore ends in a clear, actionable
 * error — never a response that pretends the code was sent.
 */

// nodemailer ships no bundled types and @types/nodemailer isn't a dependency,
// so the surface we use is declared locally instead of leaking `any` around.
type Transport = {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
  verify(): Promise<true>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require("nodemailer") as {
  createTransport(options: Record<string, unknown>): Transport;
};

export function isEmailConfigured() {
  return Boolean(
    env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM_EMAIL
  );
}

/** Names the variables that are missing, so a misconfiguration is obvious. */
export function missingEmailSettings(): string[] {
  const required: Array<[string, unknown]> = [
    ["SMTP_HOST", env.SMTP_HOST],
    ["SMTP_PORT", env.SMTP_PORT],
    ["SMTP_USER", env.SMTP_USER],
    ["SMTP_PASS", env.SMTP_PASS],
    ["SMTP_FROM_EMAIL", env.SMTP_FROM_EMAIL],
  ];

  return required.filter(([, value]) => !value).map(([name]) => name);
}

let transport: Transport | null = null;

function getTransport(): Transport {
  if (!isEmailConfigured()) {
    throw new HttpError(
      503,
      "EMAIL_NOT_CONFIGURED",
      `Email delivery is not configured on the server (missing: ${missingEmailSettings().join(", ")})`
    );
  }

  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Fail fast instead of hanging the sign-up request when SMTP is slow or
    // unreachable — the guest gets a clear error, not a frozen form.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return transport;
}

/** Open a connection and authenticate, without sending anything. */
export async function verifyEmailTransport() {
  await getTransport().verify();
}

export async function sendGuestOtpEmail(params: {
  to: string;
  guestName?: string | null;
  code: string;
  purpose?: "verification" | "password-reset";
}) {
  const appName = env.SMTP_FROM_NAME || "LOFT№8";
  const guestName = String(params.guestName ?? "").trim();
  const greeting = guestName ? `Hello, ${guestName}` : "Hello";
  const isReset = (params.purpose ?? "verification") === "password-reset";

  const subject = isReset ? `${appName} password reset code` : `${appName} verification code`;
  const intro = isReset
    ? `Your password reset code for ${appName}:`
    : `Your verification code for ${appName}:`;
  const footer = isReset
    ? "If you did not request a password reset, you can ignore this email."
    : "If you did not request this code, you can ignore this email.";

  try {
    await getTransport().sendMail({
      from: { name: appName, address: env.SMTP_FROM_EMAIL },
      to: params.to,
      subject,
      text: [
        `${greeting}!`,
        "",
        intro,
        params.code,
        "",
        "This code is valid for 10 minutes.",
        "",
        footer,
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <p>${greeting}!</p>
          <p>${intro.replace(appName, `<strong>${appName}</strong>`)}</p>
          <div style="display:inline-block;padding:14px 18px;border-radius:12px;background:#111;color:#fff;font-size:28px;font-weight:700;letter-spacing:6px;">
            ${params.code}
          </div>
          <p style="margin-top:16px;">This code is valid for 10 minutes.</p>
          <p style="color:#666;">${footer}</p>
        </div>
      `,
    });
  } catch (error) {
    // A misconfiguration is already an HttpError with a useful message; keep it.
    if (error instanceof HttpError) throw error;

    // Everything else (bad credentials, refused relay, timeout) is logged in
    // full for the operator and surfaced to the guest as something they can act
    // on, instead of a bare 500.
    console.error("SMTP send failed", {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      to: params.to,
      error: error instanceof Error ? error.message : error,
    });

    throw new HttpError(
      502,
      "EMAIL_SEND_FAILED",
      "Could not send the code by email. Please try again in a moment."
    );
  }
}
