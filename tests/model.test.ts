import { describe, expect, it } from 'vitest';
import {
  NAME_MAX_LENGTH,
  PROJECT_FORMAT_VERSION,
  assessProject,
  defaultContent,
  isValidId,
  normalizeName,
  parseProjectRecord,
  type ProjectRecord,
} from '../src/storage/model';
import { makeRecord } from './helpers';

const BOTH = { anchor: true, referenceImage: true };

async function valid(): Promise<ProjectRecord> {
  return makeRecord({ id: 'abc123' });
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

  it('rejeita tipo de conteúdo desconhecido', async () => {
    const raw = await valid();
    expect(parseProjectRecord({ ...raw, content: { ...raw.content, type: 'hologram' } }).ok).toBe(false);
  });

  it('aceita todos os tipos de conteúdo previstos', async () => {
    const raw = await valid();
    for (const type of ['none', 'image', 'gif', 'video', 'youtube', 'model3d', 'model3d-animated']) {
      expect(parseProjectRecord({ ...raw, content: { ...raw.content, type } }).ok).toBe(true);
    }
  });

  it.each([
    ['escala zero', { scale: 0 }],
    ['escala negativa', { scale: -1 }],
    ['escala NaN', { scale: Number.NaN }],
    ['rotação com 2 valores', { rotation: [0, 0] }],
    ['posição com texto', { position: [0, 'a', 0] }],
    ['offset infinito', { offset: [0, Number.POSITIVE_INFINITY, 0] }],
  ])('rejeita ajuste inválido: %s', async (_label, change) => {
    const raw = await valid();
    const content = { ...raw.content, transform: { ...raw.content.transform, ...change } };
    expect(parseProjectRecord({ ...raw, content }).ok).toBe(false);
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
    const { content: _content, ...withoutContent } = await valid();
    expect(parseProjectRecord(withoutContent).ok).toBe(false);
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

describe('defaultContent', () => {
  it('começa sem conteúdo, escala 1 e posição zerada', () => {
    expect(defaultContent()).toEqual({
      type: 'none',
      transform: { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] },
    });
  });

  it('devolve objetos independentes a cada chamada', () => {
    const a = defaultContent();
    a.transform.position[0] = 9;
    expect(defaultContent().transform.position[0]).toBe(0);
  });
});
