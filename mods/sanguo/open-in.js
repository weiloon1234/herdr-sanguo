// The status bar's "Open in": the session's folder in Finder, then in whichever editors this Mac has.
// On the 校场, ~/Projects. On another machine, only the editors that can open a folder there over ssh.
import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, exec, notify, window } from "herdr";
import { currentMachine, machineLabel } from "./machines.js";
import { resolveFolder } from "./projects.js";
import { sessionFolder, sshTarget } from "./terminal.js";

const FINDER = "finder";
// In the row's order. `remote`: its link for opening a folder on another machine.
const APPS = [
  { key: FINDER, name: "Finder", bundle: "Finder" },
  { key: "vscode", name: "VS Code", bundle: "Visual Studio Code", remote: "vscode" },
  { key: "cursor", name: "Cursor", bundle: "Cursor", remote: "cursor" },
  { key: "windsurf", name: "Windsurf", bundle: "Windsurf", remote: "windsurf" },
  { key: "zed", name: "Zed", bundle: "Zed" },
  { key: "sublime", name: "Sublime Text", bundle: "Sublime Text" },
  { key: "antigravity", name: "Antigravity", bundle: "Antigravity" },
  { key: "xcode", name: "Xcode", bundle: "Xcode" },
  { key: "android", name: "Android Studio", bundle: "Android Studio" },
  { key: "idea", name: "IntelliJ IDEA", bundle: "IntelliJ IDEA" },
  { key: "phpstorm", name: "PhpStorm", bundle: "PhpStorm" },
  { key: "webstorm", name: "WebStorm", bundle: "WebStorm" },
  { key: "goland", name: "GoLand", bundle: "GoLand" },
  { key: "rustrover", name: "RustRover", bundle: "RustRover" },
  { key: "pycharm", name: "PyCharm", bundle: "PyCharm" },
  { key: "nova", name: "Nova", bundle: "Nova" },
  { key: "bbedit", name: "BBEdit", bundle: "BBEdit" },
];
const ICONS = "data/sanguo/app-icons"; // Under the app's folder, as images are.

export class OpenInRow {
  apps = [];

  // Once per start: apps don't come and go often enough to keep asking. Early on, the window can't
  // say yet what it's running on, so this waits until it can.
  load(cx) {
    const platform = window()?.platform;
    if (this.asked || !platform) return;
    this.asked = true;
    if (platform !== "macos") return;
    cx.spawn(async (cx) => {
      const r = await exec("sh", [`${appHome()}/mods/sanguo/open-in-apps.sh`, `${appHome()}/${ICONS}`, ...APPS.map((app) => `${app.key}=${app.bundle}`)]).catch(() => null);
      if (r?.code !== 0) return;
      const found = new Map(r.stdout.split("\n").filter(Boolean).map((line) => line.split("\t")));
      this.apps = APPS.filter((app) => found.has(app.key)).map((app) => ({ ...app, path: found.get(app.key) }));
      cx.notify();
    });
  }

  async folderHere(machine) {
    return sessionFolder() || await resolveFolder("~/Projects", machine) || await resolveFolder("~", machine);
  }

  async open(key) {
    const app = this.apps.find((other) => other.key === key), machine = currentMachine();
    if (!app) return;
    try {
      const folder = await this.folderHere(machine);
      if (!folder) throw new Error(`Couldn't find a folder on ${machineLabel(machine)}.`);
      const args = machine ? [`${app.remote}://vscode-remote/ssh-remote+${await sshTarget(machine)}${folder}`] : app.key === FINDER ? [folder] : ["-a", app.path, folder];
      const r = await exec("open", args);
      if (r.code !== 0) throw new Error(r.stderr);
    } catch (e) {
      notify({ title: `Cannot open ${app.name}`, body: String(e.message ?? e), level: "error" });
    }
  }

  render(t) {
    const machine = currentMachine(), shown = this.apps.filter((app) => !machine || app.remote);
    if (!shown.length) return div();
    const where = sessionFolder() ? "this session's folder" : "~/Projects", over = machine ? ` on ${machineLabel(machine)}` : "";
    return h_flex().flex_none().gap(2).items_center()
      .child(div().flex_none().pr(4).text_color(t.dim).child("Open in"))
      .children(shown.map((app) => div().id(`open-in-${app.key}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip(`Open ${where}${over} in ${app.name}`)
        .on_click((_e, cx) => { cx.spawn(() => this.open(app.key)); })
        .child(image(`${ICONS}/${app.key}.png`).size(18))));
  }
}
