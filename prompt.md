# Project Overview: zX Parametric Exploration App

You are tasked with building "zX", a powerful desktop web application that allows users to perform parametric explorations of command-line applications (CLI) running either locally or remotely.

## Technology Stack
- **Desktop/Frontend:** Electron wrapping a modern web framework (e.g., React + Vite or Next.js).
- **Backend/Orchestration:** Python FastAPI server (using `pandas` or `csv` module for data handling).
- **Remote Communication:** `paramiko` or `fabric` (for handling SSH connections).
- **Data Storage:** CSV files on disk.

## Core Features & Requirements

### 1. Connection Management
- The UI must allow the user to select the execution environment: **Local** or **Remote**.
- **Remote Execution:** The backend must parse the user's `~/.ssh/config` file and serve a list of available hosts. The UI should present these hosts in a dropdown for the user to select.

### 2. Input Parameter Management & Modification
- The user must be able to create a zX project directory that will be used for storing the database and for executing the command line application.
- The user must be able to specify a range of input parameters. The application should support two methods for this:
  1. Uploading or specifying the path to an existing CSV file on local disk.
  2. Providing a Python snippet/function that procedurally generates and returns the matrix of input parameters.
- **Editable Data Grid:** Once the input parameters are loaded or generated, the UI must present them in an interactive, editable table (e.g., using Ag-Grid or a similar data grid library). The user must be able to manually modify, add, or delete input parameters directly from the UI before starting the exploration.
- The user must be able to visually select rows or via a range selection tool to initiate the execution of parameteric exploration on the selected rows. Also enable the user to dry run the execution of the parameteric exploration on the selected rows.
- The user must be able to choose which python hooks to execute (pre-processing, launch, extraction). Default to all hooks

### 3. Dynamic Python Hook Execution
The UI must provide a code editor interface (e.g., Monaco Editor) for the user to define Python snippets/functions. The python functions will require the database row as input and shared global state initialised by the user. Provide the ability to dry run the functions as well as the ability to force the execution of a function on a row that has already been processed.

**Crucial:** Except for the generation hook (which can run locally), these Python functions MUST be executed on the target system (either local or the selected remote SSH server) where the CLI application runs.

1. **Parameter Generation Hook (Optional):** A Python function that runs locally to populate the initial input parameters if a CSV is not provided.
2. **Pre-processing Hook:** A Python function that takes a set of input parameters and converts them into the necessary configuration files or arguments required by the CLI app.
3. **Launch Hook:** A Python function/command that triggers the execution of the CLI application.
4. **Extraction Hook:** A Python function that runs after the CLI app finishes. It must parse the application's output, extract the parameters of interest, and return them.

### 4. Asynchronous Execution & State Management
- **Long-Running Executions:** CLI applications can run for a long time. The FastAPI backend must orchestrate the parametric loop asynchronously.
- **Reconnection & Resilience:** The UI might be closed while an exploration is running remotely. Upon reopening the Electron app, the UI must fetch the current status of the active exploration from the FastAPI server and seamlessly resume updating the status (e.g., showing which tasks are pending, running, completed, or failed).

### 5. CSV Data Storage & Visualization Dashboard
- **CSV Storage:** The system must maintain a master CSV file on disk acting as the primary database. As the "Extraction Hook" finishes for each run, the newly extracted output parameters must be appended to or merged with their corresponding input rows in this CSV file.
- **Visualization:** The UI must include a visualization tab to explore the contents of this CSV file. This should include charting capabilities (e.g., scatter plots, line charts) to analyze the relationship between inputs and outputs.

## Design & Aesthetics
- Implement a premium, modern design system.
- Use a sleek dark mode, vibrant accent colors, and smooth micro-animations. 
- The application should feel like a high-end, professional developer/scientist tool with a highly responsive parameter data grid. No generic unstyled HTML.

## Implementation Steps
1. Initialize the FastAPI backend and configure CSV file parsing/saving mechanisms.
2. Build the Electron + Frontend skeleton with a highly polished design.
3. Implement the SSH config parser and the connection selection UI.
4. Build the Parameter Management view containing the editable data grid and the optional Python generation hook editor.
5. Integrate the code editor components for the Pre-processing, Launch, and Extraction hooks.
6. Build the async remote/local execution engine in FastAPI that runs the provided Python hooks on the targeted servers and appends results to the CSV.
7. Build the visualization dashboard reading from the CSV.
