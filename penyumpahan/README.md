# Dokumen Penyumpahan BHP Medan — tampilan (UI)

Folder ini hanya berisi **tampilan** aplikasi Dokumen Penyumpahan. Backend (`Code.gs`, `BapSiap.gs`) tetap di proyek Apps Script dan tidak disimpan di repo publik ini karena memuat data pribadi dan kredensial.

| File | Isi |
|---|---|
| `app.src.html` | Sumber tampilan (HTML + CSS + JavaScript) yang diedit |
| `build.py` | Membuat `Index.html`: JavaScript diperkecil (terser), dikompres, lalu dibungkus base64url agar tidak dirusak HtmlService |
| `Index.html` | Hasil build: **file ini yang ditempel ke proyek Apps Script** |
| `vendor/inflate.min.js` | Pembuka kompresi (fflate, MIT) |

## Perubahan dibanding versi `damayantielsintha-wq/Kalender-Kerja-Wilayah-II` (ec4746f)
- **Mode HP**: menu kiri menjadi navigasi bawah (Daftar Berkas, Berkas Baru, Jadwal Sumpah, ☰ Lainnya); menu lain muncul sebagai lembar dari bawah. Bar atas ringkas (judul + tombol 👤 + kotak cari). Saat berkas dibuka, daftar disembunyikan dan ada tombol **← Daftar Berkas**. Input 16px agar iPhone tidak zoom otomatis.
- **Lebih ringan**: `Index.html` turun dari ±280 KB menjadi ±127 KB (JavaScript diperkecil dan dikompres). Font web tidak dimuat di HP dan tidak lagi menahan tampilan di desktop. Bayangan dimatikan di HP; animasi dimatikan bila HP meminta *reduced motion*.
- **Dokumen A4 lebih rapi** (DOCX/Google Docs): kalimat penutup ("Demikian …"), tanda tangan Kepala, dan Tembusan selalu tampil bersama (tidak ada tanda tangan atau sebagian tembusan yang tertinggal sendirian di halaman baru); blok Pernyataan + tanda tangan + saksi di BA Penghadapan tidak terpisah; tabel Hari/Tanggal–Pukul–Tempat dan tabel identitas tidak terbelah; judul harta (A–F, AKTIVA, PASSIVA) dan kalimat yang berakhir titik dua selalu ikut isinya. Pratinjau di aplikasi kini memakai margin yang sama dengan dokumen (atas 1 cm, kanan 2 cm, bawah 2,5 cm, kiri 3 cm; kertas A4).
- **Dokumen yang dibuat**: Surat Antar ke Wali/Pengampu, Surat Antar ke Lurah, Undangan Sumpah (bila sumpah di kantor/Kanwil/Zoom), dan Dokumen Penyumpahan (Permohonan, BAP, BA Sumpah, BA Inventarisasi). *Undangan ke Kepala Desa/Lurah (menyaksikan)* dan *Tanda Terima Berkas* dihapus dari aplikasi.
- Tampilan desktop tidak berubah.

## Pasang sekali: tampilan otomatis dari GitHub (disarankan)
Ganti `const UI_URL` dan `function doGet()` di `Code.gs` dengan isi `doGet-dari-GitHub.gs`, lalu deploy **Versi baru** sekali. Setelah itu setiap `Index.html` yang di-push ke branch ini aktif sendiri (maks. 10 menit; `…/exec?segar=1` untuk langsung). Bila GitHub tidak bisa dihubungi, aplikasi memakai file `Index` di proyek (`…/exec?ui=lokal` untuk memaksanya).

## Cara pasang manual (tanpa GitHub)
1. Buka `Index.html` versi *raw* dari repo ini, **Ctrl+A → Ctrl+C**.
2. Di proyek Apps Script *Dokumen Penyumpahan*, buka file **Index**, **Ctrl+A → Ctrl+V**, lalu simpan.
3. **Terapkan → Kelola deployment → ✏️ Edit → Versi: Versi baru → Terapkan.** URL aplikasi tetap sama.

## Mengubah tampilan
Edit `app.src.html`, lalu jalankan `python3 build.py` (butuh Node.js untuk `npx terser`; tanpa itu build tetap jalan, hanya tanpa pengecilan JavaScript). Uji tanpa deploy: buka `Index.html` di browser → mode demo (username `shela`, password `demo`).

## Catatan penggabungan (30 Sep 2026)
Perubahan dari `shelanatasha44-sudo/Konten-BHP` (branch `ccr-82a96c14-ey9957`) sudah digabung ke repo ini (`penyumpahan/`).
Apps Script kembali menyajikan file `Index` **lokal** (tanpa mengambil dari GitHub tiap halaman dibuka) supaya aplikasi terbuka dan login lebih cepat.
Untuk mengubah tampilan: edit `penyumpahan/app.src.html` di repo ini, `python3 build.py`, lalu salin `Index.html` ke proyek Apps Script dan deploy versi baru.
