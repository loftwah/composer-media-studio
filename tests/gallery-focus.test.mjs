import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/gallery-focus.js', import.meta.url), 'utf8');

// Entries, updates and focus options cross the vm realm, so compare plain data.
const plain = value => JSON.parse(JSON.stringify(value));

// A small DOM stand-in: just the results list, its cards and a Navigation API
// entry the script may read and update.
function mount({ state, cards = [], active = null, updateThrows = false, noNavigation = false, noResults = false, navigationType = "navigate" } = {}) {
  const updates = [];
  const handlers = new Map();
  const body = { tag: "body" };
  const html = { tag: "html" };
  let entryState = state;
  let activeElement = active;

  class Element {
    constructor({ href, tag = "a" } = {}) { this.href = href; this.tag = tag; this.parent = null; this.focusCalls = []; }
    getAttribute(name) { return name === "href" && this.tag === "a" ? (this.href ?? null) : null; }
    closest(selector) {
      for (let node = this; node; node = node.parent) if (selector === "a.gallery-card" && node.tag === "a") return node;
      return null;
    }
    contains(node) {
      for (let current = node; current; current = current.parent) if (current === this) return true;
      return false;
    }
    focus(options) { this.focusCalls.push(options); activeElement = this; }
    addEventListener(type, handler) { handlers.set(`results:${type}`, handler); }
    querySelectorAll(selector) { return selector === "a.gallery-card" ? this.cards : []; }
  }

  const results = new Element({ tag: "ul" });
  results.cards = cards.map(href => { const card = new Element({ href }); card.parent = results; return card; });
  const document = {
    body,
    get activeElement() { return activeElement ?? body; },
    documentElement: html,
    querySelector(selector) { return selector === "[data-gallery-cards]" && !noResults ? results : null; },
  };
  const navigation = {
    currentEntry: { getState() { return entryState; } },
    updateCurrentEntry({ state: next }) {
      if (updateThrows) throw new Error("locked entry");
      updates.push(next);
      entryState = next;
    },
  };
  const window = {
    ...(noNavigation ? {} : { navigation }),
    addEventListener(type, handler) { handlers.set(`window:${type}`, handler); },
  };
  vm.runInContext(source, vm.createContext({ document, window, Element, performance: { getEntriesByType: () => [{ type: navigationType }] } }));
  return {
    Element,
    results,
    updates,
    state: () => entryState,
    click(target, { detail = 0, button = 0, ...modifiers } = {}) {
      const event = { target, detail, button, defaultPrevented: false, ...modifiers };
      handlers.get("results:click")?.(event);
      return event;
    },
    pageshow(persisted = true) { handlers.get("window:pageshow")?.({ persisted }); },
  };
}

test('Enter on a gallery card records that card on this entry and keeps existing state', () => {
  const page = mount({ state: { preserved: true }, cards: ["/p/abyssjaw?back=%2Fgallery", "/p/next"] });
  const event = page.click(page.results.cards[0]);
  assert.equal(event.defaultPrevented, false, "the ordinary link navigation still runs");
  assert.deepEqual(plain(page.updates), [{ preserved: true, galleryCardFocus: "/p/abyssjaw?back=%2Fgallery" }]);
  assert.deepEqual(plain(page.state()), { preserved: true, galleryCardFocus: "/p/abyssjaw?back=%2Fgallery" });
  assert.equal(page.results.cards[0].focusCalls.length, 0, "opening a card never focuses anything");
});

test('a card keeps the entry state when it has no state yet', () => {
  const page = mount({ cards: ["/p/abyssjaw"] });
  page.click(page.results.cards[0]);
  assert.deepEqual(plain(page.updates), [{ galleryCardFocus: "/p/abyssjaw" }]);
});

test('pointer and modifier activations, other targets and foreign state stay untouched', () => {
  const page = mount({ state: { preserved: true }, cards: ["/p/abyssjaw"] });
  const card = page.results.cards[0];
  page.click(card, { detail: 1 });
  page.click(card, { detail: 0, ctrlKey: true });
  page.click(card, { detail: 0, metaKey: true });
  page.click(card, { detail: 0, shiftKey: true });
  page.click(card, { detail: 0, altKey: true });
  page.click(page.results, { detail: 0 });
  assert.deepEqual(page.updates, []);
  assert.deepEqual(plain(page.state()), { preserved: true });
});

