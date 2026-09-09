"""Finish documentation edits from the reviewed source and branch manifest."""
from pathlib import Path
import json

inputs = Path(__file__).parent
guide = Path('docs/user-guide.md')
guide.write_text(guide.read_text().replace('[Documentation](../README.md)', '[Documentation](README.md)', 1).rstrip() + '\n')
manifest = json.loads((inputs / 'branch-maintenance.json').read_text())
lines = ['# Branch archive', '', '[Development](README.md) · [Documentation](../README.md)', '',
         'Repository maintenance for the stable 5.20.3 line. Integrated commits remain',
         'reachable from main. Unique historical snapshots are retained under archive tags.',
         'The pinned upstream comparison branch stays available. Retirement checks the',
         'exact remote head and refuses to discard concurrent changes.', '',
         '| Former branch | Preserved commit | Retention |', '| --- | --- | --- |']
for branch, sha, integrated in manifest['branches']:
    retention = 'Main ancestry' if integrated else '`archive/2026-09-09/' + branch + '`'
    lines.append(f'| `{branch}` | `{sha}` | {retention} |')
Path('docs/development/branch-archive.md').write_text('\n'.join(lines) + '\n')
index = Path('docs/development/README.md')
link = '\n[Branch archive](branch-archive.md) records retired branches and preserved commit identities.\n'
if link not in index.read_text():
    index.write_text(index.read_text() + link)
print('FINAL_DOCUMENTATION_READY', len(manifest['branches']))
