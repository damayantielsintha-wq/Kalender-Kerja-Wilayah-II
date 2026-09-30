"""Siapkan timeline episode kartun 3D: durasi tiap rekaman suara + amplop volume per frame
(dipakai untuk gerak mulut / lip-sync). Hasil: data/ep<N>.json

Pakai: python prep.py 1
Butuh: ffmpeg (atau pip install imageio-ffmpeg) dan rekaman di ../tiktok-bhp/vo/.
"""
import json, os, subprocess, sys, struct

HERE = os.path.dirname(os.path.abspath(__file__))
VO = os.path.join(HERE, "..", "tiktok-bhp", "vo")
FPS = 30
SR = 16000

try:
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FF = "ffmpeg"

# Naskah per episode. "line" = kunci rekaman di tiktok-bhp/vo (dari naskah-vo.json).
# act = gerak tokoh saat bicara; gap = jeda sebelum kalimat (detik).
EPISODES = {
    1: {
        "title": "Hak Waris", "tusi": "Surat Keterangan Hak Waris", "sub": "bisa diurus online 📲",
        "beats": [
            {"type": "intro", "dur": 2.4},
            {"type": "line", "who": "tasya", "key": "tasya-c82707b1", "act": "sad", "gap": 0.2},
            {"type": "line", "who": "dinda", "key": "dinda-eab3880c", "act": "explain", "gap": 0.35},
            {"type": "line", "who": "tasya", "key": "tasya-c6c7d433", "act": "shock", "gap": 0.3},
            {"type": "line", "who": "dinda", "key": "dinda-f50b605c", "act": "laugh", "gap": 0.3},
            {"type": "card", "dur": 2.6, "gap": 0.3},
            {"type": "line", "who": "boss", "key": "boss-57ae112b", "act": "pop", "gap": 0.2},
            {"type": "line", "who": "narator", "key": "narator-6661fbd7", "act": "tagline", "gap": 0.2},
            {"type": "outro", "dur": 1.6},
        ],
    },
}


def text_of(key):
    for ln in json.load(open(os.path.join(HERE, "..", "tiktok-bhp", "naskah-vo.json"), encoding="utf-8")):
        if ln["key"] == key:
            return ln["text"]
    raise KeyError(key)


def envelope(path):
    """Volume RMS per frame (0..1) dari file audio."""
    raw = subprocess.run([FF, "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    n = len(raw) // 2
    samples = struct.unpack(f"<{n}h", raw[: n * 2])
    hop = SR // FPS
    env = []
    for i in range(0, n, hop):
        chunk = samples[i:i + hop]
        env.append((sum(s * s for s in chunk) / max(1, len(chunk))) ** 0.5)
    ref = sorted(env)[int(len(env) * 0.95)] or 1
    return [round(min(1.0, v / ref), 3) for v in env], n / SR


def main(no):
    ep = EPISODES[no]
    t = 0.0
    out = []
    for b in ep["beats"]:
        t += b.get("gap", 0)
        if b["type"] == "line":
            env, dur = envelope(os.path.join(VO, b["key"] + ".mp3"))
            out.append({**b, "start": round(t, 3), "dur": round(dur, 3), "text": text_of(b["key"]), "env": env})
            t += dur
        else:
            out.append({**b, "start": round(t, 3)})
            t += b["dur"]
    data = {"no": no, "title": ep["title"], "tusi": ep["tusi"], "sub": ep["sub"], "fps": FPS,
            "duration": round(t, 3), "beats": out}
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    json.dump(data, open(os.path.join(HERE, "data", f"ep{no}.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"ep{no}: {t:.1f} detik, {sum(1 for b in out if b['type'] == 'line')} kalimat")


if __name__ == "__main__":
    for a in sys.argv[1:] or ["1"]:
        main(int(a))
