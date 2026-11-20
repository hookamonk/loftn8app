"use client";

import { useEffect, useRef, useState } from "react";
import { attachGuest, detachGuest, searchGuests, type GuestMatch, type TablePerson } from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * «Гости» of a table: a regular who didn't scan the QR code is found by name,
 * e-mail, phone or card number and attached in two taps. Their name shows on
 * the table and the cashback of what they pay goes to them. A guest attached
 * by mistake can be detached until something is billed to them.
 */

export type GuestSheetTarget = { tableId: number; tableCode: string; people: TablePerson[] };

export function GuestSheet({
  target,
  onClose,
  onChanged,
}: {
  target: GuestSheetTarget | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  useEscapeToClose(!!target, onClose);
  if (!target) return null;
  return <Sheet key={target.tableId} target={target} onClose={onClose} onChanged={onChanged} />;
}

function Sheet({ target, onClose, onChanged }: { target: GuestSheetTarget; onClose: () => void; onChanged: () => void }) {
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GuestMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<GuestMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  // Search as you type (from 3 characters), the latest answer wins.
  const onQuery = (value: string) => {
    setQ(value);
    const query = value.trim();
    const seq = ++seqRef.current;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (query.length < 3) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timerRef.current = window.setTimeout(() => {
      void searchGuests(query).then((r) => {
        if (seq !== seqRef.current) return;
        setSearching(false);
        if (r.ok) setResults(r.data.guests);
        else push({ kind: "error", title: "Поиск не удался", message: r.error });
      });
    }, 300);
  };

  const seatedIds = new Set(target.people.map((person) => person.userId));

  const attach = async () => {
    if (!picked || busy) return;
    setBusy(true);
    const r = await attachGuest(target.tableId, picked.id);
    setBusy(false);
    if (!r.ok) return push({ kind: "error", title: "Не подключился", message: r.error });
    push({
      kind: "success",
      title: r.data.already ? "Уже за столом" : "Гость подключён",
      message: `${r.data.name} · стол ${target.tableCode}`,
    });
    // Ready for the next one at the same table.
    setPicked(null);
    onQuery("");
    onChanged();
  };

  const detach = async (person: TablePerson) => {
    if (busy) return;
    if (!window.confirm(`Отвязать ${person.name} от стола ${target.tableCode}?`)) return;
    setBusy(true);
    const r = await detachGuest(target.tableId, person.sessionId);
    setBusy(false);
    if (!r.ok) return push({ kind: "error", title: "Не отвязался", message: r.error });
    push({ kind: "info", title: "Гость отвязан", message: person.name });
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 staff-sheet-bottom">
        <div className="text-[11px] tracking-[0.18em] text-white/40">СТОЛ {target.tableCode}</div>

        {picked ? (
          <>
            <div className="mt-1 text-lg font-semibold text-white">Подключить к столу?</div>
            <div className="mt-3 rounded-xl bg-black/30 px-3 py-2.5">
              <div className="text-base font-semibold text-white">{picked.name}</div>
              <div className="mt-0.5 text-xs text-white/50">{contacts(picked)}</div>
              {picked.atTable && picked.atTable !== target.tableCode ? (
                <div className="mt-1 text-xs text-amber-200/80">Сейчас за столом {picked.atTable}</div>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-white/45">Кэшбэк с того, что он оплатит, уйдёт на его аккаунт.</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void attach()}
              className="mt-4 h-11 w-full rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
            >
              {busy ? "…" : "Да, подключить"}
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
            >
              Нет
            </button>
          </>
        ) : (
          <>
            <div className="mt-1 text-lg font-semibold text-white">Гости</div>

            {target.people.length ? (
              <div className="mt-3 space-y-1.5">
                {target.people.map((person) => (
                  <div key={person.sessionId} className="flex items-center justify-between gap-3 rounded-xl bg-black/30 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{person.name}</div>
                      <div className="text-[11px] text-white/45">
                        {person.card ? `карта …${person.card} · ` : ""}
                        {person.attached ? "подключён вручную" : "сам отсканировал QR"}
                      </div>
                    </div>
                    {person.attached ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void detach(person)}
                        className="h-8 shrink-0 rounded-lg border border-white/10 px-2.5 text-xs font-semibold text-white/60 disabled:opacity-40"
                      >
                        Отвязать
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <input
              autoFocus
              className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
              placeholder="Имя, email, телефон или номер карты"
              value={q}
              maxLength={80}
              onChange={(e) => onQuery(e.target.value)}
            />

            <div className="mt-2 space-y-1.5">
              {q.trim().length > 0 && q.trim().length < 3 ? (
                <div className="px-1 text-xs text-white/40">Минимум 3 символа</div>
              ) : searching && !results ? (
                <div className="px-1 text-xs text-white/40">Ищем…</div>
              ) : results && results.length === 0 ? (
                <div className="px-1 text-sm text-white/50">Никого не нашли. Гость должен быть зарегистрирован в приложении.</div>
              ) : (
                results?.map((guest) => {
                  const here = seatedIds.has(guest.id);
                  return (
                    <button
                      key={guest.id}
                      type="button"
                      disabled={here}
                      onClick={() => setPicked(guest)}
                      className="block w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition active:bg-white/10 disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-white">{guest.name}</span>
                        {here ? (
                          <span className="shrink-0 text-[11px] text-emerald-300">уже за столом</span>
                        ) : guest.atTable ? (
                          <span className="shrink-0 text-[11px] text-amber-200/80">стол {guest.atTable}</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-white/45">{contacts(guest)}</div>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
            >
              Готово
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function contacts(guest: GuestMatch) {
  return [guest.email, guest.phone, guest.card ? `карта …${guest.card}` : null].filter(Boolean).join(" · ") || "—";
}
