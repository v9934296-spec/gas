# Rap Lab

Personal-use Expo app for recording a rap take, attaching deterministic evidence receipts, and only showing a BARZ score when the receipts justify it.

## Product rule

**No score without evidence** is a hard requirement in code and UI.

- BARZ Phase 0 only scores from explicit evidence objects.
- Every evidence object includes a timestamp, lyric span, and metric reason.
- If evidence is missing, empty, invalid, or the take has no bars, the score is withheld.
- LLM usage is reserved for future coaching phrasing generated from evidence, never for raw scoring.

## Phase 0 validation first

This repository now includes a validation harness and seed fixtures for:

- clean STT accuracy
- phone-recording STT accuracy
- silence / no-bars detection
- rhyme precision
- timing agreement vs human labels

Run the harness with:

```bash
npm test
npm run validate:phase0
```

Require the current fixtures to clear every launch gate only when you are making a shipping decision:

```bash
npm run validate:phase0:launch-ready
```

## V1 launch gates

Do not treat V1 as launch-ready unless the validation report clears these thresholds:

- clean STT: about 88%+
- phone STT: about 78%+
- obvious-rhyme precision: at least 80%
- fake-rhyme rate: at most 15%

The fixtures in `validation/fixtures/` are seed datasets for the harness shape. Replace them with real clean and phone recordings before using the report as a shipping decision.

Launch-ready means all six trust gates pass: clean STT, phone STT, obvious-rhyme precision, fake-rhyme rate, silence invented verses (must be zero), and timing agreement (must clear 5/8 or better vs human reviewers).

## 7 core surfaces

The app flow is intentionally constrained to:

1. Home
2. Beat Select
3. Record
4. Processing
5. Result
6. Receipts
7. Progress / History

Social and battle surfaces are frozen for V1 and remain trust-gated off by default until real-session scoring trust gates are met.

## Pipeline order

1. Record + beat + timestamps
2. Deterministic rhyme / timing / silence analyzers
3. Evidence objects
4. Scoring rules from evidence only
5. LLM coaching phrasing later from evidence

## What works now

- Beat selection before recording
- On-device iOS recording with `expo-audio`
- On-device transcription with `expo-speech-transcriber`
- Deterministic transcript analysis
- Evidence receipts for BARZ Phase 0
- Local save / reopen / delete history with AsyncStorage
- Seed validation harness for Phase 0 launch gates
- CI-ready Phase 0 validation report (`npm run validate:phase0`) plus an explicit launch-readiness gate (`npm run validate:phase0:launch-ready`)

## Honest limitations

- Timing evidence is currently inferred from transcript grouping and take duration, not true word timestamps.
- The STT and evaluation fixtures are scaffolding for the validation workflow, not production corpora.
- This build does **not** claim phonetic rhyme certainty, beat alignment certainty, or human-equivalent review quality yet.
