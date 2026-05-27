import numpy as np
import pandas as pd
from pandas import DataFrame

def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
    """
    Initialization Hook for zCFD
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
            {
                "Airspeed [m/s]": 50.0,
                "Angle of Attack [°]": 0.0,
                "Angle of Sideslip [°]": 0.0,
                "Pitch Control Deflection": 0.0,
                "Roll Control Deflection": 0.0,
                "Yaw Control Deflection": 0.0,
                "Other Control Deflection": 0.0,
                "Throttle": 0.0,
                "p [°/s]": 0.0,
                "q [°/s]": 0.0,
                "r [°/s]": 0.0,
                "Full-Body or Full Body run": "Full-body",
                "Comment": "Coarse RANS"
            },
            {
                "Airspeed [m/s]": 50.0,
                "Angle of Attack [°]": 0.0,
                "Angle of Sideslip [°]": 0.0,
                "Pitch Control Deflection": 0.0,
                "Roll Control Deflection": 0.0,
                "Yaw Control Deflection": 0.0,
                "Other Control Deflection": 0.0,
                "Throttle": 0.0,
                "p [°/s]": 0.0,
                "q [°/s]": 0.0,
                "r [°/s]": 0.0,
                "Full-Body or Full Body run": "Full-body",
                "Comment": "Fine RANS"
            },
        ]
    else:
        rows = table.to_dict(orient="records")
        
    state["max_iterations"] = 0
    state["current_iteration"] = 0
    state["use_slurm"] = True
    state["slurm_poll_interval"] = 60

    # Create directories
    os.makedirs("data", exist_ok=True, parents=True)
    os.makedirs("runs/scripts", exist_ok=True, parents=True)
    os.makedirs("runs/template", exist_ok=True, parents=True)
    os.makedirs("runs/images", exist_ok=True, parents=True)
    os.makedirs("runs/mesh", exist_ok=True, parents=True)
    
    return rows, state
