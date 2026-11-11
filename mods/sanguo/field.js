// 校场: every session on this machine at work on one drill ground, whichever project it's in. Each
// has a station: its soldier acts out its status, a bubble says which project it's working on and
// what it's doing, and a click opens it. Whatever stands on the ground is sized by where its feet
// are, so the gate, its guards and the sessions all share one world. Only what needs you is loud,
// so a glance across the camp finds it.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { KINGDOMS, BRUSH_FONT, DUTY_FONT, kingdomOf, softMark, uniqueMarks, kingdomChip, dutyOf, DUTY_INK } from "./kingdoms.js";
import { currentMachine, machineLabel, machineLayout } from "./machines.js";
import { sessionFacts, sessionMenu, campSummary, closeSession } from "./sessions.js";
import { ART, artPath, moving, pic, on, breathing, soldier, actionBeat, frames2, frames3, blinking, textFrames } from "./actors.js";
import { showingField, openSession } from "./views.js";
import { openNewSession } from "./projects.js";
import { keyHint } from "./key-hints.js";
import { DAWN, DUSK, MODES, isNight, modeNow, setTimeOfDayMode } from "./time-of-day.js";
import { PAINT, BACKDROP } from "./art/paint/sizes.js";

export const HOVER = "#c8922e", ALERT = "#f2b441";
const DAY = { floor: "#d9a766", ink: "#3a2314", paper: "#fbf3df", sticker: "#f6ead2", muted: "#7a6549", light: "#fff8e8", plaque: "#6e2616", onGround: "#3a2314" };
const NIGHT = { floor: "#2f2836", ink: "#241c22", paper: "#d9d6cf", sticker: "#bfc0c4", muted: "#5d5248", light: "#e3e6f0", plaque: "#2b1a22", onGround: "#e6e3da" };
// The 校场's colors at this hour: its bubbles' paper and ink, which the notifications share.
export const fieldColors = () => (isNight() ? NIGHT : DAY);
let c = DAY; // Set at the top of each render.

// Where the painted backdrop's parts are, in its own pixels.
const WALL_FOOT = 362, GATE = { left: 630, right: 1040, stoneLeft: 680, stoneRight: 998 }, PLAQUE = { left: 762, top: 163, width: 150, height: 49 }, TOWER_RIGHT = 256;

// The painted ground recedes, about 2:1 going by its grass. So art stands this large with its feet
// at the wall, about three-quarters of the gate's door, and at the picture's bottom edge.
const DEPTH = { wall: 0.54, front: 1.14 };
const CROWD = [1, 0.9, 0.8, 0.7, 0.6]; // When a camp won't fit on the ground, everyone stands further back.

const STAGE = { w: 310, h: 226 }, FEET = 216, BUBBLE = { w: 236, full: 46, plate: 28, tail: 9 }, STATION_GAP = 6;
const BUBBLE_SLOT = BUBBLE.full + BUBBLE.tail + 6, STAGE_RISE = 36; // The stage tucks up under its bubble, so heads stand just below it. Only a raised spear goes behind.
const SOLDIERS = 5; // Sub-agents drawn beside their general.
const YARD_CLEARANCE = 110; // Once a row's feet come this near the bottom edge, it would stand among the yard's props.

// A station's parts for each status, in stage units: soldier's left edge, and what stands around him.
const POSES = {
  working: { soldier: 44, speaker: 112 },
  blocked: { soldier: 52, speaker: 118 },
  done: { soldier: 50, speaker: 112 },
  idle: { soldier: 52, speaker: 118 },
  none: { soldier: 74, speaker: 122 },
};

// How large something stands with its feet at `footY` in the view.
function depthAt(picture, footY) {
  const t = Math.min(1, Math.max(0, (footY / picture.scale - WALL_FOOT) / (BACKDROP[1] - WALL_FOOT)));
  return picture.scale * (DEPTH.wall + (DEPTH.front - DEPTH.wall) * t);
}

