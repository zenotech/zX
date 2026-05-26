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

from zx_backend.templates import TEMPLATES_MAP
from zx_backend.database import (
    load_database, save_database, initialize_project_database, get_csv_path
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
                shutil.copytree(str(template_src), path, dirs_exist_ok=True)
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
                        
        # Check and install optional requirements.txt in hooks directory if it exists
        hooks_dir = os.path.join(path, "hooks")
        hooks_req_file = os.path.join(hooks_dir, "requirements.txt")
        if os.path.exists(hooks_req_file):
            logger.info(f"Found requirements.txt in hooks directory: {hooks_req_file}")
            installed_successfully = False
            uv_path = shutil.which("uv")
            if uv_path:
                try:
                    logger.info("Attempting to install requirements using uv...")
                    cmd = [uv_path, "pip", "install", "-r", hooks_req_file, "--python", sys.executable]
                    import subprocess
                    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                    logger.info("Successfully installed requirements using uv.")
                    logger.info(result.stdout)
                    installed_successfully = True
                except subprocess.CalledProcessError as e:
                    logger.warning(f"Failed to install requirements using uv: {e.stderr or e.stdout or str(e)}. Falling back to standard pip...")
            
            if not installed_successfully:
                try:
                    logger.info("Installing requirements using standard pip...")
                    cmd = [sys.executable, "-m", "pip", "install", "-r", hooks_req_file]
                    import subprocess
                    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                    logger.info("Successfully installed requirements using pip.")
                    logger.info(result.stdout)
                except subprocess.CalledProcessError as e:
                    logger.error(f"Failed to install requirements using standard pip: {e.stderr or e.stdout or str(e)}")
                    
        try:
            initialize_project_database(path)
        except Exception as e:
            logger.error(f"Failed database initialization on open: {e}")
            
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
        "recent_projects": recent_projects
    }

@app.get("/api/project/recent")
async def get_recent_projects():
    return {"recent_projects": recent_projects}

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
        
    from zx_backend.database import run_initialization_hook, load_database
    df = load_database(active_project_path)
    state = {"max_iterations": 5, "current_iteration": 0}
    try:
        _, state = run_initialization_hook(active_project_path, df, state)
    except Exception as e:
        logger.error(f"Failed to execute initialize hook for start: {e}")
        
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
        from zx_backend.database import load_hook_module, load_database, run_initialization_hook
        hook_path = Path(active_project_path) / "hooks" / "plot.py"
        plot_mod = load_hook_module(hook_path, "plot_hook")
        if not plot_mod or not hasattr(plot_mod, "plot"):
            return {}
        
        df = load_database(active_project_path)
        state = {"max_iterations": 5, "current_iteration": 0}
        try:
            _, state = run_initialization_hook(active_project_path, df, state)
        except Exception as e:
            logger.error(f"Failed to execute initialize hook for plot: {e}")
            
        if not df.empty and "_zx_iteration" in df.columns:
            state["current_iteration"] = int(df["_zx_iteration"].max())
            
        figures = plot_mod.plot(df, state)
        if not isinstance(figures, dict):
            raise TypeError("Plot hook must return a dict of Plotly figures")
        return figures
    except Exception as e:
        logger.error(f"Failed running plot hook: {e}")
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
