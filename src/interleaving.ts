/**
 * Topic interleaving helpers: round-robin ordering and adjacent-switch ratio.
 * The ordering heuristic is not a measured retention outcome.
 */

export interface Interleavable {
    id: string;
    topicId: string;
}

/**
 * Reorders a flat list of cards by taking one card from each topic per round.
 */
export function interleaveCards<T extends Interleavable>(cards: T[]): T[] {
    if (cards.length <= 1) return cards;

    // 1. Group by Topic
    const buckets: Record<string, T[]> = {};
    cards.forEach(card => {
        if (!buckets[card.topicId]) buckets[card.topicId] = [];
        buckets[card.topicId]!.push(card);
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
    topicIds.sort((a, b) => buckets[b]!.length - buckets[a]!.length);

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
 * 1.0 = Every adjacent pair has different topics.
 * 0.0 = No adjacent topic changes.
 */
export function calculateInterleavingQuality(sequence: Interleavable[]): number {
    if (sequence.length <= 1) return 1.0;
    
    let switches = 0;
    for (let i = 1; i < sequence.length; i++) {
        if (sequence[i]!.topicId !== sequence[i-1]!.topicId) {
            switches++;
        }
    }
    
    const maxPossibleSwitches = sequence.length - 1;
    return switches / maxPossibleSwitches;
}
