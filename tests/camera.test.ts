import { describe, expect, it } from 'vitest';
import { classifyCameraError, type CameraEnvironment } from '../src/tracking/camera';

const OK_ENV: CameraEnvironment = { isSecureContext: true, hasMediaDevices: true };

function domError(name: string): { name: string } {
  return { name };
}

describe('classifyCameraError', () => {
  it('contexto inseguro (HTTP) é câmera indisponível e orienta usar HTTPS', () => {
    const result = classifyCameraError(null, { isSecureContext: false, hasMediaDevices: false });
    expect(result.problem).toBe('camera-unavailable');
    expect(result.message).toMatch(/HTTPS/);
  });

  it('contexto inseguro tem prioridade sobre o erro original', () => {
    const result = classifyCameraError(domError('NotAllowedError'), {
      isSecureContext: false,
      hasMediaDevices: true,
    });
    expect(result.problem).toBe('camera-unavailable');
  });

  it('navegador sem getUserMedia é câmera indisponível', () => {
    const result = classifyCameraError(null, { isSecureContext: true, hasMediaDevices: false });
    expect(result.problem).toBe('camera-unavailable');
  });

  it.each(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])(
    '%s é permissão negada',
    (name) => {
      const result = classifyCameraError(domError(name), OK_ENV);
      expect(result.problem).toBe('permission-denied');
      expect(result.message).toMatch(/permiss/i);
    },
  );

  it.each([
    ['NotFoundError', /Nenhuma câmera/],
    ['DevicesNotFoundError', /Nenhuma câmera/],
    ['NotReadableError', /em uso/],
    ['TrackStartError', /em uso/],
  ])('%s é câmera indisponível', (name, pattern) => {
    const result = classifyCameraError(domError(name), OK_ENV);
    expect(result.problem).toBe('camera-unavailable');
    expect(result.message).toMatch(pattern);
  });

  it('erro desconhecido é indisponível e cita o nome para diagnóstico', () => {
    const result = classifyCameraError(domError('AbortError'), OK_ENV);
    expect(result.problem).toBe('camera-unavailable');
    expect(result.message).toContain('AbortError');
  });

  it('aceita valores que não são objetos de erro', () => {
    expect(classifyCameraError(undefined, OK_ENV).problem).toBe('camera-unavailable');
    expect(classifyCameraError('falhou', OK_ENV).problem).toBe('camera-unavailable');
    expect(classifyCameraError(42, OK_ENV).problem).toBe('camera-unavailable');
  });
});
