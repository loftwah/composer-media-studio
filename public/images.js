const container = document.querySelector("#images");
if (container) {
  import(`/creative/home.js${new URL(import.meta.url).search}`)
    .then(({ mountImages }) => mountImages(container))
    .catch(() => {
      container.textContent = "The image tool could not load. Refresh this page to try again.";
    });
}
