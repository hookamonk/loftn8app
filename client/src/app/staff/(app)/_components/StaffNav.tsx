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
        "flex-1 text-center py-2 rounded-2xl text-sm whitespace-nowrap",
        "border border-white/10 bg-white/5 text-white/80 backdrop-blur",
        "hover:bg-white/10 hover:text-white transition",
        active ? "bg-white/15 text-white border-white/20" : "",
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
