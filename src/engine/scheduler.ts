import { format, differenceInDays, addDays, isBefore, isSameDay, parseISO, isAfter, getDay, startOfDay } from 'date-fns';
import { updateFSRS as fsrsUpdate } from '../fsrs';
import { interleaveCards } from '../interleaving';
import { calculateFinalTopicMastery } from './mastery';
import { calculateReadinessMetrics } from './readiness';
import { ExamDetails, StudyPlanMetadata, TopicRiskInfo, CalendarDayDoc, SessionBlock, SessionGoal } from './types';

const TARGET_RETENTION = 0.9;
const FALLBACK_SECONDS_PER_CARD = 60; 
const MAX_PLANNING_CAP = 600; 
export const SCIENTIFIC_MAX_DAILY_LOAD = 300; 

const WEEKDAY_MAP: Record<number, string> = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday'
};

const DIFFICULTY_MAP: Record<number, number> = {
    1: 1.0, 2: 1.35, 3: 1.85 
};

export const SYNC_CYCLE_MS = 48 * 60 * 60 * 1000;

export function getSyncInfo(anchorDate?: Date) {
    const now = Date.now();
    const base = anchorDate ? startOfDay(anchorDate).getTime() : new Date('2026-03-11T00:00:00Z').getTime();
    const elapsed = now - base;
    const currentCycleStart = base + Math.floor(elapsed / SYNC_CYCLE_MS) * SYNC_CYCLE_MS;
    const nextSyncTimestamp = currentCycleStart + SYNC_CYCLE_MS;
    
    return {
        currentCycleStart: new Date(currentCycleStart).toISOString(),
        nextSyncTimestamp: new Date(nextSyncTimestamp).toISOString(),
        msToNextSync: nextSyncTimestamp - now,
        hasAnchor: !!anchorDate
    };
}

