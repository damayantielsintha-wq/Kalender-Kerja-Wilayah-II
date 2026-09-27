/**
 * Kalender Kerja Wilayah II — Google Apps Script backend
 * Data  : Google Sheets (Kegiatan, Lampiran, Komentar, Log)
 * Files : Google Drive (folder per bulan)
 */

const APP_NAME = 'Kalender Kerja Wilayah II';
const PROP = PropertiesService.getScriptProperties();

const SHEETS = {
  events: ['id', 'judul', 'deskripsi', 'mulai', 'selesai', 'jamMulai', 'jamSelesai', 'seharian',
    'lokasi', 'kategori', 'prioritas', 'status', 'peserta', 'checklist', 'tautan',
    'dibuatOleh', 'dibuatPada', 'diubahOleh', 'diubahPada', 'dihapus'],
  files: ['id', 'eventId', 'fileId', 'nama', 'mime', 'ukuran', 'url', 'oleh', 'pada', 'dihapus'],
  comments: ['id', 'eventId', 'oleh', 'pada', 'isi'],
  logs: ['waktu', 'pengguna', 'aksi', 'eventId', 'judul', 'detail'],
};
const SHEET_NAMES = { events: 'Kegiatan', files: 'Lampiran', comments: 'Komentar', logs: 'Log' };
const MAX_UPLOAD_MB = 25;

/* ---------------------------------------------------------------- web app */

