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
  const [shown, setShown] = useState(false);

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        id: "menu",
        path: "/menu",
        title: isCz ? "Objednávejte z menu" : "Order from the menu",
        body: isCz
          ? "Vyberte si položky — výběr dostane obsluha a číšník přijde objednávku upřesnit a potvrdit."
          : "Pick your items — the staff gets your selection and a waiter comes to confirm it.",
      },
      {
        id: "cart",
        path: "/cart",
        title: isCz ? "Váš účet a objednávka" : "Your bill & order",
        body: isCz
          ? "Tady je vaše objednávka i účet. Stav se aktualizuje, jakmile ji obsluha potvrdí — a tady také zaplatíte."
          : "Here's your order and bill. The status updates once staff confirms it — and you pay right here too.",
      },
      {
        id: "call",
        path: "/call",
        title: isCz ? "Přivolejte obsluhu" : "Call the staff",
        body: isCz
          ? "Zavolejte číšníka, vyžádejte si servis vodní dýmky nebo napište zprávu — obsluha hned uvidí váš stůl."
          : "Call a waiter, request hookah service, or send a message — staff sees your table instantly.",
      },
      {
        id: "profile",
        path: "/profile",
        title: isCz ? "Profil a cashback" : "Profile & cashback",
        body: isCz
          ? "Váš profil a osobní účet: dostupný cashback, historie účtenek a nastavení účtu."
          : "Your profile and personal account: available cashback, receipt history and account settings.",
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

  // No auto-start on first visit — onboarding is triggered only right after
  // registration (auth page calls restartGuestOnboarding), so returning /
  // already-registered guests never see it.

  const activeStep = useMemo(
    () => steps.find((step) => step.id === state.activeStep) ?? null,
    [state.activeStep, steps]
  );

  const activeIndex = useMemo(
    () => (activeStep ? steps.findIndex((step) => step.id === activeStep.id) : -1),
    [activeStep, steps]
  );

  const visible = ready && !state.completed && !!activeStep && pathname === activeStep.path;

  // Drive the enter transition once the card is on the right screen.
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const raf = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(raf);
  }, [visible, activeStep?.id]);

  if (!visible || !activeStep) return null;

  const close = () => {
    // Fade out, then complete and glide back to the menu.
    setShown(false);
    window.setTimeout(() => {
      completeGuestOnboarding();
      setState({ activeStep: null, completed: true });
      if (pathname !== "/menu") router.push("/menu");
    }, 240);
  };

  const goNext = () => {
    const nextStep = steps[activeIndex + 1];
    if (!nextStep) {
      close();
      return;
    }

    setShown(false);
    const next = { activeStep: nextStep.id, completed: false };
    window.setTimeout(() => {
      writeGuestOnboardingState(next);
      setState(next);
      router.push(nextStep.path);
    }, 180);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        className={[
          "absolute inset-0 bg-black/40 backdrop-blur-[1.5px] transition-opacity duration-300",
          shown ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      <div className="pointer-events-auto absolute inset-x-0 bottom-24">
        <div className="mx-auto max-w-md px-4">
          <div
            className={[
              "overflow-hidden rounded-[30px] border border-white/10 bg-[#151515]/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition-all duration-300 ease-out",
              shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
            ].join(" ")}
          >
            <div className="h-1 w-full bg-white/6">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{ width: `${((activeIndex + 1) / steps.length) * 100}%` }}
              />
            </div>

            <div className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45">
                    {isCz
                      ? `Krok ${activeIndex + 1} ze ${steps.length}`
                      : `Step ${activeIndex + 1} of ${steps.length}`}
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
                  className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/65 transition hover:bg-white/6 hover:text-white"
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
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/92 active:scale-[0.98]"
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
