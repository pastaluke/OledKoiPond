# OledKoiPond — Claude project notes

## Deployment workflow
**Always merge the dev branch to `main` and push before finishing any task.**
Cloudflare Pages deploys from `main`. Changes on `claude/koi-pond-sim-78hVO` (or any
feature branch) are invisible on the live site until merged.

```
git checkout main
git merge --ff-only <dev-branch>
git push -u origin main
git checkout <dev-branch>   # return to dev branch
```

## Future feature convention
When the user says **"future feature: [description]"**, append it to the
**Future / Backlog** list in `docs/GDD.md`. Capture the description faithfully;
do not elaborate or design the feature — that happens when it is picked up for
implementation.

## Repository
- Repo: pastaluke/OledKoiPond
- Dev branch: `claude/koi-pond-sim-78hVO`
- Live site: oledkoipond.pages.dev (Cloudflare Pages)