function doGet() {
  ensureSetup_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .addMetaTag('theme-color', '#6d5dfc')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Jalankan sekali dari editor Apps Script (pemilik) untuk membuat Spreadsheet & folder Drive. */
function setup() {
  ensureSetup_();
  const ss = SpreadsheetApp.openById(PROP.getProperty('SHEET_ID'));
  const folder = DriveApp.getFolderById(PROP.getProperty('FOLDER_ID'));
  Logger.log('Spreadsheet : ' + ss.getUrl());
  Logger.log('Folder Drive: ' + folder.getUrl());
  Logger.log('Bagikan folder "' + folder.getName() + '" ke tim sebagai EDITOR agar semua bisa mengisi.');
}

function ensureSetup_() {
  if (PROP.getProperty('SHEET_ID') && PROP.getProperty('FOLDER_ID')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (PROP.getProperty('SHEET_ID') && PROP.getProperty('FOLDER_ID')) return;
    const root = DriveApp.createFolder(APP_NAME);
    const files = root.createFolder('Lampiran');
    const ss = SpreadsheetApp.create(APP_NAME + ' — Database');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    Object.keys(SHEETS).forEach(function (k, i) {
      const sh = i === 0 ? ss.getSheets()[0].setName(SHEET_NAMES[k]) : ss.insertSheet(SHEET_NAMES[k]);
      sh.getRange(1, 1, 1, SHEETS[k].length).setValues([SHEETS[k]])
        .setFontWeight('bold').setBackground('#6d5dfc').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    });
    PROP.setProperties({ SHEET_ID: ss.getId(), FOLDER_ID: files.getId(), ROOT_ID: root.getId(), VERSION: '1' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------------- helpers */

function ss_() { return SpreadsheetApp.openById(PROP.getProperty('SHEET_ID')); }
function sheet_(k) { return ss_().getSheetByName(SHEET_NAMES[k]); }
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function now_() { return new Date().toISOString(); }

function me_() {
  const email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'anonim';
  return email.toLowerCase();
}

function readAll_(k) {
  const sh = sheet_(k);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = SHEETS[k];
  return sh.getRange(2, 1, last - 1, cols.length).getDisplayValues().map(function (r, i) {
    const o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j]; });
    return o;
  });
}

function toRow_(k, obj) {
  return SHEETS[k].map(function (c) {
    const v = obj[c];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    // simpan sebagai teks agar tanggal/jam tidak diubah format oleh Sheets
    return typeof v === 'string' && /^[\d:\-+=]/.test(v) ? "'" + v : v;
  });
}

function bump_() {
  const v = Number(PROP.getProperty('VERSION') || 1) + 1;
  PROP.setProperty('VERSION', String(v));
  return v;
}

function log_(aksi, ev, detail) {
  sheet_('logs').appendRow(toRow_('logs', {
    waktu: now_(), pengguna: me_(), aksi: aksi,
    eventId: ev ? ev.id : '', judul: ev ? ev.judul : '', detail: detail || '',
  }));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function parseEvent_(e) {
  const o = Object.assign({}, e);
  ['checklist', 'peserta', 'tautan'].forEach(function (k) {
    try { o[k] = o[k] ? JSON.parse(o[k]) : []; } catch (err) { o[k] = []; }
  });
  o.seharian = String(o.seharian).toUpperCase() === 'TRUE';
  delete o._row;
  return o;
}

/* ---------------------------------------------------------------- API */

function apiBootstrap() {
  ensureSetup_();
  const data = apiData();
  data.user = me_();
  data.rootUrl = 'https://drive.google.com/drive/folders/' + PROP.getProperty('ROOT_ID');
  data.sheetUrl = 'https://docs.google.com/spreadsheets/d/' + PROP.getProperty('SHEET_ID');
  data.maxUploadMb = MAX_UPLOAD_MB;
  return data;
}

function apiVersion() { return Number(PROP.getProperty('VERSION') || 1); }

function apiData() {
  const events = readAll_('events').filter(function (e) { return e.dihapus !== 'TRUE' && e.id; }).map(parseEvent_);
  const files = readAll_('files').filter(function (f) { return f.dihapus !== 'TRUE' && f.id; })
    .map(function (f) { delete f._row; return f; });
  const comments = readAll_('comments').filter(function (c) { return c.id; })
    .map(function (c) { delete c._row; return c; });
  return { events: events, files: files, comments: comments, version: apiVersion() };
}

function apiSaveEvent(input) {
  if (!input || !String(input.judul || '').trim()) throw new Error('Judul kegiatan wajib diisi');
  if (!input.mulai) throw new Error('Tanggal mulai wajib diisi');
  return withLock_(function () {
    const sh = sheet_('events');
    const user = me_();
    const t = now_();
    const clean = {
      judul: String(input.judul).trim().slice(0, 200),
      deskripsi: String(input.deskripsi || '').slice(0, 5000),
      mulai: input.mulai,
      selesai: input.selesai && input.selesai >= input.mulai ? input.selesai : input.mulai,
      jamMulai: input.seharian ? '' : (input.jamMulai || ''),
      jamSelesai: input.seharian ? '' : (input.jamSelesai || ''),
      seharian: !!input.seharian,
      lokasi: String(input.lokasi || '').slice(0, 300),
      kategori: input.kategori || 'Umum',
      prioritas: input.prioritas || 'Sedang',
      status: input.status || 'Direncanakan',
      peserta: input.peserta || [],
      checklist: input.checklist || [],
      tautan: input.tautan || [],
    };

    if (input.id) {
      const cur = readAll_('events').filter(function (e) { return e.id === input.id && e.dihapus !== 'TRUE'; })[0];
      if (!cur) throw new Error('Kegiatan tidak ditemukan (mungkin sudah dihapus)');
      const before = parseEvent_(cur);
      const diff = {};
      Object.keys(clean).forEach(function (k) {
        if (JSON.stringify(before[k]) !== JSON.stringify(clean[k])) diff[k] = { dari: before[k], ke: clean[k] };
      });
      const rec = Object.assign({}, before, clean, { diubahOleh: user, diubahPada: t, dihapus: false });
      sh.getRange(cur._row, 1, 1, SHEETS.events.length).setValues([toRow_('events', rec)]);
      log_('UBAH', rec, JSON.stringify(diff));
      bump_();
      return rec;
    }

    const rec = Object.assign({ id: uid_() }, clean,
      { dibuatOleh: user, dibuatPada: t, diubahOleh: user, diubahPada: t, dihapus: false });
    sh.appendRow(toRow_('events', rec));
    log_('BUAT', rec, JSON.stringify(clean));
    bump_();
    return rec;
  });
}

/** Pindah tanggal cepat (drag & drop). */
function apiMoveEvent(id, mulai) {
  return withLock_(function () {
    const cur = readAll_('events').filter(function (e) { return e.id === id && e.dihapus !== 'TRUE'; })[0];
    if (!cur) throw new Error('Kegiatan tidak ditemukan');
    const ev = parseEvent_(cur);
    const span = (new Date(ev.selesai) - new Date(ev.mulai)) / 864e5;
    const s = new Date(mulai + 'T00:00:00Z');
    s.setUTCDate(s.getUTCDate() + span);
    const selesai = s.toISOString().slice(0, 10);
    const rec = Object.assign({}, ev, { mulai: mulai, selesai: selesai, diubahOleh: me_(), diubahPada: now_() });
    sheet_('events').getRange(cur._row, 1, 1, SHEETS.events.length).setValues([toRow_('events', rec)]);
    log_('PINDAH', rec, JSON.stringify({ mulai: { dari: ev.mulai, ke: mulai } }));
    bump_();
    return rec;
  });
}

function apiDeleteEvent(id) {
  return withLock_(function () {
    const cur = readAll_('events').filter(function (e) { return e.id === id && e.dihapus !== 'TRUE'; })[0];
    if (!cur) return true;
    const ev = parseEvent_(cur);
    // soft-delete: data tetap tersimpan untuk audit & bisa dipulihkan
    sheet_('events').getRange(cur._row, SHEETS.events.indexOf('dihapus') + 1).setValue(true);
    log_('HAPUS', ev, '');
    bump_();
    return true;
  });
}

function apiRestoreEvent(id) {
  return withLock_(function () {
    const cur = readAll_('events').filter(function (e) { return e.id === id; })[0];
    if (!cur) throw new Error('Kegiatan tidak ditemukan');
    sheet_('events').getRange(cur._row, SHEETS.events.indexOf('dihapus') + 1).setValue(false);
    log_('PULIHKAN', parseEvent_(cur), '');
    bump_();
    return true;
  });
}

function apiDuplicateEvent(id, mulai) {
  const cur = readAll_('events').filter(function (e) { return e.id === id; })[0];
  if (!cur) throw new Error('Kegiatan tidak ditemukan');
  const ev = parseEvent_(cur);
  const span = (new Date(ev.selesai) - new Date(ev.mulai)) / 864e5;
  const s = new Date(mulai + 'T00:00:00Z');
  s.setUTCDate(s.getUTCDate() + span);
  return apiSaveEvent(Object.assign({}, ev, {
    id: '', mulai: mulai, selesai: s.toISOString().slice(0, 10), status: 'Direncanakan',
    checklist: (ev.checklist || []).map(function (c) { return { t: c.t, d: false }; }),
  }));
}

function apiToggleChecklist(id, index) {
  return withLock_(function () {
    const cur = readAll_('events').filter(function (e) { return e.id === id && e.dihapus !== 'TRUE'; })[0];
    if (!cur) throw new Error('Kegiatan tidak ditemukan');
    const ev = parseEvent_(cur);
    if (!ev.checklist[index]) return ev;
    ev.checklist[index].d = !ev.checklist[index].d;
    ev.diubahOleh = me_(); ev.diubahPada = now_();
    sheet_('events').getRange(cur._row, 1, 1, SHEETS.events.length).setValues([toRow_('events', ev)]);
    log_('CHECKLIST', ev, (ev.checklist[index].d ? '☑ ' : '☐ ') + ev.checklist[index].t);
    bump_();
    return ev;
  });
}

function apiUpload(eventId, name, mime, base64) {
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) throw new Error('Ukuran file maks ' + MAX_UPLOAD_MB + ' MB');
  const ev = readAll_('events').filter(function (e) { return e.id === eventId; })[0];
  if (!ev) throw new Error('Simpan kegiatan terlebih dahulu sebelum mengunggah');

  // Folder: Lampiran / 2026-09 / 2026-09-27 — Judul
  const root = DriveApp.getFolderById(PROP.getProperty('FOLDER_ID'));
  const month = getOrCreate_(root, ev.mulai.slice(0, 7));
  const folder = getOrCreate_(month, ev.mulai + ' — ' + ev.judul.replace(/[\\/]/g, '-').slice(0, 80));
  const file = folder.createFile(Utilities.newBlob(bytes, mime || 'application/octet-stream', name));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* kebijakan domain */ }
  file.setDescription('Lampiran "' + ev.judul + '" oleh ' + me_());

  return withLock_(function () {
    const rec = {
      id: uid_(), eventId: eventId, fileId: file.getId(), nama: name, mime: mime,
      ukuran: bytes.length, url: file.getUrl(), oleh: me_(), pada: now_(), dihapus: false,
    };
    sheet_('files').appendRow(toRow_('files', rec));
    log_('UNGGAH', { id: eventId, judul: ev.judul }, name + ' (' + Math.round(bytes.length / 1024) + ' KB)');
    bump_();
    return rec;
  });
}

function apiDeleteFile(id) {
  return withLock_(function () {
    const f = readAll_('files').filter(function (x) { return x.id === id; })[0];
    if (!f) return true;
    sheet_('files').getRange(f._row, SHEETS.files.indexOf('dihapus') + 1).setValue(true);
    try { DriveApp.getFileById(f.fileId).setTrashed(true); } catch (e) { /* tidak punya akses */ }
    log_('HAPUS_FILE', { id: f.eventId, judul: '' }, f.nama);
    bump_();
    return true;
  });
}

function apiComment(eventId, isi) {
  isi = String(isi || '').trim().slice(0, 2000);
  if (!isi) throw new Error('Komentar kosong');
  return withLock_(function () {
    const rec = { id: uid_(), eventId: eventId, oleh: me_(), pada: now_(), isi: isi };
    sheet_('comments').appendRow(toRow_('comments', rec));
    log_('KOMENTAR', { id: eventId, judul: '' }, isi.slice(0, 200));
    bump_();
    return rec;
  });
}

function apiLogs(limit, eventId) {
  let rows = readAll_('logs');
  if (eventId) rows = rows.filter(function (r) { return r.eventId === eventId; });
  return rows.slice(-(limit || 300)).reverse().map(function (r) { delete r._row; return r; });
}

function getOrCreate_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ---------------------------------------------------------------- AI: dokumen yang dibutuhkan */

/**
 * Menghasilkan daftar dokumen yang perlu disiapkan untuk sebuah kegiatan.
 * Memakai Google Gemini bila Script Property GEMINI_API_KEY diisi,
 * jika tidak memakai template bawaan per kategori.
 */
function apiAiDocs(eventId) {
  const cur = readAll_('events').filter(function (e) { return e.id === eventId; })[0];
  if (!cur) throw new Error('Kegiatan tidak ditemukan');
  const ev = parseEvent_(cur);
  const key = PROP.getProperty('GEMINI_API_KEY');
  let docs = null, sumber = 'template';
  if (key) {
    try { docs = geminiDocs_(ev, key); sumber = 'gemini'; } catch (e) { Logger.log('Gemini gagal: ' + e); }
  }
  // tanpa Gemini: frontend memakai template format BHP Medan (lihat BHP_TEMPLATES di Index.html)
  if (!docs || !docs.length) return { sumber: 'template', docs: null };
  log_('AI_DOKUMEN', ev, docs.map(function (d) { return d.nama; }).join(', '));
  return { sumber: sumber, docs: docs };
}

function geminiDocs_(ev, key) {
  const model = PROP.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const prompt = 'Kamu asisten administrasi Balai Harta Peninggalan (BHP) Medan, Kantor Wilayah Kementerian Hukum Sumatera Utara ' +
    '(tugas: wali pengawas perwalian/pengampuan, penyumpahan wali, inventarisasi harta, kepailitan, harta tak terurus). ' +
    'Ikuti format surat dinas BHP Medan: kop "KEMENTERIAN HUKUM REPUBLIK INDONESIA / KANTOR WILAYAH SUMATERA UTARA / ' +
    'BALAI HARTA PENINGGALAN MEDAN / Jalan Listrik No. 10 Medan", nomor "W.2.AHU.AHU.1-<kode>-[....]", Sifat/Lampiran/Hal, ' +
    '"Yth. ...", penutup "Demikian ...", tanda tangan "Kepala," lalu nama, dan Tembusan bila perlu. Laporan memakai bab ' +
    'Pendahuluan (Umum, Maksud dan Tujuan, Ruang Lingkup, Tempat dan Waktu, Pegawai Yang Ditunjuk, Dasar Hukum), ' +
    'Kegiatan yang Dilaksanakan dan Hasil yang Dicapai, Kesimpulan dan Saran, Penutup. ' +
    'Kamu asisten administrasi kantor pemerintahan Indonesia. Untuk kegiatan berikut, tentukan 3-7 dokumen ' +
    'yang WAJIB/PERLU disiapkan (sebelum, saat, dan sesudah kegiatan). Untuk tiap dokumen beri: nama, tahap ' +
    '(Sebelum/Saat/Sesudah), alasan singkat, dan draf isi (kerangka lengkap dengan poin-poin, bahasa Indonesia formal, ' +
    'isi data kegiatan yang diketahui, gunakan [....] untuk yang harus dilengkapi). Jawab HANYA JSON array ' +
    '[{"nama":"","tahap":"","alasan":"","isi":""}].\n\nKegiatan: ' + JSON.stringify({
      judul: ev.judul, deskripsi: ev.deskripsi, tanggal: ev.mulai + (ev.selesai !== ev.mulai ? ' s/d ' + ev.selesai : ''),
      jam: ev.seharian ? 'seharian' : ev.jamMulai + '-' + ev.jamSelesai, lokasi: ev.lokasi, kategori: ev.kategori,
      peserta: ev.peserta, checklist: ev.checklist.map(function (c) { return c.t; }),
    });
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
  });
  if (res.getResponseCode() !== 200) throw new Error(res.getContentText().slice(0, 300));
  const text = JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
  const arr = JSON.parse(text.replace(/^```json|```$/g, ''));
  return arr.filter(function (d) { return d && d.nama; }).slice(0, 8);
}

