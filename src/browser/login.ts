// MIT. Owner sign-in. A same-origin JSON post; no third-party script.
// Authored here; public/login.js is emitted by scripts/launcher-assets.mjs.
import { rememberStudioSignInRoute } from "./studio-login-return.js";

const studioSignIn = location.pathname === "/studio" || location.pathname === "/login";
const continueLink = document.querySelector<HTMLAnchorElement>("[data-composer-sign-in]");
if (studioSignIn) {
  continueLink?.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;
    rememberStudioSignInRoute(location.hash);
  });
}

type LoginResponse = { error?: { message?: string } };

const form = document.querySelector<HTMLFormElement>("#login-form")!;
const status = document.querySelector<HTMLElement>("#login-status")!;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector<HTMLButtonElement>("button")!;
  button.disabled = true;
  status.textContent = "Checking…";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: new FormData(form).get("passphrase") }),
    });
    const payload = await response.json().catch(() => ({})) as LoginResponse | null;
    if (!response.ok) {
      status.textContent = payload?.error?.message ?? "That did not work. Try again.";
      button.disabled = false;
      form.querySelector<HTMLInputElement>('[name="passphrase"]')!.select();
      return;
    }
    if (studioSignIn) rememberStudioSignInRoute(location.hash);
    location.href = "/";
  } catch {
    status.textContent = "Could not reach the studio. Check the connection.";
    button.disabled = false;
  }
});
