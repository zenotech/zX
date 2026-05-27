INITIALIZE_TEMPLATE = """import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    \"\"\"
    Initialization Hook (Optional)
    -----------------------------
    Populates the initial input parameters and/or transforms an existing CSV.
    
    Parameters:
      - table: DataFrame containing existing CSV data (empty if no CSV provided).
      - state: dictionary containing shared global state variables.
      
    Returns:
      - rows: list of input parameter dicts (one dict per row).
      - state: updated shared global state dict passed to all subsequent hooks.
    \"\"\"
    if table.empty:
        rows = [
            {"x1": 0.5, "x2": -1.0},
            {"x1": -0.5, "x2": 1.0},
            {"x1": 1.5, "x2": 0.0}
        ]
    else:
        rows = table.to_dict(orient="records")
        
    state["max_iterations"] = state.get("max_iterations", 5)
    state["current_iteration"] = 0
    
    return rows, state
"""

PREPROCESS_TEMPLATE = """from pathlib import Path

def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    \"\"\"
    Pre-processing Hook
    -------------------
    Takes a row of input parameters and converts them into configuration files,
    input decks, or arguments required by the CLI application.
    Runs inside the newly created unique `run_{row_id}/` directory.
    \"\"\"
    import csv
    input_file = run_dir / "input.csv"
    with open(input_file, mode="w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(row.keys())
        writer.writerow(row.values())
"""

LAUNCH_TEMPLATE = """import subprocess
from pathlib import Path
import re

def launch(row: dict, state: dict, run_dir: Path) -> dict:
    \"\"\"
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
    \"\"\"
    # Example: Check if Slurm execution is requested (configurable in state or row)
    use_slurm = state.get("use_slurm", False) or row.get("use_slurm", False)
    
    if use_slurm:
        # For Slurm scheduler tasks:
        # The hook author defines the sbatch submission command and optional script.
        # Ensure that sbatch is the command used to submit the job.
        
        # Example submission script generated inline or existing in the repository
        # cmd = ["sbatch", "submit.sh"]
        
        # In this template example, we run sbatch (which serves as a clear blueprint for the hook author)
        cmd = ["sbatch", "--job-name=zx_job", "--wrap", "python3 -c \\"print('Slurm App Running')\\""]
        
        result = subprocess.run(
            cmd,
            cwd=run_dir,
            capture_output=True,
            text=True,
            check=True
        )
        
        # Parse Slurm job ID from stdout (e.g., "Submitted batch job 12345")
        job_id = ""
        match = re.search(r"Submitted batch job (\\\\d+)", result.stdout)
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
"""

EXTRACT_TEMPLATE = """from pathlib import Path

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    \"\"\"
    Extraction Hook
    ---------------
    Runs after the CLI application finishes. Parses the application's output,
    extracts parameters of interest, and returns them as a dictionary.
    \"\"\"
    import csv
    output_file = run_dir / "output.csv"
    results = {}
    if output_file.exists():
        with open(output_file, mode="r") as f:
            reader = csv.DictReader(f)
            for r in reader:
                results.update(r)
    else:
        results = {"f_value": 0.0}
        
    return results
"""

EXPLORE_TEMPLATE = """import pandas as pd
from pandas import DataFrame

def explore(table: DataFrame, state: dict) -> list[dict]:
    \"\"\"
    Exploration Hook (Optional)
    --------------------------
    Called after all selected rows have completed their extraction phase.
    Runs inside the project root directory.
    \"\"\"
    max_iter = state.get("max_iterations", 5)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        return []
        
    state["current_iteration"] = current_iter + 1
    
    import random
    new_rows = [
        {
            "x1": round(random.uniform(-2.0, 2.0), 3),
            "x2": round(random.uniform(-2.0, 2.0), 3)
        }
    ]
    return new_rows
"""

PLOT_TEMPLATE = """import pandas as pd
from pandas import DataFrame

def plot(table: DataFrame, state: dict) -> dict:
    \"\"\"
    Visualization Hook (Optional)
    -----------------------------
    Generates custom Plotly figures for display on the dashboard.
    \"\"\"
    x_col = "x1" if "x1" in table.columns else (table.columns[0] if len(table.columns) > 0 else "")
    y_col = "f_value" if "f_value" in table.columns else (table.columns[1] if len(table.columns) > 1 else "")
    
    if not x_col or not y_col:
        return {}
        
    scatter_fig = {
        "data": [
            {
                "x": table[x_col].tolist(),
                "y": table[y_col].tolist(),
                "mode": "markers",
                "type": "scatter",
                "marker": {
                    "color": "#9b5de5",
                    "size": 12,
                    "line": {"color": "#ffffff", "width": 1}
                },
                "name": "Exploration Runs"
            }
        ],
        "layout": {
            "title": {"text": f"Custom Optimization: {y_col} vs {x_col}", "font": {"color": "#ffffff"}},
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
            "xaxis": {"title": {"text": x_col, "font": {"color": "#a0aab2"}}, "tickfont": {"color": "#a0aab2"}},
            "yaxis": {"title": {"text": y_col, "font": {"color": "#a0aab2"}}, "tickfont": {"color": "#a0aab2"}},
            "margin": {"l": 50, "r": 50, "t": 50, "b": 50}
        }
    }
    
    return {
        "custom_scatter": scatter_fig
    }
"""

TEMPLATES_MAP = {
    "initialize.py": INITIALIZE_TEMPLATE,
    "preprocess.py": PREPROCESS_TEMPLATE,
    "launch.py": LAUNCH_TEMPLATE,
    "extract.py": EXTRACT_TEMPLATE,
    "explore.py": EXPLORE_TEMPLATE,
    "plot.py": PLOT_TEMPLATE,
}
