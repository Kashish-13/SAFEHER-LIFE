"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

/**
 * Foreground microphone test for Voice SOS configuration.
 * - Level meter: audio is analysed locally in the browser and never recorded or uploaded.
 * - Phrase test (optional, separate consent): uses the browser's Web Speech API, which in
 *   some browsers (e.g. Chrome) processes audio on the vendor's servers.
 * Everything stops when the user presses Stop or leaves the page.
 */
export function useMicTest(phrase: string) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [detected, setDetected] = useState(false);
  const [listening, setListening] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const recog = useRef<SpeechRecognitionLike | null>(null);

  const speechSupported = typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    recog.current?.stop();
    recog.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    setActive(false); setListening(false); setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError(null); setDetected(false); setTranscript("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx.current = new AudioContext();
      const analyser = ctx.current.createAnalyser();
      analyser.fftSize = 512;
      ctx.current.createMediaStreamSource(stream.current).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      setActive(true);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone permission was denied." : "Couldn't access a microphone.");
    }
  }, []);

  const listenForPhrase = useCallback(() => {
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true; r.interimResults = true; r.lang = "en-IN";
    const target = phrase.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
      const norm = text.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
      setTranscript(norm.trim().slice(-120));
      if (target && norm.includes(target)) setDetected(true);
    };
    r.onerror = (e) => setError(`Speech recognition: ${e.error}`);
    r.onend = () => setListening(false);
    r.start();
    recog.current = r;
    setListening(true);
  }, [phrase]);

  useEffect(() => stop, [stop]);

  return { active, level, error, start, stop, speechSupported, listenForPhrase, listening, transcript, detected, resetDetected: () => setDetected(false) };
}
