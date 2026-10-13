import { describe, expect, it } from 'vitest';
import {
  ITEM_PATH_EXTENSIONS,
  classifyFile,
  defaultItemName,
  itemExtension,
  matchesSignature,
} from '../src/storage/itemFiles';
import { ITEM_MIME } from '../src/storage/model';
import { signedBytes } from './helpers';

describe('classifyFile', () => {
  it.each([
    ['foto.png', 'image', 'image/png'],
    ['foto.JPG', 'image', 'image/jpeg'],
    ['foto.jpeg', 'image', 'image/jpeg'],
    ['foto.webp', 'image', 'image/webp'],
    ['anim.gif', 'gif', 'image/gif'],
    ['clipe.mp4', 'video', 'video/mp4'],
    ['clipe.m4v', 'video', 'video/mp4'],
    ['clipe.webm', 'video', 'video/webm'],
    ['bicho.glb', 'model', 'model/gltf-binary'],
    ['som.mp3', 'audio', 'audio/mpeg'],
    ['som.ogg', 'audio', 'audio/ogg'],
    ['som.wav', 'audio', 'audio/wav'],
    ['som.m4a', 'audio', 'audio/mp4'],
  ])('%s → %s', (name, type, mimeType) => {
    expect(classifyFile(name)).toEqual({ ok: true, type, mimeType });
  });

  it('a extensão manda sobre o MIME informado (glb costuma chegar sem tipo)', () => {
    expect(classifyFile('bicho.glb', '')).toMatchObject({ ok: true, type: 'model' });
    expect(classifyFile('bicho.glb', 'application/octet-stream')).toMatchObject({ ok: true, type: 'model' });
    expect(classifyFile('foto.png', 'video/mp4')).toMatchObject({ ok: true, type: 'image' });
  });

  it('sem extensão conhecida, usa o MIME informado quando ele é permitido', () => {
    expect(classifyFile('arquivo', 'image/webp')).toEqual({ ok: true, type: 'image', mimeType: 'image/webp' });
    expect(classifyFile('arquivo', 'AUDIO/MPEG')).toMatchObject({ ok: true, type: 'audio' });
  });

  it.each(['gltf', 'mov', 'avi', 'mkv', 'fbx', 'obj', 'heic', 'svg'])('.%s tem mensagem específica', (ext) => {
    const result = classifyFile(`x.${ext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(20);
  });

  it('formato desconhecido é recusado listando o que é aceito', () => {
    const result = classifyFile('dados.xyz', 'text/plain');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/GLB/);
  });

  it('nome sem ponto e sem MIME é recusado', () => {
    expect(classifyFile('semextensao').ok).toBe(false);
  });
});

describe('matchesSignature', () => {
  it.each(Object.keys(ITEM_MIME).flatMap((t) => ITEM_MIME[t as keyof typeof ITEM_MIME]).filter((m) => m !== 'audio/mp4' && m !== 'audio/webm'))(
    'aceita bytes reais de %s',
    (mime) => {
      expect(matchesSignature(mime, new Uint8Array(signedBytes(mime)))).toBe(true);
    },
  );

  it('audio/mp4 e audio/webm usam as assinaturas de mp4 e webm', () => {
    expect(matchesSignature('audio/mp4', new Uint8Array(signedBytes('video/mp4')))).toBe(true);
    expect(matchesSignature('audio/webm', new Uint8Array(signedBytes('video/webm')))).toBe(true);
  });

  it('mp3 sem ID3 aceita quadro MPEG (FF FB)', () => {
    expect(matchesSignature('audio/mpeg', new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe(true);
    expect(matchesSignature('audio/mpeg', new Uint8Array([0xff, 0x00, 0x90, 0]))).toBe(false);
  });

  it('rejeita arquivo com extensão trocada (PNG dizendo ser GLB e vice-versa)', () => {
    expect(matchesSignature('model/gltf-binary', new Uint8Array(signedBytes('image/png')))).toBe(false);
    expect(matchesSignature('image/png', new Uint8Array(signedBytes('model/gltf-binary')))).toBe(false);
    expect(matchesSignature('image/gif', new Uint8Array(signedBytes('image/jpeg')))).toBe(false);
  });

  it('RIFF: WebP e WAV não se confundem', () => {
    expect(matchesSignature('image/webp', new Uint8Array(signedBytes('audio/wav')))).toBe(false);
    expect(matchesSignature('audio/wav', new Uint8Array(signedBytes('image/webp')))).toBe(false);
  });

  it('arquivos curtos demais e MIME desconhecido não passam nem estouram', () => {
    expect(matchesSignature('image/png', new Uint8Array([0x89]))).toBe(false);
    expect(matchesSignature('image/gif', new Uint8Array([]))).toBe(false);
    expect(matchesSignature('video/mp4', new Uint8Array([0, 0, 0]))).toBe(false);
    expect(matchesSignature('text/plain', new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('extensões e nomes', () => {
  it('itemExtension cobre todos os MIMEs permitidos e cai em bin no resto', () => {
    for (const mimes of Object.values(ITEM_MIME)) {
      for (const mime of mimes) expect(itemExtension(mime)).not.toBe('bin');
    }
    expect(itemExtension('application/x-qualquer')).toBe('bin');
  });

  it('as extensões aceitas em caminhos de backup incluem todas as de itemExtension', () => {
    for (const mimes of Object.values(ITEM_MIME)) {
      for (const mime of mimes) expect(ITEM_PATH_EXTENSIONS).toContain(itemExtension(mime));
    }
    expect(ITEM_PATH_EXTENSIONS).toContain('bin');
    expect(ITEM_PATH_EXTENSIONS).not.toContain('exe');
  });

  it('defaultItemName tira a extensão e nunca devolve vazio', () => {
    expect(defaultItemName('meu bicho.final.glb')).toBe('meu bicho.final');
    expect(defaultItemName('foto.png')).toBe('foto');
    expect(defaultItemName('.png')).toBe('Item');
    expect(defaultItemName('   .mp3')).toBe('Item');
    expect(defaultItemName('semponto')).toBe('semponto');
  });
});
