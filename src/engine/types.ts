import { FSRSState } from '../fsrs';

export interface ExamDetails {
    id: string;
    title: string;
    date: Date;
    topicIds: string[];
    importance: number; 
    difficulty: number; 
    color: string;
    dailyBudget: number; 
    daysPerWeek: number;
    availableWeekdays: string[]; 
    studyPlan?: StudyPlanMetadata;
    createdAt?: any;
    briefing?: any;
}

export interface CriticalGap {
    topicId?: string;
    cardId?: string;
    label: string;
    severity: 'high' | 'medium';
    message: string;
}

export interface ReadinessDetails {
    readinessScore: number;      
    confidenceScore: number;     
    confidenceLabel: string;
    confidenceBreakdown?: {        // Sub-scores for UI breakdown display
        dataVolume: number;
        dataRecency: number;
        breadth: number;
        simValidity: number;
    };
    forecastReadiness: number;   
    topicMastery: number;        
    simPerformance: number;      
    retentionStability: number;  
    coverage: number;            
    contextFactor: number;       
    criticalGaps: CriticalGap[];
    explanation: string;
    loadImpossibilityRatio: number;
}

export interface StudyPlanMetadata {
    generatedAt: string;
    nextReplanAt: string;
    dailyCapacityCards: number;
    targetRetention: number;
    planVersion: number;
    overloadDetected?: boolean;
    theoreticalMinutes?: number;
    readinessDetails?: ReadinessDetails; 
    topicRisk: Record<string, TopicRiskInfo>;
}

export interface TopicRiskInfo {
    mastery: number;
    riskScore: number;
    urgency: number;
    priority: number;
    remainingCards: number;
    dueCards: number;
    overdueCards: number;
    coverage: number;
}

export interface SimulationTask {
    type: 'simulation';
    topicId: string;
    estimatedMinutes: number;
    phase: 1 | 2 | 3 | 4;
}

export interface CalendarDayDoc {
    date: string;
    status: 'active' | 'skipped';
    overloadAccepted?: boolean;
    plannedCards: number;
    plannedMinutes: number;
    reviewCards: number;
    newCards: number;
    simulationTasks: SimulationTask[];
    taskCardIds: string[];
    taskTopicIds: string[];
    generatedAt: string;
    version: number;
    skippedSessionIds?: string[];
    completedSessionIds?: string[]; 
    isSmallSetWarning?: boolean;
    materialCoverageRatio?: number;
    priorities?: Record<string, number>; 
    contextStabilityScore: number;
    contextStabilityInterpretation: string;
    numberOfDistinctExamContexts: number;
    allocation: number;
    cluster: string[];
    isBlockedForStudy?: boolean;
    blockReason?: "exam-day" | "user-pause";
    dayPlanningMode?: "standard" | "exam-day-blocked";
}

export interface SessionGoal {
    primary: string;
    volume: string;
    completion: string;
    onEarlyFinish: string;
}

export interface SessionBlock {
    id: string;
    sessionIndex: number;
    type: 'review' | 'reinforcement' | 'diagnostic' | 'simulation' | 'progress_floor';
    estimatedMinutes: number;
    recommendedMode: string;
    recommendedCardStatuses: string[];
    recommendedTopicIds: string[];
    recommendedCardIds: string[];
    rationale: string;
    goalInfo?: SessionGoal;
}

export type FSRSStats = FSRSState;
