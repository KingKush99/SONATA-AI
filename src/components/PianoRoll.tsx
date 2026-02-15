
import React, { useState, useRef, useEffect } from 'react';
import { Composition, Note, InstrumentType } from '../types';

interface PianoRollProps {
  composition: Composition | null;
  currentTime: number;
  onUpdateNote: (trackIndex: number, noteIndex: number, updatedNote: Note) => void;
}

const INSTRUMENT_COLORS: Record<string, string> = {
  Piano: '#6366f1', Violin: '#f43f5e', Cello: '#8b5cf6', Flute: '#22d3ee', Clarinet: '#fbbf24', Trumpet: '#f97316', Harp: '#10b981'
};

export const PianoRoll: React.FC<PianoRollProps> = ({ composition, currentTime, onUpdateNote }) => {
  const [dragging, setDragging] = useState<{ trackIdx: number, noteIdx: number, startX: number, startY: number, originalNote: Note } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!composition || composition.tracks.length === 0) return null;

  const allNotes = composition.tracks.flatMap(t => t.notes);
  const minPitch = Math.min(...allNotes.map(n => n.pitch), 48) - 5;
  const maxPitch = Math.max(...allNotes.map(n => n.pitch), 72) + 5;
  const pitchRange = maxPitch - minPitch;
  const maxTime = Math.max(...allNotes.map(n => n.time + n.duration), 16);

  const width = 1600;
  const height = 600;
  const padding = 40;

  const getX = (time: number) => (time / maxTime) * (width - 2 * padding) + padding;
  const getY = (pitch: number) => height - ((pitch - minPitch) / (pitchRange || 1)) * (height - 2 * padding) - padding;

  const handleMouseDown = (e: React.MouseEvent, trackIdx: number, noteIdx: number, note: Note) => {
    e.stopPropagation();
    setDragging({ trackIdx, noteIdx, startX: e.clientX, startY: e.clientY, originalNote: { ...note } });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    
    const dxPx = (e.clientX - dragging.startX) * scaleX;
    const dyPx = (e.clientY - dragging.startY) * scaleY;
    
    // Map pixel change back to beats and pitch
    const dxBeats = (dxPx / (width - 2 * padding)) * maxTime;
    const dyPitch = -Math.round((dyPx / (height - 2 * padding)) * pitchRange);

    const updatedNote = {
      ...dragging.originalNote,
      time: Math.max(0, dragging.originalNote.time + dxBeats),
      pitch: Math.min(127, Math.max(0, dragging.originalNote.pitch + dyPitch))
    };
    
    onUpdateNote(dragging.trackIdx, dragging.noteIdx, updatedNote);
  };

  const handleMouseUp = () => setDragging(null);

  const cursorX = getX(currentTime);

  return (
    <div className="w-full overflow-x-auto bg-[#09090b]/40 rounded-3xl border border-white/5 relative custom-scrollbar select-none"
         onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseUp}>
      <svg width={width} height={height} className="min-w-full" ref={svgRef} viewBox={`0 0 ${width} ${height}`}>
        {/* Pitch Stripes */}
        {Array.from({ length: pitchRange + 1 }).map((_, i) => {
          const pitch = minPitch + i;
          const isBlackKey = [1, 3, 6, 8, 10].includes(pitch % 12);
          return (
            <rect key={`pitch-${i}`} x={0} y={getY(pitch) - 5} width={width} height={10} fill={isBlackKey ? "rgba(255,255,255,0.02)" : "transparent"} />
          );
        })}

        {/* Timeline Beat Lines */}
        {Array.from({ length: Math.ceil(maxTime) + 1 }).map((_, i) => (
          <line key={`beat-${i}`} x1={getX(i)} y1={0} x2={getX(i)} y2={height} stroke={i % 4 === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.02)"} strokeWidth={i % 4 === 0 ? 1.5 : 1} />
        ))}

        {/* Notes */}
        {composition.tracks.map((track, tIdx) => (
          <g key={tIdx}>
            {track.notes.map((note, nIdx) => {
              const x = getX(note.time);
              const y = getY(note.pitch);
              const w = Math.max(2, (note.duration / maxTime) * (width - 2 * padding));
              const isActive = currentTime >= note.time && currentTime <= note.time + note.duration;
              const color = INSTRUMENT_COLORS[track.instrument] || '#fff';
              return (
                <rect 
                  key={`${tIdx}-${nIdx}`} 
                  x={x} 
                  y={y - 4} 
                  width={w} 
                  height={8} 
                  rx={2} 
                  fill={isActive ? '#fff' : color} 
                  className={`cursor-move hover:brightness-125 transition-all ${dragging?.noteIdx === nIdx && dragging?.trackIdx === tIdx ? 'opacity-80 scale-105' : ''}`}
                  onMouseDown={(e) => handleMouseDown(e, tIdx, nIdx, note)}
                  style={{ filter: isActive ? `drop-shadow(0 0 8px ${color})` : 'none' }} 
                />
              );
            })}
          </g>
        ))}

        {/* Single Pro Playhead */}
        <g className="pointer-events-none">
          <line x1={cursorX} y1={0} x2={cursorX} y2={height} stroke="#3b82f6" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 5px rgba(59,130,246,0.6))' }} />
          <rect x={cursorX - 10} y={0} width={20} height={20} fill="rgba(59,130,246,0.2)" stroke="#3b82f6" strokeWidth="1" rx={2} />
          <path d={`M ${cursorX - 6} 20 L ${cursorX + 6} 20 L ${cursorX} 28 Z`} fill="#3b82f6" />
        </g>
      </svg>
    </div>
  );
};
