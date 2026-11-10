// Editing a file from another machine in your editor (EDITOR), which runs on this one. remote-edit.sh
// does the copying and the safety checks; this says what happened. You're in the editor when it
// matters, so a save that didn't arrive also speaks up outside Herdr.
import { exec, notify, appHome, watchFolder } from "herdr";

export const EDITOR = "Visual Studio Code"; // The app's name, as `open -a` takes it.
const RETRY_MS = 30000; // A machine coming back online changes nothing here, so nothing else would wake us.
const QUICK_MS = 2500;
const USE_MINE = "Use mine", DECIDE_LATER = "Decide later";

const script = (...args) => exec("sh", [`${appHome()}/mods/sanguo/remote-edit.sh`, ...args]);
const nameOf = (path) => path.split("/").pop();
const events = (r) => r.stdout.split("\n").filter(Boolean).map((line) => line.split("\t"));

function tellOutsideHerdr(title, body) {
  exec("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body]).catch(() => {});
}

// A toast can't ask this: clicking one to clear it would also run its action. Resolves with the
// button pressed. Names and paths travel as arguments, so nothing in them can be read as script.
async function askWhichVersion(name, machine, useTheirs) {
  const r = await exec("osascript", ["-e", "on run argv", "-e", "activate",
    "-e", "return button returned of (display alert (item 1 of argv) message (item 2 of argv) as critical buttons {(item 3 of argv), (item 4 of argv), (item 5 of argv)} default button 1)",
    "-e", "end run",
    `${name} changed on ${machine}`,
    `You saved it in ${EDITOR}, but ${machine}'s version changed after you opened it. Nothing has been replaced yet.\n\n${USE_MINE} replaces ${machine}'s version.\n${useTheirs} keeps your edit in a file beside it.`,
    DECIDE_LATER, useTheirs, USE_MINE]).catch(() => null);
  return r?.stdout.trim();
}

const WHY_NOT_OPENED = {
  unreachable: (m) => `${m} can't be reached right now.`,
  missing: (m) => `It's no longer on ${m}.`,
  copying: (m) => `Couldn't copy it from ${m} in full. Try again.`,
  toolarge: (m) => `Files over 8 MB can't be saved back to ${m}.`,
  editor: () => `${EDITOR} wouldn't open it.`,
  local: () => "Its copy on this computer couldn't be made.",
};

export async function openRemoteFile(machine, path) {
  const r = await script("open", EDITOR, machine, path).catch((e) => ({ stdout: "", stderr: String(e) }));
  const [event, , , detail] = events(r)[0] ?? [];
  if (event === "kept") notify({ title: `Opened ${machine}'s latest ${nameOf(path)}`, body: "Your edit is open beside it. It was not sent.", level: "warning" });
  else if (event !== "opened") notify({ title: `Cannot open ${nameOf(path)}`, body: WHY_NOT_OPENED[detail]?.(machine) ?? r.stderr, level: "error" });
}

// Runs for as long as the status bar is shown. Saves made while Herdr is closed go at the next start.
export class RemoteSaves {
  said = new Map(); // file -> the version already reported, so one save is one message.
  running = false;
  again = false;

  start(cx) {
    cx.spawn(async (cx) => {
      const root = (await script("root")).stdout.trim();
      await this.pass();
      for (;;) {
        try { await watchFolder(root); } catch { await cx.sleep(RETRY_MS); }
        await this.pass();
      }
    });
    cx.timer.every(RETRY_MS, (cx) => cx.spawn(() => this.pass()));
  }

  // One at a time; a save arriving during a pass gets a pass of its own.
  async pass() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        const r = await script("sync").catch(() => null);
        if (r) for (const event of events(r)) this.report(event);
      } while (this.again);
    } finally { this.running = false; }
  }

  // Not awaited by `report`: an unanswered question mustn't hold up saves to other files.
  async resolveConflict(machine, path) {
    const useTheirs = `Use ${machine}'s`;
    const answer = await askWhichVersion(nameOf(path), machine, useTheirs);
    if (answer === useTheirs) await openRemoteFile(machine, path);
    else if (answer === USE_MINE) {
      const r = await script("overwrite", machine, path).catch(() => null);
      for (const event of r ? events(r) : []) this.report(event);
    }
  }

  report([event, machine, path, version]) {
    const file = `${machine}:${path}`, name = nameOf(path);
    if (event === "saved") {
      this.said.delete(file);
      notify({ title: `Saved to ${machine}`, body: name, level: "success", timeout: QUICK_MS });
      return;
    }
    if (this.said.get(file) === version) return;
    this.said.set(file, version);
    if (event === "conflict") this.resolveConflict(machine, path);
    else if (event === "waiting") {
      notify({ title: `${name} is not on ${machine} yet`, body: `It'll be sent as soon as ${machine} can be reached.`, level: "warning" });
      tellOutsideHerdr(`${name} is not on ${machine} yet`, `It'll be sent as soon as ${machine} can be reached.`);
    } else if (event === "toolarge") {
      notify({ title: `${name} not saved: over 8 MB`, body: `Your edit is still in ${EDITOR}.`, level: "error" });
      tellOutsideHerdr(`${name} not saved`, `Over 8 MB, too big to send to ${machine}. Your edit is still in ${EDITOR}.`);
    }
  }
}
