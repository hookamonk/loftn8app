"use client";

import Link from "next/link";
import { useAuth } from "@/providers/auth";

export function InfoBanner() {
  const { loading, me } = useAuth();
  if (loading) return null;
  if (me.authenticated) return null;

  return (
    <div className="mx-auto max-w-md px-4 pt-3">
      <div className="rounded-xl border bg-yellow-50 p-3 text-sm">
        <div className="font-semibold">Bonus / Cashback</div>
        <div className="mt-1 text-gray-700">
          Зарегистрируйтесь, чтобы получать кэшбэк и видеть историю бонусов.
        </div>
        <Link href="/auth" className="mt-2 inline-block underline">
          Зарегистрироваться
        </Link>
      </div>
    </div>
  );
}
