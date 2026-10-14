/**
 * Imagens sintéticas e distorções para o laboratório de detecção.
 *
 * Tudo aqui é gerado por código com semente fixa: o mesmo comando produz
 * exatamente os mesmos quadros. NÃO são fotos de tatuagem reais; servem para
 * comparar "antes e depois" de uma mudança, não para prometer desempenho em
 * campo.
 */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export type DesignKind = 'mandala' | 'blackwork' | 'script' | 'fine';

export const SKIN: [number, number, number] = [201, 154, 120];

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d indisponível');
  return { canvas, ctx };
}

function paintSkin(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number): void {
  ctx.fillStyle = `rgb(${SKIN[0]},${SKIN[1]},${SKIN[2]})`;
  ctx.fillRect(0, 0, w, h);
  // sombreado suave de grande escala + poros finos
  const g = ctx.createRadialGradient(w * 0.4, h * 0.35, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
  g.addColorStop(0, 'rgba(255,230,200,0.10)');
  g.addColorStop(1, 'rgba(80,40,20,0.14)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = gauss(r) * 3;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
}

function strokeCurve(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

/** Desenha um "desenho de tatuagem" sobre pele. Tamanho típico: 600x720. */
export function makeTattoo(kind: DesignKind, seed: number, w = 600, h = 720): HTMLCanvasElement {
  const r = rng(seed);
  const { canvas, ctx } = makeCanvas(w, h);
  paintSkin(ctx, w, h, r);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = w / 2;
  const cy = h / 2;

  if (kind === 'mandala') {
    ctx.strokeStyle = 'rgba(28,32,48,0.88)';
    for (let ring = 0; ring < 6; ring++) {
      const rad = 40 + ring * 42 + r() * 6;
      ctx.lineWidth = 1.6 + r() * 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      const petals = 8 + ring * 3 + Math.floor(r() * 3);
      for (let p = 0; p < petals; p++) {
        const a = (p / petals) * Math.PI * 2 + ring * 0.2;
        const a2 = a + (Math.PI * 2) / petals;
        const rIn = rad;
        const rOut = rad + 26 + r() * 10;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        ctx.quadraticCurveTo(
          cx + Math.cos((a + a2) / 2) * rOut,
          cy + Math.sin((a + a2) / 2) * rOut,
          cx + Math.cos(a2) * rIn,
          cy + Math.sin(a2) * rIn,
        );
        ctx.stroke();
        if (r() < 0.5) {
          ctx.beginPath();
          ctx.arc(cx + Math.cos((a + a2) / 2) * (rIn + 11), cy + Math.sin((a + a2) / 2) * (rIn + 11), 2.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(28,32,48,0.88)';
          ctx.fill();
        }
      }
    }
  } else if (kind === 'blackwork') {
    ctx.fillStyle = 'rgba(14,16,24,0.94)';
    ctx.strokeStyle = 'rgba(14,16,24,0.94)';
    for (let s = 0; s < 14; s++) {
      const a = r() * Math.PI * 2;
      const dist = 40 + r() * 190;
      const bx = cx + Math.cos(a) * dist;
      const by = cy + Math.sin(a) * dist * 1.1;
      const size = 28 + r() * 70;
      ctx.beginPath();
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const rr = size * (0.55 + r() * 0.6);
        const x = bx + Math.cos(t) * rr;
        const y = by + Math.sin(t) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (r() < 0.65) ctx.fill();
      else {
        ctx.lineWidth = 5 + r() * 4;
        ctx.stroke();
      }
    }
    ctx.lineWidth = 6;
    for (let s = 0; s < 7; s++) {
      const pts: Array<[number, number]> = [];
      let x = r() * w;
      let y = r() * h;
      for (let i = 0; i < 6; i++) {
        pts.push([x, y]);
        x += (r() - 0.5) * 140;
        y += (r() - 0.5) * 140;
      }
      strokeCurve(ctx, pts);
    }
    for (let i = 0; i < 260; i++) {
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 1 + r() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'fine') {
    // linha fina irregular (flores/folhas/pontos), sem repetição regular
    ctx.strokeStyle = 'rgba(30,34,52,0.85)';
    for (let s = 0; s < 40; s++) {
      ctx.lineWidth = 2.6 + r() * 1.8;
      const pts: Array<[number, number]> = [];
      let x = 30 + r() * (w - 60);
      let y = 30 + r() * (h - 60);
      let ang = r() * Math.PI * 2;
      const len = 4 + Math.floor(r() * 6);
      for (let i = 0; i < len; i++) {
        pts.push([x, y]);
        ang += (r() - 0.5) * 1.6;
        const step = 14 + r() * 34;
        x = Math.max(10, Math.min(w - 10, x + Math.cos(ang) * step));
        y = Math.max(10, Math.min(h - 10, y + Math.sin(ang) * step));
      }
      strokeCurve(ctx, pts);
      if (r() < 0.5) {
        // folha/pétala pequena no fim do traço
        const [lx, ly] = pts[pts.length - 1]!;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 6 + r() * 12, 3 + r() * 6, ang, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(30,34,52,0.85)';
    for (let i = 0; i < 90; i++) {
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 0.9 + r() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 'script': traços longos, tinta cinza-azulada de baixo contraste e sombreado suave
    ctx.strokeStyle = 'rgba(74,84,104,0.78)';
    for (let s = 0; s < 18; s++) {
      ctx.lineWidth = 2 + r() * 4;
      const pts: Array<[number, number]> = [];
      let x = 60 + r() * (w - 120);
      let y = 60 + r() * (h - 120);
      const dirx = (r() - 0.5) * 2;
      for (let i = 0; i < 9; i++) {
        pts.push([x, y]);
        x += dirx * 38 + (r() - 0.5) * 70;
        y += (r() - 0.5) * 90;
        x = Math.max(20, Math.min(w - 20, x));
        y = Math.max(20, Math.min(h - 20, y));
      }
      strokeCurve(ctx, pts);
    }
    ctx.save();
    ctx.filter = 'blur(6px)';
    ctx.fillStyle = 'rgba(80,90,110,0.30)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(60 + r() * (w - 120), 60 + r() * (h - 120), 30 + r() * 40, 20 + r() * 30, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return canvas;
}

export interface Look {
  /** Ganho linear (1 = igual). */
  gain: number;
  /** Gama (1 = igual; <1 clareia, >1 escurece os tons médios). */
  gamma: number;
  /** Contraste em torno do cinza médio (1 = igual). */
  contrast: number;
  /** Rampa de iluminação: fração do brilho que varia de um lado ao outro do quadro. */
  ramp: number;
  /** Direção da rampa em graus. */
  rampAngle: number;
  /** Multiplicadores de canal (luz quente/fria). */
  tint: [number, number, number];
  /** Desfoque (px de sigma, aprox.). */
  blur: number;
  /** Ruído gaussiano (desvio em níveis de cinza). */
  noise: number;
  /** Manchas de luz/sombra no quadro (coordenadas do quadro): ganho multiplica, add soma (0..1). */
  blobs: Array<{ x: number; y: number; rx: number; ry: number; gain: number; add: number }>;
}

export const NEUTRAL_LOOK: Look = {
  gain: 1,
  gamma: 1,
  contrast: 1,
  ramp: 0,
  rampAngle: 0,
  tint: [1, 1, 1],
  blur: 0,
  noise: 0,
  blobs: [],
};

export interface Geometry {
  /** Largura aparente da tatuagem no quadro, em px (de frente). */
  widthPx: number;
  /** Rotação no plano da imagem, graus. */
  rotZ: number;
  /** Inclinação (perspectiva), graus: 0 = de frente. */
  tilt: number;
  /** Direção do eixo de inclinação no plano da tatuagem, graus. */
  tiltAxis: number;
  /** Esticar (>1) ou achatar (<1) a tatuagem no seu próprio eixo x / y (a pele se deforma). */
  stretchX: number;
  stretchY: number;
  /** Deslocamento do centro da tatuagem no quadro, em px. */
  shiftX: number;
  shiftY: number;
}

export const NEUTRAL_GEOMETRY: Geometry = {
  widthPx: 300,
  rotZ: 0,
  tilt: 0,
  tiltAxis: 0,
  stretchX: 1,
  stretchY: 1,
  shiftX: 0,
  shiftY: 0,
};

type Mat3 = number[];

function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return o;
}

function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = 1 / det;
  return [
    A * s,
    -(b * i - c * h) * s,
    (b * f - c * e) * s,
    B * s,
    (a * i - c * g) * s,
    -(a * f - c * d) * s,
    C * s,
    -(a * h - b * g) * s,
    (a * e - b * d) * s,
  ];
}

function rotMat(axis: [number, number, number], rad: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

const DEG = Math.PI / 180;

export const FOVY = 45 * DEG;

/** Homografia (pixel da imagem-alvo -> pixel do quadro). Mesmo modelo de câmera do MindAR. */
export function homographyFor(
  g: Geometry,
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
): Mat3 {
  const f = frameH / 2 / Math.tan(FOVY / 2);
  const tiltR = rotMat(
    [Math.cos(g.tiltAxis * DEG), Math.sin(g.tiltAxis * DEG), 0],
    g.tilt * DEG,
  );
  const rz = rotMat([0, 0, 1], g.rotZ * DEG);
  const R = mul3(tiltR, rz);
  const z0 = (f * srcW) / g.widthPx;
  const r1 = [R[0]! * g.stretchX, R[3]! * g.stretchX, R[6]! * g.stretchX];
  const r2 = [R[1]! * g.stretchY, R[4]! * g.stretchY, R[7]! * g.stretchY];
  const tx = (g.shiftX * z0) / f;
  const ty = (g.shiftY * z0) / f;
  const t = [
    tx - r1[0]! * (srcW / 2) - r2[0]! * (srcH / 2),
    ty - r1[1]! * (srcW / 2) - r2[1]! * (srcH / 2),
    z0 - r1[2]! * (srcW / 2) - r2[2]! * (srcH / 2),
  ];
  const M: Mat3 = [r1[0]!, r2[0]!, t[0]!, r1[1]!, r2[1]!, t[1]!, r1[2]!, r2[2]!, t[2]!];
  const K: Mat3 = [f, 0, frameW / 2, 0, f, frameH / 2, 0, 0, 1];
  return mul3(K, M);
}

export function applyH(H: Mat3, x: number, y: number): [number, number] {
  const w = H[6]! * x + H[7]! * y + H[8]!;
  return [(H[0]! * x + H[1]! * y + H[2]!) / w, (H[3]! * x + H[4]! * y + H[5]!) / w];
}

/**
 * Renderiza um quadro de câmera sintético: a imagem-alvo deformada (homografia),
 * sobre pele, com a "luz" aplicada. Devolve também a homografia verdadeira.
 */
export function renderFrame(
  source: HTMLCanvasElement,
  g: Geometry,
  look: Look,
  frameW: number,
  frameH: number,
  seed: number,
): { canvas: HTMLCanvasElement; H: Mat3 } {
  const sw = source.width;
  const sh = source.height;
  const sctx = source.getContext('2d', { willReadFrequently: true })!;
  const src = sctx.getImageData(0, 0, sw, sh).data;
  const H = homographyFor(g, sw, sh, frameW, frameH);
  const Hi = inv3(H);
  const { canvas, ctx } = makeCanvas(frameW, frameH);
  const out = ctx.createImageData(frameW, frameH);
  const r = rng(seed);
  const rampDx = Math.cos(look.rampAngle * DEG);
  const rampDy = Math.sin(look.rampAngle * DEG);
  // Sobreamostragem: uma câmera real filtra (óptica + sensor) antes de amostrar;
  // sem isto, linhas finas reduzidas viram serrilhado que não existe em campo.
  const taps = Math.min(4, Math.max(1, Math.ceil(sw / g.widthPx)));
  const norm = 1 / (taps * taps);
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (let ty = 0; ty < taps; ty++) {
        for (let tx = 0; tx < taps; tx++) {
          const px = x + (tx + 0.5) / taps;
          const py = y + (ty + 0.5) / taps;
          const w = Hi[6]! * px + Hi[7]! * py + Hi[8]!;
          const u = (Hi[0]! * px + Hi[1]! * py + Hi[2]!) / w;
          const v = (Hi[3]! * px + Hi[4]! * py + Hi[5]!) / w;
          if (w > 0 && u >= 0 && v >= 0 && u < sw - 1 && v < sh - 1) {
            const x0 = Math.floor(u);
            const y0 = Math.floor(v);
            const fx = u - x0;
            const fy = v - y0;
            const i00 = (y0 * sw + x0) * 4;
            const i10 = i00 + 4;
            const i01 = i00 + sw * 4;
            const i11 = i01 + 4;
            const w00 = (1 - fx) * (1 - fy);
            const w10 = fx * (1 - fy);
            const w01 = (1 - fx) * fy;
            const w11 = fx * fy;
            cr += src[i00]! * w00 + src[i10]! * w10 + src[i01]! * w01 + src[i11]! * w11;
            cg += src[i00 + 1]! * w00 + src[i10 + 1]! * w10 + src[i01 + 1]! * w01 + src[i11 + 1]! * w11;
            cb += src[i00 + 2]! * w00 + src[i10 + 2]! * w10 + src[i01 + 2]! * w01 + src[i11 + 2]! * w11;
          } else {
            cr += SKIN[0];
            cg += SKIN[1];
            cb += SKIN[2];
          }
        }
      }
      const o = (y * frameW + x) * 4;
      out.data[o] = cr * norm;
      out.data[o + 1] = cg * norm;
      out.data[o + 2] = cb * norm;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  // desfoque (antes do ruído, como numa câmera)
  let finalCanvas = canvas;
  if (look.blur > 0) {
    const b = makeCanvas(frameW, frameH);
    b.ctx.filter = `blur(${look.blur}px)`;
    b.ctx.drawImage(canvas, 0, 0);
    finalCanvas = b.canvas;
  }
  const fctx = finalCanvas.getContext('2d', { willReadFrequently: true })!;
  const img = fctx.getImageData(0, 0, frameW, frameH);
  const d = img.data;
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      const o = (y * frameW + x) * 4;
      const ramp = 1 + look.ramp * (((x - frameW / 2) / frameW) * rampDx * 2 + ((y - frameH / 2) / frameH) * rampDy * 2);
      let blobGain = 1;
      let blobAdd = 0;
      for (const b of look.blobs) {
        const dx = (x - b.x) / b.rx;
        const dy = (y - b.y) / b.ry;
        const w = Math.exp(-(dx * dx + dy * dy));
        blobGain *= 1 + (b.gain - 1) * w;
        blobAdd += b.add * w;
      }
      for (let c = 0; c < 3; c++) {
        let v = d[o + c]! / 255;
        v = Math.pow(v, look.gamma) * look.gain * ramp * look.tint[c]! * blobGain + blobAdd;
        v = (v - 0.5) * look.contrast + 0.5;
        v *= 255;
        if (look.noise > 0) v += gauss(r) * look.noise;
        d[o + c] = Math.max(0, Math.min(255, v));
      }
    }
  }
  fctx.putImageData(img, 0, 0);
  return { canvas: finalCanvas, H };
}
