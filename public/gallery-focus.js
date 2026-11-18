// Keyboard continuity for the public gallery's filtered results.
// The browser restores the gallery's history entry and scroll after Back to
// gallery, but focus lands on the document, so Tab restarts at Skip to content.
// Enter on a card records which card this entry left from, and returning to the
// entry puts focus back on that exact card without moving the restored scroll.
// Pointer and modifier clicks, direct loads and browsers without the Navigation
// API keep the ordinary link behaviour.
const galleryResults = document.querySelector("[data-gallery-cards]");
const navigation = window.navigation;
const FOCUS_KEY = "galleryCardFocus";

// Only a Navigation API entry state this script can merge into is usable; a
// foreign value stays untouched rather than being replaced.
function usableState(state) {
  return state === undefined || state === null || (typeof state === "object" && !Array.isArray(state));
}

galleryResults?.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0) return;
  // Keyboard activation reports detail 0; a pointer click reports its click count.
  if (event.detail !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!navigation?.updateCurrentEntry || !navigation.currentEntry) return;
  const card = event.target instanceof Element ? event.target.closest("a.gallery-card") : null;
  if (!card || !galleryResults.contains(card)) return;
  const href = card.getAttribute("href");
  if (!href) return;
  let state;
  try {
    state = navigation.currentEntry.getState();
  } catch {
    return;
  }
  if (!usableState(state)) return;
  try {
    navigation.updateCurrentEntry({ state: { ...state, [FOCUS_KEY]: href } });
  } catch {
    // A locked or uncloneable entry keeps the reader's ordinary link navigation.
  }
});

function restoreCardFocus(event) {
  const entry = navigation?.currentEntry;
  if (!galleryResults || !entry?.getState) return;
  if (!event.persisted && performance.getEntriesByType("navigation")[0]?.type !== "back_forward") return;

  let href;
  try {
    const state = entry.getState();
    if (typeof state?.[FOCUS_KEY] !== "string") return;
    const { [FOCUS_KEY]: marker, ...remainingState } = state;
    href = marker;
    // This return consumes the marker so a later pointer visit cannot reuse it.
    navigation.updateCurrentEntry({ state: remainingState });
  } catch {
    return;
  }

  const active = document.activeElement;
  const fragmentFocus = location.hash === "#gallery-results" && active === document.getElementById("gallery-results");
  if (active && active !== document.body && active !== document.documentElement && !fragmentFocus) return;
  for (const card of galleryResults.querySelectorAll("a.gallery-card")) {
    if (card.getAttribute("href") === href) {
      card.focus({ preventScroll: true });
      return;
    }
  }
}

// Let the browser restore focus to the results fragment before returning to the card.
window.addEventListener("pageshow", event => requestAnimationFrame(() => restoreCardFocus(event)));
