import pandas as pd
from pandas import DataFrame
import numpy as np
import plotly.express as px
import plotly.io as pio
import base64
from pathlib import Path

def find_file(filename: str, project_dir: Path) -> Path | None:
    """
    Search for a file in multiple potential locations:
    - project_dir / data
    - project_dir / images
    - project_dir / .. / data
    - project_dir / hooks / .. / data
    - current working directory / data
    - current working directory / .. / data
    - current working directory / images
    - current working directory / .. / images
    """
    search_paths = [
        project_dir / "data" / filename,
        project_dir / "images" / filename,
        project_dir / "../data" / filename,
        project_dir / "hooks" / "../data" / filename,
        Path("data") / filename,
        Path("../data") / filename,
        Path("images") / filename,
        Path("../images") / filename,
    ]
    for p in search_paths:
        try:
            if p.exists():
                return p.resolve()
        except Exception:
            pass
    return None

def get_mutiplier(wt_data):
    """
    Applies quadratic correction to CD for Alpha > 10.
    """
    if wt_data is None or 'Alpha' not in wt_data.columns:
        return None
    # 1. Initialize the multiplier to 1 over the whole array
    cd_multiplier = np.ones_like(wt_data['Alpha'], dtype=float)
    # 2. Find where Alpha > 10 and only apply the quadratic correction there
    mask = (wt_data['Alpha'] > 10) & (wt_data['Alpha'] < 21) 
    cd_multiplier[mask] = ( (1.0 + (wt_data['Alpha'][mask]-10.0)/50.0) * 80.0)**2/ 80**2
    return cd_multiplier

def add_logo(fig, logo_base64, size=0.15):
    """
    Adds a base64 encoded logo to a Plotly figure layout.
    """
    if not logo_base64:
        return fig
    fig.add_layout_image(
        dict(
            source=logo_base64,
            xref="paper", yref="paper",
            x=1, y=1.05,
            sizex=size, sizey=size,
            xanchor="right", yanchor="bottom",
            sizing="contain",
            layer="above"
        )
    )
    return fig

