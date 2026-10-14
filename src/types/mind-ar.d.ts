/**
 * Tipos escritos à mão para o subconjunto da API do mind-ar@1.2.5 que este
 * projeto usa. O pacote não publica tipos e seu `main` aponta para um index.js
 * vazio, então o código é importado por caminho profundo (src/**) e
 * empacotado pelo Vite.
 *
 * Cada assinatura abaixo foi conferida no código-fonte do pacote 1.2.5:
 *  - src/image-target/compiler-base.js  (compileImageTargets, exportData, importData)
 *  - src/image-target/three.js          (MindARThree)
 *  - src/image-target/controller.js     (Controller)
 * Se atualizar o mind-ar, revise este arquivo.
 */

declare module 'mind-ar/src/image-target/compiler.js' {
  export interface CompiledTargetData {
    targetImage: { width: number; height: number };
    trackingData: unknown;
    matchingData: unknown;
  }

  export class Compiler {
    /** Resultado da última compilação (null antes de compilar). Usado para acrescentar keyframes. */
    data: Array<{
      targetImage: { data: Uint8Array; width: number; height: number };
      matchingData: unknown[];
      trackingData?: unknown;
    }> | null;
    /**
     * `images` são elementos <img> decodificados (usa img.width/img.height).
     * `progressCallback` recebe um número de 0 a 100.
     */
    compileImageTargets(
      images: ArrayLike<HTMLImageElement>,
      progressCallback: (percent: number) => void,
    ): Promise<unknown[]>;
    /** Serializa o resultado (MessagePack). O arquivo equivale ao .mind. */
    exportData(): Uint8Array;
    /**
     * Desserializa. Se a versão do formato não for a atual, escreve um erro no
     * console e devolve uma lista VAZIA (não lança exceção).
     */
    importData(buffer: ArrayBuffer | Uint8Array): CompiledTargetData[];
  }
}

declare module 'mind-ar/src/image-target/three.js' {
  import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

  export interface MindARAnchor {
    group: Group;
    targetIndex: number;
    onTargetFound: (() => void) | null;
    onTargetLost: (() => void) | null;
    /** Chamado a cada atualização de matriz recebida do rastreador. */
    onTargetUpdate: (() => void) | null;
    css: boolean;
    visible: boolean;
  }

  export interface MindARThreeOptions {
    container: HTMLElement;
    /** URL (inclui blob:) de um arquivo .mind; é carregada com fetch(). */
    imageTargetSrc: string;
    maxTrack?: number;
    uiLoading?: string;
    uiScanning?: string;
    uiError?: string;
    filterMinCF?: number | null;
    filterBeta?: number | null;
    /** Quadros consecutivos rastreados antes de mostrar o conteúdo. */
    warmupTolerance?: number | null;
    /** Quadros consecutivos sem rastreio antes de esconder o conteúdo. */
    missTolerance?: number | null;
  }

  export class MindARThree {
    constructor(options: MindARThreeOptions);
    scene: Scene;
    renderer: WebGLRenderer;
    cssRenderer: { domElement: HTMLElement };
    camera: PerspectiveCamera;
    video: HTMLVideoElement;
    controller: { dispose(): void; worker: Worker };
    start(): Promise<void>;
    stop(): void;
    addAnchor(targetIndex: number): MindARAnchor;
  }
}

declare module 'mind-ar/src/image-target/matching/matching.js' {
  export function match(options: {
    keyframe: unknown;
    querypoints: unknown[];
    querywidth: number;
    queryheight: number;
    debugMode: boolean;
  }): { H?: unknown; matches?: unknown[]; debugExtra?: unknown };
}

declare module 'mind-ar/src/image-target/detector/detector.js' {
  export class Detector {
    constructor(width: number, height: number, debugMode?: boolean);
    detect(input: unknown): { featurePoints: Array<{ x: number; y: number; maxima: boolean }>; debugExtra: unknown };
  }
}

declare module 'mind-ar/src/image-target/image-list.js' {
  export function buildImageList(image: {
    data: Uint8Array;
    width: number;
    height: number;
  }): Array<{ data: Uint8Array; width: number; height: number; scale: number }>;
}

declare module 'mind-ar/src/image-target/matching/hierarchical-clustering.js' {
  export function build(options: { points: unknown[] }): { rootNode: unknown };
}

declare module 'mind-ar/src/image-target/utils/homography.js' {
  /** Mínimos quadrados normalizados; devolve os 9 valores da homografia (linha a linha) ou null. */
  export function solveHomography(srcPoints: number[][], dstPoints: number[][]): number[] | null;
}

declare module 'mind-ar/src/image-target/estimation/estimator.js' {
  export class Estimator {
    constructor(projectionTransform: number[][]);
    estimate(options: {
      screenCoords: Array<{ x: number; y: number }>;
      worldCoords: Array<{ x: number; y: number; z?: number }>;
    }): number[][];
    refineEstimate(options: {
      initialModelViewTransform: number[][];
      worldCoords: Array<{ x: number; y: number; z?: number }>;
      screenCoords: Array<{ x: number; y: number }>;
    }): number[][] | null;
  }
}

declare module 'mind-ar/src/image-target/tracker/extract.js' {
  /** Pontos de rastreamento de uma imagem em cinza (pixels no tamanho da própria imagem). */
  export function extract(image: {
    data: Uint8Array;
    width: number;
    height: number;
    scale: number;
  }): Array<{ x: number; y: number }>;
}

declare module 'mind-ar/src/image-target/utils/images.js' {
  export function resize(options: {
    image: { data: Uint8Array; width: number; height: number };
    ratio: number;
  }): { data: Uint8Array; width: number; height: number };
}

declare module 'mind-ar/src/image-target/input-loader.js' {
  import type { Tensor2D } from '@tensorflow/tfjs';
  export class InputLoader {
    constructor(width: number, height: number);
    /** Devolve o quadro em tons de cinza (0-255), tensor [altura, largura]. */
    loadInput(input: unknown): Tensor2D;
  }
}
