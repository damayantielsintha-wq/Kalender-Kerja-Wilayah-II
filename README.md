# 📅 Kalender Kerja Wilayah II

Kalender kerja tim yang modern, bisa dipakai bersama oleh banyak akun Google, dari HP maupun laptop.
Dibangun sebagai **Google Apps Script Web App**: data di Google Sheets, lampiran di Google Drive, jadi gratis dan tidak perlu server.

## ✨ Fitur
- **Multi-pengguna Google**: pengguna login dengan akun Google, lalu nama/email tercatat di setiap perubahan.
- **Isi kegiatan lengkap**: judul, tanggal mulai–selesai, jam atau sepanjang hari, lokasi (terhubung ke Google Maps), kategori, prioritas, status, deskripsi, peserta, tautan, dan checklist.
- **Log audit permanen**: setiap buat, ubah (dengan *diff* sebelum→sesudah), pindah, hapus, unggah, komentar, dan checklist tercatat di sheet `Log`. Kegiatan yang dihapus bisa dipulihkan.
- **Upload foto & dokumen ke Google Drive**: tersusun otomatis per `Lampiran/2026-09/2026-09-27 — Judul`. Pratinjau muncul saat kursor diarahkan (hover), dan file bisa dibuka langsung di viewer. Foto besar dari kamera HP dikompres dulu sebelum diunggah.
- **✅ Menu To Do List**: semua tugas dari semua kegiatan dikelompokkan jadi Terlambat, Hari ini, 7 hari ke depan, dan Nanti. Tugas bisa dicentang langsung.
- **✨ AI Asisten Dokumen**: AI menentukan dokumen yang perlu dibuat untuk sebuah kegiatan (undangan, KAK/TOR, daftar hadir, notulen, surat tugas, laporan, dll.) lengkap dengan draf isinya. Sekali klik, draf jadi **Google Docs** di folder Drive kegiatan, atau dimasukkan ke To Do List.
- **Tampilan**: Bulan, Minggu, Agenda, To Do, Papan Kanban (seret untuk ganti status), Statistik, dan Log.
- **Fitur canggih lainnya**: tambah cepat dengan bahasa alami (`Rapat evaluasi besok 09:00-11:00 @Aula #Rapat !tinggi`), seret-lepas untuk pindah tanggal (bisa di-*undo*), deteksi jadwal bentrok, sinkron realtime antar pengguna, command palette (`Ctrl+K`), shortcut keyboard, mode gelap, badge *LIVE*, heatmap aktivitas 12 bulan, ekspor CSV/.ics, tombol tambah ke Google Calendar pribadi, diskusi per kegiatan, duplikasi kegiatan, dan cetak.
- **Mobile-first**: bottom navigation, tombol FAB, modal berbentuk *bottom sheet*, dan geser (swipe) kiri/kanan untuk ganti bulan.

## 🚀 Cara pasang (±5 menit)
1. Buka <https://script.google.com> lalu klik **Proyek baru**.
2. Salin isi `Code.gs` ke file `Code.gs`. Buat file HTML bernama **`Index`** dan salin isi `Index.html` ke sana.
3. Klik ⚙️ **Setelan proyek**, centang *Tampilkan file manifes "appsscript.json"*, lalu salin isi `appsscript.json`.
4. Pilih fungsi **`setup`** lalu klik **Jalankan**, dan izinkan akses. Folder *Kalender Kerja Wilayah II* (berisi Spreadsheet database dan folder Lampiran) akan dibuat di Drive Anda.
5. **Bagikan folder tersebut ke anggota tim sebagai Editor.** Ini wajib, karena aplikasi berjalan sebagai pengguna yang mengakses.
6. Klik **Terapkan → Deployment baru → Aplikasi web** dengan pengaturan *Jalankan sebagai: Pengguna yang mengakses* dan *Akses: Siapa saja yang memiliki akun Google*.
7. Bagikan URL `/exec` ke tim. Di HP, buka URL tersebut lalu pilih **Tambahkan ke Layar Utama** agar terasa seperti aplikasi.

> Alternatif: pakai [clasp](https://github.com/google/clasp) (`clasp create --type webapp`, lalu `clasp push`).

### 🤖 Mengaktifkan AI Gemini (opsional, gratis)
Tanpa kunci API, AI Dokumen memakai template bawaan per kategori. Untuk analisis AI penuh:
1. Ambil API key di <https://aistudio.google.com/apikey>.
2. Di Apps Script, buka **Setelan proyek → Properti skrip**, lalu tambahkan `GEMINI_API_KEY` = kunci Anda. Model bisa diganti lewat properti `GEMINI_MODEL` (default `gemini-2.5-flash`).

## 🧪 Coba tanpa deploy
Buka `Index.html` langsung di browser. Aplikasi otomatis masuk **mode demo** (data disimpan di localStorage).

## ⌨️ Shortcut
`N` baru · `T` hari ini · `M/W/A/O/B/S/L` ganti tampilan · `←/→` navigasi · `/` cari · `D` tema · `Ctrl+K` palette

> Aplikasi **Dokumen Penyumpahan** BHP Medan ada di folder [`penyumpahan/`](penyumpahan/README.md) dan merupakan aplikasi terpisah (proyek Apps Script sendiri).
