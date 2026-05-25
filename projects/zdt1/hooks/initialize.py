import numpy as np
import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    """
    Initialization Hook for ZDT1
    ---------------------------
    Populates the initial parameters database if empty.
    
    Parameters:
      - table: DataFrame containing existing database rows.
      - state: dictionary containing shared global state variables.
      
    Returns:
      - rows: list of input parameter dicts.
      - state: updated shared global state dict.
    """
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
