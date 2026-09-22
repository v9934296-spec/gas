# Rap Lab

Personal-use Expo app for recording a rap take, attaching deterministic evidence receipts, and only showing a BARZ score when the receipts justify it.

## Product rule

**No score without evidence** is a hard requirement in code and UI.

- Phase 0 receipts still require a timestamp, lyric span, and metric reason.
- Phase 1 adds a frozen `Scorecard` `1.0`: technical / punch / originality / coherence / pocket / cleanliness / overall.
- Pocket is null unless audio_coach. Punch, originality, and coherence stay null until they can quote a bar.
- Overall is a cypher verdict, not the mean of the other dims.
- Citations that do not match bar text are stripped.

## Phase 0 evidence carried forward

Real-audio eval in `eval/` is the launch evidence, not the seed JSON:

- e01–e04 read bars: 2.3% machine mistakes overall; e04 headphones 0.0%
- e05-beat: beat-only negative control, no invented lyrics
- e22 freestyle (iPad speakers + TV): machine matched truth word for word

## Phase 1 in this build

- Stage 2 `MechanicsReport` on device (bar split, rhyme links, filler stats)
- Scorecard UI with cited dims and rhyme-colored bars
- Local save / history already from Phase 0
- No Gemini / Grok yet. Keys stay off the phone.

Run:

```bash
npm test
npm run validate:phase0
```

## 7 core surfaces

1. Home
2. Beat Select
3. Record
4. Processing
5. Result (scorecard)
6. Receipts
7. Progress / History
