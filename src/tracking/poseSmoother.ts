import { Matrix4, Vector3 } from 'three';

/**
 * Suavizador de pose (contas puras): tira o tremor da âncora sem criar
 * "elástico" quando a câmera se mexe de verdade.
 *
 * Por que existe: o filtro interno do MindAR (OneEuro) vem com beta = 1000
 * sobre valores em pixels do alvo, o que na prática o deixa DESLIGADO (o corte
 * sobe tanto a qualquer movimento de 1 px que nada é suavizado). O resultado é
 * a pose do rastreador, com todo o ruído dela, indo direto para a cena.
 *
 * Como funciona: a cada leitura mede-se a DISTÂNCIA entre a pose medida e a
 * pose que já está sendo mostrada (média de cinco pontos do alvo: centro e
 * quatro cantos, em larguras do alvo). Distância pequena = ruído: a pose
 * mostrada anda só uma fração pequena (`minAlpha`) em direção à medida. Distância
 * grande = movimento de verdade: o passo cresce suavemente até 1 (acompanha
 * sem atraso). Assim o alvo parado fica firme e uma mão que se mexe não "arrasta".
 * Medir a distância até a pose mostrada (e não a velocidade entre leituras
 * brutas) evita confundir ruído com movimento rápido.
 *
 * A pose resultante é a interpolação elemento a elemento da matriz, o que
 * também vale para a pose "flexível" (esticada, não rígida), que não se
 * decompõe em rotação + escala.
 *
 * Unidades: as distâncias são medidas em LARGURAS DO ALVO. A matriz da âncora
 * leva o espaço do alvo (1 unidade = largura) para o espaço da câmera, então o
 * comprimento da primeira coluna dela é a largura do alvo "vista" pela câmera.
 */

export interface SmootherOptions {
  /** Passo (0 a 1, a ~30 leituras/s) com o alvo praticamente parado. Menor = mais firme e mais atraso. */
  minAlpha: number;
  /** Distância (larguras do alvo) a partir da qual o passo começa a crescer. */
  kneeStart: number;
  /** Distância (larguras do alvo) a partir da qual a pose medida vale por inteiro. */
  kneeEnd: number;
  /** Depois de um intervalo maior que este (ms) sem leituras, recomeça do zero. */
  maxGapMs: number;
}

export const DEFAULT_SMOOTHER: SmootherOptions = {
  minAlpha: 0.12,
  kneeStart: 0.006,
  kneeEnd: 0.035,
  maxGapMs: 1000,
};

/** Cadência de referência das leituras do rastreador (s). */
const REFERENCE_STEP_S = 1 / 30;

type Points = Vector3[];

export class PoseSmoother {
  private readonly options: SmootherOptions;
  private readonly local: Points;
  private output: Matrix4 | null = null;
  private lastTime = 0;

  /** `aspect` = altura / largura do alvo. */
  constructor(aspect: number, options: Partial<SmootherOptions> = {}) {
    this.options = { ...DEFAULT_SMOOTHER, ...options };
    const h = (Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75) / 2;
    this.local = [
      new Vector3(0, 0, 0),
      new Vector3(-0.5, -h, 0),
      new Vector3(0.5, -h, 0),
      new Vector3(0.5, h, 0),
      new Vector3(-0.5, h, 0),
    ];
  }

  /** Esquece o histórico (a próxima leitura passa direto). */
  reset(): void {
    this.output = null;
  }

  /** Última pose devolvida, ou null. */
  get current(): Matrix4 | null {
    return this.output ? this.output.clone() : null;
  }

  /** Recebe a pose medida e devolve a pose suavizada (matriz nova a cada chamada). */
  filter(raw: Matrix4, nowMs: number): Matrix4 {
    const gapMs = nowMs - this.lastTime;
    if (!this.output || !(gapMs >= 0) || gapMs > this.options.maxGapMs) {
      this.output = raw.clone();
      this.lastTime = nowMs;
      return raw.clone();
    }

    const unit = Math.max(new Vector3().setFromMatrixColumn(raw, 0).length(), 1e-9);
    const distance = meanDistance(this.project(raw), this.project(this.output)) / unit;
    const { minAlpha, kneeStart, kneeEnd } = this.options;
    const t = clamp01((distance - kneeStart) / Math.max(kneeEnd - kneeStart, 1e-9));
    const perReading = minAlpha + (1 - minAlpha) * t * t * (3 - 2 * t);
    // Leituras mais espaçadas (ou mais frequentes) que a cadência de referência andam proporcionalmente.
    const step = Math.max(gapMs / 1000, 0.004);
    const alpha = clamp01(1 - Math.pow(1 - perReading, step / REFERENCE_STEP_S));

    const next = new Matrix4();
    const out = this.output.elements;
    const target = raw.elements;
    for (let i = 0; i < 16; i += 1) {
      next.elements[i] = out[i]! + alpha * (target[i]! - out[i]!);
    }
    this.output = next;
    this.lastTime = nowMs;
    return next.clone();
  }

  private project(matrix: Matrix4): Points {
    return this.local.map((p) => p.clone().applyMatrix4(matrix));
  }
}

function meanDistance(a: Points, b: Points): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]!.distanceTo(b[i]!);
  return sum / a.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
