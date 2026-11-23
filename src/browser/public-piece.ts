// Authored here; public/public-piece.js is emitted by scripts/launcher-assets.mjs.
(() => {
  const piece = document.querySelector("[data-public-piece]");
  const status = piece?.querySelector<HTMLElement>("[data-copy-status]");

  let latestCopy = 0;

  async function copyText(value: string, field: HTMLInputElement | HTMLTextAreaElement, copiedMessage: string, manualMessage: string) {
    if (!status) return;
    const attempt = ++latestCopy;
    if (linkField) linkField.hidden = true;
    if (postField) postField.hidden = true;
    try {
      await navigator.clipboard.writeText(value);
      if (attempt === latestCopy) status.textContent = copiedMessage;
    } catch {
      if (attempt !== latestCopy) return;
      field.hidden = false;
      field.focus();
      field.select();
      status.textContent = manualMessage;
    }
  }

  const linkButton = piece?.querySelector<HTMLButtonElement>("[data-copy-link]");
  const linkField = piece?.querySelector<HTMLInputElement>("[data-copy-field]");
  const copyUrl = linkButton?.dataset.copyUrl;
  if (linkButton && status && linkField && copyUrl) {
    linkButton.hidden = false;
    linkButton.addEventListener("click", () =>
      copyText(copyUrl, linkField, "Link copied.", "Copy the selected link."));
  }

  const postButton = piece?.querySelector<HTMLButtonElement>("[data-copy-post]");
  const postField = piece?.querySelector<HTMLTextAreaElement>("[data-post-field]");
  if (postButton && status && postField) {
    postButton.hidden = false;
    postButton.addEventListener("click", () =>
      copyText(postField.value, postField, "Post text copied.", "Copy the selected post text."));
  }

  // The browser can report the previous same-tab entry on supported engines.
  // Keep the ordinary gallery link when that entry is unavailable or different.
  function galleryEntry(url: URL): string | null {
    if (url.origin !== location.origin || url.pathname !== "/gallery") return null;
    // The filter form and returned back links carry #gallery-results; other fragments stay normal links.
    if (url.hash && url.hash !== "#gallery-results") return null;
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

  const galleryBackLink = document.querySelector<HTMLAnchorElement>("[data-gallery-back]");
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
    result.committed?.catch(() => {});
    result.finished?.catch(() => {});
  });
})();
