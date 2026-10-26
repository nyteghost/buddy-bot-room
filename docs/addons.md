# Writing a Pixel Pals add-on

An add-on is a folder you drop into `addons/` inside your data folder (on Unraid: `/mnt/user/appdata/pixelpals/data/addons/<id>/`). It adds a window, slash commands and/or background jobs **without touching Pixel Pals' own code**, so updates never overwrite it.

> **Security:** an add-on's server script runs inside the Pixel Pals server with the same access the server has (your mail login, your files in the data folder, the network). Permissions decide which helpers an add-on gets and what Settings shows you, they are **not a sandbox**. Only turn on add-ons you wrote or trust. The window page is sandboxed (no cookies, no network, it can only call its own server code).

## Folder layout

```
addons/hello/
  addon.json    the manifest (required)
  server.mjs    server code: commands, api functions, jobs (optional)
  window.html   the page shown in its workspace window (optional)
```

A working copy lives in `examples/addons/hello` in the Pixel Pals repo. Copy it, rename the folder and the `id`, and change it.

## addon.json

| Field | Meaning |
|---|---|
| `id` | 3-32 lowercase letters, numbers or dashes. **Must equal the folder name.** |
| `name`, `version`, `author`, `description` | Shown in Settings |
| `permissions` | Any of `commands`, `window`, `jobs`, `notify`, `storage` |
| `main` | Server script, default `server.mjs` (a `.mjs` or `.js` file in the folder) |
| `commands` | `[{ "name": "hello", "help": "…" }]`: slash commands (needs `commands`) |
| `window` | `{ "title": "Hello", "entry": "window.html" }` (needs `window`) |
| `jobs` | `[{ "id": "tick", "everyMinutes": 60 }]`, 1 to 1440 minutes (needs `jobs`) |

## server.mjs

```js
export default {
  commands: { hello: async (args, ctx) => `Hello ${args}!` },   // /hello Ann
  api:      { count: async (args, ctx) => 42 },                  // window calls pp.call("count")
  jobs:     { tick: async (ctx) => { ctx.log("ran"); } },        // named in addon.json
};
```

`ctx` gives you:
- `ctx.log(text)`: writes to the Pixel Pals server log
- `ctx.notify(title, text)`: phone alert through ntfy/Telegram (needs `notify`)
- `ctx.storage.get(key)` / `ctx.storage.set(key, value)`: a small JSON data file, 200 KB (needs `storage`)

Anything a command returns is shown in the chat. Each call has a 30-second limit. Built-in commands always win over an add-on command with the same name.

## window.html

A normal web page. It already has `pp.call(name, args)` which runs `api[name]` in `server.mjs` and returns a promise. The page cannot load anything from the network and has no access to Pixel Pals itself, so inline your CSS and script.

## Turning it on

Settings → **Add-ons** lists what is installed and what each one asks for. **Turn on** approves it. If any of its files change later, it turns itself off until you approve the change.
