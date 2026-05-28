import os
import time
import logging
import pandas as pd
import importlib.util
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional

logger = logging.getLogger("zX_database")

# Cross-platform simple file-based lock
class FileLock:
    def __init__(self, filepath: str, timeout: float = 5.0):
        self.lockfile = filepath + ".lock"
        self.timeout = timeout
        self.locked = False

    def __enter__(self):
        start_time = time.time()
        while True:
            try:
                # Try to create lockfile exclusively
                fd = os.open(self.lockfile, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                self.locked = True
                return self
            except FileExistsError:
                if time.time() - start_time > self.timeout:
                    raise TimeoutError(f"Database lock timed out on {self.lockfile}")
                time.sleep(0.1)

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.locked:
            try:
                os.remove(self.lockfile)
            except OSError:
                pass
            self.locked = False

# Reserved Columns
RESERVED_COLUMNS = {
    "_zx_row_id": "int",
    "_zx_status": "string",
    "_zx_hook_stage": "string",
    "_zx_run_dir": "string",
    "_zx_started_at": "string",
    "_zx_completed_at": "string",
    "_zx_error": "string",
    "_zx_iteration": "int",
    "_zx_job_id": "string"
}


def get_csv_path(project_path: str) -> str:
    return os.path.join(project_path, "zx_database.csv")

def load_database(project_path: str) -> pd.DataFrame:
    csv_path = get_csv_path(project_path)
    if not os.path.exists(csv_path):
        # Create an empty DataFrame with reserved columns
        df = pd.DataFrame(columns=list(RESERVED_COLUMNS.keys()))
        return df
        
    with FileLock(csv_path):
        # Read database safely
        try:
            df = pd.read_csv(csv_path)
            # Ensure index or missing columns are filled and cast to correct type
            for col, dtype in RESERVED_COLUMNS.items():
                if col not in df.columns:
                    if dtype == "int":
                        df[col] = 0
                    else:
                        df[col] = ""
                else:
                    if dtype == "int":
                        df[col] = df[col].fillna(0).astype(int)
                    else:
                        df[col] = df[col].fillna("").astype(str)
            return df
        except Exception as e:
            logger.error(f"Failed to read CSV at {csv_path}: {e}")
            raise e

def save_database(project_path: str, df: pd.DataFrame) -> None:
    csv_path = get_csv_path(project_path)
    with FileLock(csv_path):
        try:
            df.to_csv(csv_path, index=False)
        except Exception as e:
            logger.error(f"Failed to write CSV at {csv_path}: {e}")
            raise e

def load_hook_module(hook_path: Path, module_name: str) -> Any:
    if not hook_path.exists():
        return None
    spec = importlib.util.spec_from_file_location(module_name, str(hook_path))
    if not spec or not spec.loader:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def load_state(project_path: str) -> Dict[str, Any]:
    state_path = os.path.join(project_path, "zx_state.json")
    state = {"max_iterations": 5, "current_iteration": 0}
    if os.path.exists(state_path):
        try:
            import json
            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load state json from {state_path}: {e}")
    # Dynamically inject the active project workspace directory (absolute path)
    state["workspace_dir"] = os.path.abspath(project_path)
    return state

def save_state(project_path: str, state: Dict[str, Any]) -> None:
    state_path = os.path.join(project_path, "zx_state.json")
    try:
        import json
        # Prevent runtime helper variables from polluting the persisted state file
        state_to_save = state.copy()
        state_to_save.pop("workspace_dir", None)
        state_to_save.pop("force", None)
        state_to_save.pop("dry_run", None)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state_to_save, f, indent=4)
    except Exception as e:
        logger.error(f"Failed to save state json to {state_path}: {e}")

def run_state_hook(project_path: str, state: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    # Synchronize deletions: remove keys from state that are not present in updates
    # (except for system-managed parameters like workspace_dir and current_iteration)
    keys_to_delete = [
        k for k in state.keys() 
        if k not in updates and k not in ("workspace_dir", "current_iteration")
    ]
    for k in keys_to_delete:
        state.pop(k, None)

    hook_path = Path(project_path) / "hooks" / "state.py"
    module = load_hook_module(hook_path, "state_hook")
    
    func = None
    if module:
        if hasattr(module, "state"):
            func = getattr(module, "state")
        elif hasattr(module, "update"):
            func = getattr(module, "update")
            
    if func:
        logger.info("Executing state hook...")
        return func(state, updates)
    else:
        logger.info("No state hook found, applying updates directly.")
        state.update(updates)
        return state

def run_initialization_hook(project_path: str, df: pd.DataFrame, state: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    hook_path = Path(project_path) / "hooks" / "initialize.py"
    module = load_hook_module(hook_path, "initialize_hook")
    
    if module and hasattr(module, "initialize"):
        logger.info("Executing initialize hook...")
        return module.initialize(df, state)
    else:
        logger.info("No initialize hook found, passing rows directly.")
        return df.to_dict(orient="records"), state

def initialize_project_database(project_path: str, initial_csv_path: Optional[str] = None, run_init: bool = False) -> pd.DataFrame:
    df = pd.DataFrame()
    
    # 1. Load initial CSV if provided
    if initial_csv_path and os.path.exists(initial_csv_path):
        try:
            df = pd.read_csv(initial_csv_path)
        except Exception as e:
            logger.error(f"Failed to parse input CSV: {e}")
            raise ValueError(f"Could not read upload CSV: {str(e)}")
    else:
        # Load existing if it exists
        csv_path = get_csv_path(project_path)
        if os.path.exists(csv_path):
            df = load_database(project_path)
            
    # Load existing state if any, otherwise default
    state = load_state(project_path)
    
    # 2. Run initialization hook
    # The user requires that the state currently configured in the initialize hook be set each time a workspace is opened.
    # Therefore, we always run it to extract/set the state parameters, even if database is not empty, unless it fails.
    try:
        rows_init, updated_state = run_initialization_hook(project_path, df, state)
        state = updated_state
        if run_init or df.empty:
            df = pd.DataFrame(rows_init)
    except Exception as e:
        logger.error(f"Failed to execute initialize hook on open: {e}")
        
    save_state(project_path, state)

        
    # 3. Add reserved columns if not present
    for col, dtype in RESERVED_COLUMNS.items():
        if col not in df.columns:
            if col == "_zx_row_id":
                df[col] = range(len(df))
            elif col == "_zx_status":
                df[col] = "pending"
            elif col == "_zx_iteration":
                df[col] = 0
            elif col == "_zx_hook_stage":
                df[col] = ""
            else:
                df[col] = ""
                
    # Cast row_id and status types
    df["_zx_row_id"] = df["_zx_row_id"].astype(int)
    df["_zx_iteration"] = df["_zx_iteration"].astype(int)
    df["_zx_status"] = df["_zx_status"].astype(str)
    
    # Save the initialized DB
    save_database(project_path, df)
    return df
