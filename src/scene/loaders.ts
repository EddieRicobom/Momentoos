import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { fitPlane, gifFrameIndex, modelFit } from './placement';
import type { ItemController, ItemLoader, ItemLoaders } from './types';

/**
 * Carregadores reais dos itens (dependem de navegador: imagem, vídeo, áudio,
 * WebCodecs e WebGL). A montagem da cena (runtime.ts) é testada com
 * carregadores falsos; ESTE arquivo só foi checado por tipos e build — não foi
 * exercitado em navegador real.
 */

const MEDIA_TIMEOUT_MS = 20_000;

const blobUrlOf = (data: ArrayBuffer, mimeType: string): string =>
  URL.createObjectURL(new Blob([data], { type: mimeType }));

function once<T>(target: EventTarget, success: string, failure: string, read: () => T, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(() => reject(new Error(`${what}: tempo esgotado ao carregar.`))), MEDIA_TIMEOUT_MS);
    const onOk = (): void => finish(() => resolve(read()));
    const onFail = (): void => finish(() => reject(new Error(`${what}: o navegador não conseguiu abrir este arquivo.`)));
    function finish(done: () => void): void {
      window.clearTimeout(timer);
      target.removeEventListener(success, onOk);
      target.removeEventListener(failure, onFail);
      done();
    }
    target.addEventListener(success, onOk);
    target.addEventListener(failure, onFail);
  });
}

// ------------------------------------------------------------------ utilidades 3D

function planeMesh(texture: THREE.Texture, width: number, height: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      material.transparent = opacity < 1 || material.userData.originalTransparent === true;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  });
}

const base = {
  blocked: false,
  needsLights: false,
  setActive: async (): Promise<void> => {},
  resume: async (): Promise<void> => {},
  update: (): void => {},
};

// ------------------------------------------------------------------ imagem

