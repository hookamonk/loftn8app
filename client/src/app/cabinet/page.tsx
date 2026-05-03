"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { hasVenueSelection } from "@/lib/venue";
import { useAuth } from "@/providers/auth";
import { useSession } from "@/providers/session";
import { useToast } from "@/providers/toast";
import type { AccountLoyaltyEntry, AccountOverviewResponse, AccountReceipt } from "@/types";

type CabinetScreen = "home" | "account" | "bonuses" | "receipts" | "password";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function humanizeAccountError(message: string) {
  const raw = String(message || "");
  if (raw.includes("EMAIL_IN_USE")) return "This email is already used by another account.";
  if (raw.includes("PHONE_IN_USE")) return "This phone is already used by another account.";
  if (raw.includes("EMAIL_INVALID")) return "Please enter a valid email.";
  if (raw.includes("EMAIL_REQUIRED")) return "Email is required.";
  if (raw.includes("NAME_REQUIRED")) return "Name is required.";
  if (raw.includes("CURRENT_PASSWORD_REQUIRED")) return "Enter your current password.";
  if (raw.includes("PASSWORD_INVALID")) return "Current password is incorrect.";
  return raw || "Something went wrong.";
}

function loyaltyStatusLabel(entry: AccountLoyaltyEntry) {
  if (entry.status === "available") return "Available";
  if (entry.status === "redeemed") return "Redeemed";
  if (entry.status === "partial") return "Partially used";
  return "Pending";
}

function loyaltyStatusTone(entry: AccountLoyaltyEntry) {
  if (entry.status === "available") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (entry.status === "redeemed") return "border-white/10 bg-white/5 text-white/60";
  if (entry.status === "partial") return "border-amber-400/20 bg-amber-500/10 text-amber-100";
  return "border-sky-400/20 bg-sky-500/10 text-sky-100";
}

function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "");
}

