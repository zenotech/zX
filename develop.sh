#!/bin/bash
# develop.sh - Compile and start the zX Parametric Exploration App in development mode

set -e

# Change directory to the repository root
cd "$(dirname "$0")"

echo "=================================================="
echo " Starting zX Development Environment"
echo "=================================================="

# 1. Check if Node dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "Node modules not found. Installing dependencies..."
  npm install
else
  echo "Node modules verified."
fi

# 2. Check Python virtual environment
if [ -d ".venv" ]; then
  echo "Python virtual environment found."
  # Activate virtual environment to make sure python libraries (uvicorn, pandas, etc.) are available
  source .venv/bin/activate
  echo "Activated virtual environment: $(which python)"
else
  echo "WARNING: Python virtual environment (.venv) not found. FastAPI backend may fail to start."
fi

# 3. Free up port 8000 if it is already in use
echo "Checking if port 8000 is in use..."
PORT_PID=$(lsof -t -i :8000 || true)
if [ ! -z "$PORT_PID" ]; then
  echo "Killing stray process on port 8000 (PID: $PORT_PID)..."
  kill -9 $PORT_PID || true
fi

# 4. Clean any stale builds
echo "Cleaning stale electron distribution outputs..."
rm -rf dist-electron dist

# 5. Build Python backend wheel package
echo "Building Python backend wheel package..."
if command -v uv &> /dev/null; then
  (cd backend && uv build --wheel)
else
  echo "WARNING: 'uv' is not installed. Attempting to build backend wheel using standard python3 'build' module..."
  (cd backend && python3 -m pip install --quiet build || true)
  (cd backend && python3 -m build --wheel)
fi

# 6. Start Vite dev server & Electron dev shell concurrently
echo "Launching Vite development server and Electron dev shell..."
npm run dev:all
