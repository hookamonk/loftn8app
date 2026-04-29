import { env } from "../config/env";
import { HttpError } from "./httpError";

const nodemailer = require("nodemailer") as any;

function smtpConfigured() {
  return Boolean(
    env.SMTP_HOST &&
      env.SMTP_PORT &&
      env.SMTP_USER &&
      env.SMTP_PASS &&
      env.SMTP_FROM_EMAIL
  );
}

function getTransport() {
  if (!smtpConfigured()) {
    throw new HttpError(
      503,
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured on the server"
    );
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

export async function sendGuestOtpEmail(params: {
  to: string;
  guestName?: string | null;
  code: string;
  purpose?: "verification" | "password-reset";
}) {
  const transporter = getTransport();
  const appName = env.SMTP_FROM_NAME || "LoftN8";
  const guestName = String(params.guestName ?? "").trim();
  const greeting = guestName ? `Hello, ${guestName}` : "Hello";
  const purpose = params.purpose ?? "verification";
  const subject =
    purpose === "password-reset"
      ? `${appName} password reset code`
      : `${appName} verification code`;
  const intro =
    purpose === "password-reset"
      ? `Your password reset code for ${appName}:`
      : `Your verification code for ${appName}:`;
  const footer =
    purpose === "password-reset"
      ? "If you did not request a password reset, you can ignore this email."
      : "If you did not request this code, you can ignore this email.";

  await transporter.sendMail({
    from: {
      name: appName,
      address: env.SMTP_FROM_EMAIL,
    },
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
}
