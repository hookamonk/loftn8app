"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { MenuResponse, MenuCategory, MenuItem, MenuSection } from "@/types";
import { useCart } from "@/providers/cart";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useAuth } from "@/providers/auth";

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
        "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active ? "border-white/10 bg-white text-black" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Qty({
  qty,
  disabled,
  onMinus,
  onPlus,
}: {
  qty: number;
  disabled?: boolean;
  onMinus: () => void;
  onPlus: () => void;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        className={[
          "rounded-2xl px-4 py-2 text-sm font-semibold",
          disabled ? "bg-white/30 text-black/60" : "bg-white text-black",
        ].join(" ")}
        onClick={onPlus}
      >
        Add
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-1">
      <button
        type="button"
        disabled={disabled}
        className={[
          "h-9 w-9 rounded-xl border border-white/10 bg-black/30 text-white",
          disabled ? "opacity-40" : "",
        ].join(" ")}
        onClick={onMinus}
        aria-label="Decrease"
      >
        −
      </button>
      <div className="w-6 text-center text-sm font-semibold text-white">{qty}</div>
      <button
        type="button"
        disabled={disabled}
        className={[
          "h-9 w-9 rounded-xl border border-white/10 bg-black/30 text-white",
          disabled ? "opacity-40" : "",
        ].join(" ")}
        onClick={onPlus}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

const SECTION_LABEL: Record<MenuSection, string> = {
  DISHES: "Dishes",
  DRINKS: "Drinks",
  HOOKAH: "Hookah",
};

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

export default function Page() {
  return <MenuPage />;
}

function MenuPage() {
  const [data, setData] = useState<MenuResponse | null>(null);
  const [activeSection, setActiveSection] = useState<MenuSection>("DISHES");
  const [activeCatId, setActiveCatId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const { items, add, dec, clear } = useCart();
  const { push } = useToast();
  const { me, loading: authLoading } = useAuth();

  const canOrder = !!me?.authenticated;

  useEffect(() => {
    if (authLoading) return;
    if (!canOrder) clear();
  }, [authLoading, canOrder, clear]);

  useEffect(() => {
    const load = async () => {
      try {
        const m = await api<MenuResponse>("/menu");
        const catsWithItems = (m.categories ?? []).filter((c) => (c.items?.length ?? 0) > 0);

        setData({ ...m, categories: catsWithItems });

        const sec = firstSection(catsWithItems);
        setActiveSection(sec);

        const firstCatInSec = catsWithItems.find((c) => c.section === sec);
        setActiveCatId(firstCatInSec?.id ?? catsWithItems[0]?.id ?? null);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load menu");
      }
    };
    void load();
  }, []);

  const cats = useMemo(() => data?.categories ?? [], [data]);

  const catsBySection = useMemo(() => {
    const map = new Map<MenuSection, MenuCategory[]>();
    for (const c of cats) {
      const sec = c.section as MenuSection;
      map.set(sec, [...(map.get(sec) ?? []), c]);
    }
    return map;
  }, [cats]);

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

  const qtyById = useMemo(() => {
    const map = new Map<number, number>();
    for (const it of items) map.set(it.menuItemId, it.qty);
    return map;
  }, [items]);

  const filteredItems = useMemo<SearchItem[]>(() => {
    const query = q.trim().toLowerCase();

    if (!query) return (activeCat?.items ?? []) as SearchItem[];

    const hits: SearchItem[] = [];
    for (const c of cats) {
      const sec = c.section as MenuSection;
      for (const i of c.items ?? []) {
        const name = (i.name ?? "").toLowerCase();
        const desc = (i.description ?? "").toLowerCase();
        if (name.includes(query) || desc.includes(query)) {
          hits.push({
            ...(i as any),
            __catId: c.id,
            __catName: c.name,
            __section: sec,
          });
        }
      }
    }
    return hits;
  }, [activeCat, q, cats]);

  const isSearching = q.trim().length > 0;

  const needAuthToast = () => {
    push({
      kind: "info",
      title: "Account required",
      message: "To place an order, please sign in or register.",
      action: { label: "Sign in", href: "/auth" },
    });
  };

  const onPlus = (i: MenuItem) => {
    if (!canOrder) return needAuthToast();
    add(i);
    push({
      kind: "success",
      title: "Added",
      message: i.name,
      action: { label: "Cart", href: "/cart" },
    });
  };

  const onMinus = (i: MenuItem) => {
    if (!canOrder) return;
    dec(i.id);
  };

  const showSubDropdown = (activeGroup?.cats?.length ?? 0) > 1;

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="mb-4">
          <div className="text-[11px] tracking-[0.28em] text-white/55">LOFT №8</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Menu</h1>
          <div className="mt-1 text-xs text-white/60">Order in 1–2 taps</div>
        </div>

        {!authLoading && !canOrder ? (
          <div className="mt-6 grid min-h-[45vh] place-items-center">
            <div className="w-full rounded-[28px] border border-white/10 bg-white/6 p-5 text-center backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
              <div className="text-base font-semibold text-white">You are in guest mode</div>
              <div className="mt-2 text-sm text-white/70">
                Without registration, only the <b>Staff</b> section is available.
              </div>

              <div className="mt-4 flex justify-center gap-2">
                <Link
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
                  href="/call"
                >
                  Staff
                </Link>
                <Link className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black" href="/auth">
                  Sign in / Register
                </Link>
              </div>

              <div className="mt-3 text-[11px] text-white/55">Register to place orders.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none"
                placeholder="Search the menu…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              {err ? (
                <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-200">
                  {err}
                </div>
              ) : null}

              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {(["DISHES", "DRINKS", "HOOKAH"] as MenuSection[])
                  .filter((s) => (groupsBySection.get(s)?.length ?? 0) > 0)
                  .map((s) => (
                    <Pill
                      key={s}
                      active={s === activeSection}
                      onClick={() => {
                        setActiveSection(s);
                        setQ("");
                      }}
                    >
                      {SECTION_LABEL[s]}
                    </Pill>
                  ))}
              </div>

              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {sectionGroups.map((g) => (
                  <Pill
                    key={g.key}
                    active={g.key === activeGroupKey}
                    onClick={() => {
                      setActiveCatId(g.cats[0]?.id ?? null);
                      setQ("");
                    }}
                  >
                    {g.label}
                  </Pill>
                ))}
              </div>

              {showSubDropdown && activeGroup ? (
                <div className="mt-2">
                  <div className="relative">
                    <select
                      value={activeCat?.id ?? ""}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setActiveCatId(Number.isFinite(next) ? next : null);
                        setQ("");
                      }}
                      className={[
                        "w-full appearance-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 pr-10",
                        "text-sm text-white outline-none",
                      ].join(" ")}
                    >
                      {activeGroup.cats.map((c) => {
                        const { sub } = splitCatName(c.name);
                        return (
                          <option key={c.id} value={c.id} className="text-black">
                            {sub ?? c.name}
                          </option>
                        );
                      })}
                    </select>

                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/60">
                      ▾
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {isSearching ? (
                <div className="px-1 text-xs text-white/55">Found: {filteredItems.length}</div>
              ) : null}

              {filteredItems.map((i) => {
                const qty = qtyById.get(i.id) ?? 0;

                const meta =
                  isSearching && i.__catName && i.__section
                    ? `${SECTION_LABEL[i.__section]} · ${i.__catName}`
                    : null;

                return (
                  <div
                    key={i.id}
                    className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-[92px] w-[92px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                        {i.imageUrl ? (
                          <img
                            src={i.imageUrl}
                            alt={i.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}

                        <div className="grid h-full w-full place-items-center text-[10px] font-semibold tracking-[0.18em] text-white/45">
                          LOFT №8
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        {meta ? <div className="text-[11px] text-white/55">{meta}</div> : null}

                        <div className="text-sm font-semibold text-white">{i.name}</div>

                        {i.description ? (
                          <div className="mt-1 text-xs leading-snug text-white/65">{i.description}</div>
                        ) : null}

                        <div className="mt-2 text-sm font-semibold text-white">{i.priceCzk} Kč</div>
                      </div>

                      <div className="shrink-0">
                        <Qty qty={qty} disabled={!canOrder} onMinus={() => onMinus(i)} onPlus={() => onPlus(i)} />
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredItems.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  Nothing found.
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>
    </RequireTable>
  );
}