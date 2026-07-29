"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAdminMenu,
  createAdminCategory,
  updateAdminCategory,
  deleteAdminCategory,
  createAdminItem,
  updateAdminItem,
  deleteAdminItem,
  type AdminMenu,
  type AdminMenuCategory,
  type AdminMenuItem,
  type AdminMenuSection,
  type AdminMenuVenue,
} from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { useToast } from "@/providers/toast";

const VENUES: Array<{ key: AdminMenuVenue; label: string }> = [
  { key: "zizkov", label: "Žižkov" },
  { key: "garden", label: "Garden" },
  { key: "nekazanka", label: "Nekázanka" },
];

const SECTIONS: Array<{ key: AdminMenuSection; label: string }> = [
  { key: "DISHES", label: "Кухня" },
  { key: "DRINKS", label: "Напитки" },
  { key: "HOOKAH", label: "Кальян" },
];

function sectionLabel(s: AdminMenuSection) {
  return SECTIONS.find((x) => x.key === s)?.label ?? s;
}

type ItemDraft = {
  id?: number;
  categoryId: number;
  name: string;
  nameCs: string;
  description: string;
  descriptionCs: string;
  priceCzk: string;
  isActive: boolean;
};

type CategoryDraft = {
  id?: number;
  name: string;
  nameCs: string;
  section: AdminMenuSection;
};

const btnPrimary =
  "rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-40";
const field =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25";

