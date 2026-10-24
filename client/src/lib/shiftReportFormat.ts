/** Formatting shared by the shift report and the shift lists. */

export function money(czk: number) {
  return `${Math.round(czk).toLocaleString("cs-CZ")} Kč`;
}

export function clock(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function shiftSpan(openedAt: string, closedAt: string | null) {
  return `${dayLabel(openedAt)} · ${clock(openedAt)}–${closedAt ? clock(closedAt) : "сейчас"}`;
}

export function duration(openedAt: string, closedAt: string | null) {
  const ms = (closedAt ? new Date(closedAt).getTime() : Date.now()) - new Date(openedAt).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

export function minutes(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return "<1 мин";
  return `${Math.round(seconds / 60)} мин`;
}
