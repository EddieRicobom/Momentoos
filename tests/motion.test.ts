import { describe, expect, it } from 'vitest';
import { motionOffset, SCENE_MOTIONS } from '../src/scene/motion';

describe('percursos dos objetos', () => {
  it('começa sem salto, fica perto da origem e não desce da posição salva', () => {
    for (const motion of SCENE_MOTIONS) {
      expect(motionOffset(motion.id, 0, 1, 1, 2)).toEqual([0, 0, 0]);
      for (let time = 0; time < 40; time += 0.2) {
        const [x, y, z] = motionOffset(motion.id, time, 0.5, 1.5, 2);
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThanOrEqual(0.05 + 1e-9);
      }
    }
  });
  it('cria fases diferentes para um conjunto e respeita o tamanho do objeto', () => {
    expect(motionOffset('float', 2, 1, 1, 0)).not.toEqual(motionOffset('float', 2, 1, 1, 2));
    expect(motionOffset('float', 2, 0.1)[2]).toBeLessThan(motionOffset('float', 2, 1)[2]);
    expect(motionOffset('none', 20, 1)).toEqual([0, 0, 0]);
  });
});
