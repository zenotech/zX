import os
import sys
import shutil
import tempfile
import pandas as pd
from pathlib import Path

# Add backend directory to Python path
sys.path.append(str(Path(__file__).resolve().parents[1] / "backend"))

from zx_backend.database import initialize_project_database, load_database
from zx_backend.runner import run_loop_in_thread

zdt1_initialize = """import numpy as np
import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    if table.empty:
        # Generate 8 random decision variable vectors of size 10 for reproducibility
        np.random.seed(42)
        n_samples = 8
        n_vars = 10
        rows = []
        for i in range(n_samples):
            row = {f"x{j+1}": round(np.random.uniform(0.0, 1.0), 4) for j in range(n_vars)}
            rows.append(row)
    else:
        rows = table.to_dict(orient="records")
        
    state["max_iterations"] = 3
    state["current_iteration"] = 0
    return rows, state
"""

zdt1_preprocess = """from pathlib import Path
import csv

def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    x_cols = sorted([k for k in row.keys() if k.startswith("x") and k[1:].isdigit()], key=lambda c: int(c[1:]))
    input_file = run_dir / "input.csv"
    with open(input_file, mode="w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(x_cols)
        writer.writerow([row[col] for col in x_cols])
"""

zdt1_launch = """import subprocess
from pathlib import Path
import sys

def launch(row: dict, state: dict, run_dir: Path) -> subprocess.CompletedProcess:
    script_path = "/Users/jamil.appa/Documents/zX/test_apps/zdt1.py"
    cmd = [sys.executable, script_path]
    result = subprocess.run(
        cmd,
        cwd=run_dir,
        capture_output=True,
        text=True,
        check=True
    )
    return result
"""

zdt1_extract = """from pathlib import Path
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
        results = {"f1": 999.0, "f2": 999.0}
        
    if "f1" in results:
        results["f1"] = float(results["f1"])
    if "f2" in results:
        results["f2"] = float(results["f2"])
    return results
"""

zdt1_explore = """import numpy as np
import pandas as pd
from pandas import DataFrame

def is_dominated(row, candidates):
    f1, f2 = row["f1"], row["f2"]
    for c in candidates:
        c1, c2 = c["f1"], c["f2"]
        if (c1 <= f1 and c2 <= f2) and (c1 < f1 or c2 < f2):
            return True
    return False

def explore(table: DataFrame, state: dict) -> list[dict]:
    max_iter = state.get("max_iterations", 3)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        print(f"Reached max iterations limit ({max_iter}). Terminating ZDT1 GA loop.")
        return []
        
    state["current_iteration"] = current_iter + 1
    
    completed = table[table["_zx_status"] == "completed"].copy()
    if len(completed) < 4:
        return [{f"x{j+1}": round(np.random.uniform(0.0, 1.0), 4) for j in range(10)}]
        
    x_cols = sorted([col for col in completed.columns if col.startswith("x") and col[1:].isdigit()], key=lambda c: int(c[1:]))
    
    population = completed.to_dict(orient="records")
    pareto_front = []
    for p in population:
        if not is_dominated(p, population):
            pareto_front.append(p)
            
    print(f"GA Iteration {current_iter}: Pareto Front contains {len(pareto_front)} / {len(completed)} solutions.")
    
    # Generate 4 offspring using crossover and mutation
    offspring = []
    rng = np.random.default_rng(seed=100 + current_iter)
    
    for _ in range(4):
        parents_pool = pareto_front if len(pareto_front) >= 2 else population
        parent1 = rng.choice(parents_pool)
        parent2 = rng.choice(parents_pool)
        
        child = {}
        for col in x_cols:
            v1, v2 = float(parent1[col]), float(parent2[col])
            alpha = rng.uniform(-0.1, 1.1)
            val = v1 + alpha * (v2 - v1)
            
            if rng.random() < 0.2:
                val += rng.normal(0.0, 0.1)
                
            val = np.clip(val, 0.0, 1.0)
            child[col] = round(float(val), 4)
            
        offspring.append(child)
        
    return offspring
"""

zdt1_plot = """import pandas as pd
from pandas import DataFrame

def plot(table: DataFrame, state: dict) -> dict:
    if "f1" not in table.columns or table.empty:
        return {}
    completed = table[table["_zx_status"] == "completed"]
    return {
        "pareto_front": {
            "data": [{
                "x": completed["f1"].tolist(),
                "y": completed["f2"].tolist(),
                "mode": "markers",
                "type": "scatter",
                "marker": {"color": "#9b5de5"}
            }],
            "layout": {"title": "ZDT1 Objective Space"}
        }
    }
"""

def main():
    # 1. Setup temporary project directory
    temp_dir = tempfile.mkdtemp(prefix="zx_zdt1_project_")
    print(f"Temporary project workspace created at: {temp_dir}")
    
    hooks_dir = Path(temp_dir) / "hooks"
    hooks_dir.mkdir(parents=True)
    
    # Write hooks to directory
    with open(hooks_dir / "initialize.py", "w") as f: f.write(zdt1_initialize)
    with open(hooks_dir / "preprocess.py", "w") as f: f.write(zdt1_preprocess)
    with open(hooks_dir / "launch.py", "w") as f: f.write(zdt1_launch)
    with open(hooks_dir / "extract.py", "w") as f: f.write(zdt1_extract)
    with open(hooks_dir / "explore.py", "w") as f: f.write(zdt1_explore)
    with open(hooks_dir / "plot.py", "w") as f: f.write(zdt1_plot)
    
    try:
        # 2. Initialize Database
        print("Initializing project database...")
        df = initialize_project_database(temp_dir, run_init=True)
        print(f"Initialized database size: {len(df)} rows.")
        print(df.to_string())
        
        # 3. Start runner loop
        print("\nTriggering parametric runner with custom GA optimization cascade...")
        row_ids = list(range(8))
        hooks_to_run = ["preprocessing", "launching", "extracting", "exploring"]
        
        state = {"max_iterations": 3, "current_iteration": 0}
        
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
        # 8 initial + 3 iterations * 4 offspring = 20 total rows
        assert len(df_end) == 20, f"Expected 20 rows, got {len(df_end)}"
        assert "f1" in df_end.columns and "f2" in df_end.columns, "Objectives f1/f2 not dynamically added!"
        
        completed_runs = df_end[df_end["_zx_status"] == "completed"]
        assert len(completed_runs) == 20, f"Expected all 20 runs to be completed, got {len(completed_runs)}"
        
        print("\nSUCCESS: ZDT1 E2E multi-objective GA optimization succeeded perfectly!")
        
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
