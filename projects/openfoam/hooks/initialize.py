import os
import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    """
    Initialization Hook for OpenFOAM
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
        rows = [
            {
                "Lid Velocity [m/s]": 1.0,
                "Viscosity [m2/s]": 0.01,
                "Grid Resolution": 20,
                "Comment": "Coarse Cavity"
            },
            {
                "Lid Velocity [m/s]": 1.0,
                "Viscosity [m2/s]": 0.01,
                "Grid Resolution": 40,
                "Comment": "Medium Cavity"
            },
            {
                "Lid Velocity [m/s]": 2.0,
                "Viscosity [m2/s]": 0.01,
                "Grid Resolution": 40,
                "Comment": "High Re Cavity"
            }
        ]
    else:
        rows = table.to_dict(orient="records")
        
    state["max_iterations"] = 0
    state["current_iteration"] = 0
    state["use_slurm"] = False
    state["slurm_poll_interval"] = 30
    state["solver"] = "icoFoam"
    state["use_mock"] = True
    state["mesh_resolution"] = 20

    # Ensure required directories are created inside the workspace directory
    workspace_dir = state["workspace_dir"]
    os.makedirs(os.path.join(workspace_dir, "runs/template/0"), exist_ok=True)
    os.makedirs(os.path.join(workspace_dir, "runs/template/constant"), exist_ok=True)
    os.makedirs(os.path.join(workspace_dir, "runs/template/system"), exist_ok=True)
    os.makedirs(os.path.join(workspace_dir, "data"), exist_ok=True)
    
    return rows, state
