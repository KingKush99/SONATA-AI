
import MidiWriter from 'midi-writer-js';
import { Composition, Note } from '../types';

export const generateMidiBlob = (composition: Composition): Blob => {
  const tracks: any[] = [];
  
  composition.tracks.forEach((compTrack) => {
    const track = new MidiWriter.Track();
    track.setTempo(composition.tempo);
    track.addTrackName(compTrack.instrument);

    compTrack.notes.forEach((note: Note) => {
      // Extended duration mapping for higher resolution MIDI
      const durationMapping: Record<number, string> = {
        0.125: '32', 0.25: '16', 0.5: '8', 0.75: '8t', 1: '4', 1.5: 'd4', 2: '2', 3: 'd2', 4: '1'
      };
      const duration = durationMapping[note.duration] || '4';

      track.addEvent(new MidiWriter.NoteEvent({
        pitch: [note.pitch],
        duration: duration,
        velocity: Math.floor(note.velocity * 100),
        startTick: Math.floor(note.time * 128)
      }));
    });
    tracks.push(track);
  });

  const write = new MidiWriter.Writer(tracks);
  const uint8Array = write.buildFile();
  return new Blob([uint8Array], { type: 'audio/midi' });
};

export const downloadMidi = (composition: Composition) => {
  const blob = generateMidiBlob(composition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${composition.title.replace(/\s+/g, '_')}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
