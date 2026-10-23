import * as THREE from 'three';
import type { ItemTransform, SceneItem } from '../storage/model';
import { placementOf } from './placement';
import { motionOffset } from './motion';
import type { ItemController, ItemLoaders } from './types';

/**
 * Nós de um item na cena. A ordem importa:
 *
 *   root (posição) → rotation (giro) → offset (deslocamento no eixo do próprio
 *   item, já girado) → scale (escala uniforme) → conteúdo
 *
 * Assim `position` marca onde o item está na tatuagem, `rotation` o inclina, e
 * `offset` o afasta ao longo dos eixos dele (ex.: levantar da pele quando está
 * inclinado) sem ser afetado pela escala.
 */
export interface ItemNodes {
  root: THREE.Group;
  rotation: THREE.Group;
  offset: THREE.Group;
  scale: THREE.Group;
}

export function createItemNodes(): ItemNodes {
  const root = new THREE.Group();
  const rotation = new THREE.Group();
  const offset = new THREE.Group();
  const scale = new THREE.Group();
  root.add(rotation);
  rotation.add(offset);
  offset.add(scale);
  return { root, rotation, offset, scale };
}

export function applyItemTransform(nodes: ItemNodes, transform: ItemTransform): void {
  const placement = placementOf(transform);
  nodes.root.position.set(...placement.position);
  nodes.rotation.rotation.set(placement.rotation[0], placement.rotation[1], placement.rotation[2], 'XYZ');
  nodes.offset.position.set(...placement.offset);
  nodes.scale.scale.setScalar(placement.scale);
}

export type ItemState = 'skipped' | 'loading' | 'ready' | 'error';

export interface ItemStatus {
  id: string;
  name: string;
  state: ItemState;
  message?: string;
}

export interface RuntimeSummary {
  total: number;
  loading: number;
  ready: number;
  skipped: number;
  failed: Array<{ id: string; name: string; message: string }>;
  /** Algum item espera um toque do usuário para tocar. */
  blocked: boolean;
  notes: string[];
}

export interface SceneRuntimeOptions {
  /** Permite conferir movimento reduzido também em testes sem navegador. */
  reducedMotion?: boolean;
  items: readonly SceneItem[];
  /** Bytes do arquivo de um item (já conferidos pelo armazenamento). */
  openFile(itemId: string): Promise<ArrayBuffer>;
  /** Bytes de uma imagem de carrossel (sem isto, só a primeira imagem aparece). */
  openSlide?(itemId: string, slot: number): Promise<ArrayBuffer>;
  loaders: ItemLoaders;
  /** Carrega também os itens ocultos (o editor liga e desliga ao vivo). */
  includeHidden?: boolean;
  onChange?(summary: RuntimeSummary): void;
  /** Quantos arquivos são abertos e decodificados ao mesmo tempo. */
  concurrency?: number;
}

interface Entry {
  item: SceneItem;
  state: ItemState;
  message?: string;
  controller?: ItemController;
  nodes?: ItemNodes;
}

interface TransitionPose { position: THREE.Vector3; rotation: THREE.Quaternion; offset: THREE.Vector3; scale: THREE.Vector3 }
interface ItemTransition { from: TransitionPose; to: TransitionPose; elapsed: number; duration: number }
const poseOf = (nodes: ItemNodes): TransitionPose => ({ position: nodes.root.position.clone(), rotation: nodes.rotation.quaternion.clone(), offset: nodes.offset.position.clone(), scale: nodes.scale.scale.clone() });

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Falha ao carregar o item.';

export class SceneRuntime {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly options: SceneRuntimeOptions;
  private active = false;
  private motionActive = false;
  private disposed = false;
  private lights: THREE.Light[] = [];
  private motionTime = 0;
  private readonly motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  private readonly transitions = new Map<string, ItemTransition>();

  private get reducedMotion(): boolean { return this.options.reducedMotion ?? this.motionQuery?.matches ?? false; }

