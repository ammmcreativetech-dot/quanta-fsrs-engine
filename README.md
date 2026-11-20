# Quanta FSRS Engine

MIT-licensed TypeScript source for flashcard review scheduling, exam-aware study plans, topic interleaving and heuristic readiness indicators.

Maintained by Amos Matzke at AM Creative Tech UG (haftungsbeschränkt), the developer and operator of [Quanta Study](https://quanta-study.de/en). These historical standalone sources are separate from the current learning application's ts-fsrs-based FSRS-6 scheduling.

## Source layout

| Module | Main exports and purpose |
| --- | --- |
| `src/fsrs.ts` | `updateFSRS`, `calculateRetrievability`, `formatStability`, `DEFAULT_WEIGHTS`; custom review state and recall estimates. |
| `src/interleaving.ts` | `interleaveCards`, `calculateInterleavingQuality`; round-robin topic ordering and adjacent-switch ratio. |
| `src/engine/scheduler.ts` | `generateGlobalStudyPlan`, `deriveSessionBlocks`, `getSyncInfo`; exam-date and capacity-aware plans. |
| `src/engine/mastery.ts` | `calculateFinalTopicMastery`; combine configured status, difficulty and history weights. |
| `src/engine/readiness.ts` | `calculateReadinessMetrics`, `calculateRecallProbability`; composite planning indicators. |
| `src/engine/types.ts` | Interfaces for exams, calendar days, plans and readiness results. |

## Integration

This repository supplies TypeScript source files. It has no package manifest, compiled distribution or npm release. Integrate the selected source modules into an existing TypeScript project and review their input types and runtime requirements. The `engine` modules import `date-fns`; the basic review and interleaving modules are self-contained.

This example is run from a TypeScript-aware project containing the source checkout:

```ts
import { updateFSRS, calculateRetrievability, type FSRSState } from './src/fsrs';
import { interleaveCards } from './src/interleaving';

const now = new Date('2026-11-20T12:00:00Z');
const initial: FSRSState = {
  stability: 0,
  difficulty: 5,
  lastReview: null,
  nextReview: null,
};
const reviewed = updateFSRS(initial, 'known', now);
const recall = calculateRetrievability(reviewed.stability, reviewed.lastReview, now);
const ordered = interleaveCards([
  { id: 'a1', topicId: 'a' },
  { id: 'a2', topicId: 'a' },
  { id: 'b1', topicId: 'b' },
]);
```

Persist learner/card state in the integrating application and provide the module-specific exam, topic, answer-history and simulation data when using planning functions. There is no package-level install command or single engine entry point in this source collection.

## Model interpretation

The review module retains a custom 17-value parameter vector and the exponential recall estimate `0.9 ** (elapsedDays / stability)`. The repository does not establish conformance to an upstream FSRS release or calibration for a particular subject population.

Readiness, confidence and mastery outputs are weighted heuristics for planning and display. They are not statistical confidence intervals, exam predictions or validated learning-outcome measurements. The historical `SCIENTIFIC_MAX_DAILY_LOAD` export is a configured planning cap; its name does not establish a scientific individual workload limit.

For background, see [upstream FSRS](https://github.com/open-spaced-repetition/fsrs4anki) and [Ye et al., KDD 2022](https://doi.org/10.1145/3534678.3539081). Research on scheduling and retrieval does not by itself validate this implementation's indicators.

## License and feedback

The [MIT license](LICENSE) applies to this repository and remains unchanged. Preserve its copyright and permission notice when reusing the source. The separately named `quanta-fsrs` repository has its own license and distribution contract.

Report defects through this repository's [issue tracker](https://github.com/ammmcreativetech-dot/quanta-fsrs-engine/issues), including the module, input data and expected behavior.
