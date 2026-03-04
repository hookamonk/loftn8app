"use client";

import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/providers/cart";
import { api } from "@/lib/api";
import Link from "next/link";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useAuth } from "@/providers/auth";

export default function CartPage() {
  const { me, loading } = useAuth();
  const isAuthed = !!me?.authenticated;

  const { items, dec, add, remove, setItemComment, totalCzk, clear } = useCart();
  const [orderComment, setOrderComment] = useState("");
  const { push } = useToast();

  // ✅ если гость — корзина не нужна, чистим
  useEffect(() => {
    if (loading) return;
    if (!isAuthed) clear();
  }, [loading, isAuthed, clear]);

  const count = useMemo(() => items.reduce((s, x) => s + x.qty, 0), [items]);

  const submit = async () => {
    if (!isAuthed) {
      push({
        kind: "info",
        title: "Нужен аккаунт",
        message: "Чтобы отправить заказ, нужно войти или зарегистрироваться.",
        action: { label: "Войти", href: "/auth" },
      });
      return;
    }

    if (items.length === 0) return;

    try {
      await api("/orders", {
        method: "POST",
        body: JSON.stringify({
          comment: orderComment || undefined,
          items: items.map((x) => ({
            menuItemId: x.menuItemId,
            qty: x.qty,
            comment: x.comment || undefined,
          })),
        }),
      });

      clear();
      setOrderComment("");

      push({
        kind: "success",
        title: "Заказ отправлен ✅",
        message: "Персонал уже видит ваш стол",
        action: { label: "Персонал", href: "/call" },
      });

      window.setTimeout(() => {
        window.location.href = "/menu";
      }, 600);
    } catch (e: any) {
      push({ kind: "error", title: "Ошибка заказа", message: e?.message ?? "Failed" });
    }
  };

  // ✅ гость: блокируем страницу
  if (!loading && !isAuthed) {
    return (
      <RequireTable>
        <main className="mx-auto max-w-md px-4 pb-28 pt-5">
          <div className="text-[11px] tracking-[0.28em] text-white/55">LOFT №8</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Корзина</h1>

          <div className="mt-5 rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
            <div className="text-base font-semibold text-white">Корзина недоступна</div>
            <div className="mt-2 text-sm text-white/70">
              Вы продолжили без регистрации — доступен только раздел <b>Персонал</b>.
            </div>

            <div className="mt-4 flex gap-2">
              <Link className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white" href="/call">
                Персонал
              </Link>
              <Link className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black" href="/auth">
                Войти / Регистрация
              </Link>
            </div>
          </div>
        </main>
      </RequireTable>
    );
  }

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] tracking-[0.28em] text-white/55">LOFT №8</div>
            <h1 className="mt-1 text-2xl font-bold text-white">Корзина</h1>
            <div className="mt-1 text-xs text-white/60">{count ? `Позиций: ${count}` : "Пока пусто"}</div>
          </div>

          <Link href="/menu" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">
            В меню
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="mt-4 rounded-[28px] border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Корзина пустая.{" "}
            <Link className="underline text-white" href="/menu">
              Открыть меню
            </Link>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {items.map((x) => (
            <div
              key={x.menuItemId}
              className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{x.name}</div>
                  <div className="mt-1 text-xs text-white/65">{x.priceCzk} Kč</div>
                </div>

                <div className="flex items-center gap-2">
                  <button className="h-10 w-10 rounded-2xl border border-white/10 bg-black/30 text-white" onClick={() => dec(x.menuItemId)}>
                    −
                  </button>
                  <div className="w-8 text-center text-sm font-semibold text-white">{x.qty}</div>
                  <button
                    className="h-10 w-10 rounded-2xl border border-white/10 bg-black/30 text-white"
                    onClick={() => add({ id: x.menuItemId, name: x.name, priceCzk: x.priceCzk } as any)}
                  >
                    +
                  </button>
                </div>
              </div>

              <textarea
                className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none"
                placeholder="Комментарий к позиции (необязательно)"
                value={x.comment ?? ""}
                onChange={(e) => setItemComment(x.menuItemId, e.target.value)}
                rows={2}
              />

              <button className="mt-2 text-xs font-semibold text-white/70 underline" onClick={() => remove(x.menuItemId)}>
                Удалить
              </button>
            </div>
          ))}
        </div>

        {items.length > 0 ? (
          <div className="mt-4 rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Итого</div>
              <div className="text-lg font-bold text-white">{totalCzk} Kč</div>
            </div>

            <textarea
              className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none"
              placeholder="Комментарий ко всему заказу (необязательно)"
              value={orderComment}
              onChange={(e) => setOrderComment(e.target.value)}
              rows={2}
            />

            <button className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black" onClick={submit}>
              Отправить заказ
            </button>
          </div>
        ) : null}
      </main>
    </RequireTable>
  );
}