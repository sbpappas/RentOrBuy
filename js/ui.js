/**
 * Wires the form to the calculation engine (calculator.js) and the chart
 * (chart.js). Every field id here matches a key in calculator.js's
 * `inputs` object exactly, so reading the form is a straight loop rather
 * than a manual field-by-field mapping.
 */
(function () {
  const FIELD_IDS = [
    "homePrice",
    "downPaymentPercent",
    "mortgageRatePercent",
    "mortgageTermYears",
    "closingCostPercent",
    "pmiRatePercent",
    "propertyTaxPercent",
    "homeInsurancePercent",
    "maintenancePercent",
    "hoaMonthly",
    "sellingCostPercent",
    "monthlyRent",
    "rentersInsuranceMonthly",
    "rentGrowthPercent",
    "homeAppreciationPercent",
    "investmentReturnPercent",
    "inflationPercent",
    "marginalTaxRatePercent",
    "standardDeduction",
    "yearsToStay",
  ];

  function readInputs() {
    const inputs = {};
    for (const id of FIELD_IDS) {
      inputs[id] = Number(document.getElementById(id).value);
    }
    return inputs;
  }

  // Keeps every paired range/number input in sync (either direction) and
  // drives the slider's filled-track gradient. Recalculation itself is
  // handled by a single delegated listener on the form (see initUI) so
  // each user action triggers exactly one recompute, not two.
  function wireSliderSync() {
    document.querySelectorAll('input[type="range"][data-sync]').forEach((range) => {
      const number = document.getElementById(range.dataset.sync);
      const updateFill = () => {
        const pct = ((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100;
        range.style.setProperty("--fill", pct + "%");
      };
      range.addEventListener("input", () => {
        number.value = range.value;
        updateFill();
      });
      number.addEventListener("input", () => {
        const clamped = Math.min(Math.max(Number(number.value) || Number(range.min), Number(range.min)), Number(range.max));
        range.value = clamped;
        updateFill();
      });
      updateFill();
    });
  }

  function animateNumber(el, from, to, duration = 400) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = RentVsBuy.formatCurrency(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  let lastDifference = null;

  function renderHeadline(summary, yearsToStay) {
    const verdictEl = document.getElementById("headlineVerdict");
    const sentenceEl = document.getElementById("headlineSentence");
    sentenceEl.textContent = "";

    if (summary.verdict === "tie") {
      verdictEl.textContent = "It's close";
      sentenceEl.appendChild(
        document.createTextNode(`Buying and renting come out roughly even after ${yearsToStay} years.`)
      );
      lastDifference = summary.netWorthDifference;
      return;
    }

    const isBuy = summary.verdict === "buy";
    verdictEl.textContent = isBuy ? "Buying wins" : "Renting wins";

    const prefix = isBuy
      ? "Buying is better after "
      : "Renting (and investing the difference) is better after ";
    sentenceEl.appendChild(document.createTextNode(`${prefix}${yearsToStay} years, by about `));

    const amountSpan = document.createElement("span");
    amountSpan.className = `amount ${isBuy ? "buy" : "rent"}`;
    sentenceEl.appendChild(amountSpan);
    sentenceEl.appendChild(document.createTextNode(" in net worth."));

    animateNumber(amountSpan, lastDifference == null ? 0 : lastDifference, summary.netWorthDifference);
    lastDifference = summary.netWorthDifference;
  }

  function renderTable(years) {
    const tbody = document.getElementById("breakdownBody");
    tbody.textContent = "";
    for (const y of years) {
      const tr = document.createElement("tr");
      const values = [
        [String(y.year), null],
        [RentVsBuy.formatCurrency(y.buyingCost), null],
        [RentVsBuy.formatCurrency(y.rentingCost), null],
        [RentVsBuy.formatCurrency(y.buyerNetWorth), "buy"],
        [RentVsBuy.formatCurrency(y.renterNetWorth), "rent"],
      ];
      for (const [text, cls] of values) {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.classList.add(cls);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function initUI(chart) {
    wireSliderSync();

    const recalcAndRender = () => {
      const inputs = readInputs();
      const years = RentVsBuy.computeYearlyBreakdown(inputs);
      const summary = RentVsBuy.summarize(years);
      renderHeadline(summary, inputs.yearsToStay);
      chart.update(years, summary);
      renderTable(years);
    };

    document.getElementById("inputsForm").addEventListener("input", recalcAndRender);
    document.getElementById("inputsForm").addEventListener("submit", (e) => e.preventDefault());
    recalcAndRender();
  }

  window.RentVsBuy = Object.assign(window.RentVsBuy || {}, { initUI });
})();
