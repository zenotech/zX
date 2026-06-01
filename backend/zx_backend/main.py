import os
import sys
import logging
import asyncio
import ast
import shutil
import pandas as pd
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request, HTTPException, status, WebSocket, WebSocketDisconnect, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
import threading
from datetime import datetime

from zx_backend.templates import TEMPLATES_MAP
from zx_backend.database import (
    load_database, save_database, initialize_project_database, get_csv_path,
    load_state, save_state, run_state_hook
)
from zx_backend.runner import run_loop_in_thread, runner_state

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zX_backend")

app = FastAPI(title="zX Backend Orchestrator")

AUTH_TOKEN = os.environ.get("ZX_AUTH_TOKEN", "")
logger.info(f"Auth token verification configured: {'enabled' if AUTH_TOKEN else 'disabled (empty)'}")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager for active status
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

status_manager = ConnectionManager()

main_loop: Optional[asyncio.AbstractEventLoop] = None

@app.on_event("startup")
async def startup_event():
    global main_loop
    main_loop = asyncio.get_running_loop()
    logger.info("Main event loop captured for thread-safe WebSocket status broadcasting.")

# Assign WebSocket broadcast sync bridge for thread runner
def sync_broadcast_ws(message: dict):
    global main_loop
    try:
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                status_manager.broadcast(message),
                main_loop
            )
        else:
            # Fallback for when loop is not captured yet or not running
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(status_manager.broadcast(message))
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Failed to forward status broadcast: {e}")

runner_state.broadcast_callback = sync_broadcast_ws

# Authentication Middleware for REST API
@app.middleware("http")
async def verify_token_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    if request.url.path.startswith("/api"):
        if request.url.path == "/api/health":
            return await call_next(request)
            
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Unauthorized: Missing Bearer token"}
            )
        
        token = auth_header.split(" ")[1]
        if token != AUTH_TOKEN:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Unauthorized: Invalid token"}
            )
            
    return await call_next(request)

# Health Check
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "zX FastAPI backend is running"}

# State variables for active project
active_project_path: Optional[str] = None
recent_projects: List[str] = []

def get_projects_dir() -> Path:
    # 0. Environment variable override (e.g. set by Electron app)
    env_path = os.environ.get("ZX_PROJECTS_DIR")
    if env_path:
        try_path = Path(env_path)
        if try_path.exists() and try_path.is_dir():
            return try_path

    # 1. Dev repo root: backend/zx_backend/main.py -> ../../projects
    try_path = Path(__file__).resolve().parent.parent.parent / "projects"
    if try_path.exists() and try_path.is_dir():
        return try_path
        
    # 2. Package subdirectory: backend/zx_backend/projects
    try_path = Path(__file__).resolve().parent / "projects"
    if try_path.exists() and try_path.is_dir():
        return try_path
        
    # 3. User home directory cache: ~/.zx/projects
    try_path = Path.home() / ".zx" / "projects"
    if try_path.exists() and try_path.is_dir():
        return try_path
        
    # 4. Standard current working directory: ./projects
    try_path = Path.cwd() / "projects"
    if try_path.exists() and try_path.is_dir():
        return try_path
        
    return Path.cwd() / "projects"

class ProjectPathPayload(BaseModel):
    project_path: str
    template_id: Optional[str] = None

@app.get("/api/project/templates")
async def get_project_templates():
    projects_dir = get_projects_dir()
    json_path = projects_dir / "projects.json"
    if not json_path.exists():
        logger.warning(f"templates.json / projects.json not found at {json_path}")
        return []
    try:
        import json
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load templates json: {e}")
        return []

def _install_requirements(req_file: str) -> None:
    if not os.path.exists(req_file):
        return

    logger.info(f"Installing requirements from {req_file}...")
    installed_successfully = False

    # Try finding uv on PATH
    uv_path = shutil.which("uv")
    # Fallback to common ~/.local/bin/uv location (crucial for remote SSH hosts)
    if not uv_path:
        home_uv = os.path.expanduser("~/.local/bin/uv")
        if os.path.exists(home_uv):
            uv_path = home_uv

    if uv_path:
        try:
            logger.info(f"Attempting to install requirements using uv at {uv_path}...")
            cmd = [uv_path, "pip", "install", "-r", req_file, "--python", sys.executable]
            import subprocess
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Successfully installed requirements from {req_file} using uv.")
            if result.stdout:
                logger.info(result.stdout)
            installed_successfully = True
        except subprocess.CalledProcessError as e:
            logger.warning(f"Failed to install requirements using uv: {e.stderr or e.stdout or str(e)}. Falling back to standard pip...")
    
    if not installed_successfully:
        try:
            logger.info(f"Installing requirements using standard pip...")
            cmd = [sys.executable, "-m", "pip", "install", "-r", req_file]
            import subprocess
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Successfully installed requirements from {req_file} using pip.")
            if result.stdout:
                logger.info(result.stdout)
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install requirements using standard pip: {e.stderr or e.stdout or str(e)}")


