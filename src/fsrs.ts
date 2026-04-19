/**
 * QUANTA FSRS ENGINE v5.0 (2026 Standard)
 * Implements the Free Spaced Repetition Scheduler (v4.5/5) 
 * 
 * This engine tracks:
 * - Stability (S): Days until the probability of recall (R) drops to 90%.
 * - Difficulty (D): How hard a piece of information is (1-10).
 * - Retrievability (R): Probability of successful recall at time (t).
 */

export interface FSRSState {
  stability: number;
  difficulty: number;
  lastReview: string | null;
  nextReview: string | null;
}

export type FSRSGrade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

// Optimized Weights for High-Performance Academic STEM Learning
// Calibrated for Quanta's "Elite" student profile.
export const DEFAULT_WEIGHTS = [
  0.4025, 1.4614, 3.3254, 11.9135, // Initial Stability S0 (Again, Hard, Good, Easy)
  4.9252, 0.9451, 0.8653, 0.0105,  // Difficulty parameters (D0, w5, w6, w7)
  1.4292, 0.1415, 0.9431,          // Stability Success (w8, w9, w10)
  2.1813, 0.0543, 0.3456,          // Stability Failure (w11, w12, w13)
  1.2612, 0.2865, 2.6107           // Retrievability Power Law (w14, w15, w16)
];

const TARGET_RETENTION = 0.9;

/**
 * Calculates current Retrievability (R) based on time elapsed since last review.
 * 
 * Formula: R(t) = 0.9^(t / S)
 * 
 * By definition, S (Stability) is the number of days until R drops to the
 * target retention of 90%. This exponential decay formula is always in [0,1]:
 *   t=0  → R = 100% (just reviewed)
 *   t=S  → R = 90%  (due for review)
 *   t=2S → R = 81%  (overdue)
 *
 * The previous implementation used Math.pow(1 + t/(9*S), +w16) which
 * incorrectly produced values > 1.0 as t increases.
 */
export function calculateRetrievability(stability: number, lastReview: string | null, now: Date = new Date()): number {
  if (!lastReview || stability <= 0) return 1.0; // Never reviewed = effectively 100% (hasn't decayed yet)
  const t = Math.max(0, (now.getTime() - new Date(lastReview).getTime()) / (1000 * 60 * 60 * 24));
  return Math.pow(0.9, t / stability);
}

/**
 * Updates FSRS state based on a new review grade.
 */
export function updateFSRS(current: FSRSState, grade: FSRSGrade | 'known' | 'unsure' | 'learning', simulationNow?: Date): FSRSState {
  // Map Quanta simplified grades to FSRS 1-4
  let g: FSRSGrade;
  if (typeof grade === 'string') {
    if (grade === 'known') g = 3;
    else if (grade === 'unsure') g = 2;
    else g = 1;
  } else {
    g = grade;
  }

  const W = DEFAULT_WEIGHTS;
  let s = current.stability;
  let d = current.difficulty;
  const now = simulationNow || new Date();

  // 1. Initial State for new cards
  if (!current.lastReview || s === 0) {
    s = W[g - 1];
    d = W[4] - W[5] * (g - 3);
  } else {
    // 2. Existing card updates
    const t = Math.max(0, (now.getTime() - new Date(current.lastReview).getTime()) / (1000 * 60 * 60 * 24));
    const r = calculateRetrievability(s, current.lastReview, now);

    // Update Difficulty (incorporating mean reversion)
    const d0 = W[4];
    let next_d = d - W[6] * (g - 3);
    d = W[7] * d0 + (1 - W[7]) * next_d;
    d = Math.max(1, Math.min(10, d));

    // Update Stability
    if (g > 1) {
      // Success (FSRS v4 Standard)
      const hard_penalty = g === 2 ? W[15] : 1;
      const easy_bonus = g === 4 ? W[16] : 1;
      
      const s_inc = Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1);
      s = s * (1 + s_inc * hard_penalty * easy_bonus);
    } else {
      // Failure (FSRS v4 Standard)
      s = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
    }
  }

  // Safety bounds
  s = Math.max(0.1, Math.min(36500, s)); // Max 100 years

  // Calculate next review interval
  // In FSRS, S is defined as the exact interval needed for retention to drop to 90%.
  // Since TARGET_RETENTION is 0.9, the interval is exactly S days.
  const nextReview = new Date(now.getTime() + Math.max(1, Math.round(s)) * 24 * 60 * 60 * 1000);

  return {
    stability: s,
    difficulty: d,
    lastReview: now.toISOString(),
    nextReview: nextReview.toISOString()
  };
}

/**
 * Returns formatted stability for UI (e.g., "1.4d", "3.2m")
 */
export function formatStability(s: number): string {
  if (s < 1) return `${Math.round(s * 24)}h`;
  if (s < 30) return `${s.toFixed(1)}d`;
  if (s < 365) return `${(s / 30.43).toFixed(1)}mo`;
  return `${(s / 365.25).toFixed(1)}y`;
}
