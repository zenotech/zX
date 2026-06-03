import os
import shutil
import csv
from pathlib import Path

def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    """
    Pre-processing Hook for OpenFOAM
    --------------------------------------
    Takes a row of input parameters, creates the OpenFOAM directory structure,
    copies template dictionaries, and interpolates input values into the case files.
    """
    # 1. Ensure OpenFOAM directory structure exists inside the run_dir
    (run_dir / "0").mkdir(parents=True, exist_ok=True)
    (run_dir / "constant").mkdir(parents=True, exist_ok=True)
    (run_dir / "system").mkdir(parents=True, exist_ok=True)
    
    workspace_dir = Path(state["workspace_dir"])
    template_dir = workspace_dir / "runs" / "template"
    
    # 2. Extract values
    lid_velocity = float(row.get("Lid Velocity [m/s]", 1.0))
    viscosity = float(row.get("Viscosity [m2/s]", 0.01))
    grid_resolution = int(row.get("Grid Resolution", 20))
    
    # 3. Process constant/transportProperties
    tp_template = template_dir / "constant" / "transportProperties.in"
    tp_dest = run_dir / "constant" / "transportProperties"
    if tp_template.exists():
        with open(tp_template, "r") as f:
            content = f.read()
        content = content.replace("VISCOSITY", f"{viscosity:g}")
        with open(tp_dest, "w") as f:
            f.write(content)
    else:
        # Fallback if template doesn't exist
        with open(tp_dest, "w") as f:
            f.write(f"transportModel Newtonian;\nnu [0 2 -1 0 0 0 0] {viscosity:g};\n")
            
    # 4. Process system/blockMeshDict
    bm_template = template_dir / "system" / "blockMeshDict.in"
    bm_dest = run_dir / "system" / "blockMeshDict"
    if bm_template.exists():
        with open(bm_template, "r") as f:
            content = f.read()
        content = content.replace("GRID_RES", str(grid_resolution))
        with open(bm_dest, "w") as f:
            f.write(content)
            
    # 5. Process 0/U
    u_template = template_dir / "0" / "U.in"
    u_dest = run_dir / "0" / "U"
    if u_template.exists():
        with open(u_template, "r") as f:
            content = f.read()
        content = content.replace("LID_VELOCITY", f"{lid_velocity:g}")
        with open(u_dest, "w") as f:
            f.write(content)
            
    # 6. Copy 0/p (direct copy as it's static)
    p_template = template_dir / "0" / "p.in"
    p_dest = run_dir / "0" / "p"
    if p_template.exists():
        shutil.copy2(p_template, p_dest)
        
    # 7. Copy system/controlDict
    cd_template = template_dir / "system" / "controlDict.in"
    cd_dest = run_dir / "system" / "controlDict"
    if cd_template.exists():
        shutil.copy2(cd_template, cd_dest)
        
    # 8. Copy system/fvSchemes and system/fvSolution (which are static files)
    for file_name in ["fvSchemes", "fvSolution"]:
        src = template_dir / "system" / file_name
        dst = run_dir / "system" / file_name
        if src.exists():
            shutil.copy2(src, dst)
            
    # 9. Write input.csv inside run_dir for the solver wrapper/mock
    input_file = run_dir / "input.csv"
    with open(input_file, mode="w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(row.keys())
        writer.writerow(row.values())
        
    print(f"Pre-processing completed for run {row.get('row_id')}. OpenFOAM case files generated.")
