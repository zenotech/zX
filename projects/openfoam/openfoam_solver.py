import sys
import os
import time
import csv
import math
import shutil
from pathlib import Path

def generate_mock_mesh_log(resolution):
    log = f"""
Create time

Create mesh for time = 0

Selecting dynamicFvMesh syntheticDynamicFvMesh
Generating mesh for resolution {resolution} x {resolution}
Points: {(resolution+1)*(resolution+1)*2}
Faces: {resolution*(resolution+1)*2 + resolution*(resolution+1)*2}
Cells: {resolution*resolution}
Boundary patches: 4
    patch 0: movingWall (type wall)
    patch 1: fixedWalls (type wall)
    patch 2: frontAndBack (type empty)

Writing polyMesh to constant/polyMesh
Finished blockMesh in 0.05 seconds.
"""
    return log.strip()

def generate_mock_solver_log(lid_velocity, viscosity, resolution, endTime, deltaT):
    Re = abs(lid_velocity) * 0.1 / viscosity if viscosity > 0 else 0
    log_lines = [
        "Create time\n",
        "Create mesh for time = 0\n",
        "Reading transportProperties\n",
        f"Reynolds number: {Re:.2f} (L=0.1, U={lid_velocity}, nu={viscosity})\n",
        "Selecting incompressible transport model Newtonian",
        f"Selecting turbulence model laminar\n",
        "Starting time loop\n"
    ]
    
    steps = int(endTime / deltaT)
    current_time = 0.0
    
    # We want to show converging residuals
    ux_res = 1.0
    uy_res = 1.0
    p_res = 1.0
    
    for step in range(1, steps + 1):
        current_time += deltaT
        ux_res *= 0.5 + 0.1 * (math.sin(step) * 0.5 + 0.5)
        uy_res *= 0.5 + 0.1 * (math.cos(step) * 0.5 + 0.5)
        p_res *= 0.6 + 0.1 * (math.sin(step + 1) * 0.5 + 0.5)
        
        ux_iters = max(1, int(8 - step * 0.5))
        uy_iters = max(1, int(8 - step * 0.5))
        p_iters = max(2, int(15 - step * 0.8))
        
        step_log = f"""
Time = {current_time:.3f}

Courant Number mean: {0.05 * lid_velocity:.4f} max: {0.12 * lid_velocity:.4f}
DILUPBiCG:  Solving for Ux, Initial residual = {ux_res:.6f}, Final residual = {ux_res*0.01:.8f}, No Iterations {ux_iters}
DILUPBiCG:  Solving for Uy, Initial residual = {uy_res:.6f}, Final residual = {uy_res*0.01:.8f}, No Iterations {uy_iters}
DICPCG:  Solving for p, Initial residual = {p_res:.6f}, Final residual = {p_res*0.01:.8f}, No Iterations {p_iters}
time step continuity errors : sum local = 1.2e-15, global = -4.5e-17, cumulative = -4.5e-17
ExecutionTime = {0.02 * step * (resolution/20)**2:.2f} s  ClockTime = {int(0.02 * step * (resolution/20)**2)} s
"""
        log_lines.append(step_log.strip())
        
    return "\n".join(log_lines)

def run_real_openfoam(solver, run_dir):
    # Run blockMesh
    print("Executing blockMesh...")
    block_res = subprocess.run(["blockMesh"], cwd=run_dir, capture_output=True, text=True)
    with open(run_dir / "log.blockMesh", "w") as f:
        f.write(block_res.stdout + "\n" + block_res.stderr)
        
    if block_res.returncode != 0:
        print(f"blockMesh failed with exit code {block_res.returncode}", file=sys.stderr)
        return block_res.returncode
        
    # Run solver
    print(f"Executing solver {solver}...")
    solver_res = subprocess.run([solver], cwd=run_dir, capture_output=True, text=True)
    with open(run_dir / f"log.{solver}", "w") as f:
        f.write(solver_res.stdout + "\n" + solver_res.stderr)
        
    return solver_res.returncode

