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

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    if (containerW <= 0 || containerH <= 0) return;

    // objectFit: contain equivalent
    const scaleX = containerW / naturalWidth;
    const scaleY = containerH / naturalHeight;
    const scale = Math.min(scaleX, scaleY);

    const displayWidth = Math.floor(naturalWidth * scale);
    const displayHeight = Math.floor(naturalHeight * scale);
    if (displayWidth <= 0 || displayHeight <= 0) return;

    // devicePixelRatio: render at physical pixel resolution
    const dpr = window.devicePixelRatio || 1;
    const bufferWidth = Math.floor(displayWidth * dpr);
    const bufferHeight = Math.floor(displayHeight * dpr);

    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }

    // Set CSS size to logical pixels (canvas buffer is physical pixels)
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, bufferWidth, bufferHeight);
  }, [naturalWidth, naturalHeight]);

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

  // Redraw on DPI change (e.g., window moved between monitors)
  useEffect(() => {
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handleChange = () => draw();
    mql.addEventListener('change', handleChange, { once: true });
    return () => mql.removeEventListener('change', handleChange);
  }, [draw]);

  // Redraw when maxWidthRatio changes (spread ↔ single toggle)
  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        maxWidth: maxWidthRatio === 1.0 ? '100%' : '50%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
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
