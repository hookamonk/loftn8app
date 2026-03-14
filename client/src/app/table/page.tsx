"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

function normTableNumber(x: string) {
  let v = x.trim().toUpperCase().replace(/\s+/g, "");
  if (v.startsWith("T")) v = v.slice(1);
  v = v.replace(/\D/g, "");
  return v;
}

const SCANNER_ID = "loft-table-qr-reader";

export default function TablePage() {
  const [table, setTable] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [startingScan, setStartingScan] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startingRef = useRef(false);

  const n = useMemo(() => normTableNumber(table), [table]);
  const canGo = n.length > 0;

  const go = () => {
    setErr(null);
    if (!canGo) {
      setErr("Введите номер стола");
      return;
    }
    const code = `T${n}`;
    window.location.href = `/t/${encodeURIComponent(code)}`;
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
    startingRef.current = false;
  };

  const startScan = async () => {
    if (startingRef.current) return;

    setScanErr(null);
    setStartingScan(true);
    startingRef.current = true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Нет доступа к камере. Введите номер вручную.");
      }

      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
          disableFlip: false,
        },
        async (decodedText) => {
          const raw = String(decodedText ?? "").trim();
          const num = normTableNumber(raw);

          if (!num) return;

          setTable(num);
          setScanOpen(false);
          await stopScan();
        },
        () => {
          // ignore decode errors
        }
      );
    } catch (e: any) {
      setScanErr(e?.message ?? "Не удалось запустить сканер");
      await stopScan();
    } finally {
      setStartingScan(false);
      startingRef.current = false;
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
                Наведи камеру на QR на столе. Если не работает — введи номер вручную.
              </div>
            )}

            {startingScan ? (
              <div className="mt-2 text-xs text-white/50">Запускаем камеру…</div>
            ) : null}
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
                setTable(normTableNumber(e.target.value));
              }}
              placeholder="Например: 3"
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/20"
              inputMode="numeric"
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