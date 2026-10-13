export interface Capability {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** Verifica, sem pedir nenhuma permissão, o que este navegador oferece. */
export function checkCapabilities(): Capability[] {
  return [
    {
      id: 'secure-context',
      label: 'Contexto seguro (HTTPS ou localhost)',
      ok: window.isSecureContext,
      detail: window.isSecureContext
        ? 'A câmera pode ser liberada.'
        : 'Sem isso o navegador bloqueia a câmera. Abra o app por HTTPS.',
    },
    {
      id: 'camera-api',
      label: 'API de câmera (getUserMedia)',
      ok: !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function',
      detail: 'Necessária para ver a tatuagem pela câmera.',
    },
    {
      id: 'webgl',
      label: 'WebGL',
      ok: hasWebGl(),
      detail: 'O rastreador e o desenho 3D usam a GPU.',
    },
    {
      id: 'worker',
      label: 'Web Workers',
      ok: typeof Worker !== 'undefined',
      detail: 'O compilador e o rastreador rodam fora da tela principal.',
    },
    {
      id: 'indexeddb',
      label: 'IndexedDB',
      ok: typeof indexedDB !== 'undefined',
      detail: 'Será usado para guardar projetos no aparelho (Etapa C).',
    },
  ];
}

function hasWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
