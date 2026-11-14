// Installation theme for Media Studio. Presentation only; no studio state.
const root = document.documentElement;
const key = "media-studio-theme";
const saved = (() => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
})();
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const initial = saved === "dark" || saved === "light" ? saved : prefersDark ? "dark" : "light";
root.dataset.theme = initial;

function sync() {
  const dark = root.dataset.theme === "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#17181b" : "#f4f0e8");
  for (const button of document.querySelectorAll(".theme-toggle")) {
    button.hidden = false;
    button.textContent = dark ? "Light" : "Dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
}

sync();
document.addEventListener("DOMContentLoaded", () => {
  sync();
  for (const button of document.querySelectorAll(".theme-toggle")) {
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem(key, next);
      } catch {
        // Theme preference is optional.
      }
      sync();
    });
  }
});
