(function () {
  function initThemeToggle() {
    const button = document.getElementById("themeToggle");
    const sunIcon = button.querySelector(".icon-sun");
    const moonIcon = button.querySelector(".icon-moon");
    const stored = localStorage.getItem("theme"); // "light" | "dark" | null (follow system)

    function systemPrefersDark() {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function apply(theme) {
      if (theme) document.documentElement.setAttribute("data-theme", theme);
      else document.documentElement.removeAttribute("data-theme");

      const isDark = theme ? theme === "dark" : systemPrefersDark();
      sunIcon.hidden = isDark;
      moonIcon.hidden = !isDark;
    }

    apply(stored);

    button.addEventListener("click", () => {
      const current = localStorage.getItem("theme") || (systemPrefersDark() ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      apply(next);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const chart = new RentVsBuy.NetWorthChart(document.getElementById("chart"));
    RentVsBuy.initUI(chart);
    initThemeToggle();
  });
})();
