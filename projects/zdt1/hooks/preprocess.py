from pathlib import Path
import csv

def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    """
    Pre-processing Hook for ZDT1
    ---------------------------
    Takes a row of input parameters and writes them to input.csv in the run directory.
    """
    x_cols = sorted([k for k in row.keys() if k.startswith("x") and k[1:].isdigit()], key=lambda c: int(c[1:]))
    input_file = run_dir / "input.csv"
    with open(input_file, mode="w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(x_cols)
        writer.writerow([row[col] for col in x_cols])
