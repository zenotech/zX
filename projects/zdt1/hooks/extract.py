from pathlib import Path
import csv

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Extraction Hook for ZDT1
    -----------------------
    Extracts the evaluated f1 and f2 values from the output.csv in the execution run directory.
    """
    output_file = run_dir / "output.csv"
    results = {}
    if output_file.exists():
        with open(output_file, mode="r") as f:
            reader = csv.DictReader(f)
            for r in reader:
                results.update(r)
    else:
        results = {"f1": 999.0, "f2": 999.0}
        
    if "f1" in results:
        results["f1"] = float(results["f1"])
    if "f2" in results:
        results["f2"] = float(results["f2"])
    return results
