"""Manual/CUA browser harness when subprocess Chromium is unavailable.

Build fixtures with PDF_BROWSER_OUTPUT pointing to a shared workspace directory:
  PDF_BROWSER_OUTPUT=/path/to/fixtures node --experimental-strip-types scripts/build-pdf-regression.ts
  PDF_BROWSER_OUTPUT=/path/to/fixtures python3 e2e/pdf_exports_cua.py
Open http://127.0.0.1:8788/runner.html?mode=baseline, click Run PDF validation, then
repeat with mode=candidate. CSP blocks all non-origin requests. Finally run:
  PDF_BROWSER_OUTPUT=/path/to/fixtures python3 e2e/pdf_exports_cua.py --compare
No credentials, application backend, or external browser resources are needed.
"""
import http.server, json, pathlib, shutil, base64, os, sys, subprocess, hashlib
R=pathlib.Path(os.getenv('PDF_BROWSER_OUTPUT', '/tmp/mcm-pdf-browser')).resolve()
P=pathlib.Path(__file__).resolve().parent.parent / '.output/public/assets'
if '--compare' in sys.argv:
 results={}
 for mode in ['baseline','candidate']:
  directory=R/mode/'cua-pdfs'
  meta=json.loads((directory/'result.json').read_text())
  assert not meta['errors'] and not meta['violations'] and not meta['external'], meta
  assert meta['production_chunk_import']=='passed'
  pdfs=sorted(directory.glob('*.pdf'), key=lambda p:int(p.stem))
  assert len(pdfs)==9, f'Expected nine fixtures, found {len(pdfs)}'
  hashes=[]
  for pdf in pdfs:
   subprocess.run(['pdftoppm','-r','96','-png',str(pdf),str(pdf.with_suffix(''))],check=True,capture_output=True)
   pages=sorted(directory.glob(f'{pdf.stem}-*.png'))
   assert pages
   assert 'MCM' in subprocess.check_output(['pdftotext',str(pdf),'-']).decode()
   hashes.append([hashlib.sha256(page.read_bytes()).hexdigest() for page in pages])
  results[mode]=hashes
 assert results['baseline']==results['candidate'], 'PDF raster mismatch'
 summary={'fixtures':9,'pages':sum(map(len,results['candidate'])),'pixel_differences':0,'browser_errors':0,'csp_violations':0,'external_resources':0,'production_chunk_import':'passed','raster_dpi':96}
 (R/'cua-result.json').write_text(json.dumps(summary,indent=2))
 print(json.dumps(summary))
 sys.exit(0)
shutil.copytree(P,R/'production',dirs_exist_ok=True)
clients=[p.name for p in P.glob('client-*.js') if 'as jsPDF}' in p.read_text()]
assert len(clients)==1
(R/'runner.js').write_text('''const result=document.querySelector('pre');
const errors=[];const violations=[];
window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
window.addEventListener('securitypolicyviolation',e=>violations.push(e.blockedURI));
const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-21T00:00:00Z']))}static now(){return 1792540800000}};
document.querySelector('button').onclick=async()=>{try{
 const mode=new URLSearchParams(location.search).get('mode');
 const {jsPDF}=await import('/production/'''+clients[0]+'''');const smoke=new jsPDF();smoke.text('Production PDF smoke',10,10);if(!smoke.output().startsWith('%PDF-'))throw Error('Smoke failed');
 await import('/'+mode+'/fixture.js');const docs=await window.runPdfFixtures();
 const resources=performance.getEntriesByType('resource').map(r=>r.name);const external=resources.filter(u=>!u.startsWith(location.origin+'/'));
 const data={mode,docs,errors,violations,external,production_chunk_import:'passed'};
 const response=await fetch('/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw Error('collector failed');
 result.textContent=JSON.stringify({...data,docs:docs.map(d=>({filename:d.filename,base64Length:d.data.length}))},null,2);
 }catch(e){result.textContent='FAILED '+e.stack}};
''')
(R/'runner.html').write_text('<!doctype html><title>Offline PDF regression</title><h1>Offline PDF regression</h1><button>Run PDF validation</button><pre>Ready</pre><script src="/runner.js"></script>')
class H(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(R),**k)
 def end_headers(self):
  self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; worker-src 'none'")
  super().end_headers()
 def do_POST(self):
  if self.path!='/collect': self.send_error(404);return
  if self.headers.get('Origin') != 'http://127.0.0.1:8788': self.send_error(403);return
  if int(self.headers.get('Content-Length', '0')) > 10_000_000: self.send_error(413);return
  d=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  assert d['mode'] in ['baseline','candidate']
  out=R/d['mode']/'cua-pdfs';out.mkdir(exist_ok=True)
  for i,pdf in enumerate(d['docs']):(out/f'{i}.pdf').write_bytes(base64.b64decode(pdf['data']))
  (out/'result.json').write_text(json.dumps({k:v for k,v in d.items() if k!='docs'},indent=2))
  self.send_response(200);self.end_headers();self.wfile.write(b'ok')
http.server.ThreadingHTTPServer(('127.0.0.1',8788),H).serve_forever()
