import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupError,
  backupFileName,
  exportBackup,
  importBackup,
  type BackupManifest,
} from '../src/storage/backup';
import { sha256Hex } from '../src/storage/hash';
import { PROJECT_FORMAT_VERSION, itemFileKind } from '../src/storage/model';
import { createProject, openProjectAnchor } from '../src/storage/projects';
import type { ProjectRepository } from '../src/storage/repository';
import { addItem, openItemFile, updateItem } from '../src/storage/scene';
import { fakeImage, freshRepository, makeMind, makeRecord, signedBytes, toBuffer } from './helpers';

const BIN = 'application/octet-stream';
const OPTIONS = { appVersion: '0.0.0-teste', now: new Date('2026-10-13T18:30:00.000Z') };

async function addProject(repo: ProjectRepository, name: string, seed: number, withImage = true) {
  return createProject(repo, {
    name,
    anchor: makeMind({ seed, filler: 400 }),
    referenceImage: withImage ? { data: fakeImage(seed, 200), mimeType: 'image/png', width: 640, height: 480 } : null,
    now: new Date(`2026-10-0${seed}T10:00:00.000Z`),
  });
}

type Files = Record<string, Uint8Array>;

/** Abre o ZIP, deixa o teste adulterar o conteúdo e remonta. */
function rezip(zip: Uint8Array, mutate: (files: Files) => void): Uint8Array {
  const files = unzipSync(zip);
  mutate(files);
  return zipSync(files);
}

async function rezipAsync(zip: Uint8Array, mutate: (files: Files) => Promise<void>): Promise<Uint8Array> {
  const files = unzipSync(zip);
  await mutate(files);
  return zipSync(files);
}

function readManifest(zip: Uint8Array): BackupManifest {
  return JSON.parse(strFromU8(unzipSync(zip)['manifest.json']!)) as BackupManifest;
}

function writeManifest(files: Files, manifest: unknown): void {
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
}

describe('backupFileName', () => {
  it('usa data e hora locais e a extensão .tattoo-ar.zip', () => {
    expect(backupFileName(new Date(2026, 9, 13, 8, 5))).toBe('tattoo-ar-backup-20261013-0805.tattoo-ar.zip');
  });
});

describe('exportBackup', () => {
  it('gera manifesto e arquivos que conferem byte a byte com o que está salvo', async () => {
    const repo = await freshRepository();
    const a = await addProject(repo, 'Braço', 1);
    await addProject(repo, 'Perna', 2);

    const result = await exportBackup(repo, 'all', OPTIONS);
    const files = unzipSync(result.bytes);
    const manifest = readManifest(result.bytes);

    expect(manifest).toMatchObject({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: '2026-10-13T18:30:00.000Z',
      app: { name: 'momentoos', version: '0.0.0-teste' },
    });
    expect(manifest.projects).toHaveLength(2);
    expect(result.exported.map((e) => e.name).sort()).toEqual(['Braço', 'Perna']);

    const entry = manifest.projects.find((p) => p.id === a.id)!;
    expect(entry.dir).toBe(`projects/${a.id}`);
    expect(entry.project.path).toBe(`projects/${a.id}/project.json`);
    expect(entry.anchor?.path).toBe(`projects/${a.id}/anchor.mind`);
    expect(entry.referenceImage?.path).toBe(`projects/${a.id}/reference-image.png`);

    // Cada arquivo do ZIP bate com o hash e o tamanho do manifesto.
    for (const file of [entry.project, entry.anchor!, entry.referenceImage!]) {
      const bytes = files[file.path]!;
      expect(bytes.byteLength).toBe(file.size);
      expect(await sha256Hex(bytes)).toBe(file.sha256);
    }
    expect(JSON.parse(strFromU8(files[entry.project.path]!))).toMatchObject({ id: a.id, name: 'Braço' });
    expect(files[entry.anchor!.path]).toEqual(makeMind({ seed: 1, filler: 400 }));
    expect(result.fileName).toMatch(/^tattoo-ar-backup-\d{8}-\d{4}\.tattoo-ar\.zip$/);
  });

  it('exporta só os projetos pedidos e avisa dos que não existem', async () => {
    const repo = await freshRepository();
    const a = await addProject(repo, 'A', 1);
    await addProject(repo, 'B', 2);

    const result = await exportBackup(repo, [a.id, 'fantasma'], OPTIONS);
    expect(result.exported.map((e) => e.id)).toEqual([a.id]);
    expect(result.skipped).toEqual([{ id: 'fantasma', reason: 'Projeto não encontrado.' }]);
  });

  it('deixa de fora (com aviso) um alvo corrompido, mantendo o projeto recompilável', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Danificado', 1);
    const tampered = makeMind({ seed: 99, filler: 400 });
    expect(tampered.byteLength).toBe(record.anchor!.size);
    await repo.save(record, { anchor: { mimeType: BIN, data: toBuffer(tampered) } });

    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.warnings.join(' ')).toMatch(/Danificado.*alvo está corrompido/);
    const manifest = readManifest(result.bytes);
    expect(manifest.projects[0]?.anchor).toBeUndefined();
    expect(manifest.projects[0]?.referenceImage).toBeDefined();
    const saved = JSON.parse(strFromU8(unzipSync(result.bytes)[manifest.projects[0]!.project.path]!));
    expect(saved.anchor).toBeNull();
    expect(saved.referenceImage).not.toBeNull();
  });

  it('pula projetos sem nenhum arquivo íntegro, e falha se não sobrar nada', async () => {
    const repo = await freshRepository();
    await repo.save(await makeRecord({ id: 'vazio' })); // registro sem arquivos gravados
    await expect(exportBackup(repo, 'all', OPTIONS)).rejects.toMatchObject({
      code: 'nothing-to-export',
    });

    const bom = await addProject(repo, 'Bom', 1);
    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.exported.map((e) => e.id)).toEqual([bom.id]);
    expect(result.skipped.map((s) => s.id)).toEqual(['vazio']);
  });

  it('registro de versão mais nova do app fica de fora do backup e é reportado', async () => {
    const repo = await freshRepository();
    const bom = await addProject(repo, 'Bom', 1);
    const futuro = { ...(await addProject(repo, 'Futuro', 2)), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    // Sobrescreve o registro cru, como se outra versão do app o tivesse gravado.
    await repo.save(futuro as never);

    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.exported.map((e) => e.id)).toEqual([bom.id]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe(futuro.id);
  });

  it('exportar sem nenhum projeto falha com mensagem clara', async () => {
    const repo = await freshRepository();
    await expect(exportBackup(repo, 'all', OPTIONS)).rejects.toBeInstanceOf(BackupError);
  });
});

