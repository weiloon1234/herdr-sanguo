// Notifications, Herdr's own and every notify(), on the 校场's paper (the layout's "toast"). One about a
// session, such as an agent that finished or needs you, shows that session as its card does: the soldier
// acting it out, its kingdom's mark, its status word and its key. A click opens the session. Any other
// carries a seal saying what kind it is. Herdr sizes it (340×72) and takes it away after its timeout.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, spaces, agents, panes, terminals } from "herdr";
import { BRUSH_FONT, DUTY_INK, kingdomChip, dutyWord } from "./kingdoms.js";
import { sessionFacts } from "./sessions.js";
import { soldierStage } from "./camp.js";
import { ALERT, HOVER, fieldColors } from "./field.js";
import { openSession } from "./views.js";
import { keyName } from "./key-hints.js";

// A seal for each kind: 报 news, 捷 victory, 警 a warning, 急 urgent.
const SEALS = {
  info: { word: "报", ink: (c) => c.plaque },
  success: { word: "捷", ink: () => DUTY_INK.done },
  warning: { word: "警", ink: () => "#a8641c" },
  error: { word: "急", ink: () => DUTY_INK.blocked },
};

// Herdr's own, for a machine that needs a login: it names the command to run, which can be copied.
const LOGIN = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/;

const tabOfTerminal = (address) => agents().find((a) => a.address === address)?.tab ?? panes().find((p) => p.terminal === address)?.tab;

// The session a notification is about: where its action goes (agent.focus a terminal, a pane, a tab).
// A sub-agent may have no pane of its own, so its parent's session stands for it.
function sessionOf(action) {
  const args = action?.args ?? {};
  let tab = args.tab ?? (action?.name === "tab.select" ? args.id : null) ?? panes().find((p) => p.pane === args.pane)?.tab;
  for (let address = args.terminal, hops = 0; !tab && address && hops < 4; hops++) {
    tab = tabOfTerminal(address);
    address = terminals().find((t) => t.address === address)?.parent;
  }
  const space = tab && spaces().find((s) => s.tabs?.some((c) => c.id === tab));
  return space ? sessionFacts(space.machine ?? null).find((st) => st.tab.id === tab) ?? null : null;
}

const line = (content, color) => div().h(16).truncate().text_color(color).child(content);

export default class Toast {
  // Opens the session first, so the center shows it even when its tab was already the selected one.
  go(st, p) {
    if (st) openSession(st.tab.id);
    if (p.action?.name) run(p.action.name, p.action.args ?? {});
    closeOverlay(p.overlay);
  }

  session(st, p, c) {
    const ink = { ...DUTY_INK, dim: c.muted }; // dutyWord's colors, for paper.
    const where = [st.space.name, st.title].filter(Boolean).join(" · ") || p.body;
    return [
      soldierStage(st),
      v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().h(18).gap(5).items_center()
          .children(st.marks.map((holder) => kingdomChip(holder)))
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).child(p.title ?? ""))
          .child(dutyWord(st.status, ink)))
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).child(line(where, c.muted)))
          .child(div().flex_none().text_size(11).text_color(c.muted).child(keyName(`sanguo.session-${st.number}`) ?? String(st.number))))
        // What it's asking you, when that's why.
        .when(st.status === "blocked" && Boolean(st.line), (el) => el.child(line(st.line, c.ink))),
    ];
  }

  plain(p, c, login) {
    const seal = SEALS[p.level] ?? SEALS.info, command = login && `hc machine login ${login[1]}`;
    return [
      div().size(34).flex_none().flex().items_center().justify_center().rounded(7).bg(seal.ink(c))
        .child(p.icon ? image(p.icon).size(18) : div().font_family(BRUSH_FONT).text_size(20).text_color(c.paper).child(seal.word)),
      v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().font_semibold().text_size(13).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
        .when(!login && Boolean(p.body), (el) => el.child(div().id("toast-body").tooltip(p.body).child(line(p.body, c.muted))))
        .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(c.muted).child(command))
          .child(div().id("toast-login-copy").flex_none().px(6).py(2).rounded(4).border(1).border_color(c.ink).cursor_pointer()
            .hover((s) => s.bg(HOVER))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
            .child(this.copied ? "Copied" : "Copy")))),
    ];
  }

  render() {
    const c = fieldColors(), p = props() ?? {};
    const login = LOGIN.exec(p.body ?? ""), st = login ? null : sessionOf(p.action);
    const loud = st?.status === "blocked" || st?.status === "done";
    return div().id("toast").relative().size_full().rounded(10).bg(st?.status === "blocked" ? ALERT : c.sticker).cursor_pointer()
      .on_click(() => this.go(st, p))
      .child(h_flex().id("toast-card").absolute().left(3).top(3).right(3).bottom(3).pl(st ? 3 : 12).pr(12).gap(st ? 8 : 11).items_center()
        .rounded(9).bg(c.paper).border(2).border_color(loud ? DUTY_INK[st.status] : c.ink).hover((s) => s.border_color(HOVER))
        .text_size(12).line_height("16px").text_color(c.ink)
        .children(st ? this.session(st, p, c) : this.plain(p, c, login)));
  }
}
