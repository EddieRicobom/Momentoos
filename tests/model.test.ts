import { describe, expect, it } from 'vitest';
import {
  NAME_MAX_LENGTH,
  PROJECT_FORMAT_VERSION,
  assessProject,
  MAX_ITEMS_PER_PROJECT,
  defaultOptions,
  defaultTransform,
  emptyScene,
  itemFileKind,
  isFileKind,
  isValidId,
  normalizeName,
  parseProjectRecord,
  type ProjectRecord,
  type SceneItem,
} from '../src/storage/model';
import { makeRecord } from './helpers';

const BOTH = { anchor: true, referenceImage: true };

async function valid(): Promise<ProjectRecord> {
  return makeRecord({ id: 'abc123' });
}

const MIME_BY_TYPE = {
  image: 'image/png',
  gif: 'image/gif',
  video: 'video/mp4',
  model: 'model/gltf-binary',
  audio: 'audio/mpeg',
} as const;

function item(id: string, type: keyof typeof MIME_BY_TYPE = 'image'): SceneItem {
  return {
    id,
    type,
    name: `Item ${id}`,
    visible: true,
    file: { mimeType: MIME_BY_TYPE[type], size: 10, sha256: 'a'.repeat(64), fileName: `${id}.bin` },
    transform: defaultTransform(),
    options: defaultOptions(type),
  };
}

async function withItems(items: SceneItem[]): Promise<ProjectRecord> {
  return { ...(await valid()), scene: { items } };
}

describe('parseProjectRecord', () => {
  it('aceita um registro válido sem marcá-lo como migrado', async () => {
    const result = parseProjectRecord(await valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(false);
      expect(result.record.id).toBe('abc123');
    }
  });

  it('aceita projeto sem imagem de referência e sem alvo', async () => {
    const record = await makeRecord({ id: 'x', referenceImage: null, anchor: null });
    expect(parseProjectRecord(record).ok).toBe(true);
  });

  it.each([null, undefined, 'texto', 42, [], true])('rejeita %j como registro', (raw) => {
    expect(parseProjectRecord(raw)).toMatchObject({ ok: false, code: 'unreadable' });
  });

  it.each([undefined, 0, -1, 1.5, '1', null])('rejeita formatVersion %j', async (formatVersion) => {
    const raw = { ...(await valid()), formatVersion };
    expect(parseProjectRecord(raw)).toMatchObject({ ok: false, code: 'unreadable' });
  });

  it('distingue versão mais nova do app: não é corrupção e a mensagem manda atualizar', async () => {
    const raw = { ...(await valid()), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const result = parseProjectRecord(raw);
    expect(result).toMatchObject({
      ok: false,
      code: 'newer-version',
      formatVersion: PROJECT_FORMAT_VERSION + 1,
    });
    if (!result.ok) expect(result.message).toMatch(/Atualize o app/);
  });

  it.each(['', 'a/b', '../x', 'a b', 'ç', 'x'.repeat(65), 123, null])(
    'rejeita id inválido %j (ids viram nomes de pasta no backup)',
    async (id) => {
      const raw = { ...(await valid()), id };
      expect(parseProjectRecord(raw)).toMatchObject({ ok: false, code: 'unreadable' });
    },
  );

  it('rejeita nome vazio ou só com espaços', async () => {
    expect(parseProjectRecord({ ...(await valid()), name: '   ' }).ok).toBe(false);
    expect(parseProjectRecord({ ...(await valid()), name: 5 }).ok).toBe(false);
  });

  it('rejeita datas inválidas', async () => {
    expect(parseProjectRecord({ ...(await valid()), createdAt: 'ontem' }).ok).toBe(false);
    expect(parseProjectRecord({ ...(await valid()), updatedAt: 123 }).ok).toBe(false);
  });

  it.each([
    ['escala zero', { scale: 0 }],
    ['escala negativa', { scale: -1 }],
    ['escala NaN', { scale: Number.NaN }],
    ['rotação com 2 valores', { rotation: [0, 0] }],
    ['posição com texto', { position: [0, 'a', 0] }],
    ['offset infinito', { offset: [0, Number.POSITIVE_INFINITY, 0] }],
  ])('rejeita ajuste de item inválido: %s', async (_label, change) => {
    const raw = await withItems([item('i1')]);
    const items = [{ ...raw.scene.items[0]!, transform: { ...raw.scene.items[0]!.transform, ...change } }];
    expect(parseProjectRecord({ ...raw, scene: { items } }).ok).toBe(false);
  });

  it('rejeita arquivo com hash, tamanho ou dimensões inválidos', async () => {
    const raw = await valid();
    expect(parseProjectRecord({ ...raw, anchor: { ...raw.anchor!, sha256: 'xyz' } }).ok).toBe(false);
    expect(parseProjectRecord({ ...raw, anchor: { ...raw.anchor!, size: -1 } }).ok).toBe(false);
    expect(parseProjectRecord({ ...raw, anchor: { ...raw.anchor!, width: 0 } }).ok).toBe(false);
    expect(parseProjectRecord({ ...raw, anchor: { ...raw.anchor!, mindFormat: 'dois' } }).ok).toBe(false);
    expect(parseProjectRecord({ ...raw, referenceImage: { ...raw.referenceImage!, height: 0 } }).ok).toBe(false);
  });

  it('rejeita campos obrigatórios ausentes (undefined em vez de null)', async () => {
    const { anchor: _anchor, ...withoutAnchor } = await valid();
    expect(parseProjectRecord(withoutAnchor).ok).toBe(false);
    const { scene: _scene, ...withoutScene } = await valid();
    expect(parseProjectRecord(withoutScene).ok).toBe(false);
  });
});

describe('normalizeName', () => {
  it('apara e comprime espaços', () => {
    expect(normalizeName('  Meu   braço \n direito ')).toBe('Meu braço direito');
  });

  it('devolve null para nome vazio', () => {
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('  \t\n ')).toBeNull();
  });

  it('limita o tamanho', () => {
    const name = normalizeName('a'.repeat(200));
    expect(name?.length).toBe(NAME_MAX_LENGTH);
  });
});

