# Contributing to Super League

Thank you for your interest in contributing to Super League. This document outlines the governance model, repository structure, and the processes all contributors are expected to follow.

---

## Governance Model

Super League follows a **Benevolent Dictator / Maintainer** governance model.

| Role | Responsibilities |
|------|-----------------|
| **Dictator** | Holds write access to `main`; performs final merge approvals |
| **Maintainer** | Reviews pull requests; resolves merge conflicts prior to review |
| **Contributor** | Forks the repository; submits changes via pull requests |

All changes to `main` — regardless of role — must go through a fork-based workflow and Pull Request review process.

---

## Repository Structure

The repository is organized into two independently deployable workspaces:

| Directory | Stack | Platform |
|-----------|-------|----------|
| `frontend/` | React + Vite | Cloudflare Pages |
| `backend/` | Node.js / Next.js (API & routing only) | Vercel |

Each workspace manages its own dependencies and development server.

---

## Development Workflow

The following workflow applies to all contributors, including Maintainers.

### 1. Fork and clone the repository

```bash
gh repo fork kevinmatheuu/super-league --clone
cd super-league
```

### 2. Create a feature branch

Branch names should be descriptive and prefixed with `feature/`:

```bash
git checkout -b feature/your-feature-name
```

### 3. Install dependencies and run locally

Navigate to the relevant workspace before installing:

```bash
cd frontend  # or: cd backend
pnpm install
pnpm run dev
```

### 4. Sync with upstream before pushing

Ensure your branch is up to date with `main` to minimise merge conflicts:

```bash
git pull upstream main
```

Resolve any conflicts locally before proceeding.

### 5. Commit and push your changes

```bash
git add .
git commit -m "feat: concise description of change"
git push origin feature/your-feature-name
```

### 6. Open a pull request

```bash
gh pr create
```

Before submitting, confirm the following:

- The target branch is set to `main`
- **Allow edits from maintainers** is enabled
- The PR description clearly explains what was changed and why

---

## Conflict Resolution (Maintainers)

When a pull request has conflicts with `main`, the assigned Maintainer is responsible for resolving them before the review proceeds.

### 1. Check out the pull request

```bash
gh pr checkout [PR_NUMBER]
```

### 2. Pull the latest upstream changes

```bash
git pull upstream main
```

Resolve all conflicts in your editor, then verify the build is not broken.

### 3. Commit and push the resolved state

```bash
git add .
git commit -m "chore: resolve merge conflicts with upstream main"
git push
```

---

## Merge Process (Dictators Only)

Only Dictators may merge pull requests into `main`.

### 1. Check out the pull request

```bash
gh pr checkout [PR_NUMBER]
```

### 2. Perform the merge

```bash
gh pr merge [PR_NUMBER] --merge --delete-branch
```

> Squash and rebase strategies are not permitted. Merge commits must be preserved to maintain a complete history.

---

## Repository Rules

The following rules are enforced for all contributors:

- Direct commits to `main` are not permitted under any circumstances
- All changes must be submitted and reviewed through a pull request
- Maintainers are responsible for conflict resolution before review
- Dictators hold sole authority over final merge approval
- Merge commits are always preserved — squashing is disabled
