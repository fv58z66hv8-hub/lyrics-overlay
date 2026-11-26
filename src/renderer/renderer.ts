// Disegna il testo e lo tiene a tempo con la musica.
(() => {
  const body = document.body;
  const linesEl = document.getElementById('lines') as HTMLDivElement;
  const viewportEl = document.getElementById('viewport') as HTMLDivElement;
  const trackInfoEl = document.getElementById('trackInfo') as HTMLDivElement;
  const trackTitleEl = document.getElementById('trackTitle') as HTMLSpanElement;
  const trackArtistEl = document.getElementById('trackArtist') as HTMLSpanElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;

  let track: TrackInfo | null = null;
  let lyrics: LyricsPayload | null = null;
  let playback: PlaybackState = { position: 0, playing: false, sampledAt: Date.now() };
  let settings: OverlaySettings = { position: 'bottom', offset: 0, fontScale: 1, visible: true };

  let lineEls: HTMLDivElement[] = [];
  let activeIndex = -2;
  let clock = 0; // posizione "liscia" in secondi
  let lastFrame = performance.now();
  let trackInfoTimer: number | undefined;
  let statusTimer: number | undefined;

  // ---------- utilità ----------

  function setStatus(text: string, autoHideMs = 0): void {
    window.clearTimeout(statusTimer);
    statusEl.textContent = text;
    statusEl.classList.toggle('show', text.length > 0);
    if (autoHideMs > 0) statusTimer = window.setTimeout(() => statusEl.classList.remove('show'), autoHideMs);
  }

  function showTrackInfo(): void {
    if (!track) return;
    trackTitleEl.textContent = track.title;
    trackArtistEl.textContent = track.artist;
    trackInfoEl.classList.add('show');
    window.clearTimeout(trackInfoTimer);
    trackInfoTimer = window.setTimeout(() => trackInfoEl.classList.remove('show'), 6000);
  }

  /** Posizione "vera" stimata dall'ultimo campione + tempo trascorso */
  function targetTime(): number {
    let t = playback.position;
    if (playback.playing) t += (Date.now() - playback.sampledAt) / 1000;
    if (track && track.duration > 0) t = Math.min(t, track.duration);
    return t;
  }

  /** Ultima riga con time <= t (ricerca binaria) */
  function indexAt(t: number): number {
    const lines = lyrics?.lines ?? [];
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  function updateBodyClasses(): void {
    const hasLines = !!lyrics && lyrics.lines.length > 0;
    body.classList.toggle('idle', !track);
    body.classList.toggle('hidden', !settings.visible);
    body.classList.toggle('paused', !!track && !playback.playing);
    body.classList.toggle('no-lyrics', !hasLines);
    body.classList.toggle('unsynced', !!lyrics && !lyrics.synced);
    body.classList.remove('pos-top', 'pos-center', 'pos-bottom');
    body.classList.add(`pos-${settings.position}`);
    document.documentElement.style.setProperty('--scale', String(settings.fontScale));
  }

  // ---------- costruzione righe ----------

  function buildLines(): void {
    linesEl.innerHTML = '';
    lineEls = (lyrics?.lines ?? []).map((l) => {
      const d = document.createElement('div');
      d.className = 'line';
      if (l.text) d.textContent = l.text;
      else {
        d.textContent = '♪ ♪ ♪';
        d.classList.add('pause');
      }
      linesEl.appendChild(d);
      return d;
    });
    activeIndex = -2;
    linesEl.classList.remove('enter');
    void linesEl.offsetWidth; // riavvia l'animazione
    linesEl.classList.add('enter');
  }

  function setActive(index: number): void {
    activeIndex = index;
    for (let i = 0; i < lineEls.length; i++) {
      const el = lineEls[i];
      const dist = i - index;
      el.classList.toggle('active', dist === 0);
      el.classList.toggle('near', Math.abs(dist) === 1);
      el.classList.toggle('far', Math.abs(dist) >= 3);
      el.classList.toggle('past', dist < 0);
    }
    // centra la riga attiva (o la prima, prima che il canto inizi)
    const target = lineEls[Math.max(index, 0)];
    if (!target) return;
    const center = target.offsetTop + target.offsetHeight / 2;
    const offset = viewportEl.clientHeight / 2 - center;
    linesEl.style.transform = `translateY(${offset}px)`;
  }

  // ---------- ciclo di animazione ----------

  function frame(now: number): void {
    const dt = Math.min((now - lastFrame) / 1000, 0.25);
    lastFrame = now;

    // orologio "liscio": avanza da solo e si riallinea dolcemente ai campioni
    if (playback.playing) clock += dt;
    const target = targetTime();
    const err = target - clock;
    if (Math.abs(err) > 0.75) clock = target; // salto (seek o cambio canzone)
    else clock += err * 0.08;

    if (lyrics && lyrics.lines.length > 0) {
      const t = clock + settings.offset;
      const idx = indexAt(t);
      if (idx !== activeIndex) setActive(idx);

      // avanzamento karaoke della riga attiva
      if (idx >= 0 && lyrics.synced) {
        const start = lyrics.lines[idx].time;
        const next = lyrics.lines[idx + 1]?.time ?? start + 4;
        const span = Math.max(Math.min(next - start, 8), 0.5);
        const p = Math.min(Math.max((t - start) / (span * 0.9), 0), 1);
        lineEls[idx].style.setProperty('--p', `${(p * 112 - 6).toFixed(1)}%`);
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- eventi dal processo principale ----------

  window.overlay.on('track', (t) => {
    const changed = !track || !t || t.rawTitle !== track.rawTitle || t.app !== track.app;
    track = t;
    if (changed) {
      lyrics = null;
      buildLines();
      setStatus('');
      if (t) showTrackInfo();
    }
    updateBodyClasses();
  });

  window.overlay.on('lyrics', (l) => {
    lyrics = l;
    buildLines();
    switch (l.status) {
      case 'loading':
        setStatus('Cerco il testo…');
        break;
      case 'notfound':
        setStatus('Testo non trovato', 5000);
        break;
      case 'error':
        setStatus('Impossibile scaricare il testo (sei offline?)', 6000);
        break;
      case 'instrumental':
        setStatus('♪ Brano strumentale', 6000);
        break;
      case 'found':
        setStatus(l.synced ? '' : 'Testo non sincronizzato', l.synced ? 0 : 5000);
        break;
    }
    updateBodyClasses();
    clock = targetTime();
  });

  window.overlay.on('playback', (p) => {
    const wasPlaying = playback.playing;
    playback = p;
    if (wasPlaying !== p.playing) updateBodyClasses();
  });

  window.overlay.on('settings', (s) => {
    const scaleChanged = s.fontScale !== settings.fontScale;
    settings = s;
    updateBodyClasses();
    if (scaleChanged) {
      // le altezze delle righe cambiano: ricentra dopo il ricalcolo del layout
      requestAnimationFrame(() => setActive(activeIndex));
    }
  });

  window.addEventListener('resize', () => setActive(activeIndex));

  updateBodyClasses();
  window.overlay.ready();
  requestAnimationFrame(frame);
})();
