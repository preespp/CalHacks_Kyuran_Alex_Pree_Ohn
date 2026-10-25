"""Run one SLAM session at a time as phone streams arrive (inside WSL)."""
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
SLAM = ROOT.parents[1] / 'MASt3R-SLAM'
SPOOL = ROOT / '.data' / 'streams'


def main():
    SPOOL.mkdir(parents=True, exist_ok=True)
    while True:
        for directory in sorted(SPOOL.iterdir()):
            manifest = directory / 'frames.jsonl'
            if not manifest.exists() or (directory / 'slam.exit').exists():
                continue
            if not manifest.read_text().strip():
                continue
            print(f'Starting SLAM for {directory.name}', flush=True)
            env = dict(os.environ, CUDA_HOME='/usr/local/cuda-12.4')
            env['PATH'] = '/opt/mast3r-slam-venv/bin:/usr/local/cuda-12.4/bin:' + env['PATH']
            with (directory / 'slam.log').open('w') as log:
                result = subprocess.run(['/opt/mast3r-slam-venv/bin/python', '-u', 'main.py',
                    '--dataset', f'spacetime:{directory}', '--config', 'config/iphone_224.yaml', '--no-viz', '--save-as', 'iphone'],
                    cwd=SLAM, env=env, stdout=log, stderr=subprocess.STDOUT)
            (directory / 'slam.exit').write_text(str(result.returncode))
        time.sleep(1)


if __name__ == '__main__':
    main()
