import { describe, expect, it } from 'vitest';
import { describeDiagnostics } from '../src/tracking/targetInfo';

describe('describeDiagnostics', () => {
  it('alvo bom e com variantes: só informa, sem aviso', () => {
    const r = describeDiagnostics({ trackingPoints: 17, variantKeyframes: 21 }, true);
    expect(r.summary).toContain('17 pontos');
    expect(r.summary).toContain('ângulos fortes');
    expect(r.warning).toBeNull();
  });

  it('poucos pontos: avisa com o número e o mínimo recomendado', () => {
    const r = describeDiagnostics({ trackingPoints: 5, variantKeyframes: 21 }, true);
    expect(r.warning).toContain('5');
    expect(r.warning).toContain('8');
    expect(r.warning).toMatch(/tremer ou sumir/);
  });

  it('quase nenhum ponto: avisa que o conteúdo provavelmente não vai fixar', () => {
    const r = describeDiagnostics({ trackingPoints: 0, variantKeyframes: 21 }, true);
    expect(r.warning).toMatch(/não vai fixar/);
    expect(r.summary).toContain('0 pontos');
    expect(describeDiagnostics({ trackingPoints: 1, variantKeyframes: 21 }, true).summary).toContain('1 ponto de apoio');
  });

  it('sem variantes: sugere recompilar quando há foto, ou compilar de novo quando não há', () => {
    const withPhoto = describeDiagnostics({ trackingPoints: 20, variantKeyframes: 0 }, true);
    expect(withPhoto.warning).toMatch(/Recompile a partir da foto/);
    const fromFile = describeDiagnostics({ trackingPoints: 20, variantKeyframes: 0 }, false);
    expect(fromFile.warning).toMatch(/Compile a imagem de novo/);
  });

  it('junta os avisos quando há mais de um problema', () => {
    const r = describeDiagnostics({ trackingPoints: 2, variantKeyframes: 0 }, true);
    expect(r.warning).toMatch(/não vai fixar/);
    expect(r.warning).toMatch(/variantes/);
  });
});
