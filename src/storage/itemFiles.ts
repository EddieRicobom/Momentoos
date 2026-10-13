import { ITEM_MIME, type ItemType } from './model';

/**
 * Classificação dos arquivos que viram itens da cena. O app NÃO confia só no
 * que o navegador diz: .glb costuma chegar sem tipo MIME no Android, e um
 * arquivo pode ter a extensão trocada. Por isso:
 *   1. o tipo vem da extensão (com o MIME informado como reserva);
 *   2. o conteúdo é conferido pela "assinatura" (primeiros bytes) do formato.
 * Isto evita confusão e erro cedo; não substitui a validação feita pelos
 * decodificadores do navegador na hora de exibir.
 */

const BY_EXTENSION: Record<string, { type: ItemType; mimeType: string }> = {
  png: { type: 'image', mimeType: 'image/png' },
  jpg: { type: 'image', mimeType: 'image/jpeg' },
  jpeg: { type: 'image', mimeType: 'image/jpeg' },
  webp: { type: 'image', mimeType: 'image/webp' },
  gif: { type: 'gif', mimeType: 'image/gif' },
  mp4: { type: 'video', mimeType: 'video/mp4' },
  m4v: { type: 'video', mimeType: 'video/mp4' },
  webm: { type: 'video', mimeType: 'video/webm' },
  glb: { type: 'model', mimeType: 'model/gltf-binary' },
  mp3: { type: 'audio', mimeType: 'audio/mpeg' },
  ogg: { type: 'audio', mimeType: 'audio/ogg' },
  oga: { type: 'audio', mimeType: 'audio/ogg' },
  wav: { type: 'audio', mimeType: 'audio/wav' },
  m4a: { type: 'audio', mimeType: 'audio/mp4' },
};

const UNSUPPORTED_HINTS: Record<string, string> = {
  gltf: 'glTF com arquivos separados não é suportado. Exporte o modelo como GLB (um arquivo só).',
  mov: 'Vídeo .mov não é suportado. Converta para MP4 ou WebM.',
  avi: 'Vídeo .avi não é suportado. Converta para MP4 ou WebM.',
  mkv: 'Vídeo .mkv não é suportado. Converta para MP4 ou WebM.',
  fbx: 'FBX não é suportado. Converta o modelo para GLB.',
  obj: 'OBJ não é suportado. Converta o modelo para GLB.',
  heic: 'HEIC não é suportado. Converta a imagem para PNG, JPG ou WebP.',
  svg: 'SVG não é suportado. Converta a imagem para PNG, JPG ou WebP.',
};

export type Classification =
  | { ok: true; type: ItemType; mimeType: string }
  | { ok: false; reason: string };

const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
};

export function classifyFile(fileName: string, reportedMime = ''): Classification {
  const ext = extensionOf(fileName);
  const known = BY_EXTENSION[ext];
  if (known) return { ok: true, ...known };

  const hint = UNSUPPORTED_HINTS[ext];
  if (hint) return { ok: false, reason: hint };

  // Sem extensão conhecida: tenta pelo MIME informado (vídeo vence áudio em webm).
  const mime = reportedMime.toLowerCase();
  for (const type of ['image', 'gif', 'video', 'model', 'audio'] as const) {
    if (ITEM_MIME[type].includes(mime)) return { ok: true, type, mimeType: mime };
  }
  return {
    ok: false,
    reason:
      'Formato não suportado. Use imagem (PNG, JPG, WebP), GIF, vídeo (MP4, WebM), modelo 3D (GLB) ou áudio (MP3, OGG, WAV, M4A).',
  };
}

const ascii = (bytes: Uint8Array, start: number, text: string): boolean => {
  if (bytes.length < start + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[start + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** Confere os primeiros bytes com o formato declarado. */
export function matchesSignature(mimeType: string, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case 'image/png':
      return bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG');
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a');
    case 'image/webp':
      return ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP');
    case 'video/mp4':
    case 'audio/mp4':
      return ascii(bytes, 4, 'ftyp');
    case 'video/webm':
    case 'audio/webm':
      return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case 'model/gltf-binary':
      return ascii(bytes, 0, 'glTF');
    case 'audio/mpeg':
      // ID3 no começo, ou um quadro MPEG (sincronismo 0xFFEx / 0xFFFx).
      return ascii(bytes, 0, 'ID3') || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
    case 'audio/ogg':
      return ascii(bytes, 0, 'OggS');
    case 'audio/wav':
      return ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE');
    default:
      return false;
  }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'model/gltf-binary': 'glb',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
};

/** Extensões permitidas nos caminhos de itens dentro do backup (bin = tipo inesperado). */
export const ITEM_PATH_EXTENSIONS: readonly string[] = [...new Set([...Object.values(EXTENSION_BY_MIME), 'bin'])];

export const itemExtension = (mimeType: string): string => EXTENSION_BY_MIME[mimeType] ?? 'bin';

/** Nome de exibição padrão a partir do nome do arquivo (sem extensão). */
export function defaultItemName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base.length > 0 ? base : 'Item';
}
