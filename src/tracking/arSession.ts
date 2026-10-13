import { MindARThree } from 'mind-ar/src/image-target/three.js';
import { createVirtualObject } from './virtualObject';

export interface ArSessionOptions {
  /** Elemento com tamanho definido (CSS) onde vídeo e canvas serão inseridos. */
  container: HTMLElement;
  /** Conteúdo do .mind: o que vem de compileTarget() ou de um arquivo salvo. */
  targetBuffer: Uint8Array;
  /** Dimensões do alvo (para desenhar o objeto com a proporção correta). */
  targetSize: { width: number; height: number };
  onReady(): void;
  onFound(): void;
  onLost(): void;
  /** Taxa de atualizações de rastreio por segundo, enquanto reconhecida. */
  onTrackingRate?(updatesPerSecond: number): void;
}

/**
 * Uma sessão de câmera + rastreamento sobre a API real do MindARThree 1.2.5.
 *
 * O alvo é entregue como `blob:` URL criada a partir do buffer em memória (o
 * MindARThree só aceita URL e a baixa com fetch). Isso não depende de rede nem
 * de arquivo no servidor, e é recriado a cada sessão: nenhuma URL temporária
 * precisa sobreviver ao fechamento do app.
 */
export class ArSession {
  private mindar: MindARThree | null = null;
  private blobUrl: string | null = null;
  private stopped = false;
  private updateCount = 0;
  private rateTimer: number | null = null;

  constructor(private readonly options: ArSessionOptions) {}

  async start(): Promise<void> {
    const { container, targetBuffer, targetSize } = this.options;

    // slice() garante um ArrayBuffer próprio (e não compartilhado) para o Blob.
    this.blobUrl = URL.createObjectURL(
      new Blob([targetBuffer.slice()], { type: 'application/octet-stream' }),
    );

    const mindar = new MindARThree({
      container,
      imageTargetSrc: this.blobUrl,
      maxTrack: 1,
      // A interface própria do app mostra os estados; desliga as telas do MindAR.
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
    });
    this.mindar = mindar;

    const anchor = mindar.addAnchor(0);
    anchor.group.add(createVirtualObject(targetSize.width, targetSize.height));
    anchor.onTargetFound = () => this.options.onFound();
    anchor.onTargetLost = () => this.options.onLost();
    anchor.onTargetUpdate = () => {
      if (anchor.visible) this.updateCount += 1;
    };

    try {
      await mindar.start();
    } catch (error) {
      // O MindARThree rejeita sem valor algum; não há causa a repassar.
      this.dispose();
      throw error instanceof Error
        ? error
        : new Error('O rastreador não conseguiu iniciar (câmera ou carregamento do alvo).');
    }

    if (this.stopped) {
      this.dispose();
      return;
    }

    mindar.renderer.setAnimationLoop(() => {
      mindar.renderer.render(mindar.scene, mindar.camera);
    });

    this.rateTimer = window.setInterval(() => {
      this.options.onTrackingRate?.(this.updateCount);
      this.updateCount = 0;
    }, 1000);

    this.options.onReady();
  }

  /** Para a câmera e libera vídeo, canvas, worker e URL do alvo. Idempotente. */
  stop(): void {
    this.stopped = true;
    this.dispose();
  }

  private dispose(): void {
    if (this.rateTimer !== null) {
      window.clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
    const mindar = this.mindar;
    this.mindar = null;
    if (mindar) {
      swallow(() => mindar.renderer.setAnimationLoop(null));
      // stop() falha se o vídeo nunca chegou a receber o stream; tudo é opcional aqui.
      swallow(() => mindar.stop());
      swallow(() => {
        mindar.controller.dispose();
        mindar.controller.worker.terminate();
      });
      swallow(() => {
        mindar.renderer.dispose();
        mindar.renderer.domElement.remove();
        mindar.cssRenderer.domElement.remove();
      });
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }
}

function swallow(fn: () => void): void {
  try {
    fn();
  } catch {
    /* limpeza best-effort */
  }
}
