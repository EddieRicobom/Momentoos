import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GestureTracker } from '../scene/gestures';
import { cameraPose, clampPositionToTarget, rayHitsPlane, type Point, type PreviewView } from '../scene/picking';
import { snapAngle, snapPosition } from '../scene/snapping';
import type { SceneRuntime } from '../scene/runtime';

/**
 * Prévia 3D do editor: a foto de referência (o alvo, 1 unidade de largura) num
 * plano, com os itens da cena por cima, vista de frente ou inclinada. Tocar
 * seleciona um item; arrastar com um dedo o move no plano da pele (com ímãs no
 * centro e nas bordas do alvo, e guias na tela); girar dois dedos gira o item
 * selecionado (em Z, com ímã em 0/45/90°) e afastar/aproximar os dedos muda o tamanho.
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
  getGridSnap(): boolean;
  onSelect(id: string | null): void;
  onDrag(id: string, x: number, y: number): void;
  /** Giro atual (Z, graus) do item, ou null se ele não puder girar. */
  getRotationZ(id: string): number | null;
  onRotate(id: string, degrees: number): void;
  onTransformPosition(id: string, position: [number, number, number]): void;
  onTransformRotate(id: string, degrees: [number, number, number]): void;
  onTransformScale(id: string, scale: number): void;
  onManipulationStart(): void;
  onManipulationEnd(): void;
  /** Tamanho (escala) atual do item, ou null se ele não puder ser redimensionado. */
  getScale(id: string): number | null;
  onScale(id: string, scale: number): void;
}

export type PreviewTool = 'select' | 'move' | 'rotate' | 'scale';

export interface PreviewStage {
  attach(runtime: SceneRuntime): void;
  setView(view: PreviewView): void;
  setTool(tool: PreviewTool): void;
  focusItem(id: string | null): void;
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
  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('rotate');
  transformControls.setSpace('local');
  // Maior presença visual e área de toque para mover, girar e redimensionar.
  transformControls.size = 1.55;
  scene.add(transformControls);
  let gizmoItemId: string | null = null;
  let activeTool: PreviewTool = 'select';
  let scaleAtStart = 1;
  transformControls.addEventListener('mouseDown', () => {
    if (activeTool === 'scale' && transformControls.object) scaleAtStart = transformControls.object.scale.x;
    options.onManipulationStart();
  });
  transformControls.addEventListener('mouseUp', () => options.onManipulationEnd());
  transformControls.addEventListener('objectChange', () => {
    const object = transformControls.object;
    if (!object || !gizmoItemId) return;
    if (activeTool === 'move') {
      const root = runtime?.rootOf(gizmoItemId);
      if (!root) return;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const offsetX = center.x - root.position.x;
      const offsetY = center.y - root.position.y;
      const snapped = snapPosition(root.position.x + offsetX, root.position.y + offsetY, targetAspect, undefined, options.getGridSnap());
      const [x, y] = clampPositionToTarget(snapped.x, snapped.y, size.x / 2, size.y / 2, targetAspect);
      root.position.x = x - offsetX;
      root.position.y = y - offsetY;
      options.onTransformPosition(gizmoItemId, [root.position.x, root.position.y, root.position.z]);
      return;
    }
    if (activeTool === 'rotate') {
      options.onTransformRotate(gizmoItemId, [
        THREE.MathUtils.radToDeg(object.rotation.x),
        THREE.MathUtils.radToDeg(object.rotation.y),
        THREE.MathUtils.radToDeg(object.rotation.z),
      ]);
      return;
    }
    if (activeTool === 'scale') {
      const axis = transformControls.axis;
      const ratio = axis === 'X' ? object.scale.x / scaleAtStart : axis === 'Y' ? object.scale.y / scaleAtStart : axis === 'Z' ? object.scale.z / scaleAtStart : (object.scale.x + object.scale.y + object.scale.z) / (3 * scaleAtStart);
      const next = THREE.MathUtils.clamp(scaleAtStart * ratio, 0.05, 5);
      object.scale.setScalar(next);
      options.onTransformScale(gizmoItemId, next);
    }
  });
  let view: PreviewView = 'tilted';
  let runtime: SceneRuntime | null = null;
  let disposed = false;
  const cameraTarget = new THREE.Vector3();
  interface CameraMotion { fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; elapsed: number; duration: number }
  let cameraMotion: CameraMotion | null = null;

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

