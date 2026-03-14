"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

function extractTableCode(rawInput: string): string | null {
  const raw = String(rawInput || "").trim();

  // Полная ссылка
  try {
    const url = new URL(raw);

    const pathMatch = url.pathname.match(/\/t\/(T?\d+)$/i);
    if (pathMatch?.[1]) {
      const v = pathMatch[1].toUpperCase();
      return v.startsWith("T") ? v : `T${v}`;
    }

    const qp = url.searchParams.get("table");
    if (qp) {
      const v = qp.trim().toUpperCase().replace(/\s+/g, "");
      if (/^\d+$/.test(v)) return `T${v}`;
      if (/^T\d+$/.test(v)) return v;
    }
  } catch {
    // not URL
  }

  // /t/T1
  if (/^\/t\/T?\d+$/i.test(raw)) {
    const m = raw.match(/\/t\/(T?\d+)$/i);
    if (m?.[1]) {
      const v = m[1].toUpperCase();
      return v.startsWith("T") ? v : `T${v}`;
    }
  }

  // T1
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  if (/^T\d+$/.test(compact)) return compact;

  // 1
  if (/^\d+$/.test(compact)) return `T${compact}`;

  return null;
}

const SCANNER_ID = "loft-table-qr-reader";

export default function TablePage() {
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
    window.location.href = `/t/${encodeURIComponent(code)}`;
  };

  const go = () => {
    setErr(null);
    const code = extractTableCode(table);
    if (!code) {
      setErr("Введите номер стола");
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
    } catch {
      // ignore
    }

    try {
      scanner.clear();
    } catch {
      // ignore
    }

    scannerRef.current = null;
  };

  const handleDecoded = async (decodedText: string) => {
    const code = extractTableCode(decodedText);

    if (!code) {
      setScanErr("QR считан, но формат не распознан. Лучше использовать короткий QR: T1, T2, T3.");
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
        throw new Error("Нет доступа к камере. Используйте фото QR или введите номер вручную.");
      }

      // Сначала пробуем получить доступ, чтобы браузер раскрыл реальные камеры
      const warmup = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      warmup.getTracks().forEach((t) => t.stop());

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras?.length) {
        throw new Error("Камера не найдена. Используйте фото QR или введите номер вручную.");
      }

      // Стараемся выбрать заднюю
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
          // qrbox убираем, чтобы искать по всему кадру
        },
        async (decodedText) => {
          await handleDecoded(decodedText);
        },
        () => {
          // ignore decode noise
        }
      );
    } catch (e: any) {
      setScanErr(e?.message ?? "Не удалось запустить сканер");
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
      } catch {
        // ignore
      }

      await handleDecoded(decodedText);
    } catch (e: any) {
      setScanErr(e?.message ?? "Не удалось прочитать QR с фото");
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
              <div className="text-sm font-semibold text-white">Сканирование QR</div>
              <button
                className="text-xs text-white/70 underline underline-offset-4"
                onClick={() => setScanOpen(false)}
              >
                Закрыть
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
                Наведи камеру на QR на столе. Лучше работают короткие QR: T1, T2, T3.
              </div>
            )}

            {startingScan ? (
              <div className="mt-2 text-xs text-white/50">Запускаем камеру…</div>
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
                {processingFile ? "Обрабатываем фото…" : "Сканировать QR с фото / камеры"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-4">
          <div className="text-[11px] tracking-[0.28em] text-white/55">LOFT №8</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Выбор стола</h1>
          <div className="mt-1 text-xs text-white/60">Введите номер стола или отсканируйте QR</div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[rgba(20,20,20,0.72)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur">
          <label className="text-xs text-white/60">Номер стола</label>

          <div className="mt-2 flex gap-2">
            <input
              value={table}
              onChange={(e) => {
                setErr(null);
                setTable(e.target.value);
              }}
              placeholder="Например: 3"
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              inputMode="text"
            />
            <button
              onClick={go}
              disabled={!canGo}
              className="h-12 shrink-0 rounded-2xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-50"
            >
              Далее
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
            Отсканировать QR
          </button>
        </div>
      </div>
    </main>
  );
} 