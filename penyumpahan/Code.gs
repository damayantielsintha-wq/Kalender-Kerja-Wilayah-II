/**
 * Dokumen Penyumpahan BHP Medan — backend Google Apps Script
 * Data   : Google Sheets (Berkas, Riwayat, Pengguna, Pengaturan) milik pemilik skrip
 * Akses  : login username + password aplikasi; semua perubahan tercatat di sheet Riwayat
 * Nomor  : konektor ke SPS (sps.batamen.com) lewat UrlFetchApp, kredensial di Properti Skrip
 */

const APP = 'Dokumen Penyumpahan BHP';
const PROPS = PropertiesService.getScriptProperties();
const SESSION_JAM = 8;

const COLS = {
  Berkas: ['id', 'jenis', 'nama', 'objek', 'data', 'versi', 'dibuatOleh', 'dibuatPada', 'diubahOleh', 'diubahPada', 'dihapus'],
  Riwayat: ['waktu', 'username', 'nama', 'aksi', 'berkasId', 'berkas', 'detail'],
  Pengguna: ['username', 'nama', 'role', 'hash', 'salt', 'aktif', 'wajibGanti', 'dibuatPada', 'loginTerakhir', 'email'],
  Pengaturan: ['kunci', 'nilai'],
};

/** Pengguna awal. superadmin = akses menyeluruh; admin = akses sederhana. */
const PENGGUNA_AWAL = [
  ['shela', 'Shela Natasha', 'superadmin'],
  ['annisa', 'Annisa Dwi Marina', 'admin', 'annisadwimarina@gmail.com'],
  ['elsintha', 'Elsintha Damayanti', 'admin', 'damayantielsintha@gmail.com'],
  ['yusril', 'Yusril Ihza Mahendra', 'admin'],
  ['andre', 'Andre Yosua Surbakti', 'admin'],
  ['fairuz', 'Nur Fairuz Diba Nasution', 'admin'],
  ['nanang', 'Nanang Surya Purnama', 'admin'],
  ['taufik', 'M. Taufik Rahman', 'admin'],
];

/* ------------------------------------------------------------ web app */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Jalankan SEKALI dari editor (akun Shela). Membuat spreadsheet database dan 8 akun
 * dengan password sementara. Password sementara tampil di Log eksekusi — bagikan ke
 * masing-masing orang secara pribadi; mereka wajib menggantinya saat login pertama.
 */
function setup() {
  const ss = db_();
  const sh = ss.getSheetByName('Pengguna');
  const ada = sh.getDataRange().getValues().slice(1).map(function (r) { return r[0]; });
  const out = [];
  PENGGUNA_AWAL.forEach(function (p) {
    if (ada.indexOf(p[0]) >= 0) return;
    const pwd = passwordAcak_();
    const salt = Utilities.getUuid();
    sh.appendRow([p[0], p[1], p[2], hash_(pwd, salt), salt, true, true, new Date(), '', p[3] || '']);
    out.push(p[1] + ' (' + p[2] + ')  username: ' + p[0] + '  password sementara: ' + pwd);
  });
  log_({ username: 'system', nama: 'Setup' }, 'SETUP', '', '', 'Database dibuat / pengguna awal ditambahkan: ' + out.length);
  const root = folderRoot_();
  sinkronAkses_();
  Logger.log('Database: ' + ss.getUrl());
  Logger.log('Folder dokumen: ' + root.getUrl());
  Logger.log(out.length ? out.join('\n') : 'Semua pengguna sudah ada.');
}

/* ------------------------------------------------------------ storage */

