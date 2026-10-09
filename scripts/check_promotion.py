#!/usr/bin/env python3
"""Fail closed on release promotions without the required origin and evidence."""
import json
import os
from pathlib import Path
import subprocess

REQUIRED = ('unity_build', 'song_import_gameplay', 'controller_hardware', 'clean_install', 'recovery')


def check_report(base, head, report):
    expected = {'stage': 'develop', 'main': 'stage'}.get(base)
    if not expected:
        return
    if head != expected:
        raise ValueError(f'{base} accepts promotion only from {expected}, not {head}.')
    required = ('unity_build',) if base == 'stage' else REQUIRED
    checks = report.get('checks', {})
    for key in required:
        entry = checks.get(key, {})
        if entry.get('status') != 'passed' or not str(entry.get('evidence', '')).strip():
            raise ValueError(f'Promotion blocked: {key} needs passing evidence.')
    if not report.get('tested_commit') or not report.get('artifact'):
        raise ValueError('Promotion needs the tested commit and built artifact.')
    if not str(report.get('specs_report', '')).startswith('https://github.com/Hanzala-plyance/backstage-specs/blob/meta/'):
        raise ValueError('Link the release report on backstage-specs/meta.')
    if base == 'main' and (not report.get('reviewer') or not report.get('rollback')):
        raise ValueError('Main needs a reviewer and rollback procedure.')


def main():
    base, head = os.environ.get('BACKSTAGE_BASE_BRANCH', ''), os.environ.get('BACKSTAGE_HEAD_BRANCH', '')
    if base not in ('stage', 'main'):
        print('No stage/main promotion requested.')
        return
    report = json.loads(Path('release/acceptance.json').read_text())
    check_report(base, head, report)
    tested, candidate = report['tested_commit'], os.environ['BACKSTAGE_HEAD_SHA']
    # Evidence can be committed after testing, but no executable/assets change may follow it.
    subprocess.run(['git', 'merge-base', '--is-ancestor', tested, candidate], check=True)
    subprocess.run(['git', 'diff', '--exit-code', tested, candidate, '--', '.',
                    ':!release/**', ':!docs/**', ':!README.md'], check=True)
    print(f'Promotion {head} -> {base} has the required evidence for the tested code.')


if __name__ == '__main__':
    try: main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
