"""Bikin rekaman suara AI neural (kayak manusia) untuk animasi TikTok BHP.

Cara pakai (sekali saja, di laptop yang ada internet):
    pip install edge-tts
    python buat_suara.py

Hasilnya folder vo/ berisi MP3 + manifest.json. Buka index.html (atau upload
index.html + folder vo/ ke hosting) → semua dialog otomatis pakai rekaman ini.
Kalau naskah di index.html diubah, buka index.html?naskah untuk unduh
naskah-vo.json baru, taruh di folder ini, lalu jalankan lagi skrip ini.
"""
import asyncio, base64, json, os, re, struct, time, urllib.request
import edge_tts

# Urutan mesin: Gemini (GRATIS, natural) → OpenAI/ChatGPT (berbayar) → Microsoft Edge (cadangan).
# Isi key lewat GitHub: Settings → Secrets and variables → Actions.
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
GAYA = "Bahasa Indonesia sehari-hari logat Jakarta, santai kayak ngobrol sama temen, intonasi hidup, ada jeda napas alami, jangan kaku kayak baca teks."
KARAKTER = {
    "tasya":   "Tasya, cewek Gen Z umur 20-an, ceria, ekspresif, gampang heboh dan kaget",
    "dinda":   "Dinda, cewek pegawai BHP, ramah, kalem, sabar, meyakinkan, sambil senyum",
    "boss":    "Pak Kepala kantor, bapak-bapak berwibawa tapi kocak dan hangat, suara berat, pede",
    "narator": "narator konten TikTok, asik, akrab, semangat tapi nggak lebay",
}
MODELS = ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts", "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"]
GEMINI_VOICE = {"tasya": "Leda", "dinda": "Aoede", "boss": "Algenib", "narator": "Puck"}
OPENAI_VOICE = {"tasya": "coral", "dinda": "nova", "boss": "onyx", "narator": "ash"}

def post(url, body, headers):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()

class KuotaHabis(Exception):
    pass

def gemini_tts(text, who, path):
    body = {"contents": [{"parts": [{"text": ""}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": GEMINI_VOICE[who]}}}}}
    res = None
    for model in MODELS:  # kuota gratis dihitung per model → kalau habis, pindah model
        # Model 2.5 paham arahan gaya; model 3.x ikut MEMBACAKAN arahan → kirim dialognya saja
        body["contents"][0]["parts"][0]["text"] = (f"Ucapkan sebagai {KARAKTER[who]}. {GAYA}\n\n{text}" if model.startswith("gemini-2.5") else text)
        try:
            res = json.loads(post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                  body, {"x-goog-api-key": GEMINI_KEY}))
            break
        except urllib.error.HTTPError as e:
            print("   ", model, e.code)
            if e.code not in (429, 500, 503): raise
    if res is None: raise KuotaHabis()
    pcm = base64.b64decode(res["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    wav = path[:-4] + ".wav"  # PCM 24kHz 16-bit mono → WAV → MP3 (ffmpeg)
    with open(wav, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm)
    ff = "ffmpeg"
    try:
        import imageio_ffmpeg; ff = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
    os.system(f'"{ff}" -loglevel error -y -i "{wav}" -b:a 96k "{path}"'); os.remove(wav)

def openai_tts(text, who, path):
    data = post("https://api.openai.com/v1/audio/speech",
                {"model": "gpt-4o-mini-tts", "input": text, "response_format": "mp3", "voice": OPENAI_VOICE[who],
                 "instructions": f"Kamu {KARAKTER[who]}. {GAYA}"}, {"Authorization": "Bearer " + OPENAI_KEY})
    open(path, "wb").write(data)

# Suara neural Microsoft. Gadis = cewek, Ardi = cowok. Atur tempo & nada per tokoh.
SUARA = {
    "tasya":   dict(voice="id-ID-GadisNeural", rate="+10%", pitch="+0Hz"),  # ceria, cepat
    "dinda":   dict(voice="id-ID-GadisNeural", rate="+2%",  pitch="+0Hz"),   # kalem
    "boss":    dict(voice="id-ID-ArdiNeural",  rate="-2%",  pitch="+0Hz"),   # bapak-bapak
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
    engine = "gemini" if GEMINI_KEY else "openai" if OPENAI_KEY else "edge"
    tanda = os.path.join(out, "engine.txt")
    lama = open(tanda).read().strip() if os.path.exists(tanda) else ""
    if engine == "edge" and lama in ("gemini", "openai"):  # jangan timpa rekaman natural dengan suara Edge
        engine = lama
    if lama != engine:  # ganti mesin → rekam ulang semua
        for f in os.listdir(out):
            if f.endswith(".mp3"): os.remove(os.path.join(out, f))
        open(tanda, "w").write(engine)
    print("Mesin suara:", engine)
    keys = []
    for i, ln in enumerate(lines, 1):
        path = os.path.join(out, ln["key"] + ".mp3")
        if not os.path.exists(path):
            print(f"[{i}/{len(lines)}] {ln['who']}: {ln['text'][:60]}")
            teks = ln["text"].replace("BHP", "Be Ha Pe").replace("UPT", "U Pe Te")
            if engine != "edge" and not (GEMINI_KEY or OPENAI_KEY):
                continue  # rekaman natural belum lengkap tapi key tidak ada → lewati
            if engine == "gemini":
                try:
                    gemini_tts(teks, ln["who"], path)
                except KuotaHabis:
                    print("Kuota gratis Gemini hari ini habis. Jalankan lagi besok — yang sudah jadi tidak diulang.")
                    break
            elif engine == "openai": openai_tts(teks, ln["who"], path)
            else: await edge_tts.Communicate(lafal(ln["text"]), **SUARA[ln["who"]]).save(path)
        keys.append(ln["key"])
    keys = [ln["key"] for ln in lines if os.path.exists(os.path.join(out, ln["key"] + ".mp3"))]
    json.dump(keys, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print(f"Beres! {len(keys)} rekaman di folder vo/")

asyncio.run(main())