let SS_ = null;
function db_() {
  if (SS_) return SS_;
  let id = PROPS.getProperty('DB_ID');
  let ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create(APP + ' — Database');
    ss.getSheets()[0].setName('Berkas');
    PROPS.setProperty('DB_ID', ss.getId());
  }
  Object.keys(COLS).forEach(function (n) {
    const s = ss.getSheetByName(n) || ss.insertSheet(n);
    if (s.getLastRow() > 0) {
      if (s.getLastColumn() < COLS[n].length) s.getRange(1, 1, 1, COLS[n].length).setValues([COLS[n]]); // migrasi kolom baru
      return;
    }
    s.getRange(1, 1, 1, COLS[n].length).setValues([COLS[n]]).setFontWeight('bold').setBackground('#4f46e5').setFontColor('#fff');
    s.setFrozenRows(1);
  });
  SS_ = ss;
  return ss;
}
function sheet_(n) { return db_().getSheetByName(n); }
function rows_(n) {
  const v = sheet_(n).getDataRange().getValues();
  const h = v.shift();
  return v.map(function (r, i) { const o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}
function iso_(d) { return d instanceof Date ? d.toISOString() : (d || ''); }

/* ------------------------------------------------------------ auth */

function hash_(pwd, salt) {
  let b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pwd, Utilities.Charset.UTF_8);
  for (let i = 0; i < 500; i++) b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b.concat(Utilities.newBlob(salt).getBytes()));
  return Utilities.base64Encode(b);
}
function passwordAcak_() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}
function user_(token) {
  if (!token) throw new Error('SESI_HABIS');
  const cache = CacheService.getScriptCache();
  const u = cache.get('sess_' + token);
  if (!u) throw new Error('SESI_HABIS');
  const p = rows_('Pengguna').filter(function (r) { return r.username === u; })[0];
  if (!p || p.aktif !== true) throw new Error('SESI_HABIS');
  cache.put('sess_' + token, u, SESSION_JAM * 3600);
  return { username: p.username, nama: p.nama, role: p.role, wajibGanti: p.wajibGanti === true, _row: p._row };
}
function super_(token) {
  const u = user_(token);
  if (u.role !== 'superadmin') throw new Error('Hanya admin utama yang boleh melakukan ini.');
  return u;
}

function apiLogin(username, password) {
  username = String(username || '').trim().toLowerCase();
  const p = rows_('Pengguna').filter(function (r) { return r.username === username; })[0];
  if (!p || p.aktif !== true || hash_(password, p.salt) !== p.hash) {
    log_({ username: username || '?', nama: p ? p.nama : '?' }, 'LOGIN_GAGAL', '', '', 'Username/password salah atau akun nonaktif');
    Utilities.sleep(800);
    throw new Error('Username atau password salah.');
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, username, SESSION_JAM * 3600);
  sheet_('Pengguna').getRange(p._row, 9).setValue(new Date());
  log_(p, 'LOGIN', '', '', '');
  return { token: token, user: { username: p.username, nama: p.nama, role: p.role, wajibGanti: p.wajibGanti === true } };
}
function apiLogout(token) {
  try { const u = user_(token); log_(u, 'LOGOUT', '', '', ''); } catch (e) {}
  CacheService.getScriptCache().remove('sess_' + token);
  return true;
}
function apiGantiPassword(token, lama, baru) {
  const u = user_(token);
  const p = rows_('Pengguna').filter(function (r) { return r.username === u.username; })[0];
  if (hash_(lama, p.salt) !== p.hash) throw new Error('Password lama salah.');
  if (!baru || baru.length < 8) throw new Error('Password baru minimal 8 karakter.');
  const salt = Utilities.getUuid();
  sheet_('Pengguna').getRange(p._row, 4, 1, 4).setValues([[hash_(baru, salt), salt, true, false]]);
  log_(u, 'GANTI_PASSWORD', '', '', '');
  return true;
}

/* ------------------------------------------------------------ data */

function apiInit(token) {
  const u = user_(token);
  const out = { user: u, settings: settings_(), berkas: berkas_(u.role === 'superadmin'), sps: spsInfo_(), folderUrl: folderRoot_().getUrl() };
  if (u.role === 'superadmin') out.users = daftarPengguna_();
  return out;
}
function berkas_(termasukHapus) {
  return rows_('Berkas').filter(function (r) { return termasukHapus || r.dihapus !== true; }).map(function (r) {
    let d = {};
    try { d = JSON.parse(r.data); } catch (e) {}
    d.id = r.id;
    d._versi = r.versi;
    d._dihapus = r.dihapus === true;
    d._meta = { dibuatOleh: r.dibuatOleh, dibuatPada: iso_(r.dibuatPada), diubahOleh: r.diubahOleh, diubahPada: iso_(r.diubahPada) };
    return d;
  });
}

