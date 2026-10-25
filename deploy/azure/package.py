"""Build a deployment ZIP without local credentials, databases or dependencies.

Run from any directory: .venv/bin/python deploy/azure/package.py
This builds locally only; it never uploads, publishes a database or calls AI.
"""

import argparse
from pathlib import Path
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_FILES = (
    "app_service.py",
    "requirements.txt",
    "services/api/pyproject.toml",
    "services/api/requirements-dev.lock",
    "camera_capture/__init__.py",
    "camera_capture/image_quality.py",
    "camera_capture/spacetime_wire.py",
    "apps/web/dist/index.html",
)
SOURCE_DIRECTORIES = ("services/api/commonplace_api", "services/worker")


def package_project(root: Path, output: Path) -> int:
    root, output = root.resolve(), output.resolve()
    if output.suffix != ".zip":
        raise ValueError("Choose an output filename ending in .zip.")
    if output.is_relative_to(root / "apps/web/dist") or any(
        output.is_relative_to(root / directory) for directory in SOURCE_DIRECTORIES
    ):
        raise ValueError("Place the ZIP outside the frontend build and Python source folders.")

    files = {root / name for name in REQUIRED_FILES}
    for directory in SOURCE_DIRECTORIES:
        source = root / directory
        if not source.is_dir():
            raise ValueError(f"Missing source directory: {directory}")
        files.update(path for path in source.rglob("*.py") if not path.name.startswith("test_"))
    files.update(path for path in (root / "apps/web/dist").rglob("*") if path.is_file())
    approved = []
    for path in sorted(files):
        relative = path.relative_to(root)
        if not path.is_file():
            raise ValueError(f"Missing {relative}. Build the frontend with npm run build first.")
        if any(part.startswith(".") or part == "__pycache__" for part in relative.parts):
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError(f"Deployment files must be regular files inside the project: {relative}")
        if path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pyc", ".zip"}:
            continue
        approved.append((path, relative))

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, relative in approved:
            archive.write(path, relative.as_posix())
    return len(approved)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "remi-azure.zip")
    parser.add_argument("--skip-build", action="store_true", help="Package an already checked frontend build.")
    args = parser.parse_args()
    try:
        if not args.skip_build:
            subprocess.run(["npm", "run", "check"], cwd=ROOT, check=True)
        count = package_project(ROOT, args.output)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Package failed: {error}", file=sys.stderr)
        return 1
    print(f"Created {args.output.resolve()} ({count} files). Not deployed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
