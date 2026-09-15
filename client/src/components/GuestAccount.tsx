"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getVenueName, getVenueSlug, resolveVenueSlug, setVenueSlug } from "@/lib/venue";
import { useAuth } from "@/providers/auth";
import { useI18n } from "@/providers/i18n";
import { useToast } from "@/providers/toast";
import { useSession } from "@/providers/session";
import { useEscapeToClose } from "@/lib/useModalA11y";
import type { AccountOverviewResponse } from "@/types";

/**
 * Весь аккаунт гостя на одном коротком экране: карта, три строки и выход.
 * Всё, что длиннее строки — профиль, пароль, чеки — открывается шторкой поверх
 * текущего экрана, поэтому сам кабинет никогда не разрастается.
 *
 * Общий для вкладки «Профиль» (гость за столом) и /cabinet (гость без стола).
 */

type SheetMode = "profile" | "password" | "receipts";

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}

/** Группируем номер, чтобы он читался как настоящая карта лояльности. */
function formatCardNumber(value: string) {
  return (value.match(/.{1,3}/g) ?? [value]).join(" ");
}

function humanError(message: string, isCz: boolean) {
  const raw = String(message || "");
  if (raw.includes("EMAIL_IN_USE"))
    return isCz ? "Tento e-mail už používá jiný účet." : "This email is already used by another account.";
  if (raw.includes("PHONE_IN_USE"))
    return isCz ? "Toto číslo už používá jiný účet." : "This phone is already used by another account.";
  if (raw.includes("EMAIL_INVALID")) return isCz ? "Neplatný e-mail." : "Invalid email.";
  if (raw.includes("EMAIL_REQUIRED")) return isCz ? "E-mail je povinný." : "Email is required.";
  if (raw.includes("NAME_REQUIRED")) return isCz ? "Jméno je povinné." : "Name is required.";
  if (raw.includes("CURRENT_PASSWORD_REQUIRED"))
    return isCz ? "Zadejte aktuální heslo." : "Enter your current password.";
  if (raw.includes("PASSWORD_INVALID"))
    return isCz ? "Aktuální heslo není správné." : "Current password is incorrect.";
  if (raw.includes("PASSWORD_TOO_SHORT"))
    return isCz ? "Heslo musí mít alespoň 6 znaků." : "Password must be at least 6 characters.";
  return raw || (isCz ? "Něco se pokazilo." : "Something went wrong.");
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block rounded-xl border border-white/10 bg-black/25 px-3.5 py-2 focus-within:border-white/25">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</div>
      <input
        value={value}
        type={type}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-6 w-full bg-transparent text-sm text-white outline-none"
      />
    </label>
  );
}

function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEscapeToClose(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-4 pb-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-sm text-white/60 transition hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 max-h-[68vh] overflow-y-auto pr-0.5">{children}</div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  onClick,
  disabled,
  muted,
}: {
  label: string;
  value?: string;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.03] disabled:opacity-40"
    >
      <span className={`text-sm font-medium ${muted ? "text-white/60" : "text-white"}`}>{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-white/40">
        {value}
        <span className="text-base leading-none text-white/25">›</span>
      </span>
    </button>
  );
}

const btnPrimary =
  "h-11 w-full rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40";
const btnGhost =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-40";

