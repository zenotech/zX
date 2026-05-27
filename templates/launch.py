import subprocess
from pathlib import Path
import re

def launch(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Launch Hook
    -----------
    Triggers execution of the CLI application. Supports both synchronous local execution
    and asynchronous job scheduler submissions (e.g. Slurm via sbatch).
    
    Parameters:
      - row: dictionary representing the current parameters.
      - state: shared global state dictionary.
      - run_dir: absolute Path to the row-level execution directory.
      
    Returns:
      - dict: dictionary containing execution details. Must contain:
        - "status": "completed" or "submitted"
        - "job_id": string (only if status is "submitted")
        - "stdout": stdout text from execution/submission
        - "stderr": stderr text from execution/submission
        - "returncode": exit status integer
    """
    # Example: Check if Slurm execution is requested (configurable in state or row)
    use_slurm = state.get("use_slurm", False) or row.get("use_slurm", False)
    
    if use_slurm:
        # For Slurm scheduler tasks:
        # The hook author defines the sbatch submission command and optional script.
        # Ensure that sbatch is the command used to submit the job.
        
        # Example submission script generated inline or existing in the repository
        # cmd = ["sbatch", "submit.sh"]
        
        # In this template example, we run sbatch (which serves as a clear blueprint for the hook author)
        cmd = ["sbatch", "--job-name=zx_job", "--wrap", "python3 -c \"print('Slurm App Running')\""]
        
        result = subprocess.run(
            cmd,
            cwd=run_dir,
            capture_output=True,
            text=True,
            check=True
        )
        
        # Parse Slurm job ID from stdout (e.g., "Submitted batch job 12345")
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
        # For short duration local tasks:
        # Run synchronously using subprocess
        cmd = ["python3", "-c", "print('CLI App Running')"]
        
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
