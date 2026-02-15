
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { Composition, Track, Note, InstrumentType } from "../types";
import { RUBATO_CURVES, getWeightedNextDegree, MELODIC_MOTION_WEIGHTS } from "./StyleDistiller";

const apiKey = (typeof window !== "undefined" && localStorage.getItem("SONATA_API_KEY")) || process.env.API_KEY || "PLACEHOLDER_API_KEY";
const ai = new GoogleGenerativeAI(apiKey);

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isRateLimit = error.status === 429 || error.message?.includes('429');
    if (retries > 0 && isRateLimit) {
      const jitter = Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

// STOCHASTIC MUSIC ENGINE CORE
const RHYTHMIC_CELLS = {
  simple: [[1], [0.5, 0.5], [0.25, 0.25, 0.5]],
  baroque: [[0.5, 0.25, 0.25], [0.25, 0.25, 0.25, 0.25], [0.75, 0.25]],
  dramatic: [[0.5, 0.5, 1], [1.5, 0.5], [0.333, 0.333, 0.334]] // Triplets
};

const PITCH_SPLIT = 60; // Middle C
const TIME_GRID = 0.25; // 1/16 note in beats
const RH_RANGE: [number, number] = [60, 84]; // C4 to C6
const LH_RANGE: [number, number] = [36, 60]; // C2 to C4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const quantize = (value: number, grid: number = TIME_GRID) => Math.round(value / grid) * grid;
const clampPitch = (pitch: number, range: [number, number]) => clamp(pitch, range[0], range[1]);

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const tempoFromStyle = (style: string, title?: string) => {
  const key = style.toLowerCase();
  const seed = `${key}|${title || ""}`;
  const h = hashString(seed);
  const range: [number, number] =
    key.includes("bach") || key.includes("baroque") ? [72, 96] :
      key.includes("chopin") || key.includes("romantic") ? [60, 84] :
        key.includes("jazz") ? [90, 120] :
          [84, 120];
  const [min, max] = range;
  return min + (h % (max - min + 1));
};

const normalizeNote = (note: Note): Note => {
  const time = Math.max(0, quantize(note.time));
  const duration = Math.max(TIME_GRID, quantize(note.duration));
  const velocity = clamp(note.velocity ?? 0.7, 0.05, 1);
  return { ...note, time, duration, velocity };
};

const sortNotes = (notes: Note[]) =>
  notes.sort((a, b) => (a.time - b.time) || (a.pitch - b.pitch));

const splitToGrandStaff = (tracks: Track[]): { rh: Track; lh: Track } => {
  const allNotes = tracks.flatMap(t => t.notes || []);
  const instrument = tracks[0]?.instrument || 'Piano';
  const rhNotes: Note[] = [];
  const lhNotes: Note[] = [];

  allNotes.forEach(n => {
    const normalized = normalizeNote(n);
    if (normalized.pitch < PITCH_SPLIT) lhNotes.push(normalized);
    else rhNotes.push(normalized);
  });

  sortNotes(rhNotes);
  sortNotes(lhNotes);

  return {
    rh: { instrument, volume: 0.8, notes: rhNotes },
    lh: { instrument, volume: 0.8, notes: lhNotes }
  };
};

const selectClef = (notes: Note[], fallback: 'treble' | 'bass'): 'treble' | 'bass' => {
  if (!notes.length) return fallback;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const median = sorted[Math.floor(sorted.length / 2)].pitch;
  return median < PITCH_SPLIT ? 'bass' : 'treble';
};

export const normalizeComposition = (composition: Composition): Composition => {
  const tracks = composition.tracks || [];
  if (tracks.length === 0) return { ...composition, tracks: [] };
  const sameInstrument = tracks.every(t => t.instrument === tracks[0].instrument);
  if (tracks.length > 2 && !sameInstrument) return composition;

  const { rh, lh } = splitToGrandStaff(tracks);
  return { ...composition, tracks: [rh, lh] };
};

const getWeightedRandom = (weights: number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  return weights.findIndex(w => (r -= w) < 0);
};

// Generates a "Human" melody using step-wise motion rules
const generateStochasticMelody = (
  scale: number[],
  length: number,
  rhythmicStyle: keyof typeof RHYTHMIC_CELLS,
  melodicStyle: 'BACH' | 'BEETHOVEN' | 'DRAMATIC' = 'DRAMATIC',
  range: [number, number] = RH_RANGE
): Note[] => {
  const notes: Note[] = [];
  let currentTime = 0;
  let lastPitchIndex = Math.floor(scale.length / 2);

  const motionWeights = MELODIC_MOTION_WEIGHTS[melodicStyle] || MELODIC_MOTION_WEIGHTS['DRAMATIC'];

  while (currentTime < length) {
    const cells = RHYTHMIC_CELLS[rhythmicStyle];
    const cell = cells[Math.floor(Math.random() * cells.length)];

    cell.forEach(duration => {
      // Step vs Leap rules from StyleDistiller
      const moveType = Math.random() < motionWeights.step ? 'step' : 'leap';
      let nextIndex;

      if (moveType === 'step') {
        const direction = Math.random() > 0.5 ? 1 : -1;
        nextIndex = Math.max(0, Math.min(scale.length - 1, lastPitchIndex + direction));
      } else {
        nextIndex = Math.floor(Math.random() * scale.length);
      }

      const rawPitch = scale[nextIndex];
      notes.push({
        pitch: clampPitch(rawPitch, range),
        time: currentTime,
        duration,
        velocity: 0.65 + Math.random() * 0.25
      });

      currentTime += duration;
      lastPitchIndex = nextIndex;
    });
  }
  return notes;
};

// Helper to convert MIDI pitch to ABC notation
const midiToAbc = (midi: number): string => {
  // ABC standard: accidental BEFORE note name (^C not C^)
  const noteNames = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const noteName = noteNames[midi % 12];

  // Check if note has an accidental prefix (^)
  const isSharp = noteName.startsWith('^');
  const baseNote = isSharp ? noteName.slice(1) : noteName;
  const prefix = isSharp ? '^' : '';

  if (octave === 4) return prefix + baseNote;                          // Middle C octave: C
  if (octave === 5) return prefix + baseNote.toLowerCase();            // c
  if (octave >= 6) return prefix + baseNote.toLowerCase() + "'".repeat(octave - 5); // c' c'' etc.
  if (octave === 3) return prefix + baseNote + ",";                    // C,
  if (octave === 2) return prefix + baseNote + ",,";                   // C,,
  if (octave <= 1) return prefix + baseNote + ",,,";                   // C,,,
  return prefix + baseNote;
};

// Advanced Procedural Logic for Bach/Beethoven emulation
const generateAdvancedComposition = (style: string, title?: string, userName?: string, instrument: string = 'Piano', subtitle?: string): Composition => {
  const isBach = style.toLowerCase().includes('bach') || style.toLowerCase().includes('baroque');
  // If not Bach, default to Beethoven/Classical for that "Pro" feel
  const styleKey = isBach ? 'BACH' : 'BEETHOVEN';
  const rubatoType = isBach ? 'baroque' : 'expressive';

  const instList = instrument.split(',').map(s => s.trim()) as InstrumentType[];
  const mainInst = instList[0] || 'Piano';

  const tracks: Track[] = [
    { instrument: mainInst, volume: 0.8, notes: [] }, // Right Hand (Melody)
    { instrument: mainInst, volume: 0.8, notes: [] }  // Left Hand (Bass)
  ];

  // Scale Definitions (Am / Cm context)
  const scale = isBach ? [60, 62, 64, 65, 67, 69, 71, 72] : [60, 62, 63, 65, 67, 68, 70, 72];

  // Dynamic Title Generation
  const titles = ["Sonata No. " + Math.floor(Math.random() * 9 + 1), "Prelude in A Minor", "Nocturne", "Etude No. 5", "Fantasia", "Concerto Movement"];
  const dynamicTitle = title || titles[Math.floor(Math.random() * titles.length)];

  // Header Information
  let abcHeader = `X:1\nT:${dynamicTitle}\n`;
  if (subtitle) abcHeader += `T:${subtitle}\n`;
  abcHeader += `C:${userName || "L. van Beethoven"}\n`;
  // FIX: abcjs uses %%score, NOT %%staves. Using correct syntax.
  abcHeader += `%%titlefont Playfair-Display 48\n%%subtitlefont Playfair-Display 18\n%%composerfont Inter 12\n%%staffsep 45\n%%syssep 45\n%%score {RH | LH}\n`;

  // Dynamic Time Signature & Tempo
  const selectedTimeSig = '4/4';
  const tempo = tempoFromStyle(style, dynamicTitle);

  abcHeader += `L:1/8\nQ:1/4=${tempo}\nM:${selectedTimeSig}\nK:Am\n`;
  abcHeader += `V:RH clef=treble name="${instrument}"\nV:LH clef=bass\n`;

  let totalAbc = "";

  // --- Master-Class Generative Engine Components ---

  const applySequence = (motif: Note[], interval: number): Note[] => {
    return motif.map(n => {
      const idx = scale.indexOf(n.pitch % 12 + 60);
      // Safe access to scale
      const nextPitchRaw = scale[(idx + interval) % scale.length] || scale[0];
      const nextPitch = nextPitchRaw + (Math.floor(n.pitch / 12) - 5) * 12;
      return { ...n, pitch: nextPitch || n.pitch };
    });
  };

  const applyInversion = (motif: Note[], axis: number): Note[] => {
    return motif.map(n => ({
      ...n,
      pitch: axis - (n.pitch - axis)
    }));
  };

  const sections_internal = 32;

  // Initial "Seed Motif" (2 bars in 4/4 = 8 beats)
  let seedMotif = generateStochasticMelody(scale.map(p => p + 12), 8, 'dramatic', styleKey, RH_RANGE);

  // Dynamic Harmonic State
  let currentRootDegree = 0; // Start on Tonic (I)

  for (let s = 0; s < sections_internal; s++) {
    let currentRh = "[V:RH] ";
    // FIX: Force clef=bass explicitly on every line to prevent abcjs from reverting to treble
    let currentLh = "[V:LH clef=bass] ";
    const sectionStartTime = s * 8; // 2 bars of 4/4

    // --- MOTIVIC DEVELOPMENT (RH) ---
    let currentMelody: Note[] = [];
    if (s % 4 === 0) currentMelody = [...seedMotif];
    else if (s % 4 === 1) currentMelody = applySequence(seedMotif, 1);
    else if (s % 4 === 2) currentMelody = applyInversion(seedMotif, scale[4] + 12);
    else currentMelody = generateStochasticMelody(scale.map(p => p + 12), 8, 'simple', styleKey, RH_RANGE);

    // Notation & Humanization
    let rhAbc = "";
    currentMelody.forEach((n, idx) => {
      // Apply Rubato
      const phraseProgress = idx / currentMelody.length;
      const rubatoOffset = RUBATO_CURVES[rubatoType](phraseProgress);

      const noteCopy = normalizeNote({ ...n, time: n.time + sectionStartTime + rubatoOffset });
      noteCopy.pitch = clampPitch(noteCopy.pitch, RH_RANGE);

      const fingering = `_${Math.floor(Math.random() * 5) + 1}`;
      const noteChar = midiToAbc(noteCopy.pitch);
      const len = noteCopy.duration === 1 ? "2" : noteCopy.duration === 0.5 ? "" : noteCopy.duration === 0.25 ? "/2" : "";

      noteCopy.fingering = fingering;
      if (idx === 0) noteCopy.dynamic = ["!pp!", "!p!", "!mf!"][Math.floor(Math.random() * 3)];

      // Slurs
      if (idx % 3 === 0) { noteCopy.slurStart = true; rhAbc += "("; }

      rhAbc += (noteCopy.dynamic ? noteCopy.dynamic + " " : "") + noteChar + len + fingering + " ";

      if (idx % 3 === 2) { noteCopy.slurEnd = true; rhAbc += ") "; }

      tracks[0].notes.push(noteCopy);
    });
    currentRh += rhAbc + "| ";

    // --- HARMONIC ARCHITECTURE (LH) ---
    // Uses the Distilled Weights to determine chord progression
    for (let bar = 0; bar < 2; bar++) {
      // Evolve harmony
      currentRootDegree = getWeightedNextDegree(currentRootDegree, styleKey);

      // Construct triad from scale
      // FIX: -24 (2 octaves down) to land in C2-C3 range, forcing true Bass Clef
      const rootPitch = clampPitch(scale[currentRootDegree % scale.length] - 24, LH_RANGE);
      const thirdPitch = clampPitch(scale[(currentRootDegree + 2) % scale.length] - 24, LH_RANGE);

      const time = sectionStartTime + bar * 4;

      if (bar === 0) currentLh += "!P! ";

      // Arpeggiator or Block Chord?
      if (Math.random() > 0.4) {
        // Block Chord
        tracks[1].notes.push(normalizeNote({ pitch: rootPitch, time, duration: 4, velocity: 0.7 }));
        tracks[1].notes.push(normalizeNote({ pitch: thirdPitch, time, duration: 4, velocity: 0.6 }));
        const abcChord = `[${midiToAbc(rootPitch)}8${midiToAbc(thirdPitch)}8]`;
        currentLh += abcChord + " ";
      } else {
        // Rest - Force explicit rest to ensure staff visibility
        // If we just leave it empty, abcjs might hide the staff
        currentLh += "z8 ";
      }

      if (bar === 1) currentLh += "!*! ";
      currentLh += "| ";
    }

    if (s === 15) currentRh += "\"rit.\" ";
    if (s === 16) currentRh += "\"a tempo\" ";
    if ((s + 1) % 8 === 0) currentRh += ":| ";

    totalAbc += currentRh + "\n" + currentLh + "\n";

    if ((s + 1) % 4 === 0 && s < sections_internal - 1) {
      totalAbc += "%%newpage\n";
    }
  }

  const year = new Date().getFullYear();
  const composer = userName ? `${userName} (${year})` : "S.O.N.A.T.A. Stochastic Engine";

  // DEBUG: Log the final ABC to browser console for inspection
  const finalAbc = abcHeader + totalAbc;
  console.log('=== ABC NOTATION DEBUG ===');
  console.log(finalAbc);
  console.log('=== END ABC ===');

  return {
    abcNotation: finalAbc,
    tracks,
    title: dynamicTitle,
    composer,
    style,
    tempo,
    metadata: { title: dynamicTitle, composer, sections: sections_internal, isCore: true }
  } as any;
};

const isApiKeyPlaceholder = apiKey === 'PLACEHOLDER_API_KEY';

const proceduralCompose = (style: string, title?: string, userName?: string, instrument?: string, subtitle?: string): Composition => {
  const composed = generateAdvancedComposition(style, title, userName, instrument, subtitle);
  const normalized = normalizeComposition(composed);
  normalized.abcNotation = syncAbcNotation(normalized);
  return normalized;
};

export const generateAIPrompt = async (currentPrompt: string): Promise<string> => {
  if (isApiKeyPlaceholder) return `Stochastic symphonic orchestration of: ${currentPrompt || 'Something beautiful'}`;
  return withRetry(async () => {
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });
    const response = await model.generateContent(
      `Transform this into a professional symphonic orchestration prompt: "${currentPrompt || 'Something beautiful'}". Specify dynamics, motivic development, and specific orchestral textures.`
    );
    return response.response.text().trim();
  });
};

