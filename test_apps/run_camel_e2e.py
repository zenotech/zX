import os
import sys
import shutil
import tempfile
import pandas as pd
from pathlib import Path

# Add backend directory to Python path
sys.path.append(str(Path(__file__).resolve().parents[1] / "backend"))

from zx_backend.database import initialize_project_database, load_database
from zx_backend.runner import run_loop_in_thread, runner_state

# Define hooks for Camel Case
camel_initialize = """import numpy as np
import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    if table.empty:
        # Fixed 5 initial points for reproducibility
        rows = [
            {"x1": -1.0, "x2": -1.0},
            {"x1": -0.5, "x2": 0.5},
            {"x1": 0.0, "x2": 0.0},
            {"x1": 0.5, "x2": -0.5},
            {"x1": 1.0, "x2": 1.0}
        ]
    else:
        rows = table.to_dict(orient="records")
        
    state["max_iterations"] = 5
    state["current_iteration"] = 0
    return rows, state
"""

camel_preprocess = """from pathlib import Path
import csv

def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    input_file = run_dir / "input.csv"
    with open(input_file, mode="w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["x1", "x2"])
        writer.writerow([row["x1"], row["x2"]])
"""

camel_launch = """import subprocess
from pathlib import Path
import sys
import re

def launch(row: dict, state: dict, run_dir: Path) -> dict:
    script_path = "/Users/jamil.appa/Documents/zX/test_apps/six_hump_camel.py"
    
    use_slurm = state.get("use_slurm", False) or row.get("use_slurm", False)
    
    if use_slurm:
        cmd = ["sbatch", "--job-name=six_hump_camel", "--wrap", f"{sys.executable} {script_path}"]
        result = subprocess.run(
            cmd,
            cwd=run_dir,
            capture_output=True,
            text=True,
            check=True
        )
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
        cmd = [sys.executable, script_path]
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

camel_extract = """from pathlib import Path
import csv

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    output_file = run_dir / "output.csv"
    results = {}
    if output_file.exists():
        with open(output_file, mode="r") as f:
            reader = csv.DictReader(f)
            for r in reader:
                results.update(r)
    else:
        results = {"f_value": 999.0}
        
    if "f_value" in results:
        results["f_value"] = float(results["f_value"])
    return results
"""

camel_explore = """import numpy as np
import pandas as pd
from pandas import DataFrame
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern

def explore(table: DataFrame, state: dict) -> list[dict]:
    max_iter = state.get("max_iterations", 5)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        print(f"Reached max iterations limit ({max_iter}). Terminating.")
        return []
        
    state["current_iteration"] = current_iter + 1
    
    # Filter completed records
    completed = table[table["_zx_status"] == "completed"].copy()
    if len(completed) < 3:
        return [{"x1": round(np.random.uniform(-2, 2), 4), "x2": round(np.random.uniform(-2, 2), 4)}]
        
    X = completed[["x1", "x2"]].values
    y = completed["f_value"].astype(float).values
    
    # Fit surrogate
    gp = GaussianProcessRegressor(
        kernel=Matern(nu=2.5),
        alpha=1e-6,
        normalize_y=True,
        random_state=42
    )
    gp.fit(X, y)
    
    # Propose point
    rng = np.random.default_rng(seed=42 + current_iter)
    candidates = rng.uniform(-2.0, 2.0, size=(500, 2))
    mean = gp.predict(candidates)
    
    best_idx = np.argmin(mean)
    next_x = candidates[best_idx]
    
    # Deduplicate
    min_dist = np.min(np.linalg.norm(X - next_x, axis=1))
    if min_dist < 1e-2:
        next_x += rng.normal(0, 0.1, size=2)
        next_x = np.clip(next_x, -2.0, 2.0)
        
    next_x1 = round(float(next_x[0]), 4)
    next_x2 = round(float(next_x[1]), 4)
    
    print(f"GP Exploration Iteration {current_iter}: Proposed point x1={next_x1}, x2={next_x2}")
    return [{"x1": next_x1, "x2": next_x2}]
"""

camel_plot = """import pandas as pd
from pandas import DataFrame
import numpy as np