test('foreign, non-object entry state and locked entries keep the ordinary link', () => {
  for (const state of ["a string", 7, ["a", "list"]]) {
    const page = mount({ state, cards: ["/p/abyssjaw"] });
    page.click(page.results.cards[0]);
    assert.deepEqual(page.updates, []);
  }
  const locked = mount({ state: { preserved: true }, cards: ["/p/abyssjaw"], updateThrows: true });
  assert.doesNotThrow(() => locked.click(locked.results.cards[0]));
  assert.deepEqual(locked.updates, []);
});

test('returning to the entry focuses the exact card without moving the scroll', () => {
  const page = mount({ state: { galleryCardFocus: "/p/abyssjaw" }, cards: ["/p/earlier", "/p/abyssjaw", "/p/later"] });
  page.pageshow();
  assert.deepEqual(page.results.cards[0].focusCalls, []);
  assert.deepEqual(plain(page.results.cards[1].focusCalls), [{ preventScroll: true }]);
  assert.deepEqual(page.results.cards[2].focusCalls, []);
});

test('no marker, a missing card, focus already taken or no results leave focus alone', () => {
  const plain = mount({ cards: ["/p/abyssjaw"] });
  plain.pageshow();
  assert.deepEqual(plain.results.cards[0].focusCalls, []);

  const moved = mount({ state: { galleryCardFocus: "/p/abyssjaw" }, cards: ["/p/abyssjaw"], active: { tag: "button" } });
  moved.pageshow();
  assert.deepEqual(moved.results.cards[0].focusCalls, []);

  const gone = mount({ state: { galleryCardFocus: "/p/withdrawn" }, cards: ["/p/abyssjaw"] });
  gone.pageshow();
  assert.deepEqual(gone.results.cards[0].focusCalls, []);

  const noResults = mount({ state: { galleryCardFocus: "/p/abyssjaw" }, cards: ["/p/abyssjaw"], noResults: true });
  noResults.pageshow();
  assert.deepEqual(noResults.results.cards[0].focusCalls, []);

  const noApi = mount({ state: { galleryCardFocus: "/p/abyssjaw" }, cards: ["/p/abyssjaw"], noNavigation: true });
  noApi.pageshow();
  assert.deepEqual(noApi.results.cards[0].focusCalls, []);
});

test('near-miss hrefs do not take focus, and a click on card content records its card', () => {
  const page = mount({ state: { galleryCardFocus: "/p/abyssjaw" }, cards: ["/p/abyssjaw-two", "/p/abyssjaw"] });
  page.pageshow();
  assert.deepEqual(page.results.cards[0].focusCalls, []);
  assert.deepEqual(plain(page.results.cards[1].focusCalls), [{ preventScroll: true }]);

  const inner = mount({ cards: ["/p/abyssjaw"] });
  const label = new inner.Element({ tag: "strong" });
  label.parent = inner.results.cards[0];
  inner.click(label);
  assert.deepEqual(plain(inner.updates), [{ galleryCardFocus: "/p/abyssjaw" }]);
});

test("a reload keeps existing focus and a rebuilt history return consumes the marker", () => {
  const state = { other: "kept", galleryCardFocus: "/p/abyssjaw" };
  const reloaded = mount({ state, cards: ["/p/abyssjaw"], navigationType: "reload" });
  reloaded.pageshow(false);
  assert.deepEqual(reloaded.results.cards[0].focusCalls, []);

  const returned = mount({ state, cards: ["/p/abyssjaw", "/p/another"], navigationType: "back_forward" });
  returned.pageshow(false);
  assert.deepEqual(plain(returned.results.cards[0].focusCalls), [{ preventScroll: true }]);
  assert.deepEqual(plain(returned.state()), { other: "kept" });
  returned.click(returned.results.cards[1], { detail: 1 });
  assert.deepEqual(plain(returned.state()), { other: "kept" });
});
