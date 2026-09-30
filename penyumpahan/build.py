"""Bangun Index.html dari app.src.html.

Apps Script (HtmlService) mengolah ulang <script> inline dan merusak JavaScript modern
(mis. memotong teks setelah "//"). Karena itu skrip aplikasi dikompres (DEFLATE), dibungkus
sebagai base64url (hanya A-Z a-z 0-9 - _), lalu dibuka dan dijalankan browser saat halaman
dimuat (pembuka kompresi: vendor/inflate.min.js).
Sebelum dibungkus, JavaScript diperkecil dengan terser (bila tersedia: `npx terser` atau
variabel TERSER) agar halaman lebih ringan dimuat di HP. Nama fungsi tingkat atas tidak
diubah karena dipanggil dari atribut onclick.
Jalankan: python3 build.py
"""
import base64, os, pathlib, shutil, subprocess, zlib
root = pathlib.Path(__file__).parent
src = (root / 'app.src.html').read_text(encoding='utf-8')
i = src.index('<script>') + len('<script>')
j = src.rindex('</script>')
js = src[i:j]


def kecilkan(kode):
    cmd = os.environ.get('TERSER') or shutil.which('terser')
    cmd = [cmd] if cmd else ['npx', '--yes', 'terser@5']
    try:
        r = subprocess.run(cmd + ['--compress', 'passes=2', '--mangle', '--ecma', '2020'],
                           input=kode, capture_output=True, text=True, timeout=180)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
        print('terser gagal, memakai kode asli:', r.stderr[:300])
    except Exception as e:  # terser/npx tidak ada
        print('terser tidak tersedia, memakai kode asli:', e)
    return kode


js = kecilkan(js)
def b64(data):
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


# kode aplikasi dikompres (DEFLATE mentah) lalu base64url: ukuran halaman jauh lebih kecil.
# Pembuka kompresi (fflate inflateSync, ±4 KB) ikut dibungkus base64url agar aman dari HtmlService.
kompres = zlib.compressobj(9, zlib.DEFLATED, -15)
data = kompres.compress(js.encode('utf-8')) + kompres.flush()
inflate = (root / 'vendor' / 'inflate.min.js').read_bytes()
loader = ("(function(){function d(b){b=b.replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';"
          "var r=atob(b),u=new Uint8Array(r.length);for(var k=0;k<r.length;k++)u[k]=r.charCodeAt(k);return u}"
          "var t=new TextDecoder('utf-8');function j(x){var s=document.createElement('script');s.text=x;document.body.appendChild(s)}"
          "j(t.decode(d('" + b64(inflate) + "')));j(t.decode(window.__inflate(d('" + b64(data) + "'))));})();")
out = src[:i] + loader + src[j:]
(root / 'Index.html').write_text(out, encoding='utf-8')
print('Index.html dibuat:', len(out), 'byte')
