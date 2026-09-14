"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ensureBackendWarm } from "@/lib/backendWarmup";
import { markAnonBypassAuthOnce } from "@/lib/guestFlow";
import { getVenueName } from "@/lib/venue";
import { useToast } from "@/providers/toast";
import { useAuth } from "@/providers/auth";
import { useSession } from "@/providers/session";
import { useI18n } from "@/providers/i18n";
import { useEscapeToClose } from "@/lib/useModalA11y";
import type { GuestUser } from "@/types";

/**
 * Guest sign-up and sign-in.
 *
 *   Register → name, e-mail, password, consent → code from the inbox → done.
 *   Sign in  → e-mail + password. Nothing else.
 *
 * Reached right after the QR scan when the guest isn't signed in yet; a guest
 * who already has an account never lands here at all.
 */

type Mode = "register" | "login" | "forgot";
type Step = "form" | "code";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function sanitizeNextPath(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/menu";
  if (value === "/auth") return "/menu";
  return value;
}

function humanError(message: string, isCz: boolean) {
  const raw = String(message || "");

  if (raw.includes("ACCOUNT_EXISTS"))
    return isCz ? "Tento účet už existuje. Přihlaste se." : "This account already exists. Please sign in.";
  if (raw.includes("NO_ACCOUNT"))
    return isCz ? "Účet nebyl nalezen. Zaregistrujte se." : "Account not found. Please register.";
  if (raw.includes("PASSWORD_INVALID")) return isCz ? "Nesprávné heslo." : "Incorrect password.";
  if (raw.includes("PASSWORD_NOT_SET"))
    return isCz ? "Pro tento účet není nastavené heslo." : "No password is set for this account.";
  if (raw.includes("OTP_TOO_MANY_ATTEMPTS"))
    return isCz ? "Příliš mnoho pokusů. Vyžádejte si nový kód." : "Too many attempts. Request a new code.";
  if (raw.includes("OTP_INVALID")) return isCz ? "Neplatný kód." : "Invalid code.";
  if (raw.includes("OTP_NOT_FOUND"))
    return isCz ? "Kód vypršel. Vyžádejte si nový." : "The code expired. Request a new one.";
  if (raw.includes("RATE_LIMITED"))
    return isCz
      ? "Příliš mnoho pokusů. Zkuste to prosím za pár minut."
      : "Too many attempts. Please try again in a few minutes.";
  if (raw.includes("EMAIL_NOT_CONFIGURED"))
    return isCz
      ? "Odesílání e-mailů zatím nefunguje. Řekněte to prosím obsluze."
      : "Email delivery isn't working. Please tell the staff.";
  if (raw.includes("EMAIL_SEND_FAILED"))
    return isCz
      ? "Kód se nepodařilo odeslat. Zkuste to prosím znovu."
      : "We couldn't send the code. Please try again.";
  if (raw.includes("EMAIL_INVALID")) return isCz ? "Neplatný e-mail." : "Invalid email.";
  if (raw.includes("EMAIL_REQUIRED")) return isCz ? "Zadejte e-mail." : "Enter your email.";
  if (raw.includes("CONSENT_REQUIRED"))
    return isCz ? "Musíte souhlasit se zpracováním údajů." : "You must agree to data processing.";
  if (raw.includes("NAME_REQUIRED")) return isCz ? "Zadejte jméno." : "Enter your name.";

  return raw || (isCz ? "Něco se pokazilo." : "Something went wrong.");
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
  trailing?: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-white/60">{label}</div>
      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-4 focus-within:border-white/25">
        <input
          value={value}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
        />
        {trailing}
      </div>
    </label>
  );
}

const btnPrimary =
  "h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40";
const btnGhost =
  "h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/80 transition hover:text-white disabled:opacity-40";

