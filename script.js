const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const views = [...document.querySelectorAll(".view")];
const goButtons = document.querySelectorAll("[data-go]");

function setView(name) {
  const next = views.find((view) => view.dataset.view === name);
  if (!next || next.classList.contains("is-active")) return;

  const current = views.find((view) => view.classList.contains("is-active"));

  if (!current) {
    next.hidden = false;
    next.classList.add("is-active");
    return;
  }

  current.classList.remove("is-active");

  const reveal = () => {
    current.hidden = true;
    next.hidden = false;
    // Force reflow so the enter transition always runs.
    void next.offsetWidth;
    next.classList.add("is-active");
  };

  if (reducedMotion) {
    reveal();
    return;
  }

  window.setTimeout(reveal, 220);
}

goButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.go;
    if (target) setView(target);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const active = views.find((view) => view.classList.contains("is-active"));
  if (active && active.dataset.view !== "welcome") setView("welcome");
});
