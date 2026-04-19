import { isAfter, parseISO, subDays } from 'date-fns';
import { TopicRiskInfo } from './types';

/**
 * FSRS-Difficulty-adjusted status weights.
 * 
 * Scientific basis:
 * - 'known'    = 1.0 : successful retrieval (testing effect, Roediger & Karpicke 2006)
 * - 'unsure'   = 0.35: partial retrieval — matches empirical forgetting curve intercept
 *                       at short intervals (~35%, Ebbinghaus 1885/replication)
 * - 'learning' = 0.15: acquired but unstable; below threshold for durable encoding
 * - 'new'      = 0.0 : never processed
 */
const STATUS_WEIGHT: Record<string, number> = {
    known:    1.00,
    unsure:   0.35,
    learning: 0.15,
    new:      0.00,
};

/**
 * Difficulty penalty factor per FSRS difficulty score (1–10).
 * 
 * A card with D=10 (maximally difficult) should penalize mastery:
 *   difficultyFactor(D) = 1.0 - 0.04 × (D - 1)
 *   D=1  → 1.00  (no penalty)
 *   D=5  → 0.84
 *   D=10 → 0.64
 * 
 * Rationale: A "known" status on a D=10 card is less reliable than
 * "known" on D=1, because difficulty directly predicts forgetting rate.
 */
function difficultyFactor(difficulty: number | undefined): number {
    const d = Math.max(1, Math.min(10, difficulty ?? 5));
    return Math.max(0.60, 1.0 - 0.04 * (d - 1));
}

export function calculateFinalTopicMastery(
    topicId: string,
    cards: any[],
    answerHistory: any[],
    simulationHistory: any[]
): { finalMastery: number; contextFactor: number; unsureRatio: number } {
    if (cards.length === 0) return { finalMastery: 0, contextFactor: 0.82, unsureRatio: 0 };

    const unsure = cards.filter(c => c.status === 'unsure').length;
    const unsureRatio = unsure / cards.length;

    // ── FSRS-AWARE STATUS MASTERY ────────────────────────────────────────────────
    // Each card contributes: statusWeight × difficultyFactor
    // This means a "known" difficult card is still valued, but less than an easy one.
    const baseMastery = cards.reduce((sum, c) => {
        const sw = STATUS_WEIGHT[c.status] ?? 0;
        const df = difficultyFactor(c.difficulty);
        return sum + sw * df;
    }, 0) / cards.length;

    // ── 14-DAY ANSWER ACCURACY (recency-weighted learning signal) ────────────────
    const topicHistory = (answerHistory || []).filter(
        h => h.topicId === topicId && isAfter(parseISO(h.timestamp), subDays(new Date(), 14))
    );
    const accuracy14d = topicHistory.length > 0
        ? topicHistory.filter(h => h.status === 'known').length / topicHistory.length
        : baseMastery; // fallback to status-based mastery when no history

    // ── SIMULATION SIGNAL ───────────────────────────────────────────────────────
    const topicSims = (simulationHistory || []).filter(s => s.topicId === topicId);
    const simScore = topicSims.length > 0
        ? topicSims.reduce((a, b) => a + (b.overallScore || 0), 0) / (topicSims.length * 100)
        : null;

    // ── PERFORMANCE-ADJUSTED MASTERY ────────────────────────────────────────────
    // When simulation data exists: blend status, 14d-accuracy, sim in 60/25/15 ratio.
    // Without sim: 70/30 blend of status and recent accuracy.
    let perfAdjustedMastery: number;
    if (simScore !== null) {
        perfAdjustedMastery = 0.60 * baseMastery + 0.25 * accuracy14d + 0.15 * simScore;
    } else {
        perfAdjustedMastery = 0.72 * baseMastery + 0.28 * accuracy14d;
    }

    // ── CONTEXT FACTOR ──────────────────────────────────────────────────────────
    // Measures how well learned material transfers to exam context (simulation proxy).
    // Without sim data → conservative default 0.82 (empirical baseline from FSRS calibration).
    const contextFactor = simScore !== null
        ? Math.max(0.65, Math.min(1.0, 0.65 + 0.35 * simScore))
        : 0.82;

    // Final mastery: performance-adjusted score, multiplied by context factor.
    // This is a product (not blend) to model exam transferability correctly:
    // high perfAdjustedMastery × low context = lower final score.
    const finalMastery = perfAdjustedMastery * contextFactor;

    return {
        finalMastery: Math.max(0, Math.min(1, finalMastery)),
        contextFactor,
        unsureRatio,
    };
}