describe('isValidId', () => {
  it('aceita hexadecimal, hífen e sublinhado; recusa o resto', () => {
    expect(isValidId('0123abcd')).toBe(true);
    expect(isValidId('a-b_C9')).toBe(true);
    expect(isValidId('a.b')).toBe(false);
    expect(isValidId('')).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });
});

describe('assessProject', () => {
  it('pronto: alvo presente e no formato atual', async () => {
    expect(assessProject(await valid(), BOTH)).toEqual({ status: 'ready' });
  });

  it('pronto mesmo sem a imagem de referência, se o alvo está bom', async () => {
    const record = await makeRecord({ id: 'x', referenceImage: null });
    expect(assessProject(record, { anchor: true, referenceImage: false }).status).toBe('ready');
  });

  it('precisa recompilar: projeto sem alvo mas com imagem', async () => {
    const record = await makeRecord({ id: 'x', anchor: null });
    const health = assessProject(record, { anchor: false, referenceImage: true });
    expect(health.status).toBe('needs-recompile');
  });

  it('precisa recompilar: arquivo do alvo ausente (arquivos ausentes)', async () => {
    const health = assessProject(await valid(), { anchor: false, referenceImage: true });
    expect(health).toMatchObject({ status: 'needs-recompile' });
    if (health.status !== 'ready') expect(health.reason).toMatch(/ausente/);
  });

  it('precisa recompilar: alvo em formato antigo (incompatibilidade de versão)', async () => {
    const base = await valid();
    const record = { ...base, anchor: { ...base.anchor!, mindFormat: 1 } };
    const health = assessProject(record, BOTH);
    expect(health.status).toBe('needs-recompile');
    if (health.status !== 'ready') expect(health.reason).toMatch(/incompatível/);
  });

  it('incompleto: sem alvo utilizável e sem imagem para recompilar', async () => {
    const base = await valid();
    const oldFormat = { ...base, anchor: { ...base.anchor!, mindFormat: 1 }, referenceImage: null };
    expect(assessProject(oldFormat, { anchor: true, referenceImage: false }).status).toBe('broken');
    expect(assessProject(base, { anchor: false, referenceImage: false }).status).toBe('broken');
  });

  it('descritor da imagem existe mas o arquivo sumiu: não conta como recompilável', async () => {
    const base = await valid();
    expect(assessProject({ ...base, anchor: null }, { anchor: false, referenceImage: false }).status).toBe(
      'broken',
    );
  });
});

describe('valores padrão', () => {
  it('transformação padrão: escala 1, tudo zerado', () => {
    expect(defaultTransform()).toEqual({ scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] });
  });

  it('devolve objetos independentes a cada chamada', () => {
    const a = defaultTransform();
    a.position[0] = 9;
    expect(defaultTransform().position[0]).toBe(0);
    const scene = emptyScene();
    scene.items.push(item('x'));
    expect(emptyScene().items).toEqual([]);
  });

  it('opções padrão dependem do tipo: vídeo começa mudo, modelo anima', () => {
    expect(defaultOptions('video')).toMatchObject({ muted: true, animate: false, opacity: 1, volume: 1 });
    expect(defaultOptions('model')).toMatchObject({ muted: false, animate: true, clip: null });
    expect(defaultOptions('audio')).toMatchObject({ muted: false, loop: true });
  });
});

