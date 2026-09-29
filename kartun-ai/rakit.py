"""Rangkai klip Veo + suara Gemini + teks jadi video TikTok 1080x1920.

Pakai: python rakit.py 1        → keluar/bhp-kartun-ai-1.mp4
Butuh: ffmpeg (atau pip install imageio-ffmpeg), node + playwright (untuk lapisan teks).
Urutan potongan diatur di susunan-ep<N>.json.
"""
import json, os, subprocess, sys, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
VO = os.path.join(HERE, "..", "tiktok-bhp", "vo")
OUT = os.path.join(HERE, "keluar")
FPS = 30
try:
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FF = "ffmpeg"


def dur_of(path):
    o = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    h, m, s = o.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def main(no):
    cfg = json.load(open(os.path.join(HERE, f"susunan-ep{no}.json"), encoding="utf-8"))
    naskah = {l["key"]: l for l in json.load(open(os.path.join(HERE, "..", "tiktok-bhp", "naskah-vo.json"), encoding="utf-8"))}
    tmp = os.path.join(OUT, f".ep{no}"); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    t, parts, timeline = 0.0, [], []
    for i, p in enumerate(cfg["potongan"]):
        src = os.path.join(HERE, "klip", p["klip"] + ".mp4")
        seg = {**p, "start": round(t, 3)}
        if p.get("suara_klip"):
            d = p["sampai"] - p["dari"]
            if p.get("teks"):
                seg.update(vo_start=round(t + .25, 3), vo_dur=round(d - .6, 3), text=p["teks"])
        elif p.get("vo"):
            vd = dur_of(os.path.join(VO, p["vo"] + ".mp3"))
            seg["vo_dur"] = round(vd, 3)
            seg["vo_start"] = round(t + p.get("vo_mulai", .15), 3)
            seg["text"] = naskah[p["vo"]]["text"]
            d = p.get("dur") or vd + .45
        else:
            d = p["dur"]
        seg["dur"] = round(d, 3)
        span = p["sampai"] - p["dari"]
        out = os.path.join(tmp, f"p{i:02d}.mp4")
        # potong, sesuaikan tempo ke durasi target, skala 1080x1920
        has_a = "Audio:" in subprocess.run([FF, "-hide_banner", "-i", src], capture_output=True, text=True).stderr
        use_a = p.get("suara_klip") and has_a
        a_in = [] if use_a else ["-f", "lavfi", "-t", f"{d:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        subprocess.run([FF, "-loglevel", "error", "-y", "-ss", str(p["dari"]), "-t", str(span), "-i", src, *a_in,
                        "-vf", f"setpts=PTS*{d / span:.4f},fps={FPS},scale=1080:1920:flags=lanczos,format=yuv420p",
                        "-map", "0:v", "-map", "0:a" if use_a else "1:a", "-af", "aresample=48000,aformat=channel_layouts=stereo",
                        "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-t", f"{d:.3f}", out], check=True)
        parts.append(out); timeline.append(seg); t += d
    total = round(t, 3)
    json.dump({"no": no, "judul": cfg["judul"], "tusi": cfg["tusi"], "sub": cfg["sub"], "fps": FPS, "duration": total, "seg": timeline},
              open(os.path.join(tmp, "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False)
    # gabung potongan
    lst = os.path.join(tmp, "list.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    base = os.path.join(tmp, "base.mp4")
    subprocess.run([FF, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", base], check=True)
    # lapisan teks (PNG transparan per frame) dari lapisan.html
    subprocess.run(["node", os.path.join(HERE, "lapisan.js"), tmp], check=True)
    # campur suara
    vos = [s for s in timeline if s.get("vo") and not s.get("suara_klip")]
    inputs, flt = [], []
    for i, s in enumerate(vos):
        inputs += ["-i", os.path.join(VO, s["vo"] + ".mp3")]
        ms = int(s["vo_start"] * 1000)
        flt.append(f"[{i + 2}:a]aresample=48000,adelay={ms}|{ms}[a{i}]")
    # suara klip (dari base) + rekaman Gemini; pembatas puncak supaya tidak pecah
    mix = ";".join(flt + [""]) + "[0:a]" + "".join(f"[a{i}]" for i in range(len(vos))) + f"amix=inputs={len(vos) + 1}:normalize=0,alimiter=limit=0.9:level=false,apad[aout]"
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"bhp-kartun-ai-{no}.mp4")
    subprocess.run([FF, "-loglevel", "error", "-y", "-i", base, "-framerate", str(FPS), "-i", os.path.join(tmp, "ov", "o%05d.png"), *inputs,
                    "-filter_complex", f"[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v];{mix}", "-map", "[v]", "-map", "[aout]",
                    "-t", str(total), "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-movflags", "+faststart",
                    "-c:a", "aac", "-b:a", "160k", out], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"✔ {out} ({total:.1f} detik)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "1")
