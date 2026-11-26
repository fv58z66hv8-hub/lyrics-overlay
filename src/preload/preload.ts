import { contextBridge, ipcRenderer } from 'electron';

const CHANNELS = ['track', 'lyrics', 'playback', 'settings'] as const;
type Channel = (typeof CHANNELS)[number];

contextBridge.exposeInMainWorld('overlay', {
  on(channel: Channel, cb: (data: unknown) => void): void {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, data) => cb(data));
  },
  ready(): void {
    ipcRenderer.send('renderer-ready');
  },
});
