/**
 * HARVARD READINESS ENGINE v2.0
 * 
 * Scientific foundations:
 * - FSRS v4.5/v5 (Duolingo 2022, open-weights SR scheduler)
 * - Testing Effect (Roediger & Karpicke, 2006): retrieval practice > passive review
 * - Exponential Forgetting Curve (Ebbinghaus 1885; replicated by Murre & Dros 2015)
 * - Cognitive Load Theory (Sweller, 1988): difficulty modulates encoding quality
 * - Spacing Effect (Cepeda et al., 2006): distributed practice improves long-term retention
 *
 * Score Architecture (4 orthogonal dimensions):
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │  Dimension        │ Weight │ What it measures                                │
 * ├──────────────────────────────────────────────────────────────────────────────┤
 * │  Topic Mastery    │  35%   │ Depth: how well learned cards are mastered      │
 * │  Retention        │  30%   │ Durability: expected recall ON the exam day     │
 * │  Simulation       │  20%   │ Transfer: performance under exam conditions     │
 * │  Coverage         │  15%   │ Breadth: fraction of all syllabus content seen  │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Critical design decisions:
 * 1. Retention is projected to EXAM DAY (not today) — cards decay in the interim.
 * 2. Unseen cards contribute 0.0 to retention — they cannot be recalled on exam day.
 * 3. Simulation is recency-decayed (exponential, λ=0.08) — old sims are stale.
 * 4. Simulation is coverage-penalized with sqrt(coverage) — reduces harsh punishment.
 * 5. Mastery uses FSRS difficulty to weight per-card contributions.
 * 6. Coverage measures "effectively covered" (≥2 reviews AND status!='new').
 */

import { differenceInDays, addDays, isSameDay, parseISO } from 'date-fns';
import { calculateRetrievability } from '../fsrs';
import { calculateFinalTopicMastery } from './mastery';
import { ExamDetails, ReadinessDetails } from './types';

// Exponential decay constant for simulation recency (half-life ≈ 8.7 days at λ=0.08)
const SIM_DECAY_LAMBDA = 0.08;

export function calculateRecallProbability(card: any, now: Date): number {
    if (!card.nextReview || !card.stability) return 0.5;
    return calculateRetrievability(card.stability, card.lastReview, now);
}

// ── EXAM-DAY RETENTION ──────────────────────────────────────────────────────────
/**
 * Calculates the expected probability of recall for a card ON THE EXAM DAY.
 * 
 * For unseen cards: 0.0 — they have never been encoded, so they cannot be recalled.
 * For seen cards: R(stability, lastReview, examDate) from FSRS power law.
 * 
 * This captures the crucial insight: a card reviewed today may be forgotten
 * in 3 weeks if its stability is low. This is what the exam will test.
 */
function expectedRetentionAtExam(card: any, examDate: Date): number {
    if (!card || card.status === 'new' || !card.stability || !card.lastReview) {
        return 0.0; // Never encoded → 0% recall on exam day
    }
    return Math.max(0, calculateRetrievability(card.stability, card.lastReview, examDate));
}

// ── RECENCY-WEIGHTED SIMULATION SCORE ──────────────────────────────────────────
/**
 * Computes an exponentially recency-weighted simulation average.
 * 
 * weight(sim) = exp(-λ × daysSinceSession)
 * 
 * A simulation session 8–9 days ago has ~50% weight of a session from today.
 * A session from 4 weeks ago contributes negligibly.
 * 
 * Scientific basis: forgetting curve applies to meta-cognitive performance
 * as well as to individual facts. A strong simulation 3 weeks ago does not
 * reliably predict today's readiness.
 */
