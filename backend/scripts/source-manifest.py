#!/usr/bin/env python3
"""Regenerate provenance against a clean, read-only source checkout at the pinned revision.
Usage: python3 scripts/source-manifest.py /path/to/original/backend
Writes only SOURCE_FILES.json in this export. Never copies source or reads .env.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
revision = 'e564b101f8e8bd60a7bf661b70e0188b079c8fc6'
assert subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() == revision
assert not subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

manifest = {'revision': revision, 'files': []}
for path in sorted(root.rglob('*')):
    if not path.is_file() or path.is_symlink():
        continue
    rel = path.relative_to(root).as_posix()
    if rel == 'SOURCE_FILES.json' or rel.startswith(('bin/', '.git/')):
        continue
    original = rel
    if rel.startswith('schema/migrations/'):
        original = 'internal/account/store/migrations/' + path.name
    elif rel == 'internal/experience/devhttp/routes.go':
        original = 'internal/experience/worldhttp/routes.go'
    raw = path.read_bytes()
    entry = {'export': rel, 'sha256': digest(raw)}
    src = source / original
    if src.is_file():
        old = src.read_bytes()
        entry.update(source=original, source_sha256=digest(old), status='unchanged' if old == raw else 'adapted_or_regenerated')
    else:
        entry['status'] = 'new_export_file'
    manifest['files'].append(entry)
(root / 'SOURCE_FILES.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print('recorded', len(manifest['files']), 'export files at', revision)