export default function StaffAdminMenuPage() {
  const { staff } = useStaffSession();
  const isAdmin = staff?.role === "ADMIN";
  const { push } = useToast();

  const [venue, setVenue] = useState<AdminMenuVenue>("zizkov");
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await getAdminMenu(venue);
    if (!r.ok) {
      setErr(r.error || "Не удалось загрузить меню");
      setLoading(false);
      return;
    }
    setMenu(r.data);
    setLoading(false);
  }, [venue]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = menu?.categories ?? [];

  // ===== Item actions =====
  const saveItem = async () => {
    if (!itemDraft) return;
    const price = Number(itemDraft.priceCzk);
    if (!itemDraft.name.trim()) {
      push({ kind: "error", title: "Название обязательно" });
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      push({ kind: "error", title: "Некорректная цена" });
      return;
    }

    setBusy(true);
    const payload = {
      name: itemDraft.name.trim(),
      nameCs: itemDraft.nameCs.trim() || undefined,
      description: itemDraft.description.trim() || undefined,
      descriptionCs: itemDraft.descriptionCs.trim() || undefined,
      priceCzk: Math.round(price),
      isActive: itemDraft.isActive,
    };

    const r = itemDraft.id
      ? await updateAdminItem(venue, itemDraft.id, { ...payload, categoryId: itemDraft.categoryId })
      : await createAdminItem(venue, { ...payload, categoryId: itemDraft.categoryId });
    setBusy(false);

    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }
    push({ kind: "success", title: itemDraft.id ? "Позиция сохранена" : "Позиция добавлена" });
    setItemDraft(null);
    await load();
  };

  const toggleActive = async (item: AdminMenuItem) => {
    setBusy(true);
    const r = await updateAdminItem(venue, item.id, { isActive: !item.isActive });
    setBusy(false);
    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }
    await load();
  };

  const removeItem = async (item: AdminMenuItem) => {
    if (!confirm(`Удалить «${item.name}»?`)) return;
    setBusy(true);
    const r = await deleteAdminItem(venue, item.id);
    setBusy(false);
    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }
    push({
      kind: "success",
      title: r.data.softDeleted ? "Позиция скрыта" : "Позиция удалена",
      message: r.data.softDeleted ? "По ней были заказы — она выключена, история сохранена." : undefined,
    });
    await load();
  };

  const moveItem = async (cat: AdminMenuCategory, index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= cat.items.length) return;
    const a = cat.items[index];
    const b = cat.items[target];
    setBusy(true);
    const r1 = await updateAdminItem(venue, a.id, { sort: b.sort });
    const r2 = await updateAdminItem(venue, b.id, { sort: a.sort });
    setBusy(false);
    if (!r1.ok || !r2.ok) {
      push({ kind: "error", title: "Не удалось изменить порядок" });
    }
    await load();
  };

  // ===== Category actions =====
  const saveCategory = async () => {
    if (!categoryDraft) return;
    if (!categoryDraft.name.trim()) {
      push({ kind: "error", title: "Название обязательно" });
      return;
    }
    setBusy(true);
    const payload = {
      name: categoryDraft.name.trim(),
      nameCs: categoryDraft.nameCs.trim() || undefined,
      section: categoryDraft.section,
    };
    const r = categoryDraft.id
      ? await updateAdminCategory(venue, categoryDraft.id, payload)
      : await createAdminCategory(venue, payload);
    setBusy(false);
    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }
    push({ kind: "success", title: categoryDraft.id ? "Категория сохранена" : "Категория добавлена" });
    setCategoryDraft(null);
    await load();
  };

  const removeCategory = async (cat: AdminMenuCategory) => {
    if (cat.items.length > 0) {
      push({
        kind: "error",
        title: "Категория не пустая",
        message: "Сначала перенесите или удалите позиции внутри.",
      });
      return;
    }
    if (!confirm(`Удалить категорию «${cat.name}»?`)) return;
    setBusy(true);
    const r = await deleteAdminCategory(venue, cat.id);
    setBusy(false);
    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }
    push({ kind: "success", title: "Категория удалена" });
    await load();
  };

  if (!isAdmin) {
    return (
      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-white">
        <div className="text-lg font-semibold">Меню</div>
        <div className="mt-2 text-sm text-white/55">Доступ только для администратора.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-5">
        <div className="mb-2 text-xs uppercase tracking-[0.14em] text-white/45">Точка</div>
        <div className="flex flex-wrap gap-2">
          {VENUES.map((v) => {
            const active = v.key === venue;
            return (
              <button
                key={v.key}
                onClick={() => setVenue(v.key)}
                className={[
                  "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
                  active
                    ? "border-white/20 bg-white text-black"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                {v.label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={btnPrimary}
            onClick={() =>
              setCategoryDraft({ name: "", nameCs: "", section: "DISHES" })
            }
          >
            + Категория
          </button>
          <button className={btnGhost} onClick={() => void load()}>
            Обновить
          </button>
        </div>
        <div className="mt-3 text-xs text-white/45">
          Изменения сразу видны в приложении гостя (кэш меню сбрасывается).
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading && !menu ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[140px] animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {categories.length === 0 ? (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-10 text-center text-sm text-white/60">
              В этой точке пока нет категорий. Нажмите «+ Категория».
            </div>
          ) : null}

          {categories.map((cat) => (
            <div key={cat.id} className="rounded-[24px] border border-white/10 bg-white/[0.05] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-lg font-semibold text-white">{cat.name}</div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-white/60">
                      {sectionLabel(cat.section)}
                    </span>
                  </div>
                  {cat.nameCs ? <div className="mt-0.5 text-xs text-white/45">{cat.nameCs}</div> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className={btnGhost}
                    onClick={() =>
                      setCategoryDraft({
                        id: cat.id,
                        name: cat.name,
                        nameCs: cat.nameCs ?? "",
                        section: cat.section,
                      })
                    }
                  >
                    Изменить
                  </button>
                  <button className={btnGhost} onClick={() => void removeCategory(cat)}>
                    Удалить
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {cat.items.map((it, index) => (
                  <div
                    key={it.id}
                    className={[
                      "flex items-start justify-between gap-3 rounded-2xl border p-3",
                      it.isActive
                        ? "border-white/10 bg-black/20"
                        : "border-white/8 bg-black/10 opacity-60",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{it.name}</span>
                        {!it.isActive ? (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                            выключено
                          </span>
                        ) : null}
                      </div>
                      {it.description ? (
                        <div className="mt-0.5 line-clamp-2 text-xs text-white/50">{it.description}</div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="text-sm font-semibold text-white">{it.priceCzk} Kč</div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className={btnGhost}
                          disabled={busy || index === 0}
                          onClick={() => void moveItem(cat, index, -1)}
                          aria-label="Выше"
                        >
                          ↑
                        </button>
                        <button
                          className={btnGhost}
                          disabled={busy || index === cat.items.length - 1}
                          onClick={() => void moveItem(cat, index, 1)}
                          aria-label="Ниже"
                        >
                          ↓
                        </button>
                        <button className={btnGhost} disabled={busy} onClick={() => void toggleActive(it)}>
                          {it.isActive ? "Выкл" : "Вкл"}
                        </button>
                        <button
                          className={btnGhost}
                          onClick={() =>
                            setItemDraft({
                              id: it.id,
                              categoryId: cat.id,
                              name: it.name,
                              nameCs: it.nameCs ?? "",
                              description: it.description ?? "",
                              descriptionCs: it.descriptionCs ?? "",
                              priceCzk: String(it.priceCzk),
                              isActive: it.isActive,
                            })
                          }
                        >
                          Изменить
                        </button>
                        <button className={btnGhost} onClick={() => void removeItem(it)}>
                          Удалить
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  className="mt-1 w-full rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/[0.06]"
                  onClick={() =>
                    setItemDraft({
                      categoryId: cat.id,
                      name: "",
                      nameCs: "",
                      description: "",
                      descriptionCs: "",
                      priceCzk: "",
                      isActive: true,
                    })
                  }
                >
                  + Позиция в «{cat.name}»
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== Item modal ===== */}
      {itemDraft ? (
        <Modal title={itemDraft.id ? "Позиция" : "Новая позиция"} onClose={() => setItemDraft(null)}>
          <div className="space-y-3">
            <label className="block text-xs text-white/60">Категория</label>
            <select
              className={field}
              value={itemDraft.categoryId}
              onChange={(e) => setItemDraft({ ...itemDraft, categoryId: Number(e.target.value) })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0b0b10]">
                  {c.name} · {sectionLabel(c.section)}
                </option>
              ))}
            </select>

            <input
              className={field}
              placeholder="Название"
              value={itemDraft.name}
              onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })}
            />
            <input
              className={field}
              placeholder="Название (CZ) — необязательно"
              value={itemDraft.nameCs}
              onChange={(e) => setItemDraft({ ...itemDraft, nameCs: e.target.value })}
            />
            <input
              className={field}
              placeholder="Цена, Kč"
              inputMode="numeric"
              value={itemDraft.priceCzk}
              onChange={(e) => setItemDraft({ ...itemDraft, priceCzk: e.target.value.replace(/[^\d]/g, "") })}
            />
            <textarea
              className={`${field} min-h-[80px] resize-y`}
              placeholder="Описание — необязательно"
              value={itemDraft.description}
              onChange={(e) => setItemDraft({ ...itemDraft, description: e.target.value })}
            />
            <textarea
              className={`${field} min-h-[64px] resize-y`}
              placeholder="Описание (CZ) — необязательно"
              value={itemDraft.descriptionCs}
              onChange={(e) => setItemDraft({ ...itemDraft, descriptionCs: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={itemDraft.isActive}
                onChange={(e) => setItemDraft({ ...itemDraft, isActive: e.target.checked })}
              />
              Показывать в меню
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button className={btnGhost} onClick={() => setItemDraft(null)}>
                Отмена
              </button>
              <button className={btnPrimary} disabled={busy} onClick={() => void saveItem()}>
                {busy ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ===== Category modal ===== */}
      {categoryDraft ? (
        <Modal
          title={categoryDraft.id ? "Категория" : "Новая категория"}
          onClose={() => setCategoryDraft(null)}
        >
          <div className="space-y-3">
            <input
              className={field}
              placeholder="Название"
              value={categoryDraft.name}
              onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
            />
            <input
              className={field}
              placeholder="Название (CZ) — необязательно"
              value={categoryDraft.nameCs}
              onChange={(e) => setCategoryDraft({ ...categoryDraft, nameCs: e.target.value })}
            />
            <label className="block text-xs text-white/60">Секция</label>
            <select
              className={field}
              value={categoryDraft.section}
              onChange={(e) =>
                setCategoryDraft({ ...categoryDraft, section: e.target.value as AdminMenuSection })
              }
            >
              {SECTIONS.map((s) => (
                <option key={s.key} value={s.key} className="bg-[#0b0b10]">
                  {s.label}
                </option>
              ))}
            </select>

            <div className="flex justify-end gap-2 pt-1">
              <button className={btnGhost} onClick={() => setCategoryDraft(null)}>
                Отмена
              </button>
              <button className={btnPrimary} disabled={busy} onClick={() => void saveCategory()}>
                {busy ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0b0b10] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-lg font-semibold text-white">{title}</div>
        {children}
      </div>
    </div>
  );
}
