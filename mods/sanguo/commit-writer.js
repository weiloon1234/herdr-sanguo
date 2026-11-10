// The ✨ beside the commit message: a CLI writes the message from the ticked files' diff. It only
// fills the box. Which CLI is remembered per machine, and it never runs by itself.
import { div } from "gpui-kit";
import { h_flex, Popup } from "gpui-base";
import { appHome, exec, readTextFile, setShared, shared } from "herdr";
import { machineKey } from "./machines.js";
import { KNOWN_AGENTS } from "./projects.js";
import { TOOLS } from "./session-log.js";
import { Opening, icon, menuNote, menuRow, spinner, surface } from "./changes-ui.js";

const CHOSEN = "sanguo.commit-writer"; // machine -> the CLI that writes there
// The first installed is the default. OpenCode isn't one: told to by a line in a diff, it ran a command
// whatever its permissions said. A diff can say anything, so what writes here mustn't be able to act.
const ORDER = ["claude", "codex", "agy"];
const LABELS = { claude: "Claude Code (Haiku)" };
const WIDTH = 240;

const labelOf = (name) => LABELS[name] ?? TOOLS[name].name;

// Its answer as one line: never a code fence or quotes around it.
function oneLine(answer) {
  const line = answer.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n").map((part) => part.trim()).find((part) => part && !part.startsWith("```")) ?? "";
  return line.replace(/^["'`]+|["'`]+$/g, "").slice(0, 200);
}

export class CommitWriter {
  constructor(view) {
    this.view = view;
    this.state = new Opening();
    this.writing = false;
  }

  close() { this.state.close(); }

  installed(machine) {
    const agents = shared(KNOWN_AGENTS)?.[machineKey(machine)];
    return ORDER.filter((name) => agents?.find((a) => a.key === TOOLS[name].key)?.installed !== false);
  }

  chosen(machine) {
    const list = this.installed(machine), wanted = shared(CHOSEN)?.[machineKey(machine)];
    return list.includes(wanted) ? wanted : list[0] ?? null;
  }

  choose(machine, name, cx) {
    setShared(CHOSEN, { ...(shared(CHOSEN) ?? {}), [machineKey(machine)]: name });
    this.state.close();
    cx.notify();
  }

  write(cx) {
    const repo = this.view.repo(), tool = repo && this.chosen(repo.on);
    if (!tool || this.writing || !this.view.files.length) return;
    this.writing = true;
    this.view.clearNote();
    cx.spawn(async (cx) => {
      try {
        const script = await readTextFile(`${appHome()}/mods/sanguo/commit-message.sh`);
        const r = await exec("sh", ["-c", script, "commit-message", tool, repo.cwd], { on: repo.on });
        const line = r.code === 0 ? oneLine(r.stdout) : "";
        if (!line) throw new Error((r.stderr || "It didn't answer.").trim());
        this.view.setMessage(line);
      } catch (e) {
        this.view.say(`${labelOf(tool)} couldn't write a message: ${e.message ?? e}`);
      }
      this.writing = false;
      cx.notify();
    });
    cx.notify();
  }

  toggle(cx) {
    if (this.state.isOpen) this.state.close();
    else if (!this.state.justClosed()) { this.view.closeMenus(); this.state.open(); }
    cx.notify();
  }

  render(t) {
    const machine = this.view.repo()?.on ?? null, tool = this.chosen(machine), open = this.state.isOpen;
    const ready = Boolean(tool) && this.view.files.length > 0 && !this.writing;
    const tip = !tool ? "No CLI that can write this is installed here" : !this.view.files.length ? "Nothing to describe yet" : `Write a message with ${labelOf(tool)}`;
    const part = (id) => h_flex().id(id).h_full().flex_none().items_center().justify_center();
    const chevron = part("writer-choose").w(20).cursor_pointer().text_color(open ? t.foreground : t.dim).when(open, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Which CLI writes it").on_click((_e, cx) => this.toggle(cx)).child(icon("down", 11));
    const menu = () => surface("writer-menu", t, WIDTH).on_mouse_down_out((_e, cx) => { this.state.close(); cx.notify(); })
      .child(menuNote("Writes the message with", t))
      .children(this.installed(machine).map((name) => menuRow(`writer-${name}`, labelOf(name), (_e, cx) => this.choose(machine, name, cx), t, {
        tail: name === tool ? div().text_color(t.accent).child(icon("check", 13)) : null,
      })))
      .child(menuNote("It sees the diff of the files you're committing.", t));
    return h_flex().h(32).flex_none().rounded(8).border_1().border_color(t.border).overflow_hidden()
      .child(part("writer-write").w(32).border_r(1).border_color(t.border).text_color(ready || this.writing ? t.foreground : t.dim).tooltip(tip)
        .when(ready, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.write(cx)))
        .child(this.writing ? spinner(t, 14) : icon("sparkles", 14)))
      .child(Popup.new("writer-popup", chevron).anchor("bottom_left").when(open, (el) => el.content(menu())));
  }
}