export const generateNegativePrompt = async (currentPrompt: string): Promise<string> => {
  if (isApiKeyPlaceholder) return "Avoid flat dynamics and static textures.";
  return withRetry(async () => {
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });
    const response = await model.generateContent(
      `List elements to AVOID for this symphonic concept: "${currentPrompt}". Focus on avoiding technical errors like parallel fifths or muddy bass.`
    );
    return response.response.text().trim();
  });
};

export const generateFullDraft = async (seed?: string): Promise<{ title: string, style: string, prompt: string, negativePrompt: string }> => {
  if (isApiKeyPlaceholder) {
    const titles = ["Sonata No. " + Math.floor(Math.random() * 9 + 1), "Prelude in A Minor", "Nocturne", "Etude No. 5", "Fantasia", "Concerto Movement"];
    return {
      title: titles[Math.floor(Math.random() * titles.length)],
      style: "Baroque",
      prompt: "A complex stochastic interplay of voices.",
      negativePrompt: "Simplistic repetition."
    };
  }
  return withRetry(async () => {
    const model = ai.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            style: { type: SchemaType.STRING },
            prompt: { type: SchemaType.STRING },
            negativePrompt: { type: SchemaType.STRING }
          },
          required: ["title", "style", "prompt", "negativePrompt"]
        }
      }
    });
    const response = await model.generateContent(
      `Generate a symphonic vision based on: "${seed || 'Surprise me'}". Provide JSON with title, style, prompt, and negativePrompt.`
    );
    return JSON.parse(response.response.text());
  });
};