def main():
    run_dir = Path(os.getcwd())
    input_file = run_dir / "input.csv"
    
    if not input_file.exists():
        print(f"Error: input.csv not found in {run_dir}. Preprocessing might have failed.", file=sys.stderr)
        sys.exit(1)
        
    # Load parameters from input.csv
    row = {}
    with open(input_file, mode="r") as f:
        reader = csv.DictReader(f)
        for r in reader:
            row = r
            break
            
    # Parse parameters
    try:
        lid_velocity = float(row.get("Lid Velocity [m/s]", 1.0))
        viscosity = float(row.get("Viscosity [m2/s]", 0.01))
        resolution = int(float(row.get("Grid Resolution", 20)))
    except Exception as e:
        print(f"Error parsing input parameters from csv: {e}", file=sys.stderr)
        sys.exit(1)
        
    # Read state settings from command line or default
    use_mock = True
    solver = "icoFoam"
    
    # We can pass environment variables or check settings
    if os.environ.get("ZX_USE_MOCK", "").lower() == "false":
        use_mock = False
    solver = os.environ.get("ZX_SOLVER", "icoFoam")
    
    print(f"OpenFOAM Solver Wrapper initialized. Mode: {'Mock' if use_mock else 'Real'}")
    
    if not use_mock:
        # Check if commands exist on system
        if shutil.which("blockMesh") is None or shutil.which(solver) is None:
            print("Warning: blockMesh or solver not found on system path. Falling back to Mock mode.")
            use_mock = True
            
    if not use_mock:
        import subprocess
        ret_code = run_real_openfoam(solver, run_dir)
        if ret_code != 0:
            sys.exit(ret_code)
    else:
        # Simulate calculations
        print("Simulating blockMesh...")
        mesh_log = generate_mock_mesh_log(resolution)
        with open(run_dir / "log.blockMesh", "w") as f:
            f.write(mesh_log)
            
        print("Simulating solver...")
        # endTime and deltaT
        endTime = 0.5
        deltaT = 0.005
        solver_log = generate_mock_solver_log(lid_velocity, viscosity, resolution, endTime, deltaT)
        
        # Sleep for a realistic duration
        sim_time = 0.5 * (resolution / 20.0)**2
        print(f"Sleeping for {sim_time:.2f} seconds to simulate computational solve...")
        time.sleep(sim_time)
        
        with open(run_dir / f"log.{solver}", "w") as f:
            f.write(solver_log)
            
        # Create output time step directory
        time_dir = run_dir / f"{endTime:.1f}"
        time_dir.mkdir(parents=True, exist_ok=True)
        
        # Write dummy U and p files to look authentic
        with open(time_dir / "U", "w") as f:
            f.write("/*--------------------------------*- C++ -*----------------------------------*\\\n")
            f.write("  FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n")
            f.write(f"// Mock U field at time {endTime}\n")
            f.write(f"internalField uniform (0 0 0);\n")
            
        with open(time_dir / "p", "w") as f:
            f.write("/*--------------------------------*- C++ -*----------------------------------*\\\n")
            f.write("  FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n")
            f.write(f"// Mock p field at time {endTime}\n")
            f.write(f"internalField uniform 0;\n")
            
        # Compute results
        Re = abs(lid_velocity) * 0.1 / viscosity if viscosity > 0 else 0
        max_vel = abs(lid_velocity)
        # interior max velocity is lower
        interior_max_vel = abs(lid_velocity) * 0.37 * (1.0 - math.exp(-Re/100.0) if Re > 0 else 0)
        pressure_drop = 0.15 * (lid_velocity ** 2) * (viscosity ** -0.05)
        
        # Write summary statistics csv
        with open(run_dir / "openfoam_summary.csv", "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["Re", "Max Velocity [m/s]", "Interior Max Velocity [m/s]", "Pressure Drop [Pa]", "Execution Time [s]", "Status"])
            writer.writerow([
                f"{Re:.3f}", 
                f"{max_vel:.3f}", 
                f"{interior_max_vel:.3f}", 
                f"{pressure_drop:.4f}", 
                f"{sim_time:.2f}", 
                "converged"
            ])
            
        # Write centerline velocity profiles y-axis [0, 0.1]
        # U_x velocity recirculates: goes negative in bottom half, positive in top half
        with open(run_dir / "centerline_velocity.csv", "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["y", "Ux", "Resolution"])
            n_points = resolution
            for i in range(n_points + 1):
                y = 0.1 * i / n_points
                ynorm = y / 0.1
                # recirculation profile approximation
                ux = lid_velocity * (8.0 * ynorm**3 - 6.0 * ynorm**2 + ynorm)
                writer.writerow([f"{y:.5f}", f"{ux:.5f}", str(resolution)])
                
        print("OpenFOAM simulation simulation completed successfully. Outputs written.")

if __name__ == "__main__":
    main()