describe('ida e volta (exportar → importar)', () => {
  it('traz o projeto idêntico para outro aparelho e ele abre sem recompilar', async () => {
    const origem = await freshRepository('origem');
    const original = await addProject(origem, 'Braço', 1);
    const { bytes } = await exportBackup(origem, 'all', OPTIONS);

    const destino = await freshRepository('destino');
    const report = await importBackup(destino, bytes);

    expect(report.skipped).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.imported).toEqual([
      { id: original.id, originalId: original.id, name: 'Braço', renamed: false, health: { status: 'ready' } },
    ]);
    expect(report.backupCreatedAt).toBe('2026-10-13T18:30:00.000Z');

    const entry = await destino.getEntry(original.id);
    expect(entry).toMatchObject({ kind: 'project', record: original });
    expect((await openProjectAnchor(destino, original.id)).buffer).toEqual(makeMind({ seed: 1, filler: 400 }));
    expect(new Uint8Array((await destino.getFile(original.id, 'referenceImage'))!.data)).toEqual(
      new Uint8Array(fakeImage(1, 200)),
    );
  });

  it('leva vários projetos de uma vez, incluindo um sem imagem de referência', async () => {
    const origem = await freshRepository('origem');
    await addProject(origem, 'Com foto', 1);
    await addProject(origem, 'Sem foto', 2, false);
    const { bytes } = await exportBackup(origem, 'all', OPTIONS);

    const destino = await freshRepository('destino');
    const report = await importBackup(destino, bytes);
    expect(report.imported.map((i) => i.name).sort()).toEqual(['Com foto', 'Sem foto']);
    expect(report.imported.every((i) => i.health.status === 'ready')).toBe(true);
  });

  it('importar duas vezes é seguro: a segunda reconhece que já existe', async () => {
    const origem = await freshRepository('origem');
    await addProject(origem, 'Braço', 1);
    const { bytes } = await exportBackup(origem, 'all', OPTIONS);

    const destino = await freshRepository('destino');
    await importBackup(destino, bytes);
    const second = await importBackup(destino, bytes);

    expect(second.imported).toEqual([]);
    expect(second.skipped[0]?.reason).toMatch(/já existe/);
    expect(await destino.list()).toHaveLength(1);
  });

  it('mesmo id com conteúdo diferente entra como cópia, sem sobrescrever o que já existe', async () => {
    const repo = await freshRepository();
    const original = await addProject(repo, 'Braço', 1);
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);

    // Depois do backup, o projeto muda aqui.
    await repo.updateMeta(original.id, { name: 'Braço (editado)', updatedAt: '2026-12-01T00:00:00.000Z' });
    const report = await importBackup(repo, bytes);

    expect(report.imported).toHaveLength(1);
    const copy = report.imported[0]!;
    expect(copy.renamed).toBe(true);
    expect(copy.id).not.toBe(original.id);
    expect(copy.originalId).toBe(original.id);
    expect(copy.name).toBe('Braço (importado)');

    expect(await repo.getEntry(original.id)).toMatchObject({ record: { name: 'Braço (editado)' } });
    expect(await repo.getEntry(copy.id)).toMatchObject({ record: { name: 'Braço (importado)' } });
    expect(await repo.list()).toHaveLength(2);
  });

  it('reimportar um backup cujo original foi alterado cria uma nova cópia a cada vez (limitação documentada)', async () => {
    const repo = await freshRepository();
    const original = await addProject(repo, 'Braço', 1);
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);
    await repo.updateMeta(original.id, { name: 'Editado', updatedAt: '2026-12-01T00:00:00.000Z' });

    await importBackup(repo, bytes);
    await importBackup(repo, bytes);
    expect(await repo.list()).toHaveLength(3);
  });

  it('backup com alvo em formato antigo e imagem de referência entra como "precisa recompilar"', async () => {
    const origem = await freshRepository('origem');
    const old = makeMind({ version: 1, filler: 50 });
    const image = fakeImage(3, 100);
    const base = await makeRecord({ id: 'velho' }, { anchor: old, image });
    await origem.save({ ...base, anchor: { ...base.anchor!, mindFormat: 1 } }, {
      anchor: { mimeType: BIN, data: toBuffer(old) },
      referenceImage: { mimeType: 'image/png', data: image },
    });
    const { bytes } = await exportBackup(origem, 'all', OPTIONS);

    const destino = await freshRepository('destino');
    const report = await importBackup(destino, bytes);
    expect(report.imported[0]?.health.status).toBe('needs-recompile');
    expect(report.warnings.join(' ')).toMatch(/incompatível/);
    const entry = await destino.getEntry('velho');
    expect(entry).toMatchObject({ kind: 'project', record: { anchor: null } });
    expect(await destino.getFile('velho', 'anchor')).toBeNull();
  });

  it('backup com alvo antigo e sem imagem é recusado (nada a fazer com ele)', async () => {
    const origem = await freshRepository('origem');
    const old = makeMind({ version: 1 });
    const base = await makeRecord({ id: 'velho', referenceImage: null }, { anchor: old });
    await origem.save({ ...base, anchor: { ...base.anchor!, mindFormat: 1 } }, {
      anchor: { mimeType: BIN, data: toBuffer(old) },
    });
    const { bytes } = await exportBackup(origem, 'all', OPTIONS);

    const destino = await freshRepository('destino');
    const report = await importBackup(destino, bytes);
    expect(report.imported).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/Nenhum arquivo íntegro/);
    expect(await destino.list()).toEqual([]);
  });
});

