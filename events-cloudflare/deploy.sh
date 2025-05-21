#!/bin/bash

# Find the wrangler executable
WRANGLER_PATH=$(find ~/.nvm -name wrangler -type f -executable 2>/dev/null | head -n 1)

if [ -z "$WRANGLER_PATH" ]; then
  WRANGLER_PATH=$(find ~/.npm -name wrangler -type f -executable 2>/dev/null | head -n 1)
fi

if [ -z "$WRANGLER_PATH" ]; then
  WRANGLER_PATH=$(find /usr/local -name wrangler -type f -executable 2>/dev/null | head -n 1)
fi

if [ -z "$WRANGLER_PATH" ]; then
  echo "Could not find wrangler executable. Please provide the path:"
  read -p "> " WRANGLER_PATH
fi

if [ -z "$WRANGLER_PATH" ] || [ ! -f "$WRANGLER_PATH" ]; then
  echo "Error: No valid wrangler path provided."
  exit 1
fi

echo "Found wrangler at: $WRANGLER_PATH"
echo "Deploying worker..."

# Run wrangler deploy
"$WRANGLER_PATH" deploy

echo "Deployment complete!"
