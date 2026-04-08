"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { getVenueName, getVenueSlug, setVenueSlug } from "@/lib/venue";

function normalizeTableCode(raw: string): string | null {
  const v = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!v) return null;

  // 1 -> T1
  if (/^\d+$/.test(v)) return `T${v}`;

  // T1
  if (/^T\d+$/.test(v)) return v;

  // VIP variants
  if (v === "VIP") return "VIP";
  if (v === "TVIP" || v === "T-VIP") return "VIP";

  // allow custom table codes like LOUNGE, BAR1, VIP2 if needed later
  if (/^[A-Z0-9_-]+$/.test(v)) return v;

  return null;
}

function extractTableCode(rawInput: string): string | null {
  const raw = String(rawInput || "").trim();

  try {
    const url = new URL(raw);

    const pathMatch = url.pathname.match(/\/t\/([^/]+)$/i);
    if (pathMatch?.[1]) {
      return normalizeTableCode(pathMatch[1]);
    }

    const qp = url.searchParams.get("table");
    if (qp) {
      return normalizeTableCode(qp);
    }
  } catch {}

  if (/^\/t\/[^/]+$/i.test(raw)) {
    const m = raw.match(/\/t\/([^/]+)$/i);
    if (m?.[1]) {
      return normalizeTableCode(m[1]);
    }
  }

  return normalizeTableCode(raw);
}

const SCANNER_ID = "loft-table-qr-reader";

export default function TablePage() {
  const venueName = getVenueName();
  const [table, setTable] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [startingScan, setStartingScan] = useState(false);
  const [processingFile, setProcessingFile] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canGo = useMemo(() => !!extractTableCode(table), [table]);

  const goToTable = (code: string) => {
    setVenueSlug(getVenueSlug());
    window.location.href = `/t/${encodeURIComponent(code)}`;
  };

  const go = () => {
    setErr(null);
    const code = extractTableCode(table);
    if (!code) {
      setErr("Enter the table number");
      return;
    }
    goToTable(code);
  };

  const stopScan = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      const state = scanner.getState();
      if (state === 2 || state === 1) {
        await scanner.stop();
      }
    } catch {}

    try {
      scanner.clear();
    } catch {}

    scannerRef.current = null;
  };

  const handleDecoded = async (decodedText: string) => {
    const code = extractTableCode(decodedText);

    if (!code) {
      setScanErr("QR was scanned, but the format was not recognized.");
      return;
    }

    setTable(code);
    setScanOpen(false);
    await stopScan();
    goToTable(code);
  };

  const startScan = async () => {
    setScanErr(null);
    setStartingScan(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("No camera access. Please use a QR photo or enter the table number manually.");
      }

      const warmup = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      warmup.getTracks().forEach((t) => t.stop());

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras?.length) {
        throw new Error("Camera not found. Please use a QR photo or enter the table number manually.");
      }

      const rear =
        cameras.find((c) => /back|rear|environment|wide/i.test(c.label)) ||
        cameras[cameras.length - 1];

      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        rear.id,
        {
          fps: 8,
          aspectRatio: 1,
          disableFlip: false,
        },
        async (decodedText) => {
          await handleDecoded(decodedText);
        },
        () => {}
      );
    } catch (e: any) {
      setScanErr(e?.message ?? "Failed to start scanner");
      await stopScan();
    } finally {
      setStartingScan(false);
    }
  };

  const onPickQrImage = async (file: File | null) => {
    if (!file) return;

    setScanErr(null);
    setProcessingFile(true);

    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      const decodedText = await scanner.scanFile(file, true);

      try {
        scanner.clear();
      } catch {}

      await handleDecoded(decodedText);
    } catch (e: any) {
      setScanErr(e?.message ?? "Failed to read QR from image");
    } finally {
      setProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!scanOpen) {
      void stopScan();
      return;
    }

    void startScan();

    return () => {
      void stopScan();
    };
  }, [scanOpen]);

  return (
    <main className="min-h-dvh bg-[radial-gradient(80%_60%_at_50%_0%,rgba(255,255,255,0.08),transparent_60%)]">
      {scanOpen ? (
        <div className="fixed inset-0 z-50 bg-black/70 p-4">
          <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-[rgba(20,20,20,0.92)] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Scan QR</div>
              <button
                className="text-xs text-white/70 underline underline-offset-4"
                onClick={() => setScanOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black p-2">
              <div id={SCANNER_ID} className="min-h-[18rem] w-full" />
            </div>

            {scanErr ? (
              <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-200">
                {scanErr}
              </div>
            ) : (
              <div className="mt-3 text-xs text-white/60">
                Point the camera at the QR code on the table.
              </div>
            )}

            {startingScan ? (
              <div className="mt-2 text-xs text-white/50">Starting camera…</div>
            ) : null}

            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onPickQrImage(e.target.files?.[0] ?? null)}
              />

              <button
                type="button"
                className="h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85"
                onClick={() => fileInputRef.current?.click()}
                disabled={processingFile}
              >
                {processingFile ? "Processing image…" : "Scan QR from image / camera"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-4">
          <div className="text-[11px] tracking-[0.28em] text-white/55">{venueName.toUpperCase()}</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Select table</h1>
          <div className="mt-1 text-xs text-white/60">Enter the table number or scan the QR code</div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[rgba(20,20,20,0.72)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
          <label className="text-xs text-white/60">Table number</label>

          <div className="mt-2 flex gap-2">
            <input
              value={table}
              onChange={(e) => {
                setErr(null);
                setTable(e.target.value);
              }}
              placeholder="For example: 3 or VIP"
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              inputMode="text"
            />
            <button
              onClick={go}
              disabled={!canGo}
              className="h-12 shrink-0 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
            >
              Next
            </button>
          </div>

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-200">
              {err}
            </div>
          ) : null}

          <button
            type="button"
            className="mt-3 h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85 hover:text-white"
            onClick={() => {
              setScanErr(null);
              setScanOpen(true);
            }}
          >
            Scan QR
          </button>
        </div>
      </div>
    </main>
  );
}
