// Encode reviewed real-game captures as high-quality web MP4 and still posters.
// Raw recordings stay under ignored output/ after record-about-gameplay.cjs.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const captures = path.join(root, 'output/about-gameplay');
const target = path.join(root, 'public/assets/site/gameplay');
const clips = [
  { key: 'duel', start: 8.5, duration: 6, poster: 12 },
  { key: 'crossfire', start: 14.5, duration: 5, poster: 19 },
];
fs.mkdirSync(target, { recursive: true });
const staged = [];
const temporaryFiles = new Set();

try {
for (const clip of clips) {
  const source = path.join(captures, 'crossfire-60-raw.webm');
  if (!fs.existsSync(source) || fs.statSync(source).size < 100_000) throw new Error(`Missing or incomplete gameplay recording: ${source}`);
  const output = path.join(target, `${clip.key}.mp4`);
  const temporary = `${output}.partial.mp4`;
  temporaryFiles.add(temporary);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(clip.start), '-i', source, '-t', String(clip.duration),
    '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation',
    '-crf', '14', '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
    '-movflags', '+faststart', temporary], { stdio: 'inherit' });
  const poster = path.join(target, `${clip.key}.jpg`);
  const temporaryPoster = `${poster}.partial.jpg`;
  temporaryFiles.add(temporaryPoster);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(clip.poster), '-i', source, '-frames:v', '1', '-q:v', '1', '-update', '1', temporaryPoster], { stdio: 'inherit' });
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-count_frames', '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,bit_rate,nb_read_frames', '-show_entries',
    'format=duration,size', '-of', 'json', temporary], { encoding: 'utf8' }));
  const stream = info.streams?.[0];
  const measuredFps = Number(stream?.nb_read_frames) / Number(info.format?.duration);
  if (stream?.codec_name !== 'h264' || stream.width < 1920 || stream.height < 1080 || measuredFps < 55) {
    throw new Error(`${clip.key} encode is below 1080p55 H.264: ${JSON.stringify(info)}`);
  }
  staged.push({ key: clip.key, output, temporary, poster, temporaryPoster, width: stream.width, height: stream.height,
    fps: measuredFps, duration: info.format.duration, size: Number(info.format.size) });
}

for (const clip of staged) {
  fs.renameSync(clip.temporary, clip.output);
  temporaryFiles.delete(clip.temporary);
  fs.renameSync(clip.temporaryPoster, clip.poster);
  temporaryFiles.delete(clip.temporaryPoster);
  console.log(`${clip.key}: ${clip.width}×${clip.height} ${clip.fps.toFixed(1)} fps, ${clip.duration}s, ${(clip.size / 1024 / 1024).toFixed(1)} MiB`);
}
} catch (error) {
  for (const file of temporaryFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
  throw error;
}