def robust_copy_tree(src: Path, dst: Path) -> None:
    """
    Recursively copies a directory tree from src to dst.
    - Handles merging with existing directories.
    - Overwrites existing files, making them writeable first if they exist and are read-only.
    - If shutil.copy2 (metadata copy) fails due to filesystem permissions/capabilities,
      falls back to shutil.copy (data only).
    - Preserves symbolic links as links and ignores dangling symlinks.
    - Captures and logs exceptions rather than aborting, ensuring as many files as possible are copied.
    """
    dst.mkdir(parents=True, exist_ok=True)
    for entry in os.scandir(src):
        src_item = Path(entry.path)
        dst_item = dst / entry.name
        
        if entry.is_symlink():
            try:
                # Remove existing destination item if it exists
                if dst_item.exists() or dst_item.is_symlink():
                    if dst_item.is_dir() and not dst_item.is_symlink():
                        shutil.rmtree(dst_item)
                    else:
                        dst_item.unlink()
                
                # Copy symlink
                link_target = os.readlink(src_item)
                os.symlink(link_target, dst_item)
                logger.info(f"Copied symlink {src_item} -> {dst_item}")
            except Exception as e:
                logger.warning(f"Failed to copy symlink {src_item} to {dst_item}: {e}")
        elif entry.is_dir():
            robust_copy_tree(src_item, dst_item)
        else:
            try:
                # If target file exists and is read-only, try to change permissions to writeable
                if dst_item.exists():
                    try:
                        os.chmod(dst_item, 0o666)
                    except Exception:
                        pass
                
                # Attempt to copy file with metadata
                shutil.copy2(str(src_item), str(dst_item))
            except (OSError, PermissionError) as e:
                logger.warning(f"shutil.copy2 failed for {src_item} -> {dst_item} due to: {e}. Retrying with basic copy...")
                try:
                    # Fallback: copy file data and basic permissions only
                    shutil.copy(str(src_item), str(dst_item))
                except Exception as e2:
                    logger.error(f"Failed to copy file {src_item} to {dst_item}: {e2}")
            except Exception as e:
                logger.error(f"Unexpected error copying file {src_item} to {dst_item}: {e}")


