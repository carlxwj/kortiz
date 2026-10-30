#!/usr/bin/env python3
"""Lightweight defense-in-depth scanner, run on the files you intend to commit."""
import pathlib,re,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
IGNORE={'.git','node_modules','dist','dist-renderer','dist-electron','.firebase','.wrangler','release','build','delivery','test-results','playwright-report','coverage'}
SUFFIX={'.js','.mjs','.cjs','.ts','.tsx','.cs','.py','.json','.yaml','.yml','.toml','.md','.html','.css','.txt','.xml','.sh','.ps1','.rules'}
RULES={
 'private-key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'github-token':r'(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})',
 'aws-access-key':r'AKIA[0-9A-Z]{16}',
 'service-account':r'"type"\s*:\s*"service_account"',
 'cloudinary-credential':r'cloudinary://[^\s"\']+',
 'password-assignment':r'(?i)(?:password|private_key|client_secret|api_secret)\s*[:=]\s*["\'][^"\']{8,}["\']',
}
found=[]
for f in ROOT.rglob('*'):
 if not f.is_file() or any(p in IGNORE for p in f.relative_to(ROOT).parts[:-1]):continue
 if f.name.startswith('.env') and f.name!='.env.example':found.append((f.relative_to(ROOT),'private configuration file'));continue
 if f.name=='.firebaserc':found.append((f.relative_to(ROOT),'production project config'));continue
 if f.suffix.lower() not in SUFFIX:continue
 if f.resolve()==pathlib.Path(__file__).resolve():continue  # Avoid scanning own literal detection signatures.
 try:t=f.read_text(encoding='utf8')
 except (UnicodeDecodeError,OSError):continue
 for name,rule in RULES.items():
  for match in re.finditer(rule,t):
   if name=='password-assignment' and 'tests' in f.relative_to(ROOT).parts and any(marker in match.group().lower() for marker in ('dummy', 'fake', 'mock', 'example')):
    continue # Strictly recognizable local test fixtures are not live credentials.
   found.append((f.relative_to(ROOT),name))
for path,name in found:print(f'SENSITIVE: {path} ({name})')
print(f'Scan: {len(found)} alert(s) — never assume this exhausts possible secrets.')
sys.exit(1 if found else 0)
