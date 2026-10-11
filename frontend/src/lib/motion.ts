import type { Transition, Variants } from 'framer-motion';

/*
 * Motion tokens. Rules (enforced app-wide):
 *  - Animate transform and opacity only — never width/height/margin/padding.
 *  - Micro-interactions 150-250ms, standard transitions 200-350ms, nothing over 400ms.
 *  - Springs for anything interruptible (they carry velocity); a strong ease-out curve otherwise.
 *  - Press = scale 0.97 (never below 0.95). Hover is instant-on, eases out over ~150ms (see .hover-instant).
 *  - Lists stagger 30-60ms; foreground content enters after its container.
 */

/** Strong ease-out: fast start, gentle settle — reads as responsive. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const DURATION = {
  micro: 0.16,
  standard: 0.26,
  max: 0.4,
} as const;

/** Snappy spring for interruptible UI (nav indicator, toggles, presses). */
export const spring: Transition = { type: 'spring', stiffness: 400, damping: 30 };

/** Softer spring for larger surfaces (cards, panels). */
export const springSoft: Transition = { type: 'spring', stiffness: 300, damping: 32 };

export const pressable = {
  whileTap: { scale: 0.97 },
  transition: spring,
} as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.standard, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.max, ease: EASE_OUT } },
};

/** Container that staggers its children `each` seconds apart after `delay`. */
export function staggerChildren(each = 0.045, delay = 0.08): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: each, delayChildren: delay } },
  };
}

/** Route change: content settles in place (no exit animation, so navigation never waits). */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.standard, ease: EASE_OUT } },
};
