from pathlib import Path

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Extraction Hook
    ---------------
    Runs after the CLI application finishes. Parses the application's output
    (stdout, generated files, etc.), extracts parameters of interest, and returns
    them as a dictionary to be merged back into the master CSV.
    
    Parameters:
      - row: dictionary representing the parameters.
      - state: shared global state dictionary.
      - run_dir: absolute Path to the row-level execution directory.
      
    Returns:
      - dict: extracted key-value pairs to merge into the CSV.
    """
    # Example reading output.csv from the run_dir
    import csv
    output_file = run_dir / "output.csv"
    results = {}
    if output_file.exists():
        with open(output_file, mode="r") as f:
            reader = csv.DictReader(f)
            for r in reader:
                results.update(r)
    else:
        # Default mock output
        results = {"f_value": 0.0}
        
    return results