@app.post("/api/project/open")
async def open_project(payload: ProjectPathPayload):
    global active_project_path
    path = payload.project_path
    template_id = payload.template_id
    
    # Standardize path
    path = os.path.abspath(os.path.expanduser(path))
    try:
        if not os.path.exists(path):
            os.makedirs(path, exist_ok=True)

            
        active_project_path = path
        
        # Add to recent list
        if path not in recent_projects:
            recent_projects.append(path)
            
        # Deploy template if template_id is specified
        if template_id:
            projects_dir = get_projects_dir()
            template_src = projects_dir / template_id
            if template_src.exists() and template_src.is_dir():
                logger.info(f"Deploying template {template_id} from {template_src} to {path}")
                robust_copy_tree(template_src, Path(path))
            else:
                logger.warning(f"Template directory not found: {template_src}")
        else:
            # Copy default templates if they don't exist
            hooks_dir = os.path.join(path, "hooks")
            os.makedirs(hooks_dir, exist_ok=True)
            
            for name, content in TEMPLATES_MAP.items():
                hook_file = os.path.join(hooks_dir, name)
                if not os.path.exists(hook_file):
                    with open(hook_file, "w") as f:
                        f.write(content)
                        
        # Install packages in requirements.txt (from both the root and hooks directory)
        root_req_file = os.path.join(path, "requirements.txt")
        hooks_dir = os.path.join(path, "hooks")
        hooks_req_file = os.path.join(hooks_dir, "requirements.txt")
        
        if os.path.exists(root_req_file):
            _install_requirements(root_req_file)
        if os.path.exists(hooks_req_file):
            _install_requirements(hooks_req_file)
                    
        # Check for any running Slurm jobs
        completed_slurm_jobs = []
        try:
            initialize_project_database(path)
            from zx_backend.runner import check_slurm_job_status, sanitize_job_id
            df = load_database(path)
            if not df.empty and "_zx_job_id" in df.columns:
                running_rows = df[(df["_zx_status"] == "running") & (df["_zx_job_id"] != "")]
                completed_jobs = []
                failed_jobs = []
                for _, r in running_rows.iterrows():
                    row_id = int(r["_zx_row_id"])
                    job_id = sanitize_job_id(r["_zx_job_id"])
                    if job_id:
                        status_val = check_slurm_job_status(job_id)
                        if status_val == "completed":
                            completed_jobs.append({"row_id": row_id, "job_id": job_id})
                        elif status_val == "failed":
                            failed_jobs.append({"row_id": row_id, "job_id": job_id})
                
                # For failed jobs, mark them as failed in the database
                for job in failed_jobs:
                    idx = df[df["_zx_row_id"] == job["row_id"]].index
                    if not idx.empty:
                        df.loc[idx, "_zx_status"] = "failed"
                        df.loc[idx, "_zx_error"] = f"Slurm Job {job['job_id']} failed on the scheduler."
                        df.loc[idx, "_zx_completed_at"] = datetime.now().isoformat()
                if failed_jobs:
                    save_database(path, df)
                
                completed_slurm_jobs = completed_jobs
        except Exception as e:
            logger.error(f"Failed database initialization or Slurm check on open: {e}")
            
    except OSError as e:
        logger.error(f"Filesystem error opening project at {path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create or access project directory: {e.strerror or str(e)} (path: {path})"
        )
    except Exception as e:
        logger.error(f"Unexpected error opening project at {path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to open or initialize project: {str(e)}"
        )
        
    return {
        "status": "success", 
        "project_path": active_project_path,
        "recent_projects": recent_projects,
        "completed_slurm_jobs": completed_slurm_jobs
    }

@app.get("/api/project/recent")
async def get_recent_projects():
    return {"recent_projects": recent_projects}

class StateUpdatePayload(BaseModel):
    updates: Dict[str, Any]