export function generateGlobalStudyPlan({
    exams, topics, cardsByTopic, answerHistory, simulationHistory, globalCapacityMinutes, today = new Date()
}: {
    exams: ExamDetails[]; topics: any[]; cardsByTopic: Record<string, any[]>; answerHistory: any[]; simulationHistory: any[]; globalCapacityMinutes: number; today?: Date;
}) {
    if (!exams || exams.length === 0) return null;

    const durations = (answerHistory || []).map(h => h.duration).filter(d => typeof d === 'number' && d > 0);
    const medianSecondsPerCard = durations.length > 0 
        ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]! 
        : FALLBACK_SECONDS_PER_CARD;
    
    const userMaxCapacity = globalCapacityMinutes || 180;
    
    let maxContexts = 3;
    if (userMaxCapacity <= 90) maxContexts = 1;
    else if (userMaxCapacity <= 150) maxContexts = 2;

    const examResults: Record<string, { studyPlan: StudyPlanMetadata, calendarDays: CalendarDayDoc[] }> = {};
    const allTopicRisk: Record<string, TopicRiskInfo> = {};
    const cardPool: Record<string, any> = {};

    exams.forEach(exam => {
        const currentTopicIds = exam.topicIds || [];
        const diffWeight = DIFFICULTY_MAP[exam.difficulty || 2] || 1.35;

        currentTopicIds.forEach(topicId => {
            const tCards = (cardsByTopic[topicId] || []).filter(c => c);
            const stats = calculateFinalTopicMastery(topicId, tCards, answerHistory, simulationHistory);
            const daysToExam = Math.max(0, differenceInDays(exam.date, today));
            const urgency = Math.exp(-daysToExam / 14);
            
            allTopicRisk[topicId] = {
                mastery: Math.round(stats.finalMastery * 100),
                riskScore: 1 - stats.finalMastery,
                urgency,
                priority: (1 - stats.finalMastery) * urgency * (exam.importance || 2) * diffWeight,
                remainingCards: tCards.filter(c => c.status === 'new').length,
                dueCards: tCards.filter(c => c.nextReview && isBefore(parseISO(c.nextReview), today)).length,
                overdueCards: tCards.filter(c => c.nextReview && differenceInDays(today, parseISO(c.nextReview)) > 3).length,
                coverage: tCards.length > 0 ? (tCards.filter(c => (answerHistory.filter(h => h.cardId === c.id).length) >= 3).length / tCards.length) : 0
            };

            tCards.forEach(c => {
                if (c && !cardPool[c.id]) {
                    cardPool[c.id] = { 
                        id: c.id, 
                        topicId, 
                        isNew: c.status === 'new', 
                        isUnsure: c.status === 'unsure', 
                        status: c.status, 
                        examIds: [exam.id], 
                        fsrs: { 
                            stability: c.stability || 0.5, 
                            nextReview: c.nextReview || null,
                            difficulty: c.difficulty || 0.3
                        } 
                    };
                } else if (c) {
                    cardPool[c.id].examIds.push(exam.id);
                }
            });
        });
    });

    const furthestExamDate = exams.reduce((max, e) => isAfter(e.date, max) ? e.date : max, today);
    const dynamicHorizon = differenceInDays(furthestExamDate, today) + 1;

    const globalSchedule: Record<string, CalendarDayDoc[]> = {}; 
    exams.forEach(e => globalSchedule[e.id] = []);

    const simulatedCardStates = { ...cardPool };
    const detailedPlanningHorizonDays = 2;

    for (let i = 0; i <= dynamicHorizon; i++) {
        const currentDate = addDays(today, i);
        const dayId = format(currentDate, 'yyyy-MM-dd');
        const weekdayName = WEEKDAY_MAP[getDay(currentDate)]!;
        const isDetailedDay = i < detailedPlanningHorizonDays;

        if (exams.some(ex => isSameDay(currentDate, ex.date))) {
            exams.forEach(ex => {
                if (!isAfter(currentDate, ex.date)) {
                    globalSchedule[ex.id].push({
                        date: dayId, status: 'active', plannedCards: 0, plannedMinutes: 0, reviewCards: 0, newCards: 0,
                        simulationTasks: [], taskCardIds: [], taskTopicIds: [], generatedAt: today.toISOString(), version: 1,
                        isBlockedForStudy: true, blockReason: "exam-day", dayPlanningMode: "exam-day-blocked",
                        contextStabilityScore: 0, contextStabilityInterpretation: "Prüfungstag",
                        numberOfDistinctExamContexts: 0, allocation: 0, cluster: []
                    });
                }
            });
            continue;
        }

        const activeExamsForDay = [...exams].filter(ex => !isAfter(currentDate, ex.date) && !isSameDay(currentDate, ex.date))
            .filter(ex => {
                const daysRemaining = differenceInDays(ex.date, currentDate);
                const isCrunchTime = daysRemaining <= 5;
                const isAllowedDay = ex.availableWeekdays && ex.availableWeekdays.includes(weekdayName);
                return isCrunchTime || isAllowedDay;
            })
            .sort((a, b) => {
                const pA = a.topicIds.reduce((max, tid) => Math.max(max, allTopicRisk[tid]?.priority || 0), 0);
                const pB = b.topicIds.reduce((max, tid) => Math.max(max, allTopicRisk[tid]?.priority || 0), 0);
                return pB - pA;
            }).slice(0, maxContexts);

        const currentDayDocs: Record<string, CalendarDayDoc> = {};
        let totalDayMins = 0;

        activeExamsForDay.forEach(ex => {
            const daysRemaining = differenceInDays(ex.date, currentDate);
            const totalPrepWindow = Math.max(1, differenceInDays(ex.date, today));
            const timeProgress = 1 - (daysRemaining / totalPrepWindow);
            const topicRisk = allTopicRisk[ex.topicIds[0]];
            
            let simShare = 0;
            const currentMastery = topicRisk?.mastery || 0;

            if (currentMastery < 60) {
                simShare = (topicRisk?.coverage || 0) < 0.20 ? 0 : 0.20; 
            } else if (daysRemaining <= 5) {
                simShare = currentMastery >= 80 ? 0.85 : 0.50;
            } else if ((topicRisk?.coverage || 0) >= 0.30) {
                const timeWeight = Math.max(0, (timeProgress - 0.20) / 0.80);
                simShare = 0.15 + (timeWeight * 0.35); 
            }

            const simMinutes = Math.round((ex.dailyBudget * simShare) / 5) * 5;
            const cardBudget = Math.max(0, ex.dailyBudget - simMinutes);

            const candidates = Object.values(simulatedCardStates).filter(c => {
                if (!c.examIds.includes(ex.id)) return false;
                const isCrisis = currentMastery < 75 && daysRemaining <= 14;
                let lookaheadDays = isCrisis ? 7 : (daysRemaining <= 7 ? 3 : 1);
                const simulatedNextReview = c.fsrs.nextReview ? parseISO(c.fsrs.nextReview) : null;
                const isDueSoon = simulatedNextReview && isBefore(simulatedNextReview, addDays(currentDate, lookaheadDays));
                return isDueSoon || c.isNew || daysRemaining <= 7;
            }).sort((a, b) => a.fsrs.stability - b.fsrs.stability);

            let dayDoc: CalendarDayDoc = { 
                date: dayId, status: 'active', plannedCards: 0, plannedMinutes: 0, reviewCards: 0, newCards: 0, 
                simulationTasks: [], taskCardIds: [], taskTopicIds: [], generatedAt: today.toISOString(), version: 1,
                contextStabilityScore: 0, contextStabilityInterpretation: "", numberOfDistinctExamContexts: 0, allocation: 0, cluster: []
            };
            
            let accumulatedCardMins = 0;
            for (const card of candidates) {
                if (accumulatedCardMins < cardBudget) {
                    if (card.isNew && daysRemaining <= 3 && currentMastery < 70) continue;
                    if (isDetailedDay) {
                        dayDoc.taskCardIds.push(card.id);
                        if (!dayDoc.taskTopicIds.includes(card.topicId)) dayDoc.taskTopicIds.push(card.topicId);
                    }
                    dayDoc.plannedCards++;
                    if (card.isNew) dayDoc.newCards++; else dayDoc.reviewCards++;
                    accumulatedCardMins += (medianSecondsPerCard / 60);

                    const fsrsUpdateResult = fsrsUpdate({
                        difficulty: card.fsrs.difficulty,
                        stability: card.fsrs.stability,
                        lastReview: card.fsrs.lastReview || currentDate.toISOString(),
                        nextReview: card.fsrs.nextReview
                    }, 'known', currentDate);
                    
                    simulatedCardStates[card.id] = { ...card, isNew: false, fsrs: { ...fsrsUpdateResult } };
                }
            }

            const effectiveCardMinutes = Math.ceil(accumulatedCardMins);
            const totalRequiredMinutes = effectiveCardMinutes + simMinutes;

            if (totalRequiredMinutes > 0) {
                dayDoc.plannedMinutes = totalRequiredMinutes;
                if (simMinutes > 0 && ex.topicIds.length > 0) {
                    dayDoc.simulationTasks.push({ type: 'simulation', topicId: ex.topicIds[0], estimatedMinutes: simMinutes, phase: daysRemaining <= 5 ? 4 : 2 });
                }
                currentDayDocs[ex.id] = dayDoc;
                totalDayMins += totalRequiredMinutes;
            }
        });

        const todayClusterIds = Object.keys(currentDayDocs);
        if (todayClusterIds.length > 1) {
            const allCardIdsForDay: { id: string, topicId: string }[] = [];
            Object.values(currentDayDocs).forEach(doc => {
                doc.taskCardIds.forEach(cid => {
                    const topicId = doc.taskTopicIds.find(tid => cid.startsWith(tid)) || doc.taskTopicIds[0] || '';
                    allCardIdsForDay.push({ id: cid, topicId });
                });
            });
            const interleaved = interleaveCards(allCardIdsForDay);
            const interleavedIds = interleaved.map(c => c.id);
            Object.values(currentDayDocs).forEach(doc => {
                doc.taskCardIds = interleavedIds.filter(id => doc.taskCardIds.includes(id));
            });
        }

        const todayClusterTitles = activeExamsForDay.filter(ex => todayClusterIds.includes(ex.id)).map(ex => ex.title);
        Object.entries(currentDayDocs).forEach(([exId, dayDoc]) => {
            dayDoc.allocation = dayDoc.plannedMinutes / (totalDayMins || 1);
            dayDoc.cluster = todayClusterTitles;
            globalSchedule[exId]!.push(dayDoc);
        });
    }

    const syncInfo = getSyncInfo(startOfDay(today));
    exams.forEach(exam => {
        const readinessDetails = calculateReadinessMetrics(exam, topics, cardsByTopic, answerHistory, simulationHistory, today);
        const studyPlan: StudyPlanMetadata = {
            generatedAt: today.toISOString(),
            nextReplanAt: syncInfo.nextSyncTimestamp,
            dailyCapacityCards: Math.floor((MAX_PLANNING_CAP * 60) / medianSecondsPerCard),
            targetRetention: TARGET_RETENTION,
            planVersion: (exam.studyPlan?.planVersion || 0) + 1,
            readinessDetails,
            topicRisk: Object.fromEntries(exam.topicIds.map(tid => [tid, allTopicRisk[tid]!]))
        };
        examResults[exam.id] = { studyPlan, calendarDays: globalSchedule[exam.id] || [] };
    });

    return examResults;
}

