import subprocess
from pathlib import Path

def launch(row: dict, state: dict, run_dir: Path) -> subprocess.CompletedProcess:
    """
    Launch Hook (Synchronous)
    --------------------------
    Triggers execution of the CLI application.
    Executes sequentially inside the `run_{row_id}/` directory.
    
    Parameters:
      - row: dictionary representing the current parameters.
      - state: shared global state dictionary.
      - run_dir: absolute Path to the row-level execution directory.
      
    Returns:
      - subprocess.CompletedProcess: finished process details.
    """
    # Example: Run a python command-line application inside run_dir
    # For long-running runs, background the process and signal completion via sentinel.
    cmd = ["python3", "-c", "print('CLI App Running')"]
    
    result = subprocess.run(
        cmd,
        cwd=run_dir,
        capture_output=True,
        text=True,
        check=True
    )
    return result
