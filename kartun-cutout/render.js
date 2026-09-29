/* Render kartun cutout jadi MP4 vertikal 1080x1920 (frame demi frame, sinkron dengan suara).
   Pakai: node render.js 1              → out/bhp-cutout-1.mp4
          node render.js 1 --stills 3,15,33   → out/still-1-<t>.jpg (cek cepat)
   Butuh: playwright (npm i -g playwright) + ffmpeg (atau pip install imageio-ffmpeg). */
const fs = require('fs'), path = require('path'), http = require('http'), { execFileSync, execSync } = require('child_process');
let pw; try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out');
const FFMPEG = (() => { try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch { return execSync('python3 -c "import imageio_ffmpeg as f;print(f.get_ffmpeg_exe())"').toString().trim(); } })();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, () => res(srv));
  });
}

(async () => {
  const ep = process.argv[2] || '1';
  const si = process.argv.indexOf('--stills');
  const stills = si > 0 ? process.argv[si + 1].split(',').map(Number) : null;
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await pw.chromium.launch({ args: [] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('ERR', e.message));
  await page.goto(`http://localhost:${srv.address().port}/kartun-cutout/index.html?render&ep=${ep}`);
  await page.waitForFunction(() => window.READY, null, { timeout: 60000 });
  const data = await page.evaluate(() => window.EP_DATA);

  if (stills) {
    for (const t of stills) {
      await page.evaluate((t) => window.renderAt(t), t);
      await page.screenshot({ path: path.join(OUT, `still-${ep}-${t}.jpg`), type: 'jpeg', quality: 85 });
    }
    console.log('stills ok');
  } else {
    const tmp = path.join(OUT, `.frames-${ep}`); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const n = Math.ceil(data.duration * data.fps);
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.renderAt(t), i / data.fps);
      await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (i % 150 === 0) console.log(`frame ${i}/${n} (${((Date.now() - t0) / 1000).toFixed(0)} dtk)`);
    }
    // Campur semua rekaman suara sesuai waktu mulainya
    const lines = data.beats.filter((b) => b.type === 'line');
    const inputs = [], filters = [];
    lines.forEach((l, i) => {
      inputs.push('-i', path.join(ROOT, 'tiktok-bhp', 'vo', `${l.key}.mp3`));
      const ms = Math.round(l.start * 1000);
      filters.push(`[${i + 1}:a]aresample=48000,adelay=${ms}|${ms},volume=1.6[a${i}]`);
    });
    const mix = `${filters.join(';')};${lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad[aout]`;
    const out = path.join(OUT, `bhp-cutout-${ep}.mp4`);
    execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-framerate', String(data.fps), '-i', path.join(tmp, 'f%05d.jpg'), ...inputs,
      '-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-t', String(data.duration),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '160k', out], { stdio: 'inherit' });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('✔', out);
  }
  await browser.close(); srv.close();
})();
