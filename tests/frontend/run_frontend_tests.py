#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, re, shutil, socket, subprocess, sys, time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

DEFAULT_FRONTEND = Path('/home/fofka/Рабочий стол/XAKATON/HACKTON/frontend')

@dataclass
class Check:
    name: str
    status: str
    command: str = ''
    returncode: int | None = None
    seconds: float = 0.0
    stdout: str = ''
    stderr: str = ''
    details: str = ''

class Tester:
    def __init__(self, frontend: Path, report_dir: Path, timeout: int, port: int):
        self.frontend = frontend.resolve()
        self.report_dir = report_dir.resolve()
        self.timeout = timeout
        self.port = port
        self.results: list[Check] = []
        self.pkg: dict = {}
        self.env = os.environ.copy()
        self.env.setdefault('CI', '1')
        self.env.setdefault('NO_COLOR', '1')
        self.server: subprocess.Popen | None = None

    def add(self, result: Check):
        self.results.append(result)
        icon = {'PASS':'✅','FAIL':'❌','WARN':'⚠️','SKIP':'⏭️'}.get(result.status, '•')
        print(f'{icon} {result.status:4}  {result.name} ({result.seconds:.2f}s)')
        if result.details:
            print('   ' + result.details.replace('\n', '\n   '))

    def run_cmd(self, name: str, cmd: list[str], *, env: dict | None = None, required=True, timeout=None) -> Check:
        start = time.monotonic()
        try:
            cp = subprocess.run(cmd, cwd=self.frontend, env=env or self.env, text=True,
                                capture_output=True, timeout=timeout or self.timeout)
            status = 'PASS' if cp.returncode == 0 else ('FAIL' if required else 'WARN')
            r = Check(name, status, ' '.join(cmd), cp.returncode, time.monotonic()-start,
                      cp.stdout[-30000:], cp.stderr[-30000:])
        except FileNotFoundError as e:
            r = Check(name, 'FAIL' if required else 'SKIP', ' '.join(cmd), None,
                      time.monotonic()-start, details=str(e))
        except subprocess.TimeoutExpired as e:
            out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or '')
            err = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or '')
            r = Check(name, 'FAIL' if required else 'WARN', ' '.join(cmd), None,
                      time.monotonic()-start, out[-30000:], err[-30000:], f'Timeout after {timeout or self.timeout}s')
        self.add(r); return r

    def preflight(self):
        start = time.monotonic()
        problems=[]
        if not self.frontend.is_dir(): problems.append(f'Frontend directory not found: {self.frontend}')
        pkg = self.frontend/'package.json'
        if not pkg.is_file(): problems.append('package.json not found')
        if problems:
            self.add(Check('Preflight', 'FAIL', seconds=time.monotonic()-start, details='\n'.join(problems))); return False
        try:
            self.pkg=json.loads(pkg.read_text(encoding='utf-8'))
        except Exception as e:
            self.add(Check('package.json parse', 'FAIL', seconds=time.monotonic()-start, details=str(e))); return False
        scripts=self.pkg.get('scripts', {})
        self.add(Check('Preflight', 'PASS', seconds=time.monotonic()-start,
                       details=f"Node project detected; scripts: {', '.join(sorted(scripts)) or 'none'}"))
        return True

    def static_checks(self):
        start=time.monotonic(); findings=[]; warnings=[]
        exts={'.js','.jsx','.ts','.tsx','.mjs','.cjs','.html','.css','.json'}
        skip={'node_modules','dist','build','.git','.cache','.artifacts','coverage','playwright-report','test-results'}
        secret_patterns=[
            ('private key', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
            ('OpenAI-style key', re.compile(r'\bsk-[A-Za-z0-9_-]{20,}\b')),
            ('generic hardcoded secret', re.compile(r'(?i)(?:api[_-]?key|secret|token|password)\s*[:=]\s*["\'][^"\'\s]{12,}["\']')),
        ]
        danger_patterns=[
            ('eval()', re.compile(r'\beval\s*\(')),
            ('new Function()', re.compile(r'\bnew\s+Function\s*\(')),
            ('dangerouslySetInnerHTML', re.compile(r'\bdangerouslySetInnerHTML\b')),
            ('document.write()', re.compile(r'\bdocument\.write\s*\(')),
        ]
        for p in self.frontend.rglob('*'):
            if not p.is_file() or p.suffix.lower() not in exts or any(part in skip for part in p.parts): continue
            try: text=p.read_text(encoding='utf-8', errors='ignore')
            except Exception: continue
            rel=p.relative_to(self.frontend)
            for label,rx in secret_patterns:
                for m in rx.finditer(text):
                    line=text.count('\n',0,m.start())+1
                    findings.append(f'{rel}:{line}: possible {label}')
            for label,rx in danger_patterns:
                for m in rx.finditer(text):
                    line=text.count('\n',0,m.start())+1
                    warnings.append(f'{rel}:{line}: review {label}')
            for i,line in enumerate(text.splitlines(),1):
                if 'target="_blank"' in line and 'rel=' not in line:
                    warnings.append(f'{rel}:{i}: target=_blank without rel')
                if re.search(r'\bTODO\b|\bFIXME\b', line):
                    warnings.append(f'{rel}:{i}: TODO/FIXME left in source')
        status='FAIL' if findings else ('WARN' if warnings else 'PASS')
        details='\n'.join((['Potential secrets:']+findings if findings else []) + (['Review warnings:']+warnings[:100] if warnings else []))
        if len(warnings)>100: details += f'\n... and {len(warnings)-100} more warnings'
        self.add(Check('Static source scan',status,seconds=time.monotonic()-start,details=details or 'No obvious secret/danger patterns found.'))

    def free_port(self):
        port=self.port
        for candidate in range(port, port+30):
            with socket.socket() as s:
                try: s.bind(('127.0.0.1', candidate)); return candidate
                except OSError: pass
        raise RuntimeError('No free local port found')

    def wait_port(self, port, seconds=25):
        end=time.time()+seconds
        while time.time()<end:
            if self.server and self.server.poll() is not None: return False
            with socket.socket() as s:
                s.settimeout(.3)
                if s.connect_ex(('127.0.0.1',port))==0: return True
            time.sleep(.25)
        return False

    def start_dev_server(self):
        scripts=self.pkg.get('scripts',{})
        if 'dev' not in scripts:
            self.add(Check('Dev server', 'SKIP', details='No npm script "dev".')); return None
        port=self.free_port(); env=self.env.copy(); env['PORT']=str(port)
        log=(self.report_dir/'dev-server.log').open('w',encoding='utf-8')
        # Extra args after -- are understood by Vite and harmless for standard Vite scripts.
        self.server=subprocess.Popen(['npm','run','dev','--','--host','127.0.0.1','--port',str(port),'--strictPort'],
                                     cwd=self.frontend,env=env,text=True,stdout=log,stderr=subprocess.STDOUT)
        ok=self.wait_port(port)
        self.add(Check('Dev server', 'PASS' if ok else 'FAIL', command=f'npm run dev -- --port {port}', details=f'http://127.0.0.1:{port}' if ok else 'Server failed to become ready; see dev-server.log'))
        return port if ok else None

    def stop_server(self):
        if not self.server: return
        self.server.terminate()
        try:self.server.wait(5)
        except subprocess.TimeoutExpired:
            self.server.kill(); self.server.wait(3)

    def npm_script(self, key, name=None, *, required=False, env=None, timeout=None):
        if key not in self.pkg.get('scripts',{}):
            self.add(Check(name or f'npm run {key}','SKIP',details=f'No npm script "{key}".')); return None
        return self.run_cmd(name or f'npm run {key}', ['npm','run',key], required=required, env=env, timeout=timeout)

    def run_all(self):
        self.report_dir.mkdir(parents=True,exist_ok=True)
        if not self.preflight(): return self.finish()
        for exe in ['node','npm']:
            if shutil.which(exe): self.run_cmd(f'{exe} version',[exe,'--version'],required=True)
            else: self.add(Check(f'{exe} available','FAIL',details=f'{exe} not found in PATH'))
        if not (self.frontend/'node_modules').exists():
            self.add(Check('Dependencies', 'FAIL', details='node_modules not found. Run npm ci (or npm install) in frontend first.'))
        else:
            self.add(Check('Dependencies','PASS',details='node_modules exists.'))

        self.static_checks()
        # Fast deterministic checks first.
        self.npm_script('lint','Lint',required=True)
        self.npm_script('typecheck','TypeScript typecheck',required=True)
        if 'typecheck' not in self.pkg.get('scripts',{}) and (self.frontend/'tsconfig.json').exists():
            self.run_cmd('TypeScript typecheck',['npx','tsc','--noEmit'],required=True)
        self.npm_script('test','Unit / integration tests',required=True,timeout=max(self.timeout,180))
        self.npm_script('build','Production build',required=True,timeout=max(self.timeout,180))

        # Browser/UI checks need a running local frontend.
        browser_keys=[k for k in ('test:browser','test:e2e','e2e','test:ui') if k in self.pkg.get('scripts',{})]
        if browser_keys:
            port=self.start_dev_server()
            if port:
                env=self.env.copy(); env['FRONTEND_URL']=f'http://127.0.0.1:{port}'
                for key in browser_keys:
                    self.npm_script(key, f'Browser/E2E ({key})', required=True, env=env, timeout=max(self.timeout,300))
            else:
                for key in browser_keys: self.add(Check(f'Browser/E2E ({key})','FAIL',details='Dev server unavailable.'))
            self.stop_server()
        else:
            self.add(Check('Browser/E2E','SKIP',details='No browser/e2e npm script found.'))

        return self.finish()

    def finish(self):
        self.stop_server()
        counts={s:sum(r.status==s for r in self.results) for s in ['PASS','FAIL','WARN','SKIP']}
        overall='FAIL' if counts['FAIL'] else ('WARN' if counts['WARN'] else 'PASS')
        payload={
            'overall':overall,
            'frontend':str(self.frontend),
            'generated_at':datetime.now(timezone.utc).isoformat(),
            'summary':counts,
            'checks':[asdict(r) for r in self.results],
        }
        self.report_dir.mkdir(parents=True,exist_ok=True)
        (self.report_dir/'frontend-test-report.json').write_text(json.dumps(payload,indent=2,ensure_ascii=False),encoding='utf-8')
        lines=[f'# Frontend full test report','',f'**Result:** {overall}',f'**Frontend:** `{self.frontend}`','',
               f"PASS: {counts['PASS']} | FAIL: {counts['FAIL']} | WARN: {counts['WARN']} | SKIP: {counts['SKIP']}",'','## Checks','']
        for r in self.results:
            lines += [f'### {r.status} — {r.name}', f'- Time: {r.seconds:.2f}s']
            if r.command: lines.append(f'- Command: `{r.command}`')
            if r.details: lines += ['','```text',r.details[:12000],'```']
            if r.stdout.strip(): lines += ['','**stdout**','```text',r.stdout[-12000:],'```']
            if r.stderr.strip(): lines += ['','**stderr**','```text',r.stderr[-12000:],'```']
            lines.append('')
        (self.report_dir/'frontend-test-report.md').write_text('\n'.join(lines),encoding='utf-8')
        print('\n=== FINAL ===')
        print(json.dumps({'overall':overall,**counts},ensure_ascii=False))
        print('Reports:',self.report_dir/'frontend-test-report.md')
        return 1 if counts['FAIL'] else 0

def main():
    ap=argparse.ArgumentParser(description='Full frontend test runner for NX-Sentinel/HackAlem project')
    ap.add_argument('frontend',nargs='?',default=str(DEFAULT_FRONTEND),help='Path to frontend directory')
    ap.add_argument('--report-dir',default='',help='Report directory (default: <tester>/reports)')
    ap.add_argument('--timeout',type=int,default=120,help='Default command timeout in seconds')
    ap.add_argument('--port',type=int,default=5173,help='Preferred local dev-server port')
    ns=ap.parse_args()
    here=Path(__file__).resolve().parent
    report=Path(ns.report_dir).expanduser() if ns.report_dir else here/'reports'
    tester=Tester(Path(ns.frontend).expanduser(), report, ns.timeout, ns.port)
    raise SystemExit(tester.run_all())

if __name__=='__main__': main()
