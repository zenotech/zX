import pandas as pd
from pandas import DataFrame
import numpy as np

def plot(table: DataFrame, state: dict) -> dict:
    """
    Visualization Hook for ZDT1
    ---------------------------
    Generates a Plotly scatter plot of the True Pareto Front and overlays completed points.
    """
    # 1. Retrieve the True Pareto Front
    try:
        from pymoo.problems import get_problem
        problem = get_problem("zdt1")
        pareto_front = problem.pareto_front()
        # Sort by f1 for consistency
        pareto_front = pareto_front[np.argsort(pareto_front[:, 0])]
        f1_pf = pareto_front[:, 0].tolist()
        f2_pf = pareto_front[:, 1].tolist()
    except Exception:
        # Fallback to analytical ZDT1 Pareto Front: f2 = 1 - sqrt(f1)
        f1_pf = np.linspace(0.0, 1.0, 100)
        f2_pf = (1.0 - np.sqrt(f1_pf)).tolist()
        f1_pf = f1_pf.tolist()

    # 2. Build the data traces
    data = []
    
    # Trace 1: True Pareto Front (red, small markers)
    data.append({
        "x": f1_pf,
        "y": f2_pf,
        "mode": "markers",
        "type": "scatter",
        "name": "True Pareto Front",
        "marker": {
            "color": "red",
            "size": 5
        }
    })

    # Trace 2: Evaluated/Completed Solutions (if they exist)
    if not table.empty and "f1" in table.columns and "f2" in table.columns:
        completed = table[table["_zx_status"] == "completed"]
        if not completed.empty:
            data.append({
                "x": completed["f1"].tolist(),
                "y": completed["f2"].tolist(),
                "mode": "markers",
                "type": "scatter",
                "name": "Evaluated Solutions",
                "marker": {
                    "color": "#9b5de5",
                    "size": 8,
                    "line": {"color": "#ffffff", "width": 1}
                }
            })

    # 3. Define the premium plot layout
    layout = {
        "title": "ZDT1 Pareto Front",
        "xaxis": {
            "title": "Objective 1 (f1)",
            "gridcolor": "#e2e8f0",
            "zerolinecolor": "#cbd5e1"
        },
        "yaxis": {
            "title": "Objective 2 (f2)",
            "gridcolor": "#e2e8f0",
            "zerolinecolor": "#cbd5e1"
        },
        "plot_bgcolor": "#ffffff",
        "paper_bgcolor": "#ffffff",
        "showlegend": True,
        "legend": {
            "x": 0.8,
            "y": 0.9,
            "bordercolor": "#cbd5e1",
            "borderwidth": 1
        },
        "margin": {"t": 60, "b": 60, "l": 60, "r": 40}
    }

    return {
        "pareto_front": {
            "data": data,
            "layout": layout
        }
    }

