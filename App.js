import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as SpeechTranscriber from "expo-speech-transcriber";
import { StatusBar } from "expo-status-bar";
import { analyzeRapText } from "./src/analyzeRap";
import { PHASE0_THRESHOLDS } from "./src/phase0Validation";
import { deleteTake, loadTakes, saveTake } from "./src/historyStore";

const PHASE = Object.freeze({
  IDLE: "idle",
  PREPARING: "preparing",
  RECORDING: "recording",
  STOPPING: "stopping",
  TRANSCRIBING: "transcribing",
  COMPLETE: "complete",
  ERROR: "error",
});

const SCREEN = Object.freeze({
  HOME: "home",
  BEAT: "beat",
  RECORD: "record",
  PROCESSING: "processing",
  RESULT: "result",
  RECEIPTS: "receipts",
  HISTORY: "history",
});

const BEAT_OPTIONS = Object.freeze([
  { id: "boom-bap-92", name: "Boom Bap 92", bpm: 92, description: "Wide pocket, slower bar pacing, easiest calibration lane." },
  { id: "drill-140", name: "Drill 140", bpm: 140, description: "Fast pocket for dense bars and timing stress tests." },
  { id: "soul-78", name: "Soul 78", bpm: 78, description: "Laid-back phrasing for breath and silence checks." },
]);

function makeId() {
  return `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDim(dim) {
  return dim?.value == null || dim.value === undefined ? "—" : String(dim.value);
}

function barFamilyKey(mechanics, barI) {
  const hit = (mechanics?.rhyme_links || []).find((link) => (
    link.kind !== "internal" && (link.a_bar === barI || link.b_bar === barI)
  ));
  return hit?.phoneme_key || null;
}

function defaultTakeTitle(date = new Date()) {
  return `Take ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function getBeatById(id) {
  return BEAT_OPTIONS.find((item) => item.id === id) || BEAT_OPTIONS[0];
}

function hydrateTake(take) {
  if (!take) return take;
  const beat = getBeatById(take.beat?.id);
  return {
    ...take,
    beat,
    analysis: analyzeRapText(take.transcript || "", {
      durationMs: take.durationMs || 0,
      beat,
    }),
  };
}

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MiniButton({ label, onPress, danger = false, disabled = false }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.miniButton,
        danger && styles.miniButtonDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.miniButtonText, danger && styles.miniButtonDangerText]}>{label}</Text>
    </Pressable>
  );
}

function GateRow({ label, value, good }) {
  return (
    <View style={styles.gateRow}>
      <Text style={styles.gateLabel}>{label}</Text>
      <Text style={[styles.gateValue, good ? styles.goodText : styles.warnText]}>{value}</Text>
    </View>
  );
}

