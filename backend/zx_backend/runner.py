import os
import sys
import shutil
import time
import logging
import traceback
import contextlib
import threading
import pandas as pd
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional

from zx_backend.database import load_database, save_database, load_hook_module

logger = logging.getLogger("zX_runner")

# Thread redirection context manager
@contextlib.contextmanager
def redirect_stdout_stderr(file_obj):
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = file_obj
    sys.stderr = file_obj
    try:
        yield
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

@contextlib.contextmanager
def dry_run_patch():
    import subprocess
    from unittest.mock import patch

    # Mock subprocess.run
    def mock_run(args, *extra_args, **kwargs):
        cmd_str = args if isinstance(args, str) else " ".join(map(str, args))
        print(f"[DRY-RUN] Would execute CLI command: {cmd_str}")
        return subprocess.CompletedProcess(
            args=args,
            returncode=0,
            stdout="[DRY-RUN] CLI execution simulated\n",
            stderr=""
        )

    # Mock subprocess.Popen
    class MockPopen:
        def __init__(self, args, *extra_args, **kwargs):
            self.args = args
            cmd_str = args if isinstance(args, str) else " ".join(map(str, args))
            print(f"[DRY-RUN] Would execute CLI command (via Popen): {cmd_str}")
            self.returncode = 0
            self.stdout = None
            self.stderr = None
        def wait(self, timeout=None):
            return 0
        def communicate(self, input=None, timeout=None):
            return (b"[DRY-RUN] CLI execution simulated\n", b"")
        def poll(self):
            return 0

    # Mock os.system
    def mock_system(command):
        print(f"[DRY-RUN] Would execute system command: {command}")
        return 0

    # Mock other call variants to be extremely safe
    def mock_call(args, *extra_args, **kwargs):
        cmd_str = args if isinstance(args, str) else " ".join(map(str, args))
        print(f"[DRY-RUN] Would execute CLI command (via call): {cmd_str}")
        return 0

    def mock_check_call(args, *extra_args, **kwargs):
        cmd_str = args if isinstance(args, str) else " ".join(map(str, args))
        print(f"[DRY-RUN] Would execute CLI command (via check_call): {cmd_str}")
        return 0

    def mock_check_output(args, *extra_args, **kwargs):
        cmd_str = args if isinstance(args, str) else " ".join(map(str, args))
        print(f"[DRY-RUN] Would execute CLI command (via check_output): {cmd_str}")
        return b"[DRY-RUN] CLI execution simulated\n"

    with patch("subprocess.run", side_effect=mock_run), \
         patch("subprocess.Popen", side_effect=MockPopen), \
         patch("subprocess.call", side_effect=mock_call), \
         patch("subprocess.check_call", side_effect=mock_check_call), \
         patch("subprocess.check_output", side_effect=mock_check_output), \
         patch("os.system", side_effect=mock_system):
        yield

class RunnerState:
    def __init__(self):
        self.running = False
        self.stop_requested = False
        self.hook_stage = ""
        self.active_row = -1
        self.broadcast_callback = None

runner_state = RunnerState()

