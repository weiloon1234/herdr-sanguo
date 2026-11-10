// A real terminal outside Herdr: this computer's Terminal, or on another machine, ssh'd into it.
// With a session open it starts in that session's current folder; on the 校场, in the home folder.
import { appHome, exec, hc, notify, panes } from "herdr";
import { currentMachine, shownSpace } from "./machines.js";
import { showingField } from "./views.js";

export function sessionFolder() {
  if (showingField()) return "";
  const tab = shownSpace()?.tabs?.find((c) => c.active)?.id;
  const here = panes().filter((p) => p.tab === tab);
  return (here.find((p) => p.focused) ?? here.find((p) => p.terminal))?.cwd ?? "";
}

// How ssh reaches a machine. Throws if Herdr doesn't get there over ssh.
export async function sshTarget(machine) {
  const list = await hc(["machine", "ls", "--json"]).catch(() => null);
  const target = list?.code === 0 ? JSON.parse(list.stdout).machines?.find((m) => m.name === machine)?.target : null;
  if (!target) throw new Error("Herdr doesn't reach it over ssh.");
  return target;
}

export async function openOutsideTerminal() {
  const machine = currentMachine(), folder = sessionFolder();
  let target = "";
  if (machine) {
    try { target = await sshTarget(machine); }
    catch (e) { notify({ title: `Cannot open a terminal on ${machine}`, body: e.message, level: "error" }); return; }
  }
  const r = await exec("sh", [`${appHome()}/mods/sanguo/open-terminal.sh`, target, folder]).catch((e) => ({ code: 1, stderr: String(e) }));
  if (r.code !== 0) notify({ title: "Cannot open Terminal", body: r.stderr, level: "error" });
}