export default function App() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
  });
  const recorderState = useAudioRecorderState(recorder, 250);

  const [screen, setScreen] = useState(SCREEN.HOME);
  const [historyBackScreen, setHistoryBackScreen] = useState(SCREEN.HOME);
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [transcript, setTranscript] = useState("");
  const [takeTitle, setTakeTitle] = useState("");
  const [currentTakeId, setCurrentTakeId] = useState(null);
  const [takeDurationMs, setTakeDurationMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [takes, setTakes] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState("");
  const [selectedBeatId, setSelectedBeatId] = useState(BEAT_OPTIONS[0].id);

  const selectedBeat = useMemo(() => getBeatById(selectedBeatId), [selectedBeatId]);
  const analysis = useMemo(() => analyzeRapText(transcript, {
    durationMs: takeDurationMs,
    beat: selectedBeat,
    takeId: currentTakeId,
  }), [transcript, takeDurationMs, selectedBeat, currentTakeId]);
  const busy = [PHASE.PREPARING, PHASE.STOPPING, PHASE.TRANSCRIBING].includes(phase);
  const isRecording = phase === PHASE.RECORDING || recorderState?.isRecording;

  useEffect(() => {
    let mounted = true;
    void loadTakes().then((items) => {
      if (!mounted) return;
      setTakes(items.map(hydrateTake));
      setHistoryLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function ensurePermissions() {
    const microphone = await AudioModule.requestRecordingPermissionsAsync();
    if (!microphone.granted) {
      Alert.alert("Microphone required", "Allow microphone access so Rap Lab can record your verse.");
      return false;
    }

    if (Platform.OS === "ios") {
      const speech = await SpeechTranscriber.requestPermissions();
      const speechAuthorized = speech === "authorized"
        || speech?.status === "authorized"
        || speech?.granted === true;
      if (!speechAuthorized) {
        Alert.alert("Speech recognition required", "Allow speech recognition so Rap Lab can transcribe your verse locally on this device.");
        return false;
      }
    }

    return true;
  }

  function openHistory(fromScreen = screen) {
    setHistoryBackScreen(fromScreen);
    setScreen(SCREEN.HISTORY);
  }

  function openBeatSelect() {
    setScreen(SCREEN.BEAT);
  }

  async function startRecording() {
    if (busy || isRecording) return;

    try {
      setErrorMessage("");
      setSavedMessage("");
      setTranscript("");
      setTakeTitle("");
      setCurrentTakeId(null);
      setTakeDurationMs(0);
      setPhase(PHASE.PREPARING);
      setScreen(SCREEN.RECORD);

      const allowed = await ensurePermissions();
      if (!allowed) {
        setPhase(PHASE.IDLE);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      await recorder.record();
      setPhase(PHASE.RECORDING);
    } catch (error) {
      console.error("START_RECORDING_FAILED", error);
      setErrorMessage(error instanceof Error ? error.message : "Could not start recording.");
      setPhase(PHASE.ERROR);
      setScreen(SCREEN.RECORD);
    }
  }

  async function stopAndAnalyze() {
    if (!isRecording || busy) return;

    try {
      setPhase(PHASE.STOPPING);
      setScreen(SCREEN.PROCESSING);
      const stoppedRecording = await recorder.stop();
      const finalDurationMs = stoppedRecording?.durationMillis || recorderState?.durationMillis || 0;
      const uri = stoppedRecording?.uri || recorder.uri;
      setTakeDurationMs(finalDurationMs);

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!uri) throw new Error("Recording stopped, but no audio file was created.");
      if (Platform.OS !== "ios") {
        throw new Error("This personal build currently uses Apple file transcription and is intended for iPhone or iPad.");
      }

      setPhase(PHASE.TRANSCRIBING);
      const transcription = await SpeechTranscriber.transcribeAudioWithSFRecognizer(uri);
      const rawText = typeof transcription === "string"
        ? transcription
        : typeof transcription?.transcript === "string"
          ? transcription.transcript
          : "";
      const cleaned = rawText.trim();

      if (!cleaned) {
        throw new Error("No speech was confidently detected. Try another take closer to the microphone.");
      }

      setTranscript(cleaned);
      setTakeTitle(defaultTakeTitle());
      setCurrentTakeId(makeId());
      setPhase(PHASE.COMPLETE);
      setScreen(SCREEN.RESULT);
    } catch (error) {
      console.error("STOP_OR_TRANSCRIBE_FAILED", error);
      setErrorMessage(error instanceof Error ? error.message : "The take could not be transcribed.");
      setPhase(PHASE.ERROR);
      setScreen(SCREEN.RECORD);
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch {
        // Keep the original error visible.
      }
    }
  }

  function resetForNewTake() {
    if (busy || isRecording) return;
    setTranscript("");
    setTakeTitle("");
    setCurrentTakeId(null);
    setTakeDurationMs(0);
    setErrorMessage("");
    setSavedMessage("");
    setPhase(PHASE.IDLE);
    setScreen(SCREEN.RECORD);
  }

  async function persistCurrentTake() {
    if (!transcript.trim()) return;

    const id = currentTakeId || makeId();
    const now = new Date();
    const take = {
      id,
      title: takeTitle.trim() || defaultTakeTitle(now),
      transcript: transcript.trim(),
      durationMs: takeDurationMs,
      beat: selectedBeat,
      createdAt: takes.find((item) => item.id === id)?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      analysis,
    };

    try {
      const next = await saveTake(take);
      setCurrentTakeId(id);
      setTakes(next.map(hydrateTake));
      setSavedMessage("Saved on this device");
    } catch (error) {
      Alert.alert("Could not save take", error instanceof Error ? error.message : "Local storage failed.");
    }
  }

  function openTake(take) {
    const hydrated = hydrateTake(take);
    setCurrentTakeId(hydrated.id);
    setTakeTitle(hydrated.title || "Saved take");
    setTranscript(hydrated.transcript || "");
    setTakeDurationMs(hydrated.durationMs || 0);
    setSelectedBeatId(hydrated.beat?.id || BEAT_OPTIONS[0].id);
    setSavedMessage("Saved on this device");
    setErrorMessage("");
    setPhase(PHASE.COMPLETE);
    setScreen(SCREEN.RESULT);
  }

  function confirmDelete(take) {
    Alert.alert("Delete this take?", "The transcript, receipts, and analysis will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const next = await deleteTake(take.id);
            setTakes(next.map(hydrateTake));
            if (currentTakeId === take.id) resetForNewTake();
          } catch (error) {
            Alert.alert("Could not delete take", error instanceof Error ? error.message : "Local storage failed.");
          }
        },
      },
    ]);
  }

  function statusText() {
    switch (phase) {
      case PHASE.PREPARING:
        return "GETTING READY";
      case PHASE.RECORDING:
        return "RECORDING";
      case PHASE.STOPPING:
        return "CAPTURING TAKE";
      case PHASE.TRANSCRIBING:
        return "BUILDING RECEIPTS";
      case PHASE.ERROR:
        return "TAKE FAILED";
      default:
        return "READY";
    }
  }

  function renderHome() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>BARZ PHASE 1</Text>
            <Text style={styles.logo}>RAP LAB</Text>
          </View>
          <MiniButton label={`PROGRESS ${takes.length ? `(${takes.length})` : ""}`} onPress={() => openHistory(SCREEN.HOME)} />
        </View>

        <Text style={styles.heroCopy}>Phase 0 evidence still gates the score. Phase 1 adds a frozen scorecard: mechanics before meaning, cite or drop, pocket stays blank without audio.</Text>

        <View style={styles.infoCard}>
          <Text style={styles.cardKicker}>7 CORE SURFACES</Text>
          <Text style={styles.cardTitle}>Home → Beat Select → Record → Processing → Result → Receipts → Progress / History</Text>
          <Text style={styles.cardCopy}>This build keeps the product surface area narrow while the validation harness proves transcription, silence detection, rhyme precision, and reviewer timing agreement.</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>V1 LAUNCH GATES</Text>
          <GateRow label="Clean STT" value={`≥ ${PHASE0_THRESHOLDS.cleanSttPct}%`} good />
          <GateRow label="Phone STT" value={`≥ ${PHASE0_THRESHOLDS.phoneSttPct}%`} good />
          <GateRow label="Obvious rhyme precision" value={`≥ ${PHASE0_THRESHOLDS.rhymePrecisionPct}%`} good />
          <GateRow label="Fake rhyme rate" value={`≤ ${PHASE0_THRESHOLDS.fakeRhymeRatePct}%`} good />
        </View>

        <Pressable onPress={openBeatSelect} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>START PHASE 1 FLOW</Text>
        </Pressable>
      </ScrollView>
    );
  }

  function renderBeatSelect() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>SURFACE 2 / 7</Text>
            <Text style={styles.logo}>BEAT SELECT</Text>
          </View>
          <MiniButton label="BACK" onPress={() => setScreen(SCREEN.HOME)} />
        </View>

        <Text style={styles.heroCopy}>Pick the beat lane first so timing evidence can be judged against an explicit BPM target.</Text>

        <View style={styles.historyList}>
          {BEAT_OPTIONS.map((beat) => {
            const selected = beat.id === selectedBeat.id;
            return (
              <Pressable
                key={beat.id}
                onPress={() => setSelectedBeatId(beat.id)}
                style={({ pressed }) => [styles.beatCard, selected && styles.beatCardActive, pressed && styles.pressed]}
              >
                <Text style={styles.historyTitle}>{beat.name}</Text>
                <Text style={styles.historyMeta}>{beat.bpm} BPM</Text>
                <Text style={styles.cardCopy}>{beat.description}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={() => setScreen(SCREEN.RECORD)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>CONTINUE TO RECORD</Text>
        </Pressable>
      </ScrollView>
    );
  }

  function renderRecord() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>SURFACE 3 / 7</Text>
            <Text style={styles.logo}>RECORD</Text>
          </View>
          <MiniButton label="CHANGE BEAT" onPress={openBeatSelect} />
        </View>

        <Text style={styles.heroCopy}>Selected beat: {selectedBeat.name} · {selectedBeat.bpm} BPM. Timestamps and cadence evidence are measured against this lane.</Text>

        <View style={styles.statusCard}>
          <View style={[styles.statusDot, isRecording && styles.statusDotRecording]} />
          <Text style={styles.statusText}>{statusText()}</Text>
          {isRecording ? <Text style={styles.timer}>{formatDuration(recorderState?.durationMillis || 0)}</Text> : null}
          {busy ? <ActivityIndicator color="#54FF00" style={styles.statusSpinner} /> : null}
        </View>

        <View style={styles.recordStage}>
          <Pressable
            disabled={busy}
            onPress={isRecording ? stopAndAnalyze : startRecording}
            style={({ pressed }) => [
              styles.recordButton,
              isRecording && styles.recordButtonActive,
              busy && styles.disabled,
              pressed && !busy && styles.pressed,
            ]}
          >
            <View style={[styles.recordCore, isRecording && styles.stopCore]} />
            <Text style={styles.recordButtonLabel}>{isRecording ? "STOP" : "RECORD"}</Text>
          </Pressable>
          <Text style={styles.recordHint}>{isRecording ? "Finish the take when you have a full bar set." : "Phase 1 still needs a clean transcript first. Edit it before you trust the scorecard."}</Text>
        </View>

        {phase === PHASE.ERROR ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t finish that take.</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <MiniButton label="RESET" onPress={resetForNewTake} />
          </View>
        ) : null}

        <View style={styles.infoCard}>
          <Text style={styles.cardKicker}>PIPELINE ORDER</Text>
          <Text style={styles.cardCopy}>Record + beat + timestamps → deterministic rhyme/timing/silence analyzers → evidence objects → scoring rules from evidence only → coaching phrasing later.</Text>
          <Text style={styles.honestyNote}>This build does not let an LLM score a take. Coaching language must come from receipts, never from raw scoring guesses.</Text>
        </View>
      </ScrollView>
    );
  }

  function renderProcessing() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>SURFACE 4 / 7</Text>
            <Text style={styles.logo}>PROCESSING</Text>
          </View>
        </View>
        <View style={styles.infoCard}>
          <ActivityIndicator color="#54FF00" size="large" />
          <Text style={styles.cardTitle}>Building evidence receipts</Text>
          <Text style={styles.cardCopy}>We only show a BARZ score after the deterministic analyzers can attach transcript-backed evidence objects.</Text>
          <Text style={styles.honestyNote}>{statusText()} · Beat target {selectedBeat.bpm} BPM</Text>
        </View>
      </ScrollView>
    );
  }

  function renderResult() {
    const repetitions = analysis.repeatedWords || [];
    const barz = analysis.barz;
    const scorecard = analysis.scorecard;
    const bars = analysis.mechanics?.bars || [];
    const familyKeys = [...new Set(bars.map((bar) => barFamilyKey(analysis.mechanics, bar.i)).filter(Boolean))];
    const familyColor = (key) => {
      const palette = ["#54FF00", "#7AD1FF", "#FFBB54", "#D7A6FF", "#FF6A83"];
      const index = Math.max(0, familyKeys.indexOf(key));
      return palette[index % palette.length];
    };
    const dims = [
      ["technical", "TECH"],
      ["punch", "PUNCH"],
      ["originality", "ORIG"],
      ["coherence", "COHERE"],
      ["pocket", "POCKET"],
      ["cleanliness", "CLEAN"],
    ];
    return (
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>SURFACE 5 / 7 · SCORECARD 1.0</Text>
            <TextInput
              value={takeTitle}
              onChangeText={(value) => {
                setTakeTitle(value);
                setSavedMessage("");
              }}
              placeholder="Name this take"
              placeholderTextColor="#66666B"
              style={styles.titleInput}
            />
            <Text style={styles.resultMeta}>{formatDuration(takeDurationMs)} · {selectedBeat.name} · {savedMessage || "Unsaved"}</Text>
          </View>
          <MiniButton label="NEW TAKE" onPress={resetForNewTake} />
        </View>

        <View style={styles.overallCard}>
          <Text style={styles.cardKicker}>OVERALL · CYPHER VERDICT</Text>
          <Text style={styles.overallValue}>{formatDim(scorecard?.scores?.overall)}</Text>
          <Text style={styles.cardCopy}>{scorecard?.scores?.overall?.why || barz.note}</Text>
        </View>

        <View style={styles.chipRow}>
          {dims.map(([key, label]) => (
            <View key={key} style={styles.dimChip}>
              <Text style={styles.dimChipLabel}>{label}</Text>
              <Text style={styles.dimChipValue}>{formatDim(scorecard?.scores?.[key])}</Text>
            </View>
          ))}
        </View>

        <View style={styles.metricGrid}>
          <Metric value={analysis.wordCount} label="WORDS" />
          <Metric value={analysis.mechanics?.stats?.bar_count ?? analysis.estimatedBars} label="BARS" />
          <Metric value={`${analysis.rhymeDensityPct}%`} label="RHYME DENSITY" />
          <Metric value={typeof barz.score === "number" ? barz.score : "—"} label="EVIDENCE POINTS" />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>VERSE · STAGE 2</Text>
          <Text style={styles.cardCopy}>Rhyme colors come from the mechanics map. The model is not allowed to add links.</Text>
          {bars.length ? bars.map((bar) => {
            const family = barFamilyKey(analysis.mechanics, bar.i);
            return (
              <View key={bar.i} style={[styles.barRow, family && { borderLeftColor: familyColor(family) }]}>
                <Text style={styles.barIndex}>{bar.i}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.barText}>{bar.text}</Text>
                  <Text style={styles.barMeta}>{bar.syllables} syl · {family ? `rhyme ${family}` : "unlinked"}</Text>
                </View>
              </View>
            );
          }) : (
            <Text style={styles.cardCopy}>No bars yet.</Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>SCORING RULE</Text>
          <Text style={styles.cardTitle}>No score without evidence.</Text>
          <Text style={styles.cardCopy}>{scorecard?.notes || barz.note}</Text>
          <Text style={styles.sectionLine}>Receipts: <Text style={styles.sectionStrong}>{barz.status.toUpperCase()}</Text> · {barz.evidence.length}</Text>
          <Text style={styles.sectionLine}>Scheme: <Text style={styles.sectionStrong}>{analysis.mechanics?.scheme_guess || "—"}</Text></Text>
          {barz.blockedReason ? <Text style={styles.sectionLine}>{barz.blockedReason}</Text> : null}
        </View>

        {scorecard?.best_bars?.length ? (
          <View style={styles.sectionCard}>
            <Text style={styles.cardKicker}>BEST BARS</Text>
            {scorecard.best_bars.map((item) => (
              <Text key={`best-${item.bar_i}`} style={styles.sectionLine}>{item.bar_i}: {item.quote}</Text>
            ))}
          </View>
        ) : null}

        {scorecard?.weak_bars?.length ? (
          <View style={styles.sectionCard}>
            <Text style={styles.cardKicker}>WEAK BARS</Text>
            {scorecard.weak_bars.map((item) => (
              <Text key={`weak-${item.bar_i}`} style={styles.sectionLine}>{item.bar_i}: {item.quote}</Text>
            ))}
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>REPEATED LANGUAGE</Text>
          {repetitions.length ? (
            <View style={styles.chipRow}>
              {repetitions.map((item) => (
                <View key={item.word} style={styles.chip}>
                  <Text style={styles.chipText}>{item.word} ×{item.count}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.cardCopy}>No meaningful repeated words stood out.</Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>EDIT THE TRANSCRIPT</Text>
          <Text style={styles.cardCopy}>Fix recognition mistakes or add line breaks. Stage 2 and the scorecard recompute from the edited words.</Text>
          <TextInput
            multiline
            value={transcript}
            onChangeText={(value) => {
              setTranscript(value);
              setSavedMessage("");
            }}
            textAlignVertical="top"
            style={styles.transcriptInput}
            placeholder="Transcript"
            placeholderTextColor="#5E5E63"
          />
        </View>

        <View style={styles.honestyCard}>
          <Text style={styles.cardKicker}>HONESTY CHECK</Text>
          <Text style={styles.cardCopy}>{analysis.note} Pocket is null until audio_coach. Punch stays null unless a bar can be quoted as a setup/payoff.</Text>
        </View>

        <Pressable onPress={persistCurrentTake} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{savedMessage ? "SAVE CHANGES" : "SAVE TAKE"}</Text>
        </Pressable>
        <MiniButton label="OPEN RECEIPTS" onPress={() => setScreen(SCREEN.RECEIPTS)} />
        <MiniButton label="OPEN PROGRESS / HISTORY" onPress={() => openHistory(SCREEN.RESULT)} />
      </ScrollView>
    );
  }

  function renderReceipts() {
    const receipts = analysis.barz.evidence;
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>SURFACE 6 / 7</Text>
            <Text style={styles.logo}>RECEIPTS</Text>
          </View>
          <MiniButton label="BACK" onPress={() => setScreen(SCREEN.RESULT)} />
        </View>

        <Text style={styles.heroCopy}>Every BARZ decision must point to a timestamp, a lyric span, and a metric reason.</Text>

        {receipts.length ? receipts.map((item) => (
          <View key={item.id} style={styles.sectionCard}>
            <Text style={styles.cardKicker}>{item.category.toUpperCase()}</Text>
            <Text style={styles.cardTitle}>{item.metric}</Text>
            <Text style={styles.cardCopy}>{item.reason}</Text>
            <Text style={styles.sectionLine}>Timestamp: <Text style={styles.sectionStrong}>{formatDuration(item.timestamp.startMs)} → {formatDuration(item.timestamp.endMs)}</Text></Text>
            <Text style={styles.sectionLine}>Lyric span: <Text style={styles.sectionStrong}>{item.lyricSpan.text}</Text></Text>
            <Text style={styles.sectionLine}>Points: <Text style={styles.sectionStrong}>{item.points}</Text></Text>
          </View>
        )) : (
          <View style={styles.infoCard}>
            <Text style={styles.cardTitle}>No receipts available.</Text>
            <Text style={styles.cardCopy}>{analysis.barz.blockedReason || "Without explicit evidence objects, the score remains hidden."}</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  function renderHistory() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>SURFACE 7 / 7</Text>
            <Text style={styles.logo}>PROGRESS / HISTORY</Text>
          </View>
          <MiniButton label="BACK" onPress={() => setScreen(historyBackScreen)} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>LAUNCH GATES</Text>
          <Text style={styles.cardCopy}>Keep V1 gated until the validation harness consistently clears the thresholds below with real clean and phone recordings.</Text>
          <GateRow label="Clean STT" value={`≥ ${PHASE0_THRESHOLDS.cleanSttPct}%`} good />
          <GateRow label="Phone STT" value={`≥ ${PHASE0_THRESHOLDS.phoneSttPct}%`} good />
          <GateRow label="Obvious rhyme precision" value={`≥ ${PHASE0_THRESHOLDS.rhymePrecisionPct}%`} good />
          <GateRow label="Fake rhyme rate" value={`≤ ${PHASE0_THRESHOLDS.fakeRhymeRatePct}%`} good />
        </View>

        <Text style={styles.heroCopy}>Saved only on this device. No account and no cloud backend in this build.</Text>

        {historyLoading ? (
          <ActivityIndicator color="#54FF00" />
        ) : takes.length === 0 ? (
          <View style={styles.infoCard}>
            <Text style={styles.cardTitle}>No saved takes yet.</Text>
            <Text style={styles.cardCopy}>Record a verse, review the transcript, inspect the receipts, then tap Save Take.</Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {takes.map((take) => (
              <View key={take.id} style={styles.historyCard}>
                <Pressable onPress={() => openTake(take)} style={({ pressed }) => [styles.historyMain, pressed && styles.pressed]}>
                  <Text style={styles.historyTitle}>{take.title || "Saved take"}</Text>
                  <Text style={styles.historyMeta}>{take.beat?.name || BEAT_OPTIONS[0].name} · overall {formatDim(take.analysis?.scorecard?.scores?.overall)} · {formatDuration(take.durationMs || 0)}</Text>
                  <Text style={styles.historyPreview} numberOfLines={2}>{take.transcript}</Text>
                </Pressable>
                <MiniButton label="DELETE" danger onPress={() => confirmDelete(take)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      {screen === SCREEN.HOME
        ? renderHome()
        : screen === SCREEN.BEAT
          ? renderBeatSelect()
          : screen === SCREEN.RECORD
            ? renderRecord()
            : screen === SCREEN.PROCESSING
              ? renderProcessing()
              : screen === SCREEN.RECEIPTS
                ? renderReceipts()
                : screen === SCREEN.HISTORY
                  ? renderHistory()
                  : renderResult()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#09090A" },
  scrollContent: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 48, gap: 18 },
  topRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  eyebrow: { color: "#54FF00", fontSize: 10, fontWeight: "900", letterSpacing: 2.2 },
  logo: { color: "#FFFFFF", fontSize: 34, fontWeight: "900", letterSpacing: -1.2, marginTop: 2 },
  heroCopy: { color: "#A3A3A8", fontSize: 16, lineHeight: 24, maxWidth: 720 },
  statusCard: { minHeight: 54, borderRadius: 14, backgroundColor: "#151517", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderWidth: 1, borderColor: "#242427" },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#54FF00", marginRight: 10 },
  statusDotRecording: { backgroundColor: "#FF3154" },
  statusText: { color: "#C7C7CA", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  timer: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginLeft: "auto", fontVariant: ["tabular-nums"] },
  statusSpinner: { marginLeft: "auto" },
  recordStage: { alignItems: "center", paddingVertical: 28 },
  recordButton: { width: 164, height: 164, borderRadius: 82, borderWidth: 2, borderColor: "#54FF00", alignItems: "center", justifyContent: "center", backgroundColor: "#111113" },
  recordButtonActive: { borderColor: "#FF3154" },
  recordCore: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#54FF00" },
  stopCore: { borderRadius: 8, backgroundColor: "#FF3154" },
  recordButtonLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", letterSpacing: 2, marginTop: 12 },
  recordHint: { color: "#737378", fontSize: 13, textAlign: "center", marginTop: 16, maxWidth: 420 },
  infoCard: { borderRadius: 18, backgroundColor: "#151517", padding: 20, borderWidth: 1, borderColor: "#242427", gap: 10 },
  beatCard: { borderRadius: 18, backgroundColor: "#151517", padding: 18, borderWidth: 1, borderColor: "#242427" },
  beatCardActive: { borderColor: "#54FF00", backgroundColor: "#111A0F" },
  errorCard: { borderRadius: 18, backgroundColor: "#211216", padding: 20, borderLeftWidth: 3, borderLeftColor: "#FF3154", gap: 12 },
  errorTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  errorText: { color: "#BBBBBF", fontSize: 14, lineHeight: 21 },
  cardKicker: { color: "#54FF00", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  cardTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 7 },
  cardCopy: { color: "#9B9BA0", fontSize: 14, lineHeight: 21, marginTop: 8 },
  honestyNote: { color: "#737378", fontSize: 12, lineHeight: 18, marginTop: 12 },
  miniButton: { borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: "#343438", alignSelf: "flex-start" },
  miniButtonDanger: { borderColor: "#5E2832" },
  miniButtonText: { color: "#F0F0F1", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  miniButtonDangerText: { color: "#FF6A83" },
  titleInput: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", padding: 0, marginTop: 3, minWidth: 220 },
  resultMeta: { color: "#737378", fontSize: 12, marginTop: 4 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { width: "31%", minWidth: 140, flexGrow: 1, borderRadius: 15, backgroundColor: "#151517", padding: 16, borderWidth: 1, borderColor: "#242427" },
  metricValue: { color: "#FFFFFF", fontSize: 26, fontWeight: "900" },
  metricLabel: { color: "#77777C", fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginTop: 5 },
  overallCard: { borderRadius: 18, backgroundColor: "#111A0F", padding: 18, borderWidth: 1, borderColor: "#2A4A1C" },
  overallValue: { color: "#FFFFFF", fontSize: 48, fontWeight: "900", marginTop: 8, letterSpacing: -2 },
  dimChip: { borderRadius: 14, backgroundColor: "#151517", paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#242427", minWidth: 96 },
  dimChipLabel: { color: "#77777C", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  dimChipValue: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", marginTop: 4 },
  barRow: { flexDirection: "row", gap: 10, marginTop: 12, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: "#242427" },
  barIndex: { color: "#54FF00", fontSize: 12, fontWeight: "900", width: 18, marginTop: 2 },
  barText: { color: "#F2F2F3", fontSize: 15, lineHeight: 22 },
  barMeta: { color: "#737378", fontSize: 11, marginTop: 4 },
  sectionCard: { borderRadius: 18, backgroundColor: "#151517", padding: 18, borderWidth: 1, borderColor: "#242427" },
  sectionLine: { color: "#9C9CA1", fontSize: 14, lineHeight: 24, marginTop: 7 },
  sectionStrong: { color: "#FFFFFF", fontWeight: "900" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: { borderRadius: 999, backgroundColor: "#242427", paddingHorizontal: 11, paddingVertical: 7 },
  chipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  transcriptInput: { minHeight: 210, color: "#F2F2F3", backgroundColor: "#0E0E10", borderRadius: 12, padding: 14, fontSize: 16, lineHeight: 25, marginTop: 14, borderWidth: 1, borderColor: "#2B2B2F" },
  honestyCard: { borderRadius: 18, backgroundColor: "#101A0D", padding: 18, borderLeftWidth: 3, borderLeftColor: "#54FF00" },
  primaryButton: { borderRadius: 14, backgroundColor: "#54FF00", alignItems: "center", justifyContent: "center", minHeight: 54, paddingHorizontal: 18 },
  primaryButtonText: { color: "#071000", fontSize: 12, fontWeight: "900", letterSpacing: 1.3 },
  historyList: { gap: 12 },
  historyCard: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "#151517", borderRadius: 16, padding: 15, borderWidth: 1, borderColor: "#242427" },
  historyMain: { flex: 1 },
  historyTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  historyMeta: { color: "#54FF00", fontSize: 11, fontWeight: "800", marginTop: 4 },
  historyPreview: { color: "#85858A", fontSize: 13, lineHeight: 19, marginTop: 8 },
  gateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  gateLabel: { color: "#9B9BA0", fontSize: 14 },
  gateValue: { fontSize: 14, fontWeight: "900" },
  goodText: { color: "#54FF00" },
  warnText: { color: "#FFBB54" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
});
