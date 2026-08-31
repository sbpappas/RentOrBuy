const test = require('node:test');
const assert = require('node:assert/strict');
const { computeYearlyBreakdown } = require('../js/calculator.js');

test('uses the explicit down payment amount when present', () => {
  const years = computeYearlyBreakdown({
    homePrice: 300000,
    downPaymentPercent: 10,
    downPaymentAmount: 120000,
    mortgageRatePercent: 0,
    mortgageTermYears: 1,
    closingCostPercent: 0,
    pmiRatePercent: 0,
    propertyTaxPercent: 0,
    homeInsurancePercent: 0,
    maintenancePercent: 0,
    hoaMonthly: 0,
    sellingCostPercent: 0,
    monthlyRent: 0,
    rentersInsuranceMonthly: 0,
    rentGrowthPercent: 0,
    homeAppreciationPercent: 0,
    investmentReturnPercent: 0,
    inflationPercent: 0,
    marginalTaxRatePercent: 0,
    standardDeduction: 0,
    yearsToStay: 1,
  });

  assert.equal(years[0].buyingCost, 180000);
  assert.equal(years[0].investmentBalance, 300000);
});
