"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ensureBackendWarm } from "@/lib/backendWarmup";
import { markAnonBypassAuthOnce } from "@/lib/guestFlow";
import { getVenueName, hasVenueSelection } from "@/lib/venue";
import { useToast } from "@/providers/toast";
import { useAuth } from "@/providers/auth";
import { useSession } from "@/providers/session";

type Mode = "register" | "login";
type Step = "form" | "code";

function normalizePhone(x: string) {
  const compact = x.replace(/\s+/g, "").trim();
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (/^\d+$/.test(compact)) {
    if (compact.startsWith("420")) return `+${compact}`;
    return `+420${compact}`;
  }
  return compact;
}

function isValidEmail(x: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x).trim());
}

function humanError(msg: string) {
  const m = String(msg || "");
  if (m.includes("NO_ACCOUNT")) return "Account not found. Please register.";
  if (m.includes("NAME_MISMATCH")) return "Account not found (please check your name and phone) — please register.";
  if (m.includes("ACCOUNT_EXISTS")) return "This account already exists. Please sign in.";
  if (m.includes("EMAIL_REQUIRED")) return "Email is required.";
  if (m.includes("EMAIL_MISMATCH")) return "Account not found. Please check your email.";
  if (m.includes("CONSENT_REQUIRED")) return "You must agree to personal data processing.";
  if (m.includes("NAME_REQUIRED")) return "Name is required.";
  if (m.includes("OTP_INVALID")) return "Invalid code.";
  if (m.includes("OTP_NOT_FOUND")) return "Code not found or expired.";
  if (m.includes("EMAIL_INVALID")) return "Invalid email.";
  return m || "Error";
}

