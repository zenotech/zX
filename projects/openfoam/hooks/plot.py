import pandas as pd
from pandas import DataFrame
import plotly.express as px
import plotly.graph_objects as go
from pathlib import Path

def plot(table: DataFrame, state: dict) -> dict:
    """
    Visualization Hook for OpenFOAM
    ----------------------------------------
    Generates interactive plots for OpenFOAM simulation results:
    1. Interior Max Velocity vs. Reynolds Number (flow physics)
    2. Grid Resolution vs. Execution Time (performance)
    3. Centerline velocity profiles (validation)
    """
    plots = {}
    
    if table.empty:
        return plots
        
    # Filter for completed runs
    if "_zx_status" in table.columns:
        completed = table[table["_zx_status"] == "completed"].copy()
    else:
        completed = table.copy()
        
    if completed.empty:
        return plots
        
    # Ensure Re exists
    if "Re" in completed.columns:
        completed["Re"] = pd.to_numeric(completed["Re"], errors="coerce")
        completed = completed.sort_values("Re")
        
    # Plot 1: Interior Max Velocity vs. Reynolds Number
    if "Re" in completed.columns and "Interior Max Velocity [m/s]" in completed.columns:
        fig1 = px.line(
            completed,
            x="Re",
            y="Interior Max Velocity [m/s]",
            title="Interior Max Velocity vs. Reynolds Number",
            markers=True,
            labels={"Re": "Reynolds Number (Re)", "Interior Max Velocity [m/s]": "U_max (interior) [m/s]"}
        )
        # Apply dark theme styling
        fig1.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            font={"color": "#a0aab2"},
            xaxis={"gridcolor": "#2d3748"},
            yaxis={"gridcolor": "#2d3748"}
        )
        plots["velocity_vs_re"] = fig1.to_dict()
        
    # Plot 2: Grid Resolution vs. Execution Time
    if "Grid Resolution" in completed.columns and "Execution Time [s]" in completed.columns:
        # Group by grid resolution and calculate mean execution time
        comp_sorted = completed.sort_values("Grid Resolution")
        fig2 = px.bar(
            comp_sorted,
            x="Grid Resolution",
            y="Execution Time [s]",
            color="Grid Resolution",
            title="Execution Time vs. Grid Resolution",
            labels={"Grid Resolution": "Grid Resolution (NxN)", "Execution Time [s]": "Execution Time [s]"}
        )
        fig2.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            font={"color": "#a0aab2"},
            xaxis={"gridcolor": "#2d3748", "type": "category"},
            yaxis={"gridcolor": "#2d3748"}
        )
        plots["resolution_vs_time"] = fig2.to_dict()
        
    # Plot 3: Centerline velocity profile
    fig3 = go.Figure()
    has_profiles = False
    
    for _, row in completed.iterrows():
        run_dir_str = row.get("_zx_run_dir")
        row_id = row.get("_zx_row_id", "Unknown")
        resolution = row.get("Grid Resolution", "Unknown")
        reynolds = row.get("Re", 0.0)
        
        if not run_dir_str:
            continue
            
        profile_file = Path(run_dir_str) / "centerline_velocity.csv"
        if profile_file.exists():
            try:
                profile_df = pd.read_csv(profile_file)
                if "y" in profile_df.columns and "Ux" in profile_df.columns:
                    fig3.add_trace(
                        go.Scatter(
                            x=profile_df["Ux"],
                            y=profile_df["y"],
                            mode="lines+markers",
                            name=f"Run {row_id} (Res {resolution}, Re {reynolds:.1f})"
                        )
                    )
                    has_profiles = True
            except Exception as e:
                print(f"Warning: Failed to load centerline profile from {profile_file}: {e}")
                
    if has_profiles:
        fig3.update_layout(
            title="Centerline Velocity Profile (Ux vs y)",
            xaxis_title="Horizontal Velocity Ux [m/s]",
            yaxis_title="Vertical Coordinate y [m]",
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            font={"color": "#a0aab2"},
            xaxis={"gridcolor": "#2d3748"},
            yaxis={"gridcolor": "#2d3748"}
        )
        plots["centerline_profile"] = fig3.to_dict()
        
    return plots
