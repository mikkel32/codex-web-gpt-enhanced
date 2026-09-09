"""Archive reviewed historical heads, then atomically retire unchanged branch refs."""
import json
import os
import re
import subprocess
import time
from pathlib import Path

candidate = '7bec5b318202c62e681f8dda56cfd386a91e5278'
manifest = json.loads(Path(__file__).with_name('branch-maintenance.json').read_text())
def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
def ancestor(a, b):
    return subprocess.run(['git', 'merge-base', '--is-ancestor', a, b], check=False).returncode == 0
subprocess.run(['git', 'fetch', 'origin', candidate], check=True)
for attempt in range(40):
    subprocess.run(['git', 'fetch', 'origin', 'main'], check=True)
    if ancestor(candidate, 'origin/main'):
        break
    time.sleep(15)
else:
    raise SystemExit('Cleanup candidate is not on main; no branches retired')
assert ancestor(manifest['base'], 'origin/main')
current_branch = os.environ['GITHUB_REF_NAME']
current_sha = os.environ['GITHUB_SHA']
assert current_branch == 'codex/repository-maintenance-20260909'
rows = manifest['branches'] + [['codex/repository-cleanup', candidate, True], [current_branch, current_sha, False]]
heads = dict((ref.removeprefix('refs/heads/'), sha) for sha, ref in (line.split() for line in git('ls-remote', '--heads', 'origin').splitlines()))
for branch, sha, integrated in rows:
    assert branch not in ('main', 'codex/upstream-5.0.1')
    assert re.fullmatch(r'[a-zA-Z0-9._/-]+', branch) and re.fullmatch(r'[a-f0-9]{40}', sha)
    assert heads.get(branch) in (None, sha), f'Concurrent branch change: {branch}'
    if integrated:
        assert ancestor(sha, 'origin/main'), f'Unintegrated branch: {branch}'
archives = []
for branch, sha, integrated in rows:
    if integrated:
        continue
    tag = 'refs/tags/archive/2026-09-09/' + branch
    existing = git('ls-remote', 'origin', tag)
    if existing:
        assert existing.split()[0] == sha, f'Conflicting archive: {branch}'
    else:
        subprocess.run(['git', 'push', 'origin', sha + ':' + tag], check=True)
    assert git('ls-remote', 'origin', tag).split()[0] == sha
    archives.append(tag)
present = [(branch, sha) for branch, sha, _ in rows if branch in heads]
if present:
    command = ['git', 'push', '--atomic', 'origin']
    command += ['--force-with-lease=refs/heads/' + branch + ':' + sha for branch, sha in present]
    command += [':refs/heads/' + branch for branch, _ in present]
    subprocess.run(command, check=True)
remaining = git('ls-remote', '--heads', 'origin')
for branch, _, _ in rows:
    assert not any(line.split()[1] == 'refs/heads/' + branch for line in remaining.splitlines())
print('BRANCH_RETIREMENT_OK', json.dumps({'retired': len(present), 'archives': len(archives), 'remaining': remaining.splitlines()}))
