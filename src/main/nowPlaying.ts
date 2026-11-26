import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';

export interface MediaSnapshot {
  type: 'track' | 'none' | 'error';
  app?: string;
  title?: string;
  artist?: string;
  album?: string;
  status?: string; // Playing, Paused, Stopped, ...
  position?: number;
  duration?: number;
  message?: string;
}

/**
 * Avvia nowplaying.ps1 in background e trasforma ogni riga JSON in un evento 'snapshot'.
 * Se lo script si chiude, viene riavviato dopo 2 secondi.
 */
export class NowPlayingWatcher extends EventEmitter {
  private proc: ChildProcess | null = null;
  private stopped = false;

  constructor(private readonly scriptPath: string) {
    super();
  }

  start(): void {
    if (process.platform !== 'win32') {
      this.emit('snapshot', {
        type: 'error',
        message: 'Il rilevamento della canzone per ora funziona solo su Windows.',
      } satisfies MediaSnapshot);
      return;
    }
    this.spawnProcess();
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }

  private spawnProcess(): void {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
      { windowsHide: true },
    );
    this.proc = proc;

    proc.stdout.setEncoding('utf8');
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim().replace(/^﻿/, '');
      if (!trimmed.startsWith('{')) return;
      try {
        this.emit('snapshot', JSON.parse(trimmed) as MediaSnapshot);
      } catch {
        /* riga incompleta: ignora */
      }
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d: string) => console.error('[nowplaying]', d.trim()));

    proc.on('exit', (code) => {
      this.proc = null;
      if (!this.stopped) {
        console.warn(`[nowplaying] script terminato (codice ${code}), riavvio tra 2 s`);
        setTimeout(() => this.spawnProcess(), 2000);
      }
    });
  }
}
