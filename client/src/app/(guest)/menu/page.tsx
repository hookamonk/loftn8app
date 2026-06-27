"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { MenuResponse, MenuCategory, MenuItem, MenuSection } from "@/types";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useGuestFeed } from "@/providers/guestFeed";
import { useAuth } from "@/providers/auth";
import { getVenueName } from "@/lib/venue";
import { storage } from "@/lib/storage";
import { GUEST_ONBOARDING_SYNC_EVENT, readGuestOnboardingState } from "@/lib/guestOnboarding";
import { useEscapeToClose } from "@/lib/useModalA11y";
import { useI18n } from "@/providers/i18n";

// One-time notice shown on the menu (after onboarding) re-explaining that the
// guest builds the order here and the waiter confirms it at the table.
const MENU_ORDER_NOTICE_KEY = "guest_menu_order_notice_v1";

function Pill({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold transition",
        active
          ? "border-white/10 bg-white text-black"
          : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function SelectControl({
  qty,
  onAdd,
  onRemove,
  labelSelect,
}: {
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
  labelSelect: string;
}) {
  if (qty <= 0) {
    return (
      <button
        type="button"
        className="h-10 shrink-0 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition active:scale-[0.97] hover:bg-white/90"
        onClick={onAdd}
      >
        {labelSelect}
      </button>
    );
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-gold/25 bg-gold/15 px-1.5">
      <button
        type="button"
        aria-label="−"
        className="grid h-8 w-8 place-items-center rounded-xl text-lg font-semibold text-amber-50 active:bg-white/10"
        onClick={onRemove}
      >
        −
      </button>
      <div className="min-w-6 text-center text-sm font-bold text-amber-50">{qty}</div>
      <button
        type="button"
        aria-label="+"
        className="grid h-8 w-8 place-items-center rounded-xl text-lg font-semibold text-amber-50 active:bg-white/10"
        onClick={onAdd}
      >
        +
      </button>
    </div>
  );
}

function firstSection(categories: MenuCategory[]): MenuSection {
  return (categories[0]?.section as MenuSection) ?? "DISHES";
}

function splitCatName(name: string): { group: string; sub: string | null } {
  const sep = " · ";
  if (!name.includes(sep)) return { group: name.trim(), sub: null };
  const [g, s] = name.split(sep);
  return { group: (g ?? "").trim(), sub: (s ?? "").trim() || null };
}

type CatGroup = {
  key: string;
  label: string;
  sort: number;
  cats: MenuCategory[];
};

type SearchItem = MenuItem & {
  __catId?: number;
  __catName?: string;
  __section?: MenuSection;
};

const MENU_CACHE_TTL_MS = 60 * 1000;

function cacheKey(venueName: string) {
  return `guest_menu_cache_v2:${venueName}`;
}

function readCachedMenu(venueName: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(cacheKey(venueName));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { ts: number; data: MenuResponse };
    if (!parsed?.ts || !parsed?.data) return null;
    if (Date.now() - parsed.ts > MENU_CACHE_TTL_MS) return null;

    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedMenu(venueName: string, data: MenuResponse) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      cacheKey(venueName),
      JSON.stringify({
        ts: Date.now(),
        data,
      })
    );
  } catch {
    // ignore cache write errors
  }
}

export default function Page() {
  return <MenuPage />;
}