export function deriveSessionBlocks(day: CalendarDayDoc, exam: ExamDetails): SessionBlock[] {
    const blocks: SessionBlock[] = [];
    const fullTaskCardIds = [...day.taskCardIds];
    let totalMinutes = day.priorities?.[exam.id] ?? day.plannedMinutes;

    if (totalMinutes <= 0) return [];

    const mastery = exam.studyPlan?.topicRisk[exam.topicIds[0]!]?.mastery || 0;
    const cardMins = totalMinutes - (day.simulationTasks?.reduce((s, sim) => s + sim.estimatedMinutes, 0) || 0);
    const effectiveCardMins = Math.max(0, cardMins);
    
    const numCardBlocks = effectiveCardMins >= 90 ? 3 : (effectiveCardMins >= 45 ? 2 : 1);
    const baseCardBlockMins = numCardBlocks > 0 ? Math.round(effectiveCardMins / numCardBlocks) : 0;
    const cardsPerBlock = numCardBlocks > 0 ? Math.ceil(fullTaskCardIds.length / numCardBlocks) : 0;

    const addCardBlocks = () => {
        for (let i = 1; i <= numCardBlocks; i++) {
            const startIdx = (i - 1) * cardsPerBlock;
            const endIdx = i === numCardBlocks ? fullTaskCardIds.length : startIdx + cardsPerBlock;
            const blockCardIds = fullTaskCardIds.slice(startIdx, endIdx);
            if (blockCardIds.length === 0) continue;

            let blockType: 'review' | 'reinforcement' | 'progress_floor' = 'review';
            let mode = "neuro";
            let statuses = ["known", "unsure", "learning"];
            let primaryGoal = "";
            let rationale = "";
            let volumeText = `${blockCardIds.length} Konzepte`;

            if (numCardBlocks === 1) {
                primaryGoal = "Basissicherung deines Wissens.";
                rationale = "Kompakter Durchlauf zur Erhaltung der Gedächtnisstabilität.";
            } else if (i === 1) {
                primaryGoal = "Stabilisierung deines Fundaments.";
                rationale = "Abgleich des Kernwissens mit dem FSRS-Gedächtnis-Modell.";
                volumeText = `Fokus auf ${blockCardIds.length} fällige Wiederholungen`;
            } else if (i === 2 && numCardBlocks >= 3) {
                blockType = 'reinforcement'; mode = "hardest"; statuses = ["learning", "unsure"];
                primaryGoal = "Gezielter Lückenschluss."; rationale = "Intensivtraining für Konzepte mit hohem Fehlerpotential.";
                volumeText = `Deep-Work an ${blockCardIds.length} Schwachstellen`;
            } else if (i === numCardBlocks) {
                blockType = 'progress_floor'; mode = "random"; statuses = ["new", "learning"];
                primaryGoal = "Erweiterung des Wissens-Horizonts."; rationale = "Integration von neuem Material.";
                volumeText = ` Aufbau von ${blockCardIds.length} neuen kognitiven Pfaden`;
            }

            blocks.push({
                id: `b${i}-${day.date}`, sessionIndex: blocks.length + 1, type: blockType, estimatedMinutes: baseCardBlockMins, 
                recommendedMode: mode, recommendedCardStatuses: statuses, recommendedTopicIds: day.taskTopicIds, 
                recommendedCardIds: blockCardIds, rationale,
                goalInfo: { primary: primaryGoal, volume: volumeText, completion: "Erfüllt nach Abschluss der geplanten Zyklen.", onEarlyFinish: "Gewonnene Zeit ist regenerative Zeit." }
            });
        }
    };

    const addSimBlocks = () => {
        (day.simulationTasks || []).forEach((sim, idx) => {
            const simMins = Math.round(sim.estimatedMinutes * (totalMinutes / (day.plannedMinutes || 1)));
            if (simMins > 0) {
                blocks.push({
                    id: `sim-${idx}-${day.date}`, sessionIndex: blocks.length + 1, type: 'simulation', estimatedMinutes: simMins,
                    recommendedMode: 'tutor', recommendedCardStatuses: [], recommendedTopicIds: [sim.topicId], recommendedCardIds: [],
                    rationale: "Gezielte Prüfungssimulation zur Validierung deines Verständnisses.",
                    goalInfo: {
                        primary: "Abrufleistung unter Prüfungsnähe validieren.",
                        volume: "1 Simulationsblock",
                        completion: "Erfüllt, wenn Konzepte erklärt wurden.",
                        onEarlyFinish: "Nutze die Zeit für kognitive Rekonsolidierung."
                    }
                });
            }
        });
    };

    if (mastery < 65) {
        addCardBlocks();
        addSimBlocks();
    } else {
        addSimBlocks();
        addCardBlocks();
    }

    const finalTotalMins = blocks.reduce((s, b) => s + b.estimatedMinutes, 0);
    if (finalTotalMins < totalMinutes && blocks.length > 0) {
        blocks[blocks.length - 1]!.estimatedMinutes += (totalMinutes - finalTotalMins);
    }

    return blocks;
}
