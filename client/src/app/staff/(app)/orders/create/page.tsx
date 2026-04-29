"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { createTableOrder } from "@/lib/staffApi";
import type { MenuResponse, MenuCategory, MenuItem, MenuSection } from "@/types";
import { useToast } from "@/providers/toast";
import { useStaffSession } from "@/providers/staffSession";

type DraftItem = {
  menuItemId: number;
  name: string;
  priceCzk: number;
  qty: number;
};

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

function FilterPill({
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

function QtyInline({
  qty,
  onMinus,
  onPlus,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className="flex h-11 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-2">
      <button
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-lg text-white"
        onClick={onMinus}
        type="button"
      >
        −
      </button>
      <div className="w-8 text-center text-sm font-semibold text-white">{qty}</div>
      <button
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-lg text-white"
        onClick={onPlus}
        type="button"
      >
        +
      </button>
    </div>
  );
}

export default function StaffOrderCreatePage() {
  const params = useSearchParams();
  const router = useRouter();
  const { push } = useToast();

  const requestId = params.get("requestId") ?? "";
  const tableId = Number(params.get("tableId") ?? 0);
  const tableCode = params.get("tableCode") ?? "";
  const sessionId = params.get("sessionId") ?? "";
  const returnTo = params.get("returnTo") ?? "";
  const { staff } = useStaffSession();

  const [data, setData] = useState<MenuResponse | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [comment, setComment] = useState("");
  const [activeSection, setActiveSection] = useState<MenuSection>("DISHES");
  const [activeCatId, setActiveCatId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setErr(null);

      try {
        const menu = await api<MenuResponse>("/menu");
        const categories = (menu.categories ?? []).filter((category) => (category.items?.length ?? 0) > 0);
        setData({ ...menu, categories });
        const first = firstSection(categories);
        setActiveSection(first);
        const firstCatInSection = categories.find((category) => category.section === first);
        setActiveCatId(firstCatInSection?.id ?? categories[0]?.id ?? null);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load menu");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const visibleCategories = useMemo(() => {
    if (!staff) return categories;
    if (staff.role === "HOOKAH") {
      return categories.filter((category) => category.section === "HOOKAH");
    }
    if (staff.role === "WAITER") {
      return categories.filter((category) => category.section === "DISHES" || category.section === "DRINKS");
    }
    return categories;
  }, [categories, staff]);

  const groupsBySection = useMemo(() => {
    const map = new Map<MenuSection, CatGroup[]>();

    for (const category of visibleCategories) {
      const section = category.section as MenuSection;
      const { group } = splitCatName(category.name);

      const list = map.get(section) ?? [];
      let target = list.find((entry) => entry.key === group);

      if (!target) {
        target = { key: group, label: group, sort: category.sort ?? 0, cats: [] };
        list.push(target);
        map.set(section, list);
      }

      target.sort = Math.min(target.sort, category.sort ?? 0);
      target.cats.push(category);
    }

    for (const [section, list] of map.entries()) {
      list.sort((a, b) => a.sort - b.sort);
      for (const group of list) group.cats.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      map.set(section, list);
    }

    return map;
  }, [visibleCategories]);

  const sectionGroups = groupsBySection.get(activeSection) ?? [];

  const activeGroupKey = useMemo(() => {
    const active = visibleCategories.find((category) => category.id === activeCatId) ?? null;
    if (!active) return sectionGroups[0]?.key ?? null;
    return splitCatName(active.name).group;
  }, [visibleCategories, activeCatId, sectionGroups]);

  const activeGroup = useMemo(() => {
    return sectionGroups.find((group) => group.key === activeGroupKey) ?? sectionGroups[0] ?? null;
  }, [sectionGroups, activeGroupKey]);

  const activeCategory = useMemo(() => {
    if (!activeGroup) return null;
    if (activeCatId && activeGroup.cats.some((category) => category.id === activeCatId)) {
      return activeGroup.cats.find((category) => category.id === activeCatId) ?? null;
    }
    return activeGroup.cats[0] ?? null;
  }, [activeGroup, activeCatId]);

  useEffect(() => {
    const groups = groupsBySection.get(activeSection) ?? [];
    if (!groups.length) {
      setActiveCatId(null);
      return;
    }

    const allIds = new Set(groups.flatMap((group) => group.cats.map((category) => category.id)));
    if (activeCatId && allIds.has(activeCatId)) return;

    setActiveCatId(groups[0].cats[0]?.id ?? null);
  }, [activeSection, groupsBySection, activeCatId]);

  useEffect(() => {
    if (!visibleCategories.length) return;
    const availableSections = ["DISHES", "DRINKS", "HOOKAH"].filter((section) =>
      visibleCategories.some((category) => category.section === section)
    ) as MenuSection[];

    if (!availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0] ?? "DISHES");
    }
  }, [visibleCategories, activeSection]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const baseItems = (query ? visibleCategories : activeCategory ? [activeCategory] : []).flatMap((category) =>
      category.items.map((item) => ({
        ...item,
        categoryName: category.name,
      }))
    );

    if (!query) return baseItems;
    return baseItems.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        String(item.description ?? "").toLowerCase().includes(query) ||
        item.categoryName.toLowerCase().includes(query)
    );
  }, [visibleCategories, search, activeCategory]);

  const qtyById = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) map.set(item.menuItemId, item.qty);
    return map;
  }, [items]);

  const selectedQty = useMemo(() => items.reduce((sum, item) => sum + item.qty, 0), [items]);
  const totalCzk = useMemo(() => items.reduce((sum, item) => sum + item.priceCzk * item.qty, 0), [items]);

  const addItem = (item: MenuItem) => {
    setItems((current) => {
      const next = [...current];
      const index = next.findIndex((entry) => entry.menuItemId === item.id);
      if (index >= 0) {
        next[index] = { ...next[index], qty: next[index].qty + 1 };
      } else {
        next.push({
          menuItemId: item.id,
          name: item.name,
          priceCzk: item.priceCzk,
          qty: 1,
        });
      }
      return next;
    });
  };

  const decItem = (menuItemId: number) => {
    setItems((current) =>
      current
        .map((item) => (item.menuItemId === menuItemId ? { ...item, qty: item.qty - 1 } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const submit = async () => {
    if (!tableId || !sessionId || items.length === 0 || submitting) return;
    setSubmitting(true);

    try {
      const result = await createTableOrder({
        tableId,
        sessionId,
        requestId: requestId || undefined,
        comment: comment || undefined,
        items: items.map((item) => ({
          menuItemId: item.menuItemId,
          qty: item.qty,
        })),
      });

      if (!result.ok) {
        push({ kind: "error", title: "Error", message: result.error });
        return;
      }

      push({
        kind: "success",
        title: "Order saved",
        message: `Table ${tableCode} now has an updated order.`,
      });

      router.replace(returnTo || "/staff/orders?status=IN_PROGRESS");
    } finally {
      setSubmitting(false);
    }
  };

  const showSubDropdown = (activeGroup?.cats?.length ?? 0) > 1;

  return (
    <div>
      <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] tracking-[0.24em] text-white/45">TABLE ORDER</div>
            <div className="mt-2 text-xl font-semibold text-white">Table {tableCode || "—"}</div>
            <div className="mt-1 text-sm text-white/60">Build the full order for this table, then save it at the end.</div>
          </div>

          <Link
            href={returnTo || "/staff/orders"}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            Back
          </Link>
        </div>

        <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-3">
          <input
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none"
            placeholder="Search the menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {(["DISHES", "DRINKS", "HOOKAH"] as MenuSection[])
              .filter((section) => (visibleCategories ?? []).some((category) => category.section === section))
              .map((section) => (
                <FilterPill
                  key={section}
                  onClick={() => {
                    setActiveSection(section);
                    setSearch("");
                  }}
                  active={activeSection === section}
                >
                  {SECTION_LABEL[section]}
                </FilterPill>
              ))}
          </div>

          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {sectionGroups.map((group) => (
              <FilterPill
                key={group.key}
                onClick={() => {
                  setActiveCatId(group.cats[0]?.id ?? null);
                  setSearch("");
                }}
                active={group.key === activeGroupKey}
              >
                {group.label}
              </FilterPill>
            ))}
          </div>

          {showSubDropdown && activeGroup ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {activeGroup.cats.map((category) => {
                const { sub } = splitCatName(category.name);
                return (
                  <FilterPill
                    key={category.id}
                    active={activeCategory?.id === category.id}
                    onClick={() => {
                      setActiveCatId(category.id);
                      setSearch("");
                    }}
                  >
                    {sub ?? category.name}
                  </FilterPill>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
      ) : null}

      {loading ? <div className="mt-4 text-sm text-white/60">Loading menu…</div> : null}

      <div className="mt-4 space-y-3">
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const qty = qtyById.get(item.id) ?? 0;

            return (
              <div
                key={item.id}
                className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                      {item.categoryName}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white">{item.name}</div>
                    {item.description ? (
                      <div className="mt-1 text-xs leading-5 text-white/65">{item.description}</div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-white">{item.priceCzk} Kč</div>
                    <div className="mt-3 w-[132px]">
                      <QtyInline qty={qty} onMinus={() => decItem(item.id)} onPlus={() => addItem(item)} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && filteredItems.length === 0 ? (
            <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 text-sm text-white/65">
              Nothing found in this section.
            </div>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Order summary</div>
              <div className="mt-1 text-xs text-white/55">
                {selectedQty > 0 ? `${selectedQty} item${selectedQty === 1 ? "" : "s"} ready to save` : "Select dishes or drinks above"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Draft total</div>
              <div className="mt-1 text-lg font-bold text-white">{totalCzk} Kč</div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div key={item.menuItemId} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3 text-sm text-white">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="mt-1 text-xs text-white/50">Qty {item.qty}</div>
                  </div>
                  <div className="font-semibold">{item.priceCzk * item.qty} Kč</div>
                </div>
              </div>
            ))}

            {items.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/55">
                Select dishes or drinks above to build the table order.
              </div>
            ) : null}
          </div>

          <textarea
            className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none"
            placeholder="Order note for the kitchen or bar (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />

          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={items.length === 0 || submitting}
              className="flex-1 rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
              onClick={() => void submit()}
            >
              {submitting ? "Saving…" : "Save table order"}
            </button>

            <Link
              href={returnTo || "/staff/orders"}
              className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
