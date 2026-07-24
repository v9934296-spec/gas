# Rap Lab

Personal-use Expo app for recording a rap take, transcribing it on an Apple device, measuring deterministic writing patterns, and saving takes locally.

## What works

- Record directly on iPhone/iPad with `expo-audio`
- On-device iOS file transcription with `expo-speech-transcriber`
- Editable transcript after recognition
- Deterministic text metrics:
  - word count
  - estimated syllables
  - vocabulary variety
  - repeated language
  - end-rhyme candidates
  - internal-rhyme candidates
  - rhyme density
  - repeated end-rhyme chains
- Save, reopen, edit, and delete takes locally with AsyncStorage
- No account, backend, subscription, or cloud storage required

## Honest limitations

This build does **not** claim true flow scoring yet. It does not measure beat alignment, cadence timing, breath control, or phonetic rhyme accuracy. Rhyme metrics are spelling-based candidates intended for pattern spotting.

`transcribeAudioWithSFRecognizer` is an iOS/iPadOS file-transcription path, so the personal build is targeted at iPhone/iPad. Keep takes under roughly one minute for the current transcription library.

## Install dependencies

```bash
npm install
npx expo-doctor
```

## Build a standalone personal iPad/iPhone app

Expo Go is not used because `expo-speech-transcriber` requires native code.

Install EAS CLI and sign in:

```bash
npm install -g eas-cli
eas login
```

Configure/link the EAS project if prompted:

```bash
eas build:configure
```

Register the iPad/iPhone for internal distribution:

```bash
eas device:create
```

Then create the standalone internal build:

```bash
eas build --platform ios --profile preview
```

Open the resulting EAS install link on the registered iPad/iPhone and install Rap Lab.

## Personal-use flow

```text
Open Rap Lab
→ Record
→ Rap under ~60 seconds
→ Stop
→ On-device transcription
→ Review/edit transcript
→ See measurable writing analysis
→ Save Take
→ Reopen from History
```

## Next technical milestone

Add timestamp-aware transcription/audio features so flow can be measured from actual timing evidence instead of guessed from text.
