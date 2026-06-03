import random
import pandas as pd
from pandas import DataFrame

def explore(table: DataFrame, state: dict) -> list[dict]:
    """
    Exploration Hook for OpenFOAM
    ----------------------------
    Proposes new parameter combinations (Lid Velocity, Viscosity)
    to expand the design space exploration.
    
    Parameters:
      - table: DataFrame containing all completed/failed simulation rows.
      - state: dictionary containing shared global state variables.
      
    Returns:
      - list: list of new design row dicts. Return empty list to stop.
    """
    max_iter = state.get("max_iterations", 0)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        print("Exploration limit reached or loop disabled.")
        return []
        
    # Increment current iteration count
    state["current_iteration"] = current_iter + 1
    print(f"Running OpenFOAM exploration iteration {state['current_iteration']}/{max_iter}...")
    
    # Simple search strategy: Propose two new cases with varying lid velocity and viscosity
    # targeting intermediate Reynolds numbers.
    new_rows = [
        {
            "Lid Velocity [m/s]": round(random.uniform(0.5, 3.0), 2),
            "Viscosity [m2/s]": round(random.uniform(0.002, 0.02), 4),
            "Grid Resolution": 40,
            "Comment": f"Exploration Iter {state['current_iteration']}"
        }
    ]
    
    return new_rows
