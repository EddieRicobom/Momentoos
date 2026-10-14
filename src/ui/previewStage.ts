import * as THREE from 'three';
import { GestureTracker } from '../scene/gestures';
import { cameraPose, rayHitsPlane, type Point, type PreviewView } from '../scene/picking';
import type { SceneRuntime } from '../scene/runtime';

/**
 * Prévia 3D do editor: a foto de referência (o alvo, 1 unidade de largura) num
 * plano, com os itens da cena por cima, vista de frente ou inclinada. Tocar
 * seleciona um item; arrastar com um dedo o move no plano da pele; girar dois
 * dedos gira o item selecionado (em Z) e afastar/aproximar os dedos muda o tamanho.
 *
 * Esta é a única parte do editor que depende de WebGL, e NÃO foi exercitada em
 * navegador real (os testes substituem este módulo). Se o WebGL não existir,
 * `createPreviewStage` devolve null e o editor segue só com os controles.
 */

export interface PreviewStageOptions {
  container: HTMLElement;
  /** Altura / largura do alvo. */
  targetAspect: number;
  referenceImage: Blob | null;
  getSelectedId(): string | null;
  onSelect(id: string | null): void;
  onDrag(id: string, x: number, y: number): void;
  /** Giro atual (Z, graus) do item, ou null se ele não puder girar. */
  getRotationZ(id: string): number | null;
  onRotate(id: string, degrees: number): void;
  /** Tamanho (escala) atual do item, ou null se ele não puder ser redimensionado. */
  getScale(id: string): number | null;
  onScale(id: string, scale: number): void;
}

export interface PreviewStage {
  attach(runtime: SceneRuntime): void;
  setView(view: PreviewView): void;
  dispose(): void;
}

const ACCENT = 0x3ee6b0;

export function createPreviewStage(options: PreviewStageOptions): PreviewStage | null {
  const { container, targetAspect } = options;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181c);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  let view: PreviewView = 'front';
  let runtime: SceneRuntime | null = null;
  let disposed = false;

  // Plano do alvo (foto de referência) e contorno.
  const backdropMaterial = new THREE.MeshBasicMaterial({ color: 0x2a3138, side: THREE.DoubleSide });
  const backdropGeometry = new THREE.PlaneGeometry(1, targetAspect);
  const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
  backdrop.position.z = -0.001;
  scene.add(backdrop);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(backdropGeometry),
    new THREE.LineBasicMaterial({ color: ACCENT }),
  );
  scene.add(outline);

  let imageUrl: string | null = null;
  if (options.referenceImage) {
    imageUrl = URL.createObjectURL(options.referenceImage);
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      backdropMaterial.map = texture;
      backdropMaterial.color.set(0xffffff);
      backdropMaterial.needsUpdate = true;
    };
    image.src = imageUrl;
  }

  // Destaque do item selecionado.
  const selectionBox = new THREE.Box3();
  const selectionHelper = new THREE.Box3Helper(selectionBox, new THREE.Color(ACCENT));
  selectionHelper.visible = false;
  scene.add(selectionHelper);

  function applyCamera(): void {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const pose = cameraPose(view, targetAspect, camera.aspect, camera.fov);
    camera.position.set(...pose.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(applyCamera);
  observer.observe(container);
  applyCamera();

  // Seleção, arrasto (1 dedo) e giro (2 dedos): a lógica está em scene/gestures.ts.
  const raycaster = new THREE.Raycaster();

  const setRay = (point: Point): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((point.x - rect.left) / rect.width) * 2 - 1;
    const y = -((point.y - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  };

  const planeHit = (planeZ: number): [number, number] | null =>
    rayHitsPlane(
      [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
      [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
      planeZ,
    );

  const gestures = new GestureTracker({
    pick(point) {
      if (!runtime) return null;
      setRay(point);
      const hit = raycaster.intersectObject(runtime.group, true).find((h) => runtime!.itemIdOf(h.object) !== null);
      return hit ? runtime.itemIdOf(hit.object) : null;
    },
    select: options.onSelect,
    startDrag(id, point) {
      const root = runtime?.rootOf(id);
      if (!root) return null;
      setRay(point);
      const start = planeHit(root.position.z);
      if (!start) return null;
      const grabX = start[0] - root.position.x;
      const grabY = start[1] - root.position.y;
      const planeZ = root.position.z;
      return (next) => {
        setRay(next);
        const hit = planeHit(planeZ);
        if (hit) options.onDrag(id, hit[0] - grabX, hit[1] - grabY);
      };
    },
    selectedId: options.getSelectedId,
    rotationZ: options.getRotationZ,
    rotate: options.onRotate,
    scaleOf: options.getScale,
    rescale: options.onScale,
  });

  const toPoint = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

  const onDown = (event: PointerEvent): void => {
    if (!runtime) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* sem captura o gesto continua dentro do canvas */
    }
    gestures.down(event.pointerId, toPoint(event));
  };
  const onMove = (event: PointerEvent): void => gestures.move(event.pointerId, toPoint(event));
  const onUp = (event: PointerEvent): void => gestures.up(event.pointerId, event.type === 'pointercancel');

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    runtime?.update(delta);

    const selected = options.getSelectedId();
    const root = selected && runtime ? runtime.rootOf(selected) : null;
    if (root) {
      root.updateMatrixWorld(true);
      selectionBox.setFromObject(root);
      selectionHelper.visible = !selectionBox.isEmpty();
    } else {
      selectionHelper.visible = false;
    }
    renderer.render(scene, camera);
  });

  return {
    attach(next) {
      if (runtime) scene.remove(runtime.group);
      runtime = next;
      scene.add(next.group);
    },
    setView(next) {
      view = next;
      applyCamera();
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (runtime) scene.remove(runtime.group);
      backdropMaterial.map?.dispose();
      backdropMaterial.dispose();
      backdropGeometry.dispose();
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      selectionHelper.dispose();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      renderer.dispose();
      canvas.remove();
    },
  };
}
