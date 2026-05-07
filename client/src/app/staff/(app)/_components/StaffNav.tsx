"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function Tab({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={[
        "whitespace-nowrap rounded-2xl border px-4 py-3 text-sm font-semibold transition",
        active
          ? "border-white/20 bg-white text-black"
          : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default function StaffNav() {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1">
      <Tab href="/staff/summary" label="Сводка" />
      <Tab href="/staff/orders" label="Заказы" />
      <Tab href="/staff/calls" label="Вызовы" />
      <Tab href="/staff/payments" label="Оплаты" />
    </nav>
  );
}
