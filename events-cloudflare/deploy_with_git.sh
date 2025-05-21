#!/bin/bash

# Colors for better readability
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}===== DevService Worker Deployment Script =====${NC}"
echo -e "This script will commit changes, push to GitHub dev branch, and deploy the Worker"

# 1. Create dev branch if it doesn't exist
if ! git show-ref --verify --quiet refs/heads/dev; then
  echo -e "\n${YELLOW}Creating dev branch...${NC}"
  git checkout -b dev
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to create dev branch${NC}"
    exit 1
  fi
else
  echo -e "\n${YELLOW}Switching to dev branch...${NC}"
  git checkout dev
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to switch to dev branch${NC}"
    exit 1
  fi
fi

# 2. Create a secrets-free version of wrangler.toml for Git
echo -e "\n${YELLOW}Creating secrets-safe version for Git...${NC}"

# Create wrangler.example.toml with placeholder values
if [ -f "wrangler.toml" ]; then
  cp wrangler.toml wrangler.example.toml
  # Replace actual secrets with placeholders
  sed -i '' 's/NOTION_TOKEN = ".*"/NOTION_TOKEN = "your_notion_secret_token"/g' wrangler.example.toml
  sed -i '' 's/NOTION_DATABASE_ID = ".*"/NOTION_DATABASE_ID = "your_events_database_id"/g' wrangler.example.toml
  sed -i '' 's/NOTION_PEOPLE_DATABASE_ID = ".*"/NOTION_PEOPLE_DATABASE_ID = "your_people_database_id"/g' wrangler.example.toml
  sed -i '' 's/NOTION_PRODUCTS_DATABASE_ID = ".*"/NOTION_PRODUCTS_DATABASE_ID = "your_products_database_id"/g' wrangler.example.toml
  sed -i '' 's/STRIPE_SECRET_KEY = ".*"/STRIPE_SECRET_KEY = "your_stripe_secret_key"/g' wrangler.example.toml
  echo -e "${GREEN}Created wrangler.example.toml with placeholders${NC}"
fi

# 3. Stage changes (excluding secrets)
echo -e "\n${YELLOW}Staging changes (excluding secrets)...${NC}"
# Make sure wrangler.toml is in .gitignore
if ! grep -q "wrangler.toml" .gitignore; then
  echo "wrangler.toml" >> .gitignore
  echo -e "${GREEN}Added wrangler.toml to .gitignore${NC}"
fi

# Stage all changes except secrets
git add .
if [ $? -ne 0 ]; then
  echo -e "${RED}Failed to stage changes${NC}"
  exit 1
fi

# 3. Commit changes
echo -e "\n${YELLOW}Enter commit message (e.g., 'Add image support to events'):${NC}"
read COMMIT_MESSAGE

if [ -z "$COMMIT_MESSAGE" ]; then
  COMMIT_MESSAGE="Update worker $(date +%Y-%m-%d)"
fi

git commit -m "$COMMIT_MESSAGE"
if [ $? -ne 0 ]; then
  echo -e "${RED}Failed to commit changes${NC}"
  exit 1
fi

# 4. Push to GitHub
echo -e "\n${YELLOW}Pushing to GitHub dev branch...${NC}"
git push -u origin dev
if [ $? -ne 0 ]; then
  echo -e "${RED}Failed to push to GitHub. Try:${NC}"
  echo "  1. git push --set-upstream origin dev"
  echo "  2. Re-run this script"
  exit 1
fi

# 5. Deploy Worker
echo -e "\n${YELLOW}Deploying Worker...${NC}"

# Try to find wrangler
WRANGLER_PATH=$(which wrangler 2>/dev/null)

if [ -z "$WRANGLER_PATH" ]; then
  # Try common locations
  WRANGLER_PATH=$(find ~/.nvm -name wrangler -type f -executable 2>/dev/null | head -n 1)
fi

if [ -z "$WRANGLER_PATH" ]; then
  WRANGLER_PATH=$(find ~/.npm -name wrangler -type f -executable 2>/dev/null | head -n 1)
fi

if [ -z "$WRANGLER_PATH" ]; then
  WRANGLER_PATH=$(find /usr/local -name wrangler -type f -executable 2>/dev/null | head -n 1)
fi

# If wrangler is found, use it
if [ -n "$WRANGLER_PATH" ]; then
  echo -e "Found wrangler at: $WRANGLER_PATH"
  "$WRANGLER_PATH" deploy
  DEPLOY_STATUS=$?
else
  # If wrangler is not found, prompt for manual deployment
  echo -e "${YELLOW}Wrangler not found. Please choose a deployment method:${NC}"
  echo "1. Enter path to wrangler executable"
  echo "2. Deploy via Cloudflare Dashboard"
  read -p "Choice (1/2): " DEPLOY_CHOICE
  
  if [ "$DEPLOY_CHOICE" == "1" ]; then
    read -p "Enter path to wrangler: " WRANGLER_PATH
    if [ -f "$WRANGLER_PATH" ]; then
      "$WRANGLER_PATH" deploy
      DEPLOY_STATUS=$?
    else
      echo -e "${RED}Invalid path provided.${NC}"
      DEPLOY_STATUS=1
    fi
  else
    echo -e "${YELLOW}Please deploy manually via Cloudflare Dashboard:${NC}"
    echo "1. Go to https://dash.cloudflare.com"
    echo "2. Navigate to Workers & Pages"
    echo "3. Find your Worker and click 'Quick Edit'"
    echo "4. Upload the updated files from the src/ directory"
    DEPLOY_STATUS=0
  fi
fi

# 6. Report completion
if [ $DEPLOY_STATUS -eq 0 ]; then
  echo -e "\n${GREEN}===== Deployment Complete! =====${NC}"
  echo -e "✅ Changes committed to Git"
  echo -e "✅ Pushed to GitHub dev branch"
  echo -e "✅ Worker deployment initiated"
  echo -e "\n${YELLOW}Your updated Worker with image support should now be live!${NC}"
else
  echo -e "\n${YELLOW}===== Deployment Partially Complete =====${NC}"
  echo -e "✅ Changes committed to Git"
  echo -e "✅ Pushed to GitHub dev branch"
  echo -e "❌ Worker deployment failed"
  echo -e "\n${YELLOW}Please deploy the Worker manually via Cloudflare Dashboard.${NC}"
fi
