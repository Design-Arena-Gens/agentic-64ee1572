"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type VisualParams = {
  segments: number;
  rotationSpeed: number; // radians per second base
  sensitivity: number; // visual gain multiplier
  bloom: number; // additional glow
  smoothing: number; // analyser smoothingTimeConstant
  fftSize: number; // analyser fftSize
  baseHue: number; // 0-360
  mirror: boolean;
};

const DEFAULT_PARAMS: VisualParams = {
  segments: 12,
  rotationSpeed: 0.35,
  sensitivity: 1.2,
  bloom: 0.3,
  smoothing: 0.85,
  fftSize: 1024,
  baseHue: 220,
  mirror: true,
};

const SAMPLE_URL =
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_7a2a190c41.mp3?filename=disco-130997.mp3";

export default function KaleidoscopeVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [params, setParams] = useState<VisualParams>(DEFAULT_PARAMS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [usingMic, setUsingMic] = useState(false);
  const [usingSample, setUsingSample] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const srcNodeRef = useRef<MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const animationRef = useRef<number | null>(null);
  const rotationRef = useRef<number>(0);
  const beatEnergyAvgRef = useRef<number>(0);

  // Prepare audio element
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioElRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      audioElRef.current = null;
    };
  }, []);

  // Update analyser when params that affect it change
  useEffect(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      analyser.smoothingTimeConstant = params.smoothing;
      if (analyser.fftSize !== params.fftSize) {
        try {
          analyser.fftSize = params.fftSize;
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
        } catch {}
      }
    }
  }, [params.smoothing, params.fftSize]);

  // Canvas resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const ensureContext = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
  };

  const connectAnalyser = (source: MediaElementAudioSourceNode | MediaStreamAudioSourceNode) => {
    const ctx = audioCtxRef.current!;
    const analyser = ctx.createAnalyser();
    analyser.smoothingTimeConstant = params.smoothing;
    analyser.fftSize = params.fftSize;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
  };

  const playFromElement = async (src: string) => {
    await ensureContext();
    setUsingMic(false);
    setUsingSample(src === SAMPLE_URL);
    const audio = audioElRef.current!;
    audio.src = src;
    audio.loop = true;
    await audio.play();
    if (!srcNodeRef.current || !(srcNodeRef.current instanceof MediaElementAudioSourceNode)) {
      srcNodeRef.current?.disconnect();
      const ctx = audioCtxRef.current!;
      const node = ctx.createMediaElementSource(audio);
      srcNodeRef.current = node;
      connectAnalyser(node);
    }
    setIsPlaying(true);
  };

  const startMic = async () => {
    await ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setUsingMic(true);
    setUsingSample(false);
    const ctx = audioCtxRef.current!;
    const node = ctx.createMediaStreamSource(stream);
    srcNodeRef.current?.disconnect();
    srcNodeRef.current = node;
    connectAnalyser(node);
    setIsPlaying(true);
  };

  const stopAudio = () => {
    setIsPlaying(false);
    const audio = audioElRef.current;
    if (audio) audio.pause();
  };

  // Drag and drop
  const onFilePicked = async (file: File) => {
    const url = URL.createObjectURL(file);
    setFileName(file.name);
    await playFromElement(url);
  };

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = performance.now();

    const draw = (now: number) => {
      const analyser = analyserRef.current;
      const freqData = freqDataRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const minDim = Math.min(width, height);
      const innerRadius = minDim * 0.06;
      const maxRadius = minDim * 0.48;

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Background subtle trail
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(4,7,12,0.28)";
      ctx.fillRect(0, 0, width, height);

      // If we have audio data, update rotation and intensities
      let energy = 0;
      let beatBoost = 0;
      if (analyser && freqData) {
        analyser.getByteFrequencyData(freqData);
        // Compute energy and bands
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        energy = sum / freqData.length / 255; // 0..1
        // Rolling average for beat detection
        const prev = beatEnergyAvgRef.current || 0;
        const alpha = 0.9;
        const avg = prev * alpha + energy * (1 - alpha);
        beatEnergyAvgRef.current = avg;
        const diff = Math.max(0, energy - avg);
        beatBoost = diff * 2.2; // peakiness
      }

      rotationRef.current += (params.rotationSpeed + beatBoost * 0.8) * dt;

      // Render kaleidoscope
      ctx.save();
      ctx.translate(cx, cy);

      const segCount = Math.max(2, Math.min(48, Math.floor(params.segments)));
      const segAngle = (Math.PI * 2) / segCount;
      const bars = 96; // internal detail bars

      // Color based on energy
      const hue = (params.baseHue + 360 * (energy * 0.5 + beatBoost * 0.6)) % 360;
      const baseColor = `hsl(${hue} 90% ${Math.min(85, 65 + energy * 25)}%)`;
      const glowColor = `hsla(${hue} 100% 70% / ${Math.min(0.6, 0.25 + params.bloom)})`;

      for (let i = 0; i < segCount; i++) {
        ctx.save();
        ctx.rotate(i * segAngle + rotationRef.current);

        // Mirror alternate segments for kaleidoscopic symmetry
        if (params.mirror && i % 2 === 1) ctx.scale(-1, 1);

        // Clip to wedge
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, maxRadius, -segAngle / 2, segAngle / 2, false);
        ctx.closePath();
        ctx.clip();

        // Draw radial bars inside the wedge
        for (let j = 0; j < bars; j++) {
          const t = j / (bars - 1); // 0..1 across wedge
          const localAngle = (t - 0.5) * segAngle;

          // Map frequency bin to this bar
          let bin = 0;
          const freqData = freqDataRef.current;
          if (freqData) {
            const idx = Math.min(freqData.length - 1, Math.floor(t * freqData.length));
            bin = freqData[idx] / 255;
          }

          const mag = Math.pow(bin, 1.3) * params.sensitivity; // perceptual
          const r0 = innerRadius * (0.8 + energy * 0.4);
          const r1 = r0 + (maxRadius - r0) * Math.min(1.0, mag * (0.9 + beatBoost));

          ctx.save();
          ctx.rotate(localAngle);

          // Glow pass
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = Math.max(1, (maxRadius - r0) * 0.004 + mag * 6);
          ctx.globalCompositeOperation = "lighter";
          ctx.beginPath();
          ctx.moveTo(r0, 0);
          ctx.lineTo(r1, 0);
          ctx.stroke();

          // Core bar
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1.2 + mag * 3.5;
          ctx.globalCompositeOperation = "screen";
          ctx.beginPath();
          ctx.moveTo(r0, 0);
          ctx.lineTo(r1 * (0.98 + energy * 0.02), 0);
          ctx.stroke();

          ctx.restore();
        }

        // Central nucleus
        const nucleusR = innerRadius * (0.9 + energy * 0.6 + beatBoost * 0.5);
        const grad = ctx.createRadialGradient(0, 0, nucleusR * 0.2, 0, 0, nucleusR);
        grad.addColorStop(0, `hsla(${hue} 100% 85% / 0.9)`);
        grad.addColorStop(1, `hsla(${hue} 100% 55% / 0.05)`);
        ctx.fillStyle = grad;
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath();
        ctx.arc(0, 0, nucleusR, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      ctx.restore();

      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [params]);

  // Controls UI
  return (
    <div className="wrapper">
      <header className="header">
        <h1>Audio Kaleidoscope</h1>
        <div className="controls">
          <button
            className="button"
            onClick={async () => {
              if (isPlaying) {
                stopAudio();
              } else {
                if (usingMic) return; // already live when mic on
                await playFromElement(usingSample ? SAMPLE_URL : audioElRef.current?.src || SAMPLE_URL);
              }
            }}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="button secondary"
            onClick={() => playFromElement(SAMPLE_URL)}
            title="Load sample track"
          >
            Load Sample
          </button>
          <button className="button secondary" onClick={startMic} title="Use microphone">
            Mic
          </button>
          <label className="control" style={{ cursor: "pointer" }}>
            <input
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFilePicked(file);
              }}
            />
            <span>{fileName || "Choose audio"}</span>
          </label>

          <div className="control">
            <label>Segments</label>
            <input
              type="range"
              min={4}
              max={36}
              step={1}
              value={params.segments}
              onChange={(e) => setParams((p) => ({ ...p, segments: Number(e.target.value) }))}
            />
          </div>
          <div className="control">
            <label>Rotate</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.rotationSpeed}
              onChange={(e) => setParams((p) => ({ ...p, rotationSpeed: Number(e.target.value) }))}
            />
          </div>
          <div className="control">
            <label>Sensitivity</label>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={params.sensitivity}
              onChange={(e) => setParams((p) => ({ ...p, sensitivity: Number(e.target.value) }))}
            />
          </div>
          <div className="control">
            <label>Bloom</label>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.02}
              value={params.bloom}
              onChange={(e) => setParams((p) => ({ ...p, bloom: Number(e.target.value) }))}
            />
          </div>
          <div className="control">
            <label>Hue</label>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={params.baseHue}
              onChange={(e) => setParams((p) => ({ ...p, baseHue: Number(e.target.value) }))}
            />
          </div>
          <div className="control">
            <label>FFT</label>
            <select
              value={params.fftSize}
              onChange={(e) => setParams((p) => ({ ...p, fftSize: Number(e.target.value) }))}
            >
              {[256, 512, 1024, 2048, 4096, 8192].map((n) => (
                <option value={n} key={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="control">
            <label>Smooth</label>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.01}
              value={params.smoothing}
              onChange={(e) => setParams((p) => ({ ...p, smoothing: Number(e.target.value) }))}
            />
          </div>
          <div className="control">
            <label>
              <input
                type="checkbox"
                checked={params.mirror}
                onChange={(e) => setParams((p) => ({ ...p, mirror: e.target.checked }))}
              />
              Mirror
            </label>
          </div>
        </div>
      </header>
      <div className="canvasWrap">
        <canvas ref={canvasRef} />
      </div>
      <footer className="footer">
        Tip: Click Play then adjust sliders. Upload your own audio, or use Mic. <span className="hint">Peak beats amplify rotation and bloom.</span>
      </footer>
    </div>
  );
}
