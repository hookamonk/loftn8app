"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { MenuResponse, MenuCategory, MenuItem, MenuSection } from "@/types";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useAuth } from "@/providers/auth";
import { useGuestFeed } from "@/providers/guestFeed";
import { getVenueName } from "@/lib/venue";
import { useI18n } from "@/providers/i18n";

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

function BellIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M13.7 20a1.9 1.9 0 0 1-3.4 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
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

  // Single "call the waiter" action — the guest browses the menu and a waiter
  // comes to take the order in person.
  const [calling, setCalling] = useState(false);

  const { push } = useToast();
  const { me } = useAuth();
  const { feed, refresh } = useGuestFeed();
  const router = useRouter();
  const isRegistered = Boolean(me?.authenticated);

  // The button mirrors the REAL state of the request, so the guest is never
  // told "waiter called" when the request has already been handled (or the
  // other way round). It clears itself once staff punch the order in.
  const request = feed?.orderRequest ?? null;
  const waiterOnTheWay = request?.status === "ACKED";
  const waiterCalled = Boolean(request);

  const sectionLabel: Record<MenuSection, string> = useMemo(
    () => ({
      DISHES: isCz ? "Jídlo" : "Dishes",
      DRINKS: isCz ? "Nápoje" : "Drinks",
      HOOKAH: isCz ? "Vodní dýmka" : "Hookah",
    }),
    [isCz]
  );

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
      } catch (e: unknown) {
        if (!cached) {
          setErr(
            e instanceof Error ? e.message : isCz ? "Menu se nepodařilo načíst" : "Failed to load menu"
          );
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

  const filteredItems = useMemo<MenuItem[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return activeCat?.items ?? [];

    const hits: MenuItem[] = [];
    for (const c of cats) {
      for (const i of c.items ?? []) {
        const haystack = [i.name, i.nameCs, i.description, i.descriptionCs]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (haystack.includes(query)) hits.push(i);
      }
    }
    return hits;
  }, [activeCat, q, cats]);

  const isSearching = q.trim().length > 0;

  const callWaiter = async () => {
    if (calling || waiterCalled) return;

    // Unregistered guests get the menu only — ordering (calling the waiter)
    // requires an account.
    if (!isRegistered) {
      push({
        kind: "info",
        title: isCz ? "Vyžaduje registraci" : "Registration required",
        message: isCz
          ? "Zaregistrujte se, abyste mohli objednat. Bez registrace je dostupné jen menu."
          : "Register to order. Without an account only the menu is available.",
      });
      router.push("/auth?next=/menu");
      return;
    }

    setCalling(true);
    try {
      await api("/calls", { method: "POST", body: JSON.stringify({ type: "WAITER" }) });
      await refresh();
      push({
        kind: "success",
        title: isCz ? "Obsluha přivolána" : "Waiter called",
        message: isCz ? "Číšník je na cestě k vašemu stolu." : "A waiter is on the way to your table.",
      });
    } catch (e: unknown) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message:
          e instanceof Error
            ? e.message
            : isCz
              ? "Nepodařilo se přivolat obsluhu"
              : "Failed to call the waiter",
      });
    } finally {
      setCalling(false);
    }
  };

  const showSubDropdown = (activeGroup?.cats?.length ?? 0) > 1;
  const availableSections = (["DISHES", "DRINKS", "HOOKAH"] as MenuSection[]).filter(
    (s) => (groupsBySection.get(s)?.length ?? 0) > 0
  );

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-40 pt-4">
        <div className="mb-3.5 pr-24">
          <h1 className="text-xl font-semibold text-white">Menu</h1>
          <div className="mt-0.5 text-[11px] tracking-[0.18em] text-white/35">{venueName}</div>
        </div>

        <div className="sticky top-0 z-30 -mx-1 rounded-2xl border border-white/10 bg-[#0c0c11]/95 p-2.5 shadow-[0_10px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
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
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
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

        <div className="mt-3.5 space-y-2.5">
          {isSearching ? (
            <div className="px-1 text-xs text-white/55">{isCz ? `Nalezeno: ${filteredItems.length}` : `Found: ${filteredItems.length}`}</div>
          ) : null}

          {filteredItems.map((i) => {
            return (
              <div
                key={i.id}
                className="rounded-3xl border border-white/10 bg-white/6 p-3 backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.3)]"
              >
                <div className="flex gap-3">
                  <div className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
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
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="line-clamp-2 text-[15px] font-semibold leading-5 text-white">
                      {tName(i)}
                    </div>

                    {tDesc(i) ? (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-white/55">
                        {tDesc(i)}
                      </div>
                    ) : null}

                    <div className="mt-auto pt-2 text-base font-bold text-white">{i.priceCzk} Kč</div>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              {isCz ? "Nic nenalezeno." : "Nothing found."}
            </div>
          ) : null}
        </div>
      </main>

      {/* The only action on this screen: get a waiter to the table. Sits just
          above the tab bar and reflects the LIVE state of the request. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[100px] z-40 flex justify-center px-4">
        <button
          type="button"
          disabled={calling || (isRegistered && waiterCalled)}
          onClick={() => void callWaiter()}
          className={[
            "pointer-events-auto inline-flex h-12 max-w-full items-center justify-center gap-2 rounded-full px-6",
            "text-sm font-semibold shadow-[0_12px_34px_rgba(0,0,0,0.55)] transition",
            "active:scale-[0.97] disabled:active:scale-100",
            isRegistered && waiterCalled
              ? "border border-gold/30 bg-[#17150f]/95 text-amber-100 backdrop-blur-xl"
              : "bg-white text-black hover:bg-white/90 disabled:opacity-70",
          ].join(" ")}
        >
          {!isRegistered ? (
            <>
              <BellIcon />
              <span className="truncate">{isCz ? "Zaregistrovat se a objednat" : "Register to order"}</span>
            </>
          ) : calling ? (
            <span className="truncate">{isCz ? "Voláme…" : "Calling…"}</span>
          ) : waiterOnTheWay ? (
            <>
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
              <span className="truncate">{isCz ? "Číšník je na cestě" : "Waiter is on the way"}</span>
            </>
          ) : waiterCalled ? (
            <>
              <CheckIcon />
              <span className="truncate">{isCz ? "Obsluha přivolána" : "Waiter called"}</span>
            </>
          ) : (
            <>
              <BellIcon />
              <span className="truncate">{isCz ? "Zavolat obsluhu" : "Call the waiter"}</span>
            </>
          )}
        </button>
      </div>
    </RequireTable>
  );
}
