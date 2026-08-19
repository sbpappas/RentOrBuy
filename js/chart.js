/**
 * Zero-dependency canvas line chart: buyer vs. renter net worth over time.
 *
 * Colors are never hardcoded here -- they're read from CSS custom
 * properties on the container at render time, so the chart automatically
 * follows the page's light/dark theme without this file knowing which
 * mode is active. Palette (validated with the dataviz skill's
 * validate_palette.js, all checks pass in both modes):
 *   --series-buy  : #2a78d6 light / #3987e5 dark  (categorical slot 1, blue)
 *   --series-rent : #eb6834 light / #d95926 dark  (categorical slot 2, orange)
 *
 * "Buy" and "Rent" are two named series, not a good/bad state, so this is
 * categorical identity color -- never status red/green -- since either
 * one can turn out to be the financially better outcome.
 */

(function () {
  const MARGIN = { top: 24, right: 24, bottom: 40, left: 72 };
  const ANIMATION_MS = 400;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function formatCurrency(value, { compact = false } = {}) {
    const abs = Math.abs(value);
    if (compact && abs >= 1_000_000) {
      return (value < 0 ? "-$" : "$") + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "M";
    }
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  // "Nice numbers" tick generation so gridlines land on clean values
  // (0 / 50,000 / 100,000, ...) instead of raw fractions of the range.
  function niceTicks(min, max, targetCount = 5) {
    const range = niceNum(max - min, false);
    const step = niceNum(range / (targetCount - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v));
    return ticks;
  }

  function niceNum(range, round) {
    const exponent = Math.floor(Math.log10(range || 1));
    const fraction = range / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  }

  // Picks a readable subset of whole years for the x-axis -- every year
  // for a short horizon, thinning out to a clean step (2, 5, 10, ...) for
  // a long one so labels never crowd into each other. The final year is
  // always included so the axis never looks like it stops early.
  function pickYearTicks(minYear, maxYear, maxLabels = 8) {
    const span = maxYear - minYear;
    if (span <= 0) return [minYear];
    const step = Math.max(1, niceNum(Math.ceil(span / (maxLabels - 1)), true));
    const ticks = [];
    for (let y = minYear; y < maxYear; y += step) ticks.push(y);
    ticks.push(maxYear);
    return ticks;
  }

  class NetWorthChart {
    constructor(container) {
      this.container = container;
      this.container.classList.add("chart-root");

      this.canvas = document.createElement("canvas");
      this.canvas.className = "chart-canvas";
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");

      this.crosshairLine = document.createElement("div");
      this.crosshairLine.className = "chart-crosshair";
      this.crosshairLine.hidden = true;
      this.container.appendChild(this.crosshairLine);

      this.tooltip = document.createElement("div");
      this.tooltip.className = "chart-tooltip";
      this.tooltip.hidden = true;
      this.container.appendChild(this.tooltip);

      this.years = [];
      this.summary = null;
      this.prevYears = null;
      this.animationStart = null;
      this.animationFrame = null;

      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);
      this.canvas.addEventListener("pointermove", this._onPointerMove);
      this.canvas.addEventListener("pointerleave", this._onPointerLeave);

      this._resizeObserver = new ResizeObserver(() => this._draw(1));
      this._resizeObserver.observe(this.container);
    }

    update(yearlyBreakdown, summary) {
      const sameLength = this.years.length === yearlyBreakdown.length;
      this.prevYears = sameLength ? this.years : null;
      this.years = yearlyBreakdown;
      this.summary = summary;

      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      if (!this.prevYears || !yearlyBreakdown.length) {
        this._draw(1);
        return;
      }
      this.animationStart = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - this.animationStart) / ANIMATION_MS);
        this._draw(easeOutCubic(t));
        if (t < 1) this.animationFrame = requestAnimationFrame(step);
      };
      this.animationFrame = requestAnimationFrame(step);
    }

    _theme() {
      const style = getComputedStyle(this.container);
      const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
      return {
        buy: get("--series-buy", "#2a78d6"),
        rent: get("--series-rent", "#eb6834"),
        surface: get("--surface-1", "#fcfcfb"),
        textPrimary: get("--text-primary", "#0b0b0b"),
        textSecondary: get("--text-secondary", "#52514e"),
        muted: get("--text-muted", "#898781"),
        gridline: get("--gridline", "#e1e0d9"),
        baseline: get("--baseline", "#c3c2b7"),
      };
    }

    _layout() {
      const rect = this.container.getBoundingClientRect();
      const width = Math.max(240, rect.width);
      const height = Math.max(200, rect.height);
      const dpr = window.devicePixelRatio || 1;

      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      return {
        width,
        height,
        plotWidth: width - MARGIN.left - MARGIN.right,
        plotHeight: height - MARGIN.top - MARGIN.bottom,
      };
    }

    _draw(progress) {
      if (!this.years.length) return;
      const theme = this._theme();
      const { width, height, plotWidth, plotHeight } = this._layout();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, width, height);

      const allValues = this.years.flatMap((y) => [y.buyerNetWorth, y.renterNetWorth]);
      const rawMin = Math.min(0, ...allValues);
      const rawMax = Math.max(...allValues);
      const ticks = niceTicks(rawMin, rawMax);
      const yMin = ticks[0];
      const yMax = ticks[ticks.length - 1];

      const xForYear = (year) => MARGIN.left + (plotWidth * (year - this.years[0].year)) / Math.max(1, this.years[this.years.length - 1].year - this.years[0].year);
      const yForValue = (value) => MARGIN.top + plotHeight - (plotHeight * (value - yMin)) / (yMax - yMin || 1);

      this._drawGridlines(ctx, theme, ticks, yForValue, width);
      this._drawZeroBaseline(ctx, theme, yMin, yMax, yForValue, width);
      this._drawXAxis(ctx, theme, xForYear, MARGIN.top + plotHeight);

      const interpolated = this.years.map((y, i) => {
        if (!this.prevYears || !this.prevYears[i]) return y;
        const prev = this.prevYears[i];
        return {
          ...y,
          buyerNetWorth: prev.buyerNetWorth + (y.buyerNetWorth - prev.buyerNetWorth) * progress,
          renterNetWorth: prev.renterNetWorth + (y.renterNetWorth - prev.renterNetWorth) * progress,
        };
      });

      // End-of-line value labels collide when the two series finish close
      // together (e.g. near the break-even point). Per the dataviz skill's
      // guidance, nudging them apart vertically detaches them from their
      // lines and reads as noise -- with only two series, the simplest
      // correct fix is to drop both inline labels for that render and let
      // the legend + hover tooltip + breakdown table carry the value
      // instead (all three remain available regardless).
      const last = interpolated[interpolated.length - 1];
      const endLabelsCollide = Math.abs(yForValue(last.buyerNetWorth) - yForValue(last.renterNetWorth)) < 16;

      this._drawSeries(ctx, interpolated, "buyerNetWorth", theme.buy, xForYear, yForValue, theme, !endLabelsCollide);
      this._drawSeries(ctx, interpolated, "renterNetWorth", theme.rent, xForYear, yForValue, theme, !endLabelsCollide);

      if (this.summary && this.summary.breakEvenYear) {
        this._drawBreakEvenMarker(ctx, theme, this.summary.breakEvenYear, xForYear, MARGIN.top, plotHeight);
      }

      this._lastLayout = { xForYear, yForValue, plotWidth, plotHeight, theme };
      this._drawLegendAndAxisLabels(ctx, theme, ticks, yForValue, width);
    }

    _drawGridlines(ctx, theme, ticks, yForValue, width) {
      ctx.save();
      ctx.strokeStyle = theme.gridline;
      ctx.lineWidth = 1;
      ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = theme.muted;
      ctx.textBaseline = "middle";
      for (const tick of ticks) {
        const y = Math.round(yForValue(tick)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(MARGIN.left, y);
        ctx.lineTo(width - MARGIN.right, y);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(formatCurrency(tick, { compact: true }), MARGIN.left - 10, y);
      }
      ctx.restore();
    }

    _drawZeroBaseline(ctx, theme, yMin, yMax, yForValue, width) {
      if (yMin >= 0 || yMax <= 0) return;
      ctx.save();
      ctx.strokeStyle = theme.baseline;
      ctx.lineWidth = 1;
      const y = Math.round(yForValue(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(width - MARGIN.right, y);
      ctx.stroke();
      ctx.restore();
    }

    _drawXAxis(ctx, theme, xForYear, axisY) {
      const minYear = this.years[0].year;
      const maxYear = this.years[this.years.length - 1].year;
      const ticks = pickYearTicks(minYear, maxYear);

      ctx.save();
      ctx.strokeStyle = theme.baseline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, Math.round(axisY) + 0.5);
      ctx.lineTo(ctx.canvas.width / (window.devicePixelRatio || 1) - MARGIN.right, Math.round(axisY) + 0.5);
      ctx.stroke();

      ctx.font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = theme.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const year of ticks) {
        const x = Math.round(xForYear(year)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, axisY);
        ctx.lineTo(x, axisY + 5);
        ctx.stroke();
        ctx.fillText(`Yr ${year}`, x, axisY + 9);
      }
      ctx.restore();
    }

    _drawSeries(ctx, years, key, color, xForYear, yForValue, theme, showEndLabel) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      years.forEach((y, i) => {
        const x = xForYear(y.year);
        const py = yForValue(y[key]);
        if (i === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      });
      ctx.stroke();

      // End marker: >=8px filled dot with a surface-color ring so it stays
      // legible where the two lines cross near the end.
      const last = years[years.length - 1];
      const x = xForYear(last.year);
      const y = yForValue(last[key]);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Direct end-label (value at the line's end) -- selective, not on
      // every point, and skipped entirely when it would collide with the
      // other series' end-label (see the caller in _draw()).
      if (showEndLabel) {
        ctx.font = "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillStyle = theme.textPrimary;
        ctx.textAlign = "left";
        ctx.textBaseline = y < MARGIN.top + 14 ? "top" : "bottom";
        ctx.fillText(formatCurrency(last[key], { compact: true }), Math.min(x + 8, ctx.canvas.width / (window.devicePixelRatio || 1) - 60), y);
      }
      ctx.restore();
    }

    _drawBreakEvenMarker(ctx, theme, breakEvenYear, xForYear, top, plotHeight) {
      const x = Math.round(xForYear(breakEvenYear)) + 0.5;
      ctx.save();
      ctx.strokeStyle = theme.muted;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = theme.textSecondary;
      ctx.textAlign = "center";
      ctx.fillText(`Break-even: yr ${breakEvenYear}`, x, top - 8);
      ctx.restore();
    }

    _drawLegendAndAxisLabels(ctx, theme) {
      // Legend lives in HTML (see index.html), kept in sync from ui.js --
      // canvas only needs to know the colors it already read from CSS, so
      // there's nothing further to draw here.
    }

    _onPointerMove(event) {
      if (!this._lastLayout || !this.years.length) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const { xForYear, plotWidth } = this._lastLayout;

      const relative = (px - MARGIN.left) / (plotWidth || 1);
      const span = this.years[this.years.length - 1].year - this.years[0].year;
      const approxYear = this.years[0].year + relative * span;
      let nearest = this.years[0];
      for (const y of this.years) {
        if (Math.abs(y.year - approxYear) < Math.abs(nearest.year - approxYear)) nearest = y;
      }

      const x = xForYear(nearest.year);
      this.crosshairLine.hidden = false;
      this.crosshairLine.style.left = x + "px";
      this.crosshairLine.style.top = MARGIN.top + "px";
      this.crosshairLine.style.height = this._lastLayout.plotHeight + "px";

      this.tooltip.hidden = false;
      this.tooltip.innerHTML = "";
      const title = document.createElement("div");
      title.className = "chart-tooltip-title";
      title.textContent = `Year ${nearest.year}`;
      this.tooltip.appendChild(title);
      this.tooltip.appendChild(this._tooltipRow("Buy", nearest.buyerNetWorth, this._lastLayout.theme.buy));
      this.tooltip.appendChild(this._tooltipRow("Rent", nearest.renterNetWorth, this._lastLayout.theme.rent));

      const containerRect = this.container.getBoundingClientRect();
      const tooltipWidth = this.tooltip.offsetWidth;
      let left = x + 14;
      if (left + tooltipWidth > containerRect.width) left = x - tooltipWidth - 14;
      this.tooltip.style.left = left + "px";
      this.tooltip.style.top = MARGIN.top + 8 + "px";
    }

    _tooltipRow(label, value, color) {
      const row = document.createElement("div");
      row.className = "chart-tooltip-row";
      const key = document.createElement("span");
      key.className = "chart-tooltip-key";
      key.style.backgroundColor = color;
      const valueEl = document.createElement("span");
      valueEl.className = "chart-tooltip-value";
      valueEl.textContent = formatCurrency(value);
      const labelEl = document.createElement("span");
      labelEl.className = "chart-tooltip-label";
      labelEl.textContent = label;
      row.append(key, valueEl, labelEl);
      return row;
    }

    _onPointerLeave() {
      this.crosshairLine.hidden = true;
      this.tooltip.hidden = true;
    }
  }

  window.RentVsBuy = Object.assign(window.RentVsBuy || {}, { NetWorthChart, formatCurrency });
})();