  constructor(options: SceneRuntimeOptions) {
    this.options = options;
    this.group.name = 'scene-runtime';
    for (const item of options.items) {
      const load = item.visible || options.includeHidden === true;
      this.entries.set(item.id, { item, state: load ? 'loading' : 'skipped' });
    }
  }

  /** Carrega os itens (poucos por vez). Um item com defeito não impede os outros. */
  async load(): Promise<void> {
    const pending = [...this.entries.values()].filter((entry) => entry.state === 'loading');
    const limit = Math.max(1, this.options.concurrency ?? 3);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!this.disposed) {
        const entry = pending[next++];
        if (!entry) return;
        await this.loadOne(entry);
      }
    };
    this.emit();
    await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker));
  }

  private async loadOne(entry: Entry): Promise<void> {
    const { item } = entry;
    let controller: ItemController | null = null;
    try {
      const data = await this.options.openFile(item.id);
      if (this.disposed) return;
      controller = await this.options.loaders[item.type](item, data, {
        openSlide: (slot) => {
          const open = this.options.openSlide;
          return open ? open(item.id, slot) : Promise.reject(new Error('Imagens do carrossel indisponíveis.'));
        },
      });
      if (this.disposed) {
        controller.dispose();
        return;
      }

      const nodes = createItemNodes();
      nodes.root.userData.itemId = item.id;
      applyItemTransform(nodes, item.transform);
      nodes.root.visible = item.visible;
      if (controller.object) nodes.scale.add(controller.object);
      controller.setOpacity(item.options.opacity);
      if (controller.needsLights) this.ensureLights();
      this.group.add(nodes.root);

      entry.controller = controller;
      entry.nodes = nodes;
      entry.state = 'ready';
    } catch (error) {
      controller?.dispose();
      entry.state = 'error';
      entry.message = errorText(error);
      this.emit();
      return;
    }
    if (this.active) await this.activate(entry, true);
    this.emit();
  }

  private ensureLights(): void {
    if (this.lights.length > 0) return;
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, -0.6, 1);
    this.lights = [hemisphere, sun];
    this.group.add(...this.lights);
  }

  private async activate(entry: Entry, active: boolean): Promise<void> {
    if (!entry.controller || entry.state !== 'ready') return;
    try {
      await entry.controller.setActive(active);
    } catch (error) {
      // Autoplay bloqueado vira `blocked` no próprio controlador; o resto é falha do item.
      if (!entry.controller.blocked) this.fail(entry, error);
    }
  }

  private fail(entry: Entry, error: unknown): void {
    entry.state = 'error';
    entry.message = errorText(error);
    if (entry.nodes) entry.nodes.root.visible = false;
    try {
      entry.controller?.setActive(false).catch(() => {});
    } catch {
      /* já falhou */
    }
  }

  /** Tatuagem reconhecida (true) ou perdida (false). */
  async setTracking(found: boolean): Promise<void> {
    this.active = found;
    this.setMotionActive(found);
    await Promise.all([...this.entries.values()].map((entry) => this.activate(entry, found)));
    this.emit();
  }

  /** No editor, apresentar os objetos não deve iniciar todas as músicas ao mesmo tempo. */
  setMotionActive(active: boolean): void {
    this.motionActive = active;
    if (!active) {
      this.motionTime = 0;
      for (const entry of this.entries.values()) {
        if (entry.nodes && !this.transitions.has(entry.item.id)) applyItemTransform(entry.nodes, entry.item.transform);
      }
    }
  }

  /** Ativa ou pausa um único item de mídia durante a apresentação. */
  async setItemActive(id: string, active: boolean): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.activate(entry, active);
    this.emit();
  }

  /** Chamar de dentro de um toque do usuário para liberar áudio e vídeo bloqueados. */
  async resume(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (entry.state !== 'ready' || !entry.controller?.blocked) return;
        try {
          await entry.controller.resume();
        } catch (error) {
          this.fail(entry, error);
        }
      }),
    );
    this.emit();
  }

  /** A cada quadro: animações de modelos e GIFs. */
  update(deltaSeconds: number): void {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    if (this.reducedMotion) this.motionTime = 0;
    else if (this.motionActive) this.motionTime += dt;
    let phase = 0;
    for (const entry of this.entries.values()) {
      if (entry.state !== 'ready' || !entry.controller) continue;
      phase += 1.1;
      try {
        const transition = this.transitions.get(entry.item.id);
        if (transition && entry.nodes) {
          transition.elapsed += dt;
          const fraction = this.reducedMotion ? 1 : Math.min(1, transition.elapsed / transition.duration);
          const t = fraction * fraction * (3 - 2 * fraction);
          entry.nodes.root.position.lerpVectors(transition.from.position, transition.to.position, t);
          entry.nodes.rotation.quaternion.slerpQuaternions(transition.from.rotation, transition.to.rotation, t);
          entry.nodes.offset.position.lerpVectors(transition.from.offset, transition.to.offset, t);
          entry.nodes.scale.scale.lerpVectors(transition.from.scale, transition.to.scale, t);
          if (transition.from.rotation.angleTo(transition.to.rotation) > 0.0001 && fraction < 1) {
            entry.nodes.root.updateWorldMatrix(true, true);
            const bounds = new THREE.Box3().setFromObject(entry.nodes.root);
            if (!bounds.isEmpty() && bounds.min.z < 0) entry.nodes.root.position.z -= bounds.min.z;
          }
          if (fraction >= 1) this.transitions.delete(entry.item.id);
        } else if (entry.nodes) {
          const [x, y, z] = entry.item.transform.position;
          const offset = this.motionActive && entry.item.visible && !this.reducedMotion
            ? motionOffset(entry.item.options.motion ?? 'none', this.motionTime, entry.item.transform.scale, entry.item.options.motionSpeed, phase)
            : [0, 0, 0];
          entry.nodes.root.position.set(x + offset[0]!, y + offset[1]!, z + offset[2]!);
        }
        entry.controller.update(deltaSeconds);
      } catch (error) {
        this.fail(entry, error);
        this.emit();
      }
    }
  }

  /** Aplica ao vivo o que mudou num item (usado pelo editor). */
  updateItem(item: SceneItem): void {
    this.transitions.delete(item.id);
    const entry = this.entries.get(item.id);
    if (!entry) return;
    entry.item = item;
    if (entry.state !== 'ready' || !entry.nodes || !entry.controller) return;
    applyItemTransform(entry.nodes, item.transform);
    entry.nodes.root.visible = item.visible;
    entry.controller.setOpacity(item.options.opacity);
    entry.controller.configure?.(item);
  }

  /** Anime a troca de disposição sem alterar os arquivos nem os ajustes salvos. */
  transitionItems(items: readonly SceneItem[], duration = 0.65): void {
    for (const item of items) {
      const nodes = this.entries.get(item.id)?.nodes;
      const from = nodes ? poseOf(nodes) : null;
      this.updateItem(item);
      if (!nodes || !from || this.reducedMotion || duration <= 0 || item.type === 'audio') continue;
      const to = poseOf(nodes);
      nodes.root.position.copy(from.position);
      nodes.rotation.quaternion.copy(from.rotation);
      nodes.offset.position.copy(from.offset);
      nodes.scale.scale.copy(from.scale);
      this.transitions.set(item.id, { from, to, elapsed: 0, duration });
    }
  }

  /** Antes de arrastar, o gizmo deve corresponder aos números do painel. */
  finishTransitions(): void {
    for (const id of this.transitions.keys()) {
      const entry = this.entries.get(id);
      if (entry?.nodes) applyItemTransform(entry.nodes, entry.item.transform);
    }
    this.transitions.clear();
  }

  /** Mede uma transformação candidata sem mudar a pose que está sendo exibida. */
  boundsFor(id: string, transform: ItemTransform): THREE.Box3 | null {
    const nodes = this.entries.get(id)?.nodes;
    if (!nodes) return null;
    const before = poseOf(nodes);
    applyItemTransform(nodes, transform);
    nodes.root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(nodes.root);
    nodes.root.position.copy(before.position);
    nodes.rotation.quaternion.copy(before.rotation);
    nodes.offset.position.copy(before.offset);
    nodes.scale.scale.copy(before.scale);
    nodes.root.updateWorldMatrix(true, true);
    return bounds.isEmpty() ? null : bounds;
  }

  /** Limites da disposição de destino, mesmo durante uma transição. */
  sceneBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const entry of this.entries.values()) {
      if (!entry.item.visible || entry.item.type === 'audio') continue;
      const itemBounds = this.boundsFor(entry.item.id, entry.item.transform);
      if (itemBounds) bounds.union(itemBounds);
    }
    return bounds;
  }

  /** Acrescenta e carrega um item depois da montagem inicial (editor). */
  async add(item: SceneItem): Promise<void> {
    if (this.disposed || this.entries.has(item.id)) return;
    const entry: Entry = { item, state: 'loading' };
    this.entries.set(item.id, entry);
    this.emit();
    await this.loadOne(entry);
  }

  /** Tira um item da cena e libera seus recursos. */
  remove(id: string): void {
    this.transitions.delete(id);
    const entry = this.entries.get(id);
    if (!entry) return;
    try {
      entry.controller?.dispose();
    } catch {
      /* limpeza best-effort */
    }
    entry.nodes?.root.removeFromParent();
    this.entries.delete(id);
    this.emit();
  }

  /** Nó raiz do item na cena (para seleção, destaque e arrasto). */
  rootOf(id: string): THREE.Object3D | null {
    const entry = this.entries.get(id);
    return entry?.state === 'ready' ? (entry.nodes?.root ?? null) : null;
  }

  /** Nó de giro do item; mantém o gizmo na mesma parte da hierarquia que o estado salvo. */
  rotationOf(id: string): THREE.Object3D | null {
    const entry = this.entries.get(id);
    return entry?.state === 'ready' ? (entry.nodes?.rotation ?? null) : null;
  }

  /** Nó de escala uniforme do item, separado da posição e do giro. */
  scaleNodeOf(id: string): THREE.Object3D | null {
    const entry = this.entries.get(id);
    return entry?.state === 'ready' ? (entry.nodes?.scale ?? null) : null;
  }

  /** Id do item a que um objeto da cena pertence (sobe pelos pais), ou null. */
  itemIdOf(object: THREE.Object3D | null): string | null {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const id = node.userData.itemId;
      if (typeof id === 'string' && this.entries.has(id)) return id;
    }
    return null;
  }

  clipsOf(id: string): readonly string[] {
    return this.entries.get(id)?.controller?.clips ?? [];
  }

  summary(): RuntimeSummary {
    const summary: RuntimeSummary = { total: 0, loading: 0, ready: 0, skipped: 0, failed: [], blocked: false, notes: [] };
    for (const entry of this.entries.values()) {
      summary.total += 1;
      if (entry.state === 'loading') summary.loading += 1;
      else if (entry.state === 'skipped') summary.skipped += 1;
      else if (entry.state === 'error') {
        summary.failed.push({ id: entry.item.id, name: entry.item.name, message: entry.message ?? 'Falha.' });
      } else {
        summary.ready += 1;
        if (entry.controller?.blocked) summary.blocked = true;
        if (entry.controller?.note) summary.notes.push(`${entry.item.name}: ${entry.controller.note}`);
      }
    }
    return summary;
  }

  statuses(): ItemStatus[] {
    return [...this.entries.values()].map((entry) => ({
      id: entry.item.id,
      name: entry.item.name,
      state: entry.state,
      ...(entry.message ? { message: entry.message } : {}),
    }));
  }

  private emit(): void {
    if (!this.disposed) this.options.onChange?.(this.summary());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transitions.clear();
    for (const entry of this.entries.values()) {
      try {
        entry.controller?.dispose();
      } catch {
        /* limpeza best-effort */
      }
    }
    for (const light of this.lights) light.dispose?.();
    this.group.removeFromParent();
    this.group.clear();
    this.entries.clear();
  }
}
