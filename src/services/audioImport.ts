import { Composition, Note, Track, InstrumentType } from "../types";
import { normalizeComposition, syncAbcNotation } from "./geminiService";

const DEFAULT_TEMPO = 100;
const MIN_NOTE_SECONDS = 0.12;
const ENERGY_THRESHOLD = 0.01;
const MAX_FREQ = 2000;
const MIN_FREQ = 60;

const frequencyToMidi = (freq: number) => Math.round(69 + 12 * Math.log2(freq / 440));

const autocorrelate = (buffer: Float32Array, sampleRate: number) => {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / size);
  if (rms < ENERGY_THRESHOLD) return null;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const maxOffset = Math.floor(sampleRate / MIN_FREQ);
  const minOffset = Math.floor(sampleRate / MAX_FREQ);

  for (let offset = minOffset; offset <= maxOffset; offset++) {
    let correlation = 0;
    for (let i = 0; i < size - offset; i++) {
      correlation += buffer[i] * buffer[i + offset];
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset === -1) return null;
  return sampleRate / bestOffset;
};

const buildNotesFromPitchTrack = (pitches: Array<{ time: number; midi: number | null }>): Note[] => {
  const notes: Note[] = [];
  let currentMidi: number | null = null;
  let startTime = 0;

  for (let i = 0; i < pitches.length; i++) {
    const { time, midi } = pitches[i];
    if (midi === currentMidi) continue;
    if (currentMidi !== null) {
      const duration = time - startTime;
      if (duration >= MIN_NOTE_SECONDS) {
        notes.push({
          pitch: currentMidi,
          time: startTime,
          duration,
          velocity: 0.8
        });
      }
    }
    currentMidi = midi;
    startTime = time;
  }

  return notes;
};

export const importAudioFile = async (
  file: File,
  onProgress?: (progress: number, etaSeconds: number) => void
): Promise<Composition> => {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error("AudioContext is not supported in this browser.");
  }
  const audioContext: AudioContext = new AudioCtx();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw new Error("Failed to decode audio. Please use a valid MP3/WAV file.");
  }
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);

  const frameSize = 2048;
  const hopSize = 512;
  const pitches: Array<{ time: number; midi: number | null }> = [];

  const totalFrames = Math.max(1, Math.floor((channelData.length - frameSize) / hopSize));
  const started = performance.now();
  let frameIndex = 0;
  onProgress?.(0, 0);

  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const frame = channelData.subarray(i, i + frameSize);
    const freq = autocorrelate(frame, sampleRate);
    const midi = freq ? frequencyToMidi(freq) : null;
    const time = i / sampleRate;
    pitches.push({ time, midi });

    frameIndex += 1;
    if (onProgress && frameIndex % 20 === 0) {
      const progress = frameIndex / totalFrames;
      const elapsed = (performance.now() - started) / 1000;
      const etaSeconds = progress > 0 ? Math.max(0, (elapsed / progress) - elapsed) : 0;
      onProgress(progress, etaSeconds);
    }
    // Yield to the browser so upload UI (elapsed/tips/bar) can animate while analyzing audio.
    if (frameIndex % 200 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  const rawNotes = buildNotesFromPitchTrack(pitches);
  const toBeats = (seconds: number) => seconds * (DEFAULT_TEMPO / 60);
  const notes: Note[] = rawNotes.map(n => ({
    ...n,
    time: toBeats(n.time),
    duration: toBeats(n.duration)
  }));

  const track: Track = {
    instrument: "Piano" as InstrumentType,
    volume: 0.8,
    notes
  };

  let composition: Composition = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    composer: "Audio Import",
    style: "Imported Audio",
    tempo: DEFAULT_TEMPO,
    tracks: [track],
    abcNotation: ""
  };

  composition = normalizeComposition(composition);
  composition.abcNotation = syncAbcNotation(composition);
  onProgress?.(1, 0);
  audioContext.close();
  return composition;
};
