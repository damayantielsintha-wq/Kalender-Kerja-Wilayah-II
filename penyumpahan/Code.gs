/**
 * Dokumen Penyumpahan BHP Medan — backend Google Apps Script
 * Data   : Google Sheets (Berkas, Riwayat, Pengguna, Pengaturan) milik pemilik skrip
 * Akses  : login username + password aplikasi; semua perubahan tercatat di sheet Riwayat
 * Nomor  : konektor ke SPS (sps.batamen.com) lewat UrlFetchApp, kredensial di Properti Skrip
 */

const APP = 'Dokumen Penyumpahan BHP';
const PROPS = PropertiesService.getScriptProperties();
const SESSION_JAM = 6; // batas CacheService
const INGAT_HARI = 30; // opsi "Tetap masuk"

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
  ['andre', 'Andre Yosua Surbakti', 'admin', 'andrebhpmedan@gmail.com'],
  ['fairuz', 'Nur Fairuz Diba Nasution', 'admin'],
  ['nanang', 'Nanang Surya Purnama', 'admin'],
  ['taufik', 'M. Taufik Rahman', 'admin'],
];

/* ------------------------------------------------------------ web app */

const UI_URL = 'https://raw.githubusercontent.com/damayantielsintha-wq/Kalender-Kerja-Wilayah-II/claude/dokumen-penyumpahan-app-3s2ts5/penyumpahan/Index.html';
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Dokumen Penyumpahan BHP')
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
  const out = [];
  // akun yang sudah ada tapi belum pernah login: buat password sementara baru agar bisa dibagikan ulang
  rows_('Pengguna').forEach(function (r) {
    if (r.loginTerakhir || r.wajibGanti !== true) return;
    const pwd = passwordAcak_(), salt = Utilities.getUuid();
    sh.getRange(r._row, 4, 1, 2).setValues([[hash_(pwd, salt), salt]]);
    out.push(r.nama + ' (' + r.role + ')  username: ' + r.username + '  password sementara: ' + pwd);
  });
  const ada = sh.getDataRange().getValues().slice(1).map(function (r) { return r[0]; });
  PENGGUNA_AWAL.forEach(function (p) {
    if (ada.indexOf(p[0]) >= 0) return;
    const pwd = passwordAcak_();
    const salt = Utilities.getUuid();
    sh.appendRow([p[0], p[1], p[2], hash_(pwd, salt), salt, true, true, new Date(), '', p[3] || '']);
    out.push(p[1] + ' (' + p[2] + ')  username: ' + p[0] + '  password sementara: ' + pwd);
  });
  log_({ username: 'system', nama: 'Setup' }, 'SETUP', '', '', 'Database dibuat / pengguna awal ditambahkan: ' + out.length);
  Logger.log(out.length ? out.join('\n') : 'Semua pengguna sudah pernah login (password tidak diubah).');
  Logger.log('Database: ' + ss.getUrl());
  const root = folderRoot_();
  Logger.log('Folder dokumen: ' + root.getUrl());
  try { sinkronAkses_(); } catch (e) { Logger.log('Akses folder belum dibagikan: ' + e.message); }
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
  let u = cache.get('sess_' + token);
  if (!u) {
    /* sesi "Tetap masuk": disimpan di Script Properties selama INGAT_HARI */
    const ing = PROPS.getProperty('ing_' + token);
    if (ing) { try { const o = JSON.parse(ing); if (o.exp > Date.now()) u = o.u; else PROPS.deleteProperty('ing_' + token); } catch (e) {} }
    if (!u) throw new Error('SESI_HABIS');
  }
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

