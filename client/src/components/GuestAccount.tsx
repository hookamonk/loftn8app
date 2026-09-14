"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getVenueName, getVenueSlug, resolveVenueSlug, setVenueSlug } from "@/lib/venue";
import { useAuth } from "@/providers/auth";
import { useI18n } from "@/providers/i18n";
import { useToast } from "@/providers/toast";
import { useSession } from "@/providers/session";
import type { AccountOverviewResponse } from "@/types";

/**
 * The guest's whole account on one screen: their card, the profile editor and
 * sign out. Shared by the "Profile" tab (guest sitting at a table) and by
 * /cabinet (guest without a table), so there is exactly one implementation.
 */

const card = "rounded-[28px] border border-white/10 bg-white/[0.04] p-5";

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}

/** Group the membership number so it reads like a real loyalty card. */
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
    <label className="block rounded-2xl border border-white/10 bg-black/25 px-4 py-2.5 focus-within:border-white/25">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</div>
      <input
        value={value}
        type={type}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-7 w-full bg-transparent text-sm text-white outline-none"
      />
    </label>
  );
}

export function GuestAccount({ blockSignOut }: { blockSignOut?: { blocked: boolean; reason: string } }) {
  const router = useRouter();
  const { isCz, locale } = useI18n();
  const { push } = useToast();
  const { me, loading, refresh } = useAuth();
  const { clearSession } = useSession();

  const [overview, setOverview] = useState<AccountOverviewResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
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

  // Cashback is earned and spent PER VENUE, so the card shows the balance for
  // the branch the guest is actually in.
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

    // Never detach the account in the middle of an order or a payment — the
    // guest would lose the bill and the cashback for it.
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
      <div className="animate-pulse space-y-3">
        <div className="h-52 rounded-[28px] border border-white/10 bg-white/[0.04]" />
        <div className="h-14 rounded-2xl border border-white/10 bg-white/[0.04]" />
        <div className="h-12 rounded-2xl border border-white/10 bg-white/[0.04]" />
      </div>
    );
  }

  const percent = overview.loyalty.cashbackPercent;

  return (
    <div className="space-y-3">
      {/* ===== Guest card ===== */}
      <div className="relative overflow-hidden rounded-[28px] border border-gold/20 bg-[linear-gradient(145deg,#1b160d_0%,#120f0a_55%,#0c0a07_100%)] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.5)]">
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-gold/12 blur-3xl" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-[0.28em] text-gold/80">LOFT№8</div>
          {percent > 0 ? (
            <div className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-0.5 text-[11px] font-semibold text-gold">
              {percent}%
            </div>
          ) : null}
        </div>

        <div className="relative mt-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            {isCz ? "Cashback na pobočce" : "Cashback at this branch"}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <div className="text-[40px] font-bold leading-none text-gold">{venue.availableCzk}</div>
            <div className="pb-1.5 text-sm font-medium text-gold/70">Kč</div>
          </div>
          <div className="mt-1 text-xs text-white/50">{venue.name}</div>

          {venue.pendingCzk > 0 ? (
            <div className="mt-2 text-[11px] text-amber-50/55">
              {isCz ? "Odemkne se" : "Unlocks"} {venue.pendingCzk} Kč ·{" "}
              {isCz ? "po půlnoci" : "after midnight"}
            </div>
          ) : null}
        </div>

        <div className="relative mt-6 flex items-end justify-between gap-3 border-t border-white/8 pt-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold uppercase tracking-wide text-white">
              {overview.user.name}
            </div>
            <div className="mt-1 font-mono text-[11px] tracking-[0.18em] text-white/40">
              {formatCardNumber(overview.user.cardNumber)}
            </div>
          </div>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-gold/25 bg-gold/10 text-sm font-semibold text-gold">
            {initials(overview.user.name)}
          </div>
        </div>

        <div className="relative mt-4 text-[10px] leading-4 text-white/30">
          {isCz ? "Apple Wallet a Google Wallet — již brzy" : "Apple Wallet and Google Wallet — coming soon"}
        </div>
      </div>

      {/* ===== Edit profile ===== */}
      <div className={`${card} p-0`}>
        <button
          type="button"
          onClick={() => setEditOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <div className="text-sm font-semibold text-white">
            {isCz ? "Upravit profil" : "Edit profile"}
          </div>
          <span className="text-lg leading-none text-white/35">{editOpen ? "−" : "+"}</span>
        </button>

        {editOpen ? (
          <div className="space-y-2.5 border-t border-white/8 px-5 py-4">
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
            <button
              type="button"
              disabled={!canSaveProfile}
              onClick={() => void saveProfile()}
              className="h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
            >
              {savingProfile ? (isCz ? "Ukládám…" : "Saving…") : isCz ? "Uložit" : "Save"}
            </button>

            <div className="border-t border-white/8 pt-3">
              <div className="mb-2.5 text-[10px] uppercase tracking-[0.16em] text-white/40">
                {isCz ? "Změna hesla" : "Change password"}
              </div>
              <div className="space-y-2.5">
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
                  <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
                    {isCz ? "Hesla se neshodují." : "Passwords do not match."}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={!canSavePassword}
                  onClick={() => void savePassword()}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-40"
                >
                  {savingPassword ? (isCz ? "Měním…" : "Updating…") : isCz ? "Změnit heslo" : "Change password"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ===== Sign out ===== */}
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut || blockSignOut?.blocked}
        className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] text-sm font-semibold text-white/65 transition hover:bg-white/[0.06] disabled:opacity-40"
      >
        {signingOut ? (isCz ? "Odhlašuji…" : "Signing out…") : isCz ? "Odhlásit se" : "Sign out"}
      </button>

      {blockSignOut?.blocked ? (
        <div className="px-1 text-center text-[11px] leading-5 text-white/40">{blockSignOut.reason}</div>
      ) : null}

      {/* ===== Receipts — quiet, but there when the guest needs to check a charge ===== */}
      <div className="pt-1 text-center">
        <button
          type="button"
          onClick={() => setReceiptsOpen((open) => !open)}
          className="text-xs text-white/40 underline underline-offset-4 transition hover:text-white/70"
        >
          {isCz ? "Moje účtenky" : "My receipts"}
          {overview.receipts.length ? ` (${overview.receipts.length})` : ""}
        </button>
      </div>

      {receiptsOpen ? (
        <div className="space-y-2">
          {overview.receipts.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6 text-center text-xs text-white/45">
              {isCz ? "Zatím žádné účtenky." : "No receipts yet."}
            </div>
          ) : (
            overview.receipts.map((receipt) => {
              const open = openReceiptId === receipt.id;
              return (
                <div key={receipt.id} className="rounded-2xl border border-white/10 bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => setOpenReceiptId(open ? null : receipt.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">
                        {new Date(receipt.closedAt).toLocaleDateString(locale, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-white/45">
                        {receipt.venue.name} · {receipt.methodLabel}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-white">{receipt.amountCzk} Kč</div>
                  </button>

                  {open ? (
                    <div className="space-y-1 border-t border-white/8 px-4 py-3">
                      {receipt.items.map((item) => (
                        <div key={item.key} className="flex justify-between gap-3 text-xs text-white/70">
                          <span className="min-w-0 truncate">
                            {item.name} × {item.qty}
                          </span>
                          <span className="shrink-0">{item.totalCzk} Kč</span>
                        </div>
                      ))}
                      {receipt.cashbackEarnedCzk > 0 ? (
                        <div className="mt-2 border-t border-white/8 pt-2 text-xs text-gold">
                          {isCz ? "Získaný cashback" : "Cashback earned"}: +{receipt.cashbackEarnedCzk} Kč
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
