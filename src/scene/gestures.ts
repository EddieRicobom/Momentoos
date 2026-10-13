import { MIN_TWIST_DISTANCE, pointerAngleDeg, pointerDistance, twistedRotation, type Point } from './picking';

/**
 * Máquina de gestos da prévia, sem DOM nem WebGL (testável em Node):
 *
 *  - 1 dedo sobre um item: seleciona e arrasta;
 *  - 1 dedo em área vazia: desmarca ao soltar (se não andou);
 *  - 2 dedos: giram o item selecionado. O segundo dedo pode cair em qualquer
 *    lugar (inclusive no vazio) e NÃO desmarca nem seleciona nada;
 *  - ao soltar um dos dois dedos o giro acaba, e o dedo que sobra não vira
 *    arrasto (evita saltos).
 */

export interface GestureHost {
  /** Id do item sob o ponto da tela, ou null. */
  pick(point: Point): string | null;
  select(id: string | null): void;
  /** Começa a arrastar o item a partir do ponto; devolve quem move, ou null se não der. */
  startDrag(id: string, point: Point): ((point: Point) => void) | null;
  selectedId(): string | null;
  /** Giro Z atual do item, ou null se ele não puder girar. */
  rotationZ(id: string): number | null;
  rotate(id: string, degrees: number): void;
}

const TAP_SLOP_PX = 8;

export class GestureTracker {
  private readonly pointers = new Map<number, Point>();
  private drag: { pointerId: number; move(point: Point): void } | null = null;
  private twist: { id: string; startAngle: number; startRotation: number } | null = null;
  private emptyTap: { pointerId: number; origin: Point } | null = null;

  constructor(private readonly host: GestureHost) {}

  down(pointerId: number, point: Point): void {
    this.pointers.set(pointerId, point);

    if (this.pointers.size >= 2) {
      this.drag = null;
      this.emptyTap = null;
      if (this.pointers.size === 2) this.startTwist();
      return;
    }

    const id = this.host.pick(point);
    if (!id) {
      this.emptyTap = { pointerId, origin: point };
      return;
    }
    this.host.select(id);
    const move = this.host.startDrag(id, point);
    if (move) this.drag = { pointerId, move };
  }

  move(pointerId: number, point: Point): void {
    if (!this.pointers.has(pointerId)) return;
    this.pointers.set(pointerId, point);

    if (this.emptyTap?.pointerId === pointerId && pointerDistance(this.emptyTap.origin, point) > TAP_SLOP_PX) {
      this.emptyTap = null;
    }

    if (this.twist) {
      const pair = this.pair();
      if (pair && pointerDistance(...pair) >= MIN_TWIST_DISTANCE) {
        this.host.rotate(this.twist.id, twistedRotation(this.twist.startRotation, this.twist.startAngle, pointerAngleDeg(...pair)));
      }
      return;
    }

    if (this.drag?.pointerId === pointerId) this.drag.move(point);
  }

  /** `cancelled` = pointercancel (o sistema tomou o gesto): nunca conta como toque. */
  up(pointerId: number, cancelled = false): void {
    if (this.emptyTap?.pointerId === pointerId) {
      if (!cancelled) this.host.select(null);
      this.emptyTap = null;
    }
    this.pointers.delete(pointerId);
    if (this.drag?.pointerId === pointerId) this.drag = null;
    if (this.pointers.size < 2) this.twist = null;
  }

  private pair(): [Point, Point] | null {
    const [a, b] = [...this.pointers.values()];
    return a && b ? [a, b] : null;
  }

  private startTwist(): void {
    const id = this.host.selectedId();
    const pair = this.pair();
    if (!id || !pair || pointerDistance(...pair) < MIN_TWIST_DISTANCE) return;
    const rotation = this.host.rotationZ(id);
    if (rotation === null) return;
    this.twist = { id, startAngle: pointerAngleDeg(...pair), startRotation: rotation };
  }
}