export default function AuthPage() {
  const router = useRouter();
  const { isCz, ready } = useI18n();
  const { push } = useToast();
  const { me, loading, setAuthenticated } = useAuth();
  const { restoreSession } = useSession();

  const [nextPath, setNextPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("register");
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  // Development only: with no SMTP the server hands the code back so the flow
  // is testable. In production it refuses instead — it never leaks codes.
  const [devCode, setDevCode] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Mode | null>(null);
  const [anonOpen, setAnonOpen] = useState(false);

  useEscapeToClose(anonOpen, () => setAnonOpen(false));

  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const targetPath = nextPath ?? "/menu";
  const cabinetMode = nextPath === "/cabinet";

  useEffect(() => {
    if (typeof window === "undefined") return;
    setNextPath(sanitizeNextPath(new URLSearchParams(window.location.search).get("next")));
    void ensureBackendWarm();
  }, []);

  // Already signed in (e.g. came back to this URL) — go straight through.
  useEffect(() => {
    if (loading || !nextPath) return;
    if (me?.authenticated) router.replace(targetPath);
  }, [loading, me, nextPath, router, targetPath]);

  const resetErrors = () => {
    setErr(null);
    setSuggested(null);
  };

  const switchMode = (next: Mode) => {
    resetErrors();
    setMode(next);
    setStep("form");
    setCode("");
    setDevCode(null);
    setPassword("");
  };

  const fail = (error: unknown) => {
    const raw = error instanceof Error ? error.message : "";
    const message = humanError(raw, isCz);
    setErr(message);

    if (raw.includes("ACCOUNT_EXISTS")) {
      setSuggested("login");
      setStep("form");
    }
    if (raw.includes("NO_ACCOUNT")) {
      setSuggested("register");
      setStep("form");
    }

    push({ kind: "error", title: isCz ? "Chyba" : "Error", message });
  };

  const signedIn = async (user: GuestUser, title: string) => {
    setAuthenticated({ authenticated: true, user });
    await restoreSession().catch(() => {});
    push({ kind: "success", title, message: isCz ? "Vítejte!" : "Welcome!" });
    router.replace(targetPath);
  };

  const showCodeSent = (result: { devCode?: string }) => {
    setStep("code");

    if (result.devCode) {
      setCode(String(result.devCode));
      setDevCode(String(result.devCode));
      return;
    }

    setCode("");
    setDevCode(null);
    push({
      kind: "success",
      title: isCz ? "Kód odeslán" : "Code sent",
      message: isCz ? "Zkontrolujte e-mail." : "Check your email.",
    });
  };

  // --- actions -------------------------------------------------------------

  const canSubmitForm =
    !busy &&
    (mode === "register"
      ? name.trim().length >= 2 && isValidEmail(email) && password.trim().length >= 6 && consent
      : mode === "login"
        ? isValidEmail(email) && password.length > 0
        : isValidEmail(email));

  const canSubmitCode =
    !busy && code.trim().length >= 4 && (mode !== "forgot" || password.trim().length >= 6);

  const submitForm = async () => {
    if (!canSubmitForm) return;
    resetErrors();
    setBusy(true);

    try {
      if (mode === "login") {
        const result = await api<{ ok: true; user: GuestUser }>("/auth/guest/login-password", {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), password }),
        });
        await signedIn(result.user, isCz ? "Přihlášeno" : "Signed in");
        return;
      }

      if (mode === "forgot") {
        const result = await api<{ ok: true; devCode?: string }>("/auth/guest/request-password-reset", {
          method: "POST",
          body: JSON.stringify({ email: email.trim() }),
        });
        setPassword("");
        showCodeSent(result);
        return;
      }

      const result = await api<{ ok: true; devCode?: string }>("/auth/guest/request-otp", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      showCodeSent(result);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!canSubmitCode) return;
    resetErrors();
    setBusy(true);

    try {
      if (mode === "forgot") {
        const result = await api<{ ok: true; user: GuestUser }>("/auth/guest/reset-password", {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
        });
        await signedIn(result.user, isCz ? "Heslo změněno" : "Password updated");
        return;
      }

      const result = await api<{ ok: true; user: GuestUser }>("/auth/guest/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          code: code.trim(),
          consent,
        }),
      });
      await signedIn(result.user, isCz ? "Registrace hotová" : "You're registered");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const continueWithoutAccount = async () => {
    setAnonOpen(false);
    await restoreSession().catch(() => {});

    const session = await api<{ ok: boolean; session: unknown | null }>("/guest/me").catch(() => ({
      ok: false,
      session: null,
    }));

    if (session.ok && session.session) {
      router.replace("/menu");
      return;
    }

    markAnonBypassAuthOnce();
    router.replace("/");
  };

  // --- render --------------------------------------------------------------

  const title =
    mode === "register"
      ? isCz
        ? "Registrace"
        : "Register"
      : mode === "forgot"
        ? isCz
          ? "Obnovit heslo"
          : "Reset password"
        : isCz
          ? "Přihlášení"
          : "Sign in";

  return (
    <main className="min-h-dvh bg-[radial-gradient(80%_60%_at_50%_0%,rgba(255,255,255,0.07),transparent_60%)]">
      {anonOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={() => setAnonOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-gold/25 bg-[rgba(20,20,20,0.97)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-xl text-amber-200">★</div>

            <div className="mt-4 text-lg font-semibold text-white">
              {isCz ? "Pokračovat bez registrace?" : "Continue without an account?"}
            </div>

            <div className="mt-3 rounded-2xl border border-gold/20 bg-gold/10 p-3.5 text-sm leading-6 text-amber-50">
              {isCz
                ? "Uvidíte jen menu. Objednávat ani získávat cashback z útraty nebude možné."
                : "You'll only see the menu. Ordering and earning cashback won't be available."}
            </div>

            <div className="mt-4 grid gap-2">
              <button type="button" className={btnPrimary} onClick={() => setAnonOpen(false)}>
                {isCz ? "Zaregistrovat se" : "Register"}
              </button>
              <button type="button" className={btnGhost} onClick={() => void continueWithoutAccount()}>
                {isCz ? "Pokračovat jen s menu" : "Continue with menu only"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-5 flex flex-col items-center">
          <div className="mb-3 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5">
            <img src="/logo.svg" alt="LOFT№8" className="h-10 w-10 opacity-90" />
          </div>
          <div className="w-full">
            <div className="text-[11px] tracking-[0.24em] text-white/45">
              {cabinetMode ? "LOFT№8 ACCOUNT" : venueName}
            </div>
            <h1 className="mt-1 text-2xl font-bold text-white">
              {cabinetMode
                ? isCz
                  ? "Váš osobní účet"
                  : "Your personal account"
                : isCz
                  ? "Vítejte"
                  : "Welcome"}
            </h1>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[rgba(20,20,20,0.75)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-white">{title}</div>
            <button
              type="button"
              className="text-xs text-white/70 underline underline-offset-4"
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login"
                ? isCz
                  ? "Nemáte účet? Registrace"
                  : "No account? Register"
                : isCz
                  ? "Máte účet? Přihlásit se"
                  : "Have an account? Sign in"}
            </button>
          </div>

          {step === "form" ? (
            <>
              <div className="mt-4 grid gap-3">
                {mode === "register" ? (
                  <Input
                    label={isCz ? "Jméno a příjmení" : "Full name"}
                    value={name}
                    onChange={setName}
                    placeholder={isCz ? "Jan Novák" : "John Smith"}
                    autoComplete="name"
                  />
                ) : null}

                <Input
                  label="E-mail"
                  value={email}
                  onChange={setEmail}
                  type="email"
                  inputMode="email"
                  placeholder="name@email.com"
                  autoComplete="email"
                />

                {mode !== "forgot" ? (
                  <Input
                    label={isCz ? "Heslo" : "Password"}
                    value={password}
                    onChange={setPassword}
                    type={showPassword ? "text" : "password"}
                    placeholder={mode === "register" ? (isCz ? "Alespoň 6 znaků" : "At least 6 characters") : undefined}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    trailing={
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-white/60"
                        onClick={() => setShowPassword((shown) => !shown)}
                      >
                        {showPassword ? (isCz ? "Skrýt" : "Hide") : isCz ? "Zobrazit" : "Show"}
                      </button>
                    }
                  />
                ) : null}

                {mode === "register" ? (
                  <label className="mt-1 flex cursor-pointer items-start gap-3 text-xs leading-5 text-white/70">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-black/30"
                    />
                    <span>
                      {isCz
                        ? "Souhlasím se zpracováním osobních údajů"
                        : "I agree to the processing of my personal data"}
                    </span>
                  </label>
                ) : null}
              </div>

              {err ? (
                <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs leading-5 text-red-200">
                  <div>{err}</div>
                  {suggested ? (
                    <button
                      type="button"
                      className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"
                      onClick={() => switchMode(suggested)}
                    >
                      {suggested === "login"
                        ? isCz
                          ? "Přihlásit se"
                          : "Sign in"
                        : isCz
                          ? "Zaregistrovat se"
                          : "Register"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button disabled={!canSubmitForm} onClick={() => void submitForm()} className={`${btnPrimary} mt-4`}>
                {busy
                  ? isCz
                    ? "Moment…"
                    : "One moment…"
                  : mode === "register"
                    ? isCz
                      ? "Zaregistrovat se"
                      : "Register"
                    : mode === "forgot"
                      ? isCz
                        ? "Odeslat kód"
                        : "Send code"
                      : isCz
                        ? "Přihlásit se"
                        : "Sign in"}
              </button>

              {mode === "login" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => switchMode("forgot")}
                  className="mt-3 w-full text-xs text-white/55 underline underline-offset-4 disabled:opacity-50"
                >
                  {isCz ? "Zapomenuté heslo?" : "Forgot password?"}
                </button>
              ) : null}

              {mode === "forgot" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => switchMode("login")}
                  className="mt-3 w-full text-xs text-white/55 underline underline-offset-4 disabled:opacity-50"
                >
                  {isCz ? "Zpět na přihlášení" : "Back to sign in"}
                </button>
              ) : null}

              {mode === "register" && !cabinetMode ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAnonOpen(true)}
                  className={`${btnGhost} mt-2`}
                >
                  {isCz ? "Pokračovat bez registrace" : "Continue without an account"}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/65">
                {isCz ? "Poslali jsme kód na" : "We sent a code to"}{" "}
                <span className="font-semibold text-white">{email.trim()}</span>
              </div>

              {devCode ? (
                <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-amber-200/70">
                    {isCz ? "Vývojový režim" : "Development mode"}
                  </div>
                  <div className="mt-1 text-2xl font-bold tracking-[0.3em] text-amber-100">{devCode}</div>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3">
                <Input
                  label={isCz ? "Kód z e-mailu" : "Code from the email"}
                  value={code}
                  onChange={setCode}
                  inputMode="numeric"
                  placeholder="123456"
                  autoComplete="one-time-code"
                />

                {mode === "forgot" ? (
                  <Input
                    label={isCz ? "Nové heslo" : "New password"}
                    value={password}
                    onChange={setPassword}
                    type={showPassword ? "text" : "password"}
                    placeholder={isCz ? "Alespoň 6 znaků" : "At least 6 characters"}
                    autoComplete="new-password"
                    trailing={
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-white/60"
                        onClick={() => setShowPassword((shown) => !shown)}
                      >
                        {showPassword ? (isCz ? "Skrýt" : "Hide") : isCz ? "Zobrazit" : "Show"}
                      </button>
                    }
                  />
                ) : null}
              </div>

              {err ? (
                <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs leading-5 text-red-200">
                  {err}
                </div>
              ) : null}

              <button disabled={!canSubmitCode} onClick={() => void submitCode()} className={`${btnPrimary} mt-4`}>
                {busy
                  ? isCz
                    ? "Moment…"
                    : "One moment…"
                  : mode === "forgot"
                    ? isCz
                      ? "Uložit heslo"
                      : "Save password"
                    : isCz
                      ? "Potvrdit"
                      : "Confirm"}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void submitForm()}
                className={`${btnGhost} mt-2`}
              >
                {isCz ? "Poslat kód znovu" : "Send the code again"}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  resetErrors();
                  setStep("form");
                  setCode("");
                }}
                className="mt-3 w-full text-xs text-white/55 underline underline-offset-4 disabled:opacity-50"
              >
                {isCz ? "Zpět" : "Back"}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
