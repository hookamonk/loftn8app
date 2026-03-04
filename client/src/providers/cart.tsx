"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { storage } from "@/lib/storage";
import type { CartItem, MenuItem } from "@/types";

type CartState = {
  items: CartItem[];
  add: (item: MenuItem) => void;
  dec: (menuItemId: number) => void;
  remove: (menuItemId: number) => void;
  setItemComment: (menuItemId: number, comment: string) => void;
  clear: () => void;
  totalCzk: number;
};

const Ctx = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const hydratedRef = useRef(false);

  // 1) hydrate once on client
  useEffect(() => {
    const saved = storage.get("cart", [] as CartItem[]);
    setItems(Array.isArray(saved) ? saved : []);
    hydratedRef.current = true;
  }, []);

  // 2) persist on every items change (after hydration)
  useEffect(() => {
    if (!hydratedRef.current) return;
    storage.set("cart", items);
  }, [items]);

  const add = useCallback((m: MenuItem) => {
    setItems((prev) => {
      const next = [...prev];
      const idx = next.findIndex((x) => x.menuItemId === m.id);
      if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      else next.push({ menuItemId: m.id, name: m.name, priceCzk: m.priceCzk, qty: 1 });
      return next;
    });
  }, []);

  const dec = useCallback((menuItemId: number) => {
    setItems((prev) =>
      prev
        .map((x) => (x.menuItemId === menuItemId ? { ...x, qty: x.qty - 1 } : x))
        .filter((x) => x.qty > 0)
    );
  }, []);

  const remove = useCallback((menuItemId: number) => {
    setItems((prev) => prev.filter((x) => x.menuItemId !== menuItemId));
  }, []);

  const setItemComment = useCallback((menuItemId: number, comment: string) => {
    setItems((prev) => prev.map((x) => (x.menuItemId === menuItemId ? { ...x, comment } : x)));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const totalCzk = useMemo(() => items.reduce((s, x) => s + x.priceCzk * x.qty, 0), [items]);

  const value = useMemo(
    () => ({ items, add, dec, remove, setItemComment, clear, totalCzk }),
    [items, add, dec, remove, setItemComment, clear, totalCzk]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}