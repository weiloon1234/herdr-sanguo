// The sidebar beside an open session: the 校场 to go back to, then every session on this machine,
// project by project, each soldier acting out its status as on the drill ground. A click goes
// there. Motion here redraws the window while you work, and like the 校场 it stops when Herdr
// isn't in front.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { setAgentOrder, theme } from "herdr";
import { BRUSH_FONT, kingdomOf, kingdomChip, dutyOf, dutyWord } from "./kingdoms.js";
import { currentMachine, machineLabel, machineNames, needsYou, goToMachine } from "./machines.js";
import { pic, on, soldier, firstFrame, textFrames } from "./actors.js";
import { sidebarIsNarrow, openSession, backToField, showingNotes } from "./views.js";
import { sessionFacts, sessionMenu, campSummary, closeSession, spokenTitle } from "./sessions.js";
import { keyName } from "./key-hints.js";
import { machineBar } from "./machine-bar.js";
import { PAINT } from "./art/paint/sizes.js";

const [STAGE_W, STAGE_H] = PAINT["yard-thumb"];
const TILE_H = STAGE_H + 8, FOOT = STAGE_H - 3, SHADOW_W = 40;

function stage(content) {
  return div().relative().w(STAGE_W).h(STAGE_H).flex_none().rounded(8).overflow_hidden().children(content);
}

// A small window onto the yard, with the session's soldier in it.
function soldierStage(st) {
  const [w] = PAINT[firstFrame(st.status, st.who, "mini/")], x = Math.max(0, Math.round((STAGE_W - w) / 2));
  return stage([
    on("yard-thumb", 0, STAGE_H, 1),
    pic("shadow", Math.round((STAGE_W - SHADOW_W) / 2), FOOT - 5, SHADOW_W / PAINT.shadow[0]),
    ...soldier(st.status, st.who, x, FOOT, 1, st.address, "mini/"),
  ]);
}

// Three lines beside a stage: what it is, where it is, and how it's doing, with the key that goes
// there at the end of the last. `clear`: room at the end of the first for the × over it.
function lines(first, second, third, key, t, clear = false) {
  return v_flex().flex_1().min_w(0).gap(1)
    .child(h_flex().h(18).gap(6).items_center().when(clear, (el) => el.pr(16)).children(first))
    .child(h_flex().h(17).gap(5).items_center().text_size(11.5).text_color(t.muted).children(second))
    .child(h_flex().h(17).gap(6).items_center().text_size(11.5).text_color(t.dim).children(third)
      .when(Boolean(key), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(key ?? ""))));
}

const tile = (id, t) => h_flex().id(id).h(TILE_H).flex_none().pl(3).pr(8).gap(9).items_center().rounded(10).border(1).cursor_pointer().hover((s) => s.bg(t.hover));

const text = (content) => div().flex_1().min_w(0).truncate().child(content);

// What it's doing, unless that only says its title again: a CLI often puts the session's title in the
// terminal's, after a tag like OpenCode's "OC | ", and either may be cut short.
function news(st) {
  const bare = (s) => spokenTitle(s).replace(/^[A-Z]{1,4} \| /, "").toLowerCase();
  const line = bare(st.line), title = bare(st.title);
  return line && title && (line.startsWith(title) || title.startsWith(line)) ? "" : st.line;
}

export default class Camp {
  // Back to the drill ground. It also says what's waiting on another machine, which the project
  // list's machine buttons say when that list is showing.
  fieldTile(sessions, machine, t) {
    const waiting = machineNames().filter((m) => m !== machine).map((m) => [m, needsYou(m)]).filter(([, n]) => n > 0);
    return tile("tile-field", t).border_color(t.chrome)
      .tooltip("Back to the 校场. The session keeps running.")
      .on_click(() => backToField())
      .child(stage([on("gate-thumb", 0, STAGE_H, 1)]))
      .child(lines(
        [div().flex_1().min_w(0).font_family(BRUSH_FONT).text_size(16).text_color(t.foreground).child("校场")],
        [text(machineLabel(machine)), ...waiting.map(([m, n]) => div().id(`waiting-${m}`).flex_none().px(5).rounded(4).bg(t.blocked + "2e").text_color(t.blocked)
          .tooltip(`Needs you on ${m}`).on_click((_e, cx) => { cx.stop_propagation(); goToMachine(m); }).child(`${m} ${n}`))],
        [text(campSummary(sessions))],
        keyName("sanguo.field"),
        t,
      ));
  }