export const composeMusic = async (
  prompt: string,
  negativePrompt: string,
  style: string,
  title?: string,
  forceProcedural: boolean = false,
  userName?: string,
  instrument?: string,
  subtitle?: string
): Promise<Composition> => {
  if (isApiKeyPlaceholder || forceProcedural) {
    return proceduralCompose(style, title, userName, instrument, subtitle);
  }

  const systemInstruction = `
    You are S.O.N.A.T.A., an Elite Orchestral AI Composer.
    
    CRITICAL: YOU MUST GENERATE NOTES SEQUENTIALLY.
    - Each track must have a progression of notes over time.
    - Use 'time' as an absolute beat counter from the start (0, 0.5, 1, 1.5...).
    
    GRAND STAFF ABC NOTATION:
    - ALWAYS generate ABC notation using two voices for piano pieces: V:RH (Treble) and V:LH (Bass).
    - Use %%score {RH | LH} for the Grand Staff.
    - Include T: (Title), T: (Subtitle), and C: (Composer).
    - Use L:1/8 and M:4/4 with proper bar groupings (|). Keep 8 measures per page.
    - Both voices must be aligned in time (simultaneous bars), with rests where needed.
    - If a note is below the treble staff, place it in the bass voice.
    - Keep melodic range tight and avoid erratic leaps; favor motif development and clear cadence points.
    - Prefer stepwise motion; limit leaps to 6 semitones except for cadences.
    - Use balanced phrase structure (4+4 or 8+8 bars).
    
    ADVANCED MUSICAL QUALITY:
    - COUNTERPOINT: Ensure RH (Treble) and LH (Bass) interact meaningfully.
    - HARMONY: Use sophisticated chords (7ths, 9ths, suspensions) appropriate for ${style}.
    - PHRASING: Vary durations and velocities to create "human" feeling. No mechanical blocks.
  `;

  return withRetry(async () => {
    const model = ai.getGenerativeModel({
      model: "gemini-2.0-pro-exp-02-05",
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            composer: { type: SchemaType.STRING },
            tempo: { type: SchemaType.NUMBER },
            abcNotation: { type: SchemaType.STRING },
            tracks: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  instrument: { type: SchemaType.STRING },
                  volume: { type: SchemaType.NUMBER },
                  notes: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        pitch: { type: SchemaType.INTEGER },
                        time: { type: SchemaType.NUMBER },
                        duration: { type: SchemaType.NUMBER },
                        velocity: { type: SchemaType.NUMBER }
                      },
                      required: ["pitch", "time", "duration", "velocity"]
                    }
                  }
                },
                required: ["instrument", "notes", "volume"]
              }
            }
          },
          required: ["title", "composer", "tempo", "tracks", "abcNotation"]
        }
      }
    });

    const response = await model.generateContent({
      contents: [{
        role: "user", parts: [{
          text: `Compose a professional symphony titled "${title || 'New Work'}" in the style of ${style}.
      Vision: ${prompt}.
      Avoid: ${negativePrompt}.
      LENGTH: At least 32-64 measures. Make it musically complex and chronologically sequential.` }]
      }],
    });

    let composition: Composition = JSON.parse(response.response.text());
    composition.style = style;
    composition = normalizeComposition(composition);
    composition.abcNotation = syncAbcNotation(composition);
    return composition;
  });
};

