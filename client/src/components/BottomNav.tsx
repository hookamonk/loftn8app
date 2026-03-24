"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/providers/cart";
import { useAuth } from "@/providers/auth";

function Icon({
  name,
  active,
}: {
  name: "menu" | "cart" | "call" | "profile";
  active: boolean;
}) {
  const cls = active ? "stroke-black" : "stroke-white/70";
  const common = {
    className: cls,
    width: 22,
    height: 22,
    fill: "none",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "menu")
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </svg>
    );

  if (name === "cart")
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path d="M6 7h15l-1.5 9H8L6 7Z" />
        <path d="M6 7 5 4H3" />
        <path d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        <path d="M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      </svg>
    );

  if (name === "call")
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path d="M4 11c0 4.5 3.6 8 8 8s8-3.5 8-8" />
        <path d="M12 3v8" />
        <path d="M9 6h6" />
      </svg>
    );

  return (
    <svg {...common} viewBox="0 0 24 24">
      <path d="M20 21a8 8 0 1 0-16 0" />
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
    </svg>
  );
}

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(`${href}/`)) return true;
  return false;
}

function Item({
  href,
  label,
  icon,
  badge,
}: {
  href: string;
  label: string;
  icon: "menu" | "cart" | "call" | "profile";
  badge?: number;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href);

  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-1 py-2"
      aria-current={active ? "page" : undefined}
    >
      <div
        className={[
          "relative grid h-10 w-14 place-items-center rounded-2xl transition",
          active ? "bg-white text-black shadow" : "bg-transparent",
        ].join(" ")}
      >
        <Icon name={icon} active={active} />
        {badge && badge > 0 ? (
          <div className="absolute -right-1 -top-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-black shadow">
            {badge}
          </div>
        ) : null}
      </div>

      <div className={active ? "text-[11px] font-semibold text-white" : "text-[11px] text-white/65"}>
        {label}
      </div>
    </Link>
  );
}

export function BottomNav() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { me, loading } = useAuth();
  const isAuthed = !!me?.authenticated;

  const { items } = useCart();

  const count = useMemo(() => {
    if (!mounted) return 0;
    return items.reduce((s, x) => s + x.qty, 0);
  }, [items, mounted]);

  const nav = useMemo(() => {
    if (!loading && !isAuthed) {
      return [
        { href: "/menu", label: "Menu", icon: "menu" as const },
        { href: "/call", label: "Staff", icon: "call" as const },
        { href: "/auth", label: "Sign in", icon: "profile" as const },
      ];
    }

    return [
      { href: "/menu", label: "Menu", icon: "menu" as const },
      { href: "/cart", label: "Cart", icon: "cart" as const, badge: count || undefined },
      { href: "/call", label: "Staff", icon: "call" as const },
      { href: "/profile", label: "Profile", icon: "profile" as const },
    ];
  }, [loading, isAuthed, count]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pb-4">
      <div className="mx-auto max-w-md px-4">
        <div className="rounded-[26px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
          <div
            className={[
              "px-1",
              nav.length === 2 ? "grid grid-cols-2" : nav.length === 3 ? "grid grid-cols-3" : "grid grid-cols-4",
            ].join(" ")}
          >
            {nav.map((x) => (
              <Item key={x.href} href={x.href} label={x.label} icon={x.icon} badge={(x as any).badge} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
