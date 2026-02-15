import { Composition, Note, Track } from "../types";

const PITCH_SPLIT = 60; // Middle C
const DIVISIONS = 8; // divisions per quarter
const BEATS_PER_MEASURE = 4;
const TICKS_PER_MEASURE = DIVISIONS * BEATS_PER_MEASURE;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const midiToPitch = (midi: number) => {
  const steps = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const step = steps[midi % 12];
  const alter = alters[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
};

const splitToGrandStaff = (tracks: Track[]) => {
  const allNotes = tracks.flatMap(t => t.notes || []);
  const rh: Note[] = [];
  const lh: Note[] = [];
  allNotes.forEach(n => {
    if (n.pitch < PITCH_SPLIT) lh.push(n);
    else rh.push(n);
  });
  rh.sort((a, b) => (a.time - b.time) || (a.pitch - b.pitch));
  lh.sort((a, b) => (a.time - b.time) || (a.pitch - b.pitch));
  return { rh, lh };
};

const toTicks = (beats: number) => Math.max(0, Math.round(beats * DIVISIONS));

const buildMeasureMap = (notes: Note[]) => {
  const byTime = new Map<number, Note[]>();
  notes.forEach(n => {
    const timeTicks = toTicks(n.time);
    const durationTicks = Math.max(1, toTicks(n.duration));
    const list = byTime.get(timeTicks) || [];
    list.push({ ...n, duration: durationTicks });
    byTime.set(timeTicks, list);
  });
  const allTimes = [...byTime.keys()].sort((a, b) => a - b);
  return { byTime, allTimes };
};

const renderMeasure = (byTime: Map<number, Note[]>, allTimes: number[], measureIndex: number, staff: number) => {
  const measureStart = measureIndex * TICKS_PER_MEASURE;
  const measureEnd = (measureIndex + 1) * TICKS_PER_MEASURE;
  let cursor = measureStart;
  let xml = "";

  while (cursor < measureEnd) {
    const notesAtTime = byTime.get(cursor);
    if (notesAtTime && notesAtTime.length) {
      const durationTicks = Math.max(...notesAtTime.map(n => n.duration as number));
      notesAtTime.forEach((n, idx) => {
        const { step, alter, octave } = midiToPitch(n.pitch);
        xml += `<note>${idx > 0 ? "<chord/>" : ""}<pitch><step>${step}</step>${alter !== 0 ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch><duration>${durationTicks}</duration><voice>1</voice><staff>${staff}</staff></note>`;
      });
      cursor += durationTicks;
      continue;
    }
    const nextTime = allTimes.find(t => t > cursor && t < measureEnd);
    const gap = (nextTime ?? measureEnd) - cursor;
    const duration = clamp(gap, 1, TICKS_PER_MEASURE);
    xml += `<note><rest/><duration>${duration}</duration><voice>1</voice><staff>${staff}</staff></note>`;
    cursor += duration;
  }

  return xml;
};

export const generateMusicXml = (composition: Composition): string => {
  const { title, composer, tempo, tracks } = composition;
  const { rh, lh } = splitToGrandStaff(tracks || []);
  const instrumentName = tracks?.[0]?.instrument || "Piano";

  const rhMap = buildMeasureMap(rh);
  const lhMap = buildMeasureMap(lh);

  const maxTick = Math.max(
    rh.length ? Math.max(...rh.map(n => toTicks(n.time) + toTicks(n.duration))) : 0,
    lh.length ? Math.max(...lh.map(n => toTicks(n.time) + toTicks(n.duration))) : 0,
    TICKS_PER_MEASURE
  );
  const totalMeasures = Math.max(1, Math.ceil(maxTick / TICKS_PER_MEASURE));

  let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
  xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`;
  xml += `<score-partwise version="3.1">`;
  xml += `<work><work-title>${title}</work-title></work>`;
  xml += `<identification><creator type="composer">${composer}</creator></identification>`;
  xml += `<part-list><score-part id="P1"><part-name>${instrumentName}</part-name></score-part></part-list>`;
  xml += `<part id="P1">`;

  for (let m = 0; m < totalMeasures; m++) {
    xml += `<measure number="${m + 1}">`;
    if (m === 0) {
      xml += `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
      xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type></direction>`;
    }
    xml += renderMeasure(rhMap.byTime, rhMap.allTimes, m, 1);
    xml += renderMeasure(lhMap.byTime, lhMap.allTimes, m, 2);
    xml += `</measure>`;
  }

  xml += `</part></score-partwise>`;
  return xml;
};

export const downloadMusicXml = (composition: Composition) => {
  const xml = generateMusicXml(composition);
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${composition.title.replace(/\s+/g, "_")}.musicxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
