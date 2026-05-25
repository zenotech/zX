import numpy as np
import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    """
    Initialization Hook for Six-Hump Camel
    --------------------------------------
    Populates the initial input parameters if the database is empty.
    
    Parameters:
      - table: DataFrame containing existing database rows.
      - state: dictionary containing shared global state variables.
      
    Returns:
      - rows: list of input parameter dicts.
      - state: updated shared global state dict.
    """
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
