---
name: prepare-release
description: Prepare a release for the Azure App Configuration JavaScript Provider. Use when user mentions release preparation, version bump, creating merge PRs, preview release, or stable release for this project.
---

# Prepare Release

This skill automates the release preparation workflow for the [Azure App Configuration JavaScript Provider](https://github.com/Azure/AppConfiguration-JavaScriptProvider) project.

## When to Use This Skill

Use this skill when you need to:
- Bump the package version for a new stable or preview release
- Create merge PRs to sync branches (test-main → test-preview, test-main → test-release/stable, test-preview → test-release)
- Prepare all the PRs needed before publishing a new release
- Resolve merge conflicts between test-main and test-preview branches

## Background

### Repository Information
- **GitHub Repo**: https://github.com/Azure/AppConfiguration-JavaScriptProvider
- **Package Name**: `@azure/app-configuration-provider`

### Branch Structure
- `test-main` – primary development branch for stable releases
- `test-preview` – development branch for preview releases
- `test-release/stable/v{major}` – release branch for stable versions (e.g., `test-release/stable/v2`)
- `test-release/v{major}` – release branch for preview versions (e.g., `test-release/v2`)

### Version Files
The version must be updated in **all four locations** simultaneously:
1. `src/version.ts` – line 4: `export const VERSION = "<version>";`
2. `package.json` – line 3: `"version": "<version>",`
3. `package-lock.json` – line 3: `"version": "<version>",`
4. `package-lock.json` – line 9: `"version": "<version>",`

### Version Format
- **Stable**: `{major}.{minor}.{patch}` (e.g., `2.4.0`)
- **Preview**: `{major}.{minor}.{patch}-preview` (e.g., `2.4.1-preview`)

## Quick Start

Ask the user whether this is a **stable** or **preview** release, and what the **new version number** should be. Then follow the appropriate workflow below.

---

### Workflow A: Stable Release

#### Step 1: Version Bump PR

Create a version bump PR targeting `test-main` by running the version bump script:

```bash
./scripts/version-bump.sh <new_version>
```

For example: `./scripts/version-bump.sh 2.5.0`

The script will automatically:
1. Read the current version from `src/version.ts`.
2. Create a new branch from `test-main` named `<username>/version-<new_version>` (e.g., `linglingye/version-2.5.0`).
3. Update the version in all four files (`src/version.ts`, `package.json`, `package-lock.json` lines 3 and 9).
4. Commit, push, and create a PR to `test-main` with title: `Version bump <new_version>`.

When the script prompts `Proceed? [y/N]`, confirm by entering `y`.

#### Step 2: Merge Main to Release Branch

After the version bump PR is merged, create a PR to merge `test-main` into the stable release branch by running:

```bash
./scripts/merge-to-release.sh <new_version>
```

For example: `./scripts/merge-to-release.sh 2.5.0`

When the script prompts `Proceed? [y/N]`, confirm by entering `y`.

> **Important**: Use "Merge commit" (not squash) when merging this PR to preserve commit history.

---

### Workflow B: Preview Release

#### Step 1: Merge Main to Preview (Conflict Resolution)

Create a PR to merge `test-main` into `test-preview`. This will likely have conflicts.

1. Fetch the latest `test-main` and `test-preview` branches.
2. Create a new branch from `test-preview` named `<username>/resolve-conflict` (or similar).
3. Merge `test-main` into this branch. If there are conflicts, inform the user and let them resolve manually.
4. Push the branch and create a PR targeting `test-preview` with title: `Merge test-main to test-preview`.

> **Important**: Use "Merge commit" (not squash) when merging this PR.

**Sample PR**: https://github.com/Azure/AppConfiguration-JavaScriptProvider/pull/272

#### Step 2: Version Bump PR

After the merge-to-preview PR is merged, create a version bump PR targeting `test-preview` by running the version bump script with the `--preview` flag:

```bash
./scripts/version-bump.sh <new_version> --preview
```

For example: `./scripts/version-bump.sh 2.5.1-preview --preview`

When the script prompts `Proceed? [y/N]`, confirm by entering `y`.

#### Step 3: Merge Preview to Release Branch

After the version bump PR is merged, create a PR to merge `test-preview` into the preview release branch by running:

```bash
./scripts/merge-to-release.sh <new_version> --preview
```

For example: `./scripts/merge-to-release.sh 2.5.1-preview --preview`

When the script prompts `Proceed? [y/N]`, confirm by entering `y`.

> **Important**: Use "Merge commit" (not squash) when merging this PR.

---

## Review Checklist

Each PR should be reviewed with the following checks:
- [ ] Version is updated consistently across all 3 files
- [ ] No unintended file changes are included
- [ ] Merge PRs use **merge commit** strategy (not squash)
- [ ] Branch names follow the naming conventions
- [ ] All CI checks pass
