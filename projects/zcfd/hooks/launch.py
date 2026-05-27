import subprocess
from pathlib import Path
import sys
import re
from .preprocess import get_mesh_root

def launch(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Launch Hook for zCFD
    ---------------------------------------------
    Launches the zCFD simulation.
    Supports both synchronous local execution and asynchronous Slurm job submission.
    """
    
    # If using Slurm
    use_slurm = state.get("use_slurm", False) or row.get("use_slurm", False)
    
    _ , mesh_file_root = get_mesh_root(row)
    half_body = row['Half-Body or Full Body run'] == 'Half-body'

    command_template = f"(export RLM_LICENSE={state['rlm_license']};"
    command_template += f"export FI_TCP_IFACE={state['fi_tcp_iface']};"
    command_template += f"export OMP_NUM_THREADS={state['omp_num_threads']};"
    command_template += f"export I_MPI_DEBUG={state['i_mpi_debug']};"
    
    if half_body:
        command_template += f"sbatch -n {state['nprocs_half']} {state['slurm_args_half']}  --wrap \"{state['zcfd_install']}/run_zcfd -p {mesh_file_root}.h5 -c run.py -n {state['nprocs_half']}\")"
    else:
        command_template += f"sbatch -n {state['nprocs_full']} {state['slurm_args_full']}  --wrap \"{state['zcfd_install']}/run_zcfd -p {mesh_file_root}.h5 -c run.py -n {state['nprocs_full']}\")"

    if use_slurm:
        # Run sbatch command to submit the job on the Slurm scheduler
        cmd = command_template
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