describe('importação de arquivos inválidos ou hostis', () => {
  async function validZip(): Promise<{ zip: Uint8Array; id: string }> {
    const repo = await freshRepository('origem');
    const project = await addProject(repo, 'Braço', 1);
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);
    return { zip: bytes, id: project.id };
  }

  it('bytes que não são um ZIP', async () => {
    const repo = await freshRepository();
    await expect(importBackup(repo, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toMatchObject({
      code: 'invalid-zip',
    });
    await expect(importBackup(repo, new Uint8Array(0))).rejects.toMatchObject({ code: 'invalid-zip' });
  });

  it('ZIP qualquer, sem manifesto', async () => {
    const repo = await freshRepository();
    const zip = zipSync({ 'leia-me.txt': strToU8('oi') });
    await expect(importBackup(repo, zip)).rejects.toMatchObject({ code: 'not-a-backup' });
  });

  it('manifesto que não é JSON', async () => {
    const repo = await freshRepository();
    const zip = zipSync({ 'manifest.json': strToU8('{ isso não é json') });
    await expect(importBackup(repo, zip)).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  it('manifesto de outro formato', async () => {
    const repo = await freshRepository();
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'outro-app', formatVersion: 1 })) });
    await expect(importBackup(repo, zip)).rejects.toMatchObject({ code: 'not-a-backup' });
  });

  it('backup de versão mais nova do formato: manda atualizar o app', async () => {
    const { zip } = await validZip();
    const future = rezip(zip, (files) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']!));
      writeManifest(files, { ...manifest, formatVersion: BACKUP_FORMAT_VERSION + 1 });
    });
    const repo = await freshRepository();
    await expect(importBackup(repo, future)).rejects.toMatchObject({
      code: 'newer-version',
      message: expect.stringMatching(/Atualize o app/),
    });
  });

  it.each([undefined, 0, 1.5, 'um'])('manifesto com formatVersion %j', async (formatVersion) => {
    const { zip } = await validZip();
    const bad = rezip(zip, (files) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']!));
      writeManifest(files, { ...manifest, formatVersion });
    });
    await expect(importBackup(await freshRepository(), bad)).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  describe('caminhos maliciosos no manifesto', () => {
    async function withEntry(change: (project: Record<string, any>, id: string) => void): Promise<Uint8Array> {
      const { zip, id } = await validZip();
      return rezip(zip, (files) => {
        const manifest = JSON.parse(strFromU8(files['manifest.json']!));
        change(manifest.projects[0], id);
        writeManifest(files, manifest);
      });
    }

    it.each([
      ['caminho com ../', (p: any) => (p.anchor.path = '../fora.mind')],
      ['caminho absoluto', (p: any) => (p.anchor.path = '/etc/passwd')],
      ['caminho de outro projeto', (p: any) => (p.anchor.path = 'projects/outro/anchor.mind')],
      ['project.json fora do lugar', (p: any) => (p.project.path = 'manifest.json')],
      ['extensão de imagem não permitida', (p: any, id: string) => (p.referenceImage.path = `projects/${id}/reference-image.exe`)],
      ['pasta diferente da esperada', (p: any) => (p.dir = 'projects/../x')],
      ['id com barra', (p: any) => (p.id = 'a/b')],
      ['id com ..', (p: any) => (p.id = '..')],
    ])('recusa: %s', async (_label, change) => {
      const zip = await withEntry(change);
      await expect(importBackup(await freshRepository(), zip)).rejects.toMatchObject({ code: 'invalid-manifest' });
    });

    it('recusa ids repetidos', async () => {
      const { zip } = await validZip();
      const dup = rezip(zip, (files) => {
        const manifest = JSON.parse(strFromU8(files['manifest.json']!));
        manifest.projects.push(manifest.projects[0]);
        writeManifest(files, manifest);
      });
      await expect(importBackup(await freshRepository(), dup)).rejects.toMatchObject({ code: 'invalid-manifest' });
    });

    it.each([
      ['hash malformado', (p: any) => (p.anchor.sha256 = 'abc')],
      ['tamanho negativo', (p: any) => (p.anchor.size = -1)],
      ['tamanho não inteiro', (p: any) => (p.anchor.size = 1.5)],
    ])('recusa: %s', async (_label, change) => {
      const zip = await withEntry(change);
      await expect(importBackup(await freshRepository(), zip)).rejects.toMatchObject({ code: 'invalid-manifest' });
    });
  });

  it('arquivos extras no ZIP, não declarados, nunca são lidos nem importados', async () => {
    const { zip, id } = await validZip();
    const extra = rezip(zip, (files) => {
      files['projects/intruso/anchor.mind'] = makeMind();
      files['projects/intruso/project.json'] = strToU8('{}');
      files[`projects/${id}/malware.js`] = strToU8('alert(1)');
      files['../fora.txt'] = strToU8('x');
    });
    const repo = await freshRepository();
    const report = await importBackup(repo, extra);
    expect(report.imported).toHaveLength(1);
    expect((await repo.list()).map((e) => (e.kind === 'project' ? e.record.id : e.id))).toEqual([id]);
  });

  it('alvo adulterado depois do backup (hash não confere): ignorado com aviso', async () => {
    const { zip, id } = await validZip();
    const tampered = rezip(zip, (files) => {
      const bytes = new Uint8Array(files[`projects/${id}/anchor.mind`]!);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
      files[`projects/${id}/anchor.mind`] = bytes;
    });
    const repo = await freshRepository();
    const report = await importBackup(repo, tampered);

    expect(report.warnings.join(' ')).toMatch(/alvo corrompido/);
    expect(report.imported[0]?.health.status).toBe('needs-recompile');
    expect(await repo.getFile(id, 'anchor')).toBeNull();
    expect(await repo.getFile(id, 'referenceImage')).not.toBeNull();
  });

  it('imagem adulterada: ignorada, e o projeto continua utilizável pelo alvo', async () => {
    const { zip, id } = await validZip();
    const tampered = rezip(zip, (files) => {
      files[`projects/${id}/reference-image.png`] = new Uint8Array(200).fill(9);
    });
    const repo = await freshRepository();
    const report = await importBackup(repo, tampered);
    expect(report.warnings.join(' ')).toMatch(/imagem de referência corrompido/);
    expect(report.imported[0]?.health.status).toBe('ready');
    expect(await repo.getFile(id, 'referenceImage')).toBeNull();
  });

  it('arquivo com tamanho diferente do declarado não é nem descompactado', async () => {
    const { zip, id } = await validZip();
    const truncated = rezip(zip, (files) => {
      files[`projects/${id}/anchor.mind`] = new Uint8Array(10);
    });
    const repo = await freshRepository();
    const report = await importBackup(repo, truncated);
    expect(report.warnings.join(' ')).toMatch(/alvo ausente no backup/);
    expect(await repo.getFile(id, 'anchor')).toBeNull();
  });

  it('project.json trocado por outro arquivo (tamanho diferente): o projeto é pulado', async () => {
    const { zip, id } = await validZip();
    const tampered = rezip(zip, (files) => {
      files[`projects/${id}/project.json`] = strToU8(strFromU8(files[`projects/${id}/project.json`]!).replace('Braço', 'Hackeado'));
    });
    const repo = await freshRepository();
    const report = await importBackup(repo, tampered);
    expect(report.imported).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(await repo.list()).toEqual([]);
  });

  it('project.json adulterado com o MESMO tamanho: só o hash denuncia', async () => {
    const { zip, id } = await validZip();
    const original = strFromU8(unzipSync(zip)[`projects/${id}/project.json`]!);
    const edited = original.replace('Braço', 'Brazzo'); // "ç" = 2 bytes; "zz" = 2 bytes
    expect(strToU8(edited).byteLength).toBe(strToU8(original).byteLength);
    const tampered = rezip(zip, (files) => {
      files[`projects/${id}/project.json`] = strToU8(edited);
    });
    const repo = await freshRepository();
    const report = await importBackup(repo, tampered);
    expect(report.imported).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/project\.json corrompido \(hash/);
    expect(await repo.list()).toEqual([]);
  });

  it('project.json com id diferente do manifesto é recusado', async () => {
    const { zip, id } = await validZip();
    const files = unzipSync(zip);
    const record = JSON.parse(strFromU8(files[`projects/${id}/project.json`]!));
    record.id = 'outroid';
    const bytes = strToU8(JSON.stringify(record));
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    manifest.projects[0].project = {
      path: `projects/${id}/project.json`,
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    };
    files[`projects/${id}/project.json`] = bytes;
    writeManifest(files, manifest);

    const repo = await freshRepository();
    const report = await importBackup(repo, zipSync(files));
    expect(report.imported).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/id em project\.json não bate/);
  });

  it('projeto gravado por versão mais nova do app é pulado com a mensagem certa', async () => {
    const { zip, id } = await validZip();
    const files = unzipSync(zip);
    const record = JSON.parse(strFromU8(files[`projects/${id}/project.json`]!));
    record.formatVersion = PROJECT_FORMAT_VERSION + 1;
    const bytes = strToU8(JSON.stringify(record));
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    manifest.projects[0].project = { path: `projects/${id}/project.json`, size: bytes.byteLength, sha256: await sha256Hex(bytes) };
    files[`projects/${id}/project.json`] = bytes;
    writeManifest(files, manifest);

    const repo = await freshRepository();
    const report = await importBackup(repo, zipSync(files));
    expect(report.skipped[0]?.reason).toMatch(/versão mais nova/);
    expect(await repo.list()).toEqual([]);
  });

  it('um projeto ruim não impede a importação dos bons', async () => {
    const origem = await freshRepository('origem');
    const bom = await addProject(origem, 'Bom', 1);
    const ruim = await addProject(origem, 'Ruim', 2);
    const { bytes } = await exportBackup(origem, 'all', OPTIONS);
    const tampered = rezip(bytes, (files) => {
      files[`projects/${ruim.id}/project.json`] = strToU8('isto não é json');
    });

    const destino = await freshRepository('destino');
    const report = await importBackup(destino, tampered);
    expect(report.imported.map((i) => i.id)).toEqual([bom.id]);
    expect(report.skipped.map((s) => s.id)).toEqual([ruim.id]);
  });

  describe('limites de tamanho', () => {
    it('ZIP maior que o limite', async () => {
      const { zip } = await validZip();
      await expect(importBackup(await freshRepository(), zip, { limits: { maxZipBytes: 100 } })).rejects.toMatchObject({
        code: 'too-large',
      });
    });

    it('conteúdo descompactado maior que o limite total', async () => {
      const { zip } = await validZip();
      await expect(importBackup(await freshRepository(), zip, { limits: { maxTotalBytes: 300 } })).rejects.toMatchObject({
        code: 'too-large',
      });
    });

    it('projetos demais', async () => {
      const origem = await freshRepository('origem');
      await addProject(origem, 'A', 1);
      await addProject(origem, 'B', 2);
      const { bytes } = await exportBackup(origem, 'all', OPTIONS);
      await expect(importBackup(await freshRepository(), bytes, { limits: { maxProjects: 1 } })).rejects.toMatchObject({
        code: 'too-large',
      });
    });

    it('arquivo declarado maior que o limite por arquivo', async () => {
      const { zip } = await validZip();
      await expect(importBackup(await freshRepository(), zip, { limits: { maxFileBytes: 50 } })).rejects.toMatchObject({
        code: 'invalid-manifest',
      });
    });

    it('manifesto grande demais não é nem descompactado', async () => {
      const { zip } = await validZip();
      await expect(importBackup(await freshRepository(), zip, { limits: { maxManifestBytes: 10 } })).rejects.toMatchObject({
        code: 'not-a-backup',
      });
    });
  });
});

