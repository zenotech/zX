#!/bin/bash
# package.sh - Compile and package the zX Parametric Exploration App for production

set -e

# Change directory to the repository root
cd "$(dirname "$0")"

echo "=================================================="
echo " Starting zX Production Packaging Process"
echo "=================================================="

# Disable automatic keychain code signing discovery for local packaging
#export CSC_IDENTITY_AUTO_DISCOVERY=false
export DEBUG="electron-builder,electron-osx-sign*,electron-notarize*"
export DEBUG_DMG=true
export APPLE_ID=jamil.appa@zenotech.com
export APPLE_APP_SPECIFIC_PASSWORD=uedy-sedx-xfji-hslx
export APPLE_TEAM_ID=HDDG45ZM4G

# 1. Check if Node dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "Node modules not found. Installing dependencies..."
  npm install
else
  echo "Node modules verified."
fi

# 2. Clean stale outputs
echo "Cleaning stale build outputs..."
rm -rf dist dist-electron release

# 3. Build Python backend wheel package
echo "Building Python backend wheel package..."
if [ -d ".venv" ]; then
  echo "Using active python virtual environment to build backend..."
  source .venv/bin/activate
fi

if command -v uv &> /dev/null; then
  echo "Using 'uv' to build the wheel package..."
  (cd backend && uv build --wheel)
else
  echo "WARNING: 'uv' is not installed. Attempting to build backend wheel using standard python3 'build' module..."
  (cd backend && python3 -m pip install --quiet build || true)
  (cd backend && python3 -m build --wheel)
fi

# 4. Compile and package the Electron app
echo "Compiling Electron code, building Vite frontend, and packaging app..."
npm run package

echo "=================================================="
echo " zX Application Packaged Successfully!"
echo " Check the 'release' directory for output."
echo "=================================================="
