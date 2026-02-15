
export type InstrumentType = 'Piano' | 'Violin' | 'Cello' | 'Flute' | 'Clarinet' | 'Trumpet' | 'Harp' | 'Percussion';

export interface Note {
  pitch: number;      // MIDI pitch
  time: number;       // Start time in beats
  duration: number;   // Duration in beats
  velocity: number;   // 0-1
  fingering?: string; // e.g., "_1", "_5"
  dynamic?: string;   // e.g., "!p!", "!ff!"
  slurStart?: boolean;
  slurEnd?: boolean;
}

export interface Track {
  instrument: InstrumentType;
  notes: Note[];
  volume: number;     // 0-1
}

export interface Composition {
  title: string;
  subtitle?: string;  // Added field
  composer: string;
  style: string;
  tempo: number;
  tracks: Track[];
  abcNotation: string;
}

export enum AppState {
  IDLE = 'IDLE',
  COMPOSING = 'COMPOSING',
  READY = 'READY',
  PLAYING = 'PLAYING',
  ERROR = 'ERROR'
}
