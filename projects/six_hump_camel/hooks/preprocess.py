from pathlib import Path
import csv

def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    """
    Pre-processing Hook for Six-Hump Camel
    --------------------------------------
    Takes a row of input parameters and writes them to input.csv in the run directory.
    """
    input_file = run_dir / "input.csv"
    with open(input_file, mode="w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["x1", "x2"])
        writer.writerow([row["x1"], row["x2"]])