def plot(table: DataFrame, state: dict) -> dict:
    # 1. Define the grid domain
    x1_grid = np.linspace(-3, 3, 100)
    x2_grid = np.linspace(-2, 2, 100)
    X1, X2 = np.meshgrid(x1_grid, x2_grid)

    # 2. Define the Six-Hump Camel function
    Z = (4 - 2.1 * X1**2 + (X1**4) / 3.0) * X1**2 + X1 * X2 + (-4 + 4 * X2**2) * X2**2

    # Check for completed runs to overlay
    has_completed = False
    completed = pd.DataFrame()
    if not table.empty and "_zx_status" in table.columns and "f_value" in table.columns:
        completed = table[table["_zx_status"] == "completed"]
        if not completed.empty:
            has_completed = True

    # 3. Create 3D Surface Figure
    surface_data = [
        {
            "type": "surface",
            "x": x1_grid.tolist(),
            "y": x2_grid.tolist(),
            "z": Z.tolist(),
            "colorscale": "Viridis",
            "opacity": 0.85,
            "showscale": False
        }
    ]
    if has_completed:
        surface_data.append({
            "type": "scatter3d",
            "x": completed["x1"].tolist(),
            "y": completed["x2"].tolist(),
            "z": completed["f_value"].tolist(),
            "mode": "markers",
            "marker": {
                "size": 6,
                "color": "#ff3366",
                "line": {"color": "#ffffff", "width": 2}
            },
            "name": "Evaluated Points"
        })

    surface_fig = {
        "data": surface_data,
        "layout": {
            "title": "3D Surface: Six-Hump Camel",
            "scene": {
                "xaxis": {"title": "x1"},
                "yaxis": {"title": "x2"},
                "zaxis": {"title": "f(x1, x2)"}
            }
        }
    }

    # 4. Create 2D Contour Figure
    contour_data = [
        {
            "type": "contour",
            "x": x1_grid.tolist(),
            "y": x2_grid.tolist(),
            "z": Z.tolist(),
            "colorscale": "Viridis",
            "contours": {
                "showlabels": True,
                "labelfont": {"size": 8, "color": "#ffffff"}
            },
            "showscale": True
        }
    ]
    if has_completed:
        contour_data.append({
            "type": "scatter",
            "x": completed["x1"].tolist(),
            "y": completed["x2"].tolist(),
            "mode": "markers",
            "marker": {
                "size": 10,
                "color": "#ff3366",
                "line": {"color": "#ffffff", "width": 1.5}
            },
            "name": "Evaluated Points"
        })

    contour_fig = {
        "data": contour_data,
        "layout": {
            "title": "Contour Map: Six-Hump Camel",
            "xaxis": {"title": "x1"},
            "yaxis": {"title": "x2"}
        }
    }

    plots = {
        "camel_3d_surface": surface_fig,
        "camel_2d_contour": contour_fig
    }

    if has_completed:
        plots["exploration_map"] = {
            "data": [{
                "x": completed["x1"].tolist(),
                "y": completed["x2"].tolist(),
                "mode": "markers",
                "type": "scatter",
                "marker": {"color": completed["f_value"].tolist(), "colorscale": "Viridis"}
            }],
            "layout": {"title": "Exploration"}
        }

    return plots
"""

def main():
    # 1. Setup temporary project directory
    temp_dir = tempfile.mkdtemp(prefix="zx_camel_project_")
    print(f"Temporary project workspace created at: {temp_dir}")
    
    hooks_dir = Path(temp_dir) / "hooks"
    hooks_dir.mkdir(parents=True)
    
    # Write hooks to directory
    with open(hooks_dir / "initialize.py", "w") as f: f.write(camel_initialize)
    with open(hooks_dir / "preprocess.py", "w") as f: f.write(camel_preprocess)
    with open(hooks_dir / "launch.py", "w") as f: f.write(camel_launch)
    with open(hooks_dir / "extract.py", "w") as f: f.write(camel_extract)
    with open(hooks_dir / "explore.py", "w") as f: f.write(camel_explore)
    with open(hooks_dir / "plot.py", "w") as f: f.write(camel_plot)
    
    try:
        # 2. Initialize Database
        print("Initializing project database...")
        df = initialize_project_database(temp_dir, run_init=True)
        print(f"Initialized database size: {len(df)} rows.")
        print(df.to_string())
        
        # 3. Start runner loop
        print("\nTriggering parametric runner with Kriging optimization cascade...")
        # Start sequential run on initial 5 rows
        row_ids = list(range(5))
        hooks_to_run = ["preprocessing", "launching", "extracting", "exploring"]
        
        # Create a basic shared state
        state = {"max_iterations": 5, "current_iteration": 0}
        
        # Run directly in the main thread for test synchronous tracking
        run_loop_in_thread(
            project_path=temp_dir,
            row_ids=row_ids,
            hooks=hooks_to_run,
            dry_run=False,
            force=False,
            state=state
        )
        
        # 4. Verify results
        print("\nExecution complete! Checking results...")
        df_end = load_database(temp_dir)
        print(f"Final database size: {len(df_end)} rows.")
        print(df_end.to_string())
        
        # Basic assertions
        assert len(df_end) == 10, f"Expected 10 rows (5 initial + 5 iterations), got {len(df_end)}"
        assert "f_value" in df_end.columns, "Output column 'f_value' was not dynamically added!"
        
        completed_runs = df_end[df_end["_zx_status"] == "completed"]
        assert len(completed_runs) == 10, f"Expected all 10 runs to be completed, got {len(completed_runs)}"
        
        best_row = completed_runs.loc[completed_runs["f_value"].idxmin()]
        print(f"\nOptimization results convergence:")
        print(f"  Best point evaluated: x1={best_row['x1']:.4f}, x2={best_row['x2']:.4f}")
        print(f"  Minimum f(x1, x2) value: {best_row['f_value']:.6f}")
        
        # Six hump camel global minimum is -1.0316
        assert best_row["f_value"] < 0.0, "The optimization did not find any negative Camel function value!"
        print("\nSUCCESS: Six-Hump Camel E2E single-objective exploration succeeded perfectly!")
        
    except Exception as err:
        print(f"\nTEST FAILED: {err}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Clean up
        shutil.rmtree(temp_dir)
        print(f"Temporary project workspace cleaned up successfully.")

if __name__ == "__main__":
    main()
