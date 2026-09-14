"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { createTableOrder } from "@/lib/staffApi";
import { getStaffVenueSlug } from "@/lib/venue";
import { useStaffSession } from "@/providers/staffSession";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";
import type { MenuCategory, MenuItem, MenuResponse, MenuSection } from "@/types";

/**
 * Full-screen sheet for punching an order in at the table. Deliberately opened
 * IN PLACE (over the current tab) instead of navigating away, so the waiter
 * never loses the queue they came from and never has to find their way back.
 */

type DraftItem = { menuItemId: number; name: string; priceCzk: number; qty: number };

const SECTION_LABEL: Record<MenuSection, string> = {
  DISHES: "Еда",
  DRINKS: "Напитки",
  HOOKAH: "Кальян",
};

function splitCatName(name: string) {
  const sep = " · ";
  if (!name.includes(sep)) return { group: name.trim(), sub: null as string | null };
  const [group, sub] = name.split(sep);
  return { group: (group ?? "").trim(), sub: (sub ?? "").trim() || null };
}

function Pill({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
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

function Qty({ qty, onMinus, onPlus }: { qty: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex h-11 w-[124px] items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-1.5">
      <button
        type="button"
        aria-label="Убрать"
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg text-white active:bg-white/15"
        onClick={onMinus}
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-semibold text-white">{qty}</span>
      <button
        type="button"
        aria-label="Добавить"
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg text-white active:bg-white/15"
        onClick={onPlus}
      >
        +
      </button>
    </div>
  );
}

export function OrderComposer({
  open,
  tableId,
  tableCode,
  sessionId,
  requestId,
  onClose,
  onSaved,
}: {
  open: boolean;
  tableId: number;
  tableCode: string;
  sessionId: string;
  requestId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { staff } = useStaffSession();
  const { push } = useToast();
  useEscapeToClose(open, onClose);

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [comment, setComment] = useState("");
  const [section, setSection] = useState<MenuSection>("DISHES");
  const [catId, setCatId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fresh draft every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setItems([]);
    setComment("");
    setSearch("");
  }, [open, tableId]);

  useEffect(() => {
    if (!open) return;

    const venueSlug = staff?.venueSlug ?? getStaffVenueSlug();
    const cacheKey = `staffMenuCache:${venueSlug}`;

    // Paint instantly from cache (the menu rarely changes mid-shift), refresh after.
    let hadCache = false;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        setMenu(JSON.parse(raw) as MenuResponse);
        hadCache = true;
      }
    } catch {
      // ignore cache read errors
    }

    const load = async () => {
      if (!hadCache) setLoading(true);
      try {
        const next = await api<MenuResponse>("/menu", { headers: { "X-Venue-Slug": venueSlug } });
        setMenu(next);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          // ignore cache write errors
        }
      } catch {
        // keep whatever we already have on screen
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [open, staff]);

  // A hookah master may only add hookah; a waiter only food and drinks.
  const categories = useMemo<MenuCategory[]>(() => {
    const all = (menu?.categories ?? []).filter((c) => (c.items?.length ?? 0) > 0);
    if (staff?.role === "HOOKAH") return all.filter((c) => c.section === "HOOKAH");
    if (staff?.role === "WAITER") return all.filter((c) => c.section !== "HOOKAH");
    return all;
  }, [menu, staff]);

  const sections = useMemo(
    () => (["DISHES", "DRINKS", "HOOKAH"] as MenuSection[]).filter((s) => categories.some((c) => c.section === s)),
    [categories]
  );

  useEffect(() => {
    if (sections.length && !sections.includes(section)) setSection(sections[0]);
  }, [sections, section]);

  const sectionCats = useMemo(() => categories.filter((c) => c.section === section), [categories, section]);

  useEffect(() => {
    if (!sectionCats.length) {
      setCatId(null);
      return;
    }
    if (catId && sectionCats.some((c) => c.id === catId)) return;
    setCatId(sectionCats[0].id);
  }, [sectionCats, catId]);

  const activeCat = sectionCats.find((c) => c.id === catId) ?? sectionCats[0] ?? null;

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = query ? categories : activeCat ? [activeCat] : [];
    const flat = source.flatMap((c) => c.items.map((i) => ({ ...i, categoryName: c.name })));
    if (!query) return flat;
    return flat.filter((i) =>
      `${i.name} ${i.description ?? ""} ${i.categoryName}`.toLowerCase().includes(query)
    );
  }, [categories, activeCat, search]);

  const qtyById = useMemo(() => new Map(items.map((i) => [i.menuItemId, i.qty])), [items]);
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
  const totalCzk = items.reduce((sum, i) => sum + i.priceCzk * i.qty, 0);

  const add = (item: MenuItem) =>
    setItems((current) => {
      const index = current.findIndex((entry) => entry.menuItemId === item.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...next[index], qty: next[index].qty + 1 };
        return next;
      }
      return [...current, { menuItemId: item.id, name: item.name, priceCzk: item.priceCzk, qty: 1 }];
    });

  const remove = (menuItemId: number) =>
    setItems((current) =>
      current
        .map((i) => (i.menuItemId === menuItemId ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0)
    );

  const save = async () => {
    if (!items.length || saving) return;
    setSaving(true);

    const result = await createTableOrder({
      tableId,
      sessionId,
      requestId,
      comment: comment.trim() || undefined,
      items: items.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })),
    });

    setSaving(false);

    if (!result.ok) {
      push({ kind: "error", title: "Не сохранилось", message: result.error });
      return;
    }

    push({ kind: "success", title: "Заказ сохранён", message: `Стол ${tableCode} · ${totalCzk} Kč` });
    onSaved();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#07070a]" role="dialog" aria-modal="true">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0c0c11] px-4 pb-3 pt-4">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.24em] text-white/45">ЗАКАЗ</div>
            <div className="mt-1 truncate text-lg font-semibold text-white">Стол {tableCode}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80"
          >
            Закрыть
          </button>
        </div>

        <div className="mx-auto mt-3 max-w-md space-y-2">
          <input
            className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
            placeholder="Поиск по меню…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {!search && sections.length > 1 ? (
            <div className="flex gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
              {sections.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSection(s)}
                  className={[
                    "h-9 flex-1 rounded-xl text-xs font-semibold transition",
                    s === section ? "bg-white text-black" : "text-white/65",
                  ].join(" ")}
                >
                  {SECTION_LABEL[s]}
                </button>
              ))}
            </div>
          ) : null}

          {!search && sectionCats.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sectionCats.map((c) => {
                const { group, sub } = splitCatName(c.name);
                return (
                  <Pill key={c.id} active={activeCat?.id === c.id} onClick={() => setCatId(c.id)}>
                    {sub ?? group}
                  </Pill>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Menu list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-md space-y-2">
          {loading && !menu ? <div className="text-sm text-white/55">Загружаем меню…</div> : null}

          {visibleItems.map((item) => {
            const qty = qtyById.get(item.id) ?? 0;
            return (
              <div
                key={item.id}
                className={[
                  "rounded-2xl border p-3 transition",
                  qty > 0 ? "border-emerald-400/30 bg-emerald-500/10" : "border-white/10 bg-white/[0.04]",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{item.name}</div>
                    {item.description ? (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-white/50">
                        {item.description}
                      </div>
                    ) : null}
                    <div className="mt-1 text-sm font-semibold text-white/85">{item.priceCzk} Kč</div>
                  </div>
                  <Qty qty={qty} onMinus={() => remove(item.id)} onPlus={() => add(item)} />
                </div>
              </div>
            );
          })}

          {!loading && visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60">
              Ничего не найдено.
            </div>
          ) : null}

          {items.length ? (
            <textarea
              className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
              placeholder="Комментарий к заказу (необязательно)"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          ) : null}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="border-t border-white/10 bg-[#0c0c11] px-4 pb-6 pt-3">
        <div className="mx-auto max-w-md">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-white/55">
              {totalQty > 0 ? `Позиций: ${totalQty}` : "Выберите позиции"}
            </span>
            <span className="text-lg font-bold text-white">{totalCzk} Kč</span>
          </div>
          <button
            type="button"
            disabled={!items.length || saving}
            onClick={() => void save()}
            className="h-14 w-full rounded-2xl bg-white text-base font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Сохранить заказ"}
          </button>
        </div>
      </div>
    </div>
  );
}
