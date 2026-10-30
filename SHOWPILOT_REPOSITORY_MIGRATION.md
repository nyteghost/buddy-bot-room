# Move ShowPilot into its own repository

ShowPilot's source tree is already isolated on the `feat/showpilot-standalone` branch of
`nyteghost/buddy-bot-room` (not the Pixel Pals main branch). It contains ShowPilot's
app, desktop runtime, tests and portable Windows packaging workflow.

**One GitHub owner action is required:** create an empty public repository named
`nyteghost/showpilot` at https://github.com/new?name=showpilot. Choose "Public"
only if this source is approved for public sharing (the source branch was already
public). Do **not** add a README, .gitignore, or license during creation.
A private repository is possible, but unauthenticated in-app update checking
will not work without a future GitHub sign-in implementation.

## Transfer ONLY ShowPilot's source, without Pixel Pals commit history

On a personal computer with Git installed and GitHub authentication:

```bash
git clone --depth 1 --single-branch --branch feat/showpilot-standalone https://github.com/nyteghost/buddy-bot-room.git showpilot
cd showpilot
rm -rf .git
git init
git add .
git commit -m "Initial ShowPilot standalone"
git branch -M main
git remote add origin https://github.com/nyteghost/showpilot.git
git push -u origin main
git switch -c beta
git push -u origin beta
```

On Windows PowerShell, replace `rm -rf .git` with
`Remove-Item -Recurse -Force .git`.

This fresh initial commit means neither old Pixel Pals source history nor its
Git secrets/history are transplanted. The working ShowPilot application source
is preserved. Review the tracked files before making the new repo public.

## Main and Beta
- `main`: stable, user-tested ShowPilot updates only.
- `beta`: new fixes and test builds. Develop here, then merge approved
  changes into main. The `.github/workflows/showpilot.yml` workflow builds
  both branches.
- Settings → App Updates → Channel: Main or Beta. An update check searches
  this new repository first. Until the new repo is live, Beta falls back to
  the existing `buddy-bot-room` standalone branch; Main never downloads
  Pixel Pals.
- Windows builds remain portable ZIPs from GitHub Actions. The updater opens
  the official run page for download; it does not yet replace a running EXE.

Workbooks, stage plans, Google Calendar tokens, API keys and cached AI models
remain on the installed user's computer and must **never** be committed.

After the new repo's two Actions builds pass, retire the compatibility
fallback in `desktop/app-updates.cjs` and stop building from the old repo.
