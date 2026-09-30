/* Render episode jadi video MP4 vertikal 1080x1920 siap upload Reels/TikTok.
   Pakai: node render_reels.js 1 2 3        (nomor episode; kosong = semua)
   Butuh: playwright (npm i -g playwright) + ffmpeg (atau pip install imageio-ffmpeg). Hasil: reels/*.mp4 */
const fs = require('fs'), path = require('path'), http = require('http'), { execFileSync, execSync } = require('child_process');
let pw; try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const ROOT = __dirname, OUT = path.join(ROOT, 'reels'), FPS = 30;
const FFMPEG = (() => { try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch { return execSync('python3 -c "import imageio_ffmpeg as f;print(f.get_ffmpeg_exe())"').toString().trim(); } })();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, () => res(srv));
  });
}

async function renderEp(browser, port, ep) {
  const name = `bhp-tusi-${ep}`, tmp = path.join(OUT, `.${name}`);
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${port}/index.html?rekam&ep=${ep}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // font & gambar siap
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(tmp, `f${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  await page.waitForTimeout(300);
  page.evaluate(() => window.__mulai());
  await page.waitForFunction(() => window.__rekam && window.__rekam.done, null, { timeout: 400000, polling: 500 });
  await cdp.send('Page.stopScreencast');
  const { audio, audioStart } = await page.evaluate(() => window.__rekam);
  await page.close();
  fs.writeFileSync(path.join(tmp, 'audio.wav'), Buffer.from(audio, 'base64'));

  // Video mulai tepat saat perekam audio mulai → buang frame sebelum itu, sisanya pakai durasi asli tiap frame
  let i0 = frames.findIndex((f) => f.t >= audioStart); if (i0 < 0) i0 = 0; if (i0 > 0) i0--;
  const fr = frames.slice(i0);
  const lines = ['ffconcat version 1.0'];
  fr.forEach((f, i) => {
    const t = i === 0 ? audioStart : f.t, next = fr[i + 1] ? fr[i + 1].t : f.t + 1.5;
    lines.push(`file '${path.basename(f.file)}'`, `duration ${Math.max(0.001, next - Math.max(t, audioStart)).toFixed(4)}`);
  });
  lines.push(`file '${path.basename(fr[fr.length - 1].file)}'`);
  fs.writeFileSync(path.join(tmp, 'list.txt'), lines.join('\n'));
  const out = path.join(OUT, `${name}.mp4`);
  execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-i', path.join(tmp, 'audio.wav'),
    '-vf', `fps=${FPS},scale=1080:1920:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', out], { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  const fps = fr.length / (fr[fr.length - 1].t - fr[0].t);
  console.log(`✔ ${out}  (${fr.length} frame, rata-rata ${fps.toFixed(1)} fps tertangkap)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const eps = process.argv.slice(2).map(Number).filter(Boolean);
  const srv = await serve();
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  for (const ep of eps.length ? eps : [1, 2, 3, 4, 5, 6]) await renderEp(browser, srv.address().port, ep);
  await browser.close(); srv.close();
})();
