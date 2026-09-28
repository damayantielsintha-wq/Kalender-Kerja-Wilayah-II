"""Bikin contoh suara dari banyak suara neural untuk dibandingkan (tiktok-bhp/contoh/)."""
import asyncio, json, os
import edge_tts

KANDIDAT = [
    "id-ID-GadisNeural", "id-ID-ArdiNeural",
    "en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural", "en-US-AndrewMultilingualNeural",
    "en-US-BrianMultilingualNeural", "en-AU-WilliamMultilingualNeural", "fr-FR-VivienneMultilingualNeural",
    "fr-FR-RemyMultilingualNeural", "de-DE-SeraphinaMultilingualNeural", "de-DE-FlorianMultilingualNeural",
    "it-IT-IsabellaMultilingualNeural", "it-IT-GiuseppeMultilingualNeural", "ko-KR-HyunsuMultilingualNeural",
]
TEKS = "Din, sumpah gua pusing deh. Tanah Papa kan mau gua balik nama, tapi Papa udah enggak ada… terus gua harus ke mana dulu sih?"

async def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "contoh"); os.makedirs(out, exist_ok=True)
    ok = []
    for v in KANDIDAT:
        try:
            await edge_tts.Communicate(TEKS, v).save(os.path.join(out, v + ".mp3")); ok.append(v); print("ok", v)
        except Exception as e:
            print("gagal", v, e)
    json.dump(ok, open(os.path.join(out, "daftar.json"), "w"), indent=1)

asyncio.run(main())