// RE-GENERATES ABC FROM COMPOSITION DATA
export const syncAbcNotation = (composition: Composition): string => {
  const { title, subtitle, composer, tempo, tracks } = composition;
  const { rh, lh } = splitToGrandStaff(tracks || []);
  const rhNotes = [...(rh.notes || [])].sort((a, b) => a.time - b.time);
  const lhNotes = [...(lh.notes || [])].sort((a, b) => a.time - b.time);

  const rhClef: 'treble' | 'bass' = 'treble';
  const lhClef: 'treble' | 'bass' = 'bass';

  const instrumentName = rh.instrument || "Piano";
  let abcHeader = `X:1\nT:${title}\n`;
  if (subtitle) abcHeader += `T:${subtitle}\n`;
  abcHeader += `C:${composer}\n`;
  abcHeader += `%%titlefont Playfair-Display 48\n%%subtitlefont Playfair-Display 24\n%%composerfont Inter 12\n%%staffsep 45\n%%syssep 45\n%%staffnames 1\n%%score {RH | LH}\n`;
  abcHeader += `L:1/8\nQ:1/4=${tempo}\nM:4/4\nK:Am\n`;
  abcHeader += `V:RH clef=${rhClef} name="${instrumentName}"\nV:LH clef=${lhClef}\n`;

  const beatsPerMeasure = 4;
  const ticksPerBeat = 1 / TIME_GRID;
  const ticksPerMeasure = beatsPerMeasure * ticksPerBeat;
  const barsPerLine = 4;
  const linesPerPage = 8;

  const toTicksTime = (value: number) => Math.max(0, Math.round(value / TIME_GRID));
  const toTicksDuration = (value: number) => Math.max(1, Math.round(value / TIME_GRID));
  const lengthFromTicks = (ticks: number) => {
    const eighths = ticks / 2;
    if (eighths === 1) return "";
    if (eighths === 0.5) return "/2";
    if (Number.isInteger(eighths)) return `${eighths}`;
    const numerator = Math.round(eighths * 2);
    return `${numerator}/2`;
  };

  type TimedNote = Note & { timeTicks: number; durationTicks: number };

  const buildTimeMap = (notes: Note[]) => {
    const byTime = new Map<number, TimedNote[]>();
    notes.forEach(n => {
      const timeTicks = toTicksTime(n.time);
      const durationTicks = toTicksDuration(n.duration);
      const list = byTime.get(timeTicks) || [];
      list.push({ ...n, timeTicks, durationTicks });
      byTime.set(timeTicks, list);
    });
    const allTimes = [...byTime.keys()].sort((a, b) => a - b);
    return { byTime, allTimes };
  };

  const renderMeasure = (byTime: Map<number, TimedNote[]>, allTimes: number[], measureIndex: number) => {
    let output = "";
    let cursor = measureIndex * ticksPerMeasure;
    const measureEnd = (measureIndex + 1) * ticksPerMeasure;
    while (cursor < measureEnd) {
      const notesAtTime = byTime.get(cursor);
      if (notesAtTime && notesAtTime.length) {
        const durationTicks = Math.max(...notesAtTime.map(n => n.durationTicks));
        const chord = notesAtTime.map(n => midiToAbc(n.pitch)).join("");
        const noteText = notesAtTime.length > 1 ? `[${chord}]` : chord;
        output += `${noteText}${lengthFromTicks(durationTicks)} `;
        cursor += durationTicks;
        continue;
      }
      const nextTime = allTimes.find(t => t > cursor && t < measureEnd);
      const gap = (nextTime ?? measureEnd) - cursor;
      output += `z${lengthFromTicks(gap)} `;
      cursor += gap;
    }
    return output;
  };

  const rhMap = buildTimeMap(rhNotes);
  const lhMap = buildTimeMap(lhNotes);

  const globalMaxTick = Math.max(
    rhNotes.length ? Math.max(...rhNotes.map(n => toTicksTime(n.time) + toTicksDuration(n.duration))) : 0,
    lhNotes.length ? Math.max(...lhNotes.map(n => toTicksTime(n.time) + toTicksDuration(n.duration))) : 0,
    ticksPerMeasure
  );
  const minMeasures = linesPerPage * barsPerLine;
  const totalMeasures = Math.max(minMeasures, Math.ceil(globalMaxTick / ticksPerMeasure));

  let body = "";
  for (let m = 0; m < totalMeasures; m++) {
    if (m % barsPerLine === 0) {
      body += `[V:RH clef=${rhClef}] `;
    }
    body += renderMeasure(rhMap.byTime, rhMap.allTimes, m);
    body += "| ";

    const isLineEnd = (m + 1) % barsPerLine === 0 || m === totalMeasures - 1;
    if (isLineEnd) {
      body += "\n";
      body += `[V:LH clef=${lhClef}] `;
      const lineStart = Math.max(0, m - (barsPerLine - 1));
      const lineEnd = m + 1;
      for (let lm = lineStart; lm < lineEnd; lm++) {
        body += renderMeasure(lhMap.byTime, lhMap.allTimes, lm);
        body += "| ";
      }
      body += "\n";

      const lineIndex = Math.floor(m / barsPerLine);
      if (lineIndex === 0) body += "M:none\n";
      if ((lineIndex + 1) % linesPerPage === 0 && m < totalMeasures - 1) {
        body += "%%newpage\n";
      }
    }
  }

  return abcHeader + body;
};