describe('FileKind', () => {
  it('reconhece alvo, foto e arquivos de item; rejeita o resto', () => {
    expect(isFileKind('anchor')).toBe(true);
    expect(isFileKind('referenceImage')).toBe(true);
    expect(isFileKind(itemFileKind('abc123'))).toBe(true);
    expect(isFileKind('item:')).toBe(false);
    expect(isFileKind('item:../x')).toBe(false);
    expect(isFileKind('item:a/b')).toBe(false);
    expect(isFileKind('qualquer')).toBe(false);
    expect(isFileKind(5)).toBe(false);
  });
});

describe('cena (itens)', () => {
  it('aceita cena vazia e cena com vários itens de tipos diferentes', async () => {
    expect(parseProjectRecord(await valid()).ok).toBe(true);
    const raw = await withItems([
      item('i1', 'image'),
      item('i2', 'gif'),
      item('i3', 'video'),
      item('i4', 'model'),
      item('i5', 'audio'),
    ]);
    const result = parseProjectRecord(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.scene.items.map((i) => i.type)).toEqual(['image', 'gif', 'video', 'model', 'audio']);
  });

  it('aceita até o limite de itens e rejeita acima dele', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(`it${i}`));
    expect(parseProjectRecord(await withItems(many(MAX_ITEMS_PER_PROJECT))).ok).toBe(true);
    expect(parseProjectRecord(await withItems(many(MAX_ITEMS_PER_PROJECT + 1))).ok).toBe(false);
  });

  it('rejeita ids de item repetidos', async () => {
    expect(parseProjectRecord(await withItems([item('igual'), item('igual')])).ok).toBe(false);
  });

  it.each([
    ['tipo desconhecido (youtube não existe)', { type: 'youtube' }],
    ['id com barra', { id: 'a/b' }],
    ['nome vazio', { name: '   ' }],
    ['visibilidade em texto', { visible: 'sim' }],
    ['mime que não combina com o tipo', { file: { mimeType: 'video/mp4' } }],
    ['arquivo acima do limite', { file: { size: 49 * 1024 * 1024 } }],
    ['hash inválido', { file: { sha256: 'xyz' } }],
    ['nome de arquivo vazio', { file: { fileName: '' } }],
    ['largura negativa', { file: { width: -3 } }],
    ['opacidade 2', { options: { opacity: 2 } }],
    ['volume negativo', { options: { volume: -0.1 } }],
    ['loop em texto', { options: { loop: 'sim' } }],
    ['clip vazio', { options: { clip: '' } }],
  ])('rejeita item inválido: %s', async (_label, change) => {
    const base = item('i1', 'image');
    const mutated = {
      ...base,
      ...change,
      ...('file' in change ? { file: { ...base.file, ...change.file } } : {}),
      ...('options' in change ? { options: { ...base.options, ...change.options } } : {}),
    };
    expect(parseProjectRecord({ ...(await valid()), scene: { items: [mutated] } }).ok).toBe(false);
  });

  it('rejeita cena ausente ou sem lista de itens', async () => {
    const raw = await valid();
    expect(parseProjectRecord({ ...raw, scene: null }).ok).toBe(false);
    expect(parseProjectRecord({ ...raw, scene: {} }).ok).toBe(false);
    expect(parseProjectRecord({ ...raw, scene: { items: 'nada' } }).ok).toBe(false);
  });
});

describe('migração do formato 1 para o 2', () => {
  it('troca `content` por uma cena vazia, marca como migrado e preserva o restante', async () => {
    const current = await valid();
    const { scene: _scene, ...rest } = current;
    const v1 = {
      ...rest,
      formatVersion: 1,
      content: { type: 'none', transform: { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] } },
    };
    const result = parseProjectRecord(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.record.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(result.record.scene).toEqual({ items: [] });
    expect('content' in result.record).toBe(false);
    expect(result.record.name).toBe(current.name);
    expect(result.record.anchor).toEqual(current.anchor);
  });

  it('um registro v1 já inválido continua ilegível depois da migração', async () => {
    const result = parseProjectRecord({ id: 'x', formatVersion: 1, name: 5 });
    expect(result.ok).toBe(false);
  });

  it('não altera o objeto de entrada', async () => {
    const { scene: _scene, ...rest } = await valid();
    const v1 = { ...rest, formatVersion: 1, content: { type: 'none' } };
    const copy = JSON.parse(JSON.stringify(v1));
    parseProjectRecord(v1);
    expect(v1).toEqual(copy);
  });
});
