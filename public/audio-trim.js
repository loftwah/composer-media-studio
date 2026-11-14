const container = document.querySelector("#audio-trim");
if (container) {
  import(`/creative/home.js${new URL(import.meta.url).search}`)
    .then(({ mountAudioTrim }) => mountAudioTrim(container))
    .catch(() => { container.textContent = "The audio tool could not load. Refresh this page to try again."; });
}
