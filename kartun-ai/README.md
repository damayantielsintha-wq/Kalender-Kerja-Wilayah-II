# Kartun AI · Serial Tusi BHP Medan

Tokoh 3D (Tasya, Dinda, Pak Kepala) di kantor BHP Medan dianimasikan oleh **Google Veo** (Gemini API).

1. `adegan.json` — naskah adegan per episode (susunan tokoh + arahan gerak).
2. `buat_video.py` — menyusun gambar pembuka (`gambar/`) lalu meminta Veo membuat klip (`klip/`).
3. Jalankan lewat **Actions → "Buat video kartun AI (Veo)" → Run workflow** (pakai secret `GEMINI_API_KEY`;
   Veo berbayar, jadi billing Gemini API harus aktif).
