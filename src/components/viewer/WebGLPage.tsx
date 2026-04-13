import { useRef, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';

// ============================================================
// WebGLPage — renders a page with GPU area-averaging (Fant).
// NeeView uses WPF BitmapScalingMode.Fant for display-time
// scaling.  Chromium <img> uses Lanczos3 (not configurable).
// This component implements area-averaging in a WebGL2 fragment
// shader, giving identical results to WPF Fant.
// ============================================================

/* ---------- shaders ---------- */

const VERT_SRC = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// Area-averaging (box / Fant) fragment shader.
// For each output pixel, averages every source texel that overlaps
// the corresponding rectangle, weighted by coverage fraction.
const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_image;
uniform vec2 u_srcSize;
uniform vec2 u_dstSize;

out vec4 fragColor;

void main() {
  vec2 scale = u_srcSize / u_dstSize;

  // gl_FragCoord.y=0 is canvas BOTTOM, texelFetch y=0 is image TOP.
  // Flip Y so top-of-canvas maps to top-of-image.
  vec2 coord = vec2(gl_FragCoord.x, u_dstSize.y - gl_FragCoord.y);

  // Upscaling or 1:1 — let hardware bilinear handle it
  if (scale.x <= 1.0 && scale.y <= 1.0) {
    fragColor = texture(u_image, coord / u_dstSize);
    return;
  }

  // Output pixel integer index → source rectangle
  vec2 srcStart = (coord - 0.5) * scale;
  vec2 srcEnd   = srcStart + scale;

  int x0 = max(int(floor(srcStart.x)), 0);
  int y0 = max(int(floor(srcStart.y)), 0);
  int x1 = min(int(ceil(srcEnd.x)), int(u_srcSize.x));
  int y1 = min(int(ceil(srcEnd.y)), int(u_srcSize.y));

  vec4 sum = vec4(0.0);
  float tw  = 0.0;

  for (int y = y0; y < y1; y++) {
    float wy = min(float(y + 1), srcEnd.y) - max(float(y), srcStart.y);
    for (int x = x0; x < x1; x++) {
      float wx = min(float(x + 1), srcEnd.x) - max(float(x), srcStart.x);
      float w  = wx * wy;
      sum += texelFetch(u_image, ivec2(x, y), 0) * w;
      tw  += w;
    }
  }

  fragColor = sum / tw;
}`;

/* ---------- WebGL helpers ---------- */

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile: ${info}`);
  }
  return s;
}

interface GLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  srcSizeLoc: WebGLUniformLocation;
  dstSizeLoc: WebGLUniformLocation;
  texture: WebGLTexture | null;
  imgWidth: number;
  imgHeight: number;
}

function initGL(canvas: HTMLCanvasElement): GLState | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    premultipliedAlpha: false,
    antialias: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    console.warn('WebGL2 not available');
    return null;
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link: ${info}`);
  }
  gl.useProgram(program);

  // Full-screen quad (triangle strip)
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  return {
    gl,
    program,
    srcSizeLoc: gl.getUniformLocation(program, 'u_srcSize')!,
    dstSizeLoc: gl.getUniformLocation(program, 'u_dstSize')!,
    texture: null,
    imgWidth: 0,
    imgHeight: 0,
  };
}

async function loadTexture(state: GLState, url: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const { gl } = state;
  if (state.texture) gl.deleteTexture(state.texture);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // createImageBitmap already provides GPU-native orientation — no Y flip needed
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  state.texture = tex;
  state.imgWidth = bmp.width;
  state.imgHeight = bmp.height;
  bmp.close();
}

function draw(state: GLState, physW: number, physH: number) {
  const { gl } = state;
  gl.viewport(0, 0, physW, physH);
  gl.uniform2f(state.srcSizeLoc, state.imgWidth, state.imgHeight);
  gl.uniform2f(state.dstSizeLoc, physW, physH);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ---------- React component ---------- */

interface WebGLPageProps {
  page: PageInfo;
  /** Horizontal alignment of the canvas within its container.
   *  'left' / 'right' are used in spread mode to push pages toward the center. */
  align?: 'center' | 'left' | 'right';
}

const justifyMap = {
  center: 'center',
  left: 'flex-start',
  right: 'flex-end',
} as const;

export default function WebGLPage({ page, align = 'center' }: WebGLPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GLState | null>(null);
  const rafRef = useRef(0);

  const src =
    page.url.startsWith('http://') || page.url.startsWith('https://')
      ? page.url
      : convertFileSrc(page.url);

  // Render: measure container → contain-fit → size canvas → draw
  const render = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!container || !canvas || !st || !st.texture) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const imgW = st.imgWidth;
    const imgH = st.imgHeight;

    // Contain fit
    const scale = Math.min(rect.width / imgW, rect.height / imgH);
    const cssW = Math.round(imgW * scale);
    const cssH = Math.round(imgH * scale);
    const physW = Math.round(cssW * dpr);
    const physH = Math.round(cssH * dpr);
    if (physW <= 0 || physH <= 0) return;

    canvas.width = physW;
    canvas.height = physH;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    draw(st, physW, physH);
  }, []);

  // Init WebGL context (once)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    stateRef.current = initGL(canvas);
    return () => {
      const st = stateRef.current;
      if (st) {
        if (st.texture) st.gl.deleteTexture(st.texture);
        st.gl.deleteProgram(st.program);
        stateRef.current = null;
      }
    };
  }, []);

  // Load texture when src changes
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    let cancelled = false;

    loadTexture(st, src)
      .then(() => { if (!cancelled) render(); })
      .catch((e) => console.error('WebGLPage load failed:', e));

    return () => { cancelled = true; };
  }, [src, render]);

  // Re-render on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(render);
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [render]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: justifyMap[align],
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
