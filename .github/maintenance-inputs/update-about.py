"""Attempt the requested public repository presentation update with existing access."""
import json
import os
import subprocess

repository = os.environ['GITHUB_REPOSITORY']
assert repository == 'mikkel32/codex-web-gpt-enhanced'
payload = {'description': 'Desktop companion for ChatGPT Web and native Codex, with task-bound tools and conversation continuity.', 'homepage': 'https://github.com/mikkel32/codex-web-gpt-enhanced/blob/main/docs/README.md'}
requests = [('', 'PATCH', payload), ('/topics', 'PUT', {'names': ['chatgpt', 'codex', 'electron', 'typescript', 'mcp', 'macos', 'windows', 'linux']})]
for suffix, method, data in requests:
    result = subprocess.run(['gh', 'api', '--method', method, 'repos/' + repository + suffix, '--input', '-'], input=json.dumps(data), capture_output=True, text=True)
    if result.returncode:
        print('ABOUT_UPDATE_UNAVAILABLE', suffix or 'description', result.stderr.strip())
    else:
        response = json.loads(result.stdout)
        keys = ['description', 'homepage'] if not suffix else ['names']
        print('ABOUT_UPDATED', json.dumps({key: response.get(key) for key in keys}))
