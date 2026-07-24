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

function makeId() {
  return `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function defaultTakeTitle(date = new Date()) {
  return `Take ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
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

export default function App() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
  });
  const recorderState = useAudioRecorderState(recorder, 250);

  const [screen, setScreen] = useState("record");
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [transcript, setTranscript] = useState("");
  const [takeTitle, setTakeTitle] = useState("");
  const [currentTakeId, setCurrentTakeId] = useState(null);
  const [takeDurationMs, setTakeDurationMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [takes, setTakes] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState("");

  const analysis = useMemo(() => analyzeRapText(transcript), [transcript]);
  const busy = [PHASE.PREPARING, PHASE.STOPPING, PHASE.TRANSCRIBING].includes(phase);
  const isRecording = phase === PHASE.RECORDING || recorderState?.isRecording;

  useEffect(() => {
    let mounted = true;
    void loadTakes().then((items) => {
      if (!mounted) return;
      setTakes(items);
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
      if (speech !== "authorized") {
        Alert.alert("Speech recognition required", "Allow speech recognition so Rap Lab can transcribe your verse locally on this device.");
        return false;
      }
    }

    return true;
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
      recorder.record();
      setPhase(PHASE.RECORDING);
    } catch (error) {
      console.error("START_RECORDING_FAILED", error);
      setErrorMessage(error instanceof Error ? error.message : "Could not start recording.");
      setPhase(PHASE.ERROR);
    }
  }

  async function stopAndAnalyze() {
    if (!isRecording || busy) return;

    try {
      setPhase(PHASE.STOPPING);
      const capturedDuration = recorderState?.durationMillis || 0;
      await recorder.stop();
      const uri = recorder.uri;
      setTakeDurationMs(capturedDuration);

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!uri) throw new Error("Recording stopped, but no audio file was created.");
      if (Platform.OS !== "ios") {
        throw new Error("This personal build currently uses Apple file transcription and is intended for iPhone or iPad.");
      }

      setPhase(PHASE.TRANSCRIBING);
      const text = await SpeechTranscriber.transcribeAudioWithSFRecognizer(uri);
      const cleaned = typeof text === "string" ? text.trim() : "";

      if (!cleaned) {
        throw new Error("No speech was confidently detected. Try another take closer to the microphone.");
      }

      setTranscript(cleaned);
      setTakeTitle(defaultTakeTitle());
      setCurrentTakeId(makeId());
      setScreen("result");
      setPhase(PHASE.COMPLETE);
    } catch (error) {
      console.error("STOP_OR_TRANSCRIBE_FAILED", error);
      setErrorMessage(error instanceof Error ? error.message : "The take could not be transcribed.");
      setPhase(PHASE.ERROR);
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
    setScreen("record");
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
      createdAt: takes.find((item) => item.id === id)?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      analysis: analyzeRapText(transcript),
    };

    try {
      const next = await saveTake(take);
      setCurrentTakeId(id);
      setTakes(next);
      setSavedMessage("Saved on this device");
    } catch (error) {
      Alert.alert("Could not save take", error instanceof Error ? error.message : "Local storage failed.");
    }
  }

  function openTake(take) {
    setCurrentTakeId(take.id);
    setTakeTitle(take.title || "Saved take");
    setTranscript(take.transcript || "");
    setTakeDurationMs(take.durationMs || 0);
    setSavedMessage("Saved on this device");
    setErrorMessage("");
    setPhase(PHASE.COMPLETE);
    setScreen("result");
  }

  function confirmDelete(take) {
    Alert.alert("Delete this take?", "The transcript and analysis will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteTake(take.id).then((next) => {
            setTakes(next);
            if (currentTakeId === take.id) resetForNewTake();
          });
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
        return "FINISHING TAKE";
      case PHASE.TRANSCRIBING:
        return "TRANSCRIBING ON DEVICE";
      case PHASE.ERROR:
        return "TAKE FAILED";
      default:
        return "READY";
    }
  }

  function renderRecord() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>PERSONAL RAP LAB</Text>
            <Text style={styles.logo}>RAP LAB</Text>
          </View>
          <MiniButton label={`HISTORY ${takes.length ? `(${takes.length})` : ""}`} onPress={() => setScreen("history")} />
        </View>

        <Text style={styles.heroCopy}>Record a verse. Get the transcript. See measurable writing patterns without fake AI scores.</Text>

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
          <Text style={styles.recordHint}>{isRecording ? "Finish the take when you're ready." : "Best results: one voice, low background noise, under one minute."}</Text>
        </View>

        {phase === PHASE.ERROR ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t finish that take.</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <MiniButton label="RESET" onPress={resetForNewTake} />
          </View>
        ) : null}

        <View style={styles.infoCard}>
          <Text style={styles.cardKicker}>WHAT THIS VERSION MEASURES</Text>
          <Text style={styles.cardTitle}>Writing structure first.</Text>
          <Text style={styles.cardCopy}>Word count, estimated syllables, vocabulary variety, repeated language, end-rhyme candidates, internal-rhyme candidates, and rhyme density.</Text>
          <Text style={styles.honestyNote}>Flow timing, beat alignment, and true phonetic rhyme scoring are not claimed yet.</Text>
        </View>
      </ScrollView>
    );
  }

  function renderResult() {
    const repetitions = analysis.repeatedWords || [];
    return (
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>TAKE ANALYSIS</Text>
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
            <Text style={styles.resultMeta}>{formatDuration(takeDurationMs)} {savedMessage ? `· ${savedMessage}` : ""}</Text>
          </View>
          <MiniButton label="NEW TAKE" onPress={resetForNewTake} />
        </View>

        <View style={styles.metricGrid}>
          <Metric value={analysis.wordCount} label="WORDS" />
          <Metric value={analysis.estimatedSyllables} label="EST. SYLLABLES" />
          <Metric value={`${analysis.vocabularyVarietyPct}%`} label="VOCAB VARIETY" />
          <Metric value={`${analysis.rhymeDensityPct}%`} label="RHYME DENSITY" />
          <Metric value={analysis.endRhymeCandidates} label="END-RHYME CANDIDATES" />
          <Metric value={analysis.internalRhymeCandidates} label="INTERNAL CANDIDATES" />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardKicker}>STRUCTURE</Text>
          <Text style={styles.sectionLine}>Analysis groups: <Text style={styles.sectionStrong}>{analysis.analysisGroups}</Text></Text>
          <Text style={styles.sectionLine}>Groups sharing end-rhyme candidates: <Text style={styles.sectionStrong}>{analysis.groupsWithEndRhyme}</Text></Text>
          <Text style={styles.sectionLine}>Longest repeated end-rhyme chain: <Text style={styles.sectionStrong}>{analysis.longestEndRhymeChain || "—"}</Text></Text>
        </View>

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
          <Text style={styles.cardCopy}>Fix recognition mistakes or add line breaks. The metrics update immediately.</Text>
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
          <Text style={styles.cardCopy}>{analysis.note}</Text>
        </View>

        <Pressable onPress={persistCurrentTake} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{savedMessage ? "SAVE CHANGES" : "SAVE TAKE"}</Text>
        </Pressable>
        <MiniButton label="OPEN HISTORY" onPress={() => setScreen("history")} />
      </ScrollView>
    );
  }

  function renderHistory() {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>LOCAL LIBRARY</Text>
            <Text style={styles.logo}>HISTORY</Text>
          </View>
          <MiniButton label="BACK" onPress={() => setScreen(currentTakeId ? "result" : "record")} />
        </View>

        <Text style={styles.heroCopy}>Saved only on this device. No account and no cloud backend in this personal build.</Text>

        {historyLoading ? (
          <ActivityIndicator color="#54FF00" />
        ) : takes.length === 0 ? (
          <View style={styles.infoCard}>
            <Text style={styles.cardTitle}>No saved takes yet.</Text>
            <Text style={styles.cardCopy}>Record a verse, review the transcript, then tap Save Take.</Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {takes.map((take) => (
              <View key={take.id} style={styles.historyCard}>
                <Pressable onPress={() => openTake(take)} style={({ pressed }) => [styles.historyMain, pressed && styles.pressed]}>
                  <Text style={styles.historyTitle}>{take.title || "Saved take"}</Text>
                  <Text style={styles.historyMeta}>
                    {take.analysis?.wordCount ?? analyzeRapText(take.transcript || "").wordCount} words · {formatDuration(take.durationMs || 0)}
                  </Text>
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
      {screen === "record" ? renderRecord() : screen === "history" ? renderHistory() : renderResult()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#09090A" },
  scrollContent: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 48, gap: 18 },
  topRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  eyebrow: { color: "#54FF00", fontSize: 10, fontWeight: "900", letterSpacing: 2.2 },
  logo: { color: "#FFFFFF", fontSize: 36, fontWeight: "900", letterSpacing: -1.2, marginTop: 2 },
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
  infoCard: { borderRadius: 18, backgroundColor: "#151517", padding: 20, borderWidth: 1, borderColor: "#242427" },
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
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
});
