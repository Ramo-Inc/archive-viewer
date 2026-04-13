import { useRef, useEffect, useCallback } from 'react';

// ============================================================
// CanvasPage — renders an image via <canvas> drawImage at exact
// display pixel dimensions, bypassing browser img scaling.
// This eliminates moiré artifacts on screentone patterns.
// ============================================================

interface CanvasPageProps {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  maxWidthRatio: number; // 1.0 (single/solo) or 0.5 (spread)
}

export default function CanvasPage({
  src,
  alt,
  naturalWidth,
  naturalHeight,
  maxWidthRatio,
}: CanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const currentSrcRef = useRef<string>('');

  // Draw image to canvas at exact integer pixel dimensions
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!canvas || !container || !img || !img.complete || naturalWidth === 0 || naturalHeight === 0) {
      return;
    }

    const containerWidth = container.clientWidth * maxWidthRatio;
    const containerHeight = container.clientHeight;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    // objectFit: contain equivalent — fit to container preserving aspect ratio
    const scaleX = containerWidth / naturalWidth;
    const scaleY = containerHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY);

    const displayWidth = Math.floor(naturalWidth * scale);
    const displayHeight = Math.floor(naturalHeight * scale);

    if (displayWidth <= 0 || displayHeight <= 0) return;

    // Only resize canvas buffer if dimensions changed
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
  }, [naturalWidth, naturalHeight, maxWidthRatio]);

  // Load image and draw when src changes
  useEffect(() => {
    if (!src || src === currentSrcRef.current) return;
    currentSrcRef.current = src;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.onerror = () => {
      // Clear canvas on error
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = 200;
          canvas.height = 40;
          ctx.fillStyle = '#666';
          ctx.font = '12px sans-serif';
          ctx.fillText('画像を読み込めません', 10, 25);
        }
      }
    };
    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, draw]);

  // Redraw on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [draw]);

  // Redraw when maxWidthRatio changes (spread ↔ single toggle)
  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: maxWidthRatio === 0.5 ? 1 : undefined,
        maxWidth: maxWidthRatio === 1.0 ? '100%' : '50%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        style={{ display: 'block' }}
      />
    </div>
  );
}
