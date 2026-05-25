import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    """
    Initialization Hook (Optional)
    -----------------------------
    Populates the initial input parameters and/or transforms an existing CSV.
    
    Parameters:
      - table: DataFrame containing existing CSV data (empty if no CSV provided).
      - state: dictionary containing shared global state variables.
      
    Returns:
      - rows: list of input parameter dicts (one dict per row).
      - state: updated shared global state dict passed to all subsequent hooks.
    """
    # Example generating design of experiments if table is empty
    if table.empty:
        rows = [
            {"x1": 0.5, "x2": -1.0},
            {"x1": -0.5, "x2": 1.0},
            {"x1": 1.5, "x2": 0.0}
        ]
    else:
        # Pass existing CSV rows through
        rows = table.to_dict(orient="records")
        
    # Initialize global state variables
    state["max_iterations"] = state.get("max_iterations", 5)
    state["current_iteration"] = 0
    
    return rows, state
