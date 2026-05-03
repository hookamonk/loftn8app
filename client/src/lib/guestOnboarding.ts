"use client";

import { storage } from "@/lib/storage";

export type OnboardingStepId = "menu" | "cart" | "call";

export type OnboardingState = {
  activeStep: OnboardingStepId | null;
  completed: boolean;
};

export const GUEST_ONBOARDING_STORAGE_KEY = "guest_onboarding_v1";
export const GUEST_ONBOARDING_SYNC_EVENT = "guest-onboarding-sync";

export function readGuestOnboardingState(): OnboardingState {
  return storage.get<OnboardingState>(GUEST_ONBOARDING_STORAGE_KEY, {
    activeStep: null,
    completed: false,
  });
}

export function writeGuestOnboardingState(next: OnboardingState) {
  storage.set(GUEST_ONBOARDING_STORAGE_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GUEST_ONBOARDING_SYNC_EVENT, { detail: next }));
  }
}

export function restartGuestOnboarding() {
  const next: OnboardingState = {
    activeStep: "menu",
    completed: false,
  };
  writeGuestOnboardingState(next);
  return next;
}

export function completeGuestOnboarding() {
  const next: OnboardingState = {
    activeStep: null,
    completed: true,
  };
  writeGuestOnboardingState(next);
  return next;
}