  // Cruz do centro do alvo (discreta) que acende quando o item gruda nela.
  const half = targetAspect / 2;
  const crossGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -half * 1.04, 0.0005),
    new THREE.Vector3(0, half * 1.04, 0.0005),
    new THREE.Vector3(-0.52, 0, 0.0005),
    new THREE.Vector3(0.52, 0, 0.0005),
  ]);
  const crossMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
  const cross = new THREE.LineSegments(crossGeometry, crossMaterial);
  scene.add(cross);
  const outlineMaterial = outline.material as THREE.LineBasicMaterial;

  let wasSnapped = false;
  const showGuides = (snappedX: boolean, snappedY: boolean, edge: boolean): void => {
    const on = snappedX || snappedY;
    crossMaterial.opacity = on ? 0.95 : 0.22;
    crossMaterial.color.set(on ? ACCENT : 0xffffff);
    outlineMaterial.color.set(edge ? 0xffffff : ACCENT);
    if (on && !wasSnapped) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* vibração é só um agrado */
      }
    }
    wasSnapped = on;
  };
  const hideGuides = (): void => showGuides(false, false, false);

  function applyCamera(): void {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const pose = cameraPose(view, targetAspect, camera.aspect, camera.fov);
    const offset = new THREE.Vector3(...pose.position);
    camera.position.copy(cameraTarget).add(offset);
    camera.up.set(0, 1, 0);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
  }

  const focusItem = (id: string | null): void => {
    const root = id ? runtime?.rootOf(id) : null;
    const target = new THREE.Vector3();
    let desiredDistance: number | null = null;
    if (root) {
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      if (!bounds.isEmpty()) {
        bounds.getCenter(target);
        const size = bounds.getSize(new THREE.Vector3());
        const fitHeight = Math.max(size.y, size.x / Math.max(camera.aspect, 0.1)) * 1.9 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        desiredDistance = THREE.MathUtils.clamp(fitHeight, 0.7, 8);
      }
      else target.copy(root.position);
    }
    const fromPosition = camera.position.clone();
    const fromTarget = cameraTarget.clone();
    const toTarget = target;
    let direction = fromPosition.clone().sub(fromTarget);
    if (direction.lengthSq() < 1e-6) direction.set(0, -0.7, 0.7);
    direction.normalize();
    const toPosition = id && desiredDistance !== null
      ? toTarget.clone().addScaledVector(direction, desiredDistance)
      : toTarget.clone().add(new THREE.Vector3(...cameraPose(view, targetAspect, camera.aspect, camera.fov).position));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    cameraMotion = { fromPosition, toPosition, fromTarget, toTarget, elapsed: 0, duration: reduced ? 0 : 0.55 };
    if (reduced) {
      camera.position.copy(toPosition);
      cameraTarget.copy(toTarget);
      camera.lookAt(cameraTarget);
      cameraMotion = null;
    }
  };

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
    begin: options.onManipulationStart,
    startDrag(id, point) {
      const root = runtime?.rootOf(id);
      if (!root) return null;
      setRay(point);
      const start = planeHit(root.position.z);
      if (!start) return null;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const boundsOffsetX = center.x - root.position.x;
      const boundsOffsetY = center.y - root.position.y;
      const grabX = start[0] - root.position.x;
      const grabY = start[1] - root.position.y;
      const planeZ = root.position.z;
      return (next) => {
        setRay(next);
        const hit = planeHit(planeZ);
        if (!hit) return;
        const snap = snapPosition(hit[0] - grabX, hit[1] - grabY, targetAspect, undefined, options.getGridSnap());
        const [safeX, safeY] = clampPositionToTarget(snap.x + boundsOffsetX, snap.y + boundsOffsetY, size.x / 2, size.y / 2, targetAspect);
        showGuides(snap.snappedX && snap.x === 0, snap.snappedY && snap.y === 0, (snap.snappedX && snap.x !== 0) || (snap.snappedY && snap.y !== 0));
        options.onDrag(id, safeX - boundsOffsetX, safeY - boundsOffsetY);
      };
    },
    selectedId: options.getSelectedId,
    rotationZ: options.getRotationZ,
    rotate(id, degrees) {
      const snap = snapAngle(degrees);
      showGuides(snap.snapped, false, false);
      options.onRotate(id, snap.degrees);
    },
    scaleOf: options.getScale,
    rescale: options.onScale,
    end() {
      hideGuides();
      options.onManipulationEnd();
    },
  });

  const toPoint = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

  const onDown = (event: PointerEvent): void => {
    if (!runtime) return;
    if (activeTool !== 'select' || transformControls.dragging || transformControls.axis !== null) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* sem captura o gesto continua dentro do canvas */
    }
    gestures.down(event.pointerId, toPoint(event));
  };
  const onMove = (event: PointerEvent): void => {
    if (activeTool === 'select' && !transformControls.dragging) gestures.move(event.pointerId, toPoint(event));
  };
  const onUp = (event: PointerEvent): void => {
    if (activeTool === 'select' && !transformControls.dragging) gestures.up(event.pointerId, event.type === 'pointercancel');
  };

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    runtime?.update(delta);
    if (cameraMotion) {
      cameraMotion.elapsed += delta;
      const t = Math.min(1, cameraMotion.elapsed / cameraMotion.duration);
      const eased = t * t * (3 - 2 * t);
      camera.position.lerpVectors(cameraMotion.fromPosition, cameraMotion.toPosition, eased);
      cameraTarget.lerpVectors(cameraMotion.fromTarget, cameraMotion.toTarget, eased);
      camera.lookAt(cameraTarget);
      if (t >= 1) cameraMotion = null;
    }

    const selected = options.getSelectedId();
    const root = selected && runtime ? runtime.rootOf(selected) : null;
    const transformNode = !selected || !runtime ? null : activeTool === 'move' ? root : activeTool === 'rotate' ? runtime.rotationOf(selected) : activeTool === 'scale' ? runtime.scaleNodeOf(selected) : null;
    gizmoItemId = selected;
    if (transformNode !== transformControls.object) {
      if (transformNode) transformControls.attach(transformNode);
      else transformControls.detach();
    }
    if (activeTool !== 'select') {
      const mode = activeTool === 'move' ? 'translate' : activeTool === 'rotate' ? 'rotate' : 'scale';
      if (transformControls.getMode() !== mode) transformControls.setMode(mode);
      transformControls.visible = transformNode !== null;
    }
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
    setTool(next) {
      activeTool = next;
      if (activeTool === 'select') transformControls.detach();
      else transformControls.setMode(activeTool === 'move' ? 'translate' : activeTool === 'rotate' ? 'rotate' : 'scale');
    },
    focusItem,
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      scene.remove(transformControls);
      transformControls.dispose();
      if (runtime) scene.remove(runtime.group);
      backdropMaterial.map?.dispose();
      backdropMaterial.dispose();
      backdropGeometry.dispose();
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      selectionHelper.dispose();
      crossGeometry.dispose();
      crossMaterial.dispose();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      renderer.dispose();
      canvas.remove();
    },
  };
}
