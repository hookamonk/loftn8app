"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function normTableNumber(x: string) {
  let v = x.trim().toUpperCase().replace(/\s+/g, "");
  if (v.startsWith("T")) v = v.slice(1);
  v = v.replace(/\D/g, "");
  return v;
}

export default function TablePage() {
  const [table, setTable] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

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

  const stopScan = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startScan = async () => {
    setScanErr(null);

    const BD: any = (window as any).BarcodeDetector;
    if (!BD) {
      setScanErr("Сканер не поддерживается в этом браузере. Введите номер вручную.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setScanErr("Нет доступа к камере. Введите номер вручную.");
      return;
    }

    try {
      const detector = new BD({ formats: ["qr_code"] });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const tick = async () => {
        try {
          const video = videoRef.current;
          if (video) {
            const codes = await detector.detect(video);
            if (codes?.length) {
              const raw = String(codes[0]?.rawValue ?? "").trim();
              const num = normTableNumber(raw);
              if (num) {
                setTable(num);
                setScanOpen(false);
                stopScan();
                return;
              }
            }
          }
        } catch {
          // ignore
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };

      rafRef.current = requestAnimationFrame(() => void tick());
    } catch (e: any) {
      setScanErr(e?.message ?? "Не удалось запустить сканер");
    }
  };

  useEffect(() => {
    if (!scanOpen) {
      stopScan();
      return;
    }
    void startScan();
    return () => stopScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen]);

  return (
    <main className="min-h-dvh bg-[radial-gradient(80%_60%_at_50%_0%,rgba(255,255,255,0.08),transparent_60%)]">
      {/* Scanner modal */}
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

            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video ref={videoRef} className="h-72 w-full object-cover" playsInline muted />
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
            onClick={() => setScanOpen(true)}
          >
            Отсканировать QR
          </button>

        </div>
      </div>
    </main>
  );
}