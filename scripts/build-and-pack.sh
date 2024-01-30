#!/bin/bash

# Stop on error.
set -e

# Echo commands.
set -x

# Get the directory of the script.
SCRIPT_DIR=$(dirname $(readlink -f $0))

# Get the directory of the project.
PROJECT_BASE_DIR=$(dirname $SCRIPT_DIR)

# Change to the project directory.
cd $PROJECT_BASE_DIR

# Install dependencies, build, and test.
npm ci
npm run build
npm run test

# Create a tarball.
npm pack