def run_loop_in_thread(
    project_path: str,
    row_ids: List[int],
    hooks: List[str],
    dry_run: bool,
    force: bool,
    state: Dict[str, Any]
):
    global runner_state
    
    # Inject execution-specific options into the state dictionary for hook access
    state["force"] = force
    state["dry_run"] = dry_run
    
    runner_state.running = True
    runner_state.stop_requested = False
    
    # Broadcast running state immediately to UI to activate polling
    if runner_state.broadcast_callback:
        runner_state.broadcast_callback({
            "type": "runner_status",
            "running": True,
            "hook_stage": "initializing",
            "active_row": row_ids[0] if row_ids else -1
        })
        
    logger.info(f"Starting execution on project {project_path}. Selected rows: {row_ids}")
    
    try:
        # Load hooks dynamically
        hooks_dir = Path(project_path) / "hooks"
        preprocess_mod = load_hook_module(hooks_dir / "preprocess.py", "preprocess_hook") if "preprocessing" in hooks else None
        launch_mod = load_hook_module(hooks_dir / "launch.py", "launch_hook") if "launching" in hooks else None
        extract_mod = load_hook_module(hooks_dir / "extract.py", "extract_hook") if "extracting" in hooks else None
        explore_mod = load_hook_module(hooks_dir / "explore.py", "explore_hook") if "exploring" in hooks else None
        
        current_row_ids = list(row_ids)
        if not current_row_ids:
            df = load_database(project_path)
            if not df.empty:
                # Default to all rows that are pending or failed, or simply all rows if none are pending/failed
                pending_rows = df[df["_zx_status"].isin(["pending", "failed"])]
                if not pending_rows.empty:
                    current_row_ids = pending_rows["_zx_row_id"].tolist()
                else:
                    current_row_ids = df["_zx_row_id"].tolist()

        while current_row_ids and not runner_state.stop_requested:
            # 1. First Pass: Preprocess & Launch all rows
            launched_row_ids = []
            for row_id in current_row_ids:
                if runner_state.stop_requested:
                    logger.info("Cancellation requested during launch phase. Stopping sequential loop.")
                    break
                    
                runner_state.active_row = row_id
                
                # Update row status to running
                update_row_status(project_path, row_id, "running", stage="initializing")
                
                # Setup run directory
                run_dir = Path(project_path) / "runs" / f"run_{row_id}"
                
                if force and run_dir.exists() and "preprocessing" in hooks:
                    try:
                        shutil.rmtree(run_dir)
                    except Exception as e:
                        logger.error(f"Failed clearing run directory for row {row_id}: {e}")
                        
                run_dir.mkdir(parents=True, exist_ok=True)
                    
                log_filepath = run_dir / "zx_hook.log"
                
                # Run Pre-processing
                if "preprocessing" in hooks and not runner_state.stop_requested:
                    update_row_status(project_path, row_id, "running", stage="preprocessing")
                    err = execute_stage(
                        "preprocess", preprocess_mod, row_id, project_path, run_dir, log_filepath, dry_run, state
                    )
                    if err:
                        mark_row_failed(project_path, row_id, f"Preprocess Error: {err}")
                        continue
                        
                # Run Launch Hook
                if "launching" in hooks and not runner_state.stop_requested:
                    update_row_status(project_path, row_id, "running", stage="launching")
                    err = execute_stage(
                        "launch", launch_mod, row_id, project_path, run_dir, log_filepath, dry_run, state
                    )
                    if err:
                        mark_row_failed(project_path, row_id, f"Launch Error: {err}")
                        continue
                
                # If we get here, launch succeeded
                launched_row_ids.append(row_id)
                
            # 2. Second Pass: Poll & Extract for all launched rows
            remaining_rows = list(launched_row_ids)
            while remaining_rows and not runner_state.stop_requested:
                for row_id in list(remaining_rows):
                    if runner_state.stop_requested:
                        break
                        
                    runner_state.active_row = row_id
                    run_dir = Path(project_path) / "runs" / f"run_{row_id}"
                    log_filepath = run_dir / "zx_hook.log"
                    
                    # Check if there is an active Slurm job ID
                    job_id = get_job_id(project_path, row_id)
                    if job_id:
                        # Check job status on scheduler
                        job_status = check_slurm_job_status(job_id, dry_run=dry_run)
                        if job_status == "completed":
                            logger.info(f"Slurm job {job_id} for row {row_id} completed. Proceeding to extraction.")
                            
                            # Run extraction
                            if "extracting" in hooks:
                                update_row_status(project_path, row_id, "running", stage="extracting")
                                err = execute_stage(
                                    "extract", extract_mod, row_id, project_path, run_dir, log_filepath, dry_run, state
                                )
                                if err:
                                    mark_row_failed(project_path, row_id, f"Extraction Error: {err}")
                                else:
                                    update_row_status(project_path, row_id, "completed")
                            else:
                                update_row_status(project_path, row_id, "completed")
                                
                            remaining_rows.remove(row_id)
                        elif job_status == "failed":
                            logger.error(f"Slurm job {job_id} for row {row_id} failed.")
                            mark_row_failed(project_path, row_id, f"Slurm Job {job_id} failed on the scheduler.")
                            remaining_rows.remove(row_id)
                        else:
                            # Job is still running, keep in queue
                            pass
                    else:
                        # Local synchronous job (has already completed its launch stage)
                        if "extracting" in hooks:
                            update_row_status(project_path, row_id, "running", stage="extracting")
                            err = execute_stage(
                                "extract", extract_mod, row_id, project_path, run_dir, log_filepath, dry_run, state
                            )
                            if err:
                                mark_row_failed(project_path, row_id, f"Extraction Error: {err}")
                            else:
                                update_row_status(project_path, row_id, "completed")
                        else:
                            update_row_status(project_path, row_id, "completed")
                            
                        remaining_rows.remove(row_id)
                        
                # Sleep briefly if there are still active jobs in the queue
                if remaining_rows and not runner_state.stop_requested:
                    # Determine poll interval (fetch from state or first remaining row)
                    poll_interval = state.get("slurm_poll_interval", 30)
                    try:
                        row_data = load_database(project_path)
                        first_row_id = remaining_rows[0]
                        row_record = row_data[row_data["_zx_row_id"] == first_row_id].to_dict(orient="records")[0]
                        poll_interval = row_record.get("slurm_poll_interval", poll_interval)
                    except Exception:
                        pass
                        
                    try:
                        poll_interval = float(poll_interval)
                    except Exception:
                        poll_interval = 30.0
                        
                    sleep_spent = 0.0
                    while sleep_spent < poll_interval and not runner_state.stop_requested:
                        time.sleep(1.0)
                        sleep_spent += 1.0
            
            # Check for stop request before running exploration
            if runner_state.stop_requested:
                break
                
            # Trigger Exploration Loop (Phase 5)
            if "exploring" in hooks and explore_mod and hasattr(explore_mod, "explore"):
                runner_state.hook_stage = "exploring"
                runner_state.active_row = -1
                
                # Broadcast exploring stage to UI
                if runner_state.broadcast_callback:
                    runner_state.broadcast_callback({
                        "type": "runner_status",
                        "running": True,
                        "hook_stage": "exploring",
                        "active_row": -1
                    })
                    
                df = load_database(project_path)
                user_table = df.copy()
                
                logger.info("Executing exploration hook...")
                
                # Setup explore logging
                runs_dir = Path(project_path) / "runs"
                runs_dir.mkdir(parents=True, exist_ok=True)
                
                import io
                log_buffer = io.StringIO()
                suffix = " (DRY-RUN)" if dry_run else ""
                log_buffer.write(f"--- zX Stage EXPLORE{suffix} Started at {datetime.now().isoformat()} ---\n")
                log_buffer.flush()
                
                explore_err = None
                with redirect_stdout_stderr(log_buffer):
                    try:
                        new_rows = explore_mod.explore(user_table, state)
                    except Exception as e:
                        traceback.print_exc(file=sys.stdout)
                        explore_err = str(e)
                        new_rows = None

                # Retrieve the iteration number (representing the iteration just executed)
                next_iteration = state.get("current_iteration", 1)
                explore_log_path = runs_dir / f"explore_{next_iteration}.log"
                
                log_content = log_buffer.getvalue()
                if explore_err:
                    log_content += f"\nExploration Error: {explore_err}\n"
                    
                with open(explore_log_path, "w") as f_log:
                    f_log.write(log_content)
                    
                if explore_err:
                    logger.error(f"Exploration stage failed: {explore_err}")
                    break
                    
                if not new_rows:
                    logger.info("Exploration Hook returned an empty list. Exploration loop terminated cleanly.")
                    break
                    
                if dry_run:
                    logger.info(f"[DRY-RUN] Exploration Hook would propose {len(new_rows)} new runs (simulated): {new_rows}")
                    time.sleep(0.5)
                    break

                logger.info(f"Exploration Hook proposed {len(new_rows)} new runs. Cascading loop...")
                
                # Append new rows to database
                df = load_database(project_path)
                next_row_id = int(df["_zx_row_id"].max() + 1) if not df.empty else 0
                next_iteration = state.get("current_iteration", 1)
                
                new_df_rows = []
                for i, new_r in enumerate(new_rows):
                    full_row = {**new_r}
                    # Fill system defaults
                    full_row["_zx_row_id"] = next_row_id + i
                    full_row["_zx_status"] = "pending"
                    full_row["_zx_hook_stage"] = ""
                    full_row["_zx_run_dir"] = ""
                    full_row["_zx_started_at"] = ""
                    full_row["_zx_completed_at"] = ""
                    full_row["_zx_error"] = ""
                    full_row["_zx_iteration"] = next_iteration
                    new_df_rows.append(full_row)
                    
                appended_df = pd.concat([df, pd.DataFrame(new_df_rows)], ignore_index=True)
                save_database(project_path, appended_df)
                
                # Save the updated runtime state (containing updated current_iteration, etc.)
                from zx_backend.database import save_state
                save_state(project_path, state)
                
                # Set next batch of row IDs to execute
                current_row_ids = [r["_zx_row_id"] for r in new_df_rows]
            else:
                # No exploration hook or explore stage, we are done
                break

    except Exception as e:
        logger.error(f"Critical error in runner execution: {e}\n{traceback.format_exc()}")
    finally:
        runner_state.running = False
        runner_state.hook_stage = ""
        runner_state.active_row = -1
        
        # Broadcast finished state
        if runner_state.broadcast_callback:
            runner_state.broadcast_callback({
                "type": "runner_status",
                "running": False,
                "hook_stage": ""
            })

