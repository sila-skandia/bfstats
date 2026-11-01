// The tutorial videos from a captured tour run: studio-probe.cjs with
// `--steps steps-tour.js --video dir` leaves the page's frames in
// `dir/frames` (their times in `dir/frames.json`) and each step's start and
// end in the report's `marks`. This encodes the whole tour as one video and
// each step as its own, every frame held as long as it was on screen.
//
//   node cut-tour-videos.cjs --dir dir --report tour.json [--keep-frames]
//
// Writes `dir/studio-tour.mp4` and `dir/NN-<step>.mp4` (H.264, 30 fps).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const opts = { dir: '', report: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (k === 'keep-frames') opts.keepFrames = true;
  else opts[k] = argv[++i];
}
if (!opts.dir || !opts.report) {
  console.error('usage: node cut-tour-videos.cjs --dir dir --report tour.json [--keep-frames]');
  process.exit(2);
}

// The videos, by the tour's steps (steps-tour.js labels).
const PARTS = [
  ['01-open-the-tour', ['open', 'offer']],
  ['02-pick-a-kill', ['kill']],
  ['03-the-cameras', ['cameras']],
  ['04-change-a-camera', ['swap']],
  ['05-when-it-takes-over', ['handover']],
  ['06-your-own-camera', ['place']],
  ['07-slow-motion', ['slow']],
  ['08-pick-a-look', ['look']],
  ['09-text', ['text']],
  ['10-record-it', ['record']],
  ['11-that-is-a-clip', ['end']],
];

const dir = path.resolve(opts.dir);
const framesDir = path.join(dir, 'frames');
const frames = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(opts.report, 'utf8'));
const marks = report.marks ?? {};

/** The frames from `t0` to `t1` (seconds since the epoch) as an ffmpeg
 *  concat list, each held until the next. */
function concatList(t0, t1) {
  const pick = frames.filter(f => f.ts >= t0 && f.ts <= t1);
  // The frame on screen when the stretch began.
  const before = frames.filter(f => f.ts < t0).at(-1);
  if (before) pick.unshift({ ...before, ts: t0 });
  if (!pick.length) return null;
  const lines = [];
  for (let k = 0; k < pick.length; k++) {
    const until = k + 1 < pick.length ? pick[k + 1].ts : t1;
    lines.push(`file '${path.join(framesDir, pick[k].file)}'`, `duration ${Math.max(0.001, until - pick[k].ts).toFixed(4)}`);
  }
  // The concat demuxer drops the last duration without the file again.
  lines.push(`file '${path.join(framesDir, pick.at(-1).file)}'`);
  return lines.join('\n');
}

function encode(name, t0, t1) {
  const list = concatList(t0, t1);
  if (!list) {
    console.warn(`${name}: no frames`);
    return null;
  }
  const listFile = path.join(dir, `${name}.txt`);
  fs.writeFileSync(listFile, list);
  const out = path.join(dir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(listFile);
  const size = fs.statSync(out).size;
  console.log(`${path.basename(out)}  ${(t1 - t0).toFixed(1)} s  ${(size / 1e6).toFixed(1)} MB`);
  return out;
}

const made = [];
for (const [name, labels] of PARTS) {
  const m = labels.map(l => marks[l]).filter(x => x?.start && x?.end);
  if (!m.length) {
    console.warn(`${name}: the run has no ${labels.join(', ')} step`);
    continue;
  }
  // From the step's start (the first part's from the first frame) to its end.
  const t0 = name.startsWith('01') ? Math.max(frames[0]?.ts ?? m[0].start, m[0].start) : m[0].start;
  made.push(encode(name, t0, m.at(-1).end));
}
const first = marks[PARTS[0][1][0]]?.start;
const lastPart = PARTS.at(-1)[1];
const last = marks[lastPart.at(-1)]?.end;
if (first && last) made.push(encode('studio-tour', first, last));
if (!opts.keepFrames) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'frames.json'), { force: true });
}
console.log(`${made.filter(Boolean).length} videos in ${dir}`);