/** Membuat draf Google Docs di folder kegiatan dan mencatatnya sebagai lampiran. */
function apiCreateDoc(eventId, nama, isi) {
  const ev = readAll_('events').filter(function (e) { return e.id === eventId; })[0];
  if (!ev) throw new Error('Kegiatan tidak ditemukan');
  const doc = DocumentApp.create(nama + ' — ' + ev.judul);
  const body = doc.getBody();
  String(isi || '').split('\n').forEach(function (line, i) {
    const p = i === 0 ? body.getParagraphs()[0].setText(line) : body.appendParagraph(line);
    if (i === 0) p.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  });
  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  const root = DriveApp.getFolderById(PROP.getProperty('FOLDER_ID'));
  file.moveTo(getOrCreate_(getOrCreate_(root, ev.mulai.slice(0, 7)), ev.mulai + ' — ' + ev.judul.replace(/[\\/]/g, '-').slice(0, 80)));
  return withLock_(function () {
    const rec = { id: uid_(), eventId: eventId, fileId: doc.getId(), nama: file.getName(), mime: 'application/vnd.google-apps.document',
      ukuran: 0, url: doc.getUrl(), oleh: me_(), pada: now_(), dihapus: false };
    sheet_('files').appendRow(toRow_('files', rec));
    log_('BUAT_DOKUMEN', { id: eventId, judul: ev.judul }, file.getName());
    bump_();
    return rec;
  });
}

/** Menambahkan item ke checklist (dipakai AI & To Do List). */
function apiAddChecklist(eventId, items) {
  return withLock_(function () {
    const cur = readAll_('events').filter(function (e) { return e.id === eventId && e.dihapus !== 'TRUE'; })[0];
    if (!cur) throw new Error('Kegiatan tidak ditemukan');
    const ev = parseEvent_(cur);
    const have = ev.checklist.map(function (c) { return c.t; });
    [].concat(items).forEach(function (t) { t = String(t).trim(); if (t && have.indexOf(t) < 0) ev.checklist.push({ t: t, d: false }); });
    ev.diubahOleh = me_(); ev.diubahPada = now_();
    sheet_('events').getRange(cur._row, 1, 1, SHEETS.events.length).setValues([toRow_('events', ev)]);
    log_('CHECKLIST', ev, '+ ' + [].concat(items).join(', '));
    bump_();
    return ev;
  });
}