async function post<T = any>(path: string, body: any) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export default function AuthPage() {
  const router = useRouter();
  const { push } = useToast();
  const { me, loading, setAuthenticated } = useAuth();
  const { restoreSession } = useSession();

  const [mode, setMode] = useState<Mode>("register");
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+420");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);

  const [code, setCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggestedMode, setSuggestedMode] = useState<Mode | null>(null);

  const [showAnonWarn, setShowAnonWarn] = useState(false);

  const p = useMemo(() => normalizePhone(phone), [phone]);
  const venueName = useMemo(() => getVenueName(), []);

  useEffect(() => {
    if (!hasVenueSelection()) {
      router.replace("/");
      return;
    }
    void ensureBackendWarm();
  }, [router]);

  useEffect(() => {
    if (loading) return;
    if (me?.authenticated) router.replace("/menu");
  }, [loading, me, router]);

  const canSend =
    !busy &&
    p.length >= 6 &&
    name.trim().length >= 1 &&
    isValidEmail(email) &&
    (mode === "register" ? consent : true);

  const canVerify = !busy && code.trim().length >= 4;

  const requestOtp = async () => {
    setErr(null);
    setSuggestedMode(null);
    if (!canSend) return;

    setBusy(true);
    try {
      const r: any = await post("/auth/guest/request-otp", {
        phone: p,
        intent: mode,
        name: name.trim(),
        email: email.trim(),
      });

      setStep("code");
      setCode("");
      push({ kind: "success", title: "Code sent", message: "Check your email and enter the code." });
    } catch (e: any) {
      const raw = String(e?.message || "");
      const msg = humanError(e?.message ?? "Failed");
      setErr(msg);
      if (mode === "register" && raw.includes("ACCOUNT_EXISTS")) {
        setSuggestedMode("login");
      } else if (mode === "login" && (raw.includes("NO_ACCOUNT") || raw.includes("NAME_MISMATCH"))) {
        setSuggestedMode("register");
      }
      push({ kind: "error", title: "Error", message: msg });
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setErr(null);
    setSuggestedMode(null);
    if (!canVerify) return;

    setBusy(true);
    try {
      const verify: any = await post("/auth/guest/verify-otp", {
        phone: p,
        code: code.trim(),
        intent: mode,
        name: name.trim(),
        email: email.trim(),
        consent: mode === "register" ? consent : undefined,
      });

      setAuthenticated({
        authenticated: true,
        user: {
          id: String((verify as any).user.id),
          name: String((verify as any).user.name),
          phone: String((verify as any).user.phone),
          email: String((verify as any).user.email ?? ""),
          role: String((verify as any).user.role ?? "USER"),
        },
      });
      await restoreSession().catch(() => {});
      push({ kind: "success", title: "Done", message: "You are signed in." });
      router.replace("/menu");
    } catch (e: any) {
      const msg = humanError(e?.message ?? "Failed");
      setErr(msg);

      const raw = String(e?.message || "");
      if (mode === "register" && raw.includes("ACCOUNT_EXISTS")) {
        setStep("form");
        setCode("");
        setSuggestedMode("login");
      }

      if (mode === "login" && (raw.includes("NO_ACCOUNT") || raw.includes("NAME_MISMATCH"))) {
        setStep("form");
        setSuggestedMode("register");
      }

      push({ kind: "error", title: "Error", message: msg });
    } finally {
      setBusy(false);
    }
  };

  const continueWithoutAccount = () => {
    setShowAnonWarn(true);
  };

  const doAnonContinue = async () => {
    setShowAnonWarn(false);
    await restoreSession().catch(() => {});

    const guestSession = await api<{ ok: boolean; session: unknown | null }>("/guest/me").catch(() => ({
      ok: false,
      session: null,
    }));

    if (guestSession.ok && guestSession.session) {
      router.replace("/menu");
      return;
    }

    markAnonBypassAuthOnce();
    router.replace("/table");
  };

  return (
    <main className="min-h-dvh bg-[radial-gradient(80%_60%_at_50%_0%,rgba(255,255,255,0.08),transparent_60%)]">
      {showAnonWarn ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[rgba(20,20,20,0.92)] p-4 backdrop-blur">
            <div className="text-sm font-semibold text-white">Attention</div>
            <div className="mt-2 text-xs text-white/70">
              If you continue without registration, bonuses and news will not be available.
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="h-12 flex-1 rounded-2xl bg-white text-sm font-semibold text-black"
                onClick={() => {
                  setShowAnonWarn(false);
                  setMode("register");
                  setStep("form");
                }}
              >
                Register
              </button>
              <button
                className="h-12 flex-1 rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85"
                onClick={doAnonContinue}
              >
                Continue
              </button>
            </div>

            <button
              className="mt-3 w-full text-xs text-white/60 underline underline-offset-4"
              onClick={() => setShowAnonWarn(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-4 flex flex-col items-center">
          <div className="mb-3 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5">
            <img src="/logo.svg" alt="Loft N8" className="h-10 w-10 opacity-90" />
          </div>

          <div className="w-full">
            <div className="text-[11px] tracking-[0.24em] text-white/45">{venueName}</div>
            <h1 className="mt-1 text-left text-2xl font-bold text-white">
              Welcome to <span className="text-white/80">{venueName}</span>
            </h1>
            <button
              type="button"
              className="mt-2 text-xs text-white/60 underline underline-offset-4"
              onClick={() => router.push("/")}
            >
              Change branch
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[rgba(20,20,20,0.72)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">
              {mode === "register" ? "Register" : "Sign in"}
            </div>

            <button
              type="button"
              className="text-xs text-white/70 underline underline-offset-4"
              onClick={() => {
                setErr(null);
                setStep("form");
                  setMode((m) => (m === "register" ? "login" : "register"));
                }}
              >
              {mode === "register" ? "Already have an account? Sign in" : "No account? Register"}
            </button>
          </div>

          {step === "form" ? (
            <>
              <div className="mt-4 grid gap-3">
                <div>
                  <label className="text-xs text-white/60">Name *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                    autoComplete="name"
                  />
                </div>

                <div>
                  <label className="text-xs text-white/60">Phone *</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+420 777 000 000"
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </div>

                <div>
                  <label className="text-xs text-white/60">Email *</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@email.com"
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                    inputMode="email"
                    autoComplete="email"
                    type="email"
                  />
                </div>

                {mode === "register" ? (
                  <label className="mt-1 flex cursor-pointer items-start gap-3 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-white/20 bg-black/30"
                    />
                    <span>I agree to personal data processing *</span>
                  </label>
                ) : null}
              </div>

              {err ? (
                <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-200">
                  <div>{err}</div>
                  {suggestedMode ? (
                    <button
                      type="button"
                      className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"
                      onClick={() => {
                        setErr(null);
                        setSuggestedMode(null);
                        setCode("");
                        setStep("form");
                        setMode(suggestedMode);
                      }}
                    >
                      {suggestedMode === "login" ? "Log in" : "Register"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                disabled={!canSend}
                onClick={requestOtp}
                className="mt-4 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black disabled:opacity-50"
              >
                {busy ? "Sending…" : mode === "register" ? "Register" : "Sign in"}
              </button>

              {mode === "register" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={continueWithoutAccount}
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/80 hover:text-white disabled:opacity-50"
                >
                  Continue without registration
                </button>
              ) : null}
            </>
          ) : (
            <>
              <div className="mt-4">
                <div className="text-xs text-white/60">Email code</div>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />

                {err ? (
                  <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-200">
                    <div>{err}</div>
                    {suggestedMode ? (
                      <button
                        type="button"
                        className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"
                        onClick={() => {
                          setErr(null);
                          setSuggestedMode(null);
                          setCode("");
                          setStep("form");
                          setMode(suggestedMode);
                        }}
                      >
                        {suggestedMode === "login" ? "Log in" : "Register"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <button
                disabled={!canVerify}
                onClick={verifyOtp}
                className="mt-4 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black disabled:opacity-50"
              >
                {busy ? "Verifying…" : "Confirm"}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={requestOtp}
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/80 hover:text-white disabled:opacity-50"
              >
                Send code again
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setErr(null);
                  setStep("form");
                  setCode("");
                }}
                className="mt-2 text-xs text-white/60 underline underline-offset-4"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
