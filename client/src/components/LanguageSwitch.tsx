"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/providers/i18n";

export function LanguageSwitch() {
  const { lang, setLang, ready } = useI18n();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Stay pinned at the very top; hide while the page is scrolled so it never
  // overlaps a sticky search/nav. Scroll back up to change the language.
  useEffect(() => {
    const onScroll = () => {
      const y = typeof window !== "undefined" ? window.scrollY : 0;
      const isScrolled = y > 12;
      setHidden(isScrolled);
      if (isScrolled) setOpen(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!ready) return null;

  const current =
    lang === "cs"
      ? { code: "CZ", flag: "🇨🇿", label: "Čeština" }
      : { code: "EN", flag: "🇬🇧", label: "English" };

  return (
    <div
      ref={rootRef}
      className={[
        "fixed right-4 top-4 z-[80] transition-all duration-300",
        hidden
          ? "pointer-events-none -translate-y-3 opacity-0"
          : "pointer-events-auto translate-y-0 opacity-100",
      ].join(" ")}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((currentOpen) => !currentOpen)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-2 text-[11px] font-semibold tracking-[0.14em] text-white shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:bg-black/72"
        >
          <span className="text-sm leading-none">{current.flag}</span>
          <span>{current.code}</span>
          <span className={["text-[10px] text-white/55 transition", open ? "rotate-180" : ""].join(" ")}>▾</span>
        </button>

        {open ? (
          <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#111111]/96 p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => {
                setLang("en");
                setOpen(false);
              }}
              className={[
                "flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left text-sm transition",
                lang === "en" ? "bg-white text-black" : "text-white/80 hover:bg-white/8 hover:text-white",
              ].join(" ")}
            >
              <span className="text-base leading-none">🇬🇧</span>
              <span className="flex-1">English</span>
              <span className="text-[11px] font-semibold tracking-[0.12em]">EN</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLang("cs");
                setOpen(false);
              }}
              className={[
                "mt-1 flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left text-sm transition",
                lang === "cs" ? "bg-white text-black" : "text-white/80 hover:bg-white/8 hover:text-white",
              ].join(" ")}
            >
              <span className="text-base leading-none">🇨🇿</span>
              <span className="flex-1">Čeština</span>
              <span className="text-[11px] font-semibold tracking-[0.12em]">CZ</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
