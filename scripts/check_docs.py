"""Check repository documentation links without network access or provider keys."""

from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
README_FILES = (
    'README.md', 'tests/README.md', 'scripts/README.md', 'demo/README.md',
    'contracts/README.md', 'camera_capture/README.md', 'services/worker/README.md',
    'spacetimedb/README.md', 'spacetimedb/users/README.md', 'spacetimedb/guest-table/README.md',
)


def main():
    docs = [ROOT / name for name in README_FILES] + sorted((ROOT / 'docs').glob('*.md'))
    failures = []
    links = 0
    for path in docs:
        if not path.is_file():
            failures.append(f'Missing document: {path.relative_to(ROOT)}')
            continue
        content = re.sub(r'^```[^\n]*\n.*?^```\s*$', '', path.read_text(), flags=re.M | re.S)
        for match in re.finditer(r'\[[^\]]*\]\(([^\n)]+)\)', content):
            href = match.group(1).strip().strip('<>')
            parsed = urlsplit(href)
            if parsed.scheme or href.startswith(('#', '//')):
                continue
            target = unquote(parsed.path)
            if target:
                links += 1
                if not (path.parent / target).exists():
                    failures.append(f'{path.relative_to(ROOT)}: missing link target {target}')
    if failures:
        print('\n'.join(failures))
        return 1
    print(f'Documentation check passed: {len(docs)} files, {links} local links.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