/** Simpan berkas. Menolak jika versi di server lebih baru (diubah admin lain). */
function apiSimpan(token, rec, versiDasar) {
  const u = user_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Berkas');
    const ada = rows_('Berkas').filter(function (r) { return r.id === rec.id; })[0];
    const bersih = bersihkan_(rec);
    const now = new Date();
    if (!ada) {
      sh.appendRow([rec.id, rec.jenis, rec.nama || '', objek_(rec), JSON.stringify(bersih), 1, u.nama, now, u.nama, now, false]);
      log_(u, 'BUAT', rec.id, rec.nama, rec.asal || 'Berkas baru');
      return { versi: 1, diubahOleh: u.nama, diubahPada: now.toISOString() };
    }
    if (ada.dihapus === true) throw new Error('Berkas ini sudah dihapus.');
    if (versiDasar && Number(ada.versi) !== Number(versiDasar)) {
      const d = JSON.parse(ada.data); d.id = ada.id; d._versi = ada.versi;
      return { konflik: true, oleh: ada.diubahOleh, server: d };
    }
    const lama = JSON.parse(ada.data || '{}');
    const beda = diff_(lama, bersih);
    if (!beda.length) return { versi: ada.versi };
    const versi = Number(ada.versi) + 1;
    sh.getRange(ada._row, 1, 1, 11).setValues([[rec.id, rec.jenis, rec.nama || '', objek_(rec), JSON.stringify(bersih), versi, ada.dibuatOleh, ada.dibuatPada, u.nama, now, false]]);
    log_(u, 'UBAH', rec.id, rec.nama, JSON.stringify(beda));
    return { versi: versi, diubahOleh: u.nama, diubahPada: now.toISOString() };
  } finally {
    lock.releaseLock();
  }
}
function apiHapus(token, id) {
  const u = super_(token);
  const r = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Berkas tidak ditemukan.');
  sheet_('Berkas').getRange(r._row, 11).setValue(true);
  log_(u, 'HAPUS', id, r.nama, 'Berkas dipindah ke arsip terhapus (bisa dipulihkan)');
  return true;
}
function apiPulihkan(token, id) {
  const u = super_(token);
  const r = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Berkas tidak ditemukan.');
  sheet_('Berkas').getRange(r._row, 11).setValue(false);
  log_(u, 'PULIHKAN', id, r.nama, '');
  return true;
}
/** Dicatat setiap kali dokumen .docx diunduh. */
function apiCatat(token, aksi, id, nama, detail) {
  const u = user_(token);
  if (['UNDUH_DOCX', 'BACA_PENETAPAN', 'IMPOR_CSV'].indexOf(aksi) < 0) throw new Error('Aksi tidak dikenal');
  log_(u, aksi, id || '', nama || '', detail || '');
  return true;
}

/**
 * Riwayat. Admin utama: semua catatan (bisa difilter per pengguna / berkas).
 * Admin biasa: hanya riwayat berkas tertentu.
 */
function apiRiwayat(token, f) {
  const u = user_(token);
  f = f || {};
  if (u.role !== 'superadmin' && !f.berkasId) throw new Error('Pilih berkas untuk melihat riwayatnya.');
  let r = rows_('Riwayat');
  if (f.berkasId) r = r.filter(function (x) { return x.berkasId === f.berkasId; });
  if (f.username) r = r.filter(function (x) { return x.username === f.username; });
  if (f.aksi) r = r.filter(function (x) { return x.aksi === f.aksi; });
  if (f.q) { const q = f.q.toLowerCase(); r = r.filter(function (x) { return (x.berkas + ' ' + x.detail + ' ' + x.nama).toLowerCase().indexOf(q) >= 0; }); }
  r.reverse();
  return r.slice(0, f.limit || 300).map(function (x) {
    return { waktu: iso_(x.waktu), username: x.username, nama: x.nama, aksi: x.aksi, berkasId: x.berkasId, berkas: x.berkas, detail: x.detail };
  });
}

