"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

function pathFromStrokes(strokes: Point[][]): string {
  const parts: string[] = [];
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    const [first, ...rest] = stroke;
    parts.push(`M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`);
    for (const p of rest) {
      parts.push(`L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    }
  }
  return parts.join(" ");
}

export function strokesToSvg(strokes: Point[][]): string | null {
  const d = pathFromStrokes(strokes);
  if (!d) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180"><path d="${d}"/></svg>`;
}

export default function SignaturePad({
  disabled,
  onChange,
}: {
  disabled?: boolean;
  onChange: (svg: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const activeRef = useRef<number>(-1);
  const [captured, setCaptured] = useState(false);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c1917";
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i += 1) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      ctx.stroke();
    }
  }, []);

  function toCanvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    document.body.style.overflow = "hidden";
    const pt = toCanvasPoint(event.nativeEvent, canvas);
    strokesRef.current = [...strokesRef.current, [pt]];
    activeRef.current = strokesRef.current.length - 1;
    setCaptured(false);
    redraw();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || activeRef.current < 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stroke = strokesRef.current[activeRef.current];
    if (!stroke) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const ev of events) {
      stroke.push(toCanvasPoint(ev, canvas));
    }
    redraw();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activeRef.current < 0) return;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    document.body.style.overflow = "";
    activeRef.current = -1;
    const hasInk = strokesRef.current.some((s) => s.length >= 2);
    setCaptured(hasInk);
    onChange(strokesToSvg(strokesRef.current));
  }

  function clear() {
    strokesRef.current = [];
    activeRef.current = -1;
    setCaptured(false);
    redraw();
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={600}
          height={180}
          className="w-full touch-none rounded-2xl border border-stone-300 bg-stone-50"
          aria-label="Signature pad"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        {captured ? null : (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-serif text-2xl text-stone-300">
            Sign here
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800"
          disabled={disabled}
          onClick={clear}
        >
          Clear signature
        </button>
        <p className="text-sm text-stone-600">{captured ? "Signature captured" : "Not signed yet"}</p>
      </div>
    </div>
  );
}
