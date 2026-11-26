// Test veloci senza Electron:  npm test
import * as assert from 'assert';
import { parseLrc, spreadPlain } from '../main/lyrics';
import { cleanTrack } from '../main/titleCleaner';

const cases: [string, string, string, string, string][] = [
  // titolo grezzo, artista grezzo, app, titolo atteso, artista atteso
  ["Måneskin - Beggin' (Official Video)", 'ManeskinVEVO', 'Chrome', "Beggin'", 'Måneskin'],
  ['Queen – Bohemian Rhapsody (Official Video Remastered) [4K]', 'Queen Official', 'MSEdge', 'Bohemian Rhapsody', 'Queen'],
  ['Blinding Lights', 'The Weeknd', 'Spotify.exe', 'Blinding Lights', 'The Weeknd'],
  ['Vivere con te (Testo)', 'Artista - Topic', 'Chrome', 'Vivere con te', 'Artista'],
  ['Anna - 30°C | Official Music Video', 'ANNA', 'Chrome', '30°C', 'Anna'],
  ['Mr. Brightside', 'The Killers', 'Chrome', 'Mr. Brightside', 'The Killers'],
];

for (const [title, artist, app, expTitle, expArtist] of cases) {
  const r = cleanTrack(title, artist, app);
  assert.strictEqual(r.title, expTitle, `titolo: ${title} → ${r.title}`);
  assert.strictEqual(r.artist, expArtist, `artista: ${title} → ${r.artist}`);
  console.log(`ok  ${title}  →  ${r.artist} | ${r.title}`);
}

const ft = cleanTrack('Calvin Harris - Summer feat. Someone (Official Audio)', 'CalvinHarrisVEVO', 'Chrome');
assert.strictEqual(ft.primaryArtist, 'Calvin Harris');

const lrc = `[ar:Test]
[00:12.50]Prima riga
[00:15.00][01:20.00]Ritornello
[00:18.3]
[01:02.123]<00:01.00>Parola <00:02.00>per parola`;
const lines = parseLrc(lrc);
assert.deepStrictEqual(
  lines.map((l) => [Number(l.time.toFixed(3)), l.text]),
  [
    [12.5, 'Prima riga'],
    [15, 'Ritornello'],
    [18.3, ''],
    [62.123, 'Parola per parola'],
    [80, 'Ritornello'],
  ],
);
console.log('ok  parser LRC');

const plain = spreadPlain('a\n\nb\nc', 100);
assert.strictEqual(plain.length, 3);
assert.ok(plain[0].time > 0 && plain[2].time < 100);
console.log('ok  testo non sincronizzato');
console.log('\nTutti i test superati.');