async function decodeImage(data: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  const url = blobUrlOf(data, mimeType);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error('A imagem não pôde ser decodificada pelo navegador.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function staticImageController(image: HTMLImageElement, note?: string): ItemController {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const { width, height } = fitPlane(image.naturalWidth, image.naturalHeight);
  const mesh = planeMesh(texture, width, height);
  const material = mesh.material as THREE.MeshBasicMaterial;
  return {
    ...base,
    object: mesh,
    ...(note ? { note } : {}),
    setOpacity: (opacity) => {
      material.opacity = opacity;
    },
    dispose: () => disposeObject(mesh),
  };
}

const loadImage: ItemLoader = async (item, data) =>
  staticImageController(await decodeImage(data, item.file.mimeType));

// ------------------------------------------------------------------ GIF

const loadGif: ItemLoader = async (item, data) => {
  if (typeof ImageDecoder === 'undefined') {
    return staticImageController(
      await decodeImage(data, item.file.mimeType),
      'este navegador não anima GIF; mostrando o primeiro quadro.',
    );
  }

  const decoder = new ImageDecoder({ data, type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;

    // Passa uma vez por todos os quadros só para saber as durações (e o tamanho);
    // os quadros em si são decodificados sob demanda, para não guardar tudo na memória.
    const durations: number[] = [];
    let width = 0;
    let height = 0;
    for (let index = 0; index < frameCount; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      durations.push((image.duration ?? 0) / 1000);
      width = image.displayWidth;
      height = image.displayHeight;
      image.close();
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Sem suporte a canvas 2D para animar o GIF.');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const size = fitPlane(width, height);
    const mesh = planeMesh(texture, size.width, size.height);
    const material = mesh.material as THREE.MeshBasicMaterial;

    let elapsedMs = 0;
    let shown = -1;
    let decoding = false;
    let active = false;
    let closed = false;

    const show = async (index: number): Promise<void> => {
      decoding = true;
      try {
        const { image } = await decoder.decode({ frameIndex: index });
        if (!closed) {
          context.clearRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          texture.needsUpdate = true;
          shown = index;
        }
        image.close();
      } finally {
        decoding = false;
      }
    };
    await show(0);

    return {
      ...base,
      object: mesh,
      setActive: async (value) => {
        active = value;
      },
      update: (deltaSeconds) => {
        if (!active || decoding || frameCount < 2) return;
        elapsedMs += deltaSeconds * 1000;
        const wanted = gifFrameIndex(elapsedMs, durations);
        if (wanted !== shown) void show(wanted).catch(() => {});
      },
      setOpacity: (opacity) => {
        material.opacity = opacity;
      },
      dispose: () => {
        closed = true;
        decoder.close();
        disposeObject(mesh);
      },
    };
  } catch (error) {
    decoder.close();
    throw error;
  }
};

// ------------------------------------------------------------------ vídeo e áudio

const isAutoplayBlock = (error: unknown): boolean => error instanceof DOMException && error.name === 'NotAllowedError';

/** Reprodução comum a vídeo e áudio: toca ao reconhecer, pausa ao perder, trata autoplay. */
function mediaPlayback(element: HTMLMediaElement, wantMuted: boolean) {
  let soundBlocked = false;
  const state = {
    get blocked(): boolean {
      return soundBlocked;
    },
    async setActive(active: boolean): Promise<void> {
      if (!active) {
        element.pause();
        return;
      }
      try {
        await element.play();
      } catch (error) {
        if (!isAutoplayBlock(error)) throw error;
        soundBlocked = true;
        if (element instanceof HTMLVideoElement) {
          // Sem toque ainda: mostra o vídeo mudo em vez de nada e pede o toque para o som.
          element.muted = true;
          await element.play().catch(() => {});
        }
      }
    },
    async resume(): Promise<void> {
      element.muted = wantMuted;
      await element.play();
      soundBlocked = false;
    },
  };
  return state;
}

const loadVideo: ItemLoader = async (item, data) => {
  const url = blobUrlOf(data, item.file.mimeType);
  const video = document.createElement('video');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.muted = item.options.muted;
  video.loop = item.options.loop;
  video.volume = item.options.volume;
  video.preload = 'auto';
  video.src = url;
  try {
    await once(video, 'loadeddata', 'error', () => undefined, 'Vídeo');
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  const size = fitPlane(video.videoWidth, video.videoHeight);
  const mesh = planeMesh(texture, size.width, size.height);
  const material = mesh.material as THREE.MeshBasicMaterial;
  const playback = mediaPlayback(video, item.options.muted);

  return {
    ...base,
    object: mesh,
    get blocked() {
      return playback.blocked;
    },
    setActive: playback.setActive,
    resume: playback.resume,
    setOpacity: (opacity) => {
      material.opacity = opacity;
    },
    dispose: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      disposeObject(mesh);
    },
  };
};

const loadAudio: ItemLoader = async (item, data) => {
  const url = blobUrlOf(data, item.file.mimeType);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = item.options.loop;
  audio.muted = item.options.muted;
  audio.volume = item.options.volume;
  audio.src = url;
  try {
    await once(audio, 'loadeddata', 'error', () => undefined, 'Áudio');
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const playback = mediaPlayback(audio, item.options.muted);
  return {
    ...base,
    object: null,
    get blocked() {
      return playback.blocked;
    },
    setActive: playback.setActive,
    resume: playback.resume,
    setOpacity: () => {},
    dispose: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    },
  };
};

// ------------------------------------------------------------------ modelo 3D (GLB)

/** Traduz erros do GLTFLoader para uma orientação em português. */
export function describeModelError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/draco/i.test(text)) {
    return 'Este modelo usa compressão Draco, que o app não suporta. Exporte o GLB sem compressão.';
  }
  if (/meshopt/i.test(text)) {
    return 'Este modelo usa compressão Meshopt, que o app não suporta. Exporte o GLB sem compressão.';
  }
  if (/basisu|ktx2|KHR_texture_basisu/i.test(text)) {
    return 'Este modelo usa texturas KTX2/Basis, que o app não suporta. Exporte com texturas PNG ou JPG.';
  }
  return 'Não foi possível ler o modelo GLB (arquivo inválido ou com recursos não suportados).';
}

const loadModel: ItemLoader = async (item, data) => {
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject);
  }).catch((error: unknown) => {
    throw new Error(describeModelError(error));
  });

  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const fit = modelFit([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]);
  model.position.set(...fit.translation);

  // glTF é Y para cima: gira para o "alto" do modelo apontar para fora da pele.
  const standing = new THREE.Group();
  standing.add(model);
  standing.scale.setScalar(fit.scale);
  standing.rotation.x = Math.PI / 2;
  const root = new THREE.Group();
  root.add(standing);

  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.userData.originalTransparent = material.transparent;
  });

  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  let note: string | undefined;
  if (item.options.animate && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const wanted = item.options.clip === null ? undefined : gltf.animations.find((clip) => clip.name === item.options.clip);
    if (item.options.clip !== null && !wanted) {
      note = `animação "${item.options.clip}" não existe neste modelo; usando a primeira.`;
    }
    const clip = wanted ?? gltf.animations[0]!;
    action = mixer.clipAction(clip);
    action.setLoop(item.options.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
  }

  return {
    ...base,
    object: root,
    ...(note ? { note } : {}),
    clips: gltf.animations.map((clip) => clip.name).filter((name) => name.length > 0),
    needsLights: true,
    setActive: async (active) => {
      if (action) action.paused = !active;
    },
    update: (deltaSeconds) => {
      if (mixer && action && !action.paused) mixer.update(deltaSeconds);
    },
    setOpacity: (opacity) => setObjectOpacity(model, opacity),
    dispose: () => {
      mixer?.stopAllAction();
      disposeObject(root);
    },
  };
};

export const browserLoaders: ItemLoaders = {
  image: loadImage,
  gif: loadGif,
  video: loadVideo,
  model: loadModel,
  audio: loadAudio,
};
