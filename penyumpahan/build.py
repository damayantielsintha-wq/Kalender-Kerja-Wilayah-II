"""Bangun Index.html dari app.src.html.

Apps Script (HtmlService) mengolah ulang <script> inline dan merusak JavaScript modern
(mis. memotong teks setelah "//"). Karena itu skrip aplikasi dibungkus sebagai base64url
(hanya A-Z a-z 0-9 - _) dan dijalankan browser saat halaman dimuat.
Jalankan: python3 build.py
"""
import base64, pathlib
root = pathlib.Path(__file__).parent
src = (root / 'app.src.html').read_text(encoding='utf-8')
i = src.index('<script>') + len('<script>')
j = src.rindex('</script>')
js = src[i:j]
b = base64.urlsafe_b64encode(js.encode('utf-8')).decode('ascii').rstrip('=')
loader = ("(function(){var b='" + b + "';b=b.replace(/-/g,'+').replace(/_/g,'/');"
          "while(b.length%4)b+='=';var r=atob(b),u=new Uint8Array(r.length);"
          "for(var k=0;k<r.length;k++)u[k]=r.charCodeAt(k);"
          "var s=document.createElement('script');s.text=new TextDecoder('utf-8').decode(u);"
          "document.body.appendChild(s);})();")
out = src[:i] + loader + src[j:]
(root / 'Index.html').write_text(out, encoding='utf-8')
print('Index.html dibuat:', len(out), 'byte')
