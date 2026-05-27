import subprocess
from pathlib import Path
import sys
import re

def launch(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Launch Hook for ZDT1
    --------------------
    Launches the zdt1.py simulation.
    Supports both synchronous local execution and asynchronous Slurm job submission.
    """
    script_path = Path(__file__).resolve().parent.parent / "zdt1.py"
    
    # If using Slurm
    use_slurm = state.get("use_slurm", False) or row.get("use_slurm", False)
    
    if use_slurm:
        # Run sbatch command to submit the job on the Slurm scheduler
        cmd = ["sbatch", "--job-name=zdt1", "--wrap", f"{sys.executable} {script_path}"]
        result = subprocess.run(
            cmd,
            cwd=run_dir,
            capture_output=True,
            text=True,
            check=True
        )
        # Parse Slurm job ID from stdout
        job_id = ""
        match = re.search(r"Submitted batch job (\d+)", result.stdout)
        if match:
            job_id = match.group(1)
            
        return {
            "status": "submitted",
            "job_id": job_id,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    else:
        # Local execution (synchronous)
        cmd = [sys.executable, str(script_path)]
        result = subprocess.run(
            cmd,
            cwd=run_dir,
            capture_output=True,
            text=True,
            check=True
        )
        return {
            "status": "completed",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
