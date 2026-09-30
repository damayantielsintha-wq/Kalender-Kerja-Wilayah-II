"""Rapikan rekaman suara vo/*.mp3:
- buang artifact (ledakan desis) di ujung & awal klip: potong tepat setelah ucapan terakhir
- fade halus 15 ms / 40 ms supaya tidak ada klik
- tempo dipercepat (default 1.12x) TANPA mengubah nada (ffmpeg atempo)
Klip yang sudah dirapikan dicatat di vo/rapi.json supaya tidak diproses dua kali.
Pakai: python rapikan_suara.py [tempo]"""
import json, os, subprocess, sys
import numpy as np
try:
    import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FF = "ffmpeg"
HERE = os.path.dirname(os.path.abspath(__file__)); VO = os.path.join(HERE, "vo")
TEMPO = float(sys.argv[1]) if len(sys.argv) > 1 else 1.12
SR, W = 24000, 480  # jendela 20 ms

def load(f):
    raw = subprocess.run([FF, "-loglevel", "error", "-i", f, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768

def speechlike(x):
    """True per jendela bila berisi ucapan (cukup keras & tidak datar seperti desis)."""
    out = []
    for i in range(0, len(x) - W, W):
        s = x[i:i + W]; rms = 20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9)
        sp = np.abs(np.fft.rfft(s * np.hanning(W))) + 1e-9; flat = np.exp(np.log(sp).mean()) / sp.mean()
        out.append(rms > -42 and flat < 0.5)
    return out

def main():
    L = json.load(open(os.path.join(HERE, "naskah-vo.json"), encoding="utf-8"))
    done_f = os.path.join(VO, "rapi.json"); done = set(json.load(open(done_f))) if os.path.exists(done_f) else set()
    n = 0
    for ln in L:
        k = ln["key"]; f = os.path.join(VO, k + ".mp3")
        if k in done or not os.path.exists(f): continue
        x = load(f); sp = speechlike(x)
        idx = [i for i, v in enumerate(sp) if v]
        if not idx: continue
        # abaikan "ucapan" tunggal yang terisolasi di ujung (sisa artifact)
        while len(idx) > 3 and idx[-1] - idx[-2] > 5: idx.pop()
        start = max(0, idx[0] * W / SR - 0.05); end = min(len(x) / SR, (idx[-1] + 1) * W / SR + 0.12)
        dur = (end - start) / TEMPO
        af = f"atrim={start:.3f}:{end:.3f},asetpts=PTS-STARTPTS,atempo={TEMPO},afade=t=in:d=0.015,afade=t=out:st={max(0, dur - 0.04):.3f}:d=0.04"
        tmp = f + ".tmp.mp3"
        subprocess.run([FF, "-loglevel", "error", "-y", "-i", f, "-af", af, "-c:a", "libmp3lame", "-b:a", "128k", tmp], check=True)
        os.replace(tmp, f); done.add(k); n += 1
        print(f"✔ {k}: {len(x)/SR:.2f}s → {dur:.2f}s")
    json.dump(sorted(done), open(done_f, "w"), indent=1)
    print(f"Beres: {n} klip dirapikan (tempo {TEMPO}x)")

if __name__ == "__main__":
    main()
