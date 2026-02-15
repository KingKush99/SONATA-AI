
import * as React from 'react';
const { useEffect, useRef, useState } = React;
import abcjs from 'abcjs';
import { Composition, InstrumentType } from '../types';
import { downloadMidi } from '../services/midiService';
import { downloadMusicXml } from '../services/musicXmlService';

interface SheetMusicProps {
  composition: Composition;
  abcNotation: string;
  currentSeconds: number;
  durationSeconds: number;
  titleFont: string;
  isPlaying: boolean;
  selectedInstruments?: InstrumentType[];
  onSeek?: (seconds: number) => void;
  onTogglePlay?: () => void;
  onThemeChange?: (themeId: string) => void;
}

export const SheetMusic: React.FC<SheetMusicProps> = ({ composition, abcNotation, currentSeconds, durationSeconds, titleFont, isPlaying, selectedInstruments, onTogglePlay, onSeek, onThemeChange }) => {
  const [zoom, setZoom] = useState(1.0);
  const [fitScale, setFitScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(0);
  const [uiPlaybackSeconds, setUiPlaybackSeconds] = useState(0);
  const PAGE_WIDTH = 2100;
  const PAGE_HEIGHT = 2100;
  const STAFF_WIDTH = 1600;
  const STAFF_PADDING_LEFT = 160;
  const STAFF_PADDING_RIGHT = 160;
  const STAFF_SCALE = 0.9;
  const [pageSize] = useState(PAGE_HEIGHT);
  const [pageWidth] = useState(PAGE_WIDTH);
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  const renderHostRef = useRef<HTMLDivElement>(null);
  const timingCallbacksRefs = useRef<any[]>([]);
  const uiPlaybackSecondsRef = useRef(0);
  const uiPlaybackRafRef = useRef<number | null>(null);

  const containerScale = fitScale;

  // Split ABC into pages, preserving headers
  const pages = React.useMemo(() => {
    if (!abcNotation) return [];
    const lines = abcNotation.split('\n');
    const headerLines: string[] = [];
    let i = 0;
    while (i < lines.length && (/^[A-Za-z]:/.test(lines[i]) || lines[i].startsWith('%%'))) {
      headerLines.push(lines[i]);
      i++;
    }
    const header = headerLines.join('\n') + '\n';
    const bodies = abcNotation.split(/\n%%newpage\s*\n/);
    return bodies.map((body, idx) => (idx === 0 ? body : header + body));
  }, [abcNotation]);
  const pageDurationSeconds = React.useMemo(() => {
    if (!pages.length) return Math.max(1, durationSeconds || 1);
    return Math.max(0.25, (durationSeconds || 1) / pages.length);
  }, [durationSeconds, pages.length]);
  const toLocalSeconds = (globalSeconds: number, pageIndex: number) =>
    Math.max(0, Math.min(pageDurationSeconds, globalSeconds - pageIndex * pageDurationSeconds));
  const normalizeVoiceLabels = React.useCallback((abc: string) => {
    return abc
      .replace(/(\bname=)"[^"]*"/g, '$1"Inst"')
      .replace(/(\bnm=)"[^"]*"/g, '$1"Inst"');
  }, []);

  useEffect(() => {
    if (!pagesContainerRef.current || pages.length === 0) return;
    const pageEl = pagesContainerRef.current;
    pageEl.style.display = 'flex';
    pageEl.style.alignItems = 'center';
    pageEl.style.justifyContent = 'center';
    const renderHost = renderHostRef.current;
    if (!renderHost) return;
    renderHost.innerHTML = '';
    timingCallbacksRefs.current.forEach(tc => tc?.stop());
    timingCallbacksRefs.current = [];

    // Only render the current page
    const pageAbc = pages[currentPage];
    if (!pageAbc) return;
    const stablePageAbc = normalizeVoiceLabels(pageAbc);

    const pageScale = 1.0;

    const renderDiv = document.createElement('div');
    renderDiv.id = `page-render-${currentPage}`;
    renderDiv.className = "w-full h-full";
    renderDiv.style.display = "flex";
    renderDiv.style.alignItems = "center";
    renderDiv.style.justifyContent = "center";
    renderDiv.style.padding = "0";
    renderHost.appendChild(renderDiv);

    const tunes = abcjs.renderAbc(renderDiv, stablePageAbc, {
      staffwidth: STAFF_WIDTH,
      add_classes: true,
      scale: STAFF_SCALE,
      paddingleft: STAFF_PADDING_LEFT,
      paddingright: STAFF_PADDING_RIGHT,
      format: {
        titlefont: `${titleFont} 56 bold`,
        composerfont: "Inter 12 bold",
        subtitlefont: `${titleFont} 28 italic`,
      }
    });

    const svg = renderDiv.querySelector('svg') as SVGSVGElement | null;
    if (svg) {
      const bbox = svg.getBBox();
      const pad = 24;
      svg.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
      svg.setAttribute('width', `${PAGE_WIDTH}`);
      svg.setAttribute('height', `${PAGE_HEIGHT}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.display = 'block';
      svg.style.margin = '0 auto';
      svg.style.overflow = 'visible';
      svg.style.display = 'block';
      svg.style.position = 'absolute';
      svg.style.left = '50%';
      svg.style.top = '50%';
      svg.style.transform = 'translate(-50%, -50%)';
      console.log('Sheet SVG bbox:', bbox, 'page', { w: PAGE_WIDTH, h: PAGE_HEIGHT });

      const ensureText = (className: string, text: string, attrs: Record<string, string>) => {
        let el = svg.querySelector(`.${className}`) as SVGTextElement | null;
        if (!el) {
          el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          el.setAttribute('class', className);
          el.textContent = text;
          svg.appendChild(el);
        }
        Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
        return el;
      };

      const titleText = composition?.title || 'Untitled';
      ensureText('abcjs-title', titleText, {
        'text-anchor': 'middle',
        'x': `${bbox.x + bbox.width / 2}`,
        'y': `${bbox.y + 40}`,
      });

      const composerText = composition?.composer || '';
      if (composerText) {
        ensureText('abcjs-composer', composerText, {
          'text-anchor': 'end',
          'x': `${bbox.x + bbox.width}`,
          'y': `${bbox.y + 40}`,
        });
      }

      const fromTracks = (composition?.tracks || [])
        .map((t: any) => t?.instrument)
        .filter((v: any) => typeof v === 'string' && v.trim().length > 0) as string[];
      const fromSelected = (selectedInstruments || []).map(i => String(i)).filter(Boolean);
      const source = fromSelected.length > 0 ? fromSelected : fromTracks;
      const instruments = Array.from(new Set(source.map(v => v.trim()).filter(Boolean)));
      svg.querySelectorAll('.abcjs-instrument-extra, .abcjs-instrument-overlay').forEach((n) => n.remove());
      if (instruments.length > 0) {
        const MAX_VISIBLE_INSTRUMENT_LINES = 4;
        const lineTexts = (() => {
          if (instruments.length <= MAX_VISIBLE_INSTRUMENT_LINES) {
            return instruments.map((name, idx) => (idx < instruments.length - 1 ? `${name},` : name));
          }
          const visible = instruments.slice(0, MAX_VISIBLE_INSTRUMENT_LINES - 1).map((name) => `${name},`);
          visible.push(`+${instruments.length - (MAX_VISIBLE_INSTRUMENT_LINES - 1)} more`);
          return visible;
        })();
        const geometryNodes = Array.from(
          svg.querySelectorAll('.abcjs-barline, .abcjs-bar, .abcjs-clef, .abcjs-staff, .abcjs-note, .abcjs-rest, .abcjs-brace')
        ) as SVGGraphicsElement[];
        let geometryLeftX = bbox.x + 110;
        geometryNodes.forEach((node) => {
          if (!node?.getBBox) return;
          const b = node.getBBox();
          if (Number.isFinite(b.x)) geometryLeftX = Math.min(geometryLeftX, b.x);
        });
        const noOverlapX = geometryLeftX - 16;

        const textNodes = Array.from(svg.querySelectorAll('text')) as SVGTextElement[];
        // Hide ABCJS-generated left labels so staff geometry position never changes with custom names.
        const leftLaneLabels = textNodes.filter((t) => {
          const x = Number(t.getAttribute('x') || '0');
          const y = Number(t.getAttribute('y') || '0');
          if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
          if (t.classList.contains('abcjs-title') || t.classList.contains('abcjs-composer')) return false;
          return x < bbox.x + 80 && y > bbox.y + 60;
        });
        leftLaneLabels.forEach((t) => t.setAttribute('visibility', 'hidden'));

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'abcjs-instrument-overlay');
        const pageLeftX = bbox.x + 12;
        const anchorX = pageLeftX - 19;
        const available = Math.max(20, noOverlapX - anchorX - 6);
        const baseY = leftLaneLabels.length > 0
          ? Number(leftLaneLabels[0].getAttribute('y') || `${bbox.y + 118}`)
          : (bbox.y + 118);
        const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        probe.setAttribute('visibility', 'hidden');
        probe.setAttribute('font-family', 'Times New Roman');
        probe.setAttribute('font-weight', '600');
        svg.appendChild(probe);

        const fittedFontSize = 11;
        const measureMaxWidth = () => {
          probe.setAttribute('font-size', `${fittedFontSize}`);
          let width = 0;
          lineTexts.forEach((txt) => {
            probe.textContent = txt;
            width = Math.max(width, probe.getComputedTextLength());
          });
          return width;
        };
        measureMaxWidth();
        probe.remove();

        const lineHeight = Math.max(12, Math.round(fittedFontSize * 1.25));
        const startY = baseY - ((lineTexts.length - 1) * lineHeight) / 2;
        lineTexts.forEach((name, idx) => {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          line.setAttribute('class', idx === 0 ? 'abcjs-instrument-base' : 'abcjs-instrument-extra');
          line.setAttribute('x', `${anchorX}`);
          line.setAttribute('y', `${startY + idx * lineHeight}`);
          line.setAttribute('text-anchor', 'start');
          line.setAttribute('font-size', `${fittedFontSize}`);
          line.setAttribute('font-family', 'Times New Roman');
          line.setAttribute('font-weight', '600');
          line.setAttribute('fill', '#1a1a1a');
          line.textContent = name;
          group.appendChild(line);
        });
        svg.appendChild(group);
      }
    }

    if (tunes && tunes.length > 0) {
      const tc = new (abcjs as any).TimingCallbacks(tunes[0], {
        eventCallback: (event: any) => {
          const allNotes = pageEl.querySelectorAll('.abcjs-note, .abcjs-rest');
          allNotes.forEach(n => n.classList.remove('abcjs-highlight'));
          if (event && event.elements && event.elements.length > 0) {
            event.elements.forEach((group: any) => {
              group.forEach((elem: any) => {
                if (!elem?.classList) return;
                if (elem.classList.contains('abcjs-note') || elem.classList.contains('abcjs-rest')) {
                  elem.classList.add('abcjs-highlight');
                }
              });
            });
          }
        }
      });
      timingCallbacksRefs.current.push(tc);
    }

    const handleNoteClick = (e: MouseEvent) => {
      if (isPlaying) {
        onTogglePlay?.();
        return;
      }
      const target = (e.target as HTMLElement | null)?.closest?.('.abcjs-note') as HTMLElement | null;
      if (!target || !timingCallbacksRefs.current.length || !onSeek) return;
      const idxAttr = target.getAttribute('data-index');
      const idx = idxAttr ? parseInt(idxAttr, 10) : NaN;
      const tc = timingCallbacksRefs.current[0] as any;
      if (!Number.isFinite(idx) || !tc?.noteTimings?.[idx]) return;
      const ms = tc.noteTimings[idx].milliseconds;
      onSeek(currentPage * pageDurationSeconds + ms / 1000);
      if (onTogglePlay) onTogglePlay();
    };

    pageEl.addEventListener('click', handleNoteClick);

    return () => {
      timingCallbacksRefs.current.forEach(tc => tc?.stop());
      pageEl.removeEventListener('click', handleNoteClick);
    };
  }, [pages, currentPage, zoom, containerScale, titleFont, composition?.title, composition?.composer, composition?.tracks, selectedInstruments, currentSeconds, isPlaying, pageDurationSeconds, normalizeVoiceLabels]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'ArrowLeft') {
        setCurrentPage(p => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentPage(p => Math.min(pages.length - 1, p + 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pages.length]);

  useEffect(() => {
    const updateFit = () => {
      const container = pagesContainerRef.current;
      if (!container) return;
      const host = container.parentElement;
      const bounds = host?.getBoundingClientRect();
      const viewportW = Math.min(bounds?.width ?? window.innerWidth, window.innerWidth);
      const containerTop = container.getBoundingClientRect().top;
      const viewportH = Math.max(0, window.innerHeight - containerTop - 24);
      const maxW = Math.max(0, viewportW - 24);
      const maxH = Math.max(0, viewportH - 24);
      const scale = Math.min(1, maxW / PAGE_WIDTH, maxH / PAGE_HEIGHT);
      setFitScale(Number.isFinite(scale) ? scale : 1);
    };
    updateFit();
    window.addEventListener('resize', updateFit);
    const host = pagesContainerRef.current?.parentElement;
    const ro = host ? new ResizeObserver(() => updateFit()) : null;
    if (host && ro) ro.observe(host);
    return () => {
      window.removeEventListener('resize', updateFit);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    timingCallbacksRefs.current.forEach(tc => {
      if (isPlaying) tc.start();
      else tc.stop();
    });
  }, [isPlaying]);

  const maxSeconds = React.useMemo(() => {
    const byPages = Math.max(1, pageDurationSeconds * Math.max(1, pages.length));
    return Math.max(1, durationSeconds || 0, byPages);
  }, [durationSeconds, pageDurationSeconds, pages.length]);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(currentSeconds, maxSeconds));
    if (!isPlaying) {
      uiPlaybackSecondsRef.current = clamped;
      setUiPlaybackSeconds(clamped);
      return;
    }
    if (Math.abs(clamped - uiPlaybackSecondsRef.current) > 0.4) {
      uiPlaybackSecondsRef.current = clamped;
      setUiPlaybackSeconds(clamped);
    }
  }, [currentSeconds, isPlaying, maxSeconds]);

  useEffect(() => {
    if (uiPlaybackRafRef.current) {
      cancelAnimationFrame(uiPlaybackRafRef.current);
      uiPlaybackRafRef.current = null;
    }
    if (!isPlaying) return;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.max(0, (now - last) / 1000);
      last = now;
      const next = Math.min(maxSeconds, uiPlaybackSecondsRef.current + delta);
      uiPlaybackSecondsRef.current = next;
      setUiPlaybackSeconds(next);
      if (isPlaying) {
        uiPlaybackRafRef.current = requestAnimationFrame(tick);
      }
    };
    uiPlaybackRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (uiPlaybackRafRef.current) {
        cancelAnimationFrame(uiPlaybackRafRef.current);
        uiPlaybackRafRef.current = null;
      }
    };
  }, [isPlaying, maxSeconds]);

  const playbackSeconds = isPlaying
    ? Math.max(currentSeconds, uiPlaybackSeconds)
    : currentSeconds;

  useEffect(() => {
    const localSeconds = toLocalSeconds(playbackSeconds, currentPage);
    timingCallbacksRefs.current.forEach(tc => tc.setProgress(localSeconds, "seconds"));
  }, [playbackSeconds, currentPage, pageDurationSeconds]);

  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    uiPlaybackSecondsRef.current = val;
    setUiPlaybackSeconds(val);
    onSeek?.(val);
  };

  const formatTime = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds));
    const m = Math.floor(safe / 60);
    const s = (safe % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const safeCurrentSeconds = Math.min(playbackSeconds, maxSeconds);
  const progressPercent = maxSeconds > 0 ? Math.min(100, Math.max(0, (safeCurrentSeconds / maxSeconds) * 100)) : 0;
  const progressPercentWhole = Math.round(progressPercent);

  useEffect(() => {
    if (!isPlaying || pages.length === 0) return;
    const safeDuration = Math.max(1, maxSeconds);
    const clamped = Math.max(0, Math.min(playbackSeconds, safeDuration));
    const normalized = Math.min(0.999999, clamped / safeDuration);
    const targetPage = Math.min(pages.length - 1, Math.floor(normalized * pages.length));
    if (targetPage !== currentPage) setCurrentPage(targetPage);
  }, [playbackSeconds, isPlaying, pages.length, currentPage, maxSeconds]);

  const getCurrentSvg = () => {
    const svg = pagesContainerRef.current?.querySelector('svg');
    if (!svg) return null;
    const serializer = new XMLSerializer();
    let svgText = serializer.serializeToString(svg);
    if (!svgText.includes("xmlns=")) {
      svgText = svgText.replace("<svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"");
    }
    return svgText;
  };

  const downloadSvg = () => {
    const svgText = getCurrentSvg();
    if (!svgText) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${composition.title.replace(/\s+/g, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPng = () => {
    const svgText = getCurrentSvg();
    if (!svgText) return;
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = window.devicePixelRatio || 1;
      const width = img.width || 800;
      const height = img.height || 1100;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      const pngUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `${composition.title.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const renderAllPagesSvgs = () => {
    const temp = document.createElement('div');
    const stableAbc = normalizeVoiceLabels(abcNotation);
    const tunes = abcjs.renderAbc(temp, stableAbc, {
      staffwidth: STAFF_WIDTH,
      add_classes: true,
      scale: STAFF_SCALE,
      paddingleft: STAFF_PADDING_LEFT,
      paddingright: STAFF_PADDING_RIGHT,
      format: {
        titlefont: `${titleFont} 56 bold`,
        composerfont: "Inter 12 bold",
        subtitlefont: `${titleFont} 28 italic`,
      }
    });
    if (!tunes || (tunes as any).length === 0) return null;
    const svgNodes = Array.from(temp.querySelectorAll('svg'));
    return svgNodes.map((svgEl) => {
      const serializer = new XMLSerializer();
      let svgText = serializer.serializeToString(svgEl);
      if (!svgText.includes('xmlns=')) {
        svgText = svgText.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      return svgText;
    });
  };

  const svgToJpegBytes = (svgText: string): Promise<{ bytes: Uint8Array; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const width = Math.max(1, Math.round(img.width || PAGE_WIDTH));
          const height = Math.max(1, Math.round(img.height || PAGE_HEIGHT));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas context unavailable');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const base64 = jpegDataUrl.split(',')[1] || '';
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          resolve({ bytes, width, height });
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG page for PDF export'));
      };
      img.src = url;
    });
  };

  const makePdfBlobFromJpegs = (pagesData: Array<{ bytes: Uint8Array; width: number; height: number }>) => {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    const offsets: number[] = [];

    const writeBytes = (bytes: Uint8Array) => {
      chunks.push(bytes);
      byteLength += bytes.length;
    };
    const writeAscii = (text: string) => {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      writeBytes(bytes);
    };

    const totalObjects = 2 + pagesData.length * 3;
    const pageObjectStart = 3;
    writeAscii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const beginObject = (id: number) => {
      offsets[id] = byteLength;
      writeAscii(`${id} 0 obj\n`);
    };
    const endObject = () => writeAscii('endobj\n');

    beginObject(1);
    writeAscii('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObject();

    beginObject(2);
    const kids = pagesData.map((_, i) => `${pageObjectStart + i * 3} 0 R`).join(' ');
    writeAscii(`<< /Type /Pages /Count ${pagesData.length} /Kids [${kids}] >>\n`);
    endObject();

    pagesData.forEach((page, i) => {
      const pageObj = pageObjectStart + i * 3;
      const contentObj = pageObj + 1;
      const imageObj = pageObj + 2;
      const widthPt = (page.width * 72) / 96;
      const heightPt = (page.height * 72) / 96;
      const content = `q\n${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm\n/Im${i + 1} Do\nQ\n`;

      beginObject(pageObj);
      writeAscii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /XObject << /Im${i + 1} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\n`
      );
      endObject();

      beginObject(contentObj);
      writeAscii(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`);
      endObject();

      beginObject(imageObj);
      writeAscii(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
      );
      writeBytes(page.bytes);
      writeAscii('\nendstream\n');
      endObject();
    });

    const xrefOffset = byteLength;
    writeAscii(`xref\n0 ${totalObjects + 1}\n`);
    writeAscii('0000000000 65535 f \n');
    for (let i = 1; i <= totalObjects; i++) {
      const off = offsets[i] || 0;
      writeAscii(`${off.toString().padStart(10, '0')} 00000 n \n`);
    }
    writeAscii(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return new Blob(chunks, { type: 'application/pdf' });
  };

  const downloadPdf = async () => {
    const svgs = renderAllPagesSvgs();
    if (!svgs || svgs.length === 0) return;
    try {
      const jpegPages = await Promise.all(svgs.map((svgText) => svgToJpegBytes(svgText)));
      const blob = makePdfBlobFromJpegs(jpegPages);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${composition.title.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed', err);
    }
  };

  const themeOptions = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'theme-clef', label: 'Clef' },
    { id: 'theme-staff', label: 'Staff' },
    { id: 'theme-notes', label: 'Notes' },
    { id: 'theme-harmony', label: 'Harmony' },
    { id: 'theme-chorale', label: 'Chorale' },
    { id: 'theme-sonata', label: 'Sonata' },
    { id: 'theme-arian', label: 'Aria' },
    { id: 'theme-fugue', label: 'Fugue' },
    { id: 'theme-rondo', label: 'Rondo' }
  ];
  const [theme, setTheme] = useState('dark');
  const [showThemes, setShowThemes] = useState(false);
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);

  return (
    <>
      <div
        ref={pagesContainerRef}
        className="relative page-surface manuscript-page shadow-2xl border border-stone-200 overflow-hidden my-8 mx-auto"
        onClickCapture={(e) => {
          if (!isPlaying) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('button, input, select, textarea, a')) return;
          onTogglePlay?.();
        }}
        style={{
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          maxWidth: '100%',
          maxHeight: '100%',
          transform: `scale(${zoom * containerScale})`,
          transformOrigin: 'center top'
        }}
      >
          <div ref={renderHostRef} className="absolute inset-0 flex items-center justify-center" />

          {pages.length > 0 && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
              {!isPlaying && (
                <button
                  onClick={() => {
                    onSeek?.(0);
                    onTogglePlay?.();
                  }}
                  className="pointer-events-auto w-40 h-40 rounded-full text-white shadow-2xl hover:scale-105 active:scale-95 transition-all duration-300 border border-white/10 flex items-center justify-center bg-[conic-gradient(from_45deg,#ff8a00,#ffd500,#00d084,#0091ff,#7b3ff2,#ff4fd8,#ff8a00)]"
                  title="Play"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-14 h-14 ml-1"><path d="M8 5v14l11-7z" /></svg>
                </button>
              )}
            </div>
          )}

          {pages.length > 0 && (
            <div className="absolute left-0 right-0 px-0 bottom-24 z-30 group">
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/80 text-white text-[10px] font-bold uppercase tracking-[0.15em] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {progressPercentWhole}% completed
              </div>
              <input
                type="range"
                min="0"
                max={maxSeconds}
                step="0.1"
                value={safeCurrentSeconds}
                onChange={handleTimelineChange}
                onMouseDown={() => { }}
                className="w-full h-4 bg-red-500/60 rounded-full appearance-none cursor-pointer transition-all sheet-progress"
                title={`${progressPercentWhole}% completed`}
                style={{
                  background: `linear-gradient(to right, #16a34a ${progressPercent}%, #ef4444 ${progressPercent}%)`
                }}
              />
            </div>
          )}

          {pages.length > 1 && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-12 flex items-center gap-4 z-30">
              <button
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-zinc-900 to-zinc-700 text-white/90 hover:text-white shadow-lg border border-black/20 transition-all"
              >
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-5 h-5"><path d="M15 18l-6-6 6-6" /></svg>
                  <span className="text-[10px] font-black uppercase tracking-[0.25em]">Back</span>
                </div>
              </button>

              <div className="text-[10px] font-black uppercase tracking-[0.3em] text-black/40">
                Page {currentPage + 1} / {pages.length}
              </div>

              <button
                disabled={currentPage === pages.length - 1}
                onClick={() => setCurrentPage(p => Math.min(pages.length - 1, p + 1))}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-zinc-900 to-zinc-700 text-white/90 hover:text-white shadow-lg border border-black/20 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em]">Next</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-5 h-5"><path d="M9 18l6-6-6-6" /></svg>
                </div>
              </button>
            </div>
          )}

          <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex items-center justify-center z-30">
            <div className="relative flex items-center justify-center">
              <div className="relative">
                <button
                  onClick={() => setShowDownloadOptions(v => !v)}
                  className="px-6 py-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 border border-emerald-700/30 text-[10px] font-black uppercase tracking-[0.25em] shadow-lg transition-all"
                >
                  Download
                </button>
                {showDownloadOptions && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col gap-2 bg-white shadow-2xl border border-black/10 rounded-2xl p-2 z-[300]">
                    <button onClick={() => { downloadMidi(composition); setShowDownloadOptions(false); }} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-black/5 hover:bg-black/10 text-black/70 text-left">MIDI File</button>
                    <button onClick={() => { downloadMusicXml(composition); setShowDownloadOptions(false); }} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-black/5 hover:bg-black/10 text-black/70 text-left">MusicXML</button>
                    <button onClick={() => { downloadSvg(); setShowDownloadOptions(false); }} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-black/5 hover:bg-black/10 text-black/70 text-left">SVG Vector</button>
                    <button onClick={() => { downloadPng(); setShowDownloadOptions(false); }} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-black/5 hover:bg-black/10 text-black/70 text-left">PNG Image</button>
                    <button onClick={() => { downloadPdf(); setShowDownloadOptions(false); }} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-black/5 hover:bg-black/10 text-black/70 text-left">PDF Score</button>
                  </div>
                )}
              </div>
            </div>
          </div>

      </div>
      <div className="fixed bottom-6 right-6 z-[200]">
        <div className="relative">
          <button
            onClick={() => setShowThemes(v => !v)}
            className="w-12 h-12 rounded-full border border-white/40 shadow-lg flex items-center justify-center bg-[conic-gradient(from_45deg,#ff8a00,#ffd500,#00d084,#0091ff,#7b3ff2,#ff4fd8,#ff8a00)]"
            title="Themes"
          >
            <div className="w-4 h-4 rounded-full bg-white/90 shadow-inner" />
          </button>
          {showThemes && (
            <div className="absolute bottom-full right-0 mb-3 grid grid-cols-3 gap-2 bg-white shadow-2xl border border-black/10 rounded-2xl p-3 w-[260px]">
              {themeOptions.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setTheme(opt.id);
                    setShowThemes(false);
                    onThemeChange?.(opt.id);
                  }}
                  className={`w-20 h-10 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] ${theme === opt.id ? 'bg-black/10 text-black' : 'bg-black/5 hover:bg-black/10 text-black/70'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <style>{`
        .abcjs-highlight {
          fill: #4f46e5 !important;
          stroke: #4f46e5 !important;
          stroke-width: 0.5px;
          filter: drop-shadow(0 0 2px rgba(79, 70, 229, 0.4));
        }
        .manuscript-page .abcjs-note, 
        .manuscript-page path, 
        .manuscript-page text {
          fill: #1a1a1a !important;
          stroke: #1a1a1a !important;
          transition: fill 0.2s, stroke 0.2s;
        }
        .manuscript-page .abcjs-staff {
          stroke: #222 !important;
          stroke-width: 1.0 !important;
          opacity: 1 !important;
          visibility: visible !important;
          display: block !important;
        }
        .manuscript-page .abcjs-staff path,
        .manuscript-page .abcjs-staff line {
          opacity: 1 !important;
          visibility: visible !important;
          display: block !important;
        }
        .manuscript-page .abcjs-highlight path {
          fill: #4f46e5 !important;
          stroke: #4f46e5 !important;
        }
        .manuscript-page svg {
          overflow: visible !important;
        }
        .abcjs-title {
          text-anchor: middle !important;
        }
        .abcjs-composer {
          text-anchor: end !important;
          font-style: italic !important;
          opacity: 0.8 !important;
        }
        .abcjs-subtitle {
          font-style: italic !important;
        }
        .page-surface {
          background: #ffffff;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 0;
        }
        .sheet-progress::-webkit-slider-thumb {
          appearance: none;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: #111111;
          border: 2px solid #ffffff;
          box-shadow: 0 6px 16px rgba(0,0,0,0.25);
        }
        .sheet-progress::-moz-range-thumb {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: #111111;
          border: 2px solid #ffffff;
          box-shadow: 0 6px 16px rgba(0,0,0,0.25);
        }
        .sheet-progress::-webkit-slider-runnable-track {
          height: 8px;
          border-radius: 999px;
          background: rgba(0,0,0,0.15);
        }
        .sheet-progress::-moz-range-track {
          height: 8px;
          border-radius: 999px;
          background: rgba(0,0,0,0.15);
        }
      `}</style>
    </>
  );
};

