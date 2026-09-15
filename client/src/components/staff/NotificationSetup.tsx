"use client";

import { useCallback, useEffect, useState } from "react";
import { enablePush, getPushState, sendTestPush, type PushState } from "@/lib/staffPush";
import { armAudio } from "@/lib/staffAlerts";
import { useToast } from "@/providers/toast";

/**
 * Одна строка: статус уведомлений плюс одно действие.
 *
 * В обычную смену push уже включён, поэтому строка и остаётся строкой. Разбор
 * «почему не работает» (установка на iOS, снятие блокировки) нужен редко — он
 * свёрнут под кнопку и разворачивается только тогда, когда что-то сломано.
 */

type Tone = "ok" | "warn" | "bad" | "info";

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
  info: "bg-sky-400",
};

const LABEL_COLOR: Record<Tone, string> = {
  ok: "text-emerald-200/90",
  warn: "text-amber-200/90",
  bad: "text-red-200/90",
  info: "text-sky-200/90",
};

function statusView(state: PushState | null): { tone: Tone; label: string } {
  if (!state) return { tone: "info", label: "проверяем…" };

  switch (state.status) {
    case "on":
      return { tone: "ok", label: "включены" };
    case "off":
      return { tone: "warn", label: "выключены" };
    case "denied":
      return { tone: "bad", label: "заблокированы" };
    case "ios-needs-install":
      return { tone: "info", label: "нужна установка" };
    case "server-not-configured":
      return { tone: "bad", label: "не настроены на сервере" };
    default:
      return { tone: "bad", label: "браузер не поддерживает" };
  }
}

function installSteps(inSafari: boolean) {
  return inSafari
    ? [
        "Нажмите «Поделиться» — квадрат со стрелкой внизу экрана.",
        "Выберите «На экран «Домой»» → «Добавить».",
        "Откройте LOFT№8 Staff с экрана «Домой» и войдите.",
        "Вернитесь сюда и включите уведомления.",
      ]
    : [
        "Откройте этот адрес в Safari — в других браузерах на iPhone установка недоступна.",
        "«Поделиться» → «На экран «Домой»» → «Добавить».",
        "Откройте LOFT№8 Staff с экрана «Домой» и войдите.",
        "Вернитесь сюда и включите уведомления.",
      ];
}

function deniedSteps(isIos: boolean) {
  return isIos
    ? [
        "«Настройки» телефона → «Уведомления».",
        "Найдите LOFT№8 Staff и включите «Допуск уведомлений».",
        "Вернитесь и нажмите «Проверить ещё раз».",
      ]
    : [
        "Нажмите на замок слева от адреса в адресной строке.",
        "«Настройки сайта» → «Уведомления» → «Разрешить».",
        "Обновите страницу.",
      ];
}

const btnGhostSm =
  "shrink-0 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/10 disabled:opacity-50";
const btnPrimarySm =
  "shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";

export function NotificationSetup() {
  const { push } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setState(await getPushState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Перепроверяем при возврате в приложение: пользователь мог только что
  // установить его на «Домой» или поменять разрешение в настройках.
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
      push({ kind: "success", title: "Уведомления включены" });
      return;
    }

    if ("error" in result) {
      push({ kind: "error", title: "Не получилось", message: result.error });
      return;
    }

    setOpen(true);
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
      push({ kind: "success", title: "Отправлено", message: "Заблокируйте экран — уведомление придёт со звуком." });
      return;
    }

    push({ kind: "error", title: "Устройств не найдено", message: "Включите уведомления заново." });
    await refresh();
  };

  const view = statusView(state);
  const status = state?.status;
  const hasDetails =
    status === "ios-needs-install" ||
    status === "denied" ||
    status === "unsupported" ||
    status === "server-not-configured";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[view.tone]}`} />
          <span className="text-sm font-semibold text-white">Уведомления</span>
          <span className={`truncate text-xs ${LABEL_COLOR[view.tone]}`}>{view.label}</span>
        </div>

        {status === "on" ? (
          <button className={btnGhostSm} disabled={testing} onClick={() => void onTest()}>
            {testing ? "Шлём…" : "Проверить"}
          </button>
        ) : status === "off" ? (
          <button className={btnPrimarySm} disabled={busy} onClick={() => void onEnable()}>
            {busy ? "Включаем…" : "Включить"}
          </button>
        ) : hasDetails ? (
          <button className={btnGhostSm} onClick={() => setOpen((current) => !current)}>
            {open ? "Скрыть" : "Что делать"}
          </button>
        ) : null}
      </div>

      {open && state?.status === "ios-needs-install" ? (
        <Details
          steps={installSteps(state.inSafari)}
          action={{ label: "Я установил — проверить", onClick: () => void refresh() }}
        />
      ) : null}

      {open && state?.status === "denied" ? (
        <Details
          steps={deniedSteps(state.platform === "ios")}
          action={{ label: "Проверить ещё раз", onClick: () => void refresh() }}
        />
      ) : null}

      {open && state?.status === "server-not-configured" ? (
        <Details note="На сервере не заданы VAPID-ключи — push отключён для всех. Сообщите администратору." />
      ) : null}

      {open && state?.status === "unsupported" ? (
        <Details note="Этот браузер не умеет получать уведомления. Откройте панель в Chrome на Android или добавьте её на экран «Домой» на iPhone." />
      ) : null}
    </div>
  );
}

function Details({
  steps,
  note,
  action,
}: {
  steps?: string[];
  note?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-3 border-t border-white/8 pt-3">
      {note ? <div className="text-xs leading-5 text-white/60">{note}</div> : null}

      {steps ? (
        <ol className="space-y-1.5">
          {steps.map((text, index) => (
            <li key={text} className="flex gap-2 text-xs leading-5 text-white/65">
              <span className="shrink-0 text-white/30">{index + 1}.</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {action ? (
        <button className={`${btnGhostSm} mt-3 w-full`} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
