import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { LyricsPayload, OverlayPosition, OverlaySettings, PlaybackState, TrackInfo } from '../shared/types';
import { LyricsService } from './lyrics';
import { MediaSnapshot, NowPlayingWatcher } from './nowPlaying';
import { cleanTrack } from './titleCleaner';

const ROOT = app.getAppPath();
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS: OverlaySettings = { position: 'bottom', offset: 0, fontScale: 1, visible: true };

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: OverlaySettings = loadSettings();

let currentKey = '';
let currentTrack: TrackInfo | null = null;
let currentQuery: Parameters<LyricsService['get']>[0] | null = null;
let currentLyrics: LyricsPayload | null = null;
let lastPlayback: PlaybackState | null = null;
let lookupId = 0;

const lyricsService = new LyricsService(path.join(app.getPath('userData'), 'lyrics-cache.json'));
const watcher = new NowPlayingWatcher(path.join(ROOT, 'native', 'nowplaying.ps1'));

// ---------- impostazioni ----------

function loadSettings(): OverlaySettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function updateSettings(patch: Partial<OverlaySettings>): void {
  settings = { ...settings, ...patch };
  settings.offset = Math.round(settings.offset * 10) / 10;
  settings.fontScale = Math.min(2.2, Math.max(0.6, Math.round(settings.fontScale * 100) / 100));
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  send('settings', settings);
  rebuildTrayMenu();
}

// ---------- finestra overlay ----------

function send(channel: string, data: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function fitToScreen(): void {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds(workArea);
}

function createWindow(): void {
  win = new BrowserWindow({
    ...screen.getPrimaryDisplay().workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true); // i clic passano alle finestre sotto
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));

  win.once('ready-to-show', () => win?.showInactive());
  win.webContents.on('did-finish-load', () => {
    send('settings', settings);
    send('track', currentTrack);
    if (currentLyrics) send('lyrics', currentLyrics);
    if (lastPlayback) send('playback', lastPlayback);
  });

  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
}

// ---------- canzone in riproduzione ----------

function lookupLyrics(force = false): void {
  if (!currentQuery) return;
  const id = ++lookupId;
  currentLyrics = { status: 'loading', synced: false, lines: [] };
  send('lyrics', currentLyrics);
  lyricsService
    .get(currentQuery, force)
    .then((res) => {
      if (id !== lookupId) return; // nel frattempo è cambiata canzone
      currentLyrics = res;
      send('lyrics', res);
    })
    .catch((e) => {
      if (id !== lookupId) return;
      console.error('[lyrics]', e);
      currentLyrics = { status: 'error', synced: false, lines: [] };
      send('lyrics', currentLyrics);
    });
}

function onSnapshot(s: MediaSnapshot): void {
  if (s.type === 'error') {
    console.warn('[nowplaying]', s.message);
    return;
  }
  if (s.type !== 'track' || !s.title) {
    if (currentKey) {
      currentKey = '';
      currentTrack = null;
      currentQuery = null;
      currentLyrics = null;
      lookupId++;
      send('track', null);
    }
    return;
  }

  const key = `${s.app}|${s.artist}|${s.title}`;
  if (key !== currentKey) {
    currentKey = key;
    const cleaned = cleanTrack(s.title, s.artist ?? '', s.app ?? '');
    currentTrack = {
      title: cleaned.title,
      artist: cleaned.artist,
      album: s.album ?? '',
      duration: s.duration ?? 0,
      app: s.app ?? '',
      rawTitle: s.title,
    };
    currentQuery = { ...cleaned, duration: s.duration ?? 0, rawTitle: s.title };
    console.log(`[track] ${cleaned.artist} — ${cleaned.title}  (${s.app})`);
    send('track', currentTrack);
    lookupLyrics();
  } else if (currentTrack && !currentTrack.duration && s.duration) {
    // YouTube a volte comunica la durata solo dopo qualche istante
    currentTrack.duration = s.duration;
    send('track', currentTrack);
  }

  lastPlayback = { position: s.position ?? 0, playing: s.status === 'Playing', sampledAt: Date.now() };
  send('playback', lastPlayback);
}

