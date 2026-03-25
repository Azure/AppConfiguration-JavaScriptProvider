#!/bin/bash

# ============================================================================
# version-bump.sh
#
# Automates the version bump workflow for @azure/app-configuration-provider.
# Updates version in all required files, creates a branch, commits, pushes,
# and opens a PR via the GitHub CLI (gh).
#
# Usage:
#   ./scripts/version-bump.sh <new_version> [--preview]
#
# Examples:
#   ./scripts/version-bump.sh 2.5.0             # stable release → PR to main
#   ./scripts/version-bump.sh 2.5.1-preview --preview  # preview release → PR to preview
#
# Prerequisites:
#   - git, sed, and gh (GitHub CLI) must be installed and authenticated
# ============================================================================

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") <new_version> [--preview]

Arguments:
  new_version   The version to bump to (e.g. 2.5.0 or 2.5.1-preview)
  --preview     Target the preview branch instead of main

Examples:
  $(basename "$0") 2.5.0                    # stable → PR to main
  $(basename "$0") 2.5.1-preview --preview  # preview → PR to preview
EOF
  exit 1
}

error() {
  echo "ERROR: $1" >&2
  exit 1
}

info() {
  echo "── $1"
}

# ── Parse arguments ──────────────────────────────────────────────────────────

NEW_VERSION=""
IS_PREVIEW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preview)
      IS_PREVIEW=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      if [[ -z "$NEW_VERSION" ]]; then
        NEW_VERSION="$1"
      else
        error "Unexpected argument: $1"
      fi
      shift
      ;;
  esac
done

[[ -z "$NEW_VERSION" ]] && usage

# Validate version format: major.minor.patch or major.minor.patch-preview
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-preview)?$'; then
  error "Invalid version format '$NEW_VERSION'. Expected: X.Y.Z or X.Y.Z-preview"
fi

# If version ends with -preview, ensure --preview flag is set
if echo "$NEW_VERSION" | grep -qE '\-preview$'; then
  if [[ "$IS_PREVIEW" == false ]]; then
    error "Version '$NEW_VERSION' looks like a preview version. Did you forget --preview?"
  fi
fi

# ── Resolve paths & context ─────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

VERSION_TS="$PROJECT_DIR/src/version.ts"
PACKAGE_JSON="$PROJECT_DIR/package.json"
PACKAGE_LOCK="$PROJECT_DIR/package-lock.json"

# Determine target branch and branch prefix
if [[ "$IS_PREVIEW" == true ]]; then
  TARGET_BRANCH="preview"
else
  TARGET_BRANCH="main"
fi

# Get git username for branch naming (e.g. "linglingye" from "linglingye/version-2.4.0")
GIT_USERNAME=$(git config user.name 2>/dev/null || echo "")
if [[ -z "$GIT_USERNAME" ]]; then
  error "Could not determine git user.name. Please set it with: git config user.name <name>"
fi
# Use the first token (lowercase, no spaces) as the branch prefix
BRANCH_PREFIX=$(echo "$GIT_USERNAME" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')

BRANCH_NAME="${BRANCH_PREFIX}/version-${NEW_VERSION}"

# ── Show plan ─────────────────────────────────────────────────────────────────

info "New version     : $NEW_VERSION"
info "Target branch   : $TARGET_BRANCH"
info "New branch      : $BRANCH_NAME"
echo ""

# ── Confirm with user ────────────────────────────────────────────────────────

read -rp "Proceed? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""

# ── Create branch from target ────────────────────────────────────────────────

cd "$PROJECT_DIR"

info "Fetching latest $TARGET_BRANCH..."
git fetch origin "$TARGET_BRANCH"

info "Creating branch '$BRANCH_NAME' from origin/$TARGET_BRANCH..."
git checkout -b "$BRANCH_NAME" "origin/$TARGET_BRANCH"

# ── Read current version (after checkout so we read from the target branch) ──

CURRENT_VERSION=$(grep -oP 'VERSION = "\K[^"]+' "$VERSION_TS")
info "Current version : $CURRENT_VERSION"

if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
  error "Current version is already $NEW_VERSION. Nothing to do."
fi

# ── Update version in all files ──────────────────────────────────────────────

info "Updating src/version.ts..."
sed -i "s/export const VERSION = \"$CURRENT_VERSION\"/export const VERSION = \"$NEW_VERSION\"/" "$VERSION_TS"

info "Updating package.json..."
sed -i "0,/\"version\": \"$CURRENT_VERSION\"/s//\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"

info "Updating package-lock.json (line 3)..."
# package-lock.json has the version on line 3 and line 9 — update both
sed -i "0,/\"version\": \"$CURRENT_VERSION\"/s//\"version\": \"$NEW_VERSION\"/" "$PACKAGE_LOCK"

info "Updating package-lock.json (line 9)..."
sed -i "0,/\"version\": \"$CURRENT_VERSION\"/s//\"version\": \"$NEW_VERSION\"/" "$PACKAGE_LOCK"

# ── Verify changes ──────────────────────────────────────────────────────────

info "Verifying updates..."

verify_version() {
  local file="$1"
  local expected="$2"
  if ! grep -q "\"$expected\"" "$file" 2>/dev/null && ! grep -q "\"$expected\"" "$file" 2>/dev/null; then
    error "Version not found in $file after update. Please check manually."
  fi
}

# Check src/version.ts specifically
if ! grep -q "export const VERSION = \"$NEW_VERSION\"" "$VERSION_TS"; then
  error "Version not updated in src/version.ts"
fi
verify_version "$PACKAGE_JSON" "$NEW_VERSION"
verify_version "$PACKAGE_LOCK" "$NEW_VERSION"

info "All version files updated ✓"
echo ""

# ── Commit, push, and create PR ─────────────────────────────────────────────

COMMIT_MSG="version bump $NEW_VERSION"

info "Committing changes..."
git add "$VERSION_TS" "$PACKAGE_JSON" "$PACKAGE_LOCK"
git commit -m "$COMMIT_MSG"

info "Pushing branch '$BRANCH_NAME'..."
git push origin "$BRANCH_NAME"

info "Creating pull request..."
PR_URL=$(gh pr create \
  --base "$TARGET_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "Version bump $NEW_VERSION" \
  --body "Bump version from \`$CURRENT_VERSION\` to \`$NEW_VERSION\`.

### Changes
- \`src/version.ts\` – updated VERSION constant
- \`package.json\` – updated version field
- \`package-lock.json\` – updated version fields (lines 3 and 9)

---
*This PR was created automatically by \`scripts/version-bump.sh\`.*")

echo ""
info "Done! PR created: $PR_URL"
