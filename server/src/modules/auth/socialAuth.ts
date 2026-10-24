import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../../config/env";
import { HttpError } from "../../utils/httpError";

/**
 * "Sign in with Google / Apple" for guests. The browser gets an ID token from
 * Google or Apple and hands it to us; we only trust it after checking its
 * signature against the provider's published keys, its issuer, its audience
 * (our own client ID) and its expiry.
 */

export type SocialProvider = "google" | "apple";

export type SocialIdentity = {
  provider: SocialProvider;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

export function socialProvidersConfig() {
  return {
    google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : null,
    apple: env.APPLE_CLIENT_ID ? { clientId: env.APPLE_CLIENT_ID } : null,
  };
}

let googleKeys: ReturnType<typeof createRemoteJWKSet> | null = null;
let appleKeys: ReturnType<typeof createRemoteJWKSet> | null = null;

function isTrue(value: unknown) {
  return value === true || value === "true";
}

function stringClaim(payload: JWTPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function verifyOrThrow(token: string, keys: ReturnType<typeof createRemoteJWKSet>, issuer: string[], audience: string) {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience, clockTolerance: 60 });
    if (!payload.sub) throw new Error("NO_SUB");
    return payload;
  } catch {
    throw new HttpError(401, "SOCIAL_TOKEN_INVALID", "Sign-in token is invalid or expired");
  }
}

export async function verifyGoogleCredential(credential: string): Promise<SocialIdentity> {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(404, "SOCIAL_DISABLED", "Google sign-in is not enabled");
  googleKeys ??= createRemoteJWKSet(new URL(env.GOOGLE_JWKS_URL));

  const payload = await verifyOrThrow(
    credential,
    googleKeys,
    ["https://accounts.google.com", "accounts.google.com"],
    env.GOOGLE_CLIENT_ID
  );

  return {
    provider: "google",
    sub: payload.sub!,
    email: stringClaim(payload, "email"),
    emailVerified: isTrue(payload.email_verified),
    name: stringClaim(payload, "name") ?? stringClaim(payload, "given_name"),
  };
}

export async function verifyAppleIdToken(idToken: string): Promise<SocialIdentity> {
  if (!env.APPLE_CLIENT_ID) throw new HttpError(404, "SOCIAL_DISABLED", "Apple sign-in is not enabled");
  appleKeys ??= createRemoteJWKSet(new URL(env.APPLE_JWKS_URL));

  const payload = await verifyOrThrow(idToken, appleKeys, ["https://appleid.apple.com"], env.APPLE_CLIENT_ID);

  // Apple puts the name only into the very first sign-in response, outside the
  // token — the caller passes it separately.
  return {
    provider: "apple",
    sub: payload.sub!,
    email: stringClaim(payload, "email"),
    emailVerified: isTrue(payload.email_verified),
    name: null,
  };
}
