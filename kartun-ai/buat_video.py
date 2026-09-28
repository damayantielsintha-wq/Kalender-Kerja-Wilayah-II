"""Buat klip animasi AI (Google Veo, lewat Gemini API) untuk serial kartun BHP.

Tiap adegan: gambar pembuka disusun dari latar kantor + tokoh 3D (../tiktok-bhp/img),
lalu Veo menganimasikannya jadi klip vertikal 9:16. Hasil: klip/ep<N>-<id>.mp4

Pakai (biasanya lewat GitHub Actions, kunci dari secret GEMINI_API_KEY):
    python buat_video.py --ep 1 --shots s2        # uji satu adegan
    python buat_video.py --ep 1                   # semua adegan episode 1
    python buat_video.py --ep 1 --hanya-gambar    # susun gambar pembuka saja (tanpa Veo)
Klip yang sudah ada tidak dibuat ulang (hapus filenya untuk mengulang).
"""
import argparse, base64, json, os, sys, time, urllib.error, urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "..", "tiktok-bhp", "img")
W, H = 720, 1280
KEY = os.environ.get("GEMINI_API_KEY", "").strip()
API = "https://generativelanguage.googleapis.com/v1beta"
MODELS = [m for m in os.environ.get("VEO_MODELS", "").split(",") if m] or [
    "veo-3.1-fast-generate-preview", "veo-3.1-generate-preview",
    "veo-3.0-fast-generate-001", "veo-3.0-generate-001", "veo-2.0-generate-001"]
FILES = {"tasya": "tasya-3d.png", "dinda": "dinda-3d.png", "kepala": "kepala-3d.png"}


def susun(latar, cast, path):
    """Gambar pembuka: latar + tokoh. cast = [[nama, pusat_x, tinggi, (atas_y)], ...] dalam pecahan layar."""
    bg = Image.open(os.path.join(IMG, latar)).convert("RGB").resize((W, H), Image.LANCZOS).convert("RGBA")
    for c in cast:
        who, cx, h = c[0], c[1], c[2]
        im = Image.open(os.path.join(IMG, FILES[who])).convert("RGBA")
        th = int(h * H); tw = int(im.width * th / im.height)
        im = im.resize((tw, th), Image.LANCZOS)
        top = int(c[3] * H) if len(c) > 3 else int(0.975 * H) - th
        bg.alpha_composite(im, (int(cx * W - tw / 2), top))
    bg.convert("RGB").save(path, quality=95)
    return path


def call(url, body=None, raw=False):
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None,
                                 {"Content-Type": "application/json", "x-goog-api-key": KEY})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    return data if raw else json.loads(data)


def veo(prompt, negatif, image_path, dur, out):
    img = base64.b64encode(open(image_path, "rb").read()).decode()
    base = {"aspectRatio": "9:16", "durationSeconds": dur, "negativePrompt": negatif,
            "personGeneration": "allow_adult", "resolution": "720p"}
    # Parameter opsional dilepas satu per satu kalau model menolaknya (error 400)
    variants = [base, {k: v for k, v in base.items() if k != "resolution"},
                {k: v for k, v in base.items() if k not in ("resolution", "personGeneration")},
                {"aspectRatio": "9:16"}]
    op = None
    for model in MODELS:
        for p in variants:
            body = {"instances": [{"prompt": prompt, "image": {"bytesBase64Encoded": img, "mimeType": "image/jpeg"}}], "parameters": p}
            try:
                op = call(f"{API}/models/{model}:predictLongRunning", body)
                print(f"   model {model} diterima ({', '.join(p)})")
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")[:300]
                print(f"   {model}: {e.code} {msg}")
                if e.code == 400 and "INVALID_ARGUMENT" in msg:
                    continue  # coba tanpa parameter opsional
                break  # 403/404/429 → coba model berikutnya
        if op:
            break
    if not op:
        raise SystemExit("Semua model Veo menolak. Cek: billing Gemini API aktif (Veo berbayar) & kunci benar.")
    name = op["name"]
    for _ in range(90):  # maks ~15 menit
        time.sleep(10)
        st = call(f"{API}/{name}")
        if st.get("done"):
            break
    else:
        raise SystemExit("Veo belum selesai setelah 15 menit.")
    if "error" in st:
        raise SystemExit(f"Veo gagal: {st['error']}")
    samples = (st.get("response", {}).get("generateVideoResponse", {}) or {}).get("generatedSamples") or []
    if not samples:
        raise SystemExit(f"Veo tidak mengembalikan video (mungkin terfilter): {json.dumps(st)[:500]}")
    uri = samples[0]["video"]["uri"]
    open(out, "wb").write(call(uri, raw=True))
    print(f"   ✔ {os.path.relpath(out, HERE)} ({os.path.getsize(out) // 1024} KB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ep", default="1")
    ap.add_argument("--shots", default="")
    ap.add_argument("--hanya-gambar", action="store_true")
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(HERE, "adegan.json"), encoding="utf-8"))
    ep = cfg["episode"][a.ep]
    want = {s.strip() for s in a.shots.split(",") if s.strip()}
    os.makedirs(os.path.join(HERE, "gambar"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "klip"), exist_ok=True)
    for sh in ep["shots"]:
        if want and sh["id"] not in want:
            continue
        frame = susun(ep["latar"], sh["susun"], os.path.join(HERE, "gambar", f"ep{a.ep}-{sh['id']}.jpg"))
        out = os.path.join(HERE, "klip", f"ep{a.ep}-{sh['id']}.mp4")
        print(f"[{sh['id']}] gambar pembuka: {os.path.relpath(frame, HERE)}")
        if a.hanya_gambar or os.path.exists(out):
            continue
        if not KEY:
            raise SystemExit("GEMINI_API_KEY belum diisi di secret repo.")
        prompt = cfg["gaya"] + " " + sh["prompt"].format(**cfg["tokoh"])
        veo(prompt, cfg["negatif"], frame, sh["dur"], out)


if __name__ == "__main__":
    main()
