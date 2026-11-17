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
