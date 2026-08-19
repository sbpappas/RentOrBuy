/**
 * Pure calculation engine for the rent-vs-buy comparison. No DOM access
 * anywhere in this file -- that's what makes it directly unit-testable
 * from Node (see tests/calculator.test.js) and reusable from the browser
 * UI without change.
 *
 * Methodology: year-by-year net worth comparison.
 *   - Buyer's ending position = home value - remaining mortgage - selling
 *     costs, at the end of the chosen horizon.
 *   - Renter's ending position = a hypothetical investment account that
 *     starts with what the buyer spent up front (down payment + closing
 *     costs) and, every year, absorbs that year's (buying cost - renting
 *     cost), growing at the assumed investment return rate. A year where
 *     renting is cheaper adds to the account; a year where buying is
 *     cheaper draws it down. This single-account model is the standard,
 *     correct way to capture opportunity cost in both directions at once.
 */

const SALT_CAP = 10000; // mortgage-interest + property-tax deduction cap, 2017 tax law

/**
 * Standard fixed-rate mortgage amortization schedule.
 * @returns {{month:number, payment:number, principal:number, interest:number, balance:number}[]}
 */
function amortizationSchedule(loanAmount, annualRatePercent, termYears) {
  const months = Math.round(termYears * 12);
  const monthlyRate = annualRatePercent / 100 / 12;

  let payment;
  if (monthlyRate === 0) {
    payment = loanAmount / months;
  } else {
    const factor = Math.pow(1 + monthlyRate, months);
    payment = (loanAmount * (monthlyRate * factor)) / (factor - 1);
  }

  const schedule = [];
  let balance = loanAmount;
  for (let month = 1; month <= months; month++) {
    const interest = balance * monthlyRate;
    let principal = payment - interest;

    // Last payment (or floating-point drift) can overshoot the balance;
    // clamp so the loan ends at exactly zero instead of a stray cent.
    if (principal > balance) {
      principal = balance;
    }
    balance = Math.max(0, balance - principal);
    schedule.push({ month, payment: principal + interest, principal, interest, balance });
  }
  return schedule;
}

/**
 * Runs the full year-by-year buy-vs-rent simulation over `inputs.yearsToStay`.
 */