export function GuestAccount({ blockSignOut }: { blockSignOut?: { blocked: boolean; reason: string } }) {
  const router = useRouter();
  const { isCz, locale } = useI18n();
  const { push } = useToast();
  const { me, loading, refresh } = useAuth();
  const { clearSession } = useSession();

  const [overview, setOverview] = useState<AccountOverviewResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [profileForm, setProfileForm] = useState({ name: "", phone: "", email: "" });
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", repeat: "" });

  useEffect(() => {
    if (loading) return;

    if (!me.authenticated) {
      router.replace("/auth?next=/cabinet");
      return;
    }

    let cancelled = false;

    const load = async () => {
      setPageLoading(true);
      try {
        const next = await api<AccountOverviewResponse>("/account/overview");
        if (!cancelled) setOverview(next);
      } catch (error: unknown) {
        if (!cancelled) {
          push({
            kind: "error",
            title: isCz ? "Chyba" : "Error",
            message: humanError(error instanceof Error ? error.message : "", isCz),
          });
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  useEffect(() => {
    if (!overview) return;
    setProfileForm({
      name: overview.user.name,
      phone: overview.user.phone,
      email: overview.user.email,
    });
  }, [overview]);

  // Кэшбэк копится и тратится ПО ТОЧКАМ, поэтому карта показывает баланс того
  // филиала, в котором гость сейчас находится.
  const venue = useMemo(() => {
    const slug = getVenueSlug();
    const history = overview?.loyalty.history ?? [];
    const here = history.filter((entry) => resolveVenueSlug(entry.venue.slug) === slug);

    return {
      name: getVenueName(),
      availableCzk: here
        .filter((entry) => entry.status === "available")
        .reduce((sum, entry) => sum + entry.remainingCzk, 0),
      pendingCzk: here
        .filter((entry) => entry.status === "pending" || entry.status === "partial")
        .reduce((sum, entry) => sum + entry.remainingCzk, 0),
    };
  }, [overview]);

  const canSaveProfile =
    !savingProfile && profileForm.name.trim().length > 0 && profileForm.email.trim().length >= 3;

  const passwordsMatch = passwordForm.next.length > 0 && passwordForm.next === passwordForm.repeat;
  const canSavePassword =
    !savingPassword && passwordForm.current.length > 0 && passwordForm.next.trim().length >= 6 && passwordsMatch;

  const saveProfile = async () => {
    if (!canSaveProfile) return;
    setSavingProfile(true);
    try {
      const result = await api<{ ok: true; user: AccountOverviewResponse["user"] }>("/account/me", {
        method: "PATCH",
        body: JSON.stringify(profileForm),
      });
      setOverview((current) => (current ? { ...current, user: result.user } : current));
      await refresh();
      setSheet(null);
      push({
        kind: "success",
        title: isCz ? "Uloženo" : "Saved",
        message: isCz ? "Profil byl aktualizován." : "Your profile was updated.",
      });
    } catch (error: unknown) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: humanError(error instanceof Error ? error.message : "", isCz),
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (!canSavePassword) return;
    setSavingPassword(true);
    try {
      await api("/account/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.next }),
      });
      setPasswordForm({ current: "", next: "", repeat: "" });
      setSheet(null);
      push({
        kind: "success",
        title: isCz ? "Heslo změněno" : "Password updated",
        message: isCz ? "Nové heslo je aktivní." : "Your new password is active.",
      });
    } catch (error: unknown) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: humanError(error instanceof Error ? error.message : "", isCz),
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const signOut = async () => {
    if (signingOut) return;

    // Никогда не отвязываем аккаунт посреди заказа или оплаты — гость потерял бы
    // и счёт, и кэшбэк за него.
    if (blockSignOut?.blocked) {
      push({ kind: "error", title: isCz ? "Zatím se nelze odhlásit" : "Can't sign out yet", message: blockSignOut.reason });
      return;
    }

    setSigningOut(true);
    try {
      await api("/auth/guest/logout", { method: "POST" }).catch(() => {});
      clearSession();
      setVenueSlug(null);
      await refresh();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  };

  if (loading || pageLoading || !overview) {
    return (
      <div className="animate-pulse space-y-2.5">
        <div className="h-40 rounded-3xl border border-white/10 bg-white/[0.04]" />
        <div className="h-36 rounded-2xl border border-white/10 bg-white/[0.04]" />
      </div>
    );
  }

  const percent = overview.loyalty.cashbackPercent;
  const receipts = overview.receipts;

  return (
    <div className="space-y-2.5">
      {/* ===== Карта гостя ===== */}
      <div className="relative overflow-hidden rounded-3xl border border-gold/20 bg-[linear-gradient(145deg,#1b160d_0%,#120f0a_55%,#0c0a07_100%)] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gold/12 blur-3xl" />

        <div className="relative flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold tracking-[0.26em] text-gold/80">LOFT№8</div>
          {percent > 0 ? (
            <div className="rounded-full border border-gold/25 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
              {percent}%
            </div>
          ) : null}
        </div>

        <div className="relative mt-3 text-[10px] uppercase tracking-[0.16em] text-white/35">
          Cashback · {venue.name}
        </div>

        <div className="relative mt-1 flex items-end gap-1.5">
          <div className="text-[32px] font-bold leading-none text-gold">{venue.availableCzk}</div>
          <div className="pb-0.5 text-sm font-medium text-gold/70">Kč</div>
          {venue.pendingCzk > 0 ? (
            <div className="ml-auto pb-1 text-[10px] text-amber-50/50">
              +{venue.pendingCzk} Kč · {isCz ? "po půlnoci" : "after midnight"}
            </div>
          ) : null}
        </div>

        <div className="relative mt-3.5 flex items-center justify-between gap-3 border-t border-white/8 pt-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold uppercase tracking-wide text-white">
              {overview.user.name}
            </div>
            <div className="mt-0.5 font-mono text-[10px] tracking-[0.16em] text-white/35">
              {formatCardNumber(overview.user.cardNumber)}
            </div>
          </div>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-xs font-semibold text-gold">
            {initials(overview.user.name)}
          </div>
        </div>

        <div className="relative mt-2.5 text-[10px] leading-4 text-white/25">
          {isCz ? "Apple Wallet a Google Wallet — již brzy" : "Apple Wallet and Google Wallet — coming soon"}
        </div>
      </div>

      {/* ===== Действия ===== */}
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        <Row label={isCz ? "Profil" : "Profile"} onClick={() => setSheet("profile")} />
        <Row
          label={isCz ? "Moje účtenky" : "My receipts"}
          value={receipts.length ? String(receipts.length) : undefined}
          onClick={() => setSheet("receipts")}
        />
        <Row
          label={signingOut ? (isCz ? "Odhlašuji…" : "Signing out…") : isCz ? "Odhlásit se" : "Sign out"}
          onClick={() => void signOut()}
          disabled={signingOut || blockSignOut?.blocked}
          muted
        />
      </div>

      {blockSignOut?.blocked ? (
        <div className="px-1 text-center text-[11px] leading-5 text-white/35">{blockSignOut.reason}</div>
      ) : null}

      {/* ===== Шторка: профиль ===== */}
      <Sheet
        open={sheet === "profile"}
        title={isCz ? "Profil" : "Profile"}
        onClose={() => setSheet(null)}
      >
        <div className="space-y-2">
          <Field
            label={isCz ? "Jméno" : "Name"}
            value={profileForm.name}
            autoComplete="name"
            onChange={(value) => setProfileForm((current) => ({ ...current, name: value }))}
          />
          <Field
            label={isCz ? "Telefon (nepovinné)" : "Phone (optional)"}
            value={profileForm.phone}
            autoComplete="tel"
            onChange={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
          />
          <Field
            label="Email"
            value={profileForm.email}
            type="email"
            autoComplete="email"
            onChange={(value) => setProfileForm((current) => ({ ...current, email: value }))}
          />

          <button type="button" disabled={!canSaveProfile} onClick={() => void saveProfile()} className={btnPrimary}>
            {savingProfile ? (isCz ? "Ukládám…" : "Saving…") : isCz ? "Uložit" : "Save"}
          </button>

          <button
            type="button"
            onClick={() => setSheet("password")}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-transparent px-3.5 py-3 text-left text-sm font-medium text-white/70 transition hover:text-white"
          >
            {isCz ? "Změnit heslo" : "Change password"}
            <span className="text-base leading-none text-white/25">›</span>
          </button>
        </div>
      </Sheet>

      {/* ===== Шторка: пароль ===== */}
      <Sheet
        open={sheet === "password"}
        title={isCz ? "Změnit heslo" : "Change password"}
        onClose={() => setSheet(null)}
      >
        <div className="space-y-2">
          <Field
            label={isCz ? "Aktuální heslo" : "Current password"}
            value={passwordForm.current}
            type="password"
            autoComplete="current-password"
            onChange={(value) => setPasswordForm((current) => ({ ...current, current: value }))}
          />
          <Field
            label={isCz ? "Nové heslo" : "New password"}
            value={passwordForm.next}
            type="password"
            autoComplete="new-password"
            onChange={(value) => setPasswordForm((current) => ({ ...current, next: value }))}
          />
          <Field
            label={isCz ? "Zopakujte heslo" : "Repeat password"}
            value={passwordForm.repeat}
            type="password"
            autoComplete="new-password"
            onChange={(value) => setPasswordForm((current) => ({ ...current, repeat: value }))}
          />

          {!passwordsMatch && passwordForm.repeat ? (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
              {isCz ? "Hesla se neshodují." : "Passwords do not match."}
            </div>
          ) : null}

          <button type="button" disabled={!canSavePassword} onClick={() => void savePassword()} className={btnPrimary}>
            {savingPassword ? (isCz ? "Měním…" : "Updating…") : isCz ? "Změnit heslo" : "Change password"}
          </button>

          <button type="button" onClick={() => setSheet("profile")} className={btnGhost}>
            {isCz ? "Zpět" : "Back"}
          </button>
        </div>
      </Sheet>

      {/* ===== Шторка: чеки ===== */}
      <Sheet
        open={sheet === "receipts"}
        title={isCz ? "Moje účtenky" : "My receipts"}
        onClose={() => setSheet(null)}
      >
        {receipts.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-xs text-white/45">
            {isCz ? "Zatím žádné účtenky." : "No receipts yet."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {receipts.map((receipt) => {
              const open = openReceiptId === receipt.id;
              return (
                <div key={receipt.id} className="rounded-xl border border-white/10 bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => setOpenReceiptId(open ? null : receipt.id)}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">
                        {new Date(receipt.closedAt).toLocaleDateString(locale, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-white/40">
                        {receipt.venue.name} · {receipt.methodLabel}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-white">{receipt.amountCzk} Kč</div>
                  </button>

                  {open ? (
                    <div className="space-y-1 border-t border-white/8 px-3.5 py-2.5">
                      {receipt.items.map((item) => (
                        <div key={item.key} className="flex justify-between gap-3 text-xs text-white/65">
                          <span className="min-w-0 truncate">
                            {item.name} × {item.qty}
                          </span>
                          <span className="shrink-0">{item.totalCzk} Kč</span>
                        </div>
                      ))}
                      {receipt.cashbackEarnedCzk > 0 ? (
                        <div className="mt-1.5 border-t border-white/8 pt-1.5 text-xs text-gold">
                          {isCz ? "Získaný cashback" : "Cashback earned"}: +{receipt.cashbackEarnedCzk} Kč
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Sheet>
    </div>
  );
}
