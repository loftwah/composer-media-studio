const container = document.querySelector("#add-music");
if (container) {
  import(`/creative/home.js${new URL(import.meta.url).search}`)
    .then(({ mountAddMusic }) => mountAddMusic(container))
    .catch(() => { container.textContent = "The music tool could not load. Refresh this page to try again."; });
}
