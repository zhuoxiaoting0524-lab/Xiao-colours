const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let mounted = false;
let activeCards = [];
let activeIndex = 0;

function allCards() {
  return [...document.querySelectorAll(".gallery-card")];
}

function visibleCards() {
  return allCards().filter((card) => !card.hidden);
}

function updateCount() {
  const count = visibleCards().length;
  const label = document.querySelector("#gallery-count");
  const empty = document.querySelector("#gallery-no-results");
  const grid = document.querySelector("#gallery-grid");
  if (label) label.textContent = String(count);
  if (empty) empty.hidden = count !== 0;
  if (grid) grid.classList.toggle("is-empty", count === 0);
}

function applyFilter(filter) {
  const cards = allCards();
  cards.forEach((card, index) => {
    const matches = filter === "all" || card.dataset.galleryCategory === filter;
    card.hidden = !matches;
    if (matches && !reducedMotion) {
      card.style.setProperty("--gallery-delay", `${Math.min(index, 6) * 35}ms`);
      card.classList.remove("is-revealed");
      requestAnimationFrame(() => card.classList.add("is-revealed"));
    }
  });
  document.querySelectorAll("[data-gallery-filter]").forEach((button) => {
    const selected = button.dataset.galleryFilter === filter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateCount();
}

function lightbox() {
  return document.querySelector("#gallery-lightbox");
}

function paintLightbox() {
  const card = activeCards[activeIndex];
  if (!card) return;
  const image = document.querySelector("#gallery-lightbox-image");
  const title = document.querySelector("#gallery-lightbox-title");
  const note = document.querySelector("#gallery-lightbox-note");
  if (image) {
    image.src = card.dataset.gallerySrc || card.querySelector("img")?.src || "";
    image.alt = card.querySelector("img")?.alt || "Gallery photo";
  }
  if (title) title.textContent = card.dataset.galleryTitle || "Gallery";
  if (note) note.textContent = card.dataset.galleryNote || "";
}

function openLightbox(card) {
  activeCards = visibleCards();
  activeIndex = Math.max(0, activeCards.indexOf(card));
  paintLightbox();
  const dialog = lightbox();
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function stepLightbox(direction) {
  if (!activeCards.length) return;
  activeIndex = (activeIndex + direction + activeCards.length) % activeCards.length;
  paintLightbox();
}

export function mountGallery() {
  if (mounted) return;
  mounted = true;

  document.querySelectorAll("[data-gallery-filter]").forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.galleryFilter || "all"));
  });

  allCards().forEach((card) => {
    card.addEventListener("click", () => openLightbox(card));
  });

  document.querySelector("[data-gallery-prev]")?.addEventListener("click", () => stepLightbox(-1));
  document.querySelector("[data-gallery-next]")?.addEventListener("click", () => stepLightbox(1));

  lightbox()?.addEventListener("click", (event) => {
    if (event.target === lightbox()) lightbox().close();
  });

  document.addEventListener("keydown", (event) => {
    const dialog = lightbox();
    if (!dialog?.open) return;
    if (event.key === "ArrowLeft") stepLightbox(-1);
    if (event.key === "ArrowRight") stepLightbox(1);
  });

  applyFilter("all");
}
