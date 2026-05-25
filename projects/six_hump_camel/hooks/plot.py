import pandas as pd
from pandas import DataFrame
import numpy as np

def plot(table: DataFrame, state: dict) -> dict:
    """
    Visualization Hook for Six-Hump Camel
    -------------------------------------
    Generates an interactive Plotly map of the parameter exploration,
    along with 3D Surface and 2D Contour plots of the theoretical domain.
    """
    # 1. Define the grid domain
    x1_grid = np.linspace(-3, 3, 100)
    x2_grid = np.linspace(-2, 2, 100)
    X1, X2 = np.meshgrid(x1_grid, x2_grid)

    # 2. Define the Six-Hump Camel function
    Z = (4 - 2.1 * X1**2 + (X1**4) / 3.0) * X1**2 + X1 * X2 + (-4 + 4 * X2**2) * X2**2

    # Check for completed runs to overlay
    has_completed = False
    completed = pd.DataFrame()
    if not table.empty and "_zx_status" in table.columns and "f_value" in table.columns:
        completed = table[table["_zx_status"] == "completed"]
        if not completed.empty:
            has_completed = True

    # 3. Create 3D Surface Figure
    surface_data = [
        {
            "type": "surface",
            "x": x1_grid.tolist(),
            "y": x2_grid.tolist(),
            "z": Z.tolist(),
            "colorscale": "Viridis",
            "opacity": 0.85,
            "showscale": False
        }
    ]
    if has_completed:
        surface_data.append({
            "type": "scatter3d",
            "x": completed["x1"].tolist(),
            "y": completed["x2"].tolist(),
            "z": completed["f_value"].tolist(),
            "mode": "markers",
            "marker": {
                "size": 6,
                "color": "#ff3366",
                "line": {"color": "#ffffff", "width": 2}
            },
            "name": "Evaluated Points"
        })

    surface_fig = {
        "data": surface_data,
        "layout": {
            "title": "3D Surface: Six-Hump Camel",
            "scene": {
                "xaxis": {"title": "x1"},
                "yaxis": {"title": "x2"},
                "zaxis": {"title": "f(x1, x2)"}
            }
        }
    }

    # 4. Create 2D Contour Figure
    contour_data = [
        {
            "type": "contour",
            "x": x1_grid.tolist(),
            "y": x2_grid.tolist(),
            "z": Z.tolist(),
            "colorscale": "Viridis",
            "contours": {
                "showlabels": True,
                "labelfont": {"size": 8, "color": "#ffffff"}
            },
            "showscale": True
        }
    ]
    if has_completed:
        contour_data.append({
            "type": "scatter",
            "x": completed["x1"].tolist(),
            "y": completed["x2"].tolist(),
            "mode": "markers",
            "marker": {
                "size": 10,
                "color": "#ff3366",
                "line": {"color": "#ffffff", "width": 1.5}
            },
            "name": "Evaluated Points"
        })

    contour_fig = {
        "data": contour_data,
        "layout": {
            "title": "Contour Map: Six-Hump Camel",
            "xaxis": {"title": "x1"},
            "yaxis": {"title": "x2"}
        }
    }

    plots = {
        "camel_3d_surface": surface_fig,
        "camel_2d_contour": contour_fig
    }

    # Also keep the original exploration map if there are completed runs
    if has_completed:
        plots["exploration_map"] = {
            "data": [{
                "x": completed["x1"].tolist(),
                "y": completed["x2"].tolist(),
                "mode": "markers",
                "type": "scatter",
                "marker": {"color": completed["f_value"].tolist(), "colorscale": "Viridis"}
            }],
            "layout": {"title": "Six-Hump Camel Exploration Map"}
        }

    return plots

