import { DURATION, fadeIn, fadeUp, pageTransition, pressable, spring, staggerChildren } from '../../src/lib/motion';

// Guard rails for the motion rules: transform/opacity only, <=400ms, springs, presses >= 0.95.

const ANIMATABLE = new Set(['opacity', 'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'transition']);

function animatedKeys(variant: unknown): string[] {
  return Object.keys((variant ?? {}) as Record<string, unknown>);
}

describe('motion tokens', () => {
  it('never exceeds 400ms and keeps micro-interactions in 150-250ms', () => {
    expect(DURATION.max).toBeLessThanOrEqual(0.4);
    expect(DURATION.micro).toBeGreaterThanOrEqual(0.15);
    expect(DURATION.micro).toBeLessThanOrEqual(0.25);
    expect(DURATION.standard).toBeGreaterThanOrEqual(0.2);
    expect(DURATION.standard).toBeLessThanOrEqual(0.35);
  });

  it.each([
    ['fadeUp', fadeUp],
    ['fadeIn', fadeIn],
    ['pageTransition', pageTransition],
  ])('%s animates only transform and opacity', (_name, variants) => {
    for (const state of Object.values(variants)) {
      for (const key of animatedKeys(state)) expect(ANIMATABLE.has(key)).toBe(true);
    }
  });

  it('variant durations stay within 400ms', () => {
    for (const variants of [fadeUp, fadeIn, pageTransition]) {
      const show = variants.show as { transition?: { duration?: number } };
      expect(show.transition?.duration ?? 0).toBeLessThanOrEqual(0.4);
    }
  });

  it('uses a spring for interruptible interactions', () => {
    expect(spring).toMatchObject({ type: 'spring' });
    expect(pressable.transition).toBe(spring);
  });

  it('press compresses subtly, never below 0.95', () => {
    expect(pressable.whileTap.scale).toBeLessThan(1);
    expect(pressable.whileTap.scale).toBeGreaterThanOrEqual(0.95);
  });

  it('staggers lists 30-60ms apart', () => {
    const show = staggerChildren().show as { transition: { staggerChildren: number } };
    expect(show.transition.staggerChildren).toBeGreaterThanOrEqual(0.03);
    expect(show.transition.staggerChildren).toBeLessThanOrEqual(0.06);
  });
});
