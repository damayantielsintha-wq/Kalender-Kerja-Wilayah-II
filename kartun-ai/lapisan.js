/* Render lapisan teks (PNG transparan per frame) untuk rakit.py.  Pakai: node lapisan.js <folder-sementara> */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
let pw; try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
(async () => {
  const tmp = process.argv[2];
  const data = JSON.parse(fs.readFileSync(path.join(tmp, 'timeline.json'), 'utf8'));
  const dir = path.join(tmp, 'ov'); fs.mkdirSync(dir, { recursive: true });
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(__dirname, 'lapisan.html'));
  await page.waitForFunction(() => window.READY);
  await page.evaluate((d) => window.init(d), data);
  const n = Math.ceil(data.duration * data.fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.renderAt(t), i / data.fps);
    await page.screenshot({ path: path.join(dir, `o${String(i).padStart(5, '0')}.png`), omitBackground: true });
  }
  await browser.close();
  console.log(`lapisan: ${n} frame`);
})();
