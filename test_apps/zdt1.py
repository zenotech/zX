import sys
import math
import pandas as pd

def evaluate_zdt1(vars_list: list[float]) -> tuple[float, float]:
    f1 = vars_list[0]
    
    # g(x) calculation
    m = len(vars_list)
    if m > 1:
        sum_x = sum(vars_list[1:])
        g = 1.0 + (9.0 / (m - 1.0)) * sum_x
    else:
        g = 1.0
        
    # h(f1, g) calculation
    if g == 0.0:
        h = 0.0
    else:
        # Prevent math domain errors
        ratio = max(0.0, f1 / g)
        h = 1.0 - math.sqrt(ratio)
        
    f2 = g * h
    return f1, f2

def main():
    try:
        df = pd.read_csv("input.csv")
        # Find all decision variables: columns starting with 'x' followed by a number
        x_cols = sorted([col for col in df.columns if col.startswith("x") and col[1:].isdigit()], key=lambda c: int(c[1:]))
        
        if not x_cols:
            print("Error: Input CSV must contain decision variable columns like 'x1', 'x2', etc.", file=sys.stderr)
            sys.exit(1)
            
        vars_list = [float(df.loc[0, col]) for col in x_cols]
        f1, f2 = evaluate_zdt1(vars_list)
        
        out_df = pd.DataFrame([{"f1": f1, "f2": f2}])
        out_df.to_csv("output.csv", index=False)
        print(f"ZDT1 successfully evaluated. m={len(vars_list)}, f1={f1:.6f}, f2={f2:.6f}")
    except Exception as e:
        print(f"Error executing ZDT1 script: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
