// Pulisce titoli e artisti "sporchi", soprattutto quelli di YouTube:
//   "Måneskin - Beggin' (Official Video) [4K]"  con artista "MåneskinVEVO"
//   →  titolo "Beggin'", artista "Måneskin"

const JUNK =
  /\b(official|offizielles|ufficiale|video|videoclip|clip|lyrics?|lyric video|testo|audio|visuali[sz]er|hd|hq|4k|8k|remaster(ed)?|live|mv|m\/v|explicit|clean|prod\.?|out now)\b/i;

const BROWSERS = /chrome|msedge|edge|firefox|opera|brave|vivaldi|arc/i;

export interface CleanedTrack {
  title: string;
  artist: string;
  /** Primo artista, senza "feat." e collaboratori */
  primaryArtist: string;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^["“”«»\s]+|["“”«»\s]+$/g, '').trim();
}

export function stripFeat(s: string): string {
  return s.replace(/\s*[\(\[]?\s*(ft\.?|feat\.?|featuring)\s.+$/i, '').trim();
}

export function cleanTrack(rawTitle: string, rawArtist: string, app = ''): CleanedTrack {
  let title = rawTitle ?? '';
  let artist = rawArtist ?? '';

  // 1. togli parentesi che contengono parole "spazzatura"
  title = title.replace(/[\(\[【][^\)\]】]*[\)\]】]/g, (m) => (JUNK.test(m) ? ' ' : m));
  // 2. togli tutto dopo " | " o " // "
  title = title.split(/\s[|｜]\s|\s\/\/\s/)[0];
  // 3. ripulisci il nome del canale YouTube
  artist = artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(Official|Ufficiale)$/i, '')
    .trim();

  // 4. "Artista - Titolo" nel titolo (tipico di YouTube)
  const fromBrowser = BROWSERS.test(app);
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && (fromBrowser || !artist)) {
    artist = dash[1];
    title = dash[2];
  }

  // 5. togli suffissi tipo "Official Music Video" rimasti senza parentesi
  title = title.replace(/\s[-–—]?\s*(official\s+)?(music\s+)?(lyric\s+)?video\s*$/i, '');

  title = collapse(title);
  artist = collapse(artist);
  const primaryArtist = collapse(stripFeat(artist).split(/\s*(,|&|\bx\b|\be\b|\band\b)\s*/i)[0]);

  return { title, artist, primaryArtist };
}

/** Normalizza per confronti: minuscolo, senza accenti e punteggiatura */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