function bubble({ tabId, number, name, marks, status, title, line, hovered, speaker }) {
  const ink = DUTY_INK[status] ?? DUTY_INK.none;
  const loud = status === "blocked" || status === "done" || status === "working";
  // What it's called, when it has a name yet. What it needs from you comes before that.
  const second = status === "blocked" ? line : title ?? (loud ? line : null);
  const h = second ? BUBBLE.full : BUBBLE.plate, w = BUBBLE.w;
  const edge = hovered ? HOVER : status === "blocked" || status === "done" ? ink : c.ink;
  const word = div().flex_none().font_family(DUTY_FONT).text_size(13).text_color(ink).child(dutyOf(status).word);
  const tailAt = Math.max(16, Math.min(w - 32, speaker - 8));
  return div().relative().w(w).h(h + BUBBLE.tail).flex_none().text_size(12).line_height("15px").text_color(c.ink)
    .when(status === "blocked", (el) => el.child(div().absolute().left(-4).top(-4).w(w + 8).h(h + 8).rounded(15).bg(ALERT)
      .when(moving(), (flash) => flash.loop("opacity", { from: -8, to: 9, period: 1000, easing: "linear" }))))
    .child(div().absolute().left(0).top(0).w(w).h(h).rounded(12).bg(c.sticker))
    .child(svg(`${ART}/tail.svg`).absolute().left(tailAt - 2).top(h - 2).w(20).h(BUBBLE.tail + 2).text_color(c.sticker))
    .child(div().absolute().left(2).top(2).w(w - 4).h(h - 4).rounded(10).bg(c.paper).border(2).border_color(edge))
    .child(svg(`${ART}/tail.svg`).absolute().left(tailAt).top(h - 4).w(16).h(BUBBLE.tail).text_color(edge))
    .child(svg(`${ART}/tail.svg`).absolute().left(tailAt + 3).top(h - 5).w(10).h(BUBBLE.tail - 3).text_color(c.paper))
    .child(v_flex().absolute().left(11).right(11).top(6).gap(2)
      .child(h_flex().h(16).gap(5).items_center()
        .children(marks.map((holder) => kingdomChip(holder)))
        .when(Boolean(number), (el) => el.child(div().flex_none().text_color(c.muted).child(number)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(name))
        .child(word))
      .when(Boolean(second), (el) => el.child(div().h(16).truncate().text_color(status === "blocked" ? c.ink : c.muted).child(second))))
    // On the corner, clear of the status word.
    .child(div().id(`close-${tabId}`).absolute().right(-6).top(-6).size(17).flex().items_center().justify_center().rounded_full().bg(c.paper).border(2).border_color(edge).text_color(c.ink).cursor_pointer()
      .hover((s) => s.bg(ALERT)).tooltip("End this session")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); closeSession(tabId, status); })
      .child(svg("mods/workspace-chrome/x.svg").size(9)));
}

// Day or night on the 校场, in the same paper as its bubbles.
function timePill() {
  const now = modeNow();
  return h_flex().id("time-of-day").absolute().top(12).right(14).h(32).p(2).rounded(16).bg(c.sticker)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(h_flex().h_full().p(2).gap(1).items_center().rounded(14).bg(c.paper).border(2).border_color(c.ink)
      .children(Object.entries(MODES).map(([mode, label]) => div().id(`time-${mode}`).h(20).px(10).flex().items_center().rounded(10).text_size(12).cursor_pointer()
        .when(mode === now, (el) => el.bg(c.ink).text_color(c.paper).font_semibold())
        .when(mode !== now, (el) => el.text_color(c.muted).hover((s) => s.text_color(HOVER)))
        .when(mode === "auto", (el) => el.tooltip(`Follows this computer's clock: light from ${DAWN}:00, dark from ${DUSK}:00`))
        .on_click(() => setTimeOfDayMode(mode)).child(label))));
}

// A kingdom's banner, its mark centered on the plain cloth.
function banner(holder, x, foot, s) {
  const id = kingdomOf(holder).id, name = `banner-${id}`, [w, h] = PAINT[name];
  const left = Math.round(x * s), top = Math.round((foot - h) * s), W = Math.round(w * s), H = Math.round(h * s);
  return [
    pic(name, left, top, s),
    div().absolute().left(left).top(top + Math.round(H * 0.125)).w(W).h(Math.round(H * 0.385)).flex().items_center().justify_center()
      .child(softMark(holder, id === "qun" ? c.ink : c.light, Math.max(2, Math.round(3 * s)))),
  ];
}

