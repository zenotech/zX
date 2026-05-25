import sys
import pandas as pd

def six_hump_camel(x1: float, x2: float) -> float:
    term1 = (4.0 - 2.1 * x1**2 + (x1**4) / 3.0) * x1**2
    term2 = x1 * x2
    term3 = (-4.0 + 4.0 * x2**2) * x2**2
    return term1 + term2 + term3

def main():
    try:
        # Read from input.csv in the current execution folder
        df = pd.read_csv("input.csv")
        if "x1" not in df.columns or "x2" not in df.columns:
            print("Error: Input CSV must contain 'x1' and 'x2' columns.", file=sys.stderr)
            sys.exit(1)
        
        x1 = float(df.loc[0, "x1"])
        x2 = float(df.loc[0, "x2"])
        f_val = six_hump_camel(x1, x2)
        
        out_df = pd.DataFrame([{"f_value": f_val}])
        out_df.to_csv("output.csv", index=False)
        print(f"Six-Hump Camel successfully evaluated. x1={x1:.6f}, x2={x2:.6f}, f(x1,x2)={f_val:.6f}")
    except Exception as e:
        print(f"Error executing Six-Hump Camel script: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
