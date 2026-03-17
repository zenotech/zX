# Project Overview: zX Parametric Exploration App

You are tasked with building "zX", a powerful desktop web application that allows users to perform parametric explorations of command-line applications (CLI) running either locally or remotely.

## Technology Stack

- **Desktop/Frontend:** Electron wrapping a modern web framework using React + Vite.
- **Backend/Orchestration:** Python FastAPI server (using `pandas` or `csv` module for data handling).
- **Remote Communication:** Research and select a well-maintained Node.js SSH2 library for handling SSH connections, SCP file transfer, and port forwarding.
- **Data Storage:** CSV files on disk.
- **Charting:** Plotly (Python figures serialized as Plotly JSON, rendered via `react-plotly.js` on the frontend).

---

## Core Features & Requirements

### 1. Connection Management

- The UI must allow the user to select the execution environment: **Local** or **Remote**.
- **Local Execution:** The Electron app must start the FastAPI backend as a child process.
- **Remote Execution:**
  - The backend must parse the user's `~/.ssh/config` file and serve a list of available hosts. The UI should present these hosts in a dropdown for the user to select.
  - Use SSH local port forwarding to tunnel the remote FastAPI server back to the Electron app.
  - Bootstrap `uv` on the remote server via `curl`. If `curl` installation fails, fall back to using the system-installed version of Python.
  - Download `uv` Python into `~/.zx/python` on the server and install all backend server requirements.
  - The Electron app must SCP a wheel (`.whl`) of the backend server application to the server and install it into `~/.zx/backend`.
- **Security:** Generate a random authentication token on the client. Pass this token to the backend on startup. All API calls from the Electron app to the FastAPI backend must include this token. The backend must reject any request without a valid token.
- **Status Bar:** Show the connection status (disconnected, connecting, connected, error) in a persistent status bar at the bottom of the application.

---

### 2. Project Management

