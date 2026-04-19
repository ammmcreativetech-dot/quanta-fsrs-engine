/**
 * QUANTA INTERLEAVING ENGINE v1.0
 * Implements the "Mischeffekt" (Interleaving Effect)
 * 
 * Scientific Basis:
 * Interleaving different topics forces the brain to perform "Discriminative Contrast".
 * Instead of relying on a single mental model for a block (e.g., "all cards are math"),
 * the learner must retrieve the correct context for each card, leading to 60%+ 
 * better long-term retention compared to blocked learning.
 */

export interface Interleavable {
    id: string;
    topicId: string;
}

/**
 * Reorders a flat list of cards to maximize topic diversity.
 * Uses a Weighted Round-Robin Topic Staggering algorithm.
 */
export function interleaveCards<T extends Interleavable>(cards: T[]): T[] {
    if (cards.length <= 1) return cards;

    // 1. Group by Topic
    const buckets: Record<string, T[]> = {};
    cards.forEach(card => {
        if (!buckets[card.topicId]) buckets[card.topicId] = [];
        buckets[card.topicId].push(card);
    });

    const topicIds = Object.keys(buckets);
    if (topicIds.length <= 1) {
        // If only one topic, we can't "interleave" topics, 
        // but we return the original (likely FSRS-sorted or random) list.
        return cards;
    }

    const result: T[] = [];
    const totalCards = cards.length;
    
    // Sort buckets by size descending to handle the "Big Topic" problem first
    topicIds.sort((a, b) => buckets[b].length - buckets[a].length);

    /**
     * Staggering Strategy:
     * We pick one card from each topic in order.
     * If a topic is empty, we skip it.
     */
    while (result.length < totalCards) {
        let addedInRound = false;
        for (const topicId of topicIds) {
            const bucket = buckets[topicId];
            if (bucket && bucket.length > 0) {
                result.push(bucket.shift()!);
                addedInRound = true;
            }
        }
        if (!addedInRound) break; // Safety break
    }

    return result;
}

/**
 * Calculates the "Interleaving Quality" of a sequence.
 * 1.0 = Perfect alternation.
 * 0.0 = Purely blocked (Topic A, then B, then C).
 */
export function calculateInterleavingQuality(sequence: Interleavable[]): number {
    if (sequence.length <= 1) return 1.0;
    
    let switches = 0;
    for (let i = 1; i < sequence.length; i++) {
        if (sequence[i].topicId !== sequence[i-1].topicId) {
            switches++;
        }
    }
    
    const maxPossibleSwitches = sequence.length - 1;
    return switches / maxPossibleSwitches;
}
