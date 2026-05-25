import numpy as np
import pandas as pd
from pandas import DataFrame
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern

def explore(table: DataFrame, state: dict) -> list[dict]:
    """
    Exploration Hook for Six-Hump Camel
    ----------------------------------
    Executes a sequential optimization loop using a Kriging (Gaussian Process) 
    surrogate model over all completed runs to propose the next parameter set.
    """
    max_iter = state.get("max_iterations", 5)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        print(f"Reached max iterations limit ({max_iter}). Terminating.")
        return []
        
    state["current_iteration"] = current_iter + 1
    
    # Filter completed records
    completed = table[table["_zx_status"] == "completed"].copy()
    if len(completed) < 3:
        return [{"x1": round(np.random.uniform(-2.0, 2.0), 4), "x2": round(np.random.uniform(-2.0, 2.0), 4)}]
        
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