// Its action, and what it needs for it. `who`: a kingdom id, or "min" for a plain shell.
function scene(status, who, holder, address, kids, s) {
  const k = KINGDOMS[who];
  const flag = k ? banner(holder, 2, FEET - 8, s) : [];
  const shadow = (x, w = 120) => pic("shadow", Math.round(x * s), Math.round((FEET - 13) * s), s * (w / PAINT.shadow[0]));
  const soldiers = k ? Array.from({ length: Math.min(kids, SOLDIERS) }, (_, i) => {
    const y = Math.round((FEET + 2 - PAINT[`mini/${who}-awake`][1]) * s);
    return pic(`mini/${who}-awake`, Math.round((6 + i * 26) * s), y, s).when(moving(), (mini) => mini.loop("top", { from: y, to: y - 3, period: 480 + i * 70 }));
  }) : [];

  if (status === "working" && k) {
    const period = actionBeat(status, address), at = POSES.working.soldier;
    return [...flag, shadow(at + 10, 130), ...soldier(status, who, at, FEET, s, address),
      ...frames3(on("dummy-1", 216, FEET, s), on("dummy-1", 216, FEET, s), on("dummy-2", 216, FEET, s), period),
      ...frames3(null, on("dust-1", at - 6, FEET + 2, s), on("dust-2", at - 16, FEET + 4, s), period), ...soldiers];
  }
  if (status === "blocked" && k) {
    const at = POSES.blocked.soldier;
    return [...flag, on("table", 206, FEET, s), shadow(at + 6, 130), ...soldier(status, who, at, FEET, s, address),
      blinking(on("bang", 232, FEET - 84, s), 640), ...soldiers];
  }
  if (status === "done" && k) {
    const period = actionBeat(status, address), at = POSES.done.soldier;
    return [...flag, on("drum", 196, FEET, s), shadow(at + 8, 130), ...soldier(status, who, at, FEET, s, address),
      blinking(on("spark", 180, FEET - 112, s), period + 120), blinking(on("spark", 228, FEET - 158, s), period + 260), ...soldiers];
  }
  // At rest: a tent behind him if he belongs to a kingdom, the field, and whoever's minding it.
  const at = status === "idle" ? POSES.idle.soldier : POSES.none.soldier;
  return [...flag, ...(k ? [on(`tent-${who}`, 122, FEET - 8, s)] : [on("hoe", 254, FEET - 2, s)]), shadow(at + 2, 120),
    ...soldier(status, who, at, FEET, s, address), on("crops", 212, FEET + 6, s),
    ...(status === "idle" ? [textFrames(div().absolute().left(Math.round((at + 112) * s)).top(Math.round((FEET - 176) * s)).font_family(DUTY_FONT).text_size(16).text_color(c.onGround), ["zZz", "", "z", "zZ"], 1000)] : []), ...soldiers];
}

const stationWidth = (s) => Math.max(Math.round(STAGE.w * s), BUBBLE.w + 8) + STATION_GAP;
const stationHeight = (s) => BUBBLE_SLOT + Math.round((STAGE.h - STAGE_RISE) * s) + 4;

// A station's size depends on where its feet land, and where they land on its size: settle it.
function rowScale(picture, top, crowd) {
  let s = picture.scale * crowd;
  for (let i = 0; i < 4; i++) s = crowd * depthAt(picture, top + BUBBLE_SLOT + (FEET - STAGE_RISE) * s);
  return s;
}

// Rows from the wall forward. Nearer rows stand larger, so they may fit fewer stations across.
function placeRows(sessions, width, picture, top, crowd) {
  const rows = [];
  for (let first = 0, y = top; first < sessions.length;) {
    const s = rowScale(picture, y, crowd), w = stationWidth(s);
    const columns = Math.max(1, Math.floor((width - 8 - w / 2) / w));
    rows.push({ sessions: sessions.slice(first, first + columns), s, foot: y + BUBBLE_SLOT + (FEET - STAGE_RISE) * s });
    first += columns;
    y += stationHeight(s);
  }
  return rows;
}

// The whole machine belongs on one screen: the largest the camp can stand and still all show, set
// a little back from the wall. Past the smallest size, the rows scroll.
function campLayout(sessions, width, picture, groundTop, groundH) {
  const place = (crowd, lift) => placeRows(sessions, width, picture, groundTop + lift, crowd);
  const used = (rows) => rows.reduce((sum, row) => sum + stationHeight(row.s), 0);
  for (const crowd of CROWD) {
    const spare = groundH - used(place(crowd, 0));
    if (spare < 0) continue;
    // Further forward, rows stand larger and may wrap, so come back until it all still fits.
    for (let lift = Math.round(spare * 0.36); lift > 0; lift -= 12) {
      const rows = place(crowd, lift);
      if (used(rows) + lift <= groundH) return { rows, lift, crowd };
    }
    return { rows: place(crowd, 0), lift: 0, crowd };
  }
  const crowd = CROWD[CROWD.length - 1];
  return { rows: place(crowd, 0), lift: 0, crowd };
}

