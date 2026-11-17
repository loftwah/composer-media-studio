const piece = document.querySelector("[data-public-piece]");
const button = piece?.querySelector("[data-copy-link]");
const status = piece?.querySelector("[data-copy-status]");
const field = piece?.querySelector("[data-copy-field]");

if (button && status && field) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const url = button.dataset.copyUrl;
    try {
      await navigator.clipboard.writeText(url);
      field.hidden = true;
      status.textContent = "Link copied.";
    } catch {
      field.hidden = false;
      field.focus();
      field.select();
      status.textContent = "Copy the selected link.";
    }
  });
}

// The browser can report the previous same-tab entry on supported engines.
// Keep the ordinary gallery link when that entry is unavailable or different.
function galleryEntry(url) {
  if (url.origin !== location.origin || url.pathname !== "/gallery" || url.hash) return null;
  const params = url.searchParams;
  if (new Set(params.keys()).size !== params.size) return null;
  for (const key of ["q", "project", "kind", "capability"]) {
    if (params.get(key) === "") params.delete(key);
  }
  if (params.get("page") === "1") params.delete("page");
  if (params.get("order") === "newest") params.delete("order");
  params.sort();
  return params.toString();
}

const galleryBackLink = document.querySelector("[data-gallery-back]");
galleryBackLink?.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const navigation = window.navigation;
  if (!navigation?.canGoBack || !navigation.currentEntry) return;
  const previous = navigation.entries()[navigation.currentEntry.index - 1];
  if (!previous?.url) return;
  const expected = galleryEntry(new URL(galleryBackLink.href));
  if (expected === null || galleryEntry(new URL(previous.url)) !== expected) return;
  event.preventDefault();
  const result = navigation.traverseTo(previous.key);
  result.committed.catch(() => {});
  result.finished.catch(() => {});
});