// ------------------------------------------------------------ itens da cena (formato 2)

describe('backup com itens da cena', () => {
  const files3 = [
    ['rosa.png', 'image/png'],
    ['bicho.glb', 'model/gltf-binary'],
    ['som.mp3', 'audio/mpeg'],
  ] as const;

  async function projectWithItems() {
    const repo = await freshRepository('origem');
    const project = await addProject(repo, 'Braço', 1);
    const items = [];
    for (const [i, [fileName, mime]] of files3.entries()) {
      const { item } = await addItem(repo, project.id, {
        file: { data: signedBytes(mime, 300, i + 1), fileName },
        transform: { scale: 1 + i, position: [0.1 * i, 0, 0] },
        options: { opacity: 0.5 + i / 10 },
      });
      items.push(item);
    }
    return { repo, id: project.id, items };
  }

  const entryOf = async (repo: ProjectRepository, id: string) => {
    const entry = await repo.getEntry(id);
    if (entry?.kind !== 'project') throw new Error('esperado projeto');
    return entry;
  };

  it('declara o formato 2 e guarda cada item em projects/<id>/items/<itemId>.<ext>', async () => {
    expect(BACKUP_FORMAT_VERSION).toBe(2);
    const { repo, id, items } = await projectWithItems();
    const result = await exportBackup(repo, 'all', OPTIONS);
    const manifest = readManifest(result.bytes);
    const zipFiles = unzipSync(result.bytes);

    expect(manifest.formatVersion).toBe(2);
    expect(result.warnings).toEqual([]);
    const entry = manifest.projects[0]!;
    expect(entry.items?.map((i) => [i.id, i.file.path])).toEqual([
      [items[0]!.id, `projects/${id}/items/${items[0]!.id}.png`],
      [items[1]!.id, `projects/${id}/items/${items[1]!.id}.glb`],
      [items[2]!.id, `projects/${id}/items/${items[2]!.id}.mp3`],
    ]);
    for (const { file } of entry.items!) {
      const bytes = zipFiles[file.path]!;
      expect(bytes.byteLength).toBe(file.size);
      expect(await sha256Hex(bytes)).toBe(file.sha256);
    }
  });

  it('projeto sem itens não ganha o campo items no manifesto', async () => {
    const repo = await freshRepository();
    await addProject(repo, 'Vazio', 1);
    const manifest = readManifest((await exportBackup(repo, 'all', OPTIONS)).bytes);
    expect(manifest.projects[0]!.items).toBeUndefined();
  });

  it('ida e volta: itens, ajustes e arquivos chegam idênticos', async () => {
    const { repo, id, items } = await projectWithItems();
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);

    const destino = await freshRepository('destino');
    const report = await importBackup(destino, bytes);
    expect(report.skipped).toEqual([]);
    expect(report.warnings).toEqual([]);

    const entry = await entryOf(destino, id);
    expect(entry.record).toEqual((await entryOf(repo, id)).record);
    expect(entry.record.scene.items).toEqual(items);
    expect(entry.missingItems).toEqual([]);
    for (const [i, item] of items.entries()) {
      const opened = await openItemFile(destino, id, item.id);
      expect(new Uint8Array(opened.data)).toEqual(new Uint8Array(signedBytes(files3[i]![1], 300, i + 1)));
    }
  });

  it('importar com colisão de id leva os itens junto para a cópia', async () => {
    const { repo, id, items } = await projectWithItems();
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);
    await updateItem(repo, id, items[0]!.id, { visible: false }, new Date('2026-12-01T00:00:00.000Z'));

    const report = await importBackup(repo, bytes);
    expect(report.imported[0]?.renamed).toBe(true);
    const copyId = report.imported[0]!.id;
    expect(copyId).not.toBe(id);
    const copy = await entryOf(repo, copyId);
    expect(copy.record.scene.items).toHaveLength(3);
    expect(copy.record.scene.items[0]!.visible).toBe(true);
    expect(copy.missingItems).toEqual([]);
    const opened = await openItemFile(repo, copyId, items[1]!.id);
    expect(new Uint8Array(opened.data)).toEqual(new Uint8Array(signedBytes('model/gltf-binary', 300, 2)));
  });

  it('exportar: item com arquivo corrompido ou ausente fica de fora, com aviso, e o resto sai', async () => {
    const { repo, id, items } = await projectWithItems();
    const record = (await entryOf(repo, id)).record;
    await repo.save(record, {
      [itemFileKind(items[0]!.id)]: { mimeType: 'image/png', data: signedBytes('image/png', 300, 77) }, // mesmo tamanho, outro conteúdo
      [itemFileKind(items[1]!.id)]: null,
    });

    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/rosa.*corrompido/);
    expect(result.warnings.join(' ')).toMatch(/bicho.*ausente/);
    const manifest = readManifest(result.bytes);
    expect(manifest.projects[0]!.items?.map((i) => i.id)).toEqual([items[2]!.id]);
    const saved = JSON.parse(strFromU8(unzipSync(result.bytes)[manifest.projects[0]!.project.path]!));
    expect(saved.scene.items.map((i: { id: string }) => i.id)).toEqual([items[2]!.id]);
    // E o backup resultante é importável sem avisos.
    const report = await importBackup(await freshRepository('d'), result.bytes);
    expect(report.warnings).toEqual([]);
    expect(report.imported).toHaveLength(1);
  });

  describe('importação adulterada', () => {
    async function zipWith() {
      const { repo, id, items } = await projectWithItems();
      const { bytes } = await exportBackup(repo, 'all', OPTIONS);
      return { zip: bytes, id, items };
    }
    const pathOf = (id: string, itemId: string, ext: string) => `projects/${id}/items/${itemId}.${ext}`;

    it('item adulterado com o mesmo tamanho: só ele é descartado, com aviso', async () => {
      const { zip, id, items } = await zipWith();
      const tampered = rezip(zip, (files) => {
        const path = pathOf(id, items[1]!.id, 'glb');
        const b = new Uint8Array(files[path]!);
        b[b.length - 1] = (b[b.length - 1]! + 1) % 256;
        files[path] = b;
      });
      const repo = await freshRepository();
      const report = await importBackup(repo, tampered);
      expect(report.warnings.join(' ')).toMatch(/"bicho".*corrompido/);
      const entry = await entryOf(repo, id);
      expect(entry.record.scene.items.map((i) => i.id)).toEqual([items[0]!.id, items[2]!.id]);
      expect(await repo.getFile(id, itemFileKind(items[1]!.id))).toBeNull();
      expect(entry.missingItems).toEqual([]);
    });

    it('item com tamanho diferente do declarado não chega nem a ser descompactado', async () => {
      const { zip, id, items } = await zipWith();
      const tampered = rezip(zip, (files) => {
        files[pathOf(id, items[0]!.id, 'png')] = new Uint8Array(signedBytes('image/png', 301));
      });
      const repo = await freshRepository();
      const report = await importBackup(repo, tampered);
      expect(report.warnings.join(' ')).toMatch(/"rosa".*ausente/);
      expect((await entryOf(repo, id)).record.scene.items).toHaveLength(2);
    });

    it('item removido do ZIP: ignorado com aviso', async () => {
      const { zip, id, items } = await zipWith();
      const tampered = rezip(zip, (files) => {
        delete files[pathOf(id, items[2]!.id, 'mp3')];
      });
      const report = await importBackup(await freshRepository(), tampered);
      expect(report.warnings.join(' ')).toMatch(/"som".*ausente/);
      expect(report.imported).toHaveLength(1);
    });

    it('conteúdo que não bate com o formato declarado é descartado mesmo com hash coerente', async () => {
      // Quem monta o ZIP à mão recalcula tamanhos e hashes; a assinatura do formato ainda denuncia.
      const { zip, id, items } = await zipWith();
      const fake = new Uint8Array(300).fill(65); // "AAAA…" no lugar de um PNG
      const sha = await sha256Hex(fake);
      const tampered = await rezipAsync(zip, async (files) => {
        const manifest = JSON.parse(strFromU8(files['manifest.json']!));
        files[pathOf(id, items[0]!.id, 'png')] = fake;
        const project = JSON.parse(strFromU8(files[`projects/${id}/project.json`]!));
        project.scene.items.find((i: any) => i.id === items[0]!.id).file.sha256 = sha;
        const projectBytes = strToU8(JSON.stringify(project));
        files[`projects/${id}/project.json`] = projectBytes;
        manifest.projects[0].project.size = projectBytes.byteLength;
        manifest.projects[0].project.sha256 = await sha256Hex(projectBytes);
        manifest.projects[0].items.find((i: any) => i.id === items[0]!.id).file.sha256 = sha;
        writeManifest(files, manifest);
      });
      const repo = await freshRepository();
      const report = await importBackup(repo, tampered);
      expect(report.warnings.join(' ')).toMatch(/"rosa".*diferente do formato/);
      expect((await entryOf(repo, id)).record.scene.items.map((i) => i.id)).toEqual([items[1]!.id, items[2]!.id]);
    });

    it.each([
      ['caminho com ../', (e: any) => (e.items[0].file.path = '../fora.png')],
      ['caminho de outro projeto', (e: any) => (e.items[0].file.path = 'projects/outro/items/x.png')],
      ['extensão não permitida', (e: any) => (e.items[0].file.path = e.items[0].file.path.replace('.png', '.exe'))],
      ['id do item diferente do caminho', (e: any) => (e.items[0].id = 'outroid')],
      ['ids de item repetidos', (e: any) => e.items.push(e.items[0])],
      ['itens que não são lista', (e: any) => (e.items = 'x')],
      ['item sem arquivo', (e: any) => delete e.items[0].file],
      ['hash malformado', (e: any) => (e.items[0].file.sha256 = 'abc')],
      ['item acima do limite por item', (e: any) => (e.items[0].file.size = 49 * 1024 * 1024)],
      ['itens demais', (e: any) => (e.items = Array.from({ length: 101 }, (_, i) => ({ id: `i${i}`, file: e.items[0].file })))],
    ])('manifesto inválido é recusado: %s', async (_label, change) => {
      const { zip } = await zipWith();
      const bad = rezip(zip, (files) => {
        const manifest = JSON.parse(strFromU8(files['manifest.json']!));
        change(manifest.projects[0]);
        writeManifest(files, manifest);
      });
      await expect(importBackup(await freshRepository(), bad)).rejects.toMatchObject({ code: 'invalid-manifest' });
    });

    it('arquivo de item não declarado no manifesto nunca é lido', async () => {
      const { zip, id } = await zipWith();
      const extra = rezip(zip, (files) => {
        files[pathOf(id, 'clandestino', 'png')] = new Uint8Array(signedBytes('image/png', 300));
      });
      const repo = await freshRepository();
      const report = await importBackup(repo, extra);
      expect(report.warnings).toEqual([]);
      expect(await repo.getFile(id, itemFileKind('clandestino'))).toBeNull();
    });

    it('limite total de bytes vale também para os itens', async () => {
      const { zip } = await zipWith();
      await expect(importBackup(await freshRepository(), zip, { limits: { maxTotalBytes: 1500 } })).rejects.toMatchObject({
        code: 'too-large',
      });
    });
  });

  describe('compatibilidade com o formato 1', () => {
    /** Reescreve um backup v2 (sem itens) como o app antigo o gravaria. */
    async function asVersion1(): Promise<{ zip: Uint8Array; id: string }> {
      const repo = await freshRepository('origem');
      const project = await addProject(repo, 'Antigo', 1);
      const { bytes } = await exportBackup(repo, 'all', OPTIONS);
      const zip = await rezipAsync(bytes, async (files) => {
        const manifest = JSON.parse(strFromU8(files['manifest.json']!));
        const path = manifest.projects[0].project.path;
        const record = JSON.parse(strFromU8(files[path]!));
        delete record.scene;
        record.formatVersion = 1;
        record.content = { type: 'none', transform: { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] } };
        const projectBytes = strToU8(JSON.stringify(record));
        files[path] = projectBytes;
        manifest.formatVersion = 1;
        manifest.projects[0].project.size = projectBytes.byteLength;
        manifest.projects[0].project.sha256 = await sha256Hex(projectBytes);
        writeManifest(files, manifest);
      });
      return { zip, id: project.id };
    }

    it('um backup do formato 1 ainda importa, e o projeto sai com cena vazia no formato atual', async () => {
      const { zip, id } = await asVersion1();
      const repo = await freshRepository();
      const report = await importBackup(repo, zip);
      expect(report.skipped).toEqual([]);
      expect(report.warnings).toEqual([]);
      const entry = await entryOf(repo, id);
      expect(entry.record.formatVersion).toBe(PROJECT_FORMAT_VERSION);
      expect(entry.record.scene).toEqual({ items: [] });
      expect(entry.health).toEqual({ status: 'ready' });
    });

    it('backup de um formato mais novo que o 2 continua recusado', async () => {
      const { zip } = await asVersion1();
      const newer = rezip(zip, (files) => {
        const manifest = JSON.parse(strFromU8(files['manifest.json']!));
        manifest.formatVersion = 3;
        writeManifest(files, manifest);
      });
      await expect(importBackup(await freshRepository(), newer)).rejects.toMatchObject({ code: 'newer-version' });
    });
  });
});
