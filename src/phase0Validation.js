export const PHASE0_THRESHOLDS = Object.freeze({
  cleanSttPct: 88,
  phoneSttPct: 78,
  rhymePrecisionPct: 80,
  fakeRhymeRatePct: 15,
  silenceInventedVersesMax: 0,
  timingAgreementMinMatches: 5,
  timingAgreementOutOf: 8,
});

export function getPhase0TimingGate() {
  return {
    minMatches: PHASE0_THRESHOLDS.timingAgreementMinMatches,
    outOf: PHASE0_THRESHOLDS.timingAgreementOutOf,
    minimumPct: Number(
      ((PHASE0_THRESHOLDS.timingAgreementMinMatches / PHASE0_THRESHOLDS.timingAgreementOutOf) * 100).toFixed(1),
    ),
  };
}

function tokenize(text) {
  return (typeof text === "string" ? text.toLowerCase().match(/[a-z0-9']+/g) || [] : []).filter(Boolean);
}

export function scoreTranscriptAccuracy(reference, hypothesis) {
  const referenceWords = tokenize(reference);
  const hypothesisWords = tokenize(hypothesis);
  if (!referenceWords.length) return hypothesisWords.length ? 0 : 100;

  let matches = 0;
  for (let index = 0; index < referenceWords.length; index += 1) {
    if (referenceWords[index] === hypothesisWords[index]) matches += 1;
  }

  return Number(((matches / referenceWords.length) * 100).toFixed(1));
}

export function evaluateSttSet(cases) {
  const scoredCases = cases.map((item) => ({
    id: item.id,
    accuracyPct: scoreTranscriptAccuracy(item.reference, item.hypothesis),
  }));
  const averagePct = scoredCases.length
    ? Number((scoredCases.reduce((sum, item) => sum + item.accuracyPct, 0) / scoredCases.length).toFixed(1))
    : 0;

  return { cases: scoredCases, averagePct };
}

export function evaluateSilenceSet(cases) {
  const inventedVerses = cases.filter((item) => item.expectedNoBars && !item.detectedNoBars).length;
  const matches = cases.filter((item) => item.expectedNoBars === item.detectedNoBars).length;
  const agreementPct = cases.length ? Number(((matches / cases.length) * 100).toFixed(1)) : 0;
  return { total: cases.length, agreementPct, inventedVerses };
}

export function evaluateRhymeSet(cases) {
  const detectedPositives = cases.filter((item) => item.detectedAsRhyme);
  const truePositives = detectedPositives.filter((item) => item.obviousRhyme).length;
  const obviousRhymePrecisionPct = detectedPositives.length
    ? Number(((truePositives / detectedPositives.length) * 100).toFixed(1))
    : 0;

  const nonRhymes = cases.filter((item) => !item.obviousRhyme);
  const falsePositives = nonRhymes.filter((item) => item.detectedAsRhyme).length;
  const fakeRhymeRatePct = nonRhymes.length
    ? Number(((falsePositives / nonRhymes.length) * 100).toFixed(1))
    : 0;

  return {
    total: cases.length,
    obviousRhymePrecisionPct,
    fakeRhymeRatePct,
  };
}

export function evaluateTimingAgreementSet(cases) {
  const matches = cases.filter((item) => item.humanLabel === item.analyzerLabel).length;
  const agreementPct = cases.length ? Number(((matches / cases.length) * 100).toFixed(1)) : 0;
  return { total: cases.length, matches, agreementPct };
}

export function summarizePhase0Validation(fixtures) {
  const cleanStt = evaluateSttSet(fixtures.cleanStt.cases || []);
  const phoneStt = evaluateSttSet(fixtures.phoneStt.cases || []);
  const silence = evaluateSilenceSet(fixtures.silence.cases || []);
  const rhyme = evaluateRhymeSet(fixtures.rhyme.cases || []);
  const timing = evaluateTimingAgreementSet(fixtures.timing.cases || []);
  const timingGate = getPhase0TimingGate();

  const gates = {
    cleanStt: {
      threshold: PHASE0_THRESHOLDS.cleanSttPct,
      actual: cleanStt.averagePct,
      pass: cleanStt.averagePct >= PHASE0_THRESHOLDS.cleanSttPct,
    },
    phoneStt: {
      threshold: PHASE0_THRESHOLDS.phoneSttPct,
      actual: phoneStt.averagePct,
      pass: phoneStt.averagePct >= PHASE0_THRESHOLDS.phoneSttPct,
    },
    rhymePrecision: {
      threshold: PHASE0_THRESHOLDS.rhymePrecisionPct,
      actual: rhyme.obviousRhymePrecisionPct,
      pass: rhyme.obviousRhymePrecisionPct >= PHASE0_THRESHOLDS.rhymePrecisionPct,
    },
    fakeRhymeRate: {
      threshold: PHASE0_THRESHOLDS.fakeRhymeRatePct,
      actual: rhyme.fakeRhymeRatePct,
      pass: rhyme.fakeRhymeRatePct <= PHASE0_THRESHOLDS.fakeRhymeRatePct,
    },
    silenceInventedVerses: {
      threshold: PHASE0_THRESHOLDS.silenceInventedVersesMax,
      actual: silence.inventedVerses,
      pass: silence.inventedVerses <= PHASE0_THRESHOLDS.silenceInventedVersesMax,
    },
    timingAgreement: {
      threshold: `${timingGate.minMatches}/${timingGate.outOf}`,
      actual: `${timing.matches}/${timing.total}`,
      thresholdPct: timingGate.minimumPct,
      actualPct: timing.agreementPct,
      pass: timing.total >= timingGate.outOf
        && timing.matches >= timingGate.minMatches
        && timing.agreementPct >= timingGate.minimumPct,
    },
  };

  const launchReady = Object.values(gates).every((gate) => gate.pass);

  return {
    thresholds: PHASE0_THRESHOLDS,
    gates,
    cleanStt,
    phoneStt,
    silence,
    rhyme,
    timing,
    launchReady,
  };
}
