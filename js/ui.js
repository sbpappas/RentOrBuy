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

    animateNumber(amountSpan, lastDifference == null ? 0 : lastDifference, summary.netWorthDifference); //cool
    lastDifference = summary.netWorthDifference;
  }

  // Both boxes read off the *first* year of the simulation -- i.e. what
  // you'd actually pay next month at today's price/rent, before growth,
  // appreciation, or the investment-return compounding kick in.
  function renderMonthlyBreakdowns(years) {
    const first = years[0];
    const setText = (id, value) => {
      document.getElementById(id).textContent = RentVsBuy.formatCurrency(Math.round(value));
    };

    if (!first) return;

    const principalInterest = first.mortgagePayment / 12;
    const propertyTax = first.propertyTax / 12;
    const insurance = first.homeInsurance / 12;
    const pmi = first.pmi / 12;
    const hoa = first.hoa / 12;
    const mortgageTotal = principalInterest + propertyTax + insurance + pmi + hoa;

    setText("mbPrincipalInterest", principalInterest);
    setText("mbPropertyTax", propertyTax);
    setText("mbInsurance", insurance);
    setText("mbPmi", pmi);
    setText("mbHoa", hoa);
    setText("mbTotal", mortgageTotal);
    document.getElementById("mbPmiRow").hidden = pmi < 0.5;

    const rent = first.rent / 12;
    const rentersInsurance = first.rentersInsurance / 12;
    const rentTotal = rent + rentersInsurance;
    const invested = (first.buyingCost - first.rentingCost) / 12;

    setText("rbRent", rent);
    setText("rbInsurance", rentersInsurance);
    setText("rbTotal", rentTotal);

    const investedLabel = document.getElementById("rbInvestedLabel");
    const investedValue = document.getElementById("rbInvested");
    if (invested >= 0) {
      investedLabel.textContent = "Difference between mortgage and rent invested each month (this is the opportunity cost of buying)";
      setText("rbInvested", invested);
    } else {
      investedLabel.textContent = "Monthly shortfall (drawn from savings)";
      setText("rbInvested", Math.abs(invested));
    }
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
      renderMonthlyBreakdowns(years);
      renderTable(years);
    };

    document.getElementById("inputsForm").addEventListener("input", recalcAndRender);
    document.getElementById("inputsForm").addEventListener("submit", (e) => e.preventDefault());
    recalcAndRender();
  }

  window.RentVsBuy = Object.assign(window.RentVsBuy || {}, { initUI });
})();
