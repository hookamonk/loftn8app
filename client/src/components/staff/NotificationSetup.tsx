"use client";

import { useCallback, useEffect, useState } from "react";
import {
  enablePush,
  getPushState,
  sendTestPush,
  type PushState,
} from "@/lib/staffPush";
import { armAudio } from "@/lib/staffAlerts";
import { useToast } from "@/providers/toast";

/**
 * Single place where a staff member gets notifications working on their phone.
 *
 * Web push support is genuinely different per platform and no library changes
 * that, so instead of a button that silently fails we show the real state and
 * the exact next step:
 *   • Android browsers  → one tap, done.
 *   • iOS / iPadOS      → must be added to the Home Screen first (Apple rule).
 *   • Blocked / unsupported → explain how to undo it.
 */

type Tone = "ok" | "warn" | "bad" | "info";

const TONE: Record<Tone, { pill: string; dot: string }> = {
  ok: { pill: "border-emerald-400/30 bg-emerald-500/12 text-emerald-200", dot: "bg-emerald-400" },
  warn: { pill: "border-amber-400/30 bg-amber-400/10 text-amber-200", dot: "bg-amber-400" },
  bad: { pill: "border-red-400/30 bg-red-500/12 text-red-200", dot: "bg-red-400" },
  info: { pill: "border-sky-400/30 bg-sky-500/12 text-sky-200", dot: "bg-sky-400" },
};

function statusView(state: PushState | null): { tone: Tone; label: string } {
  if (!state) return { tone: "info", label: "Проверяем…" };

  switch (state.status) {
    case "on":
      return { tone: "ok", label: "Уведомления включены" };
    case "off":
      return { tone: "warn", label: "Уведомления выключены" };
    case "denied":
      return { tone: "bad", label: "Уведомления заблокированы" };
    case "ios-needs-install":
      return { tone: "info", label: "Нужно добавить на экран «Домой»" };
    case "server-not-configured":
      return { tone: "bad", label: "Push не настроен на сервере" };
    default:
      return { tone: "bad", label: "Браузер не поддерживает уведомления" };
  }
}

const btnPrimary =
  "h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.99] disabled:opacity-50";