def plot(table: DataFrame, state: dict) -> dict:
    """
    Aerodynamic Visualization Hook for zCFD
    ----------------------------------------
    Generates interactive plots for lift, drag, pitching moments, and coefficients,
    comparing the CFD results with wind tunnel (WT) experimental data and sting tare data.
    """
    HOOKS_DIR = Path(__file__).resolve().parent
    PROJECT_DIR = HOOKS_DIR.parent
    
    # 1. Search for and load the logo image
    logo_base64 = None
    logo_path = None
    for logo_name in ["ZCFD_Mark_CMYK.png", "ZCFD_Mark_CMYK_trans.png", "logo.png"]:
        logo_path = find_file(logo_name, PROJECT_DIR)
        if logo_path:
            break
            
    if logo_path:
        try:
            with open(logo_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            logo_base64 = f"data:image/png;base64,{encoded_string}"
        except Exception as e:
            print(f"Warning: Failed to load or encode logo from {logo_path}: {e}")

    # 2. Search for and load the wind tunnel and tare data files
    wt_data_path = find_file('AZ-256_WT_Data-wTare_02.csv', PROJECT_DIR)
    wt_data_1_path = find_file('AZ-256_WT_Data-wTare_20.csv', PROJECT_DIR)
    wt_data_2_path = find_file('AZ-256_WT_Data-wTare_23.csv', PROJECT_DIR)
    tare_data_path = find_file('AZ-256_WT_Data_TARE.csv', PROJECT_DIR)

    wt_data = pd.read_csv(wt_data_path, sep=',') if wt_data_path else None
    wt_data_1 = pd.read_csv(wt_data_1_path, sep=',') if wt_data_1_path else None
    wt_data_2 = pd.read_csv(wt_data_2_path, sep=',') if wt_data_2_path else None
    tare_data = pd.read_csv(tare_data_path, sep=',') if tare_data_path else None

    # 3. Filter and sort the simulation results
    results_sorted = pd.DataFrame()
    results_sorted_fine = pd.DataFrame()
    
    if not table.empty:
        # Check if _zx_status column exists, filter for completed runs
        if "_zx_status" in table.columns:
            results = table[table["_zx_status"] == "completed"].copy()
        else:
            results = table.copy()
            
        if not results.empty:
            # Sort by Angle of Attack
            aoa_col = 'Angle of Attack [°]'
            if aoa_col in results.columns:
                results_sorted = results.sort_values(aoa_col)
            else:
                results_sorted = results.copy()
                
            # Filter by Run ID (use _zx_row_id as Run ID if Run ID not present)
            id_col = 'Run ID' if 'Run ID' in results_sorted.columns else ('_zx_row_id' if '_zx_row_id' in results_sorted.columns else None)
            if id_col:
                results_sorted = results_sorted[results_sorted[id_col] != 13]
                results_sorted = results_sorted[results_sorted[id_col] != 14]
                
            # Split into coarse and fine
            if 'Comment' in results_sorted.columns:
                results_sorted_fine = results_sorted[results_sorted['Comment'].str.contains('fine', na=False)]
                results_sorted = results_sorted[~results_sorted['Comment'].str.contains('fine', na=False)]

    # 4. Generate the plots
    plots = {}
    labels = {'C_L': r'$C_L$', 'C_D': r'$C_D$', 'C_m': r'$C_m$'}

    # Plot 1: Lift vs Angle of Attack @ 179mph
    if not results_sorted.empty and 'Lift [N]' in results_sorted.columns:
        fig = px.line(results_sorted, x='Angle of Attack [°]', y='Lift [N]', title='Lift vs Angle of Attack @ 179mph', markers=True)
        # In the notebook, this scatter was commented out, but we can support it if needed
        # if not results_sorted_fine.empty and 'Lift [N]' in results_sorted_fine.columns:
        #     fig.add_scatter(x=results_sorted_fine['Angle of Attack [°]'], y=results_sorted_fine['Lift [N]'], mode='markers', name='fine mesh')
        add_logo(fig, logo_base64)
        plots["lift"] = fig.to_dict()

    # Plot 2: Drag vs Angle of Attack @ 179mph
    if not results_sorted.empty and 'Drag [N]' in results_sorted.columns:
        fig = px.line(results_sorted, x='Angle of Attack [°]', y='Drag [N]', title='Drag vs Angle of Attack @ 179mph', markers=True)
        add_logo(fig, logo_base64)
        plots["drag"] = fig.to_dict()

    # Plot 3: Pitching Moment vs Angle of Attack @ 179mph
    if not results_sorted.empty and 'Pitch [Nm]' in results_sorted.columns:
        fig = px.line(results_sorted, x='Angle of Attack [°]', y='Pitch [Nm]', title='Pitching Moment vs Angle of Attack @ 179mph', markers=True)
        add_logo(fig, logo_base64)
        plots["pitch"] = fig.to_dict()

    # Plot 4: L/D vs Angle of Attack @ 179mph
    if not results_sorted.empty and 'L/D' in results_sorted.columns:
        fig = px.line(results_sorted, x='Angle of Attack [°]', y='L/D', title='L/D vs Angle of Attack @ 179mph', markers=True)
        add_logo(fig, logo_base64)
        plots["lod"] = fig.to_dict()

    # Plot 5: Lift Coefficient vs Angle of Attack
    fig5 = None
    if not results_sorted.empty and 'C_L' in results_sorted.columns:
        fig5 = px.line(results_sorted, x='Angle of Attack [°]', y='C_L', title='Lift Coefficient vs Angle of Attack', markers=True, labels=labels)
        if not results_sorted_fine.empty and 'C_L' in results_sorted_fine.columns:
            fig5.add_scatter(x=results_sorted_fine['Angle of Attack [°]'], y=results_sorted_fine['C_L'], mode='markers', name='fine mesh')
        if wt_data is not None:
            fig5.add_scatter(x=wt_data['Alpha'], y=wt_data['CLw'], mode='markers', name='WT -1')
    elif wt_data is not None:
        fig5 = px.scatter(wt_data, x='Alpha', y='CLw', title='Lift Coefficient vs Angle of Attack (WT Only)', labels={'Alpha': 'Angle of Attack [°]', 'CLw': 'C_L'})
        fig5.data[0].name = 'WT -1'
        fig5.data[0].showlegend = True

    if fig5:
        add_logo(fig5, logo_base64)
        plots["cl"] = fig5.to_dict()

    # Plot 6: Drag Coefficient vs Angle of Attack
    fig6 = None
    if not results_sorted.empty and 'C_D' in results_sorted.columns:
        fig6 = px.line(results_sorted, x='Angle of Attack [°]', y='C_D', title='Drag Coefficient vs Angle of Attack', markers=True, labels=labels)
        if not results_sorted_fine.empty and 'C_D' in results_sorted_fine.columns:
            fig6.add_scatter(x=results_sorted_fine['Angle of Attack [°]'], y=results_sorted_fine['C_D'], mode='markers', name='fine mesh')
        if wt_data is not None:
            fig6.add_scatter(x=wt_data['Alpha'], y=wt_data['CDw'], mode='markers', name='WT -1')
    elif wt_data is not None:
        fig6 = px.scatter(wt_data, x='Alpha', y='CDw', title='Drag Coefficient vs Angle of Attack (WT Only)', labels={'Alpha': 'Angle of Attack [°]', 'CDw': 'C_D'})
        fig6.data[0].name = 'WT -1'
        fig6.data[0].showlegend = True

    if fig6:
        add_logo(fig6, logo_base64)
        plots["cd"] = fig6.to_dict()

    # Plot 7: Pitching Moment Coefficient vs Angle of Attack
    fig7 = None
    if not results_sorted.empty and 'C_m' in results_sorted.columns:
        fig7 = px.line(results_sorted, x='Angle of Attack [°]', y='C_m', title='Pitching Moment Coefficient vs Angle of Attack', markers=True, labels=labels)
        if wt_data is not None:
            fig7.add_scatter(x=wt_data['Alpha'], y=wt_data['CMw'], mode='markers', name='WT -1')
    elif wt_data is not None:
        fig7 = px.scatter(wt_data, x='Alpha', y='CMw', title='Pitching Moment Coefficient vs Angle of Attack (WT Only)', labels={'Alpha': 'Angle of Attack [°]', 'CMw': 'C_m'})
        fig7.data[0].name = 'WT -1'
        fig7.data[0].showlegend = True

    if fig7:
        add_logo(fig7, logo_base64)
        plots["cm"] = fig7.to_dict()

    # Plot 8: Sting Drag vs speed
    if tare_data is not None:
        fig8 = px.line(tare_data, x='Vinf_m/s', y='CDw', title='Sting Drag vs speed', markers=True, labels=labels)
        add_logo(fig8, logo_base64)
        plots["tare"] = fig8.to_dict()

    return plots