export default function CabinetPage() {
  const router = useRouter();
  const { push } = useToast();
  const { me, loading, refresh } = useAuth();
  const { tableCode } = useSession();

  const [overview, setOverview] = useState<AccountOverviewResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [screen, setScreen] = useState<CabinetScreen>("home");
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);

  const [profileForm, setProfileForm] = useState({
    name: "",
    phone: "",
    email: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    nextPassword: "",
    repeatPassword: "",
  });

  useEffect(() => {
    if (loading) return;

    if (!me.authenticated) {
      router.replace("/auth?next=/cabinet");
      return;
    }

    let cancelled = false;

    const loadOverview = async () => {
      setPageLoading(true);
      try {
        const next = await api<AccountOverviewResponse>("/account/overview");
        if (!cancelled) {
          setOverview(next);
        }
      } catch (error: any) {
        if (!cancelled) {
          push({
            kind: "error",
            title: "Error",
            message: humanizeAccountError(error?.message ?? "Failed to load cabinet"),
          });
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [loading, me, push, router]);

  useEffect(() => {
    if (!overview) return;
    setProfileForm({
      name: overview.user.name,
      phone: overview.user.phone,
      email: overview.user.email,
    });
  }, [overview]);

  const canSaveProfile =
    !savingProfile &&
    profileForm.name.trim().length > 0 &&
    profileForm.phone.trim().length >= 6 &&
    profileForm.email.trim().length >= 3;

  const passwordsMatch =
    passwordForm.nextPassword.length > 0 &&
    passwordForm.nextPassword === passwordForm.repeatPassword;
  const canChangePassword =
    !changingPassword &&
    passwordForm.nextPassword.trim().length >= 6 &&
    passwordsMatch;

  const memberSince = useMemo(
    () => (overview ? formatDateShort(overview.user.createdAt) : "—"),
    [overview]
  );

  const openApp = () => {
    if (tableCode) {
      router.push("/menu");
      return;
    }

    if (hasVenueSelection()) {
      router.push("/table");
      return;
    }

    router.push("/");
  };

  const saveProfile = async () => {
    if (!canSaveProfile) return;

    setSavingProfile(true);
    try {
      const result = await api<{ ok: true; user: AccountOverviewResponse["user"] }>("/account/me", {
        method: "PATCH",
        body: JSON.stringify(profileForm),
      });

      setOverview((current) =>
        current
          ? {
              ...current,
              user: result.user,
            }
          : current
      );
      await refresh();
      push({ kind: "success", title: "Saved", message: "Your profile was updated." });
      setScreen("home");
    } catch (error: any) {
      push({
        kind: "error",
        title: "Error",
        message: humanizeAccountError(error?.message ?? "Failed to save profile"),
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!canChangePassword) return;

    setChangingPassword(true);
    try {
      await api("/account/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.nextPassword,
        }),
      });

      setPasswordForm({
        currentPassword: "",
        nextPassword: "",
        repeatPassword: "",
      });
      push({ kind: "success", title: "Password updated", message: "Your new password is now active." });
      setScreen("home");
    } catch (error: any) {
      push({
        kind: "error",
        title: "Error",
        message: humanizeAccountError(error?.message ?? "Failed to change password"),
      });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading || pageLoading || !overview) {
    return (
      <main className="mx-auto max-w-md px-4 py-5">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 text-sm text-white/65 backdrop-blur-xl">
          Loading your cabinet…
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-4 pb-8">
      {screen === "home" ? (
        <CabinetHome
          overview={overview}
          memberSince={memberSince}
          onOpenSite={() => {
            window.location.href = "https://loftn8.com";
          }}
          onOpenApp={openApp}
          onOpenScreen={setScreen}
        />
      ) : null}

      {screen === "account" ? (
        <SectionScreen
          title="Account information"
          subtitle="Personal information used in the app and personal cabinet."
          onBack={() => setScreen("home")}
        >
          <div className="space-y-3">
            <ProfilePreview overview={overview} />
            <InputField
              label="Name"
              value={profileForm.name}
              onChange={(value) => setProfileForm((current) => ({ ...current, name: value }))}
            />
            <InputField
              label="Phone"
              value={profileForm.phone}
              onChange={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
            />
            <InputField
              label="Email"
              value={profileForm.email}
              onChange={(value) => setProfileForm((current) => ({ ...current, email: value }))}
            />
            <PrimaryButton disabled={!canSaveProfile} onClick={saveProfile}>
              {savingProfile ? "Saving…" : "Save changes"}
            </PrimaryButton>
            <SecondaryButton onClick={() => setScreen("password")}>
              Reset password
            </SecondaryButton>
          </div>
        </SectionScreen>
      ) : null}

      {screen === "bonuses" ? (
        <SectionScreen
          title="Bonuses"
          subtitle="Available balance and personal loyalty history."
          onBack={() => setScreen("home")}
        >
          <div className="space-y-3">
            <BonusSummary overview={overview} />
            {overview.loyalty.history.length ? (
              overview.loyalty.history.map((entry) => <LoyaltyRow key={entry.id} entry={entry} />)
            ) : (
              <EmptyCard text="Your loyalty history will appear after the first confirmed payment." />
            )}
          </div>
        </SectionScreen>
      ) : null}

      {screen === "receipts" ? (
        <SectionScreen
          title="Receipts"
          subtitle="All confirmed receipts linked to your account."
          onBack={() => setScreen("home")}
        >
          <div className="space-y-3">
            {overview.receipts.length ? (
              overview.receipts.map((receipt) => (
                <ReceiptCard
                  key={receipt.id}
                  receipt={receipt}
                  open={expandedReceiptId === receipt.id}
                  onToggle={() =>
                    setExpandedReceiptId((current) => (current === receipt.id ? null : receipt.id))
                  }
                />
              ))
            ) : (
              <EmptyCard text="Confirmed receipts will appear here after payment is accepted by staff." />
            )}
          </div>
        </SectionScreen>
      ) : null}

      {screen === "password" ? (
        <SectionScreen
          title="Reset password"
          subtitle="Change the password used in both the app and the personal cabinet."
          onBack={() => setScreen("account")}
        >
          <div className="space-y-3">
            <InputField
              label="Current password"
              value={passwordForm.currentPassword}
              type="password"
              onChange={(value) => setPasswordForm((current) => ({ ...current, currentPassword: value }))}
            />
            <InputField
              label="New password"
              value={passwordForm.nextPassword}
              type="password"
              onChange={(value) => setPasswordForm((current) => ({ ...current, nextPassword: value }))}
            />
            <InputField
              label="Repeat new password"
              value={passwordForm.repeatPassword}
              type="password"
              onChange={(value) => setPasswordForm((current) => ({ ...current, repeatPassword: value }))}
            />
            {!passwordsMatch && passwordForm.repeatPassword ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                Passwords do not match.
              </div>
            ) : null}
            <PrimaryButton disabled={!canChangePassword} onClick={changePassword}>
              {changingPassword ? "Updating…" : "Change password"}
            </PrimaryButton>
          </div>
        </SectionScreen>
      ) : null}
    </main>
  );
}

function CabinetHome({
  overview,
  memberSince,
  onOpenSite,
  onOpenApp,
  onOpenScreen,
}: {
  overview: AccountOverviewResponse;
  memberSince: string;
  onOpenSite: () => void;
  onOpenApp: () => void;
  onOpenScreen: (screen: CabinetScreen) => void;
}) {
  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] text-white/42">LOFT№8 ACCOUNT</div>
      <div className="mt-4 rounded-[30px] border border-white/10 bg-[radial-gradient(120%_100%_at_0%_0%,rgba(255,255,255,0.1),transparent_55%)] p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-3xl border border-white/10 bg-white/10 text-lg font-semibold text-white">
            {userInitials(overview.user.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xl font-semibold text-white">{overview.user.name}</div>
            <div className="mt-1 truncate text-sm text-white/55">{overview.user.email}</div>
            <div className="mt-1 text-xs text-white/42">Member since {memberSince}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <ActionButton label="Site" description="Main website" onClick={onOpenSite} />
          <ActionButton label="App" description="Open app flow" emphasized onClick={onOpenApp} />
        </div>
      </div>

      <div className="mt-4">
        <HighlightCard
          label="Available cashback"
          value={`${overview.loyalty.availableCzk} Kč`}
          accent="from-emerald-500/30"
        />
      </div>

      <div className="mt-5 text-xs uppercase tracking-[0.2em] text-white/35">Sections</div>
      <div className="mt-3 space-y-3">
        <MenuRow
          title="Account information"
          subtitle="Name, phone number and email"
          value={overview.user.phone}
          onClick={() => onOpenScreen("account")}
        />
        <MenuRow
          title="Bonuses"
          subtitle="Balance and loyalty history"
          value={`${overview.loyalty.availableCzk} Kč`}
          onClick={() => onOpenScreen("bonuses")}
        />
        <MenuRow
          title="Receipt history"
          subtitle="Confirmed bills and order details"
          value={`${overview.receipts.length}`}
          onClick={() => onOpenScreen("receipts")}
        />
      </div>
    </div>
  );
}

function SectionScreen({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5 text-lg text-white"
          onClick={onBack}
        >
          ←
        </button>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white">{title}</div>
          <div className="mt-0.5 text-xs text-white/50">{subtitle}</div>
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </div>
  );
}

function ProfilePreview({ overview }: { overview: AccountOverviewResponse }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/10 text-sm font-semibold text-white">
          {userInitials(overview.user.name)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{overview.user.name}</div>
          <div className="truncate text-xs text-white/50">{overview.user.email}</div>
        </div>
      </div>
    </div>
  );
}

function BonusSummary({ overview }: { overview: AccountOverviewResponse }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Available" value={`${overview.loyalty.availableCzk} Kč`} />
        <MetricCard label="Pending" value={`${overview.loyalty.pendingCzk} Kč`} />
      </div>
    </div>
  );
}

function ActionButton({
  label,
  description,
  emphasized = false,
  onClick,
}: {
  label: string;
  description: string;
  emphasized?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-3xl border px-4 py-4 text-left transition ${
        emphasized
          ? "border-white bg-white text-black"
          : "border-white/10 bg-white/8 text-white"
      }`}
      onClick={onClick}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={`mt-1 text-xs ${emphasized ? "text-black/65" : "text-white/55"}`}>{description}</div>
    </button>
  );
}

function HighlightCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className={`rounded-[26px] border border-white/10 bg-gradient-to-br ${accent} to-transparent p-4`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function MenuRow({
  title,
  subtitle,
  value,
  onClick,
}: {
  title: string;
  subtitle: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-[26px] border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition hover:bg-white/[0.06]"
      onClick={onClick}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs text-white/50">{subtitle}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-white">{value}</div>
        <div className="mt-1 text-[11px] text-white/35">Open</div>
      </div>
    </button>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{label}</div>
      <input
        value={value}
        type={type}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 h-8 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
      />
    </label>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="h-12 w-full rounded-2xl border border-white/10 bg-white/8 text-sm font-semibold text-white"
    >
      {children}
    </button>
  );
}

function LoyaltyRow({ entry }: { entry: AccountLoyaltyEntry }) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{entry.venue.name}</div>
          <div className="mt-1 text-xs text-white/48">
            {formatDate(entry.createdAt)} • Unlock {formatDate(entry.availableAt)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-white">+{entry.cashbackCzk} Kč</div>
          <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold ${loyaltyStatusTone(entry)}`}>
            {loyaltyStatusLabel(entry)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-white/58">
        <div>Receipt base: {entry.baseAmountCzk} Kč</div>
        <div>Remaining: {entry.remainingCzk} Kč</div>
        <div>Redeemed: {entry.redeemedAmountCzk} Kč</div>
        <div>Venue: {entry.venue.slug}</div>
      </div>
    </div>
  );
}

function ReceiptCard({
  receipt,
  open,
  onToggle,
}: {
  receipt: AccountReceipt;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.04]">
      <button className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{receipt.venue.name}</div>
          <div className="mt-1 text-xs text-white/48">
            {formatDate(receipt.closedAt)} • {receipt.methodLabel} • {receipt.itemCount} items
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold text-white">{receipt.amountCzk} Kč</div>
          <div className="mt-1 text-[11px] text-white/35">{open ? "Hide" : "Details"}</div>
        </div>
      </button>

      {open ? (
        <div className="border-t border-white/8 px-4 py-4">
          <div className="space-y-2">
            {receipt.items.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-3 text-sm text-white/82">
                <div>
                  {item.name} × {item.qty}
                  {item.comment ? (
                    <div className="mt-1 text-[11px] text-white/45">{item.comment}</div>
                  ) : null}
                </div>
                <div className="shrink-0">{item.totalCzk} Kč</div>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-1 text-xs text-white/58">
            <div>Bill total: {receipt.billTotalCzk} Kč</div>
            <div>Loyalty used: {receipt.loyaltyAppliedCzk} Kč</div>
            <div>Cashback earned: {receipt.cashbackEarnedCzk} Kč</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-white/60">
      {text}
    </div>
  );
}
