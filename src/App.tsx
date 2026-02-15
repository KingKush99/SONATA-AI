import * as React from 'react';
const { useState, useEffect, useRef, useCallback } = React;
import * as Tone from 'tone';
import {
  Play, Square, Download, Music, Sparkles, Loader2, Music2,
  Wand2, Zap, Dices, Edit3, XCircle, Type as TypeIcon, Plus
} from 'lucide-react';
import { Composition, AppState, Note, InstrumentType } from './types';
import { composeMusic, generateAIPrompt, generateNegativePrompt, generateFullDraft, syncAbcNotation } from './services/geminiService';
import { importAudioFile } from './services/audioImport';
import { PianoRoll } from './components/PianoRoll';
import { SheetMusic } from './components/SheetMusic';

const STYLE_PRESETS = [
  "Beethoven", "Bach", "Mozart", "Chopin", "Jazz",
  "Cyberpunk", "Minimalist", "Epic", "Lo-Fi", "Synthwave", "Baroque", "Romantic"
];

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [styles, setStyles] = useState<string[]>(['Beethoven']);
  const [customStyle, setCustomStyle] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('SONATA_API_KEY') || '');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [scoreFont, setScoreFont] = useState('Playfair Display');
  const [composition, setComposition] = useState<Composition | null>(null);
  const [currentBeats, setCurrentBeats] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'sheet' | 'piano' | 'upload' | 'history'>('sheet');
  const [uiZoom, setUiZoom] = useState(1.0);
  const [transcribeTipIndex, setTranscribeTipIndex] = useState(0);
  const [isUploadingActive, setIsUploadingActive] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const [uploadSeconds, setUploadSeconds] = useState(0);
  const [uploadNow, setUploadNow] = useState(Date.now());
  const uploadTimerRef = useRef<number | null>(null);
  const uploadRafRef = useRef<number | null>(null);
  const uploadHideRef = useRef<number | null>(null);
  const transcribeStartRef = useRef<number | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingNegative, setIsGeneratingNegative] = useState(false);
  const [isAutoDrafting, setIsAutoDrafting] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeEta, setTranscribeEta] = useState<number | null>(null);
  const [siteTheme, setSiteTheme] = useState('dark');
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [forceCore, setForceCore] = useState(false);
  const [userName, setUserName] = useState('');
  const [selectedInstruments, setSelectedInstruments] = useState<InstrumentType[]>(['Piano']);
  const [isSeeking, setIsSeeking] = useState(false);
  const [history, setHistory] = useState<Array<Composition & { _id: string }>>([]);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [historyDraft, setHistoryDraft] = useState({ title: '', subtitle: '', composer: '', font: '' });
  const instrumentLabel = selectedInstruments.length > 0 ? selectedInstruments.join(', ') : 'Piano';
  const assignInstrumentsToTracks = useCallback((tracks: any[]) => {
    const fallback: InstrumentType[] = selectedInstruments.length ? selectedInstruments : ['Piano'];
    const ordered = [...fallback];
    if (ordered.length > 1) {
      const last = ordered[ordered.length - 1];
      ordered.pop();
      ordered.unshift(last);
    }
    return tracks.map((t, idx) => ({ ...t, instrument: ordered[idx % ordered.length] }));
  }, [selectedInstruments]);

  const resolveInstrument = useCallback((value: any, idx: number): InstrumentType => {
    const known: InstrumentType[] = ['Piano', 'Violin', 'Cello', 'Flute', 'Clarinet', 'Trumpet', 'Harp', 'Percussion'];
    const ordered = selectedInstruments.length ? [...selectedInstruments] : ['Piano'];
    if (ordered.length > 1) {
      const last = ordered[ordered.length - 1];
      ordered.pop();
      ordered.unshift(last);
    }
    if (typeof value === 'string') {
      const candidates = value
        .split(',')
        .map(v => v.trim())
        .filter(v => known.includes(v as InstrumentType)) as InstrumentType[];
      if (candidates.length > 0) {
        const preferred = ordered.find(i => candidates.includes(i));
        return preferred || candidates[candidates.length - 1];
      }
      const match = ordered.find(k => value.includes(k)) || known.find(k => value.includes(k));
      if (match) return match as InstrumentType;
    }
    return (ordered[idx % ordered.length] || 'Piano') as InstrumentType;
  }, [selectedInstruments]);
  const alertTimeoutRef = useRef<number | null>(null);

  const synthsRef = useRef<Map<InstrumentType, any>>(new Map());
  const playbackRef = useRef<number | null>(null);
  const partsRef = useRef<Tone.Part[]>([]);
  const [isLoadingSamples, setIsLoadingSamples] = useState(true);

  useEffect(() => {
    localStorage.setItem('SONATA_API_KEY', apiKey);
  }, [apiKey]);

  useEffect(() => {
    const limiter = new Tone.Limiter(-1).toDestination();
    const mainCompressor = new Tone.Compressor({ threshold: -20, ratio: 4 }).connect(limiter);
    const reverb = new Tone.Reverb({ decay: 5, wet: 0.3, preDelay: 0.2 }).connect(mainCompressor);
    const orchestraBus = new Tone.Gain(0.45).connect(reverb);

    // High-quality piano sample plus distinct synth voices per instrument.
    const SALAMANDER_URL_BASE = "https://tonejs.github.io/audio/salamander/";

    const createInstrument = (inst: InstrumentType) => {
      if (inst === 'Piano') {
        const sampler = new Tone.Sampler({
        urls: {
          "A0": "A0.mp3",
          "C1": "C1.mp3",
          "D#1": "Ds1.mp3",
          "F#1": "Fs1.mp3",
          "A1": "A1.mp3",
          "C2": "C2.mp3",
          "D#2": "Ds2.mp3",
          "F#2": "Fs2.mp3",
          "A2": "A2.mp3",
          "C3": "C3.mp3",
          "D#3": "Ds3.mp3",
          "F#3": "Fs3.mp3",
          "A3": "A3.mp3",
          "C4": "C4.mp3",
          "D#4": "Ds4.mp3",
          "F#4": "Fs4.mp3",
          "A4": "A4.mp3",
          "C5": "C5.mp3",
          "D#5": "Ds5.mp3",
          "F#5": "Fs5.mp3",
          "A5": "A5.mp3",
          "C6": "C6.mp3",
          "D#6": "Ds6.mp3",
          "F#6": "Fs6.mp3",
          "A6": "A6.mp3",
          "C7": "C7.mp3",
          "D#7": "Ds7.mp3",
          "F#7": "Fs7.mp3",
          "A7": "A7.mp3",
          "C8": "C8.mp3"
        },
          release: 1,
          onload: () => {
            console.log("All Samples Loaded");
            setIsLoadingSamples(false);
          },
          baseUrl: SALAMANDER_URL_BASE
        }).connect(orchestraBus);
        return sampler;
      }
      if (inst === 'Violin') {
        return new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2.5,
          modulationIndex: 8,
          envelope: { attack: 0.05, decay: 0.25, sustain: 0.7, release: 0.8 },
          modulation: { type: 'sine' }
        }).connect(orchestraBus);
      }
      if (inst === 'Cello') {
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.08, decay: 0.3, sustain: 0.75, release: 1.1 }
        }).connect(orchestraBus);
      }
      if (inst === 'Flute') {
        return new Tone.PolySynth(Tone.AMSynth, {
          harmonicity: 1.2,
          envelope: { attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.5 }
        }).connect(orchestraBus);
      }
      if (inst === 'Clarinet') {
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: { attack: 0.03, decay: 0.2, sustain: 0.55, release: 0.5 }
        }).connect(orchestraBus);
      }
      if (inst === 'Trumpet') {
        return new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 12,
          envelope: { attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.35 }
        }).connect(orchestraBus);
      }
      if (inst === 'Harp') {
        return new Tone.PolySynth(Tone.MonoSynth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.005, decay: 0.25, sustain: 0.05, release: 0.5 },
          filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0.0, release: 0.2, baseFrequency: 400, octaves: 3 }
        }).connect(orchestraBus);
      }
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0.02, release: 0.12 },
        filterEnvelope: { attack: 0.001, decay: 0.08, sustain: 0.0, release: 0.08, baseFrequency: 180, octaves: 4 }
      }).connect(orchestraBus);
    };

    const instruments: InstrumentType[] = ['Piano', 'Violin', 'Cello', 'Flute', 'Clarinet', 'Trumpet', 'Harp', 'Percussion'];
    instruments.forEach(inst => {
      const instrument = createInstrument(inst);
      synthsRef.current.set(inst, instrument);
    });

    reverb.ready.then(() => console.log("Hall Reverb Ready"));

    return () => {
      synthsRef.current.forEach(s => s.dispose());
      reverb.dispose();
      orchestraBus.dispose();
      mainCompressor.dispose();
      limiter.dispose();
    };
  }, []);

  const stopPlayback = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    partsRef.current.forEach(p => p.dispose());
    partsRef.current = [];
    if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
    setState(AppState.READY);
    setCurrentBeats(0);
  }, []);

  const startPlayback = async () => {
    if (!composition) return;
    if (Tone.getContext().state !== 'running') await Tone.start();

    stopPlayback();

    const bpm = composition.tempo || 120;
    Tone.Transport.bpm.value = bpm;
    const startSeconds = currentSeconds;
    Tone.Transport.seconds = startSeconds;

    composition.tracks.forEach((track, idx) => {
      const instrumentsForTrack: InstrumentType[] =
        composition.tracks.length === 1 && selectedInstruments.length > 1
          ? selectedInstruments
          : [resolveInstrument(track.instrument, idx)];
      const synths = instrumentsForTrack
        .map(inst => synthsRef.current.get(inst))
        .filter(Boolean);
      if (!synths.length) return;

      // Crucial: Sort notes by time and ensure we schedule using Part for timing accuracy
      const sortedNotes = [...track.notes].sort((a, b) => a.time - b.time);
      const part = new Tone.Part((time, note: Note) => {
        synths.forEach((synth: any) => {
          synth.triggerAttackRelease(
            Tone.Frequency(note.pitch, "midi").toFrequency(),
            note.duration * (60 / bpm),
            time,
            note.velocity * track.volume * 0.38
          );
        });
      }, sortedNotes.map(n => [n.time * (60 / bpm), n]));

      part.start(0, startSeconds);
      partsRef.current.push(part);
    });

    Tone.Transport.start("+0.1");
    setState(AppState.PLAYING);

    const updateUI = () => {
      const seconds = Tone.Transport.seconds;
      const beats = seconds * (bpm / 60);
      setCurrentSeconds(seconds);
      setCurrentBeats(beats);

      const allNotes = composition.tracks.flatMap(t => t.notes);
      const pieceDurationBeats = allNotes.length > 0 ? Math.max(...allNotes.map(n => n.time + n.duration)) : 16;

      if (beats > pieceDurationBeats + 2) {
        stopPlayback();
      } else if (Tone.Transport.state === 'started') {
        playbackRef.current = requestAnimationFrame(updateUI);
      }
    };
    playbackRef.current = requestAnimationFrame(updateUI);
  };

  const handleSeek = useCallback((seconds: number) => {
    Tone.Transport.seconds = seconds;
    setCurrentSeconds(seconds);
    const bpm = composition?.tempo || 120;
    setCurrentBeats(seconds * (bpm / 60));
  }, [composition]);

  const handleTimelineDrag = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    handleSeek(val);
  };

  const showAlert = useCallback((message: string) => {
    setError(message);
    if (alertTimeoutRef.current) {
      window.clearTimeout(alertTimeoutRef.current);
    }
    alertTimeoutRef.current = window.setTimeout(() => {
      setError(null);
      alertTimeoutRef.current = null;
    }, 5000);
  }, []);

  const addToHistory = useCallback((comp: Composition) => {
    const id = (globalThis.crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const withId = { ...(comp as any), _id: id } as Composition & { _id: string };
    setHistory(prev => {
      const next = [withId, ...prev];
      return next.slice(0, 20);
    });
  }, []);

  const updateHistory = useCallback((id: string, updates: Partial<Composition>) => {
    setHistory(prev => prev.map(h => (h._id === id ? { ...h, ...updates } : h)));
    if (composition && (composition as any)._id === id) {
      const next = { ...composition, ...updates } as Composition;
      next.abcNotation = syncAbcNotation(next);
      setComposition(next);
    }
  }, [composition]);

  useEffect(() => {
    return () => {
      if (alertTimeoutRef.current) {
        window.clearTimeout(alertTimeoutRef.current);
      }
    };
  }, []);

  const missingFields = React.useMemo(() => {
    const activeStyles = [...styles];
    if (customStyle.trim()) activeStyles.push(customStyle.trim());
    const missing: string[] = [];
    if (!title.trim()) missing.push("Title");
    if (!userName.trim()) missing.push("Artist Name");
    if (!prompt.trim()) missing.push("Musical Vision");
    if (!negativePrompt.trim()) missing.push("Negative Prompt");
    if (activeStyles.length === 0) missing.push("Style");
    if (selectedInstruments.length === 0) missing.push("Instrument");
    return missing;
  }, [title, userName, prompt, negativePrompt, styles, customStyle, selectedInstruments]);

  const handleCompose = async () => {
    const activeStyles = [...styles];
    if (customStyle.trim()) activeStyles.push(customStyle.trim());

    if (missingFields.length > 0) {
      showAlert(`Please fill: ${missingFields.join(", ")}`);
      return;
    }

    setState(AppState.COMPOSING);
    setError(null);
    try {
      // Use forceCore or fallback if API key is placeholder
      const instrumentLabel = selectedInstruments.join(', ');
      const result = await composeMusic(prompt, negativePrompt, activeStyles.join(', '), title, forceCore, userName, instrumentLabel as any, subtitle);
      const composed = { ...result };
      if (subtitle.trim()) composed.subtitle = subtitle.trim();
      if (userName.trim()) {
        const year = new Date().getFullYear();
        composed.composer = `${userName.trim()} (${year})`;
      }
      composed.tracks = assignInstrumentsToTracks(composed.tracks);
      composed.abcNotation = syncAbcNotation(composed);
      setComposition(composed);
      addToHistory(composed);
      setState(AppState.READY);
    } catch (err: any) {
      console.error(err);
      showAlert('The AI conductor is busy. Please try a simpler vision.');
      setState(AppState.ERROR);
    }
  };

  const handleUpdateNote = (trackIndex: number, noteIndex: number, updatedNote: Note) => {
    if (!composition) return;
    const newTracks = JSON.parse(JSON.stringify(composition.tracks));
    newTracks[trackIndex].notes[noteIndex] = updatedNote;

    // Sync ABC notation immediately after note update
    const newComposition = { ...composition, tracks: newTracks };
    newComposition.abcNotation = syncAbcNotation(newComposition);

    setComposition(newComposition);
  };

  useEffect(() => {
    if (!composition) return;
    const current = composition.tracks?.[0]?.instrument;
    if (current === instrumentLabel) return;
    const updated = {
      ...composition,
      tracks: assignInstrumentsToTracks(composition.tracks)
    };
    updated.abcNotation = syncAbcNotation(updated);
    setComposition(updated);
  }, [selectedInstruments, assignInstrumentsToTracks]);

  const addCustomStyle = useCallback(() => {
    const next = customStyle.trim();
    if (!next) return;
    setStyles(prev => (prev.includes(next) ? prev : [...prev, next]));
    setCustomStyle('');
  }, [customStyle]);

  const suggestCustomStyle = useCallback(() => {
    const available = STYLE_PRESETS.filter(s => !styles.includes(s));
    const pool = available.length > 0 ? available : STYLE_PRESETS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setCustomStyle(pick);
  }, [styles]);

  const durationSeconds = React.useMemo(() => {
    if (!composition) return 0;
    const bpm = composition.tempo || 120;
    const allNotes = composition.tracks.flatMap(t => t.notes);
    const maxBeats = allNotes.length > 0 ? Math.max(...allNotes.map(n => n.time + n.duration)) : 0;
    return Math.max(1, maxBeats * (60 / bpm));
  }, [composition]);

  const transcribeTips = [
    "Best results come from a single melody or clear instrument lines.",
    "Trim long intros/outros for faster transcription.",
    "Avoid heavy reverb or room noise when possible.",
    "Higher quality audio yields better note detection.",
    "Shorter clips generate faster and with fewer errors.",
    "Complex chords may be approximated in the score."
  ];

  useEffect(() => {
    if (!isUploadingActive) return;
    setTranscribeTipIndex(0);
    const id = window.setInterval(() => {
      console.log('[Tips] rotate');
      setTranscribeTipIndex(i => (i + 1) % transcribeTips.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [isUploadingActive, transcribeTips.length]);

  useEffect(() => {
    if (!isUploadingActive) return;
    console.log(`[Tips] index=${transcribeTipIndex}`);
  }, [transcribeTipIndex, isUploadingActive]);

  useEffect(() => {
    if (!isUploadingActive) return;
    const id = window.setInterval(() => {
      setDotCount(c => (c + 1) % 4);
    }, 500);
    return () => window.clearInterval(id);
  }, [isUploadingActive]);

  useEffect(() => {
    console.log(`[UploadTimer] isUploadingActive=${isUploadingActive}`);
    if (!isUploadingActive) {
      if (uploadTimerRef.current) {
        window.clearInterval(uploadTimerRef.current);
        uploadTimerRef.current = null;
      }
      if (uploadRafRef.current) {
        cancelAnimationFrame(uploadRafRef.current);
        uploadRafRef.current = null;
      }
      if (uploadHideRef.current) {
        window.clearTimeout(uploadHideRef.current);
        uploadHideRef.current = null;
      }
      setUploadSeconds(0);
      setUploadNow(Date.now());
      transcribeStartRef.current = null;
      return;
    }
    transcribeStartRef.current = Date.now();
    setUploadSeconds(0);
    setUploadNow(Date.now());
    uploadTimerRef.current = window.setInterval(() => {
      const start = transcribeStartRef.current ?? Date.now();
      const elapsed = (Date.now() - start) / 1000;
      setUploadSeconds(elapsed);
      setUploadNow(Date.now());
      console.log(`[UploadTimer] elapsed=${elapsed}s start=${start} now=${Date.now()}`);
    }, 100);
    return () => {
      if (uploadTimerRef.current) {
        window.clearInterval(uploadTimerRef.current);
        uploadTimerRef.current = null;
      }
    };
  }, [isUploadingActive]);

  const elapsedDisplayPrecise = `${Math.floor(uploadSeconds)}`;

  useEffect(() => {
    if (!isResizingSidebar) return;
    const updateWidth = (clientX: number) => {
      const next = Math.min(600, Math.max(280, clientX));
      setSidebarWidth(next);
    };
    const onPointerMove = (e: PointerEvent) => updateWidth(e.clientX);
    const onMouseMove = (e: MouseEvent) => updateWidth(e.clientX);
    const onUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar]);

  const formatComposer = useCallback((name: string) => {
    if (!name.trim()) return '';
    const year = new Date().getFullYear();
    return `${name.trim()} (${year})`;
  }, []);

  const themeClass = siteTheme === 'dark'
    ? 'bg-[#0b0b0d] text-[#fafafa]'
    : siteTheme === 'light'
      ? 'bg-[#efece6] text-[#111113]'
      : `theme-root ${siteTheme} text-[#fafafa]`;

  return (
    <div className={`min-h-screen flex flex-col font-sans ${themeClass}`}>
      <nav className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-transparent backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.location.reload()}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg">
              <Music2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-widest uppercase text-white">S.O.N.A.T.A.</span>
          </div>
        </div>
        <div />
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className="flex-none min-w-[280px] max-w-[600px] overflow-auto border-r border-white/5 bg-[#09090b] flex flex-col overflow-y-auto custom-scrollbar shadow-2xl z-10"
          style={{ width: sidebarWidth }}
        >
          <div className="p-6 space-y-6 pb-20">
            


            <button
              onClick={async () => {
                setIsAutoDrafting(true);
                const d = await generateFullDraft(prompt);
                setTitle(d.title);
                setStyles([d.style]);
                setPrompt(d.prompt);
                setNegativePrompt(d.negativePrompt);
                setIsAutoDrafting(false);
              }}
              disabled={isAutoDrafting}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl py-4 flex items-center justify-center gap-3 shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] group relative overflow-hidden"
            >
              {isAutoDrafting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Dices className="w-5 h-5 group-hover:rotate-12 transition-transform" />}
              <span className="text-[11px] font-black uppercase tracking-[0.2em]">Auto-Draft Masterpiece</span>
              <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            </button>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">API Key (Optional)</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter Gemini API key..."
                className="w-full bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
                Stored locally in this browser only.
              </p>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Composition Title</label>
              <div className="relative group">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    const newTitle = e.target.value;
                    setTitle(newTitle);
                    if (composition) {
                      const newComp = { ...composition, title: newTitle };
                      newComp.abcNotation = syncAbcNotation(newComp);
                      setComposition(newComp);
                    }
                  }}
                  placeholder="Symphony in C Minor..."
                  className="w-full bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
                />
                <button
                  onClick={async () => {
                    setIsAutoDrafting(true);
                    const d = await generateFullDraft(prompt);
                    setTitle(d.title);
                    setIsAutoDrafting(false);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-all opacity-100"
                  title="Refine Title"
                >
                  <Dices className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Subtitle (Optional)</label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => {
                  const next = e.target.value;
                  setSubtitle(next);
                  if (composition) {
                    const newComp = { ...composition, subtitle: next };
                    newComp.abcNotation = syncAbcNotation(newComp);
                    setComposition(newComp);
                  }
                }}
                placeholder="No. 1 in C Minor..."
                className="w-full bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Artist Name</label>
              </div>
              <input type="text" value={userName} onChange={(e) => {
                const newName = e.target.value;
                setUserName(newName);
                if (composition) {
                  const newComp = { ...composition, composer: formatComposer(newName) };
                  newComp.abcNotation = syncAbcNotation(newComp);
                  setComposition(newComp);
                }
              }} placeholder="Your Name (Artist)..." className="w-full bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50" />
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Your Style</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customStyle}
                  onChange={(e) => setCustomStyle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomStyle();
                    }
                  }}
                  placeholder="Type your own style..."
                  className="flex-1 bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
                <button
                  onClick={suggestCustomStyle}
                  className="p-3 rounded-xl text-[10px] font-bold uppercase border border-white/5 bg-indigo-500/10 text-indigo-300 hover:text-white hover:border-indigo-500/40 transition-all"
                  title="Suggest a style"
                >
                  <Dices className="w-4 h-4" />
                </button>
                <button
                  onClick={addCustomStyle}
                  className="px-4 py-3 rounded-xl text-[10px] font-bold uppercase border border-white/5 bg-zinc-900 text-zinc-400 hover:text-white hover:border-white/20 transition-all"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Stylistic Preset</label>
              <div className="flex flex-wrap gap-1.5">
                {STYLE_PRESETS.map(s => (
                  <button key={s} onClick={() => setStyles(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])} className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase border transition-all ${styles.includes(s) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900 border-white/5 text-zinc-600 hover:border-white/20'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Score Font</label>
              <div className="relative">
                <select
                  value={scoreFont}
                  onChange={(e) => setScoreFont(e.target.value)}
                  className="w-full bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                >
                  <option>Playfair Display</option>
                  <option>Cinzel</option>
                  <option>EB Garamond</option>
                  <option>Libre Baskerville</option>
                  <option>Crimson Text</option>
                  <option>Cormorant Garamond</option>
                  <option>Cardo</option>
                  <option>Alegreya</option>
                  <option>Spectral</option>
                  <option>Lora</option>
                  <option>Vollkorn</option>
                  <option>Prata</option>
                  <option>Old Standard TT</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Musical Vision</label>
              <div className="relative group">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the melodic arc..."
                  className="w-full h-24 bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none resize-none placeholder:text-zinc-800 transition-all"
                />
                <button
                  onClick={async () => {
                    setIsGeneratingPrompt(true);
                    const p = await generateAIPrompt(prompt);
                    setPrompt(p);
                    setIsGeneratingPrompt(false);
                  }}
                  className="absolute right-2 top-2 p-2 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-all opacity-100"
                  title="Refine Vision"
                >
                  <Dices className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Orchestra Ensemble</label>
              <div className="grid grid-cols-2 gap-2">
                {['Piano', 'Violin', 'Cello', 'Flute', 'Clarinet', 'Trumpet', 'Harp', 'Percussion'].map(inst => (
                  <button
                    key={inst}
                    onClick={() => {
                      if (selectedInstruments.includes(inst as InstrumentType)) {
                        const next = selectedInstruments.filter(i => i !== inst);
                        setSelectedInstruments(next.length ? next : [inst as InstrumentType]);
                      } else {
                        // First change from default Piano should switch instrument, not layer over Piano.
                        if (selectedInstruments.length === 1 && selectedInstruments[0] === 'Piano') {
                          setSelectedInstruments([inst as InstrumentType]);
                        } else {
                          setSelectedInstruments([...selectedInstruments, inst as InstrumentType]);
                        }
                      }
                    }}
                    className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all border ${selectedInstruments.includes(inst as InstrumentType)
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                      : 'bg-[#18181b] border-white/5 text-zinc-500 hover:text-white'
                      }`}
                  >
                    {inst}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-indigo-500/5 rounded-xl border border-indigo-500/10 active:scale-95 transition-transform cursor-pointer" onClick={() => setForceCore(!forceCore)}>
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${forceCore ? 'bg-indigo-600 border-indigo-500' : 'bg-zinc-900 border-white/10'}`}>
                {forceCore && <Zap className="w-2.5 h-2.5 text-white" />}
              </div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer select-none">
                Offline Mode
              </label>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest block">Negative Prompt</label>
              <div className="relative group">
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="No fast drums..."
                  className="w-full h-20 bg-[#18181b] border border-white/5 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none resize-none placeholder:text-zinc-800 transition-all"
                />
                <button
                  onClick={async () => {
                    setIsGeneratingNegative(true);
                    const n = await generateNegativePrompt(prompt);
                    setNegativePrompt(n);
                    setIsGeneratingNegative(false);
                  }}
                  className="absolute right-2 top-2 p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all opacity-100"
                  title="Refine Negative Prompt"
                >
                  <Dices className="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              onClick={handleCompose}
              disabled={state === AppState.COMPOSING}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3 active:scale-[0.98] shadow-xl shadow-indigo-500/10"
            >
              {state === AppState.COMPOSING ? <><Loader2 className="w-5 h-5 animate-spin" /><span>Orchestrating...</span></> : <><Sparkles className="w-5 h-5" /><span>Generate Composition</span></>}
            </button>
            {error && (
              <div className="fixed inset-0 flex items-center justify-center z-[200] pointer-events-none">
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-4 shadow-2xl backdrop-blur-xl">
                  <p className="text-rose-300 text-[11px] font-bold uppercase text-center tracking-[0.25em]">
                    {error}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
        <div
          className="flex-none w-3 cursor-col-resize bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
          onPointerDown={(e) => {
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            setIsResizingSidebar(true);
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          title="Resize panel"
        />
        <main
          className="flex-1 flex flex-col p-8 overflow-y-auto overflow-x-hidden custom-scrollbar relative"
          onWheel={(e) => {
            if (!e.altKey) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            setUiZoom(z => Math.max(0.7, Math.min(1.5, parseFloat((z + delta).toFixed(2)))));
          }}
        >
          {isUploadingActive && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[200]">
              <div className="rounded-2xl border border-white/10 bg-black/80 px-6 py-4 shadow-2xl backdrop-blur-xl text-[12px] uppercase tracking-[0.25em] text-white/90 min-w-[520px]">
                <div className="text-center">
                  Uploading
                  <span className="loading-dots ml-2 align-middle">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="ml-3">{elapsedDisplayPrecise}s elapsed</span>
                </div>
                <div className="mt-3 h-3 rounded-full border border-white/20 overflow-hidden bg-white/10">
                  <div className="upload-scan-bar h-full" />
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-gradient-to-r from-amber-500/30 via-rose-500/30 to-violet-500/30 px-4 py-3 text-[11px] text-zinc-100 tracking-[0.2em] normal-case">
                  Tip: {transcribeTips[transcribeTipIndex]}
                </div>
              </div>
            </div>
          )}
          <div
            className="w-full flex flex-col items-center space-y-8"
            style={{ transform: `scale(${uiZoom})`, transformOrigin: 'top center' }}
          >
            <div className="flex items-center justify-center pb-4 border-b border-white/5">
              <div className="flex bg-[#18181b] rounded-full p-2 border border-white/5 w-[2000px] justify-center gap-2">
                <button onClick={() => setViewMode('sheet')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${viewMode === 'sheet' ? 'bg-[#27272a] text-white shadow-lg' : 'text-zinc-500'}`}>Score</button>
                <button onClick={() => setViewMode('piano')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${viewMode === 'piano' ? 'bg-[#27272a] text-white shadow-lg' : 'text-zinc-500'}`}>Editor</button>
                <button onClick={() => setViewMode('upload')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${viewMode === 'upload' ? 'bg-[#27272a] text-white shadow-lg' : 'text-zinc-500'}`}>Upload</button>
                <button
                  onClick={() => setViewMode('history')}
                  className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${viewMode === 'history' ? 'bg-[#27272a] text-white shadow-lg' : 'text-zinc-500'}`}
                >
                  History
                </button>
              </div>
            </div>

            {/* Main Controls - Center */}

            <div className="relative pb-24">
              {state === AppState.COMPOSING ? (
                <div className="h-[500px] flex flex-col items-center justify-center space-y-8">
                  <div className="w-16 h-16 border-t-2 border-indigo-500 rounded-full animate-spin" />
                  <p className="text-zinc-500 uppercase tracking-[0.5em] text-[10px] font-bold animate-pulse">Orchestrating Vision</p>
                </div>
              ) : viewMode === 'upload' ? (
                <div className="space-y-16 w-full">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="rounded-3xl border border-white/5 bg-[#0f0f12] p-8 shadow-2xl">
                    <div className="text-[13px] font-black uppercase tracking-[0.45em] text-zinc-300 mb-4">Upload Audio</div>
                    <div className="text-zinc-200 text-base leading-relaxed mb-4">
                      Import an <span className="font-bold text-white">MP3</span> or <span className="font-bold text-white">WAV</span> and generate structured sheet music automatically.
                    </div>
                    <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
                      <div className="text-emerald-200 text-sm md:text-base font-semibold leading-relaxed">
                        Accuracy is highest with clear, single-melody recordings. Dense polyphony will be approximated.
                      </div>
                    </div>
                    <div className="mb-6 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3">
                      <div className="text-indigo-100 text-sm md:text-base font-semibold leading-relaxed">
                        Typical upload and transcription time is <span className="font-black">30–60 seconds</span>.
                      </div>
                    </div>
                    <input
                      type="file"
                      accept=".mp3,.wav"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          transcribeStartRef.current = Date.now();
                          setUploadSeconds(0);
                          setUploadNow(Date.now());
                          setTranscribeTipIndex(0);
                          setDotCount(0);
                          setIsUploadingActive(true);
                          setIsTranscribing(true);
                          setTranscribeEta(null);
                          // Let React paint the overlay before heavy audio analysis starts.
                          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                          const comp = await importAudioFile(file, (progress, etaSeconds) => {
                            if (Number.isFinite(etaSeconds)) {
                              setTranscribeEta(Math.ceil(etaSeconds));
                            }
                          });
                          comp.tracks = assignInstrumentsToTracks(comp.tracks);
                          comp.abcNotation = syncAbcNotation(comp);
                          setComposition(comp);
                          addToHistory(comp);
                          setTitle(comp.title || '');
                          setUserName('');
                          setState(AppState.READY);
                          setViewMode('sheet');
                        } catch (err) {
                          console.error(err);
                          showAlert('Failed to import audio.');
                        } finally {
                          setIsTranscribing(false);
                          setTranscribeEta(null);
                          if (uploadHideRef.current) {
                            window.clearTimeout(uploadHideRef.current);
                          }
                          uploadHideRef.current = window.setTimeout(() => {
                            setIsUploadingActive(false);
                          }, 15000);
                        }
                      }}
                      className="block w-full text-sm text-zinc-400 file:mr-4 file:py-3 file:px-4 file:rounded-xl file:border-0 file:bg-indigo-600 file:text-white hover:file:bg-indigo-500"
                    />
                    </div>
                    
                  </div>
                </div>
              ) : viewMode === 'history' ? (
                <div className="w-full max-w-4xl">
                  <div className="rounded-3xl border border-white/5 bg-[#0f0f12] p-8 shadow-2xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-500 mb-6">Generation Bank</div>
                    {history.length === 0 ? (
                      <div className="text-zinc-500 text-[11px] uppercase tracking-[0.2em]">No generations yet.</div>
                    ) : (
                      <div className="space-y-4">
                        {history.map((h) => (
                          <div key={h._id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">
                                {h.title || 'Untitled'}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setComposition(h);
                                    setTitle(h.title || '');
                                    setUserName(h.composer || '');
                                    setViewMode('sheet');
                                  }}
                                  className="px-3 py-1 rounded-full bg-white/5 text-white/60 text-[10px] uppercase tracking-[0.2em]"
                                >
                                  Open
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingHistoryId(h._id);
                                    setHistoryDraft({
                                      title: h.title || '',
                                      subtitle: h.subtitle || '',
                                      composer: h.composer || '',
                                      font: scoreFont || 'Playfair Display'
                                    });
                                  }}
                                  className="px-3 py-1 rounded-full bg-white/5 text-white/60 text-[10px] uppercase tracking-[0.2em]"
                                >
                                  Edit
                                </button>
                              </div>
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mt-2">
                              {h.style || 'Draft'}
                            </div>
                            {editingHistoryId === h._id && (
                              <div className="mt-4 space-y-3">
                                <input
                                  value={historyDraft.title}
                                  onChange={(e) => setHistoryDraft(d => ({ ...d, title: e.target.value }))}
                                  placeholder="Title"
                                  className="w-full bg-[#18181b] border border-white/5 rounded-lg px-3 py-2 text-xs"
                                />
                                <input
                                  value={historyDraft.subtitle}
                                  onChange={(e) => setHistoryDraft(d => ({ ...d, subtitle: e.target.value }))}
                                  placeholder="Subtitle"
                                  className="w-full bg-[#18181b] border border-white/5 rounded-lg px-3 py-2 text-xs"
                                />
                                <input
                                  value={historyDraft.composer}
                                  onChange={(e) => setHistoryDraft(d => ({ ...d, composer: e.target.value }))}
                                  placeholder="Artist Name"
                                  className="w-full bg-[#18181b] border border-white/5 rounded-lg px-3 py-2 text-xs"
                                />
                                <input
                                  value={historyDraft.font}
                                  onChange={(e) => setHistoryDraft(d => ({ ...d, font: e.target.value }))}
                                  placeholder="Font"
                                  className="w-full bg-[#18181b] border border-white/5 rounded-lg px-3 py-2 text-xs"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      updateHistory(h._id, {
                                        title: historyDraft.title,
                                        subtitle: historyDraft.subtitle,
                                        composer: historyDraft.composer,
                                      });
                                      setScoreFont(historyDraft.font || scoreFont);
                                      setEditingHistoryId(null);
                                    }}
                                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-[10px] uppercase tracking-[0.2em]"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingHistoryId(null)}
                                    className="px-3 py-2 rounded-lg bg-white/5 text-white/60 text-[10px] uppercase tracking-[0.2em]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : composition ? (
                <div className="space-y-16">
                  {viewMode === 'sheet' ? (
                    <SheetMusic
                      composition={composition}
                      abcNotation={composition.abcNotation}
                      currentSeconds={currentSeconds}
                      durationSeconds={durationSeconds}
                      titleFont={scoreFont}
                      isPlaying={state === AppState.PLAYING}
                      selectedInstruments={selectedInstruments}
                      onTogglePlay={state === AppState.PLAYING ? stopPlayback : startPlayback}
                      onSeek={handleSeek}
                      onThemeChange={(themeId: string) => setSiteTheme(themeId)}
                    />
                  ) : (
                    <PianoRoll composition={composition} currentTime={currentBeats} onUpdateNote={handleUpdateNote} />
                  )}
                </div>
              ) : (
                <div className="w-[2000px] h-[2000px] border border-white/5 rounded-[64px] flex flex-col items-center justify-center text-zinc-900 bg-gradient-to-b from-white/[0.02] to-transparent relative">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[160px]" />
                  <Music2 className="w-24 h-24 opacity-5 mb-8 animate-pulse" />
                  <p className="uppercase tracking-[1em] text-[12px] font-black text-indigo-500/30">Looming Masterpiece</p>
                  <p className="text-[10px] text-zinc-800 mt-8 max-w-[240px] text-center uppercase tracking-[0.3em] leading-relaxed">Your symphonic journey begins with a single draft. Specify your style in the neural sidebar.</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div >
      <style>{`
        .theme-root.theme-clef {
          background: radial-gradient(circle at 20% 20%, rgba(255,255,255,0.06), transparent 45%),
                      radial-gradient(circle at 80% 30%, rgba(255,255,255,0.08), transparent 40%),
                      #101114;
        }
        .theme-root.theme-staff {
          background: repeating-linear-gradient(
            to bottom,
            rgba(255,255,255,0.08) 0px,
            rgba(255,255,255,0.08) 1px,
            transparent 1px,
            transparent 26px
          ), #0f1012;
        }
        .theme-root.theme-notes {
          background: radial-gradient(circle at 30px 30px, rgba(255,255,255,0.08) 2px, transparent 3px),
                      radial-gradient(circle at 80px 80px, rgba(255,255,255,0.06) 2px, transparent 3px),
                      #0f1012;
          background-size: 140px 140px;
        }
        .theme-root.theme-harmony {
          background: linear-gradient(135deg, rgba(255,255,255,0.04), transparent 60%),
                      repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 42px),
                      #0f1012;
        }
        .theme-root.theme-chorale {
          background: repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 30px),
                      #0f1012;
        }
        .theme-root.theme-sonata {
          background: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.06), transparent 60%),
                      #101115;
        }
        .theme-root.theme-arian {
          background: linear-gradient(90deg, rgba(255,255,255,0.05), transparent 50%),
                      #101114;
        }
        .theme-root.theme-fugue {
          background: repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 18px),
                      #0f1012;
        }
        .theme-root.theme-rondo {
          background: radial-gradient(circle at 20% 80%, rgba(255,255,255,0.05) 0, transparent 40%),
                      radial-gradient(circle at 80% 20%, rgba(255,255,255,0.05) 0, transparent 40%),
                      #0f1012;
        }
        .loading-dots {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .loading-dots span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.9);
          animation: dotPulse 1.2s infinite ease-in-out;
        }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
        .upload-scan-bar {
          width: 40%;
          background: linear-gradient(90deg, rgba(34,197,94,0.85), rgba(59,130,246,0.85), rgba(168,85,247,0.85));
          animation: scanBar 1.4s ease-in-out infinite;
        }
        @keyframes scanBar {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(260%); }
        }
      `}</style>
    </div >
  );
};

export default App;