function computeYearlyBreakdown(inputs) {
  const {
    homePrice,
    downPaymentPercent,
    mortgageRatePercent,
    mortgageTermYears,
    closingCostPercent,
    pmiRatePercent,
    propertyTaxPercent,
    homeInsurancePercent,
    maintenancePercent,
    hoaMonthly,
    sellingCostPercent,
    monthlyRent,
    rentersInsuranceMonthly,
    rentGrowthPercent,
    homeAppreciationPercent,
    investmentReturnPercent,
    inflationPercent,
    marginalTaxRatePercent,
    standardDeduction,
    yearsToStay,
  } = inputs;

  const downPayment = homePrice * (downPaymentPercent / 100);
  const closingCosts = homePrice * (closingCostPercent / 100);
  const loanAmount = Math.max(0, homePrice - downPayment);
  const schedule = amortizationSchedule(loanAmount, mortgageRatePercent, mortgageTermYears);

  const years = [];
  let investmentBalance = downPayment + closingCosts;

  for (let year = 1; year <= yearsToStay; year++) {
    const growthFactorStart = Math.pow(1 + homeAppreciationPercent / 100, year - 1);
    const growthFactorEnd = Math.pow(1 + homeAppreciationPercent / 100, year);
    const homeValueStart = homePrice * growthFactorStart;
    const homeValueEnd = homePrice * growthFactorEnd;

    const startMonthIndex = (year - 1) * 12;
    const yearMonths = schedule.slice(startMonthIndex, startMonthIndex + 12);
    const loanBalanceStart =
      startMonthIndex === 0 ? loanAmount : schedule[startMonthIndex - 1]?.balance ?? 0;
    const loanBalanceEnd = yearMonths.length
      ? yearMonths[yearMonths.length - 1].balance
      : loanBalanceStart;

    const mortgagePayment = yearMonths.reduce((sum, m) => sum + m.payment, 0);
    const mortgageInterest = yearMonths.reduce((sum, m) => sum + m.interest, 0);

    const propertyTax = homeValueStart * (propertyTaxPercent / 100);
    const homeInsurance = homeValueStart * (homeInsurancePercent / 100);
    const maintenance = homeValueStart * (maintenancePercent / 100);

    const inflationFactor = Math.pow(1 + inflationPercent / 100, year - 1);
    const hoa = hoaMonthly * 12 * inflationFactor;
    const rentersInsurance = rentersInsuranceMonthly * 12 * inflationFactor;

    // PMI applies only while equity (based on current home value) is below 20%.
    const equityRatio = homeValueStart > 0 ? (homeValueStart - loanBalanceStart) / homeValueStart : 1;
    const pmi = equityRatio < 0.2 ? loanBalanceStart * (pmiRatePercent / 100) : 0;

    const itemizedDeduction = Math.min(propertyTax, SALT_CAP) + mortgageInterest;
    const taxBenefit = Math.max(0, itemizedDeduction - standardDeduction) * (marginalTaxRatePercent / 100);

    const buyingCost = mortgagePayment + propertyTax + homeInsurance + maintenance + hoa + pmi - taxBenefit;

    const rentGrowthFactor = Math.pow(1 + rentGrowthPercent / 100, year - 1);
    const rent = monthlyRent * 12 * rentGrowthFactor;
    const rentingCost = rent + rentersInsurance;

    investmentBalance = investmentBalance * (1 + investmentReturnPercent / 100) + (buyingCost - rentingCost);

    const buyerNetWorth = homeValueEnd * (1 - sellingCostPercent / 100) - loanBalanceEnd;
    const renterNetWorth = investmentBalance;

    years.push({
      year,
      homeValue: homeValueEnd,
      loanBalance: loanBalanceEnd,
      mortgagePayment,
      mortgageInterest,
      propertyTax,
      homeInsurance,
      maintenance,
      hoa,
      pmi,
      taxBenefit,
      buyingCost,
      rent,
      rentersInsurance,
      rentingCost,
      investmentBalance,
      buyerNetWorth,
      renterNetWorth,
    });
  }

  return years;
}

/**
 * Reduces a yearly breakdown to the headline numbers the UI needs.
 */
function summarize(yearlyBreakdown) {
  if (!yearlyBreakdown.length) {
    return { breakEvenYear: null, finalBuyerNetWorth: 0, finalRenterNetWorth: 0, verdict: "tie", netWorthDifference: 0 };
  }

  let breakEvenYear = null;
  for (const y of yearlyBreakdown) {
    if (y.buyerNetWorth >= y.renterNetWorth) {
      breakEvenYear = y.year;
      break;
    }
  }

  const last = yearlyBreakdown[yearlyBreakdown.length - 1];
  const finalBuyerNetWorth = last.buyerNetWorth;
  const finalRenterNetWorth = last.renterNetWorth;
  const netWorthDifference = Math.abs(finalBuyerNetWorth - finalRenterNetWorth);
  const verdict =
    Math.abs(finalBuyerNetWorth - finalRenterNetWorth) < 0.005
      ? "tie"
      : finalBuyerNetWorth > finalRenterNetWorth
      ? "buy"
      : "rent";

  return { breakEvenYear, finalBuyerNetWorth, finalRenterNetWorth, verdict, netWorthDifference };
}

// Works both as a plain <script> (globals below) and via Node's require()
// for the test suite -- no bundler/build step either way.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { amortizationSchedule, computeYearlyBreakdown, summarize, SALT_CAP };
}
if (typeof window !== "undefined") {
  window.RentVsBuy = Object.assign(window.RentVsBuy || {}, {
    amortizationSchedule,
    computeYearlyBreakdown,
    summarize,
    SALT_CAP,
  });
}
