"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// -------------------------------------------------------------------
// SignaturePad
// A plain-canvas signature pad that works with mouse, touch and pen via
// pointer events. Calls onChange with a PNG data URL as the drawing
// changes (or null when cleared). No third-party dependency.
// -------------------------------------------------------------------
type SignaturePadProps = {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
};

export function SignaturePad({ onChange, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Size the canvas to its box, scaled for the device pixel ratio so the
  // strokes stay crisp. Resizing clears the canvas (acceptable - they redraw).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(200 * ratio);

      const context = canvas.getContext("2d");
      if (context) {
        context.scale(ratio, ratio);
        context.lineWidth = 2.5;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "#0b3b7a";
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawing.current = true;
    const context = event.currentTarget.getContext("2d");
    const { x, y } = positionOf(event);
    context?.beginPath();
    context?.moveTo(x, y);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return;
    const context = event.currentTarget.getContext("2d");
    const { x, y } = positionOf(event);
    context?.lineTo(x, y);
    context?.stroke();
    if (!hasDrawn.current) {
      hasDrawn.current = true;
      setIsEmpty(false);
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (hasDrawn.current) {
      onChange(event.currentTarget.toDataURL("image/png"));
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasDrawn.current = false;
    setIsEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        aria-label="Signature pad - draw your signature"
        className="h-[200px] w-full touch-none rounded-lg border border-border bg-white"
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Draw your signature above</p>
        <Button type="button" variant="ghost" size="sm" onClick={handleClear} disabled={disabled || isEmpty}>
          Clear
        </Button>
      </div>
    </div>
  );
}