function apiLogin(username, password, ingat) {
  username = String(username || '').trim().toLowerCase();
  const p = rows_('Pengguna').filter(function (r) { return r.username === username; })[0];
  if (!p || p.aktif !== true || hash_(password, p.salt) !== p.hash) {
    log_({ username: username || '?', nama: p ? p.nama : '?' }, 'LOGIN_GAGAL', '', '', 'Username/password salah atau akun nonaktif');
    Utilities.sleep(800);
    throw new Error('Username atau password salah.');
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, username, SESSION_JAM * 3600);
  if (ingat) {
    const now = Date.now(), semua = PROPS.getProperties();
    Object.keys(semua).forEach(function (k) { if (k.indexOf('ing_') === 0) { try { if (JSON.parse(semua[k]).exp < now) PROPS.deleteProperty(k); } catch (e) {} } });
    PROPS.setProperty('ing_' + token, JSON.stringify({ u: username, exp: now + INGAT_HARI * 864e5 }));
  }
  sheet_('Pengguna').getRange(p._row, 9).setValue(new Date());
  log_(p, 'LOGIN', '', '', '');
  return { token: token, user: { username: p.username, nama: p.nama, role: p.role, wajibGanti: p.wajibGanti === true }, init: apiInit(token) };
}
function apiLogout(token) {
  try { const u = user_(token); log_(u, 'LOGOUT', '', '', ''); } catch (e) {}
  CacheService.getScriptCache().remove('sess_' + token);
  PROPS.deleteProperty('ing_' + token);
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
  const out = { user: u, settings: settings_(), berkas: berkas_(u.role === 'superadmin'), sps: spsInfo_(), folderUrl: PROPS.getProperty('FOLDER_ID') ? 'https://drive.google.com/drive/folders/' + PROPS.getProperty('FOLDER_ID') : folderRoot_().getUrl(), ai: !!PROPS.getProperty('CLAUDE_KEY') };
  if (u.role === 'superadmin') { out.users = daftarPengguna_(); try { if (perluBapSiap_() && terapkanBapSiap_(u)) out.berkas = berkas_(true); } catch (e) {} }
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
/** Simpan banyak berkas baru sekaligus (impor spreadsheet) — satu kali tulis, jauh lebih cepat. */
function apiSimpanBanyak(token, recs) {
  const u = super_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ada = {}, kunci = {};
    const kk = function (r) { return [r.jenis, r.nomorPenetapan, r.nama].map(function (x) { return String(x || '').trim().toUpperCase(); }).join('|'); };
    rows_('Berkas').forEach(function (r) {
      ada[r.id] = 1;
      if (r.dihapus === true) return;
      try { kunci[kk(JSON.parse(r.data))] = 1; } catch (e) {}
    });
    const now = new Date(), baris = [], log = [];
    let lewat = 0;
    (recs || []).forEach(function (rec) {
      if (!rec || !rec.id || ada[rec.id]) return;
      if (kunci[kk(rec)]) { lewat++; return; }
      ada[rec.id] = 1; kunci[kk(rec)] = 1;
      baris.push([rec.id, rec.jenis, rec.nama || '', objek_(rec), JSON.stringify(bersihkan_(rec)), 1, u.nama, now, u.nama, now, false]);
      log.push([now, u.username, u.nama, 'BUAT', rec.id, rec.nama || '', rec.asal || 'Impor spreadsheet']);
    });
    if (baris.length) {
      const sh = sheet_('Berkas');
      sh.getRange(sh.getLastRow() + 1, 1, baris.length, 11).setValues(baris);
      const lg = sheet_('Riwayat');
      lg.getRange(lg.getLastRow() + 1, 1, log.length, 7).setValues(log);
    }
    return { jumlah: baris.length, lewat: lewat, ids: baris.map(function (b) { return b[0]; }) };
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
/*
 * Protokol sama dengan skrip SAPA WALI BHP Medan:
 *  - autentikasi: cookie sesi Laravel (termasuk XSRF-TOKEN) → header Cookie + X-XSRF-TOKEN
 *  - ambil nomor    : POST /surat/store {nama_pegawai, kode_belakang, perihal, tanggal_surat[, nomor_surat]} → nomor_lengkap
 *  - nomor selalu diambil dengan tanggal hari ini (tanpa tanggal mundur)
 * Cookie bisa ditempel manual (SPS_COOKIE) atau didapat otomatis lewat login username/password (SPS_USER/SPS_PASS).
 */
const SPS_BASE = 'https://sps.batamen.com';
const SPS_KODE = { Pengampuan: 'AH.06.03', Perwalian: 'AH.06.02' };

function spsInfo_() {
  return { terhubung: !!(PROPS.getProperty('SPS_COOKIE') || (PROPS.getProperty('SPS_USER') && PROPS.getProperty('SPS_PASS'))),
    cookie: !!PROPS.getProperty('SPS_COOKIE'), akun: !!(PROPS.getProperty('SPS_USER') && PROPS.getProperty('SPS_PASS')), url: SPS_BASE };
}
/** Admin utama menyimpan cookie SPS dan/atau username+password. Disimpan di Properti Skrip, tidak pernah dikirim ke browser. */
function apiSimpanKredensialSps(token, username, password, cookie) {
  const u = super_(token);
  if (username) PROPS.setProperty('SPS_USER', username);
  if (password) PROPS.setProperty('SPS_PASS', password);
  if (cookie) PROPS.setProperty('SPS_COOKIE', String(cookie).trim());
  CacheService.getScriptCache().remove('sps_cookie');
  log_(u, 'PENGATURAN', '', '', 'Kredensial SPS diperbarui' + (cookie ? ' (cookie)' : '') + (username ? ' (akun)' : ''));
  return spsInfo_();
}
function gabungCookie_(lama, res) {
  const jar = {};
  String(lama || '').split(/;\s*/).forEach(function (c) { const i = c.indexOf('='); if (i > 0) jar[c.slice(0, i)] = c.slice(i + 1); });
  const h = res.getAllHeaders();
  let sc = h['Set-Cookie'] || h['set-cookie'] || [];
  if (!Array.isArray(sc)) sc = [sc];
  sc.forEach(function (c) { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); });
  return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
}
/** Login otomatis ke SPS (form login Laravel) memakai SPS_USER/SPS_PASS. */
function spsLogin_() {
  const user = PROPS.getProperty('SPS_USER'), pass = PROPS.getProperty('SPS_PASS');
  if (!user || !pass) return '';
  const r1 = UrlFetchApp.fetch(SPS_BASE + '/login', { muteHttpExceptions: true, followRedirects: false });
  let cookie = gabungCookie_('', r1);
  const m = r1.getContentText().match(/name="_token"\s+value="([^"]+)"/) || r1.getContentText().match(/<meta name="csrf-token" content="([^"]+)"/);
  const field = (settings_().spsField || (/name="email"/.test(r1.getContentText()) ? 'email' : 'username'));
  const payload = { _token: m ? m[1] : '', password: pass }; payload[field] = user;
  const r2 = UrlFetchApp.fetch(SPS_BASE + '/login', { method: 'post', payload: payload, muteHttpExceptions: true, followRedirects: false, headers: { Cookie: cookie, Referer: SPS_BASE + '/login' } });
  cookie = gabungCookie_(cookie, r2);
  const loc = String((r2.getAllHeaders().Location || r2.getAllHeaders().location || ''));
  if (r2.getResponseCode() >= 400 || /\/login/.test(loc)) throw new Error('Login SPS gagal: username/password ditolak (HTTP ' + r2.getResponseCode() + ').');
  return cookie;
}
function spsCookie_(baru) {
  const cache = CacheService.getScriptCache();
  if (!baru) { const c = cache.get('sps_cookie'); if (c) return c; }
  let c = '';
  if (baru || !PROPS.getProperty('SPS_COOKIE')) c = spsLogin_();
  if (!c) c = (PROPS.getProperty('SPS_COOKIE') || '').trim();
  if (!c) throw new Error('SPS belum terhubung: admin utama perlu mengisi cookie atau akun SPS di Pengaturan.');
  cache.put('sps_cookie', c, 3600);
  return c;
}
function spsHeaders_(c) {
  const m = c.match(/XSRF-TOKEN=([^;]+)/);
  const h = { Cookie: c, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', Referer: SPS_BASE + '/surat/tanggal-mundur' };
  if (m) h['X-XSRF-TOKEN'] = decodeURIComponent(m[1]);
  return h;
}
/** Panggil SPS; jika sesi habis (401/419/302) coba login ulang sekali. */
function spsFetch_(path, opt) {
  let c = spsCookie_();
  let res = UrlFetchApp.fetch(SPS_BASE + path, Object.assign({ headers: spsHeaders_(c), muteHttpExceptions: true, followRedirects: false }, opt));
  if ([401, 419, 302].indexOf(res.getResponseCode()) >= 0 && PROPS.getProperty('SPS_USER')) {
    c = spsCookie_(true);
    res = UrlFetchApp.fetch(SPS_BASE + path, Object.assign({ headers: spsHeaders_(c), muteHttpExceptions: true, followRedirects: false }, opt));
  }
  if ([401, 419, 302].indexOf(res.getResponseCode()) >= 0) throw new Error('Sesi SPS kedaluwarsa. Admin utama perlu memperbarui cookie/akun SPS di Pengaturan.');
  return res;
}
function hariIni_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'); }
/** Ambil nomor SPS bertanggal HARI INI (tidak memakai tanggal mundur). */
function spsAmbil_(jenis, perihal, pegawai) {
  const body = { nama_pegawai: pegawai, kode_belakang: SPS_KODE[jenis] || SPS_KODE.Pengampuan, perihal: perihal, tanggal_surat: hariIni_() };
  const r = spsFetch_('/surat/store', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body) });
  if (r.getResponseCode() !== 200) throw new Error('SPS ambil nomor gagal (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 300));
  const j = JSON.parse(r.getContentText());
  if (!j.success || !j.nomor_lengkap) throw new Error('SPS menolak: ' + (j.message || r.getContentText().slice(0, 200)));
  return String(j.nomor_lengkap);
}

/**
 * Ambil nomor surat dari SPS untuk satu dokumen berkas.
 * dok: 'nomorSurat' | 'nomorLurah' | 'nomorBAP' | 'nomorBA' | 'nomorBAHarta'
 * info.kurang: daftar isian yang belum lengkap (dicek di browser; server menolak bila tidak kosong).
 */
function apiAmbilNomor(token, id, dok, info) {
  const u = user_(token);
  if (['nomorSurat', 'nomorLurah', 'nomorUndangan', 'nomorUndDesa', 'nomorBAP', 'nomorBA', 'nomorBAHarta'].indexOf(dok) < 0) throw new Error('Jenis dokumen tidak dikenal.');
  if (info.kurang && info.kurang.length) throw new Error('Isian belum lengkap: ' + info.kurang.join(', '));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r = rows_('Berkas').filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('Simpan berkas dulu sebelum mengambil nomor.');
    const d = JSON.parse(r.data);
    if (d[dok]) throw new Error('Dokumen ini sudah punya nomor: ' + d[dok]);
    const tgl = hariIni_();
    const nomor = spsAmbil_(d.jenis, String(info.perihal || '').slice(0, 250), u.nama);
    d[dok] = nomor;
    if (dok === 'nomorSurat' || dok === 'nomorLurah') d.tanggalSurat = tgl; // tanggal surat = tanggal nomor
    const versi = Number(r.versi) + 1;
    sheet_('Berkas').getRange(r._row, 5, 1, 6).setValues([[JSON.stringify(d), versi, r.dibuatOleh, r.dibuatPada, u.nama, new Date()]]);
    log_(u, 'AMBIL_NOMOR', id, r.nama, JSON.stringify([{ f: dok, dari: '', ke: nomor }]) + ' | ' + SPS_KODE[d.jenis] + ' · ' + tgl + ' · ' + info.perihal);
    return { nomor: nomor, versi: versi, tanggalSurat: d.tanggalSurat };
  } finally {
    lock.releaseLock();
  }
}

