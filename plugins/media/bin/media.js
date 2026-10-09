import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkUrl } from './safe-fetch.js';

const MEDIA = /\.(mp4|mov|mkv|webm|m4v|avi|mp3|wav|m4a|aac|flac|ogg)$/i;
const LOCAL = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local');
const WHISPER = process.env.TROOP_WHISPER || path.join(LOCAL, 'whisper.cpp', 'Release', 'whisper-cli.exe');
const MODEL = process.env.TROOP_WHISPER_MODEL || path.join(LOCAL, 'whisper.cpp', 'models', 'ggml-base.en.bin');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${path.basename(cmd)} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed: ${(r.stderr || r.stdout || '').trim().slice(-500)}`);
  return r;
}

export function mediaFiles(p) {
  if (!fs.statSync(p).isDirectory()) return [p];
  return fs.readdirSync(p).filter((f) => MEDIA.test(f) && !f.startsWith('.')).sort().map((f) => path.join(p, f));
}

export function probe(input) {
  const files = mediaFiles(input.path).map((file) => {
    const info = JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).stdout);
    const v = info.streams.find((s) => s.codec_type === 'video');
    const a = info.streams.find((s) => s.codec_type === 'audio');
    const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
    return {
      file: path.basename(file), path: file, duration: Number(info.format.duration) || 0,
      width: v?.width ?? null, height: v?.height ?? null, fps: d ? Math.round((n / d) * 100) / 100 : null,
      audio: a ? { codec: a.codec_name, channels: a.channels, rate: Number(a.sample_rate) } : null,
    };
  });
  if (!files.length) throw new Error(`no media files in ${input.path}`);
  return { files, count: files.length, duration: Math.round(files.reduce((t, f) => t + f.duration, 0) * 10) / 10 };
}

export function wordsFromWhisper(json, file) {
  return (json.transcription ?? [])
    .map((t) => ({ file, start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: t.text.trim() }))
    .filter((w) => w.text);
}

function scenes(file, threshold = 0.4) {
  const r = run('ffmpeg', ['-hide_banner', '-i', file, '-filter:v', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  return [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

export function transcribe(input) {
  if (!fs.existsSync(WHISPER)) throw new Error(`whisper-cli not found at ${WHISPER}; set TROOP_WHISPER`);
  if (!fs.existsSync(MODEL)) throw new Error(`whisper model not found at ${MODEL}; set TROOP_WHISPER_MODEL`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-whisper-'));
  try {
    const words = [];
    const cuts = {};
    const skipped = [];
    for (const { path: file, audio } of probe(input).files) {
      if (!audio) { skipped.push(path.basename(file)); continue; }
      const wav = path.join(tmp, 'a.wav');
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav]);
      run(WHISPER, ['-m', MODEL, '-f', wav, '-ml', '1', '-sow', '-oj', '-of', path.join(tmp, 'a'), '-np']);
      words.push(...wordsFromWhisper(JSON.parse(fs.readFileSync(path.join(tmp, 'a.json'), 'utf8')), path.basename(file)));
      if (input.scenes) cuts[path.basename(file)] = scenes(file);
    }
    if (!words.length && !skipped.length) throw new Error(`no speech found in ${input.path}`);
    const result = { model: path.basename(MODEL), words, skipped, ...(input.scenes ? { scenes: cuts } : {}) };
    fs.mkdirSync(path.dirname(input.out), { recursive: true });
    fs.writeFileSync(input.out, JSON.stringify(result, null, 2));
    return { out: input.out, words: words.length, files: new Set(words.map((w) => w.file)).size, skipped };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const safeId = (id) => {
  const s = String(id ?? '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) throw new Error(`moment id ${JSON.stringify(s)} must be letters, digits, _ or -`);
  return s;
};

export async function download(input) {
  fs.mkdirSync(input.out, { recursive: true });
  if (fs.existsSync(input.source)) {
    const dest = path.join(input.out, path.basename(input.source));
    fs.copyFileSync(input.source, dest);
    return { path: dest, from: 'file' };
  }
  if (!/^https?:\/\//i.test(input.source)) throw new Error(`${input.source} is neither a file nor a URL`);
  // ponytail: checks the first host only; yt-dlp follows its own redirects.
  await checkUrl(input.source);
  const r = run('yt-dlp', ['--no-playlist', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '-o', path.join(input.out, 'source.%(ext)s'), '--print', 'after_move:filepath', input.source]);
  const file = r.stdout.trim().split(/\r?\n/).pop();
  if (!file || !fs.existsSync(file)) throw new Error(`yt-dlp did not report a file: ${r.stdout.slice(-300)}`);
  return { path: file, from: 'url' };
}

export function pickMoment(moments, index) {
  const list = Array.isArray(moments) ? moments : JSON.parse(fs.readFileSync(moments, 'utf8'));
  const items = Array.isArray(list) ? list : list.items ?? [];
  const approved = items.filter((m) => m.status === 'approved');
  return (approved.length ? approved : items.filter((m) => m.status !== 'dropped'))[Number(index)] ?? null;
}

const ASPECT = { '9:16': "crop='min(iw,trunc(ih*9/16/2)*2)':'min(ih,trunc(iw*16/9/2)*2)'", '1:1': "crop='min(iw,ih)':'min(iw,ih)'", '16:9': null };

export function cut(input) {
  const m = pickMoment(input.moments, input.index ?? 0);
  if (!m) {
    if (!Number(input.index ?? 0)) throw new Error('no moment left to cut: every moment was dropped or moments.json is empty');
    return { path: null, skipped: true };
  }
  const start = Number(m.src_start);
  const end = Number(m.src_end);
  if (!(end > start)) throw new Error(`moment ${m.id} has no src_start/src_end range`);
  fs.mkdirSync(input.out, { recursive: true });
  const id = safeId(m.id);
  const out = path.join(input.out, `${id}.mp4`);
  const crop = ASPECT[input.aspect ?? '9:16'];
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-to', String(end), '-i', input.video,
    ...(crop ? ['-vf', crop] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', out]);
  fs.writeFileSync(`${out}.json`, JSON.stringify({ id, title: m.title ?? '', source: input.video, src_start: start, src_end: end }, null, 2));
  return { path: out, id, seconds: Math.round((end - start) * 10) / 10 };
}

const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assText = (s) => s.replace(/\\/g, '/').replace(/[{}]/g, '').replace(/\n/g, ' ');

export function captionsAss(meta, words, hookSeconds) {
  const inClip = words.filter((w) => w.start >= meta.src_start && w.end <= meta.src_end + 0.05);
  const lines = [];
  for (let i = 0; i < inClip.length; i += 3) {
    const group = inClip.slice(i, i + 3);
    lines.push(`Dialogue: 0,${assTime(group[0].start - meta.src_start)},${assTime(group[group.length - 1].end - meta.src_start)},Word,,0,0,0,,${assText(group.map((w) => w.text).join(' '))}`);
  }
  if (meta.title && hookSeconds > 0) lines.push(`Dialogue: 1,${assTime(0)},${assTime(hookSeconds)},Hook,,0,0,0,,${assText(meta.title)}`);
  return [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    'Style: Word,Arial,72,&H00FFFFFF,&H00000000,&H64000000,1,0,1,5,0,2,90,90,420',
    'Style: Hook,Arial,84,&H0000E5FF,&H00000000,&H64000000,1,0,1,6,0,8,90,90,300',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...lines, '',
  ].join('\n');
}

export function captions(input) {
  if (!input.clip) return { path: null, skipped: true };
  const meta = JSON.parse(fs.readFileSync(`${input.clip}.json`, 'utf8'));
  const words = JSON.parse(fs.readFileSync(input.words, 'utf8')).words ?? [];
  const sourceName = path.basename(meta.source);
  const own = words.filter((w) => !w.file || w.file === sourceName);
  fs.mkdirSync(input.out, { recursive: true });
  const id = safeId(meta.id);
  const ass = path.join(input.out, `${id}.ass`);
  fs.writeFileSync(ass, captionsAss(meta, own.length ? own : words, Number(input.hook_seconds ?? 2)));
  const out = path.join(input.out, `${id}.mp4`);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.resolve(input.clip), '-vf', `ass=${path.basename(ass)}`, '-c:a', 'copy', path.resolve(out)], input.out);
  return { path: out, id };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const fn = { probe, transcribe, download, cut, captions }[process.argv[2]];
    if (!fn) throw new Error(`unknown action ${process.argv[2]}`);
    process.stdout.write(JSON.stringify({ ok: true, outputs: await fn(req.input || {}) }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
  }
}
