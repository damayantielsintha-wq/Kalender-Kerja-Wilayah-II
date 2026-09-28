# ⚖️ Dokumen Penyumpahan — Balai Harta Peninggalan Medan
Pengganti alur AutoCrat di spreadsheet *Dokumen Otomatis (Penetapan Baru)*. Aplikasi **terpisah** dari Kalender Kerja Wilayah II: proyek Google Apps Script, database, folder Drive, dan URL sendiri. Folder ini (`penyumpahan/`) hanya berbagi repositori.

## Dokumen yang dihasilkan (sesuai template *Format FULL Pengampu/Perwalian*)
1. Surat Permohonan Penyumpahan (dari pemohon)
2. Surat ke Pengampu / Wali
3. Surat ke Lurah
4. Berita Acara Penghadapan (BAP) + Pernyataan — Kurator Keperdataan Ahli Muda
5. Berita Acara Penyumpahan — Kurator Keperdataan Ahli Madya
6. Berita Acara Pencatatan/Pendaftaran Harta Kekayaan (Aktiva A–F, Passiva)

## Fitur
- **Login per admin** dengan username & password aplikasi. **Admin Utama** (Shela Natasha) punya akses penuh: riwayat seluruh perubahan, kelola pengguna (tambah, nonaktifkan, reset password), pengaturan kop/pejabat/lafaz, koneksi SPS, serta hapus/pulihkan berkas. **Admin** bisa membuat & mengubah berkas, upload penetapan, unduh dokumen, dan ambil nomor SPS.
- **Riwayat permanen** (sheet `Riwayat`): setiap buat/ubah berkas (per kolom: nilai lama → baru), hapus, pulihkan, unduh DOCX, ambil nomor, baca penetapan, login/logout/login gagal, ganti/reset password, perubahan pengaturan dan pengguna — lengkap dengan nama admin dan waktunya. Admin melihat riwayat per berkas; Admin Utama melihat semuanya dengan filter per admin/aksi.
- **Anti-bentrok**: jika dua admin mengubah berkas yang sama, perubahan yang kalah cepat tidak menimpa, dan admin diberi tahu siapa yang mengubah.
- **Output Google Docs** (bisa langsung diedit): keenam dokumen di atas — kop dengan logo Pengayoman, Arial, A4, sesuai template BHP. Daftar pejabat & NIP diambil dari sheet *Data Lengkap Pegawai* spreadsheet Dokumen Otomatis (tombol 🔄 di Pengaturan).
- **Folder Drive rapi**: `Dokumen Penyumpahan BHP Medan / <Tahun> / <Pengampuan|Perwalian> / <NAMA> - <Nomor Penetapan>/`. Dokumen yang dibuat ulang tidak dihapus — versi lama dipindah ke subfolder `Arsip`. Folder otomatis dibagikan (Editor) ke email Google semua admin aktif; admin nonaktif dicabut aksesnya.
- **Nomor surat dari SPS** (sps.batamen.com, protokol sama dengan skrip SAPA WALI): tombol *Ambil nomor SPS* hanya aktif bila semua isian dokumen lengkap. Nomor diambil **bertanggal hari ini** dengan kode AH.06.03 (pengampuan) / AH.06.02 (perwalian) dan nama admin yang login sebagai pegawai. Autentikasi memakai akun SPS (login otomatis) atau cookie `SPS_COOKIE`; disimpan di Properti Skrip server, tidak terlihat admin lain.
- **Upload penetapan** (PDF/scan) → isian terisi otomatis. Dengan **AI Gemini** (kunci dari aistudio.google.com/apikey, disimpan di server) hasilnya lebih akurat; hasil AI digabung dengan pembaca teks sebagai cadangan.
- Impor CSV dari spreadsheet lama.

## Pasang (dilakukan oleh Shela, ±10 menit)
1. Buka <https://script.google.com> → **Proyek baru**, beri nama *Dokumen Penyumpahan BHP*.
2. Salin `penyumpahan/Code.gs` ke `Code.gs`; buat file HTML **`Index`** dan salin `Index.html`; tampilkan manifes lalu salin `appsscript.json`.
3. Di **Layanan (+)** tambahkan **Drive API** (v3) — sudah tercantum di manifes. Pilih fungsi **`setup`** → **Jalankan** → izinkan akses. Buka **Log eksekusi**: berisi link database dan **password sementara** 8 akun (username: `shela`, `annisa`, `elsintha`, `yusril`, `andre`, `fairuz`, `nanang`, `taufik`). Bagikan secara pribadi; semua wajib ganti password saat login pertama.
4. **Terapkan → Deployment baru → Aplikasi web**: *Jalankan sebagai: Saya*, *Akses: Siapa saja*. Bagikan URL `/exec` ke tim.
5. Login sebagai `shela` → **👥 Pengguna**: isi email Google tiap admin (akses folder Drive). **⚙ Pengaturan**: cek pejabat, tempel **Gemini API key** lalu *Tes Gemini*, isi username/password **SPS** (atau tempel cookie SPS yang sama dengan skrip SAPA WALI) lalu *Tes koneksi*.

Database (Spreadsheet) hanya dimiliki akun Shela; admin lain mengakses lewat aplikasi, sehingga riwayat tidak bisa diubah dari luar aplikasi.

**Coba tanpa deploy:** buka `Index.html` di browser → mode demo (username `shela`/`annisa`, password `demo`; data di browser saja, tanpa SPS).