- The user must be able to create a **zX project directory** on the target system (local or remote) that stores the CSV database, hook scripts, run directories, and log files.
- The app manages a **single project at a time**, but must include a **project selector / recent projects list** to switch between previously opened projects.
- When a new project is created, the system must copy default (empty) hook template files from the app's bundled template directory (shipped as part of the Electron app's packaged resources) into the project's `hooks/` directory.
- App-level settings (recent projects list, last connection used, window geometry) are persisted in Electron's `userData` directory.
- See the [Project Directory Structure](#project-directory-structure) section for the expected layout.

---

### 3. Input Parameter Management & Modification

- The user must be able to specify input parameters via two methods:
  1. Uploading or specifying the path to an existing CSV file.
  2. Providing a Python snippet/function (the **Initialization Hook**) that procedurally generates and returns both the input parameters and an optional shared global state dictionary.
- **Editable Data Grid:** Once the input parameters are loaded or generated, the UI must present them in an interactive, editable table (e.g., Ag-Grid or similar). The user must be able to manually modify, add, or delete rows directly from the UI before starting exploration.
- **CSV editing must be disabled** while the Extraction Hook is running to prevent data corruption.
- The user must be able to visually select rows (individually, via multi-select, or via a range selection tool) to initiate execution on a subset of parameters.
- The user must be able to choose which hooks to execute (pre-processing, launch, extraction, exploration). Default to all hooks. Hooks execute in order: pre-processing → launch → extraction → exploration (if enabled and defined).
- The user must be able to **dry run** the selected rows. A dry run prints the commands and operations that would be performed **without executing or changing any state**.
- The user must be able to **force re-execution** on rows that have already been processed. Force re-execution clears the corresponding `run_{row_id}/` directory before re-running. If the Exploration Hook is enabled, force re-execution also re-triggers the exploration loop.
- **Cancellation:** Provide a **Stop** button that halts execution after the current row completes. All remaining unprocessed rows retain their current status (e.g., `pending`). The user can resume or re-select rows to continue later.

---

### 4. Dynamic Python Hook Execution

The UI must provide a code editor interface (e.g., Monaco Editor) for the user to define Python snippets/functions. Hook scripts are persisted in the project's `hooks/` directory.

**Crucial:** All Python hooks MUST be executed on the target system (local or the selected remote SSH server) where the CLI application runs. When a hook is saved, the UI must test it on the target system to ensure it is valid Python and highlight any syntax errors before execution.

Each hook (except Initialization) receives the current database row as a `dict`, a shared `state` dict (initialized by the Initialization Hook), and the `run_dir` path.

When a new project is created, default empty hook files are copied from the app's bundled template directory into `hooks/`.

#### Hook Definitions

1. **Initialization Hook (Optional)**
   - Populates the initial input parameters and/or transforms an existing CSV.
   - If no CSV is provided, the hook receives an **empty DataFrame**. The hook can generate rows from scratch (e.g., Design of Experiments).
   - If a CSV is provided, the hook receives a DataFrame containing the CSV data. The hook can transform, filter, or augment the data.
   - Also initializes a shared global `state` dictionary that is passed to all subsequent hooks. The `state` dict can include control parameters such as `max_iterations` for the Exploration Hook.
   ```python
   def initialize(table: DataFrame, state: dict) -> tuple[list[dict], dict]:
       """
       Returns (rows, state).
         - rows: list of input parameter dicts (one dict per row).
         - state: shared global state dict passed to all subsequent hooks.
       If table is empty, generate rows from scratch (e.g., DOE).
       If table has data, transform/augment it as needed.
       """
       ...
   ```

2. **Pre-processing Hook**
   - Takes a row of input parameters and converts them into configuration files, input decks, or arguments required by the CLI app.
   - Before calling this hook, the system must create a unique directory `run_{row_id}/` within the project directory and execute the hook inside that directory.
   ```python
   def preprocess(row: dict, state: dict, run_dir: Path) -> None:
       """Prepare input files/config in run_dir for the CLI application."""
       ...
   ```

3. **Launch Hook (Synchronous)**
   - Triggers execution of the CLI application. This hook is **synchronous** — each row is executed sequentially.
   - If the user's CLI application is long-running, the user should background the process within the hook and signal completion via the presence of a sentinel file (e.g., `run_dir / "DONE"`).
   - Executes in the same `run_{row_id}/` directory as the Pre-processing Hook.
   ```python
   def launch(row: dict, state: dict, run_dir: Path) -> subprocess.CompletedProcess:
       """Launch the CLI application in run_dir. Returns the completed process."""
       ...
   ```

4. **Extraction Hook**
   - Runs after the CLI app finishes. Parses the application's output (stdout, generated files, etc.), extracts parameters of interest, and returns them as a dictionary.
   - The returned dict is merged into the corresponding row in the master CSV.
   - If the returned dict contains keys not already present in the CSV, **new columns are added dynamically**. Existing rows that lack these columns are filled with empty strings / `NaN`.
   - Executes in the same `run_{row_id}/` directory.
   ```python
   def extract(row: dict, state: dict, run_dir: Path) -> dict:
       """Extract output parameters from run_dir. Returns dict of results to merge into CSV."""
       ...
   ```

5. **Exploration Hook (Optional)**
   - Called **after all selected rows have completed** the extraction phase.
   - Runs in the **project root directory** (not inside any `run_{row_id}/`).
   - Receives the full database as a DataFrame and the shared state. Analyzes the results and returns a list of new row dicts to append to the database.
   - New rows are appended to the bottom of the CSV and receive the next sequential `row_id` values.
   - If it returns a **non-empty list**, the system automatically cascades: the new rows trigger pre-processing → launch → extraction → exploration again, forming an iterative optimization loop.
   - If it returns an **empty list** (the default), the loop terminates. Use `state["max_iterations"]` (or similar) as a termination condition to prevent infinite loops.
   ```python
   def explore(table: DataFrame, state: dict) -> list[dict]:
       """
       Analyze completed results and generate new parameter sets.
       Return an empty list to terminate the exploration loop.
       Use state['max_iterations'] to limit iterations.
       """
       ...
   ```

#### Hook Execution Rules

- **Logging:** Capture stdout and stderr from every hook execution and store them per-row in `run_{row_id}/zx_hook.log`, viewable from the UI.
- **Error Handling:** If a hook fails, display an error dialog showing the full traceback. The user can fix the hook in the editor and re-run only the failed rows.
- **Dry Run:** Print the commands/operations without executing or modifying any state.
- **Force Re-run:** Clear the `run_{row_id}/` directory and re-execute from the selected hook onwards. If the Exploration Hook is enabled, it is also re-triggered.
- **Syntax Validation:** When a hook is saved in the editor, validate it on the target system and display syntax errors inline.

---

### 5. Asynchronous Execution & State Management

- **Sequential Execution:** The Launch Hook is synchronous — rows are processed one at a time in sequence.
- **Long-Running Executions:** The FastAPI backend must orchestrate the parametric loop asynchronously (non-blocking to the API event loop) even though individual rows run sequentially.
- **Exploration Loop:** When the Exploration Hook is enabled, the system iterates: run selected hooks on rows → exploration generates new rows → run hooks on new rows → repeat until the exploration hook returns an empty list or `max_iterations` is reached.
- **Cancellation:** The user can stop execution at any time. The system finishes the current row and halts. Remaining rows stay as `pending`.
- **Reconnection & Resilience:** The UI might be closed while an exploration is running remotely. Upon reopening the Electron app, the UI must fetch the current status of the active exploration from the FastAPI server and seamlessly resume displaying progress (pending, running, completed, failed).

---

### 6. CSV Data Storage & Visualization Dashboard

#### CSV Storage

- The system must maintain a master CSV file (`zx_database.csv`) on disk acting as the primary data store.
- As the Extraction Hook finishes for each row, the extracted output parameters are merged into the corresponding input row in this CSV file.
- **Dynamic columns:** If an extraction returns keys not already in the CSV, new columns are added. Pre-existing rows without these columns are filled with empty strings / `NaN`.

#### Reserved Columns (Data Model)

The following `_zx_` prefixed columns are automatically managed by the system and added to the CSV when the Launch Hook is first called:

| Column              | Type     | Description                                                  |
|---------------------|----------|--------------------------------------------------------------|
| `_zx_row_id`        | `int`    | Row index from the CSV (0-based, sequential).                |
| `_zx_status`        | `string` | One of: `pending`, `running`, `completed`, `failed`.         |
| `_zx_hook_stage`    | `string` | Current hook stage: `preprocessing`, `launching`, `extracting`, `exploring`, or empty when idle. |
| `_zx_run_dir`       | `string` | Path to the `run_{row_id}/` directory.                       |
| `_zx_started_at`    | `string` | ISO 8601 timestamp of when execution started.                |
| `_zx_completed_at`  | `string` | ISO 8601 timestamp of when execution finished.               |
| `_zx_error`         | `string` | Error message / traceback if the row failed.                 |
| `_zx_iteration`     | `int`    | Exploration iteration number (0 for initial rows, increments per exploration cycle). |

#### Visualization

- The UI must include a visualization tab to explore the CSV contents.
- Include charting capabilities (scatter plots, line charts, histograms) to analyze relationships between input and output parameters.
- Charts should support axis selection from any CSV column.
- Enable the user to create `hooks/plot.py` to define custom visualizations:
  ```python
  def plot(table: DataFrame, state: dict) -> dict:
      """
      Generate custom plots.
      Returns a dictionary of plotly figure objects.
      Figures are serialized as Plotly JSON and rendered via react-plotly.js.
      """
      ...
  ```

---

### 7. Terminal Access

- Provide a full interactive shell terminal on the target system (local or remote).
- The terminal should support a split-view layout that can be divided into multiple terminal panes.
- The terminal is not scoped to any specific directory — it is a general-purpose shell.

---

### 8. File Explorer

- Provide a file explorer panel for the target system, rooted at the zX project directory.
- The explorer must support:
  - **Viewing** files and directories.
  - **Deleting** files and directories.
  - **Renaming** files and directories.
- Styled similarly to VS Code / Antigravity's file explorer with a tree-view layout.

---

## Project Directory Structure

The following directory layout is created on the target system (local or remote) for each zX project:

```
~/my-exploration/              # zX project directory (user-specified)
├── zx_database.csv            # Master CSV (input params + extracted outputs + status columns)
├── hooks/                     # Persisted Python hook scripts
│   ├── initialize.py          # Initialization Hook (optional)
│   ├── preprocess.py          # Pre-processing Hook
│   ├── launch.py              # Launch Hook
│   ├── extract.py             # Extraction Hook
│   ├── explore.py             # Exploration Hook (optional)
│   └── plot.py                # Visualization Hook (optional)
├── run_0/                     # Per-row execution directory (row_id = 0)
│   ├── zx_hook.log            # Captured stdout/stderr from hook execution
│   └── ...                    # User-generated input/output files
├── run_1/                     # Per-row execution directory (row_id = 1)
│   ├── zx_hook.log
│   └── ...
└── ...
```

---

## Communication Protocol

| Channel                  | Mechanism                     | Purpose                                          |
|--------------------------|-------------------------------|--------------------------------------------------|
| Electron ↔ FastAPI       | REST API + WebSockets         | Commands, data queries, real-time status updates. |
| Electron → Remote Server | SSH (SCP + port forwarding)   | Deploy backend wheel, establish tunnel.          |
| FastAPI ↔ CLI App        | `subprocess` / shell exec     | Execute hooks and CLI applications.              |
| Auth                     | Random token (per session)    | Secure all API communication.                    |

---

## Design & Aesthetics

- Implement a premium, modern design system.
- Use a sleek dark mode, vibrant accent colors, and smooth micro-animations.
- The application should feel like a high-end, professional developer/scientist tool with a highly responsive parameter data grid. No generic unstyled HTML.

---

## Implementation Steps

1. Bootstrap the Electron + React + Vite skeleton with a polished design system.
2. Initialize the FastAPI backend, package it as a wheel, and implement the local child-process and remote SCP+SSH deployment flow.
3. Implement connection management (local/remote), SSH config parsing, port forwarding, and token-based auth.
4. Build the Project Management view (create project, recent projects list, template hook copying).
5. Build the Parameter Management view with editable data grid, CSV import, and the Initialization Hook editor.
6. Integrate Monaco Editor components for the Pre-processing, Launch, Extraction, Exploration, and Plot Hook editors with hook persistence to `hooks/` and syntax validation on save.
7. Build the synchronous sequential execution engine (hook runner) with row-level status tracking, hook-stage tracking, logging, dry-run, force re-run, and cancellation.
8. Build the exploration loop (auto-cascade with max iteration termination).
9. Build the Visualization Dashboard with configurable charts and custom plot hook support (Plotly JSON via `react-plotly.js`).
10. Implement the Terminal panel (full shell, split-view).
11. Implement the File Explorer panel (tree-view, view/delete/rename).
12. Implement reconnection and state resume on app reopen.

---

## Packaging

- The application must be packaged as a standalone installable for **macOS**, **Windows**, and **Linux** (e.g., using `electron-builder` or `electron-forge`).
- The package must bundle the hook template files, the backend wheel, and all frontend assets.

---

## Development Environment

- Generate scripts to enable live development:
  - `npm run dev` — starts Vite dev server with HMR for the frontend.
  - `npm run dev:electron` — starts the Electron shell pointing at the Vite dev server.
  - `uvicorn` or equivalent — starts the FastAPI backend in reload mode.
  - A combined `npm run dev:all` script that launches all three concurrently.

---

## Testing

To enable automated end-to-end testing of the system, generate the following Python CLI test applications. Each CLI app reads an input CSV and writes results to an output CSV. Populate the corresponding hooks to drive the full zX workflow.

### Test Case 1: Six-Hump Camel Function (Single-Objective Optimization)

- **CLI Application:** A Python script that reads `input.csv` (columns: `x1`, `x2`), evaluates the Six-Hump Camel function, and writes `output.csv` with the computed `f(x1, x2)` value.
- **Initialization Hook:** Use Design of Experiments (e.g., Latin Hypercube Sampling via `pyDOE2` or similar) to generate the initial parameter grid over the function's domain.
- **Pre-processing Hook:** Write the row's `x1`, `x2` values to `input.csv` in the run directory.
- **Launch Hook:** Execute the CLI script.
- **Extraction Hook:** Parse `output.csv` and return the objective value.
- **Exploration Hook:** Use Kriging surrogate modeling and gradient descent (e.g., via `scipy`, `scikit-learn`) to propose new sample points that converge toward the global minimum. Terminate when `state["max_iterations"]` is reached or improvement stalls.

### Test Case 2: ZDT1 Function (Multi-Objective Optimization)

- **CLI Application:** A Python script that reads `input.csv` (columns: decision variables), evaluates the ZDT1 bi-objective function, and writes `output.csv` with the two objective values `f1`, `f2`.
- **Initialization Hook:** Generate an initial population of decision variable vectors.
- **Pre-processing Hook:** Write the row's decision variables to `input.csv` in the run directory.
- **Launch Hook:** Execute the CLI script.
- **Extraction Hook:** Parse `output.csv` and return the objective values.
- **Exploration Hook:** Use a Genetic Algorithm (e.g., via `pymoo` or `DEAP`) to evolve the population toward the Pareto front. Terminate when `state["max_iterations"]` is reached.
