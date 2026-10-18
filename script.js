const BIRTHDAY = new Date(2005, 4, 24);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function getAge(date) {
  let age = date.getFullYear() - BIRTHDAY.getFullYear();
  const birthdayHasPassed = date.getMonth() > BIRTHDAY.getMonth()
    || (date.getMonth() === BIRTHDAY.getMonth() && date.getDate() >= BIRTHDAY.getDate());
  if (!birthdayHasPassed) age -= 1;
  return age;
}

function getDaysLived(date) {
  return Math.floor((date - BIRTHDAY) / (24 * 60 * 60 * 1000));
}

const today = new Date();
document.querySelector("#age").textContent = getAge(today);
document.querySelector("#current-year").textContent = today.getFullYear();
document.querySelector("#footer-year").textContent = today.getFullYear();
document.querySelector("#days-lived").textContent = getDaysLived(today).toLocaleString("zh-CN");

const revealItems = document.querySelectorAll("[data-reveal]");
if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const delay = Number(entry.target.dataset.delay || 0);
      window.setTimeout(() => entry.target.classList.add("is-visible"), delay);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -6%" });
  revealItems.forEach((item) => revealObserver.observe(item));
}

const menuButton = document.querySelector(".menu-button");
const mobileMenu = document.querySelector(".mobile-menu");

function closeMenu() {
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.querySelector(".sr-only").textContent = "打开导航";
  mobileMenu.hidden = true;
  document.body.classList.remove("menu-open");
}

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menuButton.querySelector(".sr-only").textContent = isOpen ? "打开导航" : "关闭导航";
  mobileMenu.hidden = isOpen;
  document.body.classList.toggle("menu-open", !isOpen);
});

mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mobileMenu.hidden) closeMenu();
});

const journeyItems = [...document.querySelectorAll(".journey-list li")];
journeyItems.forEach((item) => {
  const button = item.querySelector(".journey-node");
  const detail = item.querySelector(".journey-detail");
  button.addEventListener("click", () => {
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    journeyItems.forEach((otherItem) => {
      otherItem.classList.remove("is-active");
      otherItem.querySelector(".journey-node").setAttribute("aria-expanded", "false");
      otherItem.querySelector(".journey-detail").hidden = true;
    });
    if (!wasOpen) {
      item.classList.add("is-active");
      button.setAttribute("aria-expanded", "true");
      detail.hidden = false;
    }
  });
});

if (!reducedMotion && window.matchMedia("(pointer: fine)").matches) {
  document.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.setProperty("--ry", `${x * 5}deg`);
      card.style.setProperty("--rx", `${y * -5}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--ry", "0deg");
      card.style.setProperty("--rx", "0deg");
    });
  });

  const parallaxItems = [...document.querySelectorAll("[data-parallax]")];
  let scheduled = false;
  const updateParallax = () => {
    const viewportCenter = window.innerHeight / 2;
    parallaxItems.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const strength = Number(item.dataset.parallax || 0.03);
      const offset = Math.max(-18, Math.min(18, (rect.top + rect.height / 2 - viewportCenter) * strength));
      item.style.translate = `0 ${offset}px`;
    });
    scheduled = false;
  };
  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateParallax);
  }, { passive: true });
  updateParallax();
}
