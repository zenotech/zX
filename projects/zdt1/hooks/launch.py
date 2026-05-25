import subprocess
from pathlib import Path
import sys

def launch(row: dict, state: dict, run_dir: Path) -> subprocess.CompletedProcess:
    """
    Launch Hook for ZDT1
    --------------------
    Launches the zdt1.py simulation.
    Finds the simulation script dynamically relative to the hook file path.
    """
    script_path = Path(__file__).resolve().parent.parent / "zdt1.py"
    cmd = [sys.executable, str(script_path)]
    result = subprocess.run(
        cmd,
        cwd=run_dir,
        capture_output=True,
        text=True,
        check=True
    )
    return result