function log_(u, aksi, id, berkas, detail) {
  sheet_('Riwayat').appendRow([new Date(), u.username, u.nama, aksi, id || '', berkas || '', String(detail || '').slice(0, 45000)]);
}
function bersihkan_(rec) {
  const o = JSON.parse(JSON.stringify(rec));
  Object.keys(o).forEach(function (k) { if (k.charAt(0) === '_' && k !== '_kelManual') delete o[k]; });
  delete o.asal;
  return o;
}
function objek_(r) {
  if (r.jenis === 'Perwalian') return (r.anak || []).map(function (a) { return a.nama; }).filter(String).join(', ');
  return r.terampu ? r.terampu.nama || '' : '';
}
function flat_(o, pre, out) {
  out = out || {};
  Object.keys(o || {}).forEach(function (k) {
    const v = o[k], p = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object') flat_(v, p, out); else out[p] = v === undefined || v === null ? '' : String(v);
  });
  return out;
}
function diff_(a, b) {
  const fa = flat_(a), fb = flat_(b), out = [];
  const keys = {};
  Object.keys(fa).concat(Object.keys(fb)).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).forEach(function (k) {
    if (k === 'id' || k === '_kelManual') return;
    if ((fa[k] || '') !== (fb[k] || '')) out.push({ f: k, dari: fa[k] || '', ke: fb[k] || '' });
  });
  return out;
}

/* ------------------------------------------------------------ pengaturan */

function settings_() {
  const o = {};
  rows_('Pengaturan').forEach(function (r) { try { o[r.kunci] = JSON.parse(r.nilai); } catch (e) {} });
  return o;
}
function apiSimpanPengaturan(token, set) {
  const u = super_(token);
  const lama = settings_();
  const sh = sheet_('Pengaturan');
  const ada = rows_('Pengaturan');
  const berubah = [];
  Object.keys(set).forEach(function (k) {
    const v = JSON.stringify(set[k]);
    if (JSON.stringify(lama[k]) === v) return;
    berubah.push(k);
    const r = ada.filter(function (x) { return x.kunci === k; })[0];
    if (r) sh.getRange(r._row, 2).setValue(v); else sh.appendRow([k, v]);
  });
  if (berubah.length) log_(u, 'PENGATURAN', '', '', 'Diubah: ' + berubah.join(', '));
  return true;
}

/* ------------------------------------------------------------ pengguna (admin utama) */

function daftarPengguna_() {
  return rows_('Pengguna').map(function (r) {
    return { username: r.username, nama: r.nama, role: r.role, aktif: r.aktif === true, wajibGanti: r.wajibGanti === true, loginTerakhir: iso_(r.loginTerakhir), email: r.email || '' };
  });
}
function apiPengguna(token) { super_(token); return daftarPengguna_(); }
function apiResetPassword(token, username) {
  const u = super_(token);
  const p = rows_('Pengguna').filter(function (r) { return r.username === username; })[0];
  if (!p) throw new Error('Pengguna tidak ditemukan.');
  const pwd = passwordAcak_(), salt = Utilities.getUuid();
  sheet_('Pengguna').getRange(p._row, 4, 1, 4).setValues([[hash_(pwd, salt), salt, p.aktif, true]]);
  log_(u, 'RESET_PASSWORD', '', '', 'Password ' + p.nama + ' direset');
  return pwd;
}
function apiSimpanPengguna(token, data) {
  const u = super_(token);
  const sh = sheet_('Pengguna');
  const username = String(data.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) throw new Error('Username minimal 3 huruf/angka tanpa spasi.');
  const p = rows_('Pengguna').filter(function (r) { return r.username === username; })[0];
  if (p) {
    if (p.username === u.username && (data.role !== 'superadmin' || data.aktif === false)) throw new Error('Tidak bisa menurunkan/menonaktifkan akun sendiri.');
    sh.getRange(p._row, 2, 1, 2).setValues([[data.nama, data.role === 'superadmin' ? 'superadmin' : 'admin']]);
    sh.getRange(p._row, 6).setValue(data.aktif !== false);
    sh.getRange(p._row, 10).setValue(email_(data.email));
    log_(u, 'UBAH_PENGGUNA', '', '', p.nama + ' → ' + data.nama + ', ' + data.role + ', ' + (data.aktif !== false ? 'aktif' : 'nonaktif') + (data.email ? ', ' + data.email : ''));
    sinkronAkses_();
    return null;
  }
  const pwd = passwordAcak_(), salt = Utilities.getUuid();
  sh.appendRow([username, data.nama, data.role || 'admin', hash_(pwd, salt), salt, true, true, new Date(), '', email_(data.email)]);
  log_(u, 'TAMBAH_PENGGUNA', '', '', data.nama + ' (' + (data.role || 'admin') + ')');
  sinkronAkses_();
  return pwd;
}

