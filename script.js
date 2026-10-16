const BIRTHDAY = new Date(2005, 4, 24);

function getAge(date) {
  let age = date.getFullYear() - BIRTHDAY.getFullYear();
  const birthdayHasPassed =
    date.getMonth() > BIRTHDAY.getMonth() ||
    (date.getMonth() === BIRTHDAY.getMonth() && date.getDate() >= BIRTHDAY.getDate());

  if (!birthdayHasPassed) age -= 1;
  return age;
}

function getDaysLived(date) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor((date - BIRTHDAY) / oneDay);
}

const today = new Date();
const age = getAge(today);
const year = today.getFullYear();

document.querySelectorAll("#age, #chapter-number, #closing-chapter").forEach((element) => {
  element.textContent = age;
});

document.querySelector("#current-year").textContent = year;
document.querySelector("#footer-year").textContent = year;
document.querySelector("#days-lived").textContent = getDaysLived(today).toLocaleString("zh-CN");

const revealItems = document.querySelectorAll("[data-reveal]");
const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const delay = Number(entry.target.dataset.delay || 0);
      window.setTimeout(() => entry.target.classList.add("is-visible"), delay);
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12 }
);

revealItems.forEach((item) => revealObserver.observe(item));

const palettes = document.querySelectorAll(".palette");
const savedTheme = window.localStorage.getItem("xiaoting-theme");
const validThemes = ["sunrise", "twilight", "garden"];

function setTheme(theme) {
  if (!validThemes.includes(theme)) return;

  if (theme === "sunrise") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }

  palettes.forEach((palette) => {
    const selected = palette.dataset.theme === theme;
    palette.classList.toggle("is-active", selected);
    palette.setAttribute("aria-pressed", String(selected));
  });

  window.localStorage.setItem("xiaoting-theme", theme);
}

if (validThemes.includes(savedTheme)) setTheme(savedTheme);

palettes.forEach((palette) => {
  palette.addEventListener("click", () => setTheme(palette.dataset.theme));
});

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
