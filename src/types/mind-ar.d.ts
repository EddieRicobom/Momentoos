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
