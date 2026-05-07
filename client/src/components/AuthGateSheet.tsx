"use client";

import Link from "next/link";
import { useAuth } from "@/providers/auth";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/providers/i18n";

const KEY = "authGateDismissed_v1";

function getDismissed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function setDismissed() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
}

export function AuthGateSheet() {
  const { loading, me } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { isCz } = useI18n();

  useEffect(() => {
    if (pathname === "/auth") return setOpen(false);
    if (loading) return;
    if (me.authenticated) return setOpen(false);
    if (!getDismissed()) setOpen(true);
  }, [loading, me, pathname]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 px-4 pb-4">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-white">
              {isCz ? "Přihlaste se a získejte bonusy" : "Sign in and get bonuses"}
            </div>
            <div className="mt-1 text-xs text-white/65">
              {isCz
                ? "Cashback se připíše po potvrzení platby obsluhou."
                : "Cashback is added after payment is confirmed by the staff."}
            </div>
          </div>
          <button
            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
            onClick={() => {
              setDismissed();
              setOpen(false);
            }}
          >
            {isCz ? "Později" : "Later"}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="font-semibold text-white">{isCz ? "Cashback" : "Cashback"}</div>
            <div className="mt-1 text-white/60">{isCz ? "po platbě" : "after payment"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="font-semibold text-white">{isCz ? "Profil" : "Profile"}</div>
            <div className="mt-1 text-white/60">{isCz ? "jméno + historie" : "name + history"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="font-semibold text-white">{isCz ? "Rychleji" : "Faster"}</div>
            <div className="mt-1 text-white/60">{isCz ? "objednávky / obsluha" : "orders / staff"}</div>
          </div>
        </div>

        <Link
          href="/auth"
          className="mt-3 block w-full rounded-3xl bg-white px-4 py-3 text-center text-sm font-semibold text-black"
        >
          {isCz ? "Přihlášení / Registrace" : "Sign in / Register"}
        </Link>
      </div>
    </div>
  );
}
