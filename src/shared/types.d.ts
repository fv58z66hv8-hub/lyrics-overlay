// Tipi condivisi tra processo principale e preload (solo dichiarazioni, nessun codice).

export interface TrackInfo {
  /** Titolo già ripulito (senza "Official Video" ecc.) */
  title: string;
  /** Artista già ripulito */
  artist: string;
  album: string;
  /** Durata in secondi (0 se sconosciuta) */
  duration: number;
  /** App che sta suonando (es. Spotify.exe, Chrome) */
  app: string;
  /** Titolo originale, come lo pubblica l'app */
  rawTitle: string;
}

export interface PlaybackState {
  /** Posizione in secondi al momento del campionamento */
  position: number;
  playing: boolean;
  /** Date.now() al momento del campionamento */
  sampledAt: number;
}

export interface LyricLine {
  time: number;
  text: string;
}

export type LyricsStatus = 'loading' | 'found' | 'notfound' | 'instrumental' | 'error';

export interface LyricsPayload {
  status: LyricsStatus;
  synced: boolean;
  lines: LyricLine[];
}

export type OverlayPosition = 'top' | 'center' | 'bottom';

export interface OverlaySettings {
  position: OverlayPosition;
  /** Secondi aggiunti alla posizione (positivo = testo in anticipo) */
  offset: number;
  fontScale: number;
  visible: boolean;
}
