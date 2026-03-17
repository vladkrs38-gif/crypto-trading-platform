'use client';

/**
 * Фоновый опрос Pre-Pump API. При появлении идеала — звук.
 * Обновляет store для badge на кнопке.
 */

import { useEffect, useRef } from 'react';
import { fetchPrePumpFromApi } from '@/lib/screenerApi';
import { usePrePumpStore } from '@/store/usePrePumpStore';

const POLL_MS = 60 * 1000; // 1 минута

function playPrePumpAlert() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(659.25, ctx.currentTime + 0.1);
    osc.frequency.linearRampToValueAtTime(783.99, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // ignore
  }
}

export default function PrePumpNotifier() {
  const setPrePumpData = usePrePumpStore((s) => s.setPrePumpData);
  const prevIdealsRef = useRef<Set<string>>(new Set());
  const isFirstPollRef = useRef(true);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      if (!mounted) return;
      try {
        const data = await fetchPrePumpFromApi();
        setPrePumpData({
          signals: data.signals,
          idealSymbols: data.idealSymbols,
          idealCount: data.idealCount,
        });
        const currentSet = new Set(data.idealSymbols);
        const prev = prevIdealsRef.current;
        const hasNew = data.idealSymbols.some((s) => !prev.has(s));
        if (!isFirstPollRef.current && hasNew && data.idealSymbols.length > 0) {
          playPrePumpAlert();
        }
        isFirstPollRef.current = false;
        prevIdealsRef.current = currentSet;
      } catch {
        // API недоступен — Python не запущен
      }
    };

    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [setPrePumpData]);

  return null;
}