  // Its title first, to find it by: the tool's mark says which CLI it is. Until the CLI names the
  // session, the tool's name stands in. Then its project, then how it's doing and its key.
  sessionTile(st, t) {
    const open = st.space.active && st.tab.active && !showingNotes(); // Notes shows no session.
    const program = st.program?.name ?? "Terminal";
    const color = st.holder ? kingdomOf(st.holder).color : t.accent, hovered = this.hovered === st.tab.id;
    return tile(`tile-${st.tab.id}`, t).relative()
      .border_color(open ? color : st.status === "blocked" ? t.blocked : t.chrome).when(open, (el) => el.bg(t.selected))
      .tooltip(`${st.title ? `${st.title} · ` : ""}${program} · ${st.space.name} · ${dutyOf(st.status).about}`)
      .on_hover((over, cx) => { const next = over ? st.tab.id : this.hovered === st.tab.id ? null : this.hovered; if (next !== this.hovered) { this.hovered = next; cx.notify(); } })
      .on_click(() => openSession(st.tab.id))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); sessionMenu(st); })
      .child(soldierStage(st))
      .when(hovered, (el) => el.child(div().id(`tile-close-${st.tab.id}`).absolute().top(5).right(5).size(18).flex().items_center().justify_center().rounded(5).cursor_pointer().bg(t.raised).text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("End this session")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); closeSession(st.tab.id, st.status); })
        .child(svg("mods/workspace-chrome/x.svg").size(11))))
      .child(lines(
        [...st.marks.map((holder) => kingdomChip(holder)), text(st.title ?? program).font_semibold().text_size(13).text_color(st.title ? t.foreground : t.muted)],
        [text(st.space.name)],
        [dutyWord(st.status, t), text(news(st))],
        keyName(`sanguo.session-${st.number}`) ?? String(st.number),
        t,
        hovered,
      ));
  }

  // The narrow rail has no room for a stage: the way back, then a banner for each session.
  rail(sessions, t) {
    const row = (id) => h_flex().id(id).h(26).flex_none().justify_center().items_center().cursor_pointer().hover((s) => s.bg(t.hover));
    return v_flex().size_full().min_h(0).bg(t.chrome).pt(4).gap(2)
      .child(row("rail-field").font_family(BRUSH_FONT).text_size(15).text_color(t.foreground).tooltip("Back to the 校场").on_click(() => backToField()).child("校"))
      .children(sessions.map((st) => row(`rail-${st.tab.id}`).text_size(11).text_color(t.muted).tooltip(`${st.space.name} · ${dutyOf(st.status).about}`)
        .on_click(() => openSession(st.tab.id))
        .child(st.holder ? kingdomChip(st.holder) : String(st.number))
        .when(st.status === "blocked", (el) => el.child(textFrames(div().w(6).text_color(t.blocked), ["!", " "], 500)))));
  }

  render() {
    const t = theme(), machine = currentMachine(), sessions = sessionFacts(machine);
    const order = sessions.flatMap((st) => st.fighters.map((p) => p.terminal)).filter(Boolean);
    if (order.join() !== this.order) { this.order = order.join(); setAgentOrder(order); }
    if (sidebarIsNarrow()) return this.rail(sessions, t);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(machineBar(t))
      .child(div().flex_none().px(8).pb(5).border_b(1).border_color(t.border).child(this.fieldTile(sessions, machine, t)))
      .child(v_flex().id("session-tiles").flex_1().min_h(0).px(8).pt(5).pb(8).gap(2).overflow_y_scrollbar()
        .children(sessions.map((st) => this.sessionTile(st, t))));
  }
}