// ---------- tray e scorciatoie ----------

function rebuildTrayMenu(): void {
  if (!tray) return;
  const pos = (p: OverlayPosition, label: string) => ({
    label,
    type: 'radio' as const,
    checked: settings.position === p,
    click: () => updateSettings({ position: p }),
  });
  const offsetLabel = `${settings.offset >= 0 ? '+' : ''}${settings.offset.toFixed(1)} s`;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: currentTrack ? `♪ ${currentTrack.artist} — ${currentTrack.title}` : 'Nessuna canzone', enabled: false },
      { type: 'separator' },
      { label: settings.visible ? 'Nascondi testi' : 'Mostra testi', accelerator: 'Ctrl+Alt+L', click: toggleVisible },
      { label: 'Posizione', submenu: [pos('top', 'In alto'), pos('center', 'Al centro'), pos('bottom', 'In basso')] },
      {
        label: 'Dimensione testo',
        submenu: [
          { label: 'Più grande', click: () => updateSettings({ fontScale: settings.fontScale + 0.1 }) },
          { label: 'Più piccolo', click: () => updateSettings({ fontScale: settings.fontScale - 0.1 }) },
          { label: 'Normale', click: () => updateSettings({ fontScale: 1 }) },
        ],
      },
      {
        label: `Sincronizzazione (${offsetLabel})`,
        submenu: [
          { label: 'Testo in ritardo → anticipa 0,5 s', click: () => updateSettings({ offset: settings.offset + 0.5 }) },
          { label: 'Testo in anticipo → ritarda 0,5 s', click: () => updateSettings({ offset: settings.offset - 0.5 }) },
          { label: 'Azzera', click: () => updateSettings({ offset: 0 }) },
        ],
      },
      { label: 'Cerca di nuovo il testo', enabled: !!currentQuery, click: () => lookupLyrics(true) },
      { type: 'separator' },
      { label: 'Esci', click: () => app.quit() },
    ]),
  );
  tray.setToolTip(currentTrack ? `Lyrics Overlay — ${currentTrack.title}` : 'Lyrics Overlay');
}

function toggleVisible(): void {
  updateSettings({ visible: !settings.visible });
}

function registerShortcuts(): void {
  const shortcuts: [string, () => void][] = [
    ['Control+Alt+L', toggleVisible],
    ['Control+Alt+P', () => {
      const order: OverlayPosition[] = ['bottom', 'center', 'top'];
      updateSettings({ position: order[(order.indexOf(settings.position) + 1) % order.length] });
    }],
    ['Control+Alt+PageUp', () => updateSettings({ offset: settings.offset + 0.5 })],
    ['Control+Alt+PageDown', () => updateSettings({ offset: settings.offset - 0.5 })],
    ['Control+Alt+numadd', () => updateSettings({ fontScale: settings.fontScale + 0.1 })],
    ['Control+Alt+numsub', () => updateSettings({ fontScale: settings.fontScale - 0.1 })],
  ];
  for (const [acc, fn] of shortcuts) {
    if (!globalShortcut.register(acc, fn)) console.warn(`[shortcut] ${acc} già usata da un altro programma`);
  }
}

// ---------- avvio ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('it.lobasso.lyricsoverlay');

    createWindow();

    tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')));
    rebuildTrayMenu();
    registerShortcuts();

    watcher.on('snapshot', (s: MediaSnapshot) => {
      const prevKey = currentKey;
      onSnapshot(s);
      if (currentKey !== prevKey) rebuildTrayMenu();
    });
    watcher.start();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    watcher.stop();
  });

  // l'app resta attiva nella tray anche senza finestre "normali"
  app.on('window-all-closed', () => undefined);
}

ipcMain.on('renderer-ready', () => {
  send('settings', settings);
  send('track', currentTrack);
  if (currentLyrics) send('lyrics', currentLyrics);
});
