import subprocess
from pathlib import Path
import sys
import os
import re

def launch(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Launch Hook for OpenFOAM
    ---------------------------------------------
    Launches the OpenFOAM simulation wrapper (openfoam_solver.py).
    Supports both local execution and Slurm job scheduler submission.
    """
    workspace_dir = Path(state["workspace_dir"])
    solver_script = workspace_dir / "openfoam_solver.py"
    
    use_mock = state.get("use_mock", True)
    solver = state.get("solver", "icoFoam")
    use_slurm = state.get("use_slurm", False) or row.get("use_slurm", False)
    
    # Copy env and inject mock config for the solver wrapper process
    env = os.environ.copy()
    env["ZX_USE_MOCK"] = str(use_mock)
    env["ZX_SOLVER"] = str(solver)
    
    if use_slurm:
        # Run sbatch command to submit the job on the Slurm scheduler
        # We need to forward env variables in the sbatch wrap
        cmd = [
            "sbatch", 
            "--job-name=zx_openfoam", 
            "--export=ALL,ZX_USE_MOCK=" + str(use_mock) + ",ZX_SOLVER=" + str(solver),
            "--wrap", f"{sys.executable} {solver_script}"
        ]
        
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
        # Local synchronous execution
        cmd = [sys.executable, str(solver_script)]
        result = subprocess.run(
            cmd,
            cwd=run_dir,
            env=env,
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
