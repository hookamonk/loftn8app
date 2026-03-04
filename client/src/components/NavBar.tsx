"use client";

import Link from "next/link";
import { useCart } from "@/providers/cart";
import { useSession } from "@/providers/session";

export function NavBar() {
  const { items } = useCart();
  const { tableCode } = useSession();
  const count = items.reduce((s, x) => s + x.qty, 0);

  return (
    <div className="sticky top-0 z-50 border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
        <div className="text-sm font-semibold">Loft N8</div>
        <div className="text-xs text-gray-600">{tableCode ? `Table: ${tableCode}` : "No table"}</div>
        <div className="flex gap-3 text-sm">
          <Link href="/menu" className="underline">
            Menu
          </Link>
          <Link href="/cart" className="underline">
            Cart ({count})
          </Link>
        </div>
      </div>
    </div>
  );
}
