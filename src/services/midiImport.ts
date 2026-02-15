import { Midi } from "@tonejs/midi";
import { Composition, Track, Note, InstrumentType } from "../types";
import { normalizeComposition, syncAbcNotation } from "./geminiService";

export const importMidiFile = async (file: File): Promise<Composition> => {
  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);

  const tempo = midi.header.tempos?.[0]?.bpm || 120;
  const toBeats = (seconds: number) => seconds * (tempo / 60);

  const tracks: Track[] = [];
  midi.tracks.forEach((t) => {
    const notes: Note[] = t.notes.map((n) => ({
      pitch: n.midi,
      time: toBeats(n.time),
      duration: toBeats(n.duration),
      velocity: n.velocity || 0.7,
    }));
    if (notes.length === 0) return;
    tracks.push({
      instrument: "Piano" as InstrumentType,
      volume: 0.8,
      notes,
    });
  });

  if (tracks.length === 0) {
    throw new Error("No notes found in MIDI.");
  }

  let composition: Composition = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    composer: "Imported MIDI",
    style: "Imported",
    tempo,
    tracks,
    abcNotation: "",
  };

  composition = normalizeComposition(composition);
  composition.abcNotation = syncAbcNotation(composition);
  return composition;
};