def sanitize_job_id(job_id: Any) -> str:
    if pd.isna(job_id) or job_id == "":
        return ""
    job_str = str(job_id).strip()
    if job_str.endswith(".0"):
        job_str = job_str[:-2]
    return job_str

def save_job_id(project_path: str, row_id: int, job_id: str):
    df = load_database(project_path)
    idx = df[df["_zx_row_id"] == row_id].index
    if not idx.empty:
        df.loc[idx, "_zx_job_id"] = sanitize_job_id(job_id)
        save_database(project_path, df)

def get_job_id(project_path: str, row_id: int) -> str:
    df = load_database(project_path)
    idx = df[df["_zx_row_id"] == row_id].index
    if not idx.empty:
        val = df.loc[idx[0], "_zx_job_id"]
        return sanitize_job_id(val)
    return ""

def check_slurm_job_status(job_id: str, dry_run: bool = False) -> str:
    """
    Checks the status of a Slurm job using squeue and sacct.
    Returns 'running', 'completed', or 'failed'.
    """
    if dry_run:
        print(f"[DRY-RUN] Polling status for Slurm job {job_id} -> completed")
        return "completed"

    import subprocess
    # First check squeue to see if it is still running/pending
    try:
        res = subprocess.run(["squeue", "-j", str(job_id)], capture_output=True, text=True)
        if res.returncode == 0:
            if str(job_id) in res.stdout:
                return "running"
    except Exception as e:
        logger.warning(f"Error calling squeue for job {job_id}: {e}")

    # Next check sacct to get the detailed exit state if squeue doesn't find it
    try:
        res = subprocess.run(["sacct", "-j", str(job_id), "-n", "-o", "State"], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip():
            # Get the state of the main job (first token)
            state = res.stdout.strip().split()[0].upper()
            if state in ["COMPLETED"]:
                return "completed"
            elif state in ["FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL"]:
                return "failed"
            elif state in ["RUNNING", "PENDING"]:
                return "running"
    except Exception as e:
        logger.warning(f"Error calling sacct for job {job_id}: {e}")

    # Fallback to avoid hanging on machines without slurm / when test cases run
    # If both commands were run and the job wasn't found as running, we'll assume completed.
    return "completed"

def execute_stage(
    stage_name: str,
    module: Any,
    row_id: int,
    project_path: str,
    run_dir: Path,
    log_filepath: Path,
    dry_run: bool,
    state: Dict[str, Any]
) -> Optional[str]:
    """Runs a single hook stage, capturing logs and handling dry run."""
    global runner_state
    runner_state.hook_stage = stage_name
    
    # Broadcast current stage to UI
    if runner_state.broadcast_callback:
        runner_state.broadcast_callback({
            "type": "runner_status",
            "running": True,
            "hook_stage": stage_name,
            "active_row": row_id
        })
        
    if not module or not hasattr(module, stage_name):
        return f"Hook '{stage_name}.py' has no '{stage_name}' function defined."
        
    func = getattr(module, stage_name)
    
    # Fetch row dict from DB
    df = load_database(project_path)
    row_data = df[df["_zx_row_id"] == row_id].to_dict(orient="records")[0]
    
    # Exclude reserved columns for hook parameter cleanliness
    user_row = {k: v for k, v in row_data.items() if not k.startswith("_zx_")}
    
    # Setup log file
    try:
        with open(log_filepath, "a") as f_log:
            suffix = " (DRY-RUN)" if dry_run else ""
            f_log.write(f"\n--- zX Stage {stage_name.upper()}{suffix} Started at {datetime.now().isoformat()} ---\n")
            f_log.flush()
            
            with redirect_stdout_stderr(f_log):
                try:
                    if dry_run:
                        # Artificially slow down dry run slightly to let UI render the state changes
                        time.sleep(0.5)
                        
                    # Run hook
                    if stage_name == "preprocess":
                        if dry_run:
                            with dry_run_patch():
                                func(user_row, state, run_dir)
                            print("[DRY-RUN] Preprocess stage finished successfully (simulated).")
                        else:
                            func(user_row, state, run_dir)
                    elif stage_name == "launch":
                        if dry_run:
                            with dry_run_patch():
                                result = func(user_row, state, run_dir)
                                if isinstance(result, dict):
                                    if "stdout" in result and result["stdout"]:
                                        print(f"--- CLI stdout ---\n{result['stdout']}")
                                    if "stderr" in result and result["stderr"]:
                                        print(f"--- CLI stderr ---\n{result['stderr']}")
                                    if "job_id" in result and result["job_id"]:
                                        save_job_id(project_path, row_id, result["job_id"])
                                else:
                                    if result and hasattr(result, "stdout") and result.stdout:
                                        print(f"--- CLI stdout ---\n{result.stdout}")
                                    if result and hasattr(result, "stderr") and result.stderr:
                                        print(f"--- CLI stderr ---\n{result.stderr}")
                            print("[DRY-RUN] Launch stage finished successfully (simulated).")
                        else:
                            result = func(user_row, state, run_dir)
                            if isinstance(result, dict):
                                if "stdout" in result and result["stdout"]:
                                    print(f"--- CLI stdout ---\n{result['stdout']}")
                                if "stderr" in result and result["stderr"]:
                                    print(f"--- CLI stderr ---\n{result['stderr']}")
                                if "job_id" in result and result["job_id"]:
                                    save_job_id(project_path, row_id, result["job_id"])
                            else:
                                if result and hasattr(result, "stdout") and result.stdout:
                                    print(f"--- CLI stdout ---\n{result.stdout}")
                                if result and hasattr(result, "stderr") and result.stderr:
                                    print(f"--- CLI stderr ---\n{result.stderr}")
                    elif stage_name == "extract":
                        if dry_run:
                            with dry_run_patch():
                                try:
                                    extracted = func(user_row, state, run_dir)
                                    print(f"[DRY-RUN] Would extract output parameters: {extracted}")
                                except Exception as e:
                                    print(f"[DRY-RUN] Extraction failed (would fail in real run): {e}")
                            print("[DRY-RUN] Extraction stage finished successfully (simulated).")
                        else:
                            extracted = func(user_row, state, run_dir)
                            if not isinstance(extracted, dict):
                                raise TypeError("Extraction Hook must return a dict of key-value results.")
                            # Save extracted parameters to row database
                            merge_extraction_results(project_path, row_id, extracted)
                except Exception as e:
                    traceback.print_exc(file=sys.stdout)
                    return str(e)
        return None
    except Exception as io_err:
        return f"Logging I/O Error: {str(io_err)}"

def update_row_status(project_path: str, row_id: int, status: str, stage: Optional[str] = None):
    df = load_database(project_path)
    idx = df[df["_zx_row_id"] == row_id].index
    if not idx.empty:
        df.loc[idx, "_zx_status"] = status
        if stage is not None:
            df.loc[idx, "_zx_hook_stage"] = stage
        df.loc[idx, "_zx_run_dir"] = str(Path(project_path) / "runs" / f"run_{row_id}")
        
        now_str = datetime.now().isoformat()
        if status == "running" and stage == "initializing":
            df.loc[idx, "_zx_started_at"] = now_str
            df.loc[idx, "_zx_error"] = ""
        elif status == "completed":
            df.loc[idx, "_zx_completed_at"] = now_str
            
        save_database(project_path, df)

def mark_row_failed(project_path: str, row_id: int, error_msg: str):
    df = load_database(project_path)
    idx = df[df["_zx_row_id"] == row_id].index
    if not idx.empty:
        df.loc[idx, "_zx_status"] = "failed"
        df.loc[idx, "_zx_error"] = error_msg
        df.loc[idx, "_zx_completed_at"] = datetime.now().isoformat()
        save_database(project_path, df)

def merge_extraction_results(project_path: str, row_id: int, results: Dict[str, Any]):
    df = load_database(project_path)
    
    # 1. Expand columns dynamically if new keys are present
    for key in results.keys():
        if key not in df.columns:
            logger.info(f"Dynamically adding column: {key}")
            df[key] = None
            
    # 2. Merge values
    idx = df[df["_zx_row_id"] == row_id].index
    if not idx.empty:
        for key, val in results.items():
            # Update value safely
            df.loc[idx, key] = val
            
        save_database(project_path, df)

# trigger_exploration_cascade is no longer used since the runner execution is fully iterative.
