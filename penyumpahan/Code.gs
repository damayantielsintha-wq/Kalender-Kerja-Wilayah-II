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
  /* profil pengguna di-cache 5 menit supaya tiap aksi tidak membaca sheet Pengguna (lebih cepat) */
  let prof = null;
  try { prof = JSON.parse(cache.get('usr_' + u) || 'null'); } catch (e) {}
  if (!prof) {
    const p = rows_('Pengguna').filter(function (r) { return r.username === u; })[0];
    if (!p || p.aktif !== true) throw new Error('SESI_HABIS');
    prof = { username: p.username, nama: p.nama, role: p.role, wajibGanti: p.wajibGanti === true, _row: p._row };
    cache.put('usr_' + u, JSON.stringify(prof), 300);
  }
  cache.put('sess_' + token, u, SESSION_JAM * 3600);
  return prof;
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
  CacheService.getScriptCache().put('usr_' + username, JSON.stringify({ username: p.username, nama: p.nama, role: p.role, wajibGanti: p.wajibGanti === true, _row: p._row }), 300);
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
  lupakanUser_(u.username);
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
function lupakanUser_(username) { try { CacheService.getScriptCache().remove('usr_' + username); } catch (e) {} }
function apiResetPassword(token, username) {
  lupakanUser_(username);
  const u = super_(token);
  const p = rows_('Pengguna').filter(function (r) { return r.username === username; })[0];
  if (!p) throw new Error('Pengguna tidak ditemukan.');
  const pwd = passwordAcak_(), salt = Utilities.getUuid();
  sheet_('Pengguna').getRange(p._row, 4, 1, 4).setValues([[hash_(pwd, salt), salt, p.aktif, true]]);
  log_(u, 'RESET_PASSWORD', '', '', 'Password ' + p.nama + ' direset');
  return pwd;
}
function apiSimpanPengguna(token, data) {
  if (data && data.username) lupakanUser_(String(data.username).toLowerCase().trim());
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
 *  - tanggal nomor dipilih pengguna (hari ini / mundur memakai nomor cadangan); tanggal maju ditolak
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
function jsonSps_(r, apa) {
  const t = r.getContentText();
  try { return JSON.parse(t); }
  catch (e) {
    if (/<html|<!doctype/i.test(t)) throw new Error('SPS mengembalikan halaman web, bukan data (' + apa + '). Sesi SPS kemungkinan habis — admin utama perlu memperbarui cookie/akun SPS di Pengaturan.');
    throw new Error('Jawaban SPS tidak terbaca (' + apa + '): ' + t.slice(0, 150));
  }
}
/**
 * Ambil daftar nomor cadangan yang masih TERSEDIA dari jawaban /surat/available-nomor/{tgl}
 * (halaman SPS "Nomor Hari Mundur": Nomor tersedia 2719, 2720 … ; Sudah terpakai 2714 …).
 * Bentuk JSON persisnya tidak didokumentasikan, jadi dicari array bernama available/tersedia,
 * dan array bernama used/terpakai dipakai untuk menyaring.
 */
function nomorTersedia_(j) {
  const ambil = function (v) { return (v && typeof v === 'object') ? (v.nomor || v.nomor_surat || v.number || v.value || v.no) : v; };
  const angka = function (arr) { return (arr || []).map(ambil).filter(function (x) { return x !== undefined && x !== null && /^\d+[A-Za-z]?$/.test(String(x).trim()); }).map(function (x) { return String(x).trim(); }); };
  const cariArr = function (o, pola, dalam) {
    if (!o || typeof o !== 'object' || dalam > 4) return null;
    for (const k in o) { if (pola.test(k) && Array.isArray(o[k])) return o[k]; }
    for (const k in o) { if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { const r = cariArr(o[k], pola, dalam + 1); if (r) return r; } }
    return null;
  };
  const pakai = angka(cariArr(j, /used|terpakai|pakai|taken|booked/i, 0));
  let ada = angka(cariArr(j, /avail|tersedia|kosong|free|sisa/i, 0));
  if (!ada.length && Array.isArray(j)) ada = angka(j);
  if (!ada.length && Array.isArray(j.data)) ada = angka(j.data);
  return ada.filter(function (x) { return pakai.indexOf(x) < 0; });
}
/** Diagnosa: lihat jawaban mentah SPS untuk satu tanggal (tidak mengambil nomor). */
function apiSpsCekTanggal(token, tanggal) {
  super_(token);
  tanggal = String(tanggal || hariIni_());
  const a = spsFetch_('/surat/available-nomor/' + tanggal, { method: 'get' });
  const t = a.getContentText();
  let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { http: a.getResponseCode(), tersedia: j ? nomorTersedia_(j) : [], mentah: t.slice(0, 3000) };
}
/** Ambil nomor SPS pada tanggal pilihan pengguna (hari ini atau tanggal mundur; tanggal maju ditolak). */
function spsAmbil_(jenis, perihal, pegawai, tanggal) {
  const hari = hariIni_();
  tanggal = String(tanggal || hari);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw new Error('Format tanggal nomor tidak valid: ' + tanggal);
  if (tanggal > hari) throw new Error('SPS tidak bisa mengambil nomor untuk tanggal yang akan datang (' + tanggal + ').');
  const body = { nama_pegawai: pegawai, kode_belakang: SPS_KODE[jenis] || SPS_KODE.Pengampuan, perihal: perihal, tanggal_surat: tanggal };
  if (tanggal < hari) {
    /* tanggal mundur: pakai nomor cadangan yang tersedia di tanggal itu */
    const a = spsFetch_('/surat/available-nomor/' + tanggal, { method: 'get' });
    if (a.getResponseCode() !== 200) throw new Error('SPS: gagal cek nomor tersedia tanggal ' + tanggal + ' (HTTP ' + a.getResponseCode() + ').');
    const j = jsonSps_(a, 'nomor tersedia');
    const nomor = nomorTersedia_(j)[0];
    if (!nomor) throw new Error('Tidak ada nomor cadangan SPS yang tersedia pada tanggal ' + tanggal + '. Pilih tanggal lain atau gunakan tanggal hari ini.');
    body.nomor_surat = nomor;
  }
  let r = null, err = null;
  for (let k = 0; k < 2; k++) {
    try { r = spsFetch_('/surat/store', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body) }); err = null; }
    catch (e) { err = e; if (/kedaluwarsa|belum terhubung/.test(e.message)) throw e; Utilities.sleep(1500); continue; }
    if (r.getResponseCode() >= 500) { Utilities.sleep(1500); continue; }
    break;
  }
  if (err) throw new Error('Gagal menghubungi SPS: ' + err.message);
  if (r.getResponseCode() !== 200) throw new Error('SPS ambil nomor gagal (HTTP ' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 300));
  const j = jsonSps_(r, 'ambil nomor');
  if (!j.success || !j.nomor_lengkap) throw new Error('SPS menolak: ' + (j.message || JSON.stringify(j).slice(0, 200)));
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
    const tgl = String(info.tanggalNomor || hariIni_());
    const nomor = spsAmbil_(d.jenis, String(info.perihal || '').slice(0, 250), u.nama, tgl);
    d[dok] = nomor;
    if (['nomorSurat', 'nomorLurah', 'nomorUndangan', 'nomorUndDesa'].indexOf(dok) >= 0) d.tanggalSurat = tgl; // tanggal surat = tanggal nomor
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
    payload: JSON.stringify({ model: PROPS.getProperty('CLAUDE_MODEL') || CLAUDE_MODEL, max_tokens: maxTokens || 4000, temperature: 0, messages: [{ role: 'user', content: content }] }) });
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
/** Penetapan sering berwatermark (mis. "SALINAN", "COPY", logo/nama pengadilan miring, cap Direktori Putusan MA). */
const WATERMARK_ = 'CATATAN WATERMARK: dokumen bisa memuat watermark/cap latar (tulisan miring atau samar seperti "SALINAN", "COPY", "DOKUMEN ELEKTRONIK", nama pengadilan, logo, cap "Direktori Putusan Mahkamah Agung", nomor halaman, atau potongan huruf tersisip di tengah kata). ABAIKAN semuanya; bila sebuah kata/angka terputus atau terselip huruf watermark, rekonstruksi dari konteks kalimat dan dokumen lain. Tetap baca SEMUA data (nama, NIK, tanggal, nomor, alamat, anak/terampu, harta, amar) seolah watermark tidak ada. Jangan mengarang: bila bagian tertentu benar-benar tertutup dan tidak bisa dipastikan, isi kosong.\n\n';
function apiBacaPenetapanAI(token, b64, mime, prompt) {
  prompt = WATERMARK_ + prompt;
  user_(token);
  if (!PROPS.getProperty('CLAUDE_KEY')) return null;
  mime = mime || 'application/pdf';
  const doc = /pdf/.test(mime)
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
  return jsonDari_(claude_([doc, { type: 'text', text: prompt + '\nBalas HANYA satu objek JSON, tanpa penjelasan.' }], 8000));
}
/** Versi cepat: kirim TEKS penetapan (hasil baca PDF di browser), bukan file PDF — jauh lebih cepat & hemat. */
function apiAnalisaTeks(token, teks, prompt, maxTokens) {
  user_(token);
  prompt = WATERMARK_ + prompt;
  if (!PROPS.getProperty('CLAUDE_KEY')) return null;
  teks = String(teks || '').slice(0, 120000);
  return jsonDari_(claude_([{ type: 'text', text: '<penetapan>\n' + teks + '\n</penetapan>\n\n' + prompt + '\nBalas HANYA satu objek JSON, tanpa penjelasan.' }], maxTokens || 6000));
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


/* ------------------------------------------------------------ cek silang ke SIPP pengadilan */
/** "Pengadilan Agama Pekanbaru" -> "pa-pekanbaru"; "PN Bangkinang" -> "pn-bangkinang" */
function sippDomain_(pengadilan, nomor) {
  let s = String(pengadilan || '').toLowerCase().replace(/kelas\s+\S+/g, '').trim();
  let jenis = /agama|mahkamah syar/.test(s) ? 'pa' : /negeri/.test(s) ? 'pn' : '';
  if (!jenis) jenis = /\bPA\b|PA\./.test(String(nomor || '')) ? 'pa' : 'pn';
  const kota = s.replace(/pengadilan|agama|negeri|mahkamah|syar.iyah|kota|kabupaten|\b(pn|pa)\b/g, ' ').trim().split(/\s+/).join('');
  return kota ? 'sipp.' + jenis + '-' + kota + '.go.id' : '';
}
function teksHtml_(h) { return String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
function normNama_(s) { return String(s || '').toUpperCase().replace(/\b(BIN|BINTI|BR\.?|BORU)\b/g, ' ').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim(); }
/** nama dianggap ada bila semua kata (>=3 huruf) nama muncul di teks SIPP */
function adaNama_(nama, teksNorm) {
  const w = normNama_(nama).split(' ').filter(function (x) { return x.length >= 3; });
  if (!w.length) return null;
  return w.every(function (x) { return (' ' + teksNorm + ' ').indexOf(' ' + x + ' ') >= 0; });
}
function ambilSipp_(dom, nomor) {
  const base = 'https://' + dom, opt = { muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: false, headers: { 'User-Agent': 'Mozilla/5.0 (BHP Medan cek perkara)' } };
  const kunci = nomor.replace(/\s+/g, '').toUpperCase();
  /* pencarian mengikuti menu SIPP: Perdata > Permohonan > kolom cari nomor perkara; beberapa varian URL dicoba berurutan */
  const upaya = [
    ['post', '/list_perkara/search', { search_keyword: nomor }],
    ['get', '/list_perkara/search?search_keyword=' + encodeURIComponent(nomor)],
    ['post', '/list_perkara/search', { search_keyword: nomor, jenis_perkara: 'permohonan' }],
    ['get', '/list_perkara/type/permohonan?search_keyword=' + encodeURIComponent(nomor)],
    ['get', '/list_perkara/page/1/search/' + encodeURIComponent(nomor)]
  ];
  let html = '', links = [], err = '';
  for (let i = 0; i < upaya.length && !links.length; i++) {
    try {
      const u = upaya[i], o = Object.assign({ method: u[0] }, opt);
      if (u[2]) o.payload = u[2];
      const res = UrlFetchApp.fetch(base + u[1], o);
      if (res.getResponseCode() >= 400) { err = 'HTTP ' + res.getResponseCode(); continue; }
      html = res.getContentText();
      const re = /href="([^"]*detil\/[^"]+)"/gi; let m;
      while ((m = re.exec(html))) if (links.indexOf(m[1]) < 0) links.push(m[1]);
    } catch (e) { err = String(e.message || e).slice(0, 120); }
  }
  if (!html) throw new Error('SIPP ' + dom + ' tidak bisa dibuka' + (err ? ' (' + err + ')' : ''));
  const cari = teksHtml_(html);
  if (!links.length) return { cari: cari, detail: '', url: base + '/list_perkara/search', ada: cari.replace(/\s+/g, '').toUpperCase().indexOf(kunci) >= 0 };
  /* pilih baris hasil yang memuat nomor perkara persis; bila tak ada, ambil yang pertama */
  let pilih = links[0];
  const nomorPendek = (nomor.match(/^\s*(\d+)\/(Pdt\.[A-Za-z.]+)\/(\d{4})/i) || []);
  for (let i = 0; i < links.length; i++) {
    const i0 = html.indexOf(links[i]), potong = html.slice(Math.max(0, i0 - 600), i0 + 200).replace(/\s+/g, '').toUpperCase();
    if (potong.indexOf(kunci) >= 0 || (nomorPendek[1] && potong.indexOf((nomorPendek[1] + '/' + nomorPendek[2] + '/' + nomorPendek[3]).toUpperCase()) >= 0)) { pilih = links[i]; break; }
  }
  const u = /^https?:/.test(pilih) ? pilih : base + '/' + pilih.replace(/^\//, '');
  const d = UrlFetchApp.fetch(u, opt);
  return { cari: cari, detail: teksHtml_(d.getContentText()), url: u, ada: true };
}
/** Ambil nama-nama asli dari halaman detail SIPP: daftar Pemohon (Para Pihak) + nama dalam Petitum (biasanya memuat nama anak/terampu). */
const SIPP_BUANG_ = /^(PEMOHON|TERMOHON|PENGADILAN|AGAMA|NEGERI|REPUBLIK|INDONESIA|KOTA|KABUPATEN|PROVINSI|KECAMATAN|KELURAHAN|DESA|WALI|ANAK|MENETAPKAN|MENGABULKAN|PERMOHONAN|BIAYA|PERKARA|HUKUM|UNDANG|PASAL|NOMOR|TAHUN|LAKI|PEREMPUAN|ISLAM|KRISTEN|JALAN|JL|RT|RW|KANDUNG|PERWALIAN|PENGAMPUAN|PENGAMPU|TERAMPU|DAN|ATAU|YANG|DARI|SEBAGAI|DENGAN|UNTUK|PADA|BERNAMA|LAHIR|TANGGAL|BIN|BINTI|ALM|ALMARHUM|ALMARHUMAH|DAN|SUBSIDAIR|PRIMAIR|MEMBEBANKAN|RUPIAH|SELURUHNYA)$/;
function namaSipp_(t) {
  t = String(t || '');
  const seg = function (a, b) { const i = t.search(a); if (i < 0) return ''; const r = t.slice(i); const j = r.slice(20).search(b); return j < 0 ? r.slice(0, 3000) : r.slice(0, j + 20); };
  const pihak = seg(/Pemohon/i, /Termohon|Kuasa Hukum|Petitum|Riwayat|Jadwal Sidang|Status Perkara|Data Umum/i);
  const petitum = seg(/Petitum/i, /Riwayat Perkara|Jadwal Sidang|Status Perkara|Saksi|Barang Bukti|Mediasi|Penetapan Majelis|Data Umum|Putusan/i).slice(0, 4000);
  const ambil = function (x) {
    const out = [], re = /\b([A-Z][A-Z'`.]{1,}(?![a-z])(?:\s+[A-Z][A-Z'`.]*(?![a-z])){0,6})/g; let m;
    while ((m = re.exec(x))) {
      const kata = m[1].replace(/\.$/, '').split(/\s+/), stop = function (w) { return SIPP_BUANG_.test(String(w).replace(/\./g, '')); };
      while (kata.length && stop(kata[0])) kata.shift();
      while (kata.length && (stop(kata[kata.length - 1]) || /^(BIN|BINTI|BR)$/.test(kata[kata.length - 1]))) kata.pop();
      if (kata.some(function (w) { return stop(w) && !/^(BIN|BINTI)$/.test(w); })) continue;
      const nm = kata.join(' ').trim();
      if (kata.length === 1 && /\b(di|ke|kota|kab\.?|kabupaten|provinsi|kecamatan|kelurahan|desa)\s+(PENGADILAN\s+\S+\s+)?$/i.test(x.slice(Math.max(0, m.index - 30), m.index) + (m[1].indexOf(nm) > 0 ? m[1].slice(0, m[1].indexOf(nm)) : ''))) continue;
      if (kata.length >= 1 && nm.replace(/[^A-Z]/g, '').length >= 4 && !/\*|X{3}/.test(nm) && out.indexOf(nm) < 0) out.push(nm);
    }
    return out;
  };
  const konteks = function (nm) { const i = petitum.indexOf(nm); return i < 0 ? '' : petitum.slice(Math.max(0, i - 60), i + nm.length + 80).trim(); };
  return {
    pemohon: ambil(pihak.replace(/^Pemohon/i, '')).slice(0, 6),
    kandidat: ambil(petitum.replace(/^Petitum/i, '')).slice(0, 15).map(function (n) { return { nama: n, konteks: konteks(n) }; }),
    petitum: petitum.slice(0, 1500)
  };
}
/** Cek silang nama pemohon & anak/terampu satu berkas dengan data perkara di SIPP pengadilan terkait. */
function cekSippRec_(d) {
  const nomor = String(d.nomorPenetapan || '').trim();
  if (!nomor) return { status: 'lewat', pesan: 'Nomor penetapan kosong' };
  const dom = (d.sippDomain || '').trim() || sippDomain_(d.pengadilan, nomor);
  if (!dom) return { status: 'lewat', pesan: 'Nama pengadilan tidak dikenali' };
  const cache = CacheService.getScriptCache(), ck = 'sipp_' + Utilities.base64EncodeWebSafe(dom + nomor).slice(0, 200);
  let s = null;
  try { s = JSON.parse(cache.get(ck) || 'null'); } catch (e) {}
  if (!s) { s = ambilSipp_(dom, nomor); try { cache.put(ck, JSON.stringify({ cari: s.cari.slice(0, 40000), detail: s.detail.slice(0, 50000), url: s.url, ada: s.ada }), 21600); } catch (e) {} }
  if (!s.ada) return { status: 'tidak_ada', domain: dom, url: s.url, pesan: 'Nomor perkara tidak ditemukan di SIPP ' + dom };
  const T = normNama_(s.cari + ' ' + s.detail);
  const temu = namaSipp_(s.detail || s.cari);
  const nama = [];
  if (d.nama) nama.push({ peran: 'Pemohon', nama: d.nama });
  if (d.jenis === 'Perwalian') (d.anak || []).forEach(function (a) { if (a && a.nama) nama.push({ peran: 'Anak', nama: a.nama }); });
  else if (d.terampu && d.terampu.nama) nama.push({ peran: 'Terampu', nama: d.terampu.nama });
  const hasil = nama.map(function (x) { return { peran: x.peran, nama: x.nama, ada: adaNama_(x.nama, T) }; });
  const tidak = hasil.filter(function (x) { return x.ada === false; });
  return { status: tidak.length ? 'beda' : 'cocok', domain: dom, url: s.url, hasil: hasil, pemohon: temu.pemohon, kandidat: temu.kandidat, petitum: temu.petitum };
}
function apiCekSipp(token, ids) {
  const u = user_(token);
  const semua = berkas_(false), pilih = ids && ids.length ? semua.filter(function (d) { return ids.indexOf(d.id) >= 0; }) : semua;
  const mulai = Date.now(), out = [];
  pilih.forEach(function (d) {
    if (Date.now() - mulai > 240000) { out.push({ id: d.id, nama: d.nama, nomor: d.nomorPenetapan, status: 'lewat', pesan: 'Waktu habis — jalankan lagi' }); return; }
    let r;
    try { r = cekSippRec_(d); } catch (e) { r = { status: 'gagal', pesan: String(e.message || e).slice(0, 200) }; }
    r.id = d.id; r.nama = d.nama; r.nomor = d.nomorPenetapan; r.pengadilan = d.pengadilan;
    out.push(r);
  });
  log_(u, 'CEK_SIPP', '', '', pilih.length + ' berkas dicek ke SIPP');
  return out;
}
