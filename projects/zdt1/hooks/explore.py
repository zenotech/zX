import numpy as np
import pandas as pd
from pandas import DataFrame

def is_dominated(row, candidates):
    f1, f2 = row["f1"], row["f2"]
    for c in candidates:
        c1, c2 = c["f1"], c["f2"]
        if (c1 <= f1 and c2 <= f2) and (c1 < f1 or c2 < f2):
            return True
    return False

def explore(table: DataFrame, state: dict) -> list[dict]:
    """
    Exploration Hook for ZDT1
    ------------------------
    Implements a multi-objective Genetic Algorithm (GA) step.
    Selects the non-dominated Pareto front and performs crossover/mutation
    to propose 4 new offspring.
    """
    max_iter = state.get("max_iterations", 3)
    current_iter = state.get("current_iteration", 0)
    
    if current_iter >= max_iter:
        print(f"Reached max iterations limit ({max_iter}). Terminating ZDT1 GA loop.")
        return []
        
    state["current_iteration"] = current_iter + 1
    
    completed = table[table["_zx_status"] == "completed"].copy()
    if len(completed) < 4:
        return [{f"x{j+1}": round(np.random.uniform(0.0, 1.0), 4) for j in range(10)}]
        
    x_cols = sorted([col for col in completed.columns if col.startswith("x") and col[1:].isdigit()], key=lambda c: int(c[1:]))
    
    population = completed.to_dict(orient="records")
    pareto_front = []
    for p in population:
        if not is_dominated(p, population):
            pareto_front.append(p)
            
    print(f"GA Iteration {current_iter}: Pareto Front contains {len(pareto_front)} / {len(completed)} solutions.")
    
    # Generate 4 offspring using crossover and mutation
    offspring = []
    rng = np.random.default_rng(seed=100 + current_iter)
    
    for _ in range(4):
        parents_pool = pareto_front if len(pareto_front) >= 2 else population
        parent1 = rng.choice(parents_pool)
        parent2 = rng.choice(parents_pool)
        
        child = {}
        for col in x_cols:
            v1, v2 = float(parent1[col]), float(parent2[col])
            alpha = rng.uniform(-0.1, 1.1)
            val = v1 + alpha * (v2 - v1)
            
            if rng.random() < 0.2:
                val += rng.normal(0.0, 0.1)
                
            val = np.clip(val, 0.0, 1.0)
            child[col] = round(float(val), 4)
            
        offspring.append(child)
        
    return offspring
