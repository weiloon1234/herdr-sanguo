# AGENTS.md

This repository is a Herdr layout: the 三国 Sanguo layout, its mod, theme and keys, laid out like a Herdr home (`~/.config/herdr-app`). [RECIPE.md](RECIPE.md) is the spec: what the person sees, how it behaves, how it's built, and what to watch out for. Read it before changing anything here.

## Adding it to someone's Herdr

Follow the person's Herdr home `AGENTS.md`, section "Layouts and mods other people made". In short:

1. **Say first** what the mod does on their machine (README.md, "What it runs and reads"):
   - it runs programs: `sh`, `git`, `sqlite3`, `open`, `osascript`, `ssh`, and their coding CLIs when they press ✨;
   - it reads the CLIs' session records under `~/.claude`, `~/.codex`, `~/.local/share/opencode` and `~/.gemini`;
   - it writes to `data/sanguo/` in each machine's Herdr home.
2. **Copy** `layouts/sanguo.json` + `layouts/sanguo.png`, `themes/sanguo.json` and `mods/sanguo/` into their home. Never overwrite: if a name is taken, rename the new one everywhere it's named. That includes the layout's `"mod": "sanguo"` entries, its `"toast"`, the layout's `"theme"`, and the mod's own `mods/sanguo/` paths in `*.js`.
3. **Merge** `keys.json`'s `layout:sanguo` section into theirs, and ask before replacing a key they already use.
4. **Check every role.** `main.js` picks a role from `props().role` and falls back to `DEFAULT_ROLE`. For each role, set `DEFAULT_ROLE` in a copy of the mod and run `herdr-app check` on that copy:
   - **Views:** field, camp, spaces, tabs, files, changes, notes, status, pane, chrome, toast.
   - **Dialogs:** new-session, new-project, rename-project, delete-project, close-session.
5. **Switch** with `layout.switch {"name": "sanguo"}`, and confirm `herdr-app status` shows no errors.

## Changing it

- **One role per block.** `layouts/sanguo.json` places blocks with `props.role`; `mods/sanguo/main.js` maps each role to its class.
- **Every save reloads.** Every saved file reloads the mod in a running window, so a change spread over several files is live half-done until the last one is saved. Batch edits, swap the mod folder in one go, and check every role before it goes live. (Reloads no longer use up memory since Herdr 0.1.14.)
- **Remote machines.** Anything that runs on a machine goes through `machine-script.js` (`runOn`) or `exec(..., { on })`. On a remote machine, what a command leaves running is killed when it returns, so wait for long work with `timeout` rather than detaching it.
- **No `setTimeout`.** Use `cx.timer` or a task, and don't hold a handler's `cx` across an `await`.
- **The pitfalls are in RECIPE.md** ("Watch out"), and that's where new ones go.
- **Keep the docs true.** When behavior changes, update RECIPE.md and, if it shows, README.md. A new `preview.png` must not show anyone's real project names, session titles, branches, notes or paths.
