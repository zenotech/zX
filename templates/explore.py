import pandas as pd
from pandas import DataFrame

def explore(table: DataFrame, state: dict) -> list[dict]:
    """
    Exploration Hook (Optional)
    --------------------------
    Called after all selected rows have completed their extraction phase.
    Runs inside the project root directory.
    
    Analyzes the full database DataFrame and returns a list of new row dicts 
    to append. Returning an empty list terminates the optimization loop cascade.
    
    Parameters:
      - table: DataFrame containing all completed runs.
      - state: shared global state dictionary.
      
    Returns:
      - list[dict]: list of new parameter sets to evaluate. Return [] to stop.
    """
    max_iter = state.get("max_iterations", 5)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        return [] # Terminate optimization loop
        
    state["current_iteration"] = current_iter + 1
    
    # Analyze existing results and generate new parameter sets (e.g. optimizer step)
    # This is a mock: generate one new random row
    import random
    new_rows = [
        {
            "x1": round(random.uniform(-2.0, 2.0), 3),
            "x2": round(random.uniform(-2.0, 2.0), 3)
        }
    ]
    return new_rows
