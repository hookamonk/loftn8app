"use client";

import { useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { getStoredVenueSlug, setVenueSlug } from "@/lib/venue";
import { useI18n } from "@/providers/i18n";

function normalizeTableSlug(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) return String(Number(value));
  if (/^T\d+$/i.test(value)) return String(Number(value.slice(1)));

  const composite = value.match(/^(\d+)[.,](\d+)$/);
  if (composite) {
    return `${Number(composite[1])}-${Number(composite[2])}`;
  }

  const vip = value.match(/^vip(?:[\s-]?(\d+))?$/i);
  if (vip) {
    return `vip-${Number(vip[1] || "1")}`;
  }

  const slug = value
    .toLowerCase()
    .replace(/[.]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || null;
}

function extractTableSlug(rawInput: string): { branchSlug?: string; tableSlug: string } | null {
  const raw = String(rawInput || "").trim();

  try {
    const url = new URL(raw);

    const branchPathMatch = url.pathname.match(/^\/(loft-[^/]+)\/tables\/([^/]+)$/i);
    if (branchPathMatch?.[1] && branchPathMatch?.[2]) {
      const tableSlug = normalizeTableSlug(branchPathMatch[2]);
      if (tableSlug) {
        return { branchSlug: branchPathMatch[1].toLowerCase(), tableSlug };
      }
    }

    const pathMatch = url.pathname.match(/\/t\/([^/]+)$/i);
    if (pathMatch?.[1]) {
      const tableSlug = normalizeTableSlug(pathMatch[1]);
      return tableSlug ? { tableSlug } : null;
    }

    const qp = url.searchParams.get("table");
    if (qp) {
      const tableSlug = normalizeTableSlug(qp);
      return tableSlug ? { tableSlug } : null;
    }
  } catch {}

  if (/^\/t\/[^/]+$/i.test(raw)) {
    const match = raw.match(/\/t\/([^/]+)$/i);
    if (match?.[1]) {
      const tableSlug = normalizeTableSlug(match[1]);
      return tableSlug ? { tableSlug } : null;
    }
  }

  const tableSlug = normalizeTableSlug(raw);
  return tableSlug ? { tableSlug } : null;
}

export function GuestQrEntry({ guestBypass = false }: { guestBypass?: boolean }) {
  const { isCz } = useI18n();
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [processingFile, setProcessingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const goToTable = async (tableSlug: string, branchSlug?: string) => {
    const nextBranch = branchSlug ?? getStoredVenueSlug() ?? "loft-zizkov";
    const previousVenue = getStoredVenueSlug();

    if (previousVenue && previousVenue !== nextBranch) {
      try {
        await fetch("/api/guest/session/disconnect", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // ignore disconnect failures, QR flow should still continue
      }
    }

    setVenueSlug(nextBranch);
    const suffix = guestBypass ? "?guest=1" : "";
    window.location.href = `/${encodeURIComponent(nextBranch)}/tables/${encodeURIComponent(tableSlug)}${suffix}`;
  };

  const handleDecoded = async (decodedText: string) => {
    const match = extractTableSlug(decodedText);

    if (!match) {
      setScanErr(
        isCz
          ? "QR byl načten, ale formát nebyl rozpoznán."
          : "QR was scanned, but the format was not recognized."
      );
      return;
    }

    await goToTable(match.tableSlug, match.branchSlug);
  };

  const onPickQrImage = async (file: File | null) => {
    if (!file) return;

    setScanErr(null);
    setProcessingFile(true);

    try {
      const scanner = new Html5Qrcode("loft-guest-qr-reader-file");
      const decodedText = await scanner.scanFile(file, true);

      try {
        scanner.clear();
      } catch {}

      await handleDecoded(decodedText);
    } catch (error: any) {
      setScanErr(
        error?.message ?? (isCz ? "Nepodařilo se načíst QR z obrázku" : "Failed to read QR from image")
      );
    } finally {
      setProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#050508] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-[380px] w-[380px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
          <div className="text-sm leading-7 text-white/88">
            {isCz ? "Pro pokračování naskenujte QR kód na stole" : "To continue, scan the QR code on your table"}
          </div>

          <button
            className="mt-5 h-12 w-full rounded-2xl bg-white px-4 text-sm font-semibold text-black"
            onClick={() => fileInputRef.current?.click()}
            disabled={processingFile}
          >
            {processingFile
              ? isCz
                ? "Zpracovávám..."
                : "Processing..."
              : isCz
              ? "Otevřít kameru"
              : "Open camera"}
          </button>

          {scanErr ? <div className="mt-3 text-xs text-red-200">{scanErr}</div> : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => void onPickQrImage(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>
    </main>
  );
}
