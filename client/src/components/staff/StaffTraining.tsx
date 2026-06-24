"use client";

import { useEffect, useState } from "react";

type Slide = {
  title: string;
  intro: string;
  points: string[];
  examples?: Array<{ label: string; tone: "primary" | "ghost" | "soft" }>;
  note?: string;
};

const SLIDES: Slide[] = [
  {
    title: "Рабочая панель",
    intro:
      "Здесь вы видите всё, что происходит в зале прямо сейчас. Сверху — вкладки разделов.",
    points: [
      "«Главная» — смена, уведомления и быстрые цифры.",
      "«Заказы», «Вызовы», «Оплата» — то, что просят гости.",
      "«Столы» — кто сейчас сидит в зале.",
      "Цифра на вкладке — сколько новых дел вас ждёт.",
    ],
    examples: [
      { label: "Заказы 2", tone: "soft" },
      { label: "Вызовы 1", tone: "soft" },
      { label: "Оплата 1", tone: "soft" },
    ],
  },
  {
    title: "Смена",
    intro:
      "Всё работает только при открытой смене. Без неё новые заказы, вызовы и оплаты не приходят.",
    points: [
      "Менеджер в начале дня нажимает «Открыть смену».",
      "Официант и кальянщик нажимают «Войти в смену».",
      "В конце дня менеджер нажимает «Закрыть смену».",
    ],
    examples: [
      { label: "Открыть смену", tone: "primary" },
      { label: "Войти в смену", tone: "primary" },
      { label: "Закрыть смену", tone: "ghost" },
    ],
  },
  {
    title: "Уведомления",
    intro:
      "Чтобы слышать новые заказы и вызовы, один раз включите уведомления на своём телефоне.",
    points: [
      "Нажмите «Включить уведомления» и разрешите их.",
      "Дальше телефон сам звякнет и завибрирует, когда гость вас позовёт.",
    ],
    examples: [{ label: "Включить уведомления", tone: "soft" }],
    note: "На iPhone сначала добавьте приложение на экран «Домой» — иначе звук на заблокированном экране работать не будет.",
  },
  {
    title: "Заказы",
    intro:
      "Гость выбирает блюда в меню — у вас появляется запрос. Четыре вкладки: Принять → Готовятся → Готовые → Отменённые.",
    points: [
      "«Принять» — новые запросы. «Принять» создаёт заказ сразу, «Дополнить» — открывает форму, чтобы добавить позиции.",
      "После принятия заказ уходит в «Готовятся».",
      "Когда блюдо готово — «Отметить готовым», заказ уходит в «Готовые».",
      "«Отменённые» — отменённые заказы.",
    ],
    examples: [
      { label: "Принять", tone: "primary" },
      { label: "Дополнить", tone: "ghost" },
      { label: "Отметить готовым", tone: "primary" },
    ],
  },
  {
    title: "Вызовы",
    intro:
      "Гость зовёт официанта или кальянщика, либо пишет сообщение — вызов приходит сюда.",
    points: [
      "«Взять в работу» — гость видит, что вы уже идёте.",
      "«Завершить» — когда выполнили просьбу.",
      "Вкладки сверху: новые, взятые в работу, завершённые.",
    ],
    examples: [
      { label: "Взять в работу", tone: "primary" },
      { label: "Завершить", tone: "soft" },
    ],
  },
  {
    title: "Оплата и столы",
    intro:
      "Гость запрашивает счёт и способ оплаты — вы подтверждаете расчёт.",
    points: [
      "Проверьте сумму и способ (карта или наличные), возьмите оплату.",
      "«Подтвердить» — счёт закрывается, гостю начисляется кэшбэк.",
      "«Отменить» — вернёт гостя к выбору способа оплаты.",
      "«Столы» → «Просмотр» — весь стол; «Отключить» — только после полной оплаты.",
    ],
    examples: [
      { label: "Подтвердить", tone: "primary" },
      { label: "Отменить", tone: "soft" },
      { label: "Просмотр", tone: "primary" },
    ],
  },
];

function ExampleChip({
  label,
  tone,
}: {
  label: string;
  tone: "primary" | "ghost" | "soft";
}) {
  const cls =
    tone === "primary"
      ? "bg-white text-black"
      : tone === "ghost"
        ? "border border-white/15 bg-transparent text-white/80"
        : "border border-white/10 bg-white/10 text-white";
  return (
    <span
      className={`inline-flex items-center rounded-xl px-3 py-2 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

export function StaffTraining({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#121214] shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress */}
        <div className="h-1 w-full bg-white/8">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${((step + 1) / SLIDES.length) * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between px-5 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">
            Обучение • {step + 1} из {SLIDES.length}
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Закрыть
          </button>
        </div>

        {/* Slide */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 pt-4">
          <div className="text-2xl font-semibold leading-tight text-white">
            {slide.title}
          </div>
          <div className="mt-2 text-sm leading-6 text-white/65">{slide.intro}</div>

          <ul className="mt-4 space-y-2.5">
            {slide.points.map((point, i) => (
              <li key={i} className="flex gap-3 text-sm leading-6 text-white/80">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/40" />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          {slide.examples?.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                Так выглядят кнопки
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {slide.examples.map((ex) => (
                  <ExampleChip key={ex.label} label={ex.label} tone={ex.tone} />
                ))}
              </div>
            </div>
          ) : null}

          {slide.note ? (
            <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100/90">
              {slide.note}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-4">
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Слайд ${i + 1}`}
                className={`h-2 rounded-full transition-all ${
                  i === step ? "w-6 bg-white" : "w-2 bg-white/25"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded-full border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/10"
              >
                Назад
              </button>
            ) : null}
            <button
              onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              {isLast ? "Готово" : "Далее"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