@app.get("/api/state")
async def get_state_endpoint():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        state = load_state(active_project_path)
        return state
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/state/update")
async def update_state_endpoint(payload: StateUpdatePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        current_state = load_state(active_project_path)
        updated_state = run_state_hook(active_project_path, current_state, payload.updates)
        save_state(active_project_path, updated_state)
        return {"status": "success", "state": updated_state}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Database REST APIs
@app.get("/api/database")
async def get_database_endpoint():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        df = load_database(active_project_path)
        df_clean = df.fillna("")
        return df_clean.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class DatabaseUpdatePayload(BaseModel):
    rows: List[Dict[str, Any]]

@app.post("/api/database/update")
async def update_database_endpoint(payload: DatabaseUpdatePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        df_old = load_database(active_project_path)
        df_new = pd.DataFrame(payload.rows)
        if df_new.empty:
            df_new = pd.DataFrame(columns=df_old.columns)
        else:
            for col in df_old.columns:
                if col not in df_new.columns:
                    df_new[col] = df_old[col]
                    
        # Identify and clean up deleted runs folders
        if not df_old.empty and "_zx_row_id" in df_old.columns:
            old_ids = set(df_old["_zx_row_id"].dropna().astype(int).tolist())
            if not df_new.empty and "_zx_row_id" in df_new.columns:
                new_ids = set(df_new["_zx_row_id"].dropna().astype(int).tolist())
            else:
                new_ids = set()
            deleted_ids = old_ids - new_ids
            for row_id in deleted_ids:
                run_dir = os.path.join(active_project_path, "runs", f"run_{row_id}")
                if os.path.exists(run_dir):
                    try:
                        shutil.rmtree(run_dir)
                        logger.info(f"Successfully cleaned up run directory for deleted row {row_id}: {run_dir}")
                    except Exception as err:
                        logger.error(f"Failed to delete run directory {run_dir}: {err}")
                        
        save_database(active_project_path, df_new)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/database/initialize")
async def initialize_database_endpoint():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        df = initialize_project_database(active_project_path, run_init=True)
        return df.fillna("").to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/database/import")
async def import_database_endpoint(file: UploadFile = File(...)):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        temp_csv = os.path.join(active_project_path, "uploaded_import_temp.csv")
        with open(temp_csv, "wb") as f:
            f.write(await file.read())
        df = initialize_project_database(active_project_path, initial_csv_path=temp_csv)
        os.remove(temp_csv)
        return df.fillna("").to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Monaco Hook Editor & AST Syntax Checking API
class HookSavePayload(BaseModel):
    name: str
    content: str

@app.post("/api/hooks/save")
async def save_hook_endpoint(payload: HookSavePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        hook_path = os.path.join(active_project_path, "hooks", payload.name)
        with open(hook_path, "w") as f:
            f.write(payload.content)
            
        # Parse syntax via Python AST
        try:
            ast.parse(payload.content)
            return {"status": "success", "valid": True}
        except SyntaxError as se:
            return {
                "status": "success",
                "valid": False,
                "error": {
                    "line": se.lineno,
                    "offset": se.offset,
                    "message": se.msg
                }
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/hooks/load/{name}")
async def load_hook_endpoint(name: str):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    hook_path = os.path.join(active_project_path, "hooks", name)
    if not os.path.exists(hook_path):
        raise HTTPException(status_code=404, detail="Hook not found")
    try:
        with open(hook_path, "r") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# AI Hook Generation API
class AIGeneratePayload(BaseModel):
    hook_name: str
    prompt: Optional[str] = None
    code: str
    mode: str  # 'generate' or 'autocomplete'
    cursor_line: Optional[int] = None
    cursor_column: Optional[int] = None

@app.post("/api/hooks/ai/generate")
def ai_generate_hook_endpoint(payload: AIGeneratePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
        
    try:
        state = load_state(active_project_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed loading state: {str(e)}")
        
    api_key = state.get("GEMINI_API_KEY")
    if not api_key:
        api_key = os.environ.get("GEMINI_API_KEY")
        
    if not api_key:
        raise HTTPException(
            status_code=400, 
            detail="GEMINI_API_KEY is not configured. Please specify it in the Shared State."
        )

    import urllib.request
    import json
    
    if payload.mode == "autocomplete":
        system_instruction = (
            "You are an expert Python autocomplete assistant. Act as a strict Python developer and code assistant "
            "for the zX parametric exploration framework.\n"
            "Predict the logical continuation or completion of the Python code provided.\n"
            "CRITICAL: Return ONLY raw, valid Python code that immediately follows the provided prefix. "
            "Do NOT repeat the prefix code, and do NOT include any introductory or explanatory text. "
            "Do NOT wrap the response in markdown code blocks (like ```python or ```). Start returning the completion immediately."
        )
        
        lines = payload.code.splitlines()
        prefix = payload.code
        suffix = ""
        
        if payload.cursor_line is not None and payload.cursor_column is not None:
            line_idx = payload.cursor_line - 1
            col_idx = payload.cursor_column - 1
            
            if 0 <= line_idx < len(lines):
                prefix_lines = lines[:line_idx]
                curr_line = lines[line_idx]
                
                curr_prefix = curr_line[:col_idx]
                curr_suffix = curr_line[col_idx:]
                
                prefix = "\n".join(prefix_lines + [curr_prefix])
                suffix = "\n".join([curr_suffix] + lines[line_idx+1:])
        
        prompt = (
            f"We are editing the Python hook file '{payload.hook_name}'.\n"
            f"Here is the code prefix up to the cursor:\n"
            f"---CODE_PREFIX---\n"
            f"{prefix}\n"
            f"---END_CODE_PREFIX---\n"
        )
        if suffix.strip():
            prompt += (
                f"Here is the code suffix after the cursor:\n"
                f"---CODE_SUFFIX---\n"
                f"{suffix}\n"
                f"---END_CODE_SUFFIX---\n"
            )
        prompt += (
            "\nPlease generate the next few lines or logical completion of this code "
            "starting exactly at the cursor position. Return ONLY the continuation code."
        )
    else:
        system_instruction = (
            "You are an expert Python developer and code assistant for the zX simulation exploration framework.\n"
            "Generate clean, valid, and fully-formed Python code based on the user request.\n"
            "CRITICAL: Return ONLY raw, valid Python code. Do NOT wrap the code in markdown code blocks "
            "(like ```python or ```), and do NOT include any conversational filler, introductory, or explanatory text. "
            "Return only the executable python code."
        )
        
        prompt = (
            f"We are working on the hook file '{payload.hook_name}'.\n"
            f"Here is the current content of the file:\n"
            f"---CURRENT_CODE---\n"
            f"{payload.code}\n"
            f"---END_CURRENT_CODE---\n\n"
            f"The user has requested the following task:\n"
            f"{payload.prompt}\n\n"
            f"Please generate the complete code or the specific function modification to satisfy the user request. "
            f"Return ONLY valid Python code."
        )

    # Use gemini-2.5-flash as the state-of-the-art developer model
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    api_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1536
        }
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(api_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res_text = response.read().decode("utf-8")
        res_data = json.loads(res_text)
        
        candidates = res_data.get("candidates", [])
        generated_text = ""
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                generated_text = parts[0].get("text", "")
                
        cleaned_text = generated_text.strip()
        if cleaned_text.startswith("```python"):
            cleaned_text = cleaned_text[len("```python"):].strip()
        elif cleaned_text.startswith("```"):
            cleaned_text = cleaned_text[3:].strip()
        if cleaned_text.endswith("```"):
            cleaned_text = cleaned_text[:-3].strip()
            
        return {"status": "success", "generated_code": cleaned_text}
        
    except Exception as e:
        logger.error(f"Gemini API call failed: {e}")
        err_msg = str(e)
        if hasattr(e, "read"):
            try:
                err_body = e.read().decode("utf-8")
                err_json = json.loads(err_body)
                err_msg = err_json.get("error", {}).get("message", err_msg)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Gemini API Error: {err_msg}")

# Runner Controllers
class RunStartPayload(BaseModel):
    row_ids: List[int]
    hooks: List[str]
    dry_run: bool = False
    force: bool = False

@app.post("/api/run/start")
async def run_start_endpoint(payload: RunStartPayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    if runner_state.running:
        raise HTTPException(status_code=400, detail="Parametric loop is already active")
        
    from zx_backend.database import load_state, load_database
    df = load_database(active_project_path)
    state = load_state(active_project_path)
    if not df.empty and "_zx_iteration" in df.columns:
        state["current_iteration"] = int(df["_zx_iteration"].max())
    
    # Spawn sequential runner in a background worker thread
    t = threading.Thread(
        target=run_loop_in_thread,
        args=(
            active_project_path,
            payload.row_ids,
            payload.hooks,
            payload.dry_run,
            payload.force,
            state
        ),
        daemon=True
    )
    t.start()
    return {"status": "success", "message": "Sequential loop triggered"}

@app.post("/api/run/stop")
async def run_stop_endpoint():
    if not runner_state.running:
        return {"status": "ignored", "message": "Loop not running"}
    runner_state.stop_requested = True
    return {"status": "success", "message": "Stop loop request issued"}

@app.get("/api/run/status")
async def run_status_endpoint():
    return {
        "running": runner_state.running,
        "hook_stage": runner_state.hook_stage,
        "active_row": runner_state.active_row
    }

@app.get("/api/run/log/{row_id}", response_class=PlainTextResponse)
async def get_run_log_endpoint(row_id: int):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    log_path = os.path.join(active_project_path, "runs", f"run_{row_id}", "zx_hook.log")
    if not os.path.exists(log_path):
        return f"Log file for run_{row_id} does not exist yet."
    try:
        with open(log_path, "r") as f:
            return f.read()
    except Exception as e:
        return f"Failed loading log: {str(e)}"

@app.get("/api/run/explore-log/{iteration}", response_class=PlainTextResponse)
async def get_explore_log_endpoint(iteration: int):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    log_path = os.path.join(active_project_path, "runs", f"explore_{iteration}.log")
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail=f"Explore log for iteration {iteration} does not exist.")
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as e:
        return f"Failed loading explore log: {str(e)}"

# WebSockets Endpoint
@app.websocket("/ws/status")
async def websocket_status(websocket: WebSocket, token: str = Query(...)):
    if token != AUTH_TOKEN:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
        
    await status_manager.connect(websocket)
    logger.info("WebSocket status connection accepted")
    try:
        await websocket.send_json({
            "type": "connection_status",
            "connected": True,
            "project_path": active_project_path
        })
        # Send active status instantly on connect
        await websocket.send_json({
            "type": "runner_status",
            "running": runner_state.running,
            "hook_stage": runner_state.hook_stage,
            "active_row": runner_state.active_row
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        status_manager.disconnect(websocket)
        logger.info("WebSocket status connection disconnected")

# --- File Explorer Helper ---
def get_dir_tree(base_path: str, current_path: str) -> List[Dict[str, Any]]:
    items = []
    try:
        for entry in os.scandir(current_path):
            if entry.name in (".git", "__pycache__", ".lock") or entry.name.endswith(".lock"):
                continue
            rel_path = os.path.relpath(entry.path, base_path)
            if entry.is_dir():
                items.append({
                    "name": entry.name,
                    "path": rel_path,
                    "isDir": True,
                    "children": get_dir_tree(base_path, entry.path)
                })
            else:
                items.append({
                    "name": entry.name,
                    "path": rel_path,
                    "isDir": False,
                    "size": entry.stat().st_size
                })
    except Exception:
        pass
    items.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
    return items

# --- Extra Explorer APIs ---
@app.get("/api/explorer/browse")
async def browse_directories(path: Optional[str] = Query(None)):
    if not path or not path.strip():
        path = os.path.expanduser("~")
    
    path = os.path.abspath(path)
    
    if not os.path.exists(path):
        path = os.path.expanduser("~")
        path = os.path.abspath(path)
        if not os.path.exists(path):
            path = "/"
            
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail="Path is not a directory")
        
    subdirs = []
    try:
        for entry in os.scandir(path):
            try:
                if entry.is_dir():
                    if entry.name in (".git", "__pycache__", ".vscode", ".idea") or entry.name.startswith("."):
                        continue
                    subdirs.append(entry.name)
            except Exception:
                pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read directory: {str(e)}")
        
    subdirs.sort(key=lambda x: x.lower())
    
    parent = os.path.dirname(path)
    if parent == path:
        parent = None
        
    return {
        "current_path": path,
        "parent_path": parent,
        "directories": subdirs
    }

@app.get("/api/explorer/tree")
async def get_explorer_tree():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    return get_dir_tree(active_project_path, active_project_path)

@app.get("/api/explorer/read")
async def read_explorer_file(path: str):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    abs_path = os.path.join(active_project_path, path)
    if not os.path.exists(abs_path) or os.path.isdir(abs_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    # Check if the file is an image (PNG, JPG, JPEG, GIF, WEBP, SVG)
    ext = os.path.splitext(abs_path)[1].lower()
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
        try:
            import base64
            mime_types = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".svg": "image/svg+xml"
            }
            mime = mime_types.get(ext, "image/png")
            with open(abs_path, "rb") as f:
                img_data = f.read()
            base64_str = base64.b64encode(img_data).decode("utf-8")
            return {"content": f"data:{mime};base64,{base64_str}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read image file: {str(e)}")

    if ext == ".pdf":
        try:
            import base64
            with open(abs_path, "rb") as f:
                pdf_data = f.read()
            base64_str = base64.b64encode(pdf_data).decode("utf-8")
            return {"content": f"data:application/pdf;base64,{base64_str}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read PDF file: {str(e)}")

    if ext == ".mp4":
        try:
            import base64
            with open(abs_path, "rb") as f:
                video_data = f.read()
            base64_str = base64.b64encode(video_data).decode("utf-8")
            return {"content": f"data:video/mp4;base64,{base64_str}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read video file: {str(e)}")

    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RenamePayload(BaseModel):
    old_path: str
    new_path: str

@app.post("/api/explorer/rename")
async def rename_explorer_item(payload: RenamePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    abs_old = os.path.join(active_project_path, payload.old_path)
    abs_new = os.path.join(active_project_path, payload.new_path)
    if not os.path.exists(abs_old):
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        os.makedirs(os.path.dirname(abs_new), exist_ok=True)
        os.rename(abs_old, abs_new)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class DeletePayload(BaseModel):
    path: str

@app.post("/api/explorer/delete")
async def delete_explorer_item(payload: DeletePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    abs_path = os.path.join(active_project_path, payload.path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        if os.path.isdir(abs_path):
            shutil.rmtree(abs_path)
        else:
            os.remove(abs_path)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Custom Visualization Hook Endpoint ---
@app.get("/api/visualize/custom")
async def get_custom_visualizations():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    try:
        from zx_backend.database import load_hook_module, load_database, load_state
        hook_path = Path(active_project_path) / "hooks" / "plot.py"
        plot_mod = load_hook_module(hook_path, "plot_hook")
        if not plot_mod or not hasattr(plot_mod, "plot"):
            return {}
        
        df = load_database(active_project_path)
        state = load_state(active_project_path)
        if not df.empty and "_zx_iteration" in df.columns:
            state["current_iteration"] = int(df["_zx_iteration"].max())
            
        figures = plot_mod.plot(df, state)
        if not isinstance(figures, dict):
            raise TypeError("Plot hook must return a dict of Plotly figures")
        return figures
    except Exception as e:
        logger.error(f"Failed running plot hook: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Git Backup APIs ---
import subprocess

class GitCommitPayload(BaseModel):
    files: List[str]
    message: str

class GitRestorePayload(BaseModel):
    commit_hash: str

def check_git_init(project_path: str) -> bool:
    git_dir = os.path.join(project_path, ".git")
    return os.path.exists(git_dir) and os.path.isdir(git_dir)

def setup_local_git_config(project_path: str):
    # Configure user name and email locally so commits do not fail if git isn't configured globally
    subprocess.run(["git", "config", "local", "user.name", "zX Backup Service"], cwd=project_path, capture_output=True)
    subprocess.run(["git", "config", "local", "user.email", "backup@zx.internal"], cwd=project_path, capture_output=True)

@app.get("/api/git/status")
async def git_status():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    initialized = check_git_init(active_project_path)
    if not initialized:
        return {"initialized": False, "files": [], "has_gitignore": False}
    
    # Check if .gitignore exists
    gitignore_path = os.path.join(active_project_path, ".gitignore")
    has_gitignore = os.path.exists(gitignore_path)
    
    # Run git status --porcelain
    try:
        # Also ensure local config is done
        setup_local_git_config(active_project_path)
        
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=active_project_path,
            capture_output=True,
            text=True,
            check=True
        )
        
        files = []
        for line in result.stdout.splitlines():
            if len(line) < 4:
                continue
            status_code = line[:2].strip()
            filepath = line[3:]
            # Clean quotes if any (git porcelain might quote filenames with special characters)
            if filepath.startswith('"') and filepath.endswith('"'):
                filepath = filepath[1:-1]
            files.append({
                "path": filepath,
                "status": status_code
            })
            
        return {
            "initialized": True,
            "files": files,
            "has_gitignore": has_gitignore
        }
    except subprocess.CalledProcessError as e:
        logger.error(f"Git status error: {e.stderr or e.stdout}")
        raise HTTPException(status_code=500, detail=f"Git status error: {e.stderr or str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/git/init")
async def git_init():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    try:
        # Run git init
        subprocess.run(
            ["git", "init"],
            cwd=active_project_path,
            capture_output=True,
            text=True,
            check=True
        )
        
        # Configure local git user info
        setup_local_git_config(active_project_path)
        
        # Write default .gitignore if it doesn't exist
        gitignore_path = os.path.join(active_project_path, ".gitignore")
        if not os.path.exists(gitignore_path):
            default_content = (
                "# zX Simulation Workspace Gitignore\n"
                "# Ignore heavy simulation runs data\n"
                "runs/\n"
                "\n"
                "# Ignore virtual environments\n"
                ".venv/\n"
                "venv/\n"
                "env/\n"
                "\n"
                "# Ignore OS files\n"
                ".DS_Store\n"
                "Thumbs.db\n"
                "\n"
                "# Ignore Python caches and build files\n"
                "__pycache__/\n"
                "*.pyc\n"
                "*.pyo\n"
                "*.pyd\n"
                ".pytest_cache/\n"
                "*.egg-info/\n"
                "dist/\n"
                "build/\n"
                "\n"
                "# Ignore frontend dependencies\n"
                "node_modules/\n"
                "\n"
                "# Ignore local logs and locks\n"
                "*.log\n"
                "*.lock\n"
            )
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write(default_content)
                
        # Stage .gitignore and other files (like db, state, hooks) for initial commit if any exist
        subprocess.run(["git", "add", ".gitignore"], cwd=active_project_path, capture_output=True)
        
        # Initial commit
        subprocess.run(
            ["git", "commit", "-m", "Initial backup setup"],
            cwd=active_project_path,
            capture_output=True,
            text=True
        )
        
        return {"status": "success", "message": "Git workspace backup initialized successfully"}
    except subprocess.CalledProcessError as e:
        logger.error(f"Git init error: {e.stderr or e.stdout}")
        raise HTTPException(status_code=500, detail=f"Git init error: {e.stderr or str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/git/gitignore")
async def git_get_gitignore():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    gitignore_path = os.path.join(active_project_path, ".gitignore")
    if not os.path.exists(gitignore_path):
        return {"content": ""}
        
    try:
        with open(gitignore_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class GitignorePayload(BaseModel):
    content: str

@app.post("/api/git/gitignore")
async def git_save_gitignore(payload: GitignorePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    gitignore_path = os.path.join(active_project_path, ".gitignore")
    try:
        with open(gitignore_path, "w", encoding="utf-8") as f:
            f.write(payload.content)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/git/commit")
async def git_commit(payload: GitCommitPayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    if not check_git_init(active_project_path):
        raise HTTPException(status_code=400, detail="Git is not initialized in this project")
        
    if not payload.files:
        raise HTTPException(status_code=400, detail="No files selected for backup")
        
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Backup description cannot be empty")
        
    try:
        # Ensure config is set
        setup_local_git_config(active_project_path)
        
        # Stage chosen files
        for filepath in payload.files:
            subprocess.run(
                ["git", "add", filepath],
                cwd=active_project_path,
                capture_output=True,
                text=True,
                check=True
            )
        
        # Commit changes
        result = subprocess.run(
            ["git", "commit", "-m", payload.message],
            cwd=active_project_path,
            capture_output=True,
            text=True,
            check=True
        )
        
        return {"status": "success", "output": result.stdout}
    except subprocess.CalledProcessError as e:
        logger.error(f"Git commit error: {e.stderr or e.stdout}")
        raise HTTPException(status_code=500, detail=f"Git commit error: {e.stderr or str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/git/log")
async def git_log():
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    if not check_git_init(active_project_path):
        return {"backups": []}
        
    try:
        # Format git log output as: hash|date|description
        result = subprocess.run(
            ["git", "log", "--pretty=format:%H|%ad|%s", "--date=iso"],
            cwd=active_project_path,
            capture_output=True,
            text=True
        )
        
        backups = []
        if result.stdout.strip():
            for line in result.stdout.splitlines():
                parts = line.split("|", 2)
                if len(parts) == 3:
                    backups.append({
                        "hash": parts[0],
                        "date": parts[1],
                        "description": parts[2]
                    })
        return {"backups": backups}
    except Exception as e:
        logger.error(f"Git log error: {str(e)}")
        return {"backups": []}

@app.post("/api/git/restore")
async def git_restore(payload: GitRestorePayload):
    if not active_project_path:
        raise HTTPException(status_code=400, detail="No active project opened")
    
    if not check_git_init(active_project_path):
        raise HTTPException(status_code=400, detail="Git is not initialized in this project")
        
    if not payload.commit_hash.strip():
        raise HTTPException(status_code=400, detail="Commit hash cannot be empty")
        
    try:
        # Revert changes using git reset --hard
        subprocess.run(
            ["git", "reset", "--hard", payload.commit_hash],
            cwd=active_project_path,
            capture_output=True,
            text=True,
            check=True
        )
        
        # After reset, we must reload/reinitialize database files
        initialize_project_database(active_project_path, run_init=False)
        
        return {"status": "success", "message": f"Successfully restored workspace to backup {payload.commit_hash[:8]}"}
    except subprocess.CalledProcessError as e:
        logger.error(f"Git restore error: {e.stderr or e.stdout}")
        raise HTTPException(status_code=500, detail=f"Git restore error: {e.stderr or str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- WebSocket Terminal Endpoint ---
@app.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket, token: str = Query(...)):
    if token != AUTH_TOKEN:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
        
    await websocket.accept()
    
    from zx_backend.terminal_session import TerminalSession
    session = TerminalSession(websocket)
    session.start()
    
    try:
        while True:
            msg_str = await websocket.receive_text()
            try:
                import json
                msg = json.loads(msg_str)
                if msg.get("type") == "input":
                    session.write_to_pty(msg.get("data", ""))
                elif msg.get("type") == "resize":
                    session.resize(msg.get("rows", 24), msg.get("cols", 80))
            except json.JSONDecodeError:
                session.write_to_pty(msg_str)
    except WebSocketDisconnect:
        pass
    finally:
        session.close()
