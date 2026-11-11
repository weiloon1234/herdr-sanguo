// A scroll area that keeps one of its children in view: the open tab, the highlighted row. It scrolls
// only when that child becomes another one or moves, so an area you scrolled yourself stays put until then.
// Make it in init, where Herdr wants a ScrollHandle made; attach `.track_scroll(x.handle)`; and say
// each render which child, by a key and its place among the area's direct children (-1 for none).
import { ScrollHandle } from "gpui-base";

export class KeepInView {
  constructor() {
    this.handle = ScrollHandle.new();
    this.key = undefined;
    this.index = -1;
  }

  follow(key, index) {
    if (key === this.key && index === this.index) return;
    this.key = key; this.index = index;
    this.reveal();
  }

  // Again, as when the area changes size. Children already in view stay where they are.
  reveal() {
    if (this.index >= 0) this.handle.scroll_to_item(this.index);
  }

  // The area is drawn afresh: the next follow() reveals its child even if it's the same one.
  forget() {
    this.key = undefined;
  }
}
