"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  completeGuestOnboarding,
  GUEST_ONBOARDING_SYNC_EVENT,
  readGuestOnboardingState,
  type OnboardingState,
  type OnboardingStepId,
  writeGuestOnboardingState,
} from "@/lib/guestOnboarding";
import { useI18n } from "@/providers/i18n";

type OnboardingStep = {
  id: OnboardingStepId;
  path: string;
  title: string;
  body: string;
  accent: string;
};

export function GuestOnboarding() {
  const { isCz } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>({
    activeStep: null,
    completed: false,
  });
  const [ready, setReady] = useState(false);

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        id: "menu",
        path: "/menu",
        title: isCz ? "Vyberte jídlo a odešlete požadavek" : "Choose dishes and send the request",
        body: isCz
          ? "Otevřete kategorie, vyberte si jídlo a klepněte na Zavolat. Obsluha váš požadavek uvidí okamžitě."
          : "Open the categories, choose your dishes and tap Call. The waiter will see the request for your table immediately.",
        accent: isCz ? "Krok 1" : "Step 1",
      },
      {
        id: "cart",
        path: "/cart",
        title: isCz ? "Sledujte svou objednávku zde" : "Track your order here",
        body: isCz
          ? "Váš účet, stav objednávky a žádost o platbu se zobrazí zde, jakmile číšník uloží objednávku ke stolu."
          : "Your bill, order status and payment request will appear here as soon as the waiter saves the order for your table.",
        accent: isCz ? "Krok 2" : "Step 2",
      },
      {
        id: "call",
        path: "/call",
        title: isCz ? "Přivolejte obsluhu jedním klepnutím" : "Call staff in one tap",
        body: isCz
          ? "Na této obrazovce můžete přivolat číšníka, specialistu na vodní dýmku nebo odeslat žádost o platbu bez dalšího vysvětlování."
          : "Use this screen to call a waiter, a hookah specialist or send a payment request without extra explanation.",
        accent: isCz ? "Krok 3" : "Step 3",
      },
    ],
    [isCz]
  );

  useEffect(() => {
    setState(readGuestOnboardingState());
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => setState(readGuestOnboardingState());
    window.addEventListener(GUEST_ONBOARDING_SYNC_EVENT, sync as EventListener);
    return () => window.removeEventListener(GUEST_ONBOARDING_SYNC_EVENT, sync as EventListener);
  }, []);

  useEffect(() => {
    if (!ready) return;

    setState((current) => {
      if (current.completed) return current;
      if (current.activeStep) return current;
      if (pathname !== "/menu") return current;

      const next = { ...current, activeStep: "menu" as const };
      writeGuestOnboardingState(next);
      return next;
    });
  }, [pathname, ready]);

  const activeStep = useMemo(
    () => steps.find((step) => step.id === state.activeStep) ?? null,
    [state.activeStep, steps]
  );

  const activeIndex = useMemo(
    () => (activeStep ? steps.findIndex((step) => step.id === activeStep.id) : -1),
    [activeStep, steps]
  );

  if (!ready || state.completed || !activeStep) return null;
  if (pathname !== activeStep.path) return null;

  const close = () => {
    const next = completeGuestOnboarding();
    setState(next);
    if (pathname !== "/menu") {
      router.push("/menu");
    }
  };

  const goNext = () => {
    const nextStep = steps[activeIndex + 1];
    if (!nextStep) {
      close();
      return;
    }

    const next = { activeStep: nextStep.id, completed: false };
    writeGuestOnboardingState(next);
    setState(next);
    router.push(nextStep.path);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[1.5px]" />

      <div className="pointer-events-auto absolute inset-x-0 bottom-24">
        <div className="mx-auto max-w-md px-4">
          <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#151515]/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
            <div className="h-1 w-full bg-white/6">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: `${((activeIndex + 1) / steps.length) * 100}%` }}
              />
            </div>

            <div className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45">
                    {activeStep.accent}
                  </div>
                  <div className="mt-2 text-[22px] font-semibold leading-[1.05] text-white">
                    {activeStep.title}
                  </div>
                  <div className="mt-3 max-w-[26rem] text-sm leading-6 text-white/68">
                    {activeStep.body}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={close}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/65 transition hover:bg-white/6 hover:text-white"
                >
                  {isCz ? "Přeskočit" : "Skip"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={[
                        "h-2 rounded-full transition-all",
                        index === activeIndex ? "w-7 bg-white" : "w-2 bg-white/20",
                      ].join(" ")}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/92"
                >
                  {activeIndex === steps.length - 1 ? (isCz ? "Rozumím" : "Got it") : isCz ? "Další" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
