export type CameraProblem = 'permission-denied' | 'camera-unavailable';

export interface CameraEnvironment {
  isSecureContext: boolean;
  hasMediaDevices: boolean;
}

export interface CameraFailure {
  problem: CameraProblem;
  message: string;
}

/**
 * Traduz o erro de getUserMedia (ou a ausência dele) em um dos dois estados da
 * interface: permissão negada ou câmera indisponível. Função pura, testável.
 */
export function classifyCameraError(
  error: unknown,
  env: CameraEnvironment,
): CameraFailure {
  if (!env.isSecureContext) {
    return {
      problem: 'camera-unavailable',
      message:
        'O navegador só libera a câmera em HTTPS ou em localhost. Abra o app por um endereço seguro.',
    };
  }
  if (!env.hasMediaDevices) {
    return {
      problem: 'camera-unavailable',
      message: 'Este navegador não oferece acesso à câmera.',
    };
  }

  const name = errorName(error);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        problem: 'permission-denied',
        message:
          'O acesso à câmera foi negado. Libere a câmera nas permissões do site no navegador e tente de novo.',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        problem: 'camera-unavailable',
        message: 'Nenhuma câmera foi encontrada neste dispositivo.',
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        problem: 'camera-unavailable',
        message: 'A câmera não pôde ser aberta. Ela pode estar em uso por outro aplicativo.',
      };
    default:
      return {
        problem: 'camera-unavailable',
        message: name
          ? `Não foi possível abrir a câmera (${name}).`
          : 'Não foi possível abrir a câmera.',
      };
  }
}

function errorName(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return null;
}

export function readCameraEnvironment(): CameraEnvironment {
  return {
    isSecureContext: window.isSecureContext,
    hasMediaDevices:
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function',
  };
}

/**
 * Abre e fecha a câmera uma vez só para descobrir, com mensagem precisa, se há
 * permissão e câmera. O MindARThree engole o erro original do getUserMedia
 * (só faz console.log e rejeita sem valor), então esta checagem prévia é o que
 * permite distinguir "negada" de "indisponível" na interface.
 */
export async function probeCamera(): Promise<{ ok: true } | ({ ok: false } & CameraFailure)> {
  const env = readCameraEnvironment();
  if (!env.isSecureContext || !env.hasMediaDevices) {
    return { ok: false, ...classifyCameraError(null, env) };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment' },
    });
    for (const track of stream.getTracks()) track.stop();
    return { ok: true };
  } catch (error) {
    return { ok: false, ...classifyCameraError(error, env) };
  }
}
