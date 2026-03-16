"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/providers/cart";
import { useAuth } from "@/providers/auth";

export function CartBar() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { me, loading } = useAuth();
  const { items } = useCart();

  const { count, total } = useMemo(() => {
    if (!mounted) return { count: 0, total: 0 };
    const c = items.reduce((s, x) => s + x.qty, 0);
    const t = items.reduce((s, x) => s + x.qty * x.priceCzk, 0);
    return { count: c, total: t };
  }, [items, mounted]);

  if (!mounted) return null;
  if (loading) return null;
  if (!me?.authenticated) return null;
  if (count === 0) return null;

  return (
    <div className="fixed bottom-24 left-0 right-0 z-40">
      <div className="mx-auto max-w-md px-4">
        <Link
          href="/cart"
          className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
        >
          <div className="text-sm font-semibold text-white">Cart · {count}</div>
          <div className="text-sm font-semibold text-white">{total} Kč</div>
        </Link>
      </div>
    </div>
  );
}