// Charts for the sea state analysis panel (d3 v4 + canvas). No Vue dependencies.

export const COLORS = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#8a8984',
  grid: '#e6e5e0',
  // Categorical slots, fixed order (blue, orange, aqua, yellow)
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
};

const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);


// ---------------------------------------------------------------------------------------------
// Line / area / points / bars chart with crosshair tooltip
// ---------------------------------------------------------------------------------------------
// opt = {
//   height, x: {label, type: 'linear'|'log', domain, ticks, tickFormat}, y: {label, type: 'linear'|'log', domain, ticks, tickFormat},
//   series: [{name, color, x, y, type: 'line'|'area'|'points', unit, digits}],
//   bars: {x0, x1, y, color, name},
//   markers: [{x, label}], hlines: [{y, label}],
//   yAxisTitle, onYAxisClick, tooltipX: (x) => string, legend
// }
export function lineChart(el, opt) {
  if (!el) return; // The panel was closed before a pending redraw
  el.replaceChildren();
  el.classList.add('oa-chart');
  const width = Math.max(280, el.clientWidth || 600);
  const height = opt.height || 220;
  const m = { top: 14, right: 18, bottom: 42, left: 60 };
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
  const series = opt.series || [];

  // Legend (HTML, above the plot) when there is more than one series
  if (series.length > 1 && opt.legend !== false) {
    const legend = document.createElement('div');
    legend.className = 'oa-legend';
    series.forEach(s => {
      const item = document.createElement('span');
      item.innerHTML = `<i style="background:${s.color}"></i>${s.name}`;
      legend.appendChild(item);
    });
    el.appendChild(legend);
  }

  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height)
    .attr('role', 'img').attr('aria-label', opt.ariaLabel || opt.y.label || '');
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  const x = (opt.x.type == 'log' ? d3.scaleLog() : d3.scaleLinear()).domain(opt.x.domain).range([0, iw]);
  const yLog = opt.y.type == 'log';
  const yValid = v => isFinite(v) && (!yLog || v > 0);
  let yDomain = opt.y.domain;
  if (!yDomain) {
    let lo = yLog ? Infinity : 0, hi = yLog ? -Infinity : 0;
    const visit = (xs, ys) => {
      for (let i = 0; i < ys.length; i++) {
        if (!yValid(ys[i]) || xs[i] < x.domain()[0] || xs[i] > x.domain()[1]) continue;
        lo = Math.min(lo, ys[i]); hi = Math.max(hi, ys[i]);
      }
    };
    series.forEach(s => visit(s.x, s.y));
    if (opt.bars) visit(opt.bars.x0, opt.bars.y);
    if (yLog) {
      if (!isFinite(lo)) { lo = 1e-3; hi = 1; }
      yDomain = [lo / 2, (hi > lo ? hi : lo * 10) * 2];
    } else {
      if (hi == lo) hi = lo + 1;
      const pad = (hi - lo) * 0.06;
      yDomain = [lo < 0 ? lo - pad : 0, hi + pad];
    }
  }
  const y = (yLog ? d3.scaleLog() : d3.scaleLinear()).domain(yDomain).range([ih, 0]);
  if (!opt.y.domain) y.nice(yLog ? undefined : 5);

  // Grid (recessive)
  const gridAxis = d3.axisLeft(y).ticks(opt.y.ticks || 5).tickSize(-iw).tickFormat('');
  if (opt.y.tickValues) gridAxis.tickValues(opt.y.tickValues);
  g.append('g').attr('class', 'oa-grid').call(gridAxis);

  // Clip
  const clipId = 'oa-clip-' + Math.random().toString(36).slice(2);
  svg.append('clipPath').attr('id', clipId).append('rect').attr('width', iw).attr('height', ih);
  const plot = g.append('g').attr('clip-path', `url(#${clipId})`);

  // Bars (rounded data end, anchored to the baseline, 2px gap)
  if (opt.bars) {
    const b = opt.bars;
    for (let i = 0; i < b.y.length; i++) {
      if (!(b.y[i] > 0)) continue;
      const x0 = x(b.x0[i]) + 1, x1 = x(b.x1[i]) - 1;
      const w = Math.max(1, x1 - x0), y0 = y(0), y1 = y(b.y[i]);
      const r = Math.min(4, w / 2, (y0 - y1));
      plot.append('path').attr('fill', b.color)
        .attr('d', `M${x0},${y0} V${y1 + r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + w - r} Q${x0 + w},${y1} ${x0 + w},${y1 + r} V${y0} Z`);
    }
  }

  // Series
  series.forEach(s => {
    const idx = d3.range(s.y.length).filter(i => s.x[i] > 0 || opt.x.type != 'log');
    if (s.type == 'points') {
      plot.selectAll(null).data(idx.filter(i => yValid(s.y[i]))).enter().append('circle')
        .attr('cx', i => x(s.x[i])).attr('cy', i => y(s.y[i])).attr('r', s.radius || 3)
        .attr('fill', s.color).attr('stroke', COLORS.surface).attr('stroke-width', 1);
      return;
    }
    const line = d3.line().defined(i => yValid(s.y[i])).x(i => x(s.x[i])).y(i => y(s.y[i]));
    if (s.type == 'area') {
      const area = d3.area().defined(i => isFinite(s.y[i])).x(i => x(s.x[i])).y0(y(0)).y1(i => y(s.y[i]));
      plot.append('path').datum(idx).attr('d', area).attr('fill', s.color).attr('fill-opacity', 0.14);
    }
    plot.append('path').datum(idx).attr('d', line).attr('fill', 'none')
      .attr('stroke', s.color).attr('stroke-width', s.width || 2).attr('stroke-linejoin', 'round')
      .attr('stroke-dasharray', s.dashed ? '4 3' : null);
  });

  // Reference lines
  (opt.hlines || []).forEach(h => {
    g.append('line').attr('class', 'oa-ref').attr('x1', 0).attr('x2', iw).attr('y1', y(h.y)).attr('y2', y(h.y));
    if (h.label) g.append('text').attr('class', 'oa-ref-label').attr('x', iw - 4).attr('y', y(h.y) - 4).attr('text-anchor', 'end').text(h.label);
  });
  (opt.markers || []).forEach((mk, i) => {
    if (!(mk.x >= x.domain()[0] && mk.x <= x.domain()[1])) return;
    g.append('line').attr('class', 'oa-ref').attr('x1', x(mk.x)).attr('x2', x(mk.x)).attr('y1', 0).attr('y2', ih);
    if (mk.label) g.append('text').attr('class', 'oa-ref-label').attr('x', x(mk.x) + 4).attr('y', 10 + 12 * (i % 2)).text(mk.label);
  });

  // Direct labels at the right end of each line (<= 4 series), nudged apart
  if (series.length > 1 && series.length <= 4 && opt.directLabels !== false) {
    const labels = [];
    series.forEach(s => {
      for (let i = s.y.length - 1; i >= 0; i--) {
        if (isFinite(s.y[i]) && s.x[i] <= x.domain()[1] && s.x[i] >= x.domain()[0]) { labels.push({ s, px: x(s.x[i]), py: y(s.y[i]) }); break; }
      }
    });
    labels.sort((a, b) => a.py - b.py);
    for (let i = 1; i < labels.length; i++) labels[i].py = Math.max(labels[i].py, labels[i - 1].py + 12);
    labels.forEach(l => g.append('text').attr('class', 'oa-direct-label')
      .attr('x', Math.min(iw - 2, l.px + 4)).attr('y', l.py + 4).attr('text-anchor', l.px + 4 > iw - 24 ? 'end' : 'start').text(l.s.name));
  }

  // Axes
  const xAxis = d3.axisBottom(x).ticks(opt.x.ticks || 6, opt.x.type == 'log' ? ',.0f' : undefined);
  if (opt.x.tickValues) xAxis.tickValues(opt.x.tickValues);
  if (opt.x.tickFormat) xAxis.tickFormat(opt.x.tickFormat);
  g.append('g').attr('class', 'oa-axis').attr('transform', `translate(0,${ih})`).call(xAxis);
  const yAxis = d3.axisLeft(y).ticks(opt.y.ticks || 5, yLog ? '.0e' : undefined);
  if (opt.y.tickValues) yAxis.tickValues(opt.y.tickValues);
  if (opt.y.tickFormat) yAxis.tickFormat(opt.y.tickFormat);
  g.append('g').attr('class', 'oa-axis').call(yAxis);
  g.append('text').attr('class', 'oa-axis-label').attr('x', iw / 2).attr('y', ih + 34).attr('text-anchor', 'middle').text(opt.x.label);
  const yLabel = g.append('text').attr('class', 'oa-axis-label').attr('transform', `translate(${-46},${ih / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle').text(opt.y.label);

  // Clickable y-axis
  if (opt.onYAxisClick) {
    yLabel.classed('oa-axis-label-clickable', true);
    g.append('rect').attr('x', -m.left).attr('y', 0).attr('width', m.left).attr('height', ih)
      .attr('fill', 'transparent').style('cursor', 'pointer')
      .on('click', () => opt.onYAxisClick())
      .append('title').text(opt.yAxisTitle || 'Click to change units');
  }

  // Hover: crosshair + tooltip on the nearest sample of the first series
  const tooltip = document.createElement('div');
  tooltip.className = 'oa-tooltip';
  el.appendChild(tooltip);
  const cross = g.append('line').attr('class', 'oa-crosshair').attr('y1', 0).attr('y2', ih).style('display', 'none');
  const dots = series.map(s => g.append('circle').attr('r', 4).attr('fill', s.color)
    .attr('stroke', COLORS.surface).attr('stroke-width', 2).style('display', 'none'));
  const hoverSeries = series.length ? series : (opt.bars ? [{ x: opt.bars.x0.map((v, i) => (v + opt.bars.x1[i]) / 2), y: opt.bars.y, name: opt.bars.name, unit: opt.bars.unit, digits: 0 }] : []);
  const overlay = g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent');
  const nearest = (s, xv) => {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < s.x.length; i++) {
      if (!isFinite(s.y[i])) continue;
      const d = Math.abs(x(s.x[i]) - x(xv));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };
  overlay.node().addEventListener('mousemove', ev => {
    if (!hoverSeries.length) return;
    const rect = overlay.node().getBoundingClientRect();
    const xv = x.invert(ev.clientX - rect.left);
    const i0 = nearest(hoverSeries[0], xv);
    if (i0 < 0) return;
    const xs = hoverSeries[0].x[i0];
    cross.attr('x1', x(xs)).attr('x2', x(xs)).style('display', null);
    let html = `<div class="oa-tooltip-title">${opt.tooltipX ? opt.tooltipX(xs) : fmt(xs)}</div>`;
    hoverSeries.forEach((s, k) => {
      const i = s === hoverSeries[0] ? i0 : nearest(s, xs);
      if (i < 0) return;
      if (dots[k]) dots[k].attr('cx', x(s.x[i])).attr('cy', y(s.y[i])).style('display', null);
      html += `<div>${s.color ? `<i style="background:${s.color}"></i>` : ''}${s.name}: <b>${fmt(s.y[i], s.digits ?? 3)}</b> ${s.unit || ''}</div>`;
    });
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    const left = m.left + x(xs);
    tooltip.style.left = (left > width * 0.6 ? left - tooltip.offsetWidth - 12 : left + 12) + 'px';
    tooltip.style.top = (m.top + 4 + (el.querySelector('.oa-legend')?.offsetHeight || 0)) + 'px';
  });
  overlay.node().addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    cross.style('display', 'none');
    dots.forEach(d => d.style('display', 'none'));
  });
}


// ---------------------------------------------------------------------------------------------
// Polar (directional) spectrum, CDIP style
// ---------------------------------------------------------------------------------------------
// Radius is linear in frequency: long periods at the centre, short periods at the rim.
// Angles are where the waves come FROM, clockwise from north. Colour: MEM energy density.
export function polarChart(el, polar, opt = {}) {
  if (!el) return; // The panel was closed before a pending redraw
  el.replaceChildren();
  el.classList.add('oa-chart', 'oa-polar');
  const size = Math.min(480, Math.max(280, el.clientWidth || 420));
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Polar directional wave spectrum');
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2, R = size / 2 - 34;
  // Period range: longest period (fmin) on the inner circle, shortest (fmax) on the rim, linear in frequency.
  // The inner circle has a fixed size (as the CDIP polar plots) and shows the range.
  const fmax = opt.fmax, fmin = opt.fmin || 1 / 33;
  const hole = 0.22; // Inner circle radius, fraction of R
  const rOf = f => R * (hole + (1 - hole) * (Math.min(Math.max(f, fmin), fmax) - fmin) / (fmax - fmin));
  const fOf = r => fmin + (r / R - hole) / (1 - hole) * (fmax - fmin);
  const canvasAngle = deg => (deg - 90) * Math.PI / 180;
  const df = polar.df;
  const inView = f => f >= fmin && f <= fmax;

  // Colours are scaled to the strongest cell of the visible period range
  let viewMax = 0;
  polar.energy.forEach((row, k) => { if (row && inView(polar.freq[k])) viewMax = Math.max(viewMax, ...row); });
  const threshold = 0.01 * viewMax; // Cells under 1% of the maximum are not painted

  // Energy cells
  for (let k = 0; k < polar.freq.length && viewMax > 0; k++) {
    const row = polar.energy[k];
    const f = polar.freq[k];
    if (!row || !inView(f)) continue;
    const r0 = rOf(f - df / 2), r1 = rOf(f + df / 2); // rOf clips to the range
    for (let d = 0; d < row.length; d++) {
      if (row[d] < threshold) continue;
      const a0 = canvasAngle(polar.dirs[d] - polar.binWidth / 2), a1 = canvasAngle(polar.dirs[d] + polar.binWidth / 2);
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = turbo(row[d] / viewMax);
      ctx.fill();
    }
  }

  // Rings and spokes
  ctx.strokeStyle = 'rgba(82, 81, 78, 0.25)';
  ctx.lineWidth = 1;
  for (let a = 0; a < 360; a += 45) {
    ctx.beginPath();
    ctx.moveTo(cx + rOf(fmin) * Math.cos(canvasAngle(a)), cy + rOf(fmin) * Math.sin(canvasAngle(a)));
    ctx.lineTo(cx + R * Math.cos(canvasAngle(a)), cy + R * Math.sin(canvasAngle(a)));
    ctx.stroke();
  }
  ctx.font = '12px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rings = (opt.periods || [2, 3, 4, 6, 8, 12, 20]).filter(T => 1 / T <= fmax * 1.001 && 1 / T >= fmin * 0.999);
  rings.forEach(T => {
    ctx.beginPath(); ctx.arc(cx, cy, rOf(1 / T), 0, 2 * Math.PI); ctx.stroke();
  });
  ctx.strokeStyle = 'rgba(82, 81, 78, 0.6)';
  ctx.beginPath(); ctx.arc(cx, cy, rOf(fmin), 0, 2 * Math.PI); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  // Ring labels along north, with a halo so they stay legible over the colours
  rings.forEach(T => {
    const ty = cy - rOf(1 / T) + 9;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(252, 252, 251, 0.85)';
    ctx.strokeText(T + ' s', cx, ty);
    ctx.fillStyle = COLORS.ink2;
    ctx.fillText(T + ' s', cx, ty);
  });
  // Period range in the inner circle
  if (opt.centerLabel) {
    ctx.fillStyle = COLORS.ink2;
    ctx.font = '11px Poppins, sans-serif';
    ctx.fillText('Period range', cx, cy - 8);
    ctx.font = '600 13px Poppins, sans-serif';
    ctx.fillText(opt.centerLabel, cx, cy + 9);
  }
  // Compass
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].forEach((label, i) => {
    const a = canvasAngle(i * 45);
    ctx.fillStyle = label == 'N' ? COLORS.ink : COLORS.ink2;
    ctx.font = (label == 'N' ? '600 ' : '') + '13px Poppins, sans-serif';
    ctx.fillText(label, cx + (R + 18) * Math.cos(a), cy + (R + 18) * Math.sin(a));
  });

  // Colour bar
  const bar = document.createElement('div');
  bar.className = 'oa-colorbar';
  const stops = d3.range(0, 1.0001, 0.1).map(t => `${turbo(t)} ${t * 100}%`).join(',');
  bar.innerHTML = `<div class="oa-colorbar-ramp" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="oa-colorbar-labels"><span>0</span><span>${viewMax > 0 ? viewMax.toPrecision(3) : '0'}</span></div>
    <div class="oa-colorbar-unit">m²/Hz/deg</div>`;
  el.appendChild(bar);

  // Zoom: the inner half of the circle zooms in (longer periods), the outer half zooms out.
  // opt.onZoom(+1 | -1); opt.canZoomIn / opt.canZoomOut say whether there is a level to go to.
  const zoomAt = r => {
    if (!opt.onZoom || r > R) return 0;
    if (r < R / 2) return opt.canZoomIn ? 1 : 0;
    return opt.canZoomOut ? -1 : 0;
  };
  const pointerRadius = ev => {
    const rect = canvas.getBoundingClientRect();
    return Math.hypot(ev.clientX - rect.left - cx, ev.clientY - rect.top - cy);
  };
  canvas.addEventListener('click', ev => {
    const zoom = zoomAt(pointerRadius(ev));
    if (zoom) opt.onZoom(zoom);
  });

  // Hover
  const tooltip = document.createElement('div');
  tooltip.className = 'oa-tooltip';
  el.appendChild(tooltip);
  canvas.addEventListener('mousemove', ev => {
    const rect = canvas.getBoundingClientRect();
    const dx = ev.clientX - rect.left - cx, dy = ev.clientY - rect.top - cy;
    const r = Math.hypot(dx, dy);
    const zoom = zoomAt(r);
    canvas.style.cursor = zoom > 0 ? 'zoom-in' : zoom < 0 ? 'zoom-out' : '';
    const f = fOf(r);
    if (r > R || r < hole * R) { tooltip.style.display = 'none'; return; }
    const theta = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
    const k = Math.round((f - polar.freq[0]) / df);
    if (k < 0 || k >= polar.freq.length) { tooltip.style.display = 'none'; return; }
    const d = Math.round(theta / polar.binWidth) % polar.dirs.length;
    const row = polar.energy[k];
    tooltip.innerHTML = `<div class="oa-tooltip-title">${fmt(1 / polar.freq[k], 1)} s (${fmt(polar.freq[k], 3)} Hz)</div>
      <div>From ${polar.dirs[d].toFixed(0)}° ${compass(polar.dirs[d])}</div>
      <div>E: <b>${row ? row[d].toExponential(2) : '0'}</b> m²/Hz/deg</div>`;
    tooltip.style.display = 'block';
    tooltip.style.left = (ev.clientX - rect.left + 14) + 'px';
    tooltip.style.top = (ev.clientY - rect.top + 14) + 'px';
  });
  canvas.addEventListener('mouseleave', () => tooltip.style.display = 'none');
}


// Turbo colormap, polynomial approximation (Mikhailov 2019)
export function turbo(t) {
  t = Math.max(0, Math.min(1, t));
  const r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  const c = v => Math.round(255 * Math.max(0, Math.min(1, v)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export function compass(deg) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
