type Child = Node | string | number | null | undefined | false;

type Props = {
  class?: string;
  [key: string]: unknown;
};

/**
 * Criador de elementos mínimo (sem framework). Propriedades que começam com
 * "on" viram event listeners; `class` vira className; booleanos viram
 * atributos presentes/ausentes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') {
        element.className = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (value === true) {
        element.setAttribute(key, '');
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(element: Element): void {
  element.replaceChildren();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
