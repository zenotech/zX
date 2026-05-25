import pandas as pd
from pandas import DataFrame

def plot(table: DataFrame, state: dict) -> dict:
    """
    Visualization Hook (Optional)
    -----------------------------
    Generates custom Plotly figures for display on the dashboard.
    Runs inside the project root directory.
    
    Parameters:
      - table: DataFrame containing all completed runs.
      - state: shared global state dictionary.
      
    Returns:
      - dict: A dictionary of plotly figure dictionaries (serialized to JSON).
              Format: {"figure_name": {"data": [...], "layout": {...}}}
    """
    # Check if necessary columns are present
    x_col = "x1" if "x1" in table.columns else table.columns[0] if len(table.columns) > 0 else ""
    y_col = "f_value" if "f_value" in table.columns else table.columns[1] if len(table.columns) > 1 else ""
    
    if not x_col or not y_col:
        return {}
        
    # Generate a simple Plotly figure layout
    scatter_fig = {
        "data": [
            {
                "x": table[x_col].tolist(),
                "y": table[y_col].tolist(),
                "mode": "markers",
                "type": "scatter",
                "marker": {
                    "color": "#9b5de5",
                    "size": 12,
                    "line": {"color": "#ffffff", "width": 1}
                },
                "name": "Exploration Runs"
            }
        ],
        "layout": {
            "title": {
                "text": f"Custom Optimization: {y_col} vs {x_col}",
                "font": {"color": "#ffffff", "family": "Outfit"}
            },
            "paper_bgcolor": "rgba(0,0,0,0)",
            "plot_bgcolor": "rgba(0,0,0,0)",
            "xaxis": {
                "title": {"text": x_col, "font": {"color": "#a0aab2"}},
                "gridcolor": "#2c2e3a",
                "tickfont": {"color": "#a0aab2"}
            },
            "yaxis": {
                "title": {"text": y_col, "font": {"color": "#a0aab2"}},
                "gridcolor": "#2c2e3a",
                "tickfont": {"color": "#a0aab2"}
            },
            "margin": {"l": 50, "r": 50, "t": 50, "b": 50}
        }
    }
    
    return {
        "custom_scatter": scatter_fig
    }