/* ------------------------------------------------------------ SPS (nomor surat) */

const SPS_DEF = {
  url: 'https://sps.batamen.com',
  loginPath: '/api/login', userField: 'username', passField: 'password', loginFormat: 'json',
  tokenPath: 'token',
  nomorPath: '/api/nomor', method: 'post', bodyFormat: 'json',
  body: '{"klasifikasi":"{klasifikasi}","perihal":"{perihal}","tujuan":"{tujuan}","tanggal":"{tanggal}","sifat":"Segera"}',
  nomorJson: 'nomor', nomorRegex: 'W\\.2\\.AHU\\.[A-Z0-9.\\-]+',
  klasifikasi: 'AH.06.03',
};
function spsCfg_() { const s = settings_().sps || {}; const o = {}; Object.keys(SPS_DEF).forEach(function (k) { o[k] = s[k] !== undefined && s[k] !== '' ? s[k] : SPS_DEF[k]; }); return o; }
function spsInfo_() { return { terhubung: !!(PROPS.getProperty('SPS_USER') && PROPS.getProperty('SPS_PASS')), url: spsCfg_().url }; }

/** Admin utama menyimpan username & password SPS. Disimpan di Properti Skrip, tidak pernah dikirim ke browser. */
function apiSimpanKredensialSps(token, username, password) {
  const u = super_(token);
  if (username) PROPS.setProperty('SPS_USER', username);
  if (password) PROPS.setProperty('SPS_PASS', password);
  CacheService.getScriptCache().remove('sps_auth');
  log_(u, 'PENGATURAN', '', '', 'Kredensial SPS diperbarui');
  return spsInfo_();
}

