import { describe, expect, it } from 'vitest';
import { clampPositionToTarget } from '../src/scene/picking';

describe('clampPositionToTarget', () => {
  it('mantém as bordas do objeto dentro do alvo', () => {
    expect(clampPositionToTarget(0.8, -0.8, 0.2, 0.1, 0.75)).toEqual([0.3, -0.275]);
  });

  it('centraliza um objeto maior que a superfície disponível', () => {
    expect(clampPositionToTarget(0.3, 0.3, 0.6, 0.5, 0.75)).toEqual([0, 0]);
  });
});
