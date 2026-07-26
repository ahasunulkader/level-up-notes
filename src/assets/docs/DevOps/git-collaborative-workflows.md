# Git & Collaborative Workflows

## TL;DR
**Git** tracks every change to your codebase. **Branching strategies** (GitFlow, trunk-based) define how teams collaborate. **Pull Requests** are the code review gate. **Merge vs Rebase** controls how history looks. In interviews: speak in terms of *why* each workflow exists — teams choose workflows to reduce integration pain and ship safely.

---

## Why This Matters in Interviews

Interviewers aren't just checking if you know `git commit`. They want to know:
- Can you collaborate without breaking others' work?
- Do you understand the *tradeoffs* between workflows?
- Have you dealt with real-world problems: conflicts, broken main, bad deploys?

---

## 1. Core Git Concepts (Know These Cold)

| Concept | What It Is | One-liner to Say |
|---|---|---|
| **Repository** | Project's full history | "A repo stores all commits, branches, and history" |
| **Commit** | Snapshot of changes | "Each commit is an immutable snapshot with a SHA hash" |
| **Branch** | Pointer to a commit | "A branch is just a movable label on a commit" |
| **Remote** | Server copy (GitHub/GitLab) | "Remote is where the team syncs their work" |
| **Staging area** | Pre-commit buffer | "You stage exactly what goes into a commit" |

### The Three States of a File
```
Working Directory  →  Staging Area (Index)  →  Repository
   (modified)            git add               git commit
```

---

## 2. Branching Strategies

### GitFlow (Feature-heavy / Scheduled releases)
```
main ─────────────────────────────────────────────────► (production)
  │                                    ▲
  └─► develop ──────────────────────────────────────► (integration)
            │                    ▲
            └─► feature/login ───┘  (short-lived feature branch)
            └─► feature/payment ──► develop (merged when done)
            │
            └─► release/1.2 ──────────────────────────► main
            │                                      ▲
            └─► hotfix/payment-bug ────────────────┘
```

**Branches in GitFlow:**
- `main` — production-ready code only
- `develop` — integration branch, all features merge here
- `feature/*` — one branch per feature, off develop
- `release/*` — stabilization before production (only bug fixes)
- `hotfix/*` — emergency fixes directly off main

**When to use:** Large teams, versioned software, planned release cycles.

---

### Trunk-Based Development (Modern / Fast teams)
```
main (trunk) ──────────────────────────────────────────►
     │     ▲     │     ▲     │     ▲
     └─f1──┘     └─f2──┘     └─f3──┘
   (hours/days, not weeks)
```

- Everyone commits to `main` frequently (multiple times per day)
- Feature flags hide incomplete features in production
- No long-lived branches — reduces merge conflicts

**When to use:** Continuous deployment, mature CI/CD, experienced teams.

---

### GitHub Flow (Simplified, widely used)
```
main ─────────────────────────────────────────────────►
  │                              ▲
  └─► feature/add-auth ──────────┘
       (PR → review → merge)
```

1. Branch off `main`
2. Commit on your branch
3. Open a Pull Request
4. Review + CI must pass
5. Merge to `main` → deploy immediately

**When to use:** Web apps, teams deploying frequently, open source.

---

## 3. Pull Requests (PRs) — The Collaboration Gate

### PR Lifecycle
```
Developer                    Reviewer                    CI System
    │                            │                           │
    ├─ git push origin feature ──►                           │
    ├─ Open PR ──────────────────►                           │
    │                            │◄── Triggers CI ───────────┤
    │                            │        (tests run)        │
    │◄── Review comments ────────┤                           │
    ├─ Address feedback ─────────►                           │
    │                            │◄── CI passes ─────────────┤
    │                            ├─ Approve ─────────────────►
    │                            ├─ Merge to main ────────────►
```

### What Makes a Good PR
- **Small scope** — one feature or bug fix, not a week of work
- **Clear description** — what changed, why, how to test
- **Linked to ticket** — connects to Jira/Linear/GitHub issue
- **Passes CI** — tests, linter, build must pass before review

---

## 4. Merge vs Rebase vs Squash

### Merge — Preserves full history
```
feature: A─B─C
              ╲
main:  D─E─F───G  (merge commit G)
```
- History shows exactly when/where branches diverged
- Creates a "merge commit" that can clutter `git log`
- **Safe for shared branches** — never rewrites history

### Rebase — Linear history
```
feature: A─B─C  →  replayed as  D─E─F─A'─B'─C'
main:    D─E─F                  (no merge commit)
```
- Re-applies your commits on top of the target branch
- Cleaner, linear history
- **Never rebase public/shared branches** — rewrites SHA hashes, breaks others

