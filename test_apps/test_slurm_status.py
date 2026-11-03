import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from zx_backend.runner import check_slurm_job_status


def fake_slurm(squeue_out="", squeue_rc=0, squeue_err="", sacct_out="", sacct_rc=0):
    def run(cmd, *args, **kwargs):
        if cmd[0] == "squeue":
            return subprocess.CompletedProcess(cmd, squeue_rc, squeue_out, squeue_err)
        return subprocess.CompletedProcess(cmd, sacct_rc, sacct_out, "")
    return patch("subprocess.run", side_effect=run)


def check(expected, **slurm):
    with fake_slurm(**slurm):
        got = check_slurm_job_status("123")
    assert got == expected, f"{slurm} -> {got}, expected {expected}"


check("running", squeue_out="123\n")
check("completed", sacct_out="COMPLETED\n")
check("failed", sacct_out="OUT_OF_MEMORY\n")
check("failed", sacct_out="CANCELLED by 1000\n")
check("failed", sacct_out="PREEMPTED\n")
check("running", sacct_out="COMPLETING\n")
# Job left the queue and accounting is disabled: assume it finished
check("completed", sacct_rc=1)
check("completed", squeue_rc=1, squeue_err="slurm_load_jobs error: Invalid job id specified", sacct_rc=1)
# Scheduler unreachable: keep waiting instead of extracting a half-finished job
check("running", squeue_rc=1, squeue_err="slurm_load_jobs error: Socket timed out", sacct_rc=1)
# No Slurm installed at all (local runs)
with patch("subprocess.run", side_effect=FileNotFoundError):
    assert check_slurm_job_status("123") == "completed"

print("SUCCESS: Slurm status mapping tests passed.")