const btnGhost =
  "h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50";

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 space-y-2">
      {items.map((text, index) => (
        <li key={text} className="flex gap-3 text-sm leading-6 text-white/75">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 bg-white/8 text-[11px] font-bold text-white">
            {index + 1}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

export function NotificationSetup() {
  const { push } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    setState(await getPushState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check when the app comes back to the foreground: the user may have just
  // installed it to the Home Screen or changed the permission in settings.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const onEnable = async () => {
    setBusy(true);
    const result = await enablePush();
    setBusy(false);
    await refresh();

    if (result.ok) {
      await armAudio();
      push({ kind: "success", title: "Готово", message: "Уведомления включены. Проверьте их кнопкой ниже." });
      return;
    }

    if ("error" in result) {
      push({ kind: "error", title: "Не получилось", message: result.error });
    }
  };

  const onTest = async () => {
    setTesting(true);
    const result = await sendTestPush();
    setTesting(false);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    if (result.data.sent > 0) {
      push({
        kind: "success",
        title: "Отправлено",
        message: "Уведомление уже в пути. Заблокируйте экран — оно должно прийти со звуком.",
      });
      return;
    }

    push({
      kind: "error",
      title: "Устройств не найдено",
      message: "Похоже, подписка слетела. Нажмите «Включить уведомления» ещё раз.",
    });
    await refresh();
  };

  const view = statusView(state);

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-white">Уведомления</div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${TONE[view.tone].pill}`}
        >
          <span className={`h-2 w-2 rounded-full ${TONE[view.tone].dot}`} />
          {view.label}
        </span>
      </div>

      {state?.status === "on" ? (
        <>
          <div className="mt-2 text-xs leading-5 text-white/55">
            Новые заказы и вызовы приходят на телефон со звуком и вибрацией — даже когда приложение закрыто.
          </div>
          <div className="mt-4">
            <button className={btnGhost} disabled={testing} onClick={() => void onTest()}>
              {testing ? "Отправляем…" : "Проверить уведомление"}
            </button>
          </div>
        </>
      ) : null}

      {state?.status === "off" ? (
        <>
          <div className="mt-2 text-xs leading-5 text-white/55">
            Включите один раз — дальше телефон сам звякнет и завибрирует, когда гость позовёт.
          </div>
          <div className="mt-4">
            <button className={btnPrimary} disabled={busy} onClick={() => void onEnable()}>
              {busy ? "Включаем…" : "Включить уведомления"}
            </button>
          </div>
        </>
      ) : null}

      {state?.status === "ios-needs-install" ? (
        <>
          <div className="mt-2 text-xs leading-5 text-white/55">
            На iPhone и iPad уведомления работают только из приложения на экране «Домой» — это ограничение Apple,
            в обычной вкладке браузера они невозможны. Установка занимает 15 секунд.
          </div>
          <Steps
            items={
              state.inSafari
                ? [
                    "Нажмите «Поделиться» — квадрат со стрелкой вверх внизу экрана.",
                    "Пролистайте и выберите «На экран «Домой»».",
                    "Нажмите «Добавить».",
                    "Откройте LOFT№8 Staff с экрана «Домой» и войдите.",
                    "Нажмите «Включить уведомления» на этом экране.",
                  ]
                : [
                    "Откройте этот адрес в Safari — в других браузерах на iPhone установка недоступна.",
                    "Нажмите «Поделиться» — квадрат со стрелкой вверх.",
                    "Выберите «На экран «Домой»» и нажмите «Добавить».",
                    "Откройте LOFT№8 Staff с экрана «Домой» и войдите.",
                    "Нажмите «Включить уведомления» на этом экране.",
                  ]
            }
          />
          <div className="mt-4">
            <button className={btnGhost} onClick={() => void refresh()}>
              Я установил — проверить
            </button>
          </div>
        </>
      ) : null}

      {state?.status === "denied" ? (
        <>
          <div className="mt-2 text-xs leading-5 text-white/55">
            Уведомления запрещены в настройках. Браузер больше не спросит — разрешение нужно вернуть вручную.
          </div>
          <Steps
            items={
              state.platform === "ios"
                ? [
                    "Откройте «Настройки» телефона → «Уведомления».",
                    "Найдите LOFT№8 Staff и включите «Допуск уведомлений».",
                    "Вернитесь сюда и нажмите «Проверить ещё раз».",
                  ]
                : [
                    "Нажмите на замок (или иконку слева от адреса) в адресной строке.",
                    "Откройте «Настройки сайта» → «Уведомления».",
                    "Выберите «Разрешить» и обновите страницу.",
                  ]
            }
          />
          <div className="mt-4">
            <button className={btnGhost} onClick={() => void refresh()}>
              Проверить ещё раз
            </button>
          </div>
        </>
      ) : null}

      {state?.status === "server-not-configured" ? (
        <div className="mt-2 text-xs leading-5 text-white/55">
          На сервере не заданы VAPID-ключи, поэтому push отключён для всех. Сообщите администратору — нужно
          заполнить VAPID_SUBJECT, VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY и перезапустить сервер.
        </div>
      ) : null}

      {state?.status === "unsupported" ? (
        <div className="mt-2 text-xs leading-5 text-white/55">
          Этот браузер не умеет получать уведомления. Откройте панель в Chrome (Android) или в Safari на iPhone,
          добавив её на экран «Домой». Пока звук будет работать только при открытой панели.
        </div>
      ) : null}

      <div className="mt-3 border-t border-white/8 pt-3 text-[11px] leading-5 text-white/40">
        Пока панель открыта, новые заказы и вызовы звучат и без уведомлений — звук включается после первого касания
        экрана.
      </div>
    </div>
  );
}