function MenuPage() {
  const router = useRouter();
  const { isCz, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";

  // Show Czech content when CZ is selected, fall back to the base (English) text.
  const tName = (it: { name: string; nameCs?: string | null }) => (isCz ? it.nameCs || it.name : it.name);
  const tDesc = (it: { description?: string | null; descriptionCs?: string | null }) =>
    (isCz ? it.descriptionCs || it.description : it.description) ?? null;
  const tCat = (c: { name: string; nameCs?: string | null }) => (isCz ? c.nameCs || c.name : c.name);
  const [data, setData] = useState<MenuResponse | null>(null);
  const [activeSection, setActiveSection] = useState<MenuSection>("DISHES");
  const [activeCatId, setActiveCatId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Guest "selection" — dishes the guest picks for cashback. The actual order
  // is taken by the waiter; this is a local wishlist persisted per session.
  const [selection, setSelection] = useState<Record<number, number>>({});

  const { push } = useToast();
  const { feed, refresh } = useGuestFeed();
  const { me } = useAuth();
  const isRegistered = Boolean(me?.authenticated);

  // After onboarding completes (or once for already-onboarded guests), reaffirm
  // how ordering works at the table via a one-time modal.
  const [showOrderNotice, setShowOrderNotice] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const onboarding = readGuestOnboardingState();
      const seen = storage.get<boolean>(MENU_ORDER_NOTICE_KEY, false);
      if (onboarding.completed && !seen) setShowOrderNotice(true);
    };
    check();
    window.addEventListener(GUEST_ONBOARDING_SYNC_EVENT, check as EventListener);
    return () => window.removeEventListener(GUEST_ONBOARDING_SYNC_EVENT, check as EventListener);
  }, []);
  const dismissOrderNotice = () => {
    storage.set(MENU_ORDER_NOTICE_KEY, true);
    setShowOrderNotice(false);
  };
  useEscapeToClose(showOrderNotice, dismissOrderNotice);

  const selectionKey = feed?.currentSessionId ? `menuSelection:${feed.currentSessionId}` : null;

  useEffect(() => {
    if (!selectionKey) return;
    setSelection(storage.get<Record<number, number>>(selectionKey, {}));
  }, [selectionKey]);

  useEffect(() => {
    if (!selectionKey) return;
    storage.set(selectionKey, selection);
  }, [selectionKey, selection]);

  const selectionCount = useMemo(
    () => Object.values(selection).reduce((sum, qty) => sum + (qty > 0 ? qty : 0), 0),
    [selection]
  );

  const addToSelection = (itemId: number) =>
    setSelection((cur) => ({ ...cur, [itemId]: (cur[itemId] ?? 0) + 1 }));
  const decFromSelection = (itemId: number) =>
    setSelection((cur) => {
      const next = (cur[itemId] ?? 0) - 1;
      const copy = { ...cur };
      if (next <= 0) delete copy[itemId];
      else copy[itemId] = next;
      return copy;
    });
  const sectionLabel: Record<MenuSection, string> = useMemo(
    () => ({
      DISHES: isCz ? "Jídlo" : "Dishes",
      DRINKS: isCz ? "Nápoje" : "Drinks",
      HOOKAH: isCz ? "Vodní dýmka" : "Hookah",
    }),
    [isCz]
  );

  const latestOrderRequest = feed?.orderRequest ?? null;
  const activeOrderRequest =
    latestOrderRequest && (latestOrderRequest.status === "NEW" || latestOrderRequest.status === "ACKED")
      ? latestOrderRequest
      : null;
  const orderRequestActive = Boolean(activeOrderRequest);

  const applyMenu = (m: MenuResponse) => {
    const catsWithItems = (m.categories ?? []).filter((c) => (c.items?.length ?? 0) > 0);
    const next = { ...m, categories: catsWithItems };
    setData(next);

    const sec = firstSection(catsWithItems);
    setActiveSection(sec);

    const firstCatInSec = catsWithItems.find((c) => c.section === sec);
    setActiveCatId(firstCatInSec?.id ?? catsWithItems[0]?.id ?? null);
  };

  useEffect(() => {
    const cached = readCachedMenu(venueName);
    if (cached) {
      applyMenu(cached);
    }

    const load = async () => {
      try {
        const m = await api<MenuResponse>("/menu");
        writeCachedMenu(venueName, m);
        applyMenu(m);
      } catch (e: any) {
        if (!cached) {
          setErr(e?.message ?? (isCz ? "Menu se nepodařilo načíst" : "Failed to load menu"));
        }
      }
    };
    void load();
  }, [isCz, venueName]);

  const cats = useMemo(() => data?.categories ?? [], [data]);

  const groupsBySection = useMemo(() => {
    const map = new Map<MenuSection, CatGroup[]>();

    for (const c of cats) {
      const sec = c.section as MenuSection;
      const { group } = splitCatName(c.name);

      const list = map.get(sec) ?? [];
      let g = list.find((x) => x.key === group);

      if (!g) {
        g = { key: group, label: group, sort: c.sort ?? 0, cats: [] };
        list.push(g);
        map.set(sec, list);
      }

      g.sort = Math.min(g.sort, c.sort ?? 0);
      g.cats.push(c);
    }

    for (const [sec, list] of map.entries()) {
      list.sort((a, b) => a.sort - b.sort);
      for (const g of list) g.cats.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      map.set(sec, list);
    }

    return map;
  }, [cats]);

  const sectionGroups = groupsBySection.get(activeSection) ?? [];

  const activeGroupKey = useMemo(() => {
    const active = cats.find((c) => c.id === activeCatId) ?? null;
    if (!active) return sectionGroups[0]?.key ?? null;
    return splitCatName(active.name).group;
  }, [cats, activeCatId, sectionGroups]);

  const activeGroup = useMemo(() => {
    return sectionGroups.find((g) => g.key === activeGroupKey) ?? sectionGroups[0] ?? null;
  }, [sectionGroups, activeGroupKey]);

  const activeCat = useMemo(() => {
    if (!activeGroup) return null;
    if (activeCatId && activeGroup.cats.some((c) => c.id === activeCatId)) {
      return activeGroup.cats.find((c) => c.id === activeCatId) ?? null;
    }
    return activeGroup.cats[0] ?? null;
  }, [activeGroup, activeCatId]);

  useEffect(() => {
    const groups = groupsBySection.get(activeSection) ?? [];
    if (!groups.length) {
      setActiveCatId(null);
      return;
    }

    const allIds = new Set(groups.flatMap((g) => g.cats.map((c) => c.id)));
    if (activeCatId && allIds.has(activeCatId)) return;

    setActiveCatId(groups[0].cats[0]?.id ?? null);
  }, [activeSection, groupsBySection, activeCatId]);

  const filteredItems = useMemo<SearchItem[]>(() => {
    const query = q.trim().toLowerCase();

    if (!query) return (activeCat?.items ?? []) as SearchItem[];

    const hits: SearchItem[] = [];
    for (const c of cats) {
      const sec = c.section as MenuSection;
      for (const i of c.items ?? []) {
        const haystack = [i.name, i.nameCs, i.description, i.descriptionCs]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (haystack.includes(query)) {
          hits.push({
            ...(i as any),
            __catId: c.id,
            __catName: tCat(c),
            __section: sec,
          });
        }
      }
    }
    return hits;
  }, [activeCat, q, cats]);

  const isSearching = q.trim().length > 0;

  const requestOrder = async () => {
    if (orderRequestActive || requesting) return;

    // Unregistered guests can browse and call staff, but ordering requires an
    // account — send them to registration instead of hitting a 403.
    if (!isRegistered) {
      push({
        kind: "info",
        title: isCz ? "Vyžaduje registraci" : "Registration required",
        message: isCz
          ? "Pro objednávku se prosím zaregistrujte. Obsluhu můžete přivolat i bez registrace."
          : "Please register to place an order. You can call staff without an account.",
      });
      router.push("/auth?next=/menu");
      return;
    }

    setRequesting(true);

    const items = Object.entries(selection)
      .map(([id, qty]) => ({ menuItemId: Number(id), qty }))
      .filter((it) => Number.isFinite(it.menuItemId) && it.qty > 0);

    try {
      await api("/orders/request", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setSelection({});
      await refresh();

      push({
        kind: "success",
        title: isCz ? "Výzva odeslána" : "Call sent",
        message: isCz ? "Číšník jde k vašemu stolu." : "A waiter is on the way to your table.",
      });
      router.push("/cart");
    } catch (e: any) {
      push({
        kind: "error",
        title: isCz ? "Chyba požadavku" : "Request error",
        message: e?.message ?? (isCz ? "Požadavek se nepodařilo odeslat" : "Failed"),
      });
    } finally {
      setRequesting(false);
    }
  };

  const showSubDropdown = (activeGroup?.cats?.length ?? 0) > 1;
  const availableSections = (["DISHES", "DRINKS", "HOOKAH"] as MenuSection[]).filter(
    (s) => (groupsBySection.get(s)?.length ?? 0) > 0
  );

  // Running total of the current selection, shown in the floating order bar.
  const selectionTotalCzk = useMemo(() => {
    const priceById = new Map<number, number>();
    for (const c of cats) for (const it of c.items ?? []) priceById.set(it.id, it.priceCzk);
    return Object.entries(selection).reduce(
      (sum, [id, qty]) => sum + (qty > 0 ? qty * (priceById.get(Number(id)) ?? 0) : 0),
      0
    );
  }, [selection, cats]);

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="mb-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">{venueName}</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Menu</h1>
        </div>

        <div className="mb-4 rounded-2xl border border-gold/30 bg-gold/12 px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold/20 text-sm text-amber-200">★</span>
            <div className="min-w-0">
              {isRegistered ? (
                <>
                  <div className="text-sm font-semibold text-amber-50">
                    {isCz ? "Objednávejte přímo z menu" : "Order right from the menu"}
                  </div>
                  <div className="mt-0.5 text-xs leading-5 text-amber-100/85">
                    {isCz
                      ? "Výběr odešleme obsluze — číšník přijde upřesnit a potvrdit."
                      : "Your selection goes to the staff — a waiter comes to confirm it."}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-amber-50">
                    {isCz ? "Prohlížíte si menu" : "You're browsing the menu"}
                  </div>
                  <div className="mt-0.5 text-xs leading-5 text-amber-100/85">
                    {isCz
                      ? "Pro objednávku a cashback se zaregistrujte. Obsluhu můžete přivolat kdykoli."
                      : "Register to place an order and earn cashback. You can call staff anytime."}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-30 -mx-1 rounded-3xl border border-white/10 bg-[#0c0c11]/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" strokeLinecap="round" />
            </svg>
            <input
              className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
              placeholder={isCz ? "Hledat v menu…" : "Search the menu…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-200">
              {err}
            </div>
          ) : null}

          {/* Sections — сегмент-контрол (равные доли, без скролла) */}
          {availableSections.length > 1 ? (
            <div className="mt-3 flex gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
              {availableSections.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setActiveSection(s);
                    setQ("");
                  }}
                  className={[
                    "h-9 flex-1 rounded-xl text-xs font-semibold transition",
                    s === activeSection
                      ? "bg-white text-black shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
                      : "text-white/65 hover:text-white",
                  ].join(" ")}
                >
                  {sectionLabel[s]}
                </button>
              ))}
            </div>
          ) : null}

          {/* Groups — чипсы (горизонтальный скролл) */}
          {sectionGroups.length > 1 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sectionGroups.map((g) => (
                <Pill
                  key={g.key}
                  active={g.key === activeGroupKey}
                  onClick={() => {
                    setActiveCatId(g.cats[0]?.id ?? null);
                    setQ("");
                  }}
                >
                  {g.cats[0] ? splitCatName(tCat(g.cats[0])).group : g.label}
                </Pill>
              ))}
            </div>
          ) : null}

          {/* Subcategories — чипсы вместо select */}
          {showSubDropdown && activeGroup ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {activeGroup.cats.map((c) => {
                const localized = tCat(c);
                const { sub } = splitCatName(localized);
                return (
                  <Pill
                    key={c.id}
                    active={activeCat?.id === c.id}
                    onClick={() => {
                      setActiveCatId(c.id);
                      setQ("");
                    }}
                  >
                    {sub ?? localized}
                  </Pill>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="mt-4 space-y-3">
          {isSearching ? (
            <div className="px-1 text-xs text-white/55">{isCz ? `Nalezeno: ${filteredItems.length}` : `Found: ${filteredItems.length}`}</div>
          ) : null}

          {filteredItems.map((i) => {
            const meta =
              isSearching && i.__catName && i.__section
                ? `${sectionLabel[i.__section]} · ${i.__catName}`
                : null;

            return (
              <div
                key={i.id}
                className={[
                  "rounded-[28px] border bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition-colors",
                  (selection[i.id] ?? 0) > 0 ? "border-gold/35 bg-gold/[0.07]" : "border-white/10",
                ].join(" ")}
              >
                <div className="flex gap-4">
                  <div className="relative h-[104px] w-[104px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    {i.imageUrl ? (
                      <img
                        src={i.imageUrl}
                        alt={i.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}

                    {!i.imageUrl ? (
                      <div className="grid h-full w-full place-items-center text-[10px] font-semibold tracking-[0.18em] text-white/45">
                        LOFT№8
                      </div>
                    ) : null}

                    {(selection[i.id] ?? 0) > 0 ? (
                      <div className="absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-black shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                        {selection[i.id]}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    {meta ? <div className="text-[11px] text-white/55">{meta}</div> : null}

                    <div className="line-clamp-2 text-[16px] font-semibold leading-5 text-white">
                      {tName(i)}
                    </div>

                    {tDesc(i) ? (
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/60">
                        {tDesc(i)}
                      </div>
                    ) : null}

                    <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                      <div className="text-lg font-bold text-white">{i.priceCzk} Kč</div>
                      <SelectControl
                        qty={selection[i.id] ?? 0}
                        onAdd={() => addToSelection(i.id)}
                        onRemove={() => decFromSelection(i.id)}
                        labelSelect={isCz ? "Vybrat" : "Select"}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              {isCz ? "Nic nenalezeno." : "Nothing found."}
            </div>
          ) : null}
        </div>
      </main>

      {selectionCount > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 px-4">
          <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-3xl border border-gold/25 bg-[#101014]/96 p-2 pl-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <div className="grid h-10 min-w-10 place-items-center rounded-2xl bg-gold/15 px-2 text-sm font-bold text-amber-200">
              {selectionCount}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-base font-bold text-white">{selectionTotalCzk} Kč</div>
              <div className="truncate text-[11px] text-white/55">
                {isRegistered
                  ? isCz
                    ? "obsluha objednávku potvrdí"
                    : "staff will confirm the order"
                  : isCz
                  ? "zaregistrujte se k objednání"
                  : "register to order"}
              </div>
            </div>
            <button
              type="button"
              disabled={requesting || orderRequestActive}
              className="h-12 shrink-0 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition active:scale-[0.97] hover:bg-white/90 disabled:opacity-50"
              onClick={() => void requestOrder()}
            >
              {!isRegistered
                ? isCz
                  ? "Registrovat"
                  : "Register"
                : orderRequestActive
                ? isCz
                  ? "Odesláno"
                  : "Sent"
                : requesting
                ? isCz
                  ? "Odesílám…"
                  : "Sending…"
                : isCz
                ? "Objednat"
                : "Order"}
            </button>
          </div>
        </div>
      ) : null}

      {showOrderNotice ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={dismissOrderNotice}
        >
          <div
            className="w-full max-w-sm rounded-[28px] border border-gold/25 bg-[#151515]/97 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-xl text-amber-200">★</div>
            <div className="mt-4 text-lg font-semibold text-white">
              {isCz ? "Jak funguje objednávka" : "How ordering works"}
            </div>
            <div className="mt-2 text-sm leading-6 text-white/70">
              {isCz
                ? "Vyberete si v menu, výběr se odešle obsluze a číšník přijde upřesnit a potvrdit objednávku. Platba a stav jsou v sekci Účet."
                : "You pick in the menu, your selection is sent to the staff, and a waiter comes to confirm it. Payment and status live in the Cart."}
            </div>
            <button
              type="button"
              onClick={dismissOrderNotice}
              className="mt-5 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.98]"
            >
              {isCz ? "Rozumím" : "Got it"}
            </button>
          </div>
        </div>
      ) : null}
    </RequireTable>
  );
}
