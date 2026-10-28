# Updating, backing up and rolling back Pixel Pals

This is the safe way to move a running Pixel Pals (Unraid Compose Manager, Portainer or plain Docker) to a newer version, and to go back if something is wrong. Nothing here deploys by itself: images are only built when code is pushed, and **your server only changes when you press Update Stack / Compose Up.**

## Which image am I on?

| Tag | What it is |
|---|---|
| `:latest` | The `main` branch. The tested release. |
| `:beta` | The `upgrade/local-first` branch. New work, tested by CI (unit tests and a browser smoke test) but not yet by you. |
| `:<commit id>` | One exact build. Use this to pin a version or to roll back. |

The compose files use `:latest`. To try beta, change the image line to `ghcr.io/nyteghost/buddy-bot-room:beta`.

## Before you update (2 minutes)

1. **Is the stack healthy now?** In Unraid: Docker tab, the container shows `healthy`. Or `docker inspect --format '{{.State.Health.Status}}' buddy-bot-room`. Don't update a stack that is already broken; you won't know which change broke it.
2. **Take a backup now.** In the app: `/backup now` (owner). `/backup list` shows what exists. Nightly backups go to `BUDDY_BACKUP_PATH`; check the newest folder is from today. The backup copies the whole data folder (accounts, chats, settings, benchmark results, data-version).
3. **Note the running version.** The sidebar label shows the build; or `docker inspect --format '{{.Config.Image}} {{.Image}}' buddy-bot-room`. Write the image id down: it is your way back.
4. **Browser data:** the command palette (Ctrl+K), "Export settings", downloads your browser-side data (memories, projects, characters) as one file. Accounts mode also syncs most of it to the server.

## Update

1. Unraid: Docker, Compose, **Update Stack** (this pulls the image again). Portainer: Stacks, your stack, **Pull and redeploy**.
2. Wait for the container to turn `healthy` (up to a minute). If the data format changed, the app takes a backup first (when backups are configured), then applies the change and records it in `data-version.json`.
3. Hard-refresh the browser (Ctrl+Shift+R).
4. Check: `/status` in the app shows the services and `Data format vN`; open one chat in each mode you use; if you use Local AI, open Settings, Local AI and check your models are listed.

## If something is wrong: roll back

**Code only (most cases).** Put the previous image back and redeploy. Either use the commit-id tag you noted:

```
image: ghcr.io/nyteghost/buddy-bot-room:<commit id of the version that worked>
```

or `latest` instead of `beta`. Update Stack. Your data is untouched, and data written by a newer version stays readable because settings are only ever added, never rewritten in place (see "Data formats" below).

**Code and data (after a bad data change).** The quick way is `/backup restore N` (owner; N comes from `/backup list`). To do it by hand:
1. Stop the stack.
2. Move the broken folder aside: `mv /mnt/user/appdata/pixelpals/data /mnt/user/appdata/pixelpals/data.broken`.
3. Copy the newest good backup into place: `cp -a /mnt/user/appdata/pixelpals/backups/<newest>/. /mnt/user/appdata/pixelpals/data/` (use your `BUDDY_BACKUP_PATH` if you changed it).
4. Start the stack with the older image.

Keep `data.broken` until you are sure you do not need it.

## Data formats and interrupted updates

- The server keeps `data-version.json` in the data folder. Each change to a stored format is a numbered migration that first saves the files it will touch, undoes itself if anything fails, and is retried once if the container was stopped half-way. After two interrupted attempts it is skipped and reported (`/status` shows it) instead of trapping the app in a restart loop. Later migrations wait for the skipped one.
- Browser settings follow the same rule through `pixel-pals-config-version`. New formats use a new key name (`-v2`) and copy forward, so going back to an older version still finds its old data.
- A restored backup brings its own `data-version.json`, so migrations simply run again on it.

## Dependency and security checks

- CI runs `bun audit` on every push and prints a summary (informational; it does not block).
- Dependabot opens a weekly pull request against `upgrade/local-first` for out-of-date packages, Docker base images and GitHub Actions. Review the CI result, merge into beta, try it, then promote.
- Builds use the committed `bun.lock` (`--frozen-lockfile`). The Docker base image `oven/bun:1` floats within Bun 1.x; for a build you can repeat exactly, pass `--build-arg BUN_VERSION=<full version>`.

## What is persistent

| Path in the container | On the host (Unraid default) | Holds |
|---|---|---|
| `/data` | `appdata/pixelpals/data` | accounts, sessions key, chats, settings, benchmark results, data-version |
| `/backups` | `BUDDY_BACKUP_PATH` | nightly copies of `/data` (keep it on another disk or machine) |
| `/root/.ollama` (ollama) | `appdata/pixelpals/ollama` | downloaded models |

Container health: `buddy-bot-room` is healthy when `/__health` answers; `buddy-ollama` is healthy when the Ollama server answers (not when a model is loaded).