### Squash — Collapse to one commit
```
feature: A─B─C─D  →  merged as  main: ...─X  (one commit)
```
- All feature work becomes a single commit on main
- Great for keeping main history clean
- Loses granular commit history on the feature

### When to Use What
| Scenario | Use |
|---|---|
| Merging a feature PR | Squash merge (clean main history) |
| Keeping up with main on your branch | Rebase (linear history) |
| Merging release to main | Merge commit (preserves release point) |
| Shared branch with teammates | Merge (never rebase) |

---

## 5. Resolving Merge Conflicts

A conflict happens when two branches changed the **same lines** of the same file.

```bash
# What you see in the file:
<<<<<<< HEAD (your branch)
return "Hello, " . $name;
=======
return "Hi, " . $name . "!";
>>>>>>> feature/greeting-update
```

**Resolution process:**
1. `git status` — find conflicted files
2. Open file, decide which version (or combine both)
3. Remove conflict markers `<<<<<<<`, `=======`, `>>>>>>>`
4. `git add <file>` — mark as resolved
5. `git commit` — complete the merge

---

## 6. Common Git Commands in Team Workflows

```bash
# Start a feature
git checkout main && git pull origin main
git checkout -b feature/user-auth

# Keep your branch up to date
git fetch origin
git rebase origin/main  # or: git merge origin/main

# Stash work in progress
git stash                    # save dirty state
git stash pop                # restore it

# Undo mistakes (local only — before push)
git reset --soft HEAD~1      # undo last commit, keep changes staged
git reset --mixed HEAD~1     # undo last commit, unstage changes
git reset --hard HEAD~1      # undo last commit, DISCARD changes ⚠️

# Fix a commit message
git commit --amend -m "Better message"  # only before push!

# Selective cherry-pick
git cherry-pick abc1234      # apply a specific commit to current branch

# Find who changed a line
git blame src/auth.php       # shows author + commit per line
git log --oneline -10        # recent history
```

---

## 7. Git Hooks — Automation at Commit Time

```
git commit
    │
    ├─► pre-commit hook  → run linter, tests (block commit if fail)
    ├─► commit-msg hook  → validate commit message format
    └─► post-commit hook → trigger notifications
```

Tools like **Husky** (Node.js) automate this:
```json
// package.json
"husky": {
  "hooks": {
    "pre-commit": "phpcs src/",
    "commit-msg": "commitlint --edit"
  }
}
```

---

## 8. Commit Message Best Practices (Conventional Commits)

```
<type>(<scope>): <subject>

feat(auth): add JWT token refresh
fix(payment): handle null card number
chore(ci): update PHP version to 8.3
docs(api): document rate limiting headers
refactor(user): extract validation to service
test(order): add edge cases for discount logic
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`

---

## 9. Interview Q&A — Ready Answers

**Q: What branching strategy do you prefer and why?**
> "For most web projects I prefer GitHub Flow — branch off main, PR, merge and deploy. It's simple and encourages frequent integration. For larger teams with scheduled releases, GitFlow adds the structure needed. The key is choosing based on release cadence and team size."

**Q: What's the difference between merge and rebase?**
> "Merge preserves the full branching history with a merge commit. Rebase replays your commits on top of the target, creating a linear history. I use rebase to keep my feature branch up to date with main while working, but I never rebase branches that others are working on — it rewrites commit hashes and breaks their history."

**Q: How do you handle a hotfix in production?**
> "Branch off main (or the release tag), fix the bug, open a PR to main with high-priority review, merge and deploy immediately. Then also merge or cherry-pick that fix into develop so it doesn't get lost."

**Q: How do you avoid breaking main?**
> "Branch protection rules: require PR reviews, require CI to pass, no direct pushes to main. Small, frequent PRs reduce conflict risk. Feature flags let incomplete code merge safely."

**Q: What's a detached HEAD state?**
> "It means HEAD is pointing directly at a commit instead of a branch. You can happen into it by checking out a commit hash or tag. Any commits you make won't belong to a branch and will be lost on checkout. Fix it by creating a branch: `git checkout -b recovery-branch`."

---

## 10. Key Vocabulary to Use in the Interview

- **Fast-forward merge** — no divergence, branch just moves the pointer
- **Three-way merge** — uses common ancestor to resolve differences
- **Upstream / origin** — the remote repository
- **Tracking branch** — local branch linked to a remote branch
- **Force push** — rewrites remote history (dangerous, use with `--force-with-lease` which is safer)
- **Reflog** — git's safety net, records all HEAD movements, can recover lost commits
