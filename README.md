# Quanta FSRS Engine

> **Open-source FSRS Spaced Repetition Engine** — the algorithm powering [Quanta](https://quanta-study.de), the AI-powered STEM learning platform for students in the DACH region.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://typescriptlang.org)
[![FSRS](https://img.shields.io/badge/Algorithm-FSRS-green.svg)](https://dl.acm.org/doi/10.1145/3534678.3539081)

---

## What is this?

This is the **complete spaced repetition engine** extracted from [Quanta](https://quanta-study.de). It implements the Free Spaced Repetition Scheduler (FSRS) by Ye et al. (2022, ACM KDD), with Quanta-specific extensions for STEM learning:

- **FSRS Core** — Stability (S), Difficulty (D), Retrievability (R) tracking per card
- **STEM-Optimized Weights** — Calibrated for academic MINT/STEM content (formulas, proofs, reaction mechanisms)
- **Exam-Aware Scheduler** — Multi-exam study plan generation with risk-based prioritization
- **Interleaving Engine** — Topic-interleaved card ordering (Rohrer & Taylor, 2007)
- **Readiness Score** — FSRS-derived exam readiness metric with confidence intervals
- **Mastery Calculation** — Per-topic mastery based on stability distribution + answer history

## Scientific Foundation

| Paper | Key Finding | How Quanta Uses It |
|---|---|---|
| [Ye et al. 2022, ACM KDD](https://dl.acm.org/doi/10.1145/3534678.3539081) | FSRS is 22% more precise than SM-2 (Log-Loss 0.35 vs 0.45) | Core scheduling algorithm |
| [Karpicke & Roediger 2008, Science](https://doi.org/10.1126/science.1152408) | Active Recall improves long-term retention by 50% vs re-reading | Q&A flashcard format |
| [Rohrer & Taylor 2007](https://doi.org/10.1007/s11251-007-9015-8) | Interleaving yields 63% vs 20% on delayed tests | `interleaving.ts` implementation |
| [Ebbinghaus 1885](https://en.wikipedia.org/wiki/Forgetting_curve) | Exponential forgetting curve: R(t) = 0.9^(t/S) | `calculateRetrievability()` |

## Architecture

```
src/
├── fsrs.ts              # FSRS core: state updates, retrievability, grades
├── interleaving.ts      # Topic-interleaved card ordering (Rohrer 2007)
└── engine/
    ├── types.ts         # TypeScript interfaces for all engine types
    ├── scheduler.ts     # Multi-exam study plan generator with FSRS simulation
    ├── readiness.ts     # Exam readiness score (composite of mastery + coverage + trend)
    └── mastery.ts       # Per-topic mastery calculation from stability distribution
```

## Key Formulas

### Retrievability (Memory Decay)

```
R(t) = 0.9^(t / S)
```

Where `S` = Stability (days until 90% recall probability), `t` = elapsed days.

### Stability Update (Success)

```
S' = S × (1 + e^w8 × (11-D) × S^(-w9) × (e^(w10×(1-R)) - 1) × hard_penalty × easy_bonus)
```

### Stability Update (Failure)

```
S' = w11 × D^(-w12) × ((S+1)^w13 - 1) × e^(w14×(1-R))
```

### Difficulty Update (with Mean Reversion)

```
D' = w7 × D0 + (1 - w7) × (D - w6 × (grade - 3))
```

## What Makes This Different from Other FSRS Implementations

1. **STEM-Calibrated Weights** — The 17 default weights are optimized for academic STEM content, not casual vocabulary learning
2. **Exam-Aware Scheduling** — The scheduler doesn't just schedule reviews; it generates multi-day study plans that adapt to exam dates, difficulty, and topic mastery
3. **Interleaving Built-In** — Most FSRS implementations review one topic at a time. Quanta interleaves topics within study sessions (scientifically proven to improve transfer)
4. **Readiness Score** — A novel composite metric that tells students whether they're exam-ready, combining mastery, coverage, trend, and time pressure
5. **Simulation-First Planning** — The scheduler runs FSRS forward-simulations to allocate cards across future days

## Used In Production

This engine powers [Quanta](https://quanta-study.de) — a STEM learning platform with:
- FSRS Spaced Repetition for Physics, Chemistry, Math, Biology, Medicine
- AI-powered flashcard generation (Gemini 2.5 Flash)
- LaTeX formula editor (KaTeX) and SMILES molecule builder
- Community deck library with education context filters (university, semester, federal state)
- Quality-controlled content with provenance certificates

## License

MIT — use freely in your own learning apps. Attribution appreciated.

## Links

- **Quanta Platform**: [quanta-study.de](https://quanta-study.de)
- **FSRS Paper**: [Ye et al. 2022, ACM KDD](https://dl.acm.org/doi/10.1145/3534678.3539081)
- **FSRS Community**: [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki)
- **Quanta Community Decks**: [quanta-study.de/community](https://quanta-study.de/community)
