const container = document.querySelector("#video-clip");
if (container) {
  import(`/creative/home.js${new URL(import.meta.url).search}`)
    .then(({ mountVideoClip }) => mountVideoClip(container))
    .catch(() => { container.textContent = "The video tool could not load. Refresh this page to try again."; });
}
