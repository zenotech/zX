from pathlib import Path
import csv
import re

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Extraction Hook for OpenFOAM
    ----------------------------------
    Extracts the Reynolds number, maximum velocities, pressure drops,
    and computational execution times from solver outputs.
    """
    summary_file = run_dir / "openfoam_summary.csv"
    results = {}
    
    # 1. Primary: Extract from generated summary file
    if summary_file.exists():
        try:
            with open(summary_file, mode="r") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    # Map values and convert to correct types
                    results["Re"] = float(r.get("Re", 0.0))
                    results["Max Velocity [m/s]"] = float(r.get("Max Velocity [m/s]", 0.0))
                    results["Interior Max Velocity [m/s]"] = float(r.get("Interior Max Velocity [m/s]", 0.0))
                    results["Pressure Drop [Pa]"] = float(r.get("Pressure Drop [Pa]", 0.0))
                    results["Execution Time [s]"] = float(r.get("Execution Time [s]", 0.0))
                    results["Solver Status"] = r.get("Status", "completed")
                    break
            return results
        except Exception as e:
            print(f"Warning: Failed to parse openfoam_summary.csv: {e}. Falling back to log parsing.")
            
    # 2. Fallback: Parse log files and OpenFOAM results directly
    solver = state.get("solver", "icoFoam")
    log_file = run_dir / f"log.{solver}"
    
    results = {
        "Re": 0.0,
        "Max Velocity [m/s]": 0.0,
        "Interior Max Velocity [m/s]": 0.0,
        "Pressure Drop [Pa]": 0.0,
        "Execution Time [s]": 0.0,
        "Solver Status": "unknown"
    }
    
    if log_file.exists():
        results["Solver Status"] = "completed"
        try:
            with open(log_file, "r") as f:
                log_content = f.read()
                
            # Parse Reynolds number if logged
            re_match = re.search(r"Reynolds number:\s+([\d\.]+)", log_content)
            if re_match:
                results["Re"] = float(re_match.group(1))
                
            # Parse execution time from the last occurrence
            exec_matches = re.findall(r"ExecutionTime\s+=\s+([\d\.]+)", log_content)
            if exec_matches:
                results["Execution Time [s]"] = float(exec_matches[-1])
                
        except Exception as e:
            print(f"Warning: Failed parsing {log_file}: {e}")
            
    # Compute Re fallback if not extracted
    if results["Re"] == 0.0:
        lid_velocity = float(row.get("Lid Velocity [m/s]", 1.0))
        viscosity = float(row.get("Viscosity [m2/s]", 0.01))
        results["Re"] = abs(lid_velocity) * 0.1 / viscosity if viscosity > 0 else 0.0
        
    if results["Max Velocity [m/s]"] == 0.0:
        results["Max Velocity [m/s]"] = float(row.get("Lid Velocity [m/s]", 1.0))
        
    return results