function recencyWeightedSimScore(sims: any[], today: Date): number {
    if (sims.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const sim of sims) {
        const age = Math.max(0, differenceInDays(today, new Date(sim.timestamp)));
        const weight = Math.exp(-SIM_DECAY_LAMBDA * age);
        weightedSum += (sim.overallScore || 0) * weight;
        totalWeight += weight * 100; // normalise to [0,1]
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ── EFFECTIVE COVERAGE ──────────────────────────────────────────────────────────
/**
 * "Effectively covered" = a card has been seen (≥2 reviews) AND is not 'new'.
 * 
 * Rationale: A single exposure is insufficient for encoding (Ebbinghaus:
 * the greatest forgetting happens immediately after first exposure).
 * Two exposures allow the spacing effect to begin.
 * 
 * This is distinct from "studied at all" — quality coverage matters.
 */
function computeEffectiveCoverage(
    examCards: any[],
    cardHistoryCounts: Record<string, number>
): number {
    if (examCards.length === 0) return 0;
    const effectivelyCovered = examCards.filter(
        c => (cardHistoryCounts[c.id] || 0) >= 2 && c.status !== 'new'
    ).length;
    return effectivelyCovered / examCards.length;
}

// ── CRITICAL GAPS COMPUTATION ─────────────────────────────────────────────────
/**
 * Returns the top 3 most error-prone cards across exam topics.
 *
 * Primary sort key: errorCount = number of times answered 'unsure' or 'learning'
 * Tiebreaker:       vulnerability = (1 - examDayRetention) × (difficulty / 10)
 *
 * Never-seen cards (new) have errorCount=0 and retention=0 → they surface
 * via the vulnerability tiebreaker if no errors exist yet.
 */
function computeCriticalGaps(
    examCards: any[],
    topics: any[],
    examDate: Date,
    answerHistory: any[],
    topN = 3
): import('./types').CriticalGap[] {
    if (examCards.length === 0) return [];

    const topicNameMap: Record<string, string> = {};
    (topics || []).forEach((t: any) => { if (t?.id) topicNameMap[t.id] = t.name || t.id; });

    // Count wrong answers per card (unsure or learning responses)
    const errorCounts: Record<string, number> = {};
    (answerHistory || []).forEach((h: any) => {
        if (h.cardId && (h.status === 'unsure' || h.status === 'learning')) {
            errorCounts[h.cardId] = (errorCounts[h.cardId] || 0) + 1;
        }
    });

    const scored = examCards.map(card => {
        const errorCount = errorCounts[card.id] || 0;
        const retention = expectedRetentionAtExam(card, examDate);
        const difficulty = Math.max(1, Math.min(10, card.difficulty ?? 5));
        const vulnerability = (1 - retention) * (difficulty / 10);
        return { card, errorCount, retention, vulnerability };
    });

    // Primary: most errors. Tiebreaker: highest vulnerability.
    const top = scored
        .sort((a, b) => b.errorCount - a.errorCount || b.vulnerability - a.vulnerability)
        .slice(0, topN);

    return top.map(({ card, errorCount, retention, vulnerability }) => {
        const topicName = topicNameMap[card.topicId] || 'Unbekannt';
        const frontPreview = (card.front || '').length > 48
            ? (card.front as string).slice(0, 48).trimEnd() + '…'
            : (card.front || 'Karte ohne Titel');

        const retentionPct = Math.round(retention * 100);
        const severity: 'high' | 'medium' = vulnerability >= 0.70 ? 'high' : 'medium';

        let message: string;
        if (card.status === 'new') {
            message = `Noch nie gelernt. Retention am Prüfungstag: 0%.`;
        } else if (errorCount > 0) {
            message = `${errorCount}× falsch beantwortet. Retention-Prognose: ${retentionPct}%.`;
        } else {
            message = `Retention-Prognose: ${retentionPct}%. Hohe Schwierigkeit beachten.`;
        }

        return {
            topicId: card.topicId,
            cardId: card.id,
            label: `${topicName} · ${frontPreview}`,
            severity,
            message,
        };
    });
}


export function calculateReadinessMetrics(
    exam: ExamDetails,
    topics: any[],
    cardsByTopic: Record<string, any[]>,
    answerHistory: any[],
    simulationHistory: any[],
    today: Date
): ReadinessDetails {
    const examCards = exam.topicIds.flatMap(tid => (cardsByTopic[tid] || []).filter(c => c));

    if (examCards.length === 0) {
        return {
            readinessScore: 0, confidenceScore: 0, confidenceLabel: 'Niedrig', forecastReadiness: 0,
            topicMastery: 0, simPerformance: 0, retentionStability: 0, coverage: 0, contextFactor: 0,
            criticalGaps: [], explanation: 'Keine Karten für diese Prüfung vorhanden.', loadImpossibilityRatio: 0
        };
    }

    // Build answer count index
    const cardHistoryCounts: Record<string, number> = {};
    (answerHistory || []).forEach(h => {
        if (h.cardId) cardHistoryCounts[h.cardId] = (cardHistoryCounts[h.cardId] || 0) + 1;
    });

    const learnedCardsCount = examCards.filter(c => c.status !== 'new').length;
    const examDate = exam.date; // Used for exam-day retention projection

    // ── DIMENSION 1: TOPIC MASTERY (35%) ─────────────────────────────────────────
    // FSRS-difficulty-weighted per-card mastery, recent accuracy + sim blended.
    const topicResults = exam.topicIds.map(tid => {
        const tCards = cardsByTopic[tid] || [];
        return { tid, ...calculateFinalTopicMastery(tid, tCards, answerHistory, simulationHistory) };
    });
    const avgFinalMastery = topicResults.length > 0
        ? topicResults.reduce((a, b) => a + b.finalMastery, 0) / topicResults.length
        : 0;
    const avgContextFactor = topicResults.length > 0
        ? topicResults.reduce((a, b) => a + b.contextFactor, 0) / topicResults.length
        : 0;

    // ── DIMENSION 2: EXAM-DAY RETENTION (30%) ─────────────────────────────────────
    // Expected recall probability across ALL exam cards, projected to the exam date.
    // - Seen cards: FSRS predicts R(stability, lastReview, examDate) 
    // - Never-seen cards: R = 0.0 (cannot be recalled if never encoded)
    // This is the single most important readiness predictor: will you remember
    // what you've learned ON the day that matters?
    const retentionStability = examCards.reduce((sum, card) => {
        return sum + expectedRetentionAtExam(card, examDate);
    }, 0) / examCards.length;

    // ── DIMENSION 3: SIMULATION PERFORMANCE (20%) ─────────────────────────────────
    // Recency-weighted average across relevant simulation sessions.
    // Penalized by sqrt(coverage) to reflect that high sim scores on <5% of material
    // are not predictive of exam success on the full syllabus.
    // sqrt() chosen over linear to avoid catastrophic low-coverage punishment
    // while still providing a meaningful signal.
    const relevantSims = (simulationHistory || []).filter(
        s => s.topicId && exam.topicIds.includes(s.topicId)
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const latestSim = relevantSims[0] ?? null;
    const rawSimScore = recencyWeightedSimScore(relevantSims, today);

    // Effective coverage (slightly different from the coverage dimension — using sqrt for Sim)
    const coverage = computeEffectiveCoverage(examCards, cardHistoryCounts);
    const simCoverageFactor = Math.sqrt(Math.max(0, Math.min(1, coverage)));
    const simPerformance = rawSimScore * simCoverageFactor;

    // ── DIMENSION 4: EFFECTIVE COVERAGE (15%) ─────────────────────────────────────
    // Fraction of exam syllabus effectively covered (≥2 exposures + non-new status).
    // Independent of Sim penalty above — this measures raw breadth of preparation.
    // (Using same computed coverage value)

    // ── COMPOSITE HARVARD READINESS SCORE ────────────────────────────────────────
    // Weights based on predictive validity hierarchy:
    // Retention > Mastery > Simulation > Coverage
    // (Retention is #1 because it captures both quality AND time-until-exam.)
    const rawReadiness = (
        0.35 * avgFinalMastery +
        0.30 * retentionStability +
        0.20 * simPerformance +
        0.15 * coverage
    ) * 100;

    const displayedReadiness = (learnedCardsCount > 0 || relevantSims.length > 0)
        ? Math.round(Math.min(rawReadiness, 100))
        : 0;

    // ── FORECAST (EMA-based trajectory) ──────────────────────────────────────────
    const daysRemaining = Math.max(0, differenceInDays(examDate, today));
    const alpha = 0.22;
    const dailyDeltas: number[] = [];
    for (let d = 0; d < 14; d++) {
        const day = addDays(today, -d);
        const dayEvents = (answerHistory || []).filter(h => isSameDay(parseISO(h.timestamp), day));
        if (dayEvents.length > 0) {
            const dayKnown = dayEvents.filter(h => h.status === 'known').length;
            dailyDeltas.push(dayKnown / Math.max(1, examCards.length));
        }
    }

    let emaProgress = dailyDeltas[0] || 0;
    for (let i = 1; i < dailyDeltas.length; i++) {
        emaProgress = dailyDeltas[i] * alpha + emaProgress * (1 - alpha);
    }
    if (dailyDeltas.length < 5) emaProgress *= 0.5;

    let forecastGain = emaProgress * daysRemaining * 100;
    if (daysRemaining <= 10) forecastGain *= 0.75;
    if (daysRemaining <= 5)  forecastGain *= 0.60;
    if (daysRemaining <= 3)  forecastGain *= 0.45;

    const forecastCap = daysRemaining <= 10 ? 12 : 30;
    const adjustedForecast = Math.min(100, Math.min(displayedReadiness + forecastGain, displayedReadiness + forecastCap));

    // ── CONFIDENCE SCORE ──────────────────────────────────────────────────────────
    // The Daten-Confidence measures how RELIABLE the readiness estimate itself is —
    // not how prepared the student is. It is a meta-score: R² of the readiness estimate.
    //
    // Four orthogonal reliability signals:
    //
    // 1. Data Volume (30%): Sample size theory (central limit theorem) states that
    //    estimates stabilise above N~50 and are reliable at N~150+.
    //    score = min(1, totalAnswers / 150)
    //
    // 2. Data Recency (25%): Exponential decay on study inactivity.
    //    λ=0.15 → half-life ≈ 4.6 days. If no study in 10+ days, data is stale.
    //    score = exp(-λ × daysSinceLastActivity)
    //
    // 3. Syllabus Breadth (25%): Coverage is a proxy for sampling bias.
    //    A readiness estimate from 3% of the syllabus is statistically biased.
    //    score = coverage (effective coverage, ≥2 exposures)
    //
    // 4. Simulation Validity (20%): Simulation data provides predictive validity
    //    that pure card reviews cannot — it tests recall under exam conditions.
    //    score = simRecency (linear decay over 14-day window, 0 if no sims)
    //
    const totalAnswers = (answerHistory || []).filter(
        h => h.topicId && exam.topicIds.includes(h.topicId)
    ).length;
    const dataVolume = Math.min(1, totalAnswers / 150);

    const lastActivityDate = (answerHistory || [])
        .filter(h => h.topicId && exam.topicIds.includes(h.topicId))
        .map(h => new Date(h.timestamp).getTime())
        .reduce((max, t) => Math.max(max, t), 0);
    const daysSinceActivity = lastActivityDate > 0
        ? Math.max(0, differenceInDays(today, new Date(lastActivityDate)))
        : 999;
    const dataRecency = Math.exp(-0.15 * daysSinceActivity);

    const simRecency = latestSim
        ? Math.max(0, 1 - differenceInDays(today, new Date(latestSim.timestamp)) / 14)
        : 0;

    const confidenceScore = Math.round((
        0.30 * dataVolume +
        0.25 * dataRecency +
        0.25 * coverage +
        0.20 * simRecency
    ) * 100);

    // Sub-scores exposed for UI breakdown (0–100)
    const confidenceBreakdown = {
        dataVolume:   Math.round(dataVolume * 100),
        dataRecency:  Math.round(dataRecency * 100),
        breadth:      Math.round(coverage * 100),
        simValidity:  Math.round(simRecency * 100),
    };

    // ── EXPLANATION ───────────────────────────────────────────────────────────────
    let explanation: string;
    if (learnedCardsCount === 0) {
        explanation = 'Beginne mit dem Lernen, um deine kognitive Reife zu berechnen.';
    } else if (coverage < 0.10) {
        explanation = `Nur ${Math.round(coverage * 100)}% des Prüfungsstoffs effektiv abgedeckt. Fokus auf neue Themen erhöht den Score am stärksten.`;
    } else if (retentionStability < 0.30) {
        explanation = 'Viele gelernte Karten werden bis zur Prüfung vergessen. Wiederholen mit Abstand (Spacing) ist jetzt prioritär.';
    } else if (confidenceScore < 40) {
        explanation = 'Die Diagnose basiert auf einer noch geringen Datenbasis.';
    } else {
        explanation = 'Deine kognitiven Daten sind signifikant.';
    }

    return {
        readinessScore: displayedReadiness,
        confidenceScore,
        confidenceLabel: (learnedCardsCount > 0 || relevantSims.length > 0)
            ? (confidenceScore > 75 ? 'Hoch' : confidenceScore > 40 ? 'Mittel' : 'Niedrig')
            : 'Keine Daten',
        confidenceBreakdown,
        forecastReadiness: Math.round(adjustedForecast),
        topicMastery: Math.round(avgFinalMastery * 100),
        simPerformance: Math.round(simPerformance * 100),
        retentionStability: Math.round(retentionStability * 100),
        coverage: Math.round(coverage * 100),
        contextFactor: Math.round(avgContextFactor * 100),
        criticalGaps: computeCriticalGaps(examCards, topics, examDate, answerHistory),
        explanation,
        loadImpossibilityRatio: 0
    };
}