/** Uji koneksi SPS: cek ketersediaan nomor 7 hari lalu (tidak mengambil nomor). */
function apiTesSps(token) {
  super_(token);
  const d = new Date(); d.setDate(d.getDate() - 7);
  const t = Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
  const r = spsFetch_('/surat/available-nomor/' + t, { method: 'get' });
  if (r.getResponseCode() !== 200) throw new Error('Gagal, kode ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  const j = JSON.parse(r.getContentText());
  return 'SPS terhubung. Tanggal ' + t + ': nomor terakhir ' + (j.info && j.info.nomor_terakhir_hari_ini) + ', tersedia ' + j.available_count + ' nomor cadangan.';
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
  let owner = '';
  try { owner = f.getOwner().getEmail().toLowerCase(); } catch (e) {}
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

/* ------------------------------------------------------------ AI pembaca penetapan (Claude) */

const CLAUDE_MODEL = 'claude-sonnet-5';

function apiSimpanKunciAI(token, key) {
  const u = super_(token);
  key = String(key || '').trim();
  if (key && !/^sk-ant-/.test(key)) throw new Error('Kunci Claude harus diawali sk-ant- (buat di console.anthropic.com → API Keys).');
  if (key) PROPS.setProperty('CLAUDE_KEY', key); else PROPS.deleteProperty('CLAUDE_KEY');
  PROPS.deleteProperty('GEMINI_KEY');
  log_(u, 'PENGATURAN', '', '', 'Kunci AI Claude ' + (key ? 'disimpan' : 'dihapus'));
  return !!key;
}
function apiAdaAI(token) {
  user_(token);
  return !!PROPS.getProperty('CLAUDE_KEY');
}
function claude_(content, maxTokens) {
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': PROPS.getProperty('CLAUDE_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: PROPS.getProperty('CLAUDE_MODEL') || CLAUDE_MODEL, max_tokens: maxTokens || 4000, messages: [{ role: 'user', content: content }] }) });
  if (res.getResponseCode() !== 200) throw new Error('Claude HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  const j = JSON.parse(res.getContentText());
  if (j.stop_reason === 'refusal') throw new Error('Claude menolak memproses dokumen ini.');
  return j.content.map(function (c) { return c.text || ''; }).join('');
}
function jsonDari_(t) {
  t = String(t || '').replace(/```(?:json)?/g, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('Jawaban AI bukan JSON.');
  return JSON.parse(t.slice(i, j + 1));
}
/** Baca file penetapan (PDF/gambar, base64) dengan Claude dan kembalikan objek data. */
function apiBacaPenetapanAI(token, b64, mime, prompt) {
  user_(token);
  if (!PROPS.getProperty('CLAUDE_KEY')) return null;
  mime = mime || 'application/pdf';
  const doc = /pdf/.test(mime)
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
  return jsonDari_(claude_([doc, { type: 'text', text: prompt + '\nBalas HANYA satu objek JSON, tanpa penjelasan.' }], 8000));
}
function apiTesAI(token) {
  super_(token);
  if (!PROPS.getProperty('CLAUDE_KEY')) throw new Error('Kunci Claude belum diisi.');
  claude_([{ type: 'text', text: 'Balas satu kata: siap' }], 20);
  return 'Claude (' + (PROPS.getProperty('CLAUDE_MODEL') || CLAUDE_MODEL) + ') terhubung.';
}

/* ------------------------------------------------------------ impor dari sheet AutoCrat (mis. PERWALIAN RIAU) */
function apiBacaSheet(token, ssId, nama) {
  super_(token);
  const ss = SpreadsheetApp.openById(ssId || PEGAWAI_SS_DEFAULT);
  const sh = ss.getSheetByName(nama);
  if (!sh) throw new Error('Sheet "' + nama + '" tidak ditemukan di ' + ss.getName() + '.');
  const v = sh.getDataRange().getDisplayValues();
  return { judul: ss.getName() + ' / ' + nama, header: v[0] || [], rows: v.slice(1).filter(function (r) { return r.join('').trim(); }) };
}

/* ------------------------------------------------------------ data pegawai (sheet "Dokumen Otomatis") */

const PEGAWAI_SS_DEFAULT = '1aOsRbouL5P6yrdunrPAuG4IdNehjvPoT9MoL5CrAPFM';
/**
 * Baca pegawai dari sheet "Data Lengkap Pegawai" (cadangan: "Daftar Pegawai") dan simpan ke Pengaturan.pejabat.
 * Kolom dikenali dari judul: nama, NIP, jabatan (baris judul dicari di 5 baris pertama).
 */
function apiSinkronPegawai(token, ssId) {
  const u = super_(token);
  const ss = SpreadsheetApp.openById(ssId || PEGAWAI_SS_DEFAULT);
  const sh = ss.getSheetByName('Data Lengkap Pegawai') || ss.getSheetByName('Daftar Pegawai');
  if (!sh) throw new Error('Sheet "Data Lengkap Pegawai" / "Daftar Pegawai" tidak ditemukan.');
  const v = sh.getDataRange().getDisplayValues();
  let h = -1, cn = -1, ci = -1, cj = -1;
  for (let i = 0; i < Math.min(5, v.length) && h < 0; i++) {
    const row = v[i].map(function (x) { return String(x).toLowerCase(); });
    cn = row.findIndex(function (x) { return /nama/.test(x) && !/jabatan|pangkat|unit/.test(x); });
    ci = row.findIndex(function (x) { return /^nip\b|\bnip\b/.test(x); });
    cj = row.findIndex(function (x) { return /jabatan/.test(x); });
    if (cn >= 0 && ci >= 0) h = i;
  }
  if (h < 0) throw new Error('Kolom Nama & NIP tidak dikenali pada sheet ' + sh.getName() + '.');
  const out = [], seen = {};
  v.slice(h + 1).forEach(function (r) {
    const nama = String(r[cn] || '').trim(), nip = String(r[ci] || '').replace(/\s/g, '');
    if (!nama || seen[nama.toUpperCase()]) return;
    seen[nama.toUpperCase()] = 1;
    out.push({ nama: nama.toUpperCase().replace(/,\s*S\..*$/, '').trim(), namaLengkap: nama, nip: nip, jabatan: cj >= 0 ? String(r[cj] || '').trim() : '' });
  });
  const set = settings_();
  set.pejabat = out;
  set.pegawaiSumber = ss.getName() + ' / ' + sh.getName();
  apiSimpanPengaturan(token, { pejabat: out, pegawaiSumber: set.pegawaiSumber });
  log_(u, 'PENGATURAN', '', '', 'Sinkron ' + out.length + ' pegawai dari ' + set.pegawaiSumber);
  return out;
}

/** Jalankan dari editor untuk menyeragamkan password semua akun (tanpa wajib ganti saat login). */
function setPasswordSemua() {
  const PASSWORD = 'wilayah2';
  const sh = sheet_('Pengguna');
  rows_('Pengguna').forEach(function (r) {
    const salt = Utilities.getUuid();
    sh.getRange(r._row, 4, 1, 4).setValues([[hash_(PASSWORD, salt), salt, true, false]]);
  });
  log_({ username: 'system', nama: 'Setup' }, 'RESET_PASSWORD', '', '', 'Password semua akun diseragamkan oleh pemilik skrip');
  Logger.log('Password semua akun sudah diubah.');
}

/**
 * Diagnostik: jalankan dari editor (pilih "cekSemua" → Run), lalu lihat Execution log.
 * Hanya membaca — tidak mengambil nomor SPS dan tidak mengubah data.
 */
function cekSemua() {
  const P = PropertiesService.getScriptProperties();
  // 1. AI
  if (P.getProperty('CLAUDE_KEY')) { try { claude_([{ type: 'text', text: 'Balas satu kata: siap' }], 20); Logger.log('CLAUDE  ✅ Terhubung.'); } catch (e) { Logger.log('CLAUDE  ❌ ' + e.message); } }
  else Logger.log('CLAUDE  ❌ Kunci belum tersimpan. Simpan di aplikasi: Pengaturan → AI → Simpan kunci.');
  // 2. SPS (cek ketersediaan nomor 7 hari lalu; tidak mengambil nomor)
  const cookie = (P.getProperty('SPS_COOKIE') || '').trim(), akun = P.getProperty('SPS_USER');
  if (!cookie && !akun) Logger.log('SPS     ❌ Cookie/akun SPS belum tersimpan. Isi di aplikasi: Pengaturan → Koneksi SPS.');
  else {
    try {
      const d = new Date(); d.setDate(d.getDate() - 7);
      const t = Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
      const r = spsFetch_('/surat/available-nomor/' + t, { method: 'get' });
      const c = r.getResponseCode();
      if (c === 200) { const j = JSON.parse(r.getContentText()); Logger.log('SPS     ✅ Terhubung. ' + t + ': nomor terakhir ' + (j.info && j.info.nomor_terakhir_hari_ini) + ', cadangan ' + j.available_count + '.'); }
      else Logger.log('SPS     ❌ HTTP ' + c + ': ' + r.getContentText().slice(0, 300));
    } catch (e) { Logger.log('SPS     ❌ ' + e.message); }
  }
  // 3. Drive API (untuk membuat Google Docs)
  try { Drive.Files.list({ pageSize: 1 }); Logger.log('DRIVE   ✅ Drive API aktif.'); }
  catch (e) { Logger.log('DRIVE   ❌ Drive API belum ditambahkan: Services (+) → Drive API → Add. (' + e.message + ')'); }
  // 4. Pegawai
  try { const n = (settings_().pejabat || []).length; Logger.log('PEGAWAI ' + (n ? '✅ ' + n + ' pejabat tersimpan.' : 'ℹ Belum sinkron — Pengaturan → Ambil dari sheet Data Pegawai.')); } catch (e) {}
}

/* ------------------------------------------------------------ isi BAP yang sudah disusun (file BapSiap.gs)
   Diterapkan otomatis saat admin utama membuka aplikasi: hanya ke berkas yang nomor penetapannya cocok
   dan isi BAP-nya masih kosong (tidak menimpa BAP yang sudah diisi/diedit). */
function kunciNo_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
/* hanya jalankan pengisian BAP bila daftar BAP atau jumlah baris berkas berubah sejak pengecekan terakhir (login lebih cepat) */
function perluBapSiap_() {
  if (typeof BAP_SIAP === 'undefined') return false;
  const t = Object.keys(BAP_SIAP).length + '_' + (typeof BAP_SIAP_VERSI === 'undefined' ? 1 : BAP_SIAP_VERSI) + '_' + sheet_('Berkas').getLastRow();
  if (PROPS.getProperty('BAP_SIAP_CEK') === t) return false;
  PROPS.setProperty('BAP_SIAP_CEK', t);
  return true;
}
function terapkanBapSiap_(u) {
  if (typeof BAP_SIAP === 'undefined') return 0;
  const tanda = 'BAP_SIAP_' + Object.keys(BAP_SIAP).length + '_' + (typeof BAP_SIAP_VERSI === 'undefined' ? 1 : BAP_SIAP_VERSI);
  const map = {};
  Object.keys(BAP_SIAP).forEach(function (k) { map[kunciNo_(k)] = BAP_SIAP[k]; });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  let n = 0;
  try {
    const sh = sheet_('Berkas'), now = new Date();
    rows_('Berkas').forEach(function (r) {
      if (r.dihapus === true) return;
      let d; try { d = JSON.parse(r.data); } catch (e) { return; }
      const isi = map[kunciNo_(d.nomorPenetapan)];
      if (!isi || String(d.isiBap || '').trim()) return;
      d.isiBap = isi.join('\n');
      sh.getRange(r._row, 5, 1, 6).setValues([[JSON.stringify(d), Number(r.versi) + 1, r.dibuatOleh, r.dibuatPada, u.nama, now]]);
      log_(u, 'UBAH', r.id, r.nama, 'Isi BAP diisi dari susunan penetapan ' + d.nomorPenetapan);
      n++;
    });
  } finally { lock.releaseLock(); }
  return n;
}


/* ------------------------------------------------------------ kegiatan kalender (Wilayah II) */
function setSetting_(k, v) {
  const sh = sheet_('Pengaturan'), r = rows_('Pengaturan').filter(function (x) { return x.kunci === k; })[0];
  if (r) sh.getRange(r._row, 2).setValue(JSON.stringify(v)); else sh.appendRow([k, JSON.stringify(v)]);
}
function apiKegiatanSimpan(token, ev) {
  const u = user_(token);
  if (!ev || !ev.tgl || !ev.judul) throw new Error('Tanggal dan judul kegiatan wajib diisi.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = settings_().kegiatan || [];
    const o = { id: ev.id || Utilities.getUuid(), tgl: String(ev.tgl), sampai: String(ev.sampai || ''), jam: String(ev.jam || ''), judul: String(ev.judul).slice(0, 200),
      jenis: String(ev.jenis || 'Lainnya'), tempat: String(ev.tempat || '').slice(0, 300), ket: String(ev.ket || '').slice(0, 1000), oleh: u.nama, pada: new Date().toISOString() };
    const i = L.findIndex(function (x) { return x.id === o.id; });
    if (i >= 0) L[i] = o; else L.push(o);
    setSetting_('kegiatan', L);
    log_(u, 'KEGIATAN', o.id, o.judul, (i >= 0 ? 'Ubah ' : 'Tambah ') + o.jenis + ' ' + o.tgl);
    return L;
  } finally { lock.releaseLock(); }
}
function apiKegiatanHapus(token, id) {
  const u = user_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = (settings_().kegiatan || []).filter(function (x) { return x.id !== id; });
    setSetting_('kegiatan', L);
    log_(u, 'KEGIATAN', id, '', 'Hapus kegiatan');
    return L;
  } finally { lock.releaseLock(); }
}
function apiLiburSimpan(token, libur) {
  const u = super_(token);
  setSetting_('libur', (libur || []).filter(function (x) { return x && x.tgl; }).map(function (x) { return { tgl: String(x.tgl), nama: String(x.nama || 'Libur').slice(0, 100) }; }));
  log_(u, 'PENGATURAN', '', '', 'Ubah daftar tanggal merah');
  return settings_().libur;
}
