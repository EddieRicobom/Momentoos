/** Injetado pelo Vite (`define` em vite.config.ts) a partir do package.json. */
declare const __APP_VERSION__: string;

/**
 * WebCodecs `ImageDecoder` (Chrome/Edge/Android; Safari recente). Só o
 * subconjunto usado para animar GIFs; o app confere `typeof ImageDecoder`.
 */
interface ImageDecoderFrameResult {
  image: VideoFrame;
  complete: boolean;
}
interface ImageDecoderTrack {
  frameCount: number;
  animated: boolean;
}
declare class ImageDecoder {
  constructor(init: { data: BufferSource; type: string });
  readonly tracks: { ready: Promise<void>; selectedTrack: ImageDecoderTrack | null };
  readonly completed: Promise<void>;
  decode(options?: { frameIndex?: number; completeFramesOnly?: boolean }): Promise<ImageDecoderFrameResult>;
  close(): void;
}
