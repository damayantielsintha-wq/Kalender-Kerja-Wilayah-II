"""Bikin rekaman suara AI neural (kayak manusia) untuk animasi TikTok BHP.

Cara pakai (sekali saja, di laptop yang ada internet):
    pip install edge-tts
    python buat_suara.py

Hasilnya folder vo/ berisi MP3 + manifest.json. Buka index.html (atau upload
index.html + folder vo/ ke hosting) → semua dialog otomatis pakai rekaman ini.
Kalau naskah di index.html diubah, buka index.html?naskah untuk unduh
naskah-vo.json baru, taruh di folder ini, lalu jalankan lagi skrip ini.
"""
import asyncio, json, os, re
import edge_tts

# Suara neural Microsoft. Gadis = cewek, Ardi = cowok. Atur tempo & nada per tokoh.
SUARA = {
    "tasya":   dict(voice="id-ID-GadisNeural", rate="+10%", pitch="+12Hz"),  # ceria, cepat
    "dinda":   dict(voice="id-ID-GadisNeural", rate="+2%",  pitch="-4Hz"),   # kalem
    "boss":    dict(voice="id-ID-ArdiNeural",  rate="-2%",  pitch="-8Hz"),   # bapak-bapak
    "narator": dict(voice="id-ID-ArdiNeural",  rate="+4%",  pitch="+0Hz"),   # santai
}
# Lafal: biar dibaca kayak orang Indonesia ngomong
LAFAL = [(r"\bBHP\b", "Be Ha Pe"), (r"\bUPT\b", "U Pe Te"), (r"\bonline\b", "onlen"),
         (r"\bbodyguard\b", "bodigat"), (r"\bfee\b", "fi"), (r"\bGen Z\b", "Jen Zi")]

def lafal(t):
    for a, b in LAFAL:
        t = re.sub(a, b, t, flags=re.I)
    return t

async def main():
    here = os.path.dirname(os.path.abspath(__file__))
    lines = json.load(open(os.path.join(here, "naskah-vo.json"), encoding="utf-8"))
    out = os.path.join(here, "vo"); os.makedirs(out, exist_ok=True)
    keys = []
    for i, ln in enumerate(lines, 1):
        path = os.path.join(out, ln["key"] + ".mp3")
        if not os.path.exists(path):
            print(f"[{i}/{len(lines)}] {ln['who']}: {ln['text'][:60]}")
            await edge_tts.Communicate(lafal(ln["text"]), **SUARA[ln["who"]]).save(path)
        keys.append(ln["key"])
    json.dump(keys, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(f"Beres! {len(keys)} rekaman di folder vo/")

asyncio.run(main())
