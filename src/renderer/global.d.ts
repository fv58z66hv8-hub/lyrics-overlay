// Tipi visibili nel renderer (stessa forma di src/shared/types.d.ts).

interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  duration: number;
  app: string;
  rawTitle: string;
}

interface PlaybackState {
  position: number;
  playing: boolean;
  sampledAt: number;
}

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsPayload {
  status: 'loading' | 'found' | 'notfound' | 'instrumental' | 'error';
  synced: boolean;
  lines: LyricLine[];
}

interface OverlaySettings {
  position: 'top' | 'center' | 'bottom';
  offset: number;
  fontScale: number;
  visible: boolean;
}

interface OverlayBridge {
  on(channel: 'track', cb: (data: TrackInfo | null) => void): void;
  on(channel: 'lyrics', cb: (data: LyricsPayload) => void): void;
  on(channel: 'playback', cb: (data: PlaybackState) => void): void;
  on(channel: 'settings', cb: (data: OverlaySettings) => void): void;
  ready(): void;
}

interface Window {
  overlay: OverlayBridge;
}
