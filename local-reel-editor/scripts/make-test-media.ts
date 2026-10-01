/**
 * Builds a realistic test set for end-to-end checks without any network:
 *  - voice.wav: Russian voice-over synthesised word-by-word with espeak-ng,
 *    so the exact start/end of every word is known (ground truth);
 *  - transcript.json: those word timings in the same shape the Whisper
 *    sidecar returns (used as a fixture for the montage pipeline);
 *  - clips/*.mp4: synthetic "screen recordings" with UI-like motion and taps.
 *
 * Usage: tsx scripts/make-test-media.ts <outDir>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? join(__dirname, '..', 'tests', '.tmp', 'media');
mkdirSync(join(out, 'clips'), { recursive: true });

const SCRIPT =
  'Сегодня я покажу, как работает приложение. На главном экране собраны все ваши дела. ' +
  'Теперь создадим новую задачу. Введите название и выберите время. ' +
  'После этого можно посмотреть подробную статистику. Графики показывают ваш прогресс за неделю. ' +
  'В профиле видно все ваши достижения. Тёмную тему можно включить в настройках. ' +
  'А расписание на неделю — в календаре. Попробуйте сами!';

const SR = 22050;

function synth(word: string): Int16Array {
  const buf = execFileSync('espeak-ng', ['-v', 'ru', '-s', '165', '--stdout', word]);
  // espeak writes a WAV with a header; find "data" chunk.
  const idx = buf.indexOf(Buffer.from('data'));
  const pcm = buf.subarray(idx + 8);
  const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)));
  // Trim leading/trailing silence.
  const thr = 300;
  let a = 0;
  let b = samples.length - 1;
  while (a < samples.length && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  return samples.slice(Math.max(0, a - 40), Math.min(samples.length, b + 40));
}

const tokens = SCRIPT.split(/\s+/).filter(Boolean);
const pieces: Int16Array[] = [];
const words: { text: string; start: number; end: number; probability: number }[] = [];
let t = 0.35; // leading breath
pieces.push(new Int16Array(Math.round(t * SR)));
for (const tok of tokens) {
  const spoken = tok.replace(/[—–]/g, '').trim();
  if (!spoken) continue;
  const s = synth(spoken.replace(/[.,!?]/g, ''));
  words.push({ text: tok, start: Math.round(t * 1000) / 1000, end: Math.round((t + s.length / SR) * 1000) / 1000, probability: 0.95 });
  pieces.push(s);
  t += s.length / SR;
  const gap = /[.!?]$/.test(tok) ? 0.45 : /[,—]$/.test(tok) ? 0.22 : 0.06;
  pieces.push(new Int16Array(Math.round(gap * SR)));
  t += gap;
}
pieces.push(new Int16Array(Math.round(0.4 * SR)));

const total = pieces.reduce((a, p) => a + p.length, 0);
const pcm = Buffer.alloc(total * 2);
let o = 0;
for (const p of pieces) for (const v of p) pcm.writeInt16LE(v, (o++) * 2);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync(join(out, 'voice.wav'), Buffer.concat([header, pcm]));
writeFileSync(
  join(out, 'transcript.json'),
  JSON.stringify({ type: 'result', language: 'ru', text: SCRIPT, words, duration: total / SR }, null, 2),
);

// Synthetic app screen recordings. Portrait 1080x2340 like a phone, one landscape desktop capture.
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const clips: { name: string; dur: number; color: string; w: number; h: number }[] = [
  { name: 'главный экран', dur: 9, color: '0x101418', w: 1080, h: 2340 },
  { name: 'создание задачи', dur: 8, color: '0x13161c', w: 1080, h: 2340 },
  { name: 'статистика', dur: 12, color: '0x0f1a14', w: 1080, h: 2340 },
  { name: 'профиль', dur: 6, color: '0x18121a', w: 1080, h: 2340 },
  { name: 'настройки', dur: 7, color: '0x141414', w: 1080, h: 2340 },
  { name: 'календарь', dur: 10, color: '0x111827', w: 1920, h: 1080 },
];
for (const c of clips) {
  const { w, h } = c;
  // Cards, a moving list, a "tap" ripple every ~1.7 s and a label.
  const vf = [
    `drawbox=x=${w * 0.06}:y=${h * 0.08}:w=${w * 0.88}:h=${h * 0.1}:color=0x2a2f36:t=fill`,
    `drawbox=x=${w * 0.06}:y=${h * 0.22}+mod(t*60\\,${h * 0.3}):w=${w * 0.88}:h=${h * 0.12}:color=0x1ed760@0.85:t=fill`,
    `drawbox=x=${w * 0.06}:y=${h * 0.6}:w=${w * 0.4}:h=${h * 0.14}:color=0x3a3f46:t=fill`,
    `drawbox=x=${w * 0.54}:y=${h * 0.6}:w=${w * 0.4}:h=${h * 0.14}:color=0x3a3f46:t=fill`,
    `drawbox=x=${w * 0.3}+${w * 0.3}*mod(floor(t/1.7)\\,2):y=${h * 0.78}:w=${w * 0.14}:h=${w * 0.14}:color=white@0.9:t=fill:enable='lt(mod(t\\,1.7)\\,0.25)'`,
    `drawtext=fontfile=${font}:text='${c.name}':x=(w-text_w)/2:y=${h * 0.11}:fontsize=${Math.round(w * 0.06)}:fontcolor=white`,
    `drawtext=fontfile=${font}:text='%{pts\\:hms}':x=(w-text_w)/2:y=${h * 0.9}:fontsize=${Math.round(w * 0.035)}:fontcolor=0x9aa0a6`,
  ].join(',');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${c.color}:s=${w}x${h}:r=30:d=${c.dur}`,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
    join(out, 'clips', `${c.name}.mp4`),
  ]);
}
console.log(JSON.stringify({ out, words: words.length, duration: total / SR }));
