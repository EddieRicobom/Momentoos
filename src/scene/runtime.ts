import * as THREE from 'three';
import type { ItemTransform, SceneItem } from '../storage/model';
import { placementOf } from './placement';
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

const errorText = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Falha ao carregar o item.';

export class SceneRuntime {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly options: SceneRuntimeOptions;
  private active = false;
  private disposed = false;
  private lights: THREE.Light[] = [];

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
    await Promise.all([...this.entries.values()].map((entry) => this.activate(entry, found)));
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
    for (const entry of this.entries.values()) {
      if (entry.state !== 'ready' || !entry.controller) continue;
      try {
        entry.controller.update(deltaSeconds);
      } catch (error) {
        this.fail(entry, error);
        this.emit();
      }
    }
  }

  /** Aplica ao vivo o que mudou num item (usado pelo editor). */
  updateItem(item: SceneItem): void {
    const entry = this.entries.get(item.id);
    if (!entry) return;
    entry.item = item;
    if (entry.state !== 'ready' || !entry.nodes || !entry.controller) return;
    applyItemTransform(entry.nodes, item.transform);
    entry.nodes.root.visible = item.visible;
    entry.controller.setOpacity(item.options.opacity);
    entry.controller.configure?.(item);
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