function ambilJson_(o, path) {
  return String(path || '').split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o);
}
function spsAuth_(cfg, paksa) {
  const cache = CacheService.getScriptCache();
  const c = !paksa && cache.get('sps_auth');
  if (c) return JSON.parse(c);
  const user = PROPS.getProperty('SPS_USER'), pass = PROPS.getProperty('SPS_PASS');
  if (!user || !pass) throw new Error('Kredensial SPS belum diisi oleh admin utama.');
  const payload = {}; payload[cfg.userField] = user; payload[cfg.passField] = pass;
  const res = UrlFetchApp.fetch(cfg.url.replace(/\/$/, '') + cfg.loginPath, {
    method: 'post', followRedirects: false, muteHttpExceptions: true,
    contentType: cfg.loginFormat === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
    payload: cfg.loginFormat === 'json' ? JSON.stringify(payload) : payload,
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error('Login SPS gagal (HTTP ' + code + ').');
  const h = res.getAllHeaders();
  let cookies = h['Set-Cookie'] || h['set-cookie'] || [];
  if (!Array.isArray(cookies)) cookies = [cookies];
  const auth = { cookie: cookies.map(function (s) { return String(s).split(';')[0]; }).join('; '), token: '' };
  try { auth.token = ambilJson_(JSON.parse(res.getContentText()), cfg.tokenPath) || ''; } catch (e) {}
  if (!auth.cookie && !auth.token) throw new Error('Login SPS tidak mengembalikan sesi/token.');
  cache.put('sps_auth', JSON.stringify(auth), 1800);
  return auth;
}

/**
 * Ambil nomor surat dari SPS untuk satu dokumen berkas.
 * dok: 'nomorSurat' | 'nomorLurah' | 'nomorBA' | 'nomorBAHarta'
 * info: { perihal, tujuan, tanggal, kurang: [] } disusun di browser; server menolak bila masih ada isian kurang.
 */
function apiAmbilNomor(token, id, dok, info) {
  const u = user_(token);
  if (['nomorSurat', 'nomorLurah', 'nomorBA', 'nomorBAHarta'].indexOf(dok) < 0) throw new Error('Jenis dokumen tidak dikenal.');
  if (info.kurang && info.kurang.length) throw new Error('Isian belum lengkap: ' + info.kurang.join(', '));
  const r = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Simpan berkas dulu sebelum mengambil nomor.');
  const data = JSON.parse(r.data);
  if (data[dok]) throw new Error('Dokumen ini sudah punya nomor: ' + data[dok]);
  const cfg = spsCfg_();
  const isi = { klasifikasi: cfg.klasifikasi, perihal: info.perihal || '', tujuan: info.tujuan || '', tanggal: info.tanggal || '', nama: r.nama, jenis: r.jenis };
  const body = cfg.body.replace(/\{(\w+)\}/g, function (m, k) { return String(isi[k] == null ? '' : isi[k]).replace(/["\\]/g, '\\$&'); });

  function minta(auth) {
    const headers = {};
    if (auth.cookie) headers.Cookie = auth.cookie;
    if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
    const opt = { method: cfg.method, headers: headers, muteHttpExceptions: true, followRedirects: false };
    if (cfg.method !== 'get') {
      if (cfg.bodyFormat === 'json') { opt.contentType = 'application/json'; opt.payload = body; }
      else opt.payload = JSON.parse(body);
    }
    return UrlFetchApp.fetch(cfg.url.replace(/\/$/, '') + cfg.nomorPath, opt);
  }
  let res = minta(spsAuth_(cfg));
  if ([401, 403, 302].indexOf(res.getResponseCode()) >= 0) res = minta(spsAuth_(cfg, true));
  const code = res.getResponseCode(), txt = res.getContentText();
  if (code >= 300) throw new Error('SPS menolak permintaan (HTTP ' + code + '): ' + txt.slice(0, 200));
  let nomor = '';
  try { nomor = ambilJson_(JSON.parse(txt), cfg.nomorJson) || ''; } catch (e) {}
  if (!nomor && cfg.nomorRegex) { const m = txt.match(new RegExp(cfg.nomorRegex)); if (m) nomor = m[0]; }
  if (!nomor) throw new Error('Nomor tidak ditemukan pada balasan SPS: ' + txt.slice(0, 200));

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
    const d = JSON.parse(now.data);
    d[dok] = String(nomor);
    const versi = Number(now.versi) + 1;
    sheet_('Berkas').getRange(now._row, 5, 1, 6).setValues([[JSON.stringify(d), versi, now.dibuatOleh, now.dibuatPada, u.nama, new Date()]]);
    log_(u, 'AMBIL_NOMOR', id, r.nama, JSON.stringify([{ f: dok, dari: '', ke: String(nomor) }]) + ' | ' + info.perihal);
    return { nomor: String(nomor), versi: versi };
  } finally {
    lock.releaseLock();
  }
}

/** Uji koneksi SPS (login saja). */
function apiTesSps(token) {
  super_(token);
  const a = spsAuth_(spsCfg_(), true);
  return 'Login SPS berhasil (' + (a.token ? 'token' : 'cookie') + ').';
}

/* ------------------------------------------------------------ AI Gemini (opsional) */

function apiSimpanKunciGemini(token, key) {
  const u = super_(token);
  if (key) PROPS.setProperty('GEMINI_KEY', key); else PROPS.deleteProperty('GEMINI_KEY');
  log_(u, 'PENGATURAN', '', '', 'Kunci Gemini ' + (key ? 'diperbarui' : 'dihapus'));
  return !!key;
}
function apiAdaGemini(token) { user_(token); return !!PROPS.getProperty('GEMINI_KEY'); }

/** Baca PDF penetapan dengan Gemini. Kunci API tetap di server. */
function apiBacaPenetapanAI(token, b64, mime, prompt) {
  user_(token);
  const key = PROPS.getProperty('GEMINI_KEY');
  if (!key) return null;
  const model = PROPS.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime || 'application/pdf', data: b64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
  });
  if (res.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);
}

/* ------------------------------------------------------------ Google Drive: folder & Google Docs */

function email_(e) {
  e = String(e || '').trim().toLowerCase();
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Format email tidak valid: ' + e);
  return e;
}
/** Folder utama: "Dokumen Penyumpahan BHP Medan" (milik pemilik skrip). */
function folderRoot_() {
  const id = PROPS.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Dokumen Penyumpahan BHP Medan');
  f.setDescription('Dibuat otomatis oleh aplikasi Dokumen Penyumpahan. Struktur: Tahun / Pengampuan|Perwalian / Nama - Nomor Penetapan.');
  try { DriveApp.getFileById(db_().getId()).moveTo(f); } catch (e) {}
  PROPS.setProperty('FOLDER_ID', f.getId());
  return f;
}
function sub_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
/** Folder berkas: <root>/<tahun sumpah>/<Pengampuan|Perwalian>/<NAMA> - <nomor penetapan> */
function folderBerkas_(d) {
  const th = String(d.tglSumpah || d.tanggalSurat || new Date().toISOString()).slice(0, 4);
  const nama = (String(d.nama || 'TANPA NAMA') + (d.nomorPenetapan ? ' - ' + d.nomorPenetapan : '')).replace(/[\/\\:*?"<>|]/g, '_');
  return sub_(sub_(sub_(folderRoot_(), th), d.jenis || 'Pengampuan'), nama);
}
/** Semua admin aktif yang punya email mendapat akses Editor ke folder utama; admin nonaktif dicabut. */
function sinkronAkses_() {
  const f = folderRoot_();
  const editors = f.getEditors().map(function (x) { return x.getEmail().toLowerCase(); });
  const owner = Session.getEffectiveUser().getEmail().toLowerCase();
  rows_('Pengguna').forEach(function (r) {
    const e = String(r.email || '').toLowerCase();
    if (!e || e === owner) return;
    try {
      if (r.aktif === true && editors.indexOf(e) < 0) f.addEditor(e);
      if (r.aktif !== true && editors.indexOf(e) >= 0) f.removeEditor(e);
    } catch (err) { Logger.log('Gagal atur akses ' + e + ': ' + err); }
  });
}

/**
 * Simpan dokumen sebagai Google Docs (bisa diedit) di folder berkas.
 * b64 = file .docx yang dirakit di browser (kop, logo, tabel) — dikonversi Drive menjadi Google Docs.
 * Jika dokumen yang sama sudah ada, versi lama dipindah ke subfolder "Arsip" (tidak dihapus).
 */
function apiBuatDokumen(token, id, key, judul, b64) {
  const u = user_(token);
  const r = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Simpan berkas dulu.');
  if (r.dihapus === true) throw new Error('Berkas sudah dihapus.');
  const d = JSON.parse(r.data);
  const folder = folderBerkas_(d);
  const nama = (judul + ' - ' + (d.nama || '')).replace(/[\/\\]/g, '_');
  d.dokumen = d.dokumen || {};
  const lama = d.dokumen[key];
  if (lama && lama.id) { try { DriveApp.getFileById(lama.id).setName(nama + ' (versi ' + String(lama.waktu).slice(0, 10) + ')').moveTo(sub_(folder, 'Arsip')); } catch (e) {} }
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', nama + '.docx');
  const file = Drive.Files.create({ name: nama, mimeType: MimeType.GOOGLE_DOCS, parents: [folder.getId()] }, blob, { fields: 'id,webViewLink' });
  const now = new Date();
  d.dokumen[key] = { id: file.id, url: file.webViewLink || ('https://docs.google.com/document/d/' + file.id + '/edit'), waktu: now.toISOString(), oleh: u.nama };
  d.folderUrl = folder.getUrl();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now2 = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
    const d2 = JSON.parse(now2.data);
    d2.dokumen = d.dokumen; d2.folderUrl = d.folderUrl;
    const versi = Number(now2.versi) + 1;
    sheet_('Berkas').getRange(now2._row, 5, 1, 6).setValues([[JSON.stringify(d2), versi, now2.dibuatOleh, now2.dibuatPada, u.nama, now]]);
    log_(u, 'BUAT_DOKUMEN', id, d.nama, judul + (lama ? ' (dibuat ulang; versi lama di folder Arsip)' : '') + ' | ' + d.dokumen[key].url);
    return { dok: d.dokumen[key], folderUrl: d.folderUrl, versi: versi };
  } finally {
    lock.releaseLock();
  }
}

function apiTesGemini(token) {
  super_(token);
  const key = PROPS.getProperty('GEMINI_KEY');
  if (!key) throw new Error('Kunci Gemini belum diisi.');
  const model = PROPS.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: 'Balas satu kata: siap' }] }] }) });
  if (res.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return 'Gemini (' + model + ') terhubung.';
}
