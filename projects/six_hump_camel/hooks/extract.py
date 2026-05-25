from pathlib import Path
import csv

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Extraction Hook for Six-Hump Camel
    ----------------------------------
    Extracts the evaluated f_value from the output.csv in the execution run directory.
    """
    output_file = run_dir / "output.csv"
    results = {}
    if output_file.exists():
        with open(output_file, mode="r") as f:
            reader = csv.DictReader(f)
            for r in reader:
                results.update(r)
    else:
        results = {"f_value": 999.0}
        
    if "f_value" in results:
        results["f_value"] = float(results["f_value"])
    return results
