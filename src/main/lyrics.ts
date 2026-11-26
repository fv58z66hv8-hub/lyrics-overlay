import * as fs from 'fs';
import * as path from 'path';
import type { LyricLine, LyricsPayload } from '../shared/types';
import { norm, stripFeat } from './titleCleaner';

const API = 'https://lrclib.net/api';
const USER_AGENT = 'LyricsOverlay/0.1 (progetto personale, https://github.com)';
const MAX_CACHE = 500;

interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsQuery {
  title: string;
  artist: string;
  primaryArtist: string;
  duration: number;
  rawTitle: string;
}

// ---------- parser LRC ----------

/** Converte "[01:23.45]testo" in [{time: 83.45, text: "testo"}] (gestisce più tag sulla stessa riga). */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  const stampRe = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps: number[] = [];
    let lastEnd = 0;
    stampRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = stampRe.exec(raw)) !== null) {
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
      lastEnd = stampRe.lastIndex;
    }
    if (stamps.length === 0) continue; // righe di metadati tipo [ar:...] o vuote
    const text = raw.slice(lastEnd).replace(/<\d{1,2}:\d{2}(?:\.\d+)?>/g, '').trim();
    for (const t of stamps) out.push({ time: t, text });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Testo non sincronizzato: distribuisce le righe lungo la durata del brano. */
export function spreadPlain(plain: string, duration: number): LyricLine[] {
  const rows = plain.split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0);
  if (rows.length === 0) return [];
  const total = duration > 0 ? duration : rows.length * 4;
  const start = total * 0.06;
  const step = (total * 0.88) / rows.length;
  return rows.map((text, i) => ({ time: start + i * step, text }));
}

// ---------- scelta del risultato migliore ----------

function score(t: LrclibTrack, q: LyricsQuery): number {
  if (t.instrumental) return 60;
  let s: number;
  if (t.syncedLyrics) s = 100;
  else if (t.plainLyrics) s = 30;
  else return -1;

  if (q.duration > 0 && t.duration) {
    const d = Math.abs(t.duration - q.duration);
    s += d <= 2 ? 50 : d <= 5 ? 30 : d <= 12 ? 5 : -60;
  }
  const tTitle = norm(stripFeat(t.trackName));
  const qTitle = norm(stripFeat(q.title));
  if (tTitle === qTitle) s += 25;
  else if (tTitle.includes(qTitle) || qTitle.includes(tTitle)) s += 10;
  else s -= 30;

  const tArtist = norm(t.artistName);
  const qArtist = norm(q.primaryArtist || q.artist);
  if (qArtist && (tArtist.includes(qArtist) || qArtist.includes(tArtist))) s += 20;
  return s;
}

async function search(params: Record<string, string>): Promise<LrclibTrack[]> {
  const url = `${API}/search?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return (await res.json()) as LrclibTrack[];
}

function toPayload(t: LrclibTrack, duration: number): LyricsPayload {
  if (t.instrumental) return { status: 'instrumental', synced: false, lines: [] };
  if (t.syncedLyrics) return { status: 'found', synced: true, lines: parseLrc(t.syncedLyrics) };
  return { status: 'found', synced: false, lines: spreadPlain(t.plainLyrics ?? '', duration || t.duration || 0) };
}

// ---------- servizio con cache ----------

export class LyricsService {
  private cache = new Map<string, LyricsPayload>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cacheFile: string) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as [string, LyricsPayload][];
      this.cache = new Map(data);
    } catch {
      /* nessuna cache ancora */
    }
  }

  private key(q: LyricsQuery): string {
    return `${norm(q.primaryArtist || q.artist)}|${norm(q.title)}`;
  }

  async get(q: LyricsQuery, force = false): Promise<LyricsPayload> {
    const key = this.key(q);
    if (!force) {
      const hit = this.cache.get(key);
      if (hit) return hit;
    }

    const attempts: Record<string, string>[] = [];
    if (q.title && q.artist) attempts.push({ track_name: q.title, artist_name: q.artist });
    if (q.title && q.primaryArtist && q.primaryArtist !== q.artist)
      attempts.push({ track_name: q.title, artist_name: q.primaryArtist });
    if (q.title) attempts.push({ q: `${q.primaryArtist || q.artist} ${stripFeat(q.title)}`.trim() });
    if (q.rawTitle && q.rawTitle !== q.title) attempts.push({ q: q.rawTitle });

    let best: LrclibTrack | null = null;
    let bestScore = -Infinity;
    let networkError = false;

    for (const params of attempts) {
      try {
        const results = await search(params);
        for (const t of results) {
          const s = score(t, q);
          if (s > bestScore) {
            best = t;
            bestScore = s;
          }
        }
      } catch (e) {
        networkError = true;
        console.warn('[lyrics] errore ricerca', params, (e as Error).message);
      }
      if (bestScore >= 150) break; // sincronizzato + durata e titolo coincidono: basta così
    }

    if (!best || bestScore < 40) {
      return { status: networkError ? 'error' : 'notfound', synced: false, lines: [] };
    }

    const payload = toPayload(best, q.duration);
    this.cache.set(key, payload);
    this.scheduleSave();
    return payload;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const entries = [...this.cache.entries()].slice(-MAX_CACHE);
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFile(this.cacheFile, JSON.stringify(entries), () => undefined);
    }, 2000);
  }
}
