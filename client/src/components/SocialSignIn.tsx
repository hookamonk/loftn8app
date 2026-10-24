"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * "Continue with Google / Apple" for guests. Each button appears only when the
 * server has that provider configured (GET /auth/guest/providers). The button
 * hands back the provider's ID token; the page sends it to the server, which
 * verifies it and signs the guest in.
 *
 * Google: Google Identity Services renders its own button (required for an ID
 * token). Apple: Sign in with Apple JS in popup mode.
 */

export type SocialToken = { provider: "google" | "apple"; token: string; name?: string };

type Providers = {
  google: { clientId: string } | null;
  apple: { clientId: string } | null;
};

type GoogleIdApi = {
  initialize: (config: Record<string, unknown>) => void;
  renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
};

type AppleIdApi = {
  auth: {
    init: (config: Record<string, unknown>) => void;
    signIn: () => Promise<{
      authorization?: { id_token?: string };
      user?: { name?: { firstName?: string; lastName?: string } };
    }>;
  };
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
    AppleID?: AppleIdApi;
  }
}

const GOOGLE_SRC = "https://accounts.google.com/gsi/client";
const APPLE_SRC = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string) {
  const existing = scripts.get(src);
  if (existing) return existing;

  const pending = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scripts.delete(src);
      reject(new Error("SCRIPT_LOAD_FAILED"));
    };
    document.head.appendChild(el);
  });
  scripts.set(src, pending);
  return pending;
}

let providersCache: Promise<Providers | null> | null = null;

function loadProviders() {
  providersCache ??= api<{ ok: true } & Providers>("/auth/guest/providers")
    .then((r) => ({ google: r.google ?? null, apple: r.apple ?? null }))
    .catch(() => {
      providersCache = null;
      return null;
    });
  return providersCache;
}

function AppleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
      <path d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-57-156-127C44 791 0 669 0 553c0-186 121-285 240-285 63 0 116 42 156 42 38 0 97-44 169-44 27 0 126 2 191 75zM553 167c30-35 51-84 51-133 0-7 0-14-2-20-48 2-106 32-140 72-27 31-53 80-53 130 0 8 1 15 2 18 3 1 9 1 14 1 43 0 97-29 128-68z" />
    </svg>
  );
}

export function SocialSignIn({
  mode,
  isCz,
  disabled,
  onToken,
  onError,
}: {
  mode: "login" | "register";
  isCz: boolean;
  disabled?: boolean;
  onToken: (token: SocialToken) => void;
  onError: (message: string) => void;
}) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const googleRef = useRef<HTMLDivElement | null>(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
  }, [onToken, onError]);

  useEffect(() => {
    let active = true;
    void loadProviders().then((p) => {
      if (active) setProviders(p);
    });
    return () => {
      active = false;
    };
  }, []);

  // Google renders its own button into the placeholder.
  const googleClientId = providers?.google?.clientId ?? null;
  useEffect(() => {
    if (!googleClientId || !googleRef.current) return;
    let active = true;
    const el = googleRef.current;

    loadScript(GOOGLE_SRC)
      .then(() => {
        const gis = window.google?.accounts?.id;
        if (!active || !gis) return;
        gis.initialize({
          client_id: googleClientId,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response: { credential?: string }) => {
            if (response.credential) onTokenRef.current({ provider: "google", token: response.credential });
          },
        });
        el.innerHTML = "";
        gis.renderButton(el, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: mode === "login" ? "signin_with" : "continue_with",
          logo_alignment: "center",
          width: Math.min(400, Math.max(200, Math.round(el.getBoundingClientRect().width))),
          locale: isCz ? "cs" : "en",
        });
      })
      .catch(() => {
        if (active) onErrorRef.current(isCz ? "Google se nepodařilo načíst." : "Couldn't load Google sign-in.");
      });

    return () => {
      active = false;
    };
  }, [googleClientId, mode, isCz]);

  const appleClientId = providers?.apple?.clientId ?? null;

  const signInWithApple = async () => {
    if (!appleClientId) return;
    try {
      await loadScript(APPLE_SRC);
      const apple = window.AppleID;
      if (!apple) throw new Error("NO_APPLE");
      apple.auth.init({
        clientId: appleClientId,
        scope: "name email",
        redirectURI: `${window.location.origin}/auth`,
        usePopup: true,
      });
      const result = await apple.auth.signIn();
      const token = result.authorization?.id_token;
      if (!token) return;
      const name = [result.user?.name?.firstName, result.user?.name?.lastName].filter(Boolean).join(" ").trim();
      onTokenRef.current({ provider: "apple", token, name: name || undefined });
    } catch (error) {
      // Closing the Apple window is not an error.
      const code = (error as { error?: string } | null)?.error ?? "";
      if (code === "popup_closed_by_user" || code === "user_cancelled_authorize") return;
      onErrorRef.current(isCz ? "Přihlášení přes Apple se nezdařilo." : "Apple sign-in failed.");
    }
  };

  if (!providers || (!providers.google && !providers.apple)) return null;

  return (
    <div className={disabled ? "pointer-events-none opacity-50" : ""}>
      <div className="grid gap-2">
        {providers.google ? <div ref={googleRef} className="flex h-11 w-full items-center justify-center" /> : null}
        {providers.apple ? (
          <button
            type="button"
            onClick={() => void signInWithApple()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black transition active:scale-[0.99]"
          >
            <AppleLogo />
            {mode === "login"
              ? isCz
                ? "Přihlásit se přes Apple"
                : "Sign in with Apple"
              : isCz
                ? "Pokračovat přes Apple"
                : "Continue with Apple"}
          </button>
        ) : null}
      </div>

      <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-white/35">
        <span className="h-px flex-1 bg-white/10" />
        {isCz ? "nebo e-mailem" : "or with e-mail"}
        <span className="h-px flex-1 bg-white/10" />
      </div>
    </div>
  );
}
