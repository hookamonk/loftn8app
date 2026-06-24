"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useI18n } from "@/providers/i18n";
import { useSession } from "@/providers/session";
import { useToast } from "@/providers/toast";
import type {
	AccountLoyaltyEntry,
	AccountOverviewResponse,
	AccountReceipt,
} from "@/types";

type CabinetTab = "bonuses" | "receipts" | "profile";

function formatDate(value: string | null, locale: string) {
	if (!value) return "—";
	return new Date(value).toLocaleString(locale, {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDateShort(value: string | null, locale: string) {
	if (!value) return "—";
	return new Date(value).toLocaleDateString(locale, {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

function humanizeAccountError(message: string, isCz: boolean) {
	const raw = String(message || "");
	if (raw.includes("EMAIL_IN_USE"))
		return isCz
			? "Tento e-mail už používá jiný účet."
			: "This email is already used by another account.";
	if (raw.includes("PHONE_IN_USE"))
		return isCz
			? "Toto telefonní číslo už používá jiný účet."
			: "This phone is already used by another account.";
	if (raw.includes("EMAIL_INVALID"))
		return isCz ? "Zadejte platný e-mail." : "Please enter a valid email.";
	if (raw.includes("EMAIL_REQUIRED"))
		return isCz ? "E-mail je povinný." : "Email is required.";
	if (raw.includes("NAME_REQUIRED"))
		return isCz ? "Jméno je povinné." : "Name is required.";
	if (raw.includes("CURRENT_PASSWORD_REQUIRED"))
		return isCz ? "Zadejte své aktuální heslo." : "Enter your current password.";
	if (raw.includes("PASSWORD_INVALID"))
		return isCz
			? "Aktuální heslo není správné."
			: "Current password is incorrect.";
	return raw || (isCz ? "Něco se pokazilo." : "Something went wrong.");
}

function loyaltyStatusLabel(entry: AccountLoyaltyEntry, isCz: boolean) {
	if (entry.status === "available") return isCz ? "K dispozici" : "Available";
	if (entry.status === "redeemed") return isCz ? "Uplatněno" : "Redeemed";
	if (entry.status === "partial")
		return isCz ? "Částečně využito" : "Partially used";
	return isCz ? "Čeká" : "Pending";
}

function loyaltyStatusTone(entry: AccountLoyaltyEntry) {
	if (entry.status === "available")
		return "border-gold/25 bg-gold/10 text-gold";
	if (entry.status === "redeemed")
		return "border-white/10 bg-white/5 text-white/55";
	if (entry.status === "partial")
		return "border-amber-400/25 bg-amber-500/10 text-amber-200";
	return "border-sky-400/25 bg-sky-500/10 text-sky-200";
}

function userInitials(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}

export default function CabinetPage() {
	const router = useRouter();
	const { isCz, locale } = useI18n();
	const { push } = useToast();
	const { me, loading, refresh } = useAuth();
	const { tableCode } = useSession();

	const [overview, setOverview] = useState<AccountOverviewResponse | null>(null);
	const [pageLoading, setPageLoading] = useState(true);
	const [savingProfile, setSavingProfile] = useState(false);
	const [changingPassword, setChangingPassword] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	const [tab, setTab] = useState<CabinetTab>("bonuses");
	const [showPassword, setShowPassword] = useState(false);
	const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(
		null,
	);

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
				if (!cancelled) setOverview(next);
			} catch (error: any) {
				if (!cancelled) {
					push({
						kind: "error",
						title: isCz ? "Chyba" : "Error",
						message: humanizeAccountError(
							error?.message ?? "Failed to load cabinet",
							isCz,
						),
					});
				}
			} finally {
				if (!cancelled) setPageLoading(false);
			}
		};

		void loadOverview();

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
		passwordForm.currentPassword.length > 0 &&
		passwordForm.nextPassword.trim().length >= 6 &&
		passwordsMatch;

	const memberSince = useMemo(
		() => (overview ? formatDateShort(overview.user.createdAt, locale) : "—"),
		[locale, overview],
	);

	const stats = useMemo(() => {
		const receipts = overview?.receipts ?? [];
		const earned = receipts.reduce(
			(sum, r) => sum + (r.cashbackEarnedCzk || 0),
			0,
		);
		return { earned, visits: receipts.length };
	}, [overview]);

	const openApp = () => {
		router.push(tableCode ? "/menu" : "/");
	};

	const saveProfile = async () => {
		if (!canSaveProfile) return;
		setSavingProfile(true);
		try {
			const result = await api<{
				ok: true;
				user: AccountOverviewResponse["user"];
			}>("/account/me", {
				method: "PATCH",
				body: JSON.stringify(profileForm),
			});
			setOverview((current) =>
				current ? { ...current, user: result.user } : current,
			);
			await refresh();
			push({
				kind: "success",
				title: isCz ? "Uloženo" : "Saved",
				message: isCz
					? "Váš profil byl aktualizován."
					: "Your profile was updated.",
			});
		} catch (error: any) {
			push({
				kind: "error",
				title: isCz ? "Chyba" : "Error",
				message: humanizeAccountError(
					error?.message ?? "Failed to save profile",
					isCz,
				),
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
			setShowPassword(false);
			push({
				kind: "success",
				title: isCz ? "Heslo změněno" : "Password updated",
				message: isCz
					? "Vaše nové heslo je nyní aktivní."
					: "Your new password is now active.",
			});
		} catch (error: any) {
			push({
				kind: "error",
				title: isCz ? "Chyba" : "Error",
				message: humanizeAccountError(
					error?.message ?? "Failed to change password",
					isCz,
				),
			});
		} finally {
			setChangingPassword(false);
		}
	};

	const signOut = async () => {
		setSigningOut(true);
		try {
			await api("/auth/guest/logout", { method: "POST" }).catch(() => {});
			await refresh();
			push({
				kind: "success",
				title: isCz ? "Odhlášeno" : "Signed out",
				message: isCz ? "Brzy na viděnou." : "See you soon.",
			});
			router.replace("/");
		} finally {
			setSigningOut(false);
		}
	};

	if (loading || pageLoading || !overview) {
		return (
			<main className="mx-auto max-w-md px-4 py-6">
				<div className="animate-pulse space-y-3">
					<div className="h-44 rounded-[32px] border border-white/10 bg-white/[0.04]" />
					<div className="h-16 rounded-[24px] border border-white/10 bg-white/[0.04]" />
					<div className="h-11 rounded-2xl border border-white/10 bg-white/[0.04]" />
				</div>
			</main>
		);
	}

	const cashbackPercent = overview.loyalty.cashbackPercent;

	return (
		<main className="mx-auto max-w-md px-4 pb-10 pt-4">
			<div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/40">
				{isCz ? "Osobní účet" : "Personal account"}
			</div>

			{/* Loyalty / membership card */}
			<div className="relative mt-4 overflow-hidden rounded-[32px] border border-white/10 bg-[#14110b] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
				<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
				<div className="pointer-events-none absolute -left-10 -top-16 h-44 w-44 rounded-full bg-gold/20 blur-3xl" />
				<div className="pointer-events-none absolute -right-12 bottom-0 h-36 w-36 rounded-full bg-gold-deep/10 blur-3xl" />

				<div className="relative flex items-center gap-3.5">
					<div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-gold/25 bg-gold/10 text-base font-semibold text-gold">
						{userInitials(overview.user.name)}
					</div>
					<div className="min-w-0">
						<div className="truncate text-lg font-semibold leading-tight text-white">
							{overview.user.name}
						</div>
						<div className="mt-0.5 truncate text-xs text-white/50">
							{overview.user.email}
						</div>
						<div className="mt-1 text-[11px] text-white/38">
							{isCz ? `Členem od ${memberSince}` : `Member since ${memberSince}`}
						</div>
					</div>
				</div>

				<div className="relative mt-5 rounded-[22px] border border-white/8 bg-black/25 p-4">
					<div className="flex items-center justify-between">
						<div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
							{isCz ? "Dostupný cashback" : "Available cashback"}
						</div>
						{cashbackPercent > 0 ? (
							<div className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-0.5 text-[11px] font-semibold text-gold">
								{cashbackPercent}%
							</div>
						) : null}
					</div>
					<div className="mt-1.5 flex items-end gap-2">
						<div className="text-[34px] font-semibold leading-none text-gold">
							{overview.loyalty.availableCzk}
						</div>
						<div className="pb-1 text-sm font-medium text-gold/70">Kč</div>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
						{overview.loyalty.pendingCzk > 0 ? (
							<span>
								{isCz ? "Čeká" : "Pending"}: {overview.loyalty.pendingCzk} Kč
							</span>
						) : null}
						{overview.loyalty.nextAvailableAt ? (
							<span>
								{isCz ? "Odemčení" : "Unlocks"}:{" "}
								{formatDateShort(overview.loyalty.nextAvailableAt, locale)}
							</span>
						) : null}
						{overview.loyalty.availableCzk === 0 &&
						overview.loyalty.pendingCzk === 0 ? (
							<span>
								{isCz
									? `Sbírejte ${cashbackPercent}% z každého účtu`
									: `Earn ${cashbackPercent}% back on every bill`}
							</span>
						) : null}
					</div>
				</div>
			</div>

			{/* Lifetime stats */}
			<div className="mt-3 grid grid-cols-2 gap-2.5">
				<StatChip
					label={isCz ? "Cashback získán" : "Cashback earned"}
					value={`${stats.earned} Kč`}
					accent
				/>
				<StatChip
					label={isCz ? "Návštěvy" : "Visits"}
					value={`${stats.visits}`}
				/>
			</div>

			{/* Quick actions */}
			<div className="mt-3 grid grid-cols-2 gap-2.5">
				<button
					onClick={openApp}
					className="rounded-2xl bg-white px-4 py-3.5 text-left transition active:scale-[0.98]"
				>
					<div className="text-sm font-semibold text-black">
						{isCz ? "Otevřít aplikaci" : "Open app"}
					</div>
					<div className="mt-0.5 text-[11px] text-black/55">
						{tableCode
							? isCz
								? "Zpět k menu"
								: "Back to menu"
							: isCz
								? "Naskenujte QR u stolu"
								: "Scan the QR at your table"}
					</div>
				</button>
				<button
					onClick={() => {
						window.location.href = "https://loftn8.cz";
					}}
					className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3.5 text-left transition hover:bg-white/[0.08] active:scale-[0.98]"
				>
					<div className="text-sm font-semibold text-white">
						{isCz ? "Web" : "Website"}
					</div>
					<div className="mt-0.5 text-[11px] text-white/50">loftn8.cz</div>
				</button>
			</div>

			{/* Tabs */}
			<div className="mt-5 flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
				{(
					[
						["bonuses", isCz ? "Bonusy" : "Bonuses"],
						["receipts", isCz ? "Účtenky" : "Receipts"],
						["profile", isCz ? "Profil" : "Profile"],
					] as Array<[CabinetTab, string]>
				).map(([key, label]) => (
					<button
						key={key}
						onClick={() => setTab(key)}
						className={`flex-1 rounded-xl py-2 text-[13px] font-semibold transition ${
							tab === key
								? "bg-white text-black"
								: "text-white/55 hover:text-white/80"
						}`}
					>
						{label}
					</button>
				))}
			</div>

			<div className="mt-4">
				{tab === "bonuses" ? (
					<BonusesTab overview={overview} isCz={isCz} locale={locale} />
				) : null}

				{tab === "receipts" ? (
					<div className="space-y-3">
						{overview.receipts.length ? (
							overview.receipts.map((receipt) => (
								<ReceiptCard
									key={receipt.id}
									receipt={receipt}
									open={expandedReceiptId === receipt.id}
									isCz={isCz}
									locale={locale}
									onToggle={() =>
										setExpandedReceiptId((current) =>
											current === receipt.id ? null : receipt.id,
										)
									}
								/>
							))
						) : (
							<EmptyCard
								title={isCz ? "Zatím žádné účtenky" : "No receipts yet"}
								text={
									isCz
										? "Potvrzené účtenky se zde objeví po schválení platby obsluhou."
										: "Confirmed receipts will appear here once staff accepts a payment."
								}
							/>
						)}
					</div>
				) : null}

				{tab === "profile" ? (
					<div className="space-y-3">
						<div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
							<div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
								{isCz ? "Osobní údaje" : "Personal details"}
							</div>
							<div className="mt-3 space-y-2.5">
								<InputField
									label={isCz ? "Jméno" : "Name"}
									value={profileForm.name}
									onChange={(value) =>
										setProfileForm((current) => ({ ...current, name: value }))
									}
								/>
								<InputField
									label={isCz ? "Telefon" : "Phone"}
									value={profileForm.phone}
									onChange={(value) =>
										setProfileForm((current) => ({ ...current, phone: value }))
									}
								/>
								<InputField
									label="Email"
									value={profileForm.email}
									onChange={(value) =>
										setProfileForm((current) => ({ ...current, email: value }))
									}
								/>
							</div>
							<PrimaryButton disabled={!canSaveProfile} onClick={saveProfile}>
								{savingProfile
									? isCz
										? "Ukládám…"
										: "Saving…"
									: isCz
										? "Uložit změny"
										: "Save changes"}
							</PrimaryButton>
						</div>

						<div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
							<button
								onClick={() => setShowPassword((v) => !v)}
								className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
							>
								<div>
									<div className="text-sm font-semibold text-white">
										{isCz ? "Heslo" : "Password"}
									</div>
									<div className="mt-0.5 text-xs text-white/50">
										{isCz
											? "Změňte přihlašovací heslo"
											: "Change your sign-in password"}
									</div>
								</div>
								<div className="text-white/40">{showPassword ? "−" : "+"}</div>
							</button>

							{showPassword ? (
								<div className="space-y-2.5 border-t border-white/8 px-4 py-4">
									<InputField
										label={isCz ? "Aktuální heslo" : "Current password"}
										value={passwordForm.currentPassword}
										type="password"
										onChange={(value) =>
											setPasswordForm((current) => ({
												...current,
												currentPassword: value,
											}))
										}
									/>
									<InputField
										label={isCz ? "Nové heslo" : "New password"}
										value={passwordForm.nextPassword}
										type="password"
										onChange={(value) =>
											setPasswordForm((current) => ({
												...current,
												nextPassword: value,
											}))
										}
									/>
									<InputField
										label={isCz ? "Zopakujte nové heslo" : "Repeat new password"}
										value={passwordForm.repeatPassword}
										type="password"
										onChange={(value) =>
											setPasswordForm((current) => ({
												...current,
												repeatPassword: value,
											}))
										}
									/>
									{!passwordsMatch && passwordForm.repeatPassword ? (
										<div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
											{isCz ? "Hesla se neshodují." : "Passwords do not match."}
										</div>
									) : null}
									<PrimaryButton
										disabled={!canChangePassword}
										onClick={changePassword}
									>
										{changingPassword
											? isCz
												? "Měním…"
												: "Updating…"
											: isCz
												? "Změnit heslo"
												: "Change password"}
									</PrimaryButton>
								</div>
							) : null}
						</div>

						<button
							onClick={signOut}
							disabled={signingOut}
							className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-50"
						>
							{signingOut
								? isCz
									? "Odhlašuji…"
									: "Signing out…"
								: isCz
									? "Odhlásit se"
									: "Sign out"}
						</button>
					</div>
				) : null}
			</div>
		</main>
	);
}

function BonusesTab({
	overview,
	isCz,
	locale,
}: {
	overview: AccountOverviewResponse;
	isCz: boolean;
	locale: string;
}) {
	return (
		<div className="space-y-3">
			<div className="rounded-[24px] border border-gold/15 bg-gold/[0.06] p-4">
				<div className="text-sm leading-6 text-amber-50/85">
					{isCz
						? `Z každé potvrzené útraty vám vrátíme ${overview.loyalty.cashbackPercent}% jako cashback. Použít ho můžete na příští účet u stolu.`
						: `Every confirmed bill gives you ${overview.loyalty.cashbackPercent}% back as cashback. Use it on your next bill at the table.`}
				</div>
			</div>

			{overview.loyalty.history.length ? (
				overview.loyalty.history.map((entry) => (
					<LoyaltyRow
						key={entry.id}
						entry={entry}
						isCz={isCz}
						locale={locale}
					/>
				))
			) : (
				<EmptyCard
					title={isCz ? "Zatím žádný cashback" : "No cashback yet"}
					text={
						isCz
							? "Historie cashbacku se objeví po vaší první potvrzené platbě."
							: "Your cashback history appears after the first confirmed payment."
					}
				/>
			)}
		</div>
	);
}

function StatChip({
	label,
	value,
	accent = false,
}: {
	label: string;
	value: string;
	accent?: boolean;
}) {
	return (
		<div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
			<div
				className={`text-base font-semibold ${accent ? "text-gold" : "text-white"}`}
			>
				{value}
			</div>
			<div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/40">
				{label}
			</div>
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
		<label className="block rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 focus-within:border-white/25">
			<div className="text-[10px] uppercase tracking-[0.16em] text-white/38">
				{label}
			</div>
			<input
				value={value}
				type={type}
				onChange={(event) => onChange(event.target.value)}
				className="mt-1 h-7 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
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
			className="mt-3 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
		>
			{children}
		</button>
	);
}

function LoyaltyRow({
	entry,
	isCz,
	locale,
}: {
	entry: AccountLoyaltyEntry;
	isCz: boolean;
	locale: string;
}) {
	return (
		<div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-white">
						{entry.venue.name}
					</div>
					<div className="mt-1 text-[11px] text-white/45">
						{formatDate(entry.createdAt, locale)}
					</div>
				</div>
				<div className="shrink-0 text-right">
					<div className="text-lg font-semibold text-gold">
						+{entry.cashbackCzk} Kč
					</div>
					<div
						className={`mt-1.5 inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${loyaltyStatusTone(entry)}`}
					>
						{loyaltyStatusLabel(entry, isCz)}
					</div>
				</div>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-white/8 pt-3 text-[11px] text-white/55">
				<div>
					{isCz ? "Základ účtu" : "Bill base"}: {entry.baseAmountCzk} Kč
				</div>
				<div>
					{isCz ? "Zbývá" : "Remaining"}: {entry.remainingCzk} Kč
				</div>
				<div>
					{isCz ? "Uplatněno" : "Redeemed"}: {entry.redeemedAmountCzk} Kč
				</div>
				<div>
					{isCz ? "Odemčení" : "Unlock"}:{" "}
					{formatDateShort(entry.availableAt, locale)}
				</div>
			</div>
		</div>
	);
}

function ReceiptCard({
	receipt,
	open,
	isCz,
	locale,
	onToggle,
}: {
	receipt: AccountReceipt;
	open: boolean;
	isCz: boolean;
	locale: string;
	onToggle: () => void;
}) {
	return (
		<div className="overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.04]">
			<button
				className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
				onClick={onToggle}
			>
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-white">
						{receipt.venue.name}
					</div>
					<div className="mt-1 text-[11px] text-white/45">
						{formatDate(receipt.closedAt, locale)} · {receipt.methodLabel} ·{" "}
						{receipt.itemCount} {isCz ? "pol." : "items"}
					</div>
				</div>

				<div className="shrink-0 text-right">
					<div className="text-lg font-semibold text-white">
						{receipt.amountCzk} Kč
					</div>
					<div className="mt-1 text-[11px] text-white/35">
						{open ? (isCz ? "Skrýt" : "Hide") : isCz ? "Detail" : "Details"}
					</div>
				</div>
			</button>

			{open ? (
				<div className="border-t border-white/8 px-4 py-4">
					<div className="space-y-2">
						{receipt.items.map((item) => (
							<div
								key={item.key}
								className="flex items-start justify-between gap-3 text-sm text-white/82"
							>
								<div>
									{item.name} × {item.qty}
									{item.comment ? (
										<div className="mt-0.5 text-[11px] text-white/45">
											{item.comment}
										</div>
									) : null}
								</div>
								<div className="shrink-0">{item.totalCzk} Kč</div>
							</div>
						))}
					</div>

					<div className="mt-4 space-y-1 border-t border-white/8 pt-3 text-[11px] text-white/55">
						<div className="flex justify-between">
							<span>{isCz ? "Celkem účet" : "Bill total"}</span>
							<span>{receipt.billTotalCzk} Kč</span>
						</div>
						<div className="flex justify-between">
							<span>{isCz ? "Použitý cashback" : "Cashback used"}</span>
							<span>−{receipt.loyaltyAppliedCzk} Kč</span>
						</div>
						<div className="flex justify-between text-gold">
							<span>{isCz ? "Získaný cashback" : "Cashback earned"}</span>
							<span>+{receipt.cashbackEarnedCzk} Kč</span>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

function EmptyCard({ title, text }: { title: string; text: string }) {
	return (
		<div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-7 text-center">
			<div className="text-sm font-semibold text-white/80">{title}</div>
			<div className="mx-auto mt-1.5 max-w-[18rem] text-xs leading-5 text-white/50">
				{text}
			</div>
		</div>
	);
}