export default class Field {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.size = { width: 1200, height: 800 };
  }

  station(st, s) {
    const hotkey = st.number <= 10 ? `⌘${st.number % 10}` : null;
    const w = stationWidth(s), stageW = Math.round(STAGE.w * s), inset = Math.max(0, Math.round((w - stageW) / 2));
    const speaker = inset + Math.round((POSES[st.status]?.speaker ?? POSES.idle.speaker) * s) - Math.round((w - BUBBLE.w) / 2);
    return div().id(`station-${st.tab.id}`).relative().w(w).h(stationHeight(s)).flex_none().cursor_pointer()
      .tooltip(`${st.title ? `${st.title} · ` : ""}${st.program?.name ?? "Terminal"} · ${st.space.name} · ${dutyOf(st.status).about} · Click${hotkey ? ` or ${hotkey}` : ""} to open`)
      .on_hover((over, cx) => { const next = over ? st.tab.id : this.hover === st.tab.id ? null : this.hover; if (next !== this.hover) { this.hover = next; cx.notify(); } })
      .on_click(() => openSession(st.tab.id))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); sessionMenu(st); })
      .child(div().absolute().left(inset).top(BUBBLE_SLOT - Math.round(STAGE_RISE * s)).w(stageW).h(Math.round(STAGE.h * s)).children(scene(st.status, st.who, st.holder, st.address, st.kids, s)))
      .child(v_flex().absolute().left(0).right(0).top(0).h(BUBBLE_SLOT).items_center().justify_end().child(bubble({
        tabId: st.tab.id, number: String(st.number), name: st.space.name, marks: st.marks, status: st.status, hovered: this.hover === st.tab.id, speaker, title: st.title, line: st.line,
      })));
  }

  // Flags on the wall, one for each kingdom serving here, and the gate's name on its plaque.
  wall(picture, serving) {
    const { scale, left } = picture, foot = Math.round(WALL_FOOT * scale) + 4, s = depthAt(picture, foot);
    const flags = serving.flatMap((holder, i) => {
      const side = i % 2 === 0 ? -1 : 1, step = Math.floor(i / 2), w = PAINT[`banner-${kingdomOf(holder).id}`][0] * s + 14;
      const x = side < 0 ? left + (GATE.left - 70) * scale - w * (step + 1) : left + (GATE.right + 70) * scale + w * step;
      return banner(holder, x / s, foot / s, s);
    });
    return [
      image(artPath("backdrop")).absolute().left(left).top(0).w(picture.width).h(picture.height),
      ...flags,
      div().absolute().left(left + PLAQUE.left * scale).top(PLAQUE.top * scale).w(PLAQUE.width * scale).h(PLAQUE.height * scale).flex().items_center().justify_center()
        .font_family(BRUSH_FONT).text_size(Math.round(34 * scale)).text_color(c.plaque).child("军门"),
    ];
  }

  // Life on the ground that isn't anyone's session: guards at the gate, at attention by day and
  // asleep on their feet by night, and the corners
  // of the yard, which give way once the camp reaches them. It's all alive while any session is
  // open, and an empty camp is still: motion costs real battery.
  yard(width, height, picture, alive, crowd, cornersClear) {
    const { scale, left } = picture, frontFoot = height - 12, gateFoot = WALL_FOOT * scale + 18;
    const s = crowd * depthAt(picture, frontFoot), far = crowd * depthAt(picture, gateFoot);
    const foot = frontFoot / s, span = width / s, front = (name, x) => on(name, x, foot, s), guardFoot = gateFoot / far;
    const guard = isNight() ? "guard-nap" : "guard", guardMirrored = `${guard}-mirrored`;
    const guardLeft = (left + GATE.stoneLeft * scale) / far - PAINT[guard][0] + 4, guardRight = (left + GATE.stoneRight * scale) / far - 4;
    const guards = alive
      ? [breathing(guard, guardLeft, guardFoot, far, 3000), breathing(guardMirrored, guardRight, guardFoot, far, 3400)]
      : [on(guard, guardLeft, guardFoot, far), on(guardMirrored, guardRight, guardFoot, far)];
    if (!cornersClear) return guards;
    const [horseW] = PAINT["horse-1"], [barrelW] = PAINT.barrel, [rackW] = PAINT.rack, [brazierW] = PAINT["brazier-1"];
    const horseX = 14, barrelLeft = horseX + horseW + 8, hayX = barrelLeft + barrelW + 4;
    const rackX = span - rackW - 14, barrelRight = rackX - barrelW - 4, brazierX = barrelRight - brazierW - 24, chickenX = span * 0.5;
    const still = [front("barrel", barrelLeft), front("hay", hayX), front("rack", rackX), front("barrel", barrelRight)];
    if (!alive) return [...still, front("horse-1", horseX), front("brazier-1", brazierX), front("chicken-1", chickenX), ...guards];
    return [...still,
      ...frames2(front("horse-1", horseX), front("horse-2", horseX), 2400),
      ...frames2(front("brazier-1", brazierX), front("brazier-2", brazierX), 420),
      ...frames2(front("chicken-1", chickenX), front("chicken-2", chickenX), 1500),
      ...guards,
    ];
  }

  // The camp's sign, hanging between the left tower and the gate.
  sign(picture, title, subtitle) {
    const { scale, left } = picture, s = Math.min(1.15, scale * 1.02), [w, h] = PAINT.sign, x = left + (TOWER_RIGHT + 16) * scale;
    const W = Math.round(w * s), H = Math.round(h * s);
    return [
      pic("sign", Math.round(x), 0, s),
      h_flex().absolute().left(Math.round(x + W * 0.1)).top(Math.round(H * 0.45)).w(Math.round(W * 0.8)).h(Math.round(H * 0.4)).gap(12).items_center().text_color(c.ink)
        .child(div().flex_none().font_family(BRUSH_FONT).text_size(Math.round(32 * s)).child("校场"))
        .child(v_flex().flex_1().min_w(0).text_size(12).line_height("15px")
          .child(div().truncate().font_semibold().child(title))
          .child(div().truncate().text_color(c.muted).child(subtitle))),
    ];
  }

  render(cx) {
    c = fieldColors();
    const machine = currentMachine(), sessions = sessionFacts(machine);
    // Holds the keyboard while shown, so typing never lands in a hidden terminal.
    if (showingField() && !this.holding) { this.holding = true; cx.spawn(async () => this.handle.focus()); }
    if (!showingField()) this.holding = false;
    const { width, height } = this.size;
    // The backdrop always fills the width and the height; the gate stays centered, and any spare is cropped.
    const scale = Math.max(width / BACKDROP[0], height / BACKDROP[1]);
    const picture = { scale, width: Math.ceil(BACKDROP[0] * scale), height: Math.ceil(BACKDROP[1] * scale), left: Math.round((width - BACKDROP[0] * scale) / 2) };
    const groundTop = Math.round(WALL_FOOT * scale) + 24, groundH = height - groundTop; // Rows start clear of the gate's guards.
    const { rows, lift, crowd } = campLayout(sessions, width, picture, groundTop, groundH);
    const cornersClear = !rows.length || rows[rows.length - 1].foot < height - YARD_CLEARANCE;
    const serving = uniqueMarks(sessions.flatMap((st) => st.fighters));
    return div().id("field").relative().size_full().overflow_hidden().bg(c.floor).rounded(10).track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .children(this.wall(picture, serving))
      .children(this.yard(width, height, picture, sessions.length > 0, crowd, cornersClear))
      .children(this.sign(picture, machineLabel(machine),
        sessions.length ? campSummary(sessions) : machineLayout(machine) === "unavailable" ? "Offline" : "No project open"))
      .child(v_flex().id("field-stations").absolute().left(0).right(0).top(groundTop).bottom(0).pt(lift).items_center().overflow_y_scrollbar()
        // Rows sit a quarter-station off each other, so the camp doesn't read as a table.
        .children(rows.map((row, i) => h_flex().id(`field-row-${i}`).relative().left(rows.length > 1 ? (i % 2 ? 1 : -1) * stationWidth(row.s) / 4 : 0).flex_none()
          .children(row.sessions.map((st) => this.station(st, row.s)))))
        .when(!sessions.length, (el) => el.child(v_flex().id("field-empty").flex_none().items_center().gap(14).pt(Math.round(groundH * 0.06)).text_color(c.onGround)
          .child(div().font_family(BRUSH_FONT).text_size(34).child("营中无事"))
          .child(div().id("field-start").px(18).h(40).flex_none().flex().items_center().rounded(12).bg(c.sticker).p(2).cursor_pointer()
            .on_click(() => openNewSession({ machine }))
            .child(div().h_full().px(16).flex().items_center().rounded(10).bg(c.paper).border(2).border_color(c.ink).hover((h) => h.border_color(HOVER))
              .text_size(13).font_semibold().text_color(c.ink).child(keyHint("sanguo.new-session", "New Session")))))))
      .child(timePill());
  }
}
