/* global CapacityModel */
(function () {
  "use strict";
  const M = CapacityModel;
  const KEY = "gpu-atlas-workspace-v1";
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const fmt = (n, decimals = 0) => n === null || n === undefined ? "Not available" :
    Number(n).toLocaleString("en-US", {maximumFractionDigits: decimals});
  const compact = n => new Intl.NumberFormat("en-US", {notation: "compact", maximumFractionDigits: 1}).format(n);
  const pct = n => n === null ? "Not available" : `${n >= 0 ? "+" : ""}${fmt(n, 1)}%`;
  let state;
  let storageBlocked = false;
  let initialError = "";
  let forecastSaveMessage = "Not saved yet. Start or save this forecast to keep it.";
  let forecastSaveError = false;
  try {
    const saved = localStorage.getItem(KEY);
    const parsed = saved ? JSON.parse(saved) : null;
    state = parsed ? M.validate(parsed) : M.demo();
    if (parsed) forecastSaveMessage = "Saved in this browser. Edits auto-save when you finish editing.";
    if (parsed && parsed.version < 3) initialError = "Workspace upgraded for GPU SKUs. Old family-level inventory is kept as 'variant not specified'; no variant has been guessed. Your services and plans are unchanged. Load the NVIDIA workload demo from Data & assumptions to replace the example data.";
  } catch (error) {
    state = M.demo();
    storageBlocked = true;
    forecastSaveMessage = "Not saved. Stored workspace could not be loaded.";
    forecastSaveError = true;
    initialError = `Saved workspace could not be loaded: ${error.message} Showing a demo preview only. Export/repair the saved data outside this portal, import a valid workspace, or explicitly reset the demo. No data has been overwritten.`;
  }
  let view = "planning";
  const planningSectionState = new Map();
  let serviceFilter = "all";
  let teamFilter = "all";
  let poolFilter = "all";
  let weekly = false;
  let planningMonth = state.startMonth;
  let planningQuickService = state.services[0].id;
  const latest = () => state.records.length ? [...state.records].sort((a, b) => a.date.localeCompare(b.date)).at(-1).date : "";
  let endDate = latest();
  let startDate = endDate ? new Date(Date.parse(endDate) - 27 * 86400000).toISOString().slice(0, 10) : "";
  let editContext = null;
  const titles = {
    planning: ["Bottom-up scenario planner", "Change service growth, add training, and drill into organizations and models.", "Export scenario"],
    overview: ["Organization consumption", "Understand service footprints, demand growth, and the baseline behind your capacity plan.", "+ Add consumption"],
    inference: ["Service plans", "Set up serving performance, user-based plans, and manual growth assumptions.", "+ Register service"],
    benchmarks: ["Performance profile library", "Reuse evidence-backed serving profiles, with explicit configuration and token-range safeguards.", "+ Add profile"],
    forecasts: ["Daily backtests", "Check simple next-day traffic predictions against recorded results.", "Export daily evidence"],
    training: ["Six-month training roadmap", "Turn model plans into compute estimates, gang sizes, and time-phased requirements.", "+ Add training plan"],
    capacity: ["Capacity forecast", "Learn from service history. Adjust the plan. See when you need more GPUs.", "Export forecast"],
    data: ["Data & assumptions", "Inspect provenance, maintain supply, and take your planning workspace with you.", "Export workspace"],
  };
  function notice(message, error = false) {
    const el = $("#notice");
    el.textContent = message;
    el.className = error ? "error" : "";
    el.hidden = false;
  }
  function save(next, message, override = false, redraw = true) {
    try {
      if (storageBlocked && !override) throw new Error("Saving is blocked because stored data could not be loaded. Import a valid workspace or explicitly reset.");
      next = M.validate(next);
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next;
      storageBlocked = false;
      $("#save-state").textContent = "Saved in this browser";
      forecastSaveStatus("Saved in this browser. Edits auto-save when you finish editing.");
      if (redraw) render();
      notice(message);
      return true;
    } catch (error) {
      $("#save-state").textContent = "Changes not saved";
      forecastSaveStatus("Not saved. Resolve the error and try saving again.", true);
      notice(`Not saved: ${error.message}`, true);
      return false;
    }
  }
  function forecastSaveStatus(message, error = false) {
    forecastSaveMessage = message;
    forecastSaveError = error;
    $("#forecast-save-status").textContent = message;
    $("#forecast-save-status").classList.toggle("error", error);
  }
  const clone = () => JSON.parse(JSON.stringify(state));
  const chosenServices = () => state.services.filter(s =>
    (serviceFilter === "all" || s.id === serviceFilter) && (teamFilter === "all" || s.team === teamFilter) &&
    (poolFilter === "all" || s.pool === poolFilter));
  const selectedRecords = () => {
    const ids = new Set(chosenServices().map(s => s.id));
    return state.records.filter(r => ids.has(r.serviceId));
  };
  const skuName = id => M.skuInfo(id).name;
  const poolOptions = selected => M.POOLS.filter(p => !M.skuInfo(p).legacy || p === selected || M.activePools(state).includes(p))
    .map(p => `<option value="${p}" ${p === selected ? "selected" : ""}>${esc(skuName(p))}</option>`).join("");
  const serviceOptions = selected => state.services.map(s => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const metric = (label, value, detail, accent = false) => `<div class="kpi"><div class="label">${label}</div><div class="value ${accent ? "accent" : ""}">${value}</div><div class="detail">${detail}</div></div>`;
  const table = (heads, rows) => `<div class="table-scroll"><table><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}">No matching records. Adjust filters or add your data.</td></tr>`}</tbody></table></div>`;
  function chart(points, series, label, forecastStart = null) {
    if (!points.length) return `<div class="empty">No records in this time window. Add consumption or adjust the dates.</div>`;
    const w = 760, h = forecastStart === null ? 235 : 310, left = 58, right = 18, top = forecastStart === null ? 15 : 30, bottom = 35;
    const maximum = Math.max(1, ...points.flatMap(p => series.map(s => p[s.key]).filter(Number.isFinite))) * 1.12;
    const x = i => left + i * (w - left - right) / Math.max(1, points.length - 1);
    const y = n => h - bottom - n / maximum * (h - top - bottom);
    const ticks = Array.from({length: 5}, (_, i) => {
      const n = maximum * i / 4;
      return `<line class="grid-line" x1="${left}" y1="${y(n)}" x2="${w - right}" y2="${y(n)}"/><text x="${left - 10}" y="${y(n) + 3}" text-anchor="end">${compact(n)}</text>`;
    }).join("");
    const lines = series.map(s => {
      const segment = (start, end, forecast) => {
        if (!points.slice(start, end).some(p => Number.isFinite(p[s.key]))) return "";
        let connected = false;
        const anchor = forecast && start > 0 && Number.isFinite(points[start - 1][s.key]) &&
          Number.isFinite(points[start][s.key]) ? start - 1 : start;
        const path = points.slice(anchor, end).map((p, offset) => {
          if (!Number.isFinite(p[s.key])) {connected = false; return "";}
          const command = `${connected ? "L" : "M"}${x(anchor + offset)},${y(p[s.key])}`;
          connected = true;
          return command;
        }).join(" ");
        return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" ${forecast ? 'stroke-dasharray="1 6" stroke-linecap="round"' : s.dashed ? 'stroke-dasharray="6 5"' : ""}/>`;
      };
      return segment(0, forecastStart ?? points.length, false) +
        (forecastStart === null ? "" : segment(forecastStart, points.length, true)) +
        points.map((p, i) => Number.isFinite(p[s.key]) ? `<circle cx="${x(i)}" cy="${y(p[s.key])}" r="${points.length < 10 ? 3 : 1.5}" fill="${s.color}"><title>${esc(p.date || p.month)} · ${esc(forecastStart !== null && i < forecastStart ? (s.historyName ?? s.name) : s.name)}: ${fmt(p[s.key], 1)}</title></circle>` : "").join("");
    }).join("");
    const labelIndices = forecastStart === null ? [...new Set([0, Math.floor(points.length / 2), points.length - 1])] : [];
    if (forecastStart !== null) {
      const step = Math.max(1, Math.ceil(points.length / 10));
      for (let i = 0; i < points.length; i += step) labelIndices.push(i);
      if (labelIndices.at(-1) !== points.length - 1) {
        if (points.length - 1 - labelIndices.at(-1) < step) labelIndices.pop();
        labelIndices.push(points.length - 1);
      }
    }
    const labels = labelIndices.map(i =>
      `<text x="${x(i)}" y="${h - 9}" text-anchor="middle">${esc(points[i].date || points[i].month)}</text>`).join("");
    const boundary = forecastStart === null ? "" : (() => {
      const edge = forecastStart ? (x(forecastStart - 1) + x(forecastStart)) / 2 : left;
      return `<rect x="${edge}" y="${top}" width="${w - right - edge}" height="${h - top - bottom}" fill="var(--blue)" opacity=".045"/><line x1="${edge}" x2="${edge}" y1="${top}" y2="${h - bottom}" stroke-dasharray="4 5"/><text x="${edge + 8}" y="16">FORECAST</text>`;
    })();
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${boundary}${ticks}${lines}${labels}</svg>`;
  }
  function overview() {
    const all = selectedRecords();
    const rows = all.filter(r => (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate));
    const points = M.trend(rows, weekly);
    const days = new Set(rows.map(r => r.date)).size;
    const gpuHours = rows.reduce((n, r) => n + r.gpuHours, 0);
    const activity = gpuHours ? rows.reduce((n, r) => n + r.gpuHours * r.activity, 0) / gpuHours : null;
    const yoy = startDate && endDate ? M.comparePeriods(all, startDate, endDate, 1) : null;
    const twoYear = startDate && endDate ? M.comparePeriods(all, startDate, endDate, 2) : null;
    const serviceRows = chosenServices().map(s => {
      const history = rows.filter(r => r.serviceId === s.id).sort((a, b) => a.date.localeCompare(b.date));
      const hours = history.reduce((n, r) => n + r.gpuHours, 0);
      const change = history.length >= 2 ? M.growth(history.at(-1).gpuHours, history[0].gpuHours) : null;
      return `<tr><td><button class="text-button service-name" data-service="${esc(s.id)}">${esc(s.name)}</button><span class="subtext">${esc(s.team)}</span></td><td><span class="badge">${esc(skuName(s.pool))}</span></td><td>${fmt(hours)}</td><td>${history.length ? fmt(hours / history.length / 24) : "No data"}</td><td>${pct(change)}<span class="subtext">First vs last observed day</span></td><td>${history.length} days</td><td><button class="text-button" data-edit-service="${esc(s.id)}">Edit profile</button></td></tr>`;
    }).join("");
    const maxHours = Math.max(1, ...chosenServices().map(s => rows.filter(r => r.serviceId === s.id).reduce((n, r) => n + r.gpuHours, 0)));
    const bars = chosenServices().map((s, i) => {
      const hours = rows.filter(r => r.serviceId === s.id).reduce((n, r) => n + r.gpuHours, 0);
      return `<div class="bar-row"><div class="bar-heading"><span>${esc(s.name)}</span><span>${compact(hours)} h</span></div><div class="bar-track"><div class="bar-fill" style="width:${hours / maxHours * 100}%;background:${i % 2 ? "var(--blue)" : "var(--green)"}"></div></div></div>`;
    }).join("");
    return `<div class="kpis">${metric("Allocated GPU-hours", fmt(gpuHours), "Physical allocation time · selected dates", true)}${metric("Average allocated GPUs", days ? fmt(gpuHours / days / 24) : "No data", "Aggregate per observed day; inspect coverage")}${metric("Allocation-weighted activity", activity === null ? "No data" : `${fmt(activity, 1)}%`, "Reported daily activity; not measured FLOP/s")}${metric("Year-over-year allocation", pct(yoy), yoy === null ? "Requires complete comparable history" : "Same dates one year earlier")}</div>
      <div class="grid-two"><section class="panel"><div class="panel-heading"><div><h2>Consumption over time</h2><p>Average allocated GPUs per observed day · ${weekly ? "weekly buckets (edges may be partial)" : "daily buckets"}</p></div><div class="segmented"><button data-granularity="daily" class="${!weekly ? "selected" : ""}">Daily</button><button data-granularity="weekly" class="${weekly ? "selected" : ""}">Weekly</button></div></div>
      <div class="panel-body"><div class="data-tools"><label class="help">From <input aria-label="Consumption start date" id="date-from" type="date" value="${esc(startDate)}"></label><label class="help">To <input aria-label="Consumption end date" id="date-to" type="date" value="${esc(endDate)}"></label></div></div>
      <div class="chart-wrap">${chart(points, [{key: "averageAllocated", name: "Average allocated GPUs", color: "var(--accent)"}], "Allocated GPU trend for selected services and dates")}</div>
      <div class="panel-body"><details><summary>View exact trend values</summary>${table(["Period", "Observed days", "GPU-hours", "Average GPUs"], points.map(p => `<tr><td>${p.date}</td><td>${p.observedDays}</td><td>${fmt(p.gpuHours)}</td><td>${fmt(p.averageAllocated, 1)}</td></tr>`).join(""))}</details></div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Service contribution</h2><p>Allocated GPU-hours · selected window</p></div></div><div class="panel-body">${bars || "No matching services."}</div></section></div>
      <section class="panel"><div class="panel-heading"><div><h2>Service consumption ledger</h2><p>Click a service to focus the workspace. Resource counts remain hardware-specific in planning.</p></div><button class="button subtle" data-action="service">+ Service</button></div>${table(["Service / team", "GPU SKU", "GPU-hours", "Avg GPUs", "Period change", "Coverage", ""], serviceRows)}</section>
      <div class="callout info">Two-year cumulative change: <strong>${pct(twoYear)}</strong> · Two-year annualized: <strong>${twoYear === null ? "Not available" : pct(((1 + twoYear / 100) ** 0.5 - 1) * 100)}</strong>. Comparisons require complete matching daily coverage. History is synthetic unless explicitly entered by you. No live telemetry is connected.</div>`;
  }
  function inferenceView() {
    const services = chosenServices();
    const months = M.months(state.startMonth);
    const rows = services.map(s => {
      const base = M.baseline(state, s.id);
      const first = M.inference(state, s, 0), last = M.inference(state, s, 5);
      const performance = M.profileFor(state, s);
      return `<tr><td class="service-name">${esc(s.name)}<span class="subtext">${esc(s.team)}</span></td><td>${esc(skuName(s.pool))}</td><td>${base ? fmt(base.peakRps) : "No baseline"}<span class="subtext">${base ? `${base.days}/28 days · through ${base.end}` : "Driver scenarios can work without history"}</span></td><td>${s.demandMethod === "drivers" ? "User demand drivers" : "Historical peak growth"}<span class="subtext">${pct(s.annualGrowth)} annual ${s.demandMethod === "drivers" ? "user" : "traffic"} growth assumption</span></td><td>${performance.available ? `${performance.gpusPerReplica} GPUs / ${fmt(performance.rpsPerReplica, 2)} RPS` : "Incompatible profile"}<span class="subtext">${esc(performance.available ? performance.name : performance.reason)}</span></td><td>${fmt(first.gpus)}</td><td class="accent">${fmt(last.gpus)}</td><td><button class="text-button" data-edit-service="${esc(s.id)}">Configure</button></td></tr>`;
    }).join("");
    const projection = months.map((m, i) => ({month: m, gpus: services.reduce((n, s) => n + (M.inference(state, s, i).gpus || 0), 0)}));
    const incomplete = services.some(s => !M.inference(state, s, 0).available);
    const decomposition = services.map(s => {
      const e = M.inference(state, s, 5);
      return `<tr><td>${esc(s.name)}</td><td>${s.demandMethod === "drivers" ? "DAU × sessions × requests × calls × cache misses × peak ratio" : "Recorded peak × compounded annual traffic growth"}</td><td>${fmt(e.organicRps, 1)}</td><td>${fmt(e.launchRps, 1)}</td><td>${fmt(e.peakRps, 1)}</td><td>${esc(e.available ? "Scenario inputs available" : e.reason)}</td></tr>`;
    }).join("");
    return `<div class="callout info">The chart here is a manual scenario using entered annual growth or user-based inputs. <strong>Capacity forecast learns its own traffic trend.</strong> Launch and performance inputs here are shared with that forecast; annual growth only drives this manual chart or a user-based service plan. ${incomplete ? "<strong>Some service inputs are missing.</strong>" : ""} <button class="text-button" data-view="capacity">Open capacity forecast</button></div>
      <section class="panel"><div class="panel-heading"><div><h2>Manual serving scenario</h2><p>Compare an entered growth assumption with the history-based forecast. The dotted line shows future requirements.</p></div></div><div class="chart-wrap">${chart(projection, [{key: "gpus", name: "Inference GPUs", color: "var(--blue)"}], "Monthly manual serving GPU scenario", 0)}</div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Service performance & growth profiles</h2><p>Configure demand method, drivers, configuration key, token mix and optional reusable benchmark.</p></div></div>${table(["Service", "GPU SKU", "Baseline peak RPS", "Demand method", "Replica profile", months[0], months[5], ""], rows)}</section>
      <section class="panel"><div class="panel-heading"><div><h2>Month-six demand decomposition</h2><p>Organic demand and named launch increments are separate to prevent double counting.</p></div></div>${table(["Service", "Organic demand logic", "Organic peak RPS", "Launch RPS", "Total peak RPS", "Input status"], decomposition)}</section>
      <section class="panel"><div class="panel-heading"><h2>Calculation contract</h2></div><div class="panel-body description"><strong>Historical mode:</strong> baseline peak × (1 + annual traffic growth)^(months / 12).<br><strong>Driver mode:</strong> daily active users × compounded user growth × sessions/user/day × requests/session × backend calls/request × (1 − cache hit fraction) × peak-to-average ratio / 86,400.<br>Add cumulative launch RPS once, after either organic calculation. The two demand methods are alternatives, not additive.<br><strong>Replicas</strong> = ceil(peak RPS / (1 − spare headroom fraction) / sustainable RPS per replica).<br><strong>GPUs</strong> = replicas × GPUs per replica. Selected library profiles must match the pool, workload key and token range; there is no silent fallback to inline throughput.<br>One-day backtests in Forecast evidence do not validate or replace these six-month scenarios. Queueing, memory/KV-cache fit and statistical uncertainty remain unmodeled.</div></section>`;
  }
  function benchmarksView() {
    const services = chosenServices();
    const relevant = new Set(services.map(s => s.workloadKey));
    const profiles = state.benchmarks.filter(b => (poolFilter === "all" || b.pool === poolFilter) &&
      ((serviceFilter === "all" && teamFilter === "all") || relevant.has(b.workloadKey)));
    return `<div class="callout">Profiles are explicit configurations, not universal hardware speeds. A workload key must encode the model/version, precision, serving engine, batching/concurrency and latency SLO. Token ranges are user-attested validity bounds, not automatically verified measurements.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Reusable RPS-at-SLO profiles</h2><p>Select a profile in a service's Configure form. Inline assumptions remain available for existing services.</p></div></div>${table(["Profile / configuration", "GPU SKU", "Replica throughput", "Input / output range", "Evidence", "Date", ""], profiles.map(b => `<tr><td class="service-name">${esc(b.name)}<span class="subtext">${esc(b.workloadKey)}</span></td><td>${esc(skuName(b.pool))}</td><td>${b.gpusPerReplica} GPUs / ${fmt(b.rpsPerReplica, 2)} RPS</td><td>${fmt(b.minInputTokens)}–${fmt(b.maxInputTokens)} in<br>${fmt(b.minOutputTokens)}–${fmt(b.maxOutputTokens)} out</td><td><span class="badge ${b.source === "synthetic" ? "" : "green"}">${b.source === "synthetic" ? "Synthetic" : "User-supplied benchmark"}</span><span class="subtext">${esc(b.evidence)}</span></td><td>${b.measuredOn}</td><td><button class="text-button" data-edit-benchmark="${esc(b.id)}">Edit</button></td></tr>`).join(""))}</section>
      <div class="callout info">No interpolation, extrapolation or automatic substitution is performed. A mismatched pool/key or out-of-range token mix makes the service requirement unavailable and portfolio totals partial. Editing a shared profile recalculates every linked service. User-supplied evidence is not independently verified.</div>`;
  }
  function forecastsView() {
    const evidence = chosenServices().map(s => ({service: s, result: M.forecastEvidence(state, s.id)}));
    const rows = evidence.map(({service: s, result: e}) => e.available ? e.scored.map(r => `<tr><td>${esc(s.name)}<span class="subtext">${esc(e.source)} · ${e.evaluationDays} folds</span></td><td>${r.method}${r.method === e.selected ? ' <span class="badge green">Selected</span>' : ""}</td><td>${fmt(r.validation.mae, 1)}</td><td>${fmt(r.heldOut.mae, 1)}</td><td>${r.heldOut.wape === null ? "Not available" : `${fmt(r.heldOut.wape * 100, 1)}%`}</td><td>${fmt(r.heldOut.bias, 1)}</td><td>${r.validation.days} / ${r.heldOut.days}</td></tr>`).join("") :
      `<tr><td>${esc(s.name)}</td><td colspan="6">${esc(e.reason)} Eligible evaluation days: ${e.evaluationDays}.</td></tr>`).join("");
    const plots = evidence.filter(({result}) => result.available).map(({service: s, result: e}) =>
      `<section class="panel"><div class="panel-heading"><div><h2>${esc(s.name)}: held-out daily peak</h2><p>${e.selected} selected on earlier validation MAE · next observed-day prediction for ${e.nextDate}: ${fmt(e.nextPeakRps, 1)} RPS${e.nextPeakRps === null ? " (recent history incomplete)" : ""}</p></div></div><div class="panel-body"><div class="legend"><span><i></i>Actual peak RPS</span><span><i class="blue"></i>One-day-ahead prediction</span></div></div><div class="chart-wrap">${chart(e.predictions.slice(-28), [{key: "actual", name: "Actual peak RPS", color: "var(--accent)"}, {key: "predicted", name: "Predicted peak RPS", color: "var(--blue)"}], `${s.name}: held-out actual and predicted daily peak RPS`)}</div></section>`).join("");
    return `<div class="callout">This is a <strong>one-day-ahead daily peak-RPS</strong> evaluation, not validation of a six-month capacity forecast. Only records before planning starts are eligible. No gaps are imputed. Synthetic-history scores demonstrate mechanics, not real-world predictive accuracy.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Chronological model comparison</h2><p>28 complete prior days per prediction; at least seven earlier validation and seven later held-out evaluation days. Lower MAE is better.</p></div></div>${table(["Service", "Method", "Validation MAE (RPS)", "Held-out MAE (RPS)", "Held-out WAPE", "Bias (RPS)", "Validation / holdout days"], rows)}</section>
      ${plots}<section class="panel"><div class="panel-heading"><h2>Evaluation contract</h2></div><div class="panel-body description">Yesterday's peak, the same weekday last week and the rolling 28-day mean share identical evaluation dates. The earlier approximately two-thirds selects the method; the later remainder is held out, with at least seven days in each split. Every prediction uses only observations before that prediction date.<br>Positive bias means overprediction. WAPE is unavailable when held-out actual peak totals are zero. No confidence interval or automatic six-month extrapolation is inferred from these scores.</div></section>`;
  }
  function trainingView() {
    const ids = new Set(state.services.filter(s => (serviceFilter === "all" || s.id === serviceFilter) &&
      (teamFilter === "all" || s.team === teamFilter)).map(s => s.id));
    const allMonths = M.months(state.startMonth);
    const plans = state.training.filter(t => ids.has(t.serviceId) && (poolFilter === "all" || t.pool === poolFilter));
    const cards = plans.map(t => {
      const result = M.training(t, state.startMonth);
      const service = state.services.find(s => s.id === t.serviceId);
      const slow = M.training({...t, mfu: Math.max(1, t.mfu * 0.8)}, state.startMonth);
      const fast = M.training({...t, mfu: Math.min(100, t.mfu * 1.2)}, state.startMonth);
      return `<article class="plan-card"><span class="badge">${esc(skuName(t.pool))} · ${esc(t.month)}</span><h3>${esc(t.name)}</h3><span class="help">${esc(service.name)} · dense pretraining</span><div class="big-number">${fmt(result.totalGpus)} GPUs</div><span class="help">${fmt(result.gang)} per run × ${result.plannedRuns} forecast concurrent runs (${t.runs} base; ${pct(t.scenarioGrowthPct ?? 0)} extra by month six)</span>
        <div class="stat-line"><span>Model / training tokens</span><span>${fmt(t.parametersB, 2)}B / ${fmt(t.tokensB)}B</span></div>
        <div class="stat-line"><span>Compute-only / memory screen</span><span>${fmt(result.computeGpus)} / ${fmt(result.memoryGpus)}</span></div>
        <div class="stat-line"><span>Active window / MFU</span><span>${fmt(t.days, 1)}d / ${t.mfu}%</span></div>
        <div class="stat-line"><span>Reserved envelope GPU-hours</span><span>${compact(result.reservedGpuHours)}</span></div>
        <div class="stat-line"><span>MFU ±20% sensitivity</span><span>${fmt(fast.totalGpus)}–${fmt(slow.totalGpus)}</span></div>
        <p class="help">${allMonths.includes(t.month) ? "Included in current portfolio horizon." : "Outside current horizon; change the planning start to include."} Memory fit and topology remain unverified. Sensitivity is not a prediction interval.</p>
        <div class="form-actions"><button class="button subtle" data-edit-training="${esc(t.id)}">Edit inputs</button><button class="text-button" data-remove-training="${esc(t.id)}">Remove</button></div></article>`;
    }).join("");
    return `<div class="callout">Parameters alone are not a capacity requirement. This estimator supports <strong>dense-transformer pretraining only</strong>: FLOPs ≈ 6 × parameters × training tokens. It does not estimate MoE, adapter fine-tuning, long-context attention overhead, or exact placement.</div>
      <div class="pool-cards">${cards || '<div class="empty">No matching training plans. Add a model roadmap input to get started.</div>'}</div>
      <section class="panel"><div class="panel-heading"><h2>From model plan to resource envelope</h2></div><div class="panel-body description">Compute GPU count = ceil(model FLOPs / (active seconds × dense peak FLOP/s per GPU × MFU)).<br>Training-state memory screen = ceil(parameters × bytes per parameter / memory per GPU).<br>Gang size = the larger compute/memory requirement, rounded up to your topology block.<br>All entered runs in a month are treated as concurrent for peak planning. This is intentionally conservative, not a calendar-placement optimizer. GPU-hours use the reserved time window, not a claim of actual execution.<br>MFU must match the arithmetic precision and hardware configuration. Memory is capped by the selected SKU. Example training assumptions are illustrative; new plans require an explicit peak-throughput input.</div></section>`;
  }
  function requirementRows() {
    return M.capacityForecast(state, serviceFilter, teamFilter, poolFilter).monthly.flatMap(m => m.pools);
  }
  function planningPlans(workspace) {
    return workspace.training.filter(t => {
      const owner = workspace.services.find(s => s.id === t.serviceId);
      return (serviceFilter === "all" || owner.id === serviceFilter) &&
        (teamFilter === "all" || owner.team === teamFilter) && (poolFilter === "all" || t.pool === poolFilter);
    });
  }
  function calibrationButton(kind, item) {
    return `<button class="text-button" data-calibrate-kind="${kind}" data-calibrate-id="${esc(item.id)}" ${M.skuInfo(item.pool).legacy ? 'disabled title="Register an exact-SKU workload before normalizing"' : ""}>Benchmark pair</button>`;
  }
  function forecastLogicExample(workspace, report) {
    const focused = report.monthly.find(m => m.month === planningMonth) || report.monthly.at(-1);
    const entries = focused.pools.flatMap(p => p.estimates);
    const selected = report.services.find(e => e.service.id === planningQuickService) || report.services[0];
    const estimate = selected && entries.find(e => e.serviceId === selected.service.id);
    const usable = selected?.available && estimate?.available;
    let serving;
    if (usable) {
      const service = selected.service, performance = selected.performance;
      const throughput = performance.rpsPerReplica * (1 + report.options.throughputChangePct / 100);
      const capacityShare = 1 - service.headroom / 100;
      serving = `<h3>Workspace calculation: ${esc(service.name)} in ${focused.month}</h3>
        <ol class="logic-calculation">
          <li>Start with ${fmt(estimate.baseRps, 2)} peak requests/second from ${selected.demand.source === "history" ? "the learned traffic forecast" : "the entered user-demand plan"}. Apply this service's growth and the global traffic change, then add launches:<br><code>${fmt(estimate.baseRps, 2)} x ${fmt(estimate.growthFactor, 6)} x ${fmt(1 + report.options.trafficAdjustmentPct / 100, 4)} + ${fmt(estimate.launchRps, 2)} = ${fmt(estimate.peakRps, 2)} peak requests/second.</code></li>
          <li>One replica uses ${performance.gpusPerReplica} ${esc(skuName(service.pool))} GPUs and handles ${fmt(performance.rpsPerReplica, 4)} requests/second at the required response time. The ${pct(report.options.throughputChangePct)} throughput adjustment makes that ${fmt(throughput, 4)} requests/second. Keep ${fmt(service.headroom, 2)}% spare capacity, leaving ${fmt(throughput * capacityShare, 4)} usable requests/second per replica.</li>
          <li>Round up to whole replicas, then multiply by GPUs per replica:<br><code>Round up (${fmt(estimate.peakRps, 2)} / ${fmt(throughput * capacityShare, 4)}) = ${fmt(estimate.gpus / performance.gpusPerReplica)} replicas.<br>${fmt(estimate.gpus / performance.gpusPerReplica)} replicas x ${performance.gpusPerReplica} GPUs = ${fmt(estimate.gpus)} required GPUs.</code></li>
        </ol><p class="help">Throughput source: ${esc(performance.source === "inline-assumption" ? "entered service assumption" : performance.source === "synthetic" ? "illustrative profile" : "user-supplied benchmark")}. Displayed rates are rounded; GPU totals use full precision.</p>`;
    } else serving = `<h3>One-service calculation</h3><p>${esc(selected ? selected.reason || estimate?.reason || "This service cannot be sized with the current inputs." : "No inference service matches these filters. Training on the selected SKU can still contribute below.")}</p>`;
    const rows = report.services.map(e => {
      const item = entries.find(r => r.serviceId === e.service.id);
      const available = e.available && item?.available;
      return `<tr><td class="service-name">${esc(e.service.name)}<span class="subtext">${esc(skuName(e.service.pool))}</span></td><td>${available ? fmt(item.peakRps, 2) : "Not available"}</td><td>${available ? fmt(e.performance.rpsPerReplica * (1 + report.options.throughputChangePct / 100), 4) : "Not available"}</td><td>${fmt(e.service.headroom, 2)}%</td><td>${available ? fmt(e.performance.gpusPerReplica) : "Not available"}</td><td>${available ? fmt(item.gpus) : "Not available"}${available ? "" : `<span class="subtext">${esc(e.reason || item?.reason || "Missing sizing inputs")}</span>`}</td></tr>`;
    }).join("");
    const horizon = M.months(workspace.startMonth);
    const plans = planningPlans(workspace).filter(t => horizon.includes(t.month));
    const plan = plans.find(t => t.month === focused.month) || [...plans].sort((a, b) => a.month.localeCompare(b.month))[0];
    let training = "<p>No training plan matches these filters within the planning horizon. Training requires separate model, token, timing, memory and MFU inputs; it is not inferred from service request rates.</p>";
    if (plan) {
      const result = M.training(plan, workspace.startMonth);
      const status = !report.options.includeTraining ? "Excluded from totals because Include training is off." :
        plan.month === focused.month ? "Included in the inspected month's total." :
          `Scheduled in ${plan.month}, not in the inspected month ${focused.month}.`;
      training = `<h3>Training example: ${esc(plan.name)}</h3><p>${esc(skuName(plan.pool))}. ${status}</p>
        <ol class="logic-calculation">
          <li>Dense-model work: <code>6 x ${fmt(plan.parametersB, 3)} billion parameters x ${fmt(plan.tokensB, 3)} billion training tokens = ${result.flops.toExponential(2)} FLOPs.</code></li>
          <li>Effective GPU speed: <code>${fmt(plan.peakTflops, 3)} peak TFLOP/s x ${fmt(plan.mfu, 2)}% MFU = ${fmt(plan.peakTflops * plan.mfu / 100, 3)} effective TFLOP/s per GPU.</code> MFU is the share of theoretical computing speed achieved on model work, not the GPU busy percentage.</li>
          <li>Finishing within ${fmt(plan.days, 2)} active days needs ${fmt(result.computeGpus)} GPUs for compute. The training-state memory minimum is ${fmt(result.memoryGpus)} GPUs. Take the larger count and round up to blocks of ${fmt(plan.block)} GPUs: ${fmt(result.gang)} per run. Grow ${fmt(plan.runs)} base concurrent runs by ${fmt(result.growthFactor, 4)} and round up to ${fmt(result.plannedRuns)} runs: <strong>${Number.isSafeInteger(result.totalGpus) ? `${fmt(result.totalGpus)} required training GPUs` : "GPU count outside the supported range"}</strong>.</li>
        </ol><p class="help">This estimates dense-transformer pretraining only. Peak speed and MFU must refer to the same precision and configuration. The memory screen excludes activations and communication buffers; it does not prove fit. Training tokens/second benchmark pairs are used for H100 normalization, not to replace this MFU-based sizing calculation.</p>`;
    }
    return `<div class="logic-example">${serving}<h3>Repeat the calculation for every service</h3>
      <p>Each service has its own request size, response-time target, GPU SKU and throughput in requests/second (RPS). Size each service using its own RPS benchmark, then add its GPU requirement to the total:</p>
      ${table(["Service / SKU", "Planned peak demand (RPS)", "Throughput (RPS / replica)", "Spare share", "GPUs per replica", "Required GPUs"], rows)}
      <div class="logic-training">${training}</div>
      <h3>The result for ${focused.month}, within the current filters</h3>
      <p><strong>${fmt(focused.inference)} inference GPUs + ${fmt(focused.training)} scheduled training GPUs = <span id="logic-total-gpus">${fmt(focused.required)}</span> required GPUs${focused.physicalComplete ? "" : " (partial: some workloads cannot be sized)"}.</strong> Group these counts by owning organization and exact GPU SKU. Monthly planning assumes service peaks and same-month training can overlap; it does not credit shared idle time.</p>
      <p>For each SKU: <code>usable supply = installed - unavailable - protected reserve + additions ready by that month</code>. Then <code>shortage = required GPUs - usable supply</code>. A positive shortage is the number to add or the demand to reschedule; spare capacity in another SKU is not an automatic substitute.</p>
      <p>For a common growth index, multiply each workload's GPU count by its own selected-SKU/H100 throughput ratio, then add those H100 equivalents. Normalization compares the plan; it does not change the required SKU counts or normalize idle inventory.</p></div>`;
  }
  function forecastLogicPanel(workspace, report) {
    return `<section class="panel forecast-logic" aria-labelledby="forecast-logic-title"><div class="panel-heading"><div><h2 id="forecast-logic-title">How this capacity forecast is calculated</h2><p>Two separate forecasts: inference growth and training growth. For each, show current allocated GPUs, forecast need, budget and the capacity gap.</p></div></div>
      <ol class="logic-steps">
        <li><h3>1. Inference forecast</h3><p>Grow each service's request rate. Divide by its usable serving throughput, round up model copies, then multiply by GPUs per copy. Add service GPU needs by SKU. Forecast need uses the P90 (high-demand) traffic band; P50 (median) is shown alongside.</p></li>
        <li><h3>2. Training forecast</h3><p>Grow concurrent training runs. Keep each run's model, tokens and active days fixed. Round up whole runs and multiply by GPUs per run. Plans contribute only in their scheduled month.</p></li>
        <li><h3>3. Current GPUs, need, budget and gap</h3><p><strong>Gap = forecasted GPUs - current allocated GPUs.</strong> Budget follows P90 forecast need until someone overrides it. Add inference and training needs for total demand, keeping GPU SKUs separate. Manual budgets do not change the forecast or the gap.</p></li>
      </ol>
      <div class="logic-key" id="service-growth-example"><h3>A small example for month six</h3>
        <p>Illustrative numbers, not hardware benchmarks. All GPUs here are the same SKU, model copies use one GPU, and both segments can run at the same time.</p>
        <p><strong>Inference:</strong> 8 requests/sec grows 50% to 12. Each GPU safely handles 4 requests/sec, already allowing headroom. <strong>12 / 4 = 3 GPUs.</strong></p>
        <p><strong>Training:</strong> 2 concurrent runs grow 50% to 3. Each run needs 2 GPUs. <strong>3 x 2 = 6 GPUs.</strong></p>
        <p><strong>Inference:</strong> Current allocated GPUs: 2, forecast 3, budget automatically 3, gap 1.<br><strong>Training:</strong> Current allocated GPUs: 4, forecast 6, budget automatically 6, gap 2.<br><strong>Total demand: 3 + 6 = 9 GPUs; 3 GPUs short.</strong> If someone changes the training budget to 5, forecast need stays 6 and the gap stays 2.</p>
      </div>
      <p class="logic-key"><strong>For one-GPU model copies: future requests/second / usable requests/second per GPU = GPUs needed, rounded up.</strong> For copies needing several GPUs, divide by the measured throughput of the whole copy, round up copies, then multiply by GPUs per copy. Size different models or configurations separately before rolling up a service. Count shared serving pools only once.</p>
      <p class="logic-key">Both growth controls mean extra demand by month six, compounded to each forecast month; they are not monthly growth rates. Current traffic alone does not prove sustainable throughput. Unknown capacity means an assumption-based scenario. Keep totals split by SKU; spare GPUs of a different SKU are not automatic substitutes.</p>
      <details id="forecast-logic-details" ${$("#forecast-logic-details")?.open ? "open" : ""}><summary>Show detailed formulas and forecasting assumptions</summary>
        <div class="logic-formulas"><p><strong>Inference uses throughput, not MFU. Training uses MFU.</strong> GPU-hours and GPU busy % describe observed usage; this forecast estimates capacity to provision, not future busy %. Busy % is not MFU.</p>
        <p><strong>Inference:</strong> A replica is one serving copy of the model. <code>replicas = round up (peak RPS / (RPS per replica x usable capacity share))</code>; <code>GPUs = replicas x GPUs per replica</code>.</p>
        <p><strong>Training:</strong> <code>work = 6 x parameters x training tokens</code>; <code>compute GPUs = round up (work / (active seconds x peak FLOP/s per GPU x MFU fraction))</code>. Use the larger compute/memory count, round to topology blocks, then multiply by concurrent runs.</p>
        <p>For history-based services, compare a recent average with a weekly trend plus weekday pattern using 14 held-out days, refit, then size against the busiest predicted day of each month. At least 42 consecutive days are needed; up to 84 are used. Missing history requires an explicit demand plan, not an assumed zero.</p></div>
        <details id="forecast-workspace-details" ${$("#forecast-workspace-details")?.open ? "open" : ""}><summary>Inspect actual workspace numbers for the selected service and month (not the small example)</summary>
          <div id="forecast-logic-example">${forecastLogicExample(workspace, report)}</div>
        </details>
      </details></section>`;
  }
  function inferenceServiceDemand(workspace, report) {
    const services = report.inferenceServices;
    const months = report.monthly.map(m => m.month);
    const rows = services.map(s => {
      const current = s.history.current;
      const service = workspace.services.find(item => item.id === s.id);
      return `<tr data-model-row="${esc(s.id)}"><td><span class="service-name">${esc(s.name)}</span><span class="subtext">${esc(s.team)}<br>${esc(skuName(s.pool))}</span></td>
        <td>${fmt(current?.peakRps, 2)}<span class="subtext">Peak demand (requests/sec)</span><span class="subtext">${fmt(M.recordedAllocations(workspace, [s.id]).get(s.id))} current allocated GPUs (highest daily, pre-plan)</span><span class="subtext">${current ? `Through ${current.end}; ${current.days}/28 days observed` : esc(s.history.observedGrowthReason)}</span></td>
        <td class="service-growth"><p class="help">Extra demand by month six (%)</p><div class="growth-editor"><input type="range" min="-90" max="300" step="0.1" value="${service.scenarioGrowthPct ?? 0}" data-service-growth="${esc(s.id)}" aria-label="Growth slider for ${esc(s.name)}"><input type="number" min="-90" max="300" step="0.1" value="${service.scenarioGrowthPct ?? 0}" required data-service-growth="${esc(s.id)}" aria-label="Growth percentage for ${esc(s.name)}"></div><div class="service-growth-actions"><button class="text-button" data-edit-service="${esc(s.id)}">Edit model inputs</button>${calibrationButton("inference", service)}</div><p class="help" data-growth-status role="status">Saved scenario.</p></td>
        <td>${pct(s.history.observedGrowthPct)}<span class="subtext">${esc(s.history.observedGrowthReason || "Recent 28-day peak vs previous 28-day peak")}</span></td>
        ${s.monthly.map(m => `<td data-service-projection="${esc(s.id)}:${m.month}">${fmt(m.gpus)}${m.reason ? `<span class="subtext">${esc(m.reason)}</span>` : ""}</td>`).join("")}
        <td data-service-projection="${esc(s.id)}:growth">${pct(s.forecastGrowthPct)}<span class="subtext">${esc(s.forecastGrowthReason || "Planning month 1 to 6")}</span></td>
        <td><button class="text-button" data-drill-service="${esc(s.id)}">Open model</button></td></tr>`;
    }).join("");
    return `<section class="panel service-demand" id="inference-service-demand" aria-labelledby="inference-service-demand-title"><div class="panel-heading"><div><h2 id="inference-service-demand-title">Inference demand by service</h2><p>${services.length ? "Edit growth beside each service's usage. Drag its slider or enter a percentage; release the slider or leave the number field to save. Extra demand compounds to the entered percentage by month six, on top of the learned trend; +0% keeps that trend. Launch traffic is added separately." : "No inference service matches these filters. The training roadmap remains available below."}</p></div></div>
      <p class="panel-body description">Current demand is the highest recorded daily peak in requests per second (RPS) in the latest observed 28-day window before planning starts, not live traffic. Current allocated GPUs are the highest recorded daily allocation before planning starts, not the forecast requirement. Historical growth compares complete 28-day peak-demand windows; forecast growth compares month-one and month-six GPU requirements. Scroll right for all months; service names stay visible.</p>
      ${table(["Service / organization / SKU", "Current usage / demand", "Growth input", "Historical demand growth", ...months.map(m => `${m} GPUs`), "Forecast GPU growth", ""], rows)}</section>`;
  }
  function historicalComparison(report) {
    const rows = report.historical.map(m => `<tr><td>${m.month}<span class="subtext">Through ${m.periodEnd}</span></td>
      <td>${fmt(m.actual, 1)}${m.actual !== null && !m.complete ? '<span class="subtext">Partial history</span>' : ""}</td>
      <td>${fmt(m.previousActual, 1)}<span class="subtext">${m.previousMonth} through ${m.previousPeriodEnd}</span>${m.previousActual !== null && m.previousCompleteDays < m.previousExpectedDays ? '<span class="subtext">Partial history</span>' : ""}</td>
      <td>${m.gap > 0 ? "+" : ""}${fmt(m.gap, 1)}</td><td>${pct(m.growthPct)}</td>
      <td>${m.completeDays}/${m.expectedDays} current days; ${m.previousCompleteDays}/${m.previousExpectedDays} prior days<span class="subtext">${esc(m.comparisonReason || "Complete matching service coverage.")}</span></td></tr>`).join("");
    return `<section class="panel historical-comparison" id="history-year-comparison" aria-labelledby="history-year-title"><div class="panel-heading"><div><h2 id="history-year-title">Actual usage vs previous year</h2><p>Physical GPUs for each of the 12 historical months, using the same service, organization and SKU filters as the forecast. Compare the highest daily assignments in each period. A partial latest month is compared through the same day last year. Gaps need complete service coverage in both periods.</p></div></div>
      ${!report.historical.some(m => m.previousActual !== null) ? '<p class="panel-body help">This workspace has no previous-year observations for these months. Import more history or load the updated two-year demo from Data & assumptions. Loading a demo replaces the workspace only after confirmation. <button class="text-button" data-view="data">Open Data & assumptions</button></p>' : ""}
      ${table(["Month", "Actual GPUs", "Previous-year GPUs", "Gap (GPUs)", "Gap (%)", "Coverage / notes"], rows)}</section>`;
  }
  function planningResults(workspace, report = M.bottomUpForecast(workspace, serviceFilter, teamFilter, poolFilter)) {
    const focused = report.monthly.find(m => m.month === planningMonth) || report.monthly.at(-1);
    const normalized = false;
    const subtotal = (m, kind) => {
      const rows = m.workloads.filter(r => r.kind === kind);
      return normalized ? rows.some(r => r.normalizedGpus === null) ? null :
        rows.reduce((n, r) => n + r.normalizedGpus, 0) : rows.some(r => r.gpus === null) ? null :
        rows.reduce((n, r) => n + r.gpus, 0);
    };
    const partial = focused.missing ? `<div class="callout">${focused.missing} workload(s) lack usable normalization evidence.
      Known subtotal: ${fmt(focused.knownNormalized, 1)} H100 equivalents. This is not a complete normalized requirement.
      Open the organization or model and add a benchmark pair.</div>` : focused.normalizedRequired === null ?
      `<div class="callout">${esc(focused.normalizationReason)}</div>` : "";
    const orgRows = focused.organizations.map(o => `<tr data-org-row="${esc(o.team)}"><td class="service-name">${esc(o.team)}</td><td>${fmt(o.inference)}</td><td>${fmt(o.training)}</td><td>${fmt(o.required)}${o.physicalComplete ? "" : " (partial)"}</td><td>${fmt(o.normalizedRequired, 1)}</td><td><button class="text-button" data-drill-org="${esc(o.team)}">Open models</button></td></tr>`).join("");
    const modelRows = [...focused.workloads.filter(r => r.kind === "inference").map(r => ({...r, month: focused.month})),
      ...report.monthly.flatMap(m => m.workloads.filter(r => r.kind === "training").map(r => ({...r, month: m.month})))];
    const models = modelRows.map(r => `<tr ${r.kind === "inference" ? `data-model-row="${esc(r.id)}"` : `data-training-row="${esc(r.id)}"`}><td class="service-name">${esc(r.name)}<span class="subtext">${esc(r.reason || (r.calibration.source === "synthetic" ? "Illustrative benchmark pair" : r.calibration.source === "same-sku" ? "Reference SKU: 1:1" : "User-supplied benchmark pair"))}</span></td><td>${r.kind}</td><td>${r.month}</td><td>${esc(skuName(r.pool))}</td><td>${fmt(r.gpus)}</td><td>${fmt(r.normalizedGpus, 1)}</td><td>${r.calibration.available ? `${fmt(r.calibration.ratio, 3)} H100 / GPU` : "Not calibrated"}</td><td><button class="text-button" ${r.kind === "inference" ? `data-drill-service="${esc(r.id)}"` : `data-edit-training="${esc(r.id)}"`}>Open model</button>${calibrationButton(r.kind, {id: r.id, pool: r.pool})}</td></tr>`).join("");
    const scope = teamFilter === "all" && serviceFilter === "all" ?
      `<section class="panel"><div class="panel-heading"><div><h2>Demand by organization</h2><p>Double-click a row or choose Open models. Organizations use the service's owning team.</p></div></div>${table(["Organization", "Inference GPUs", "Training GPUs", "Total GPUs", "H100 equivalents", ""], orgRows)}</section>` :
      `<section class="panel"><div class="panel-heading"><div><h2>Inference and training models</h2><p>Inference uses ${focused.month}; training shows each scheduled month. Double-click a model row for details.</p></div></div>${table(["Model / evidence", "Workload", "Month", "Assigned SKU", "GPUs", "H100 equivalents", "Benchmark ratio", ""], models)}</section>`;
    const selected = workspace.services.find(s => s.id === serviceFilter);
    const detail = selected ? `<section class="panel"><div class="panel-heading"><h2>${esc(selected.name)}: model assumptions</h2><button class="button subtle" data-edit-service="${esc(selected.id)}">Edit model inputs</button></div><div class="panel-body description">${esc(selected.profile)}<br>Configuration: ${esc(selected.workloadKey)}. Input / output tokens: ${fmt(selected.inputTokens)} / ${fmt(selected.outputTokens)}. Extra demand by month six: ${pct(selected.scenarioGrowthPct ?? 0)}.<br>H100 equivalents compare this workload only. Divide its equivalent count by its own benchmark ratio to recover its assigned-SKU GPU count; replica rounding has already been applied.</div></section>` : "";
    const gapText = value => value === null ? "Allocation data / forecast needed" : value > 0 ? `${fmt(value)} short` : value < 0 ? `${fmt(-value)} spare` : "No gap";
    const allocationKinds = report.options.includeTraining ? ["inference", "training"] : ["inference"];
    const currentCounts = focused.pools.flatMap(p => allocationKinds.map(kind => p[`${kind}Have`]));
    const currentComplete = currentCounts.every(n => n !== null);
    const knownCurrent = currentCounts.filter(n => n !== null);
    const currentTotal = knownCurrent.reduce((sum, n) => sum + n, 0);
    const forecastGap = currentComplete && focused.physicalComplete ? focused.required - currentTotal : null;
    const forecastGapP50 = currentComplete && focused.physicalComplete ? focused.requiredP50 - currentTotal : null;
    const currentValue = !knownCurrent.length ? "Unavailable" : `${fmt(currentTotal)}${currentComplete ? "" : '<span class="subtext">Partial allocation data</span>'}`;
    const missingAllocations = allocationKinds.filter(kind => focused.pools.some(p => p[`${kind}Have`] === null));
    const segmentGap = kind => focused.pools.every(p => p[`${kind}Gap`] !== null) ? focused.pools.reduce((n, p) => n + p[`${kind}Gap`], 0) : null;
    const gapPhrase = (label, gap) => gap === null ? `${label} gap unavailable` : gap > 0 ? `${label} needs ${fmt(gap)} more GPUs` : gap < 0 ? `${label} has ${fmt(-gap)} spare GPUs` : `${label} is balanced`;
    const remainingTraining = report.options.includeTraining && focused.pools.some(p => p.trainingHaveSource === "remaining-capacity");
    const decision = `<p class="help planning-decision">${focused.month}: ${gapPhrase("Inference", segmentGap("inference"))}${report.options.includeTraining ? `; ${gapPhrase("training", segmentGap("training"))}` : ""}.${remainingTraining ? " Training's current allocation is an assumption from remaining usable capacity." : ""}</p>`;
    const segmentTable = kind => table(["GPU SKU", "Current allocated GPUs", "Forecast need", "Budget", "Gap (forecast - current allocated GPUs)"],
      focused.pools.map(p => `<tr data-segment="${kind}" data-segment-pool="${esc(p.pool)}"><td>${esc(skuName(p.pool))}</td><td>${p[`${kind}Have`] === null ? `No ${kind} allocation data` : fmt(p[`${kind}Have`])}<span class="subtext">${p[`${kind}HaveSource`] === "recorded-allocation" ? "Retained recorded allocation" : p[`${kind}HaveSource`] === "entered-allocation" ? "Saved allocation baseline" : p[`${kind}HaveSource`] === "remaining-capacity" ? "Remaining usable capacity, assumed training" : "Allocation data unavailable for this scope"}</span></td><td>${p[`${kind}Complete`] ? fmt(p[kind]) : "Partial"}</td><td>${fmt(p[`${kind}Budget`])}<span class="subtext">${p[`${kind}BudgetSource`] === "manual" ? "Manual override" : p[`${kind}BudgetSource`] === "excluded" ? "Excluded" : "Follows forecast"}</span></td><td>${gapText(p[`${kind}Gap`])}</td></tr>`).join(""));
    return `<div id="planning-summary"><div class="kpis forecast-kpis">${metric("Current allocated GPUs", currentValue, currentComplete ? report.options.includeTraining && focused.pools.some(p => p.trainingHaveSource === "remaining-capacity") ? "Inference + training; remaining usable supply is assigned to training" : `Retained allocations${report.options.includeTraining ? ": inference + training" : ": inference only; training excluded"}` : `Known allocation subtotal; missing ${missingAllocations.join(" and ")} allocation data`, true)}${metric("Forecast GPU need (P90)", focused.physicalComplete ? fmt(focused.required) : `${fmt(focused.required)}<span class="subtext">Partial forecast</span>`, `${focused.month}: ${fmt(focused.inference)} inference + ${report.options.includeTraining ? (focused.training ? `${fmt(focused.training)} training` : "no training scheduled this month") : "training excluded"}; P50 median ${focused.physicalComplete ? fmt(focused.requiredP50) : "partial"}`)}${metric("Gap", forecastGap === null ? "Unavailable" : `${forecastGap > 0 ? "+" : ""}${fmt(forecastGap)}`, forecastGap === null ? "Needs complete allocation data and forecast" : `P50 gap ${forecastGapP50 > 0 ? "+" : ""}${fmt(forecastGapP50)}. Net P90 forecast minus current allocations${forecastGap < 0 ? "; spare GPUs remain allocated" : ""}${remainingTraining ? "; training current allocation is assumed" : ""}. Review each SKU separately; no automatic transfers.`)}</div>${decision}${partial}
      <section class="panel" id="segment-budget-summary"><div class="panel-heading"><div><h2>Current allocated GPUs → Forecast → Budget → Gap</h2><p>${focused.month}. Gap = forecasted GPUs - current allocated GPUs. Budget changes do not change the gap. Current allocated GPUs stay with their teams even when demand falls.</p></div><div><button class="button subtle" data-action="capacity">Review allocation baseline</button><button class="button subtle" data-action="budgets">Edit budget</button><button class="text-button" data-reset-budgets>Reset budget to forecast</button></div></div>
      <div class="panel-body"><h3>Inference</h3></div>${segmentTable("inference")}<div class="panel-body"><h3>Training</h3></div>${segmentTable("training")}
      <div class="panel-body"><p class="help">Current allocated inference GPUs come from the highest recorded daily allocation for each selected service before planning starts, then stay with its owning team throughout the forecast. Daily allocated GPU-hours / 24 are rounded up to whole GPUs; these are derived allocation counts, not a live inventory feed. At company scope, current training GPUs default to usable supply at planning start minus inference allocations for the same SKU. This assumes all remaining usable GPUs belong to training, not unassigned inventory. Saved allocation baselines take precedence. Service/organization filters use their own inference allocations; remaining company training capacity is not attributed to every team. Future additions remain unassigned until the baseline is updated. Spare allocations stay with the team; no automatic borrowing or reclamation occurs.</p>
      ${focused.pools.some(p => p.allocationConflict) ? '<p class="help error">Recorded allocations exceed usable company supply for one or more SKUs. Reconcile allocation and supply records; no counts have been silently capped.</p>' : ""}
      <p class="help">Gap always equals forecasted GPUs minus current allocated GPUs, independent of budget. Positive means additional GPUs are needed; negative means spare GPUs remain allocated. Review shortages separately by SKU.</p></div></section>
      <section class="panel" id="inference-forecast"><div class="panel-heading"><div><h2>1. Inference: service growth and GPU forecast</h2><p>Edit service growth below. Each service keeps its own SKU and serving throughput; GPUs are sized separately before adding them. ${normalized ? "Budget and current allocated GPUs are physical counts and are shown in the tables above, not on this normalized axis." : "Budget follows need until overridden. Current allocated GPUs stay with the team even when forecast demand falls."}</p></div></div><div class="chart-wrap">${chart(report.monthly.map(m => ({month: m.month, demand: subtotal(m, "inference"),
        budget: normalized || m.pools.some(p => p.inferenceBudget === null) ? null : m.pools.reduce((n, p) => n + p.inferenceBudget, 0),
        have: normalized || m.pools.some(p => p.inferenceHave === null) ? null : m.pools.reduce((n, p) => n + p.inferenceHave, 0)})),
        [{key: "demand", name: "Inference GPU need", color: "var(--accent)"}, {key: "budget", name: "Inference GPU budget", color: "var(--blue)"}, {key: "have", name: "Current allocated inference GPUs", color: "var(--history)"}], normalized ? "Inference forecast in H100 equivalents" : "Inference forecast, budget and current allocated GPUs", 0)}</div></section>
      </div>${inferenceServiceDemand(workspace, report)}<div id="planning-rollups">${trainingSegment(workspace, report)}${scope}${detail}<section class="panel"><div class="panel-heading"><div><h2>Convert the plan back to assigned SKUs</h2><p>${focused.month}. Counts retain each workload's chosen hardware; gap = forecasted GPUs - current allocated GPUs.</p></div><button class="button subtle" data-export-requirements>Download CSV</button></div>${table(["GPU SKU", "Inference", "Training", "Physical total", "H100 equivalents", "Current allocated GPUs", "Gap / spare"], focused.pools.map(p => {
        const counts = allocationKinds.map(kind => p[`${kind}Have`]);
        const current = counts.every(n => n !== null) ? counts.reduce((n, count) => n + count, 0) : null;
        const gap = current !== null && p.physicalComplete ? p.required - current : null;
        return `<tr><td>${esc(skuName(p.pool))}</td><td>${fmt(p.inference)}</td><td>${fmt(p.training)}</td><td>${fmt(p.required)}${p.physicalComplete ? "" : " (partial)"}</td><td>${fmt(p.normalizedRequired, 1)}</td><td>${fmt(current)}</td><td><span class="badge ${gap === null ? "" : gap > 0 ? "red" : "green"}">${gap > 0 ? "+" : ""}${fmt(gap)}</span></td></tr>`;
      }).join(""))}</section></div>`;
  }
  function trainingSegment(workspace, report) {
    const horizon = M.months(workspace.startMonth);
    const plans = planningPlans(workspace);
    const rows = plans.map(t => {
      const result = M.training(t, workspace.startMonth);
      return `<tr><td class="service-name">${esc(t.name)}<span class="subtext">${esc(skuName(t.pool))}</span></td><td>${t.month}</td><td>${t.runs}</td><td><label>Extra concurrent runs by month six (%)<input type="number" min="-90" max="300" step="0.1" required value="${t.scenarioGrowthPct ?? 0}" data-training-growth="${esc(t.id)}" aria-label="Training run growth for ${esc(t.name)}"></label></td><td>${result.plannedRuns}</td><td>${fmt(result.gang)}</td><td>${fmt(result.totalGpus)}${report.options.includeTraining && horizon.includes(t.month) ? "" : " (excluded)"}</td><td><button class="text-button" data-edit-training="${esc(t.id)}">Edit plan</button></td></tr>`;
    }).join("");
    const points = report.monthly.map(m => {
      const pools = m.pools;
      return {month: m.month, demand: pools.every(p => p.trainingComplete) ? m.training : null,
        budget: pools.every(p => p.trainingBudget !== null) ? pools.reduce((n, p) => n + p.trainingBudget, 0) : null,
        have: pools.every(p => p.trainingHave !== null) ? pools.reduce((n, p) => n + p.trainingHave, 0) : null};
    });
    return `<section class="panel" id="training-segment"><div class="panel-heading"><div><h2>2. Training: run growth and GPU forecast</h2><p>${report.options.includeTraining ? "Included in total demand." : "Excluded from total demand; roadmap inputs remain editable."} Growth compounds to each plan's scheduled month, reaching the entered percentage in month six. Runs round up; model size, tokens and days per run stay fixed. All same-month runs are concurrent. Growth does not create recurring plans in empty months.</p></div><button class="button subtle" data-action="training">Add training plan</button></div>
      <div class="chart-wrap">${chart(points, [{key: "demand", name: "Training GPU need", color: "var(--amber)"}, {key: "budget", name: "Training GPU budget", color: "var(--blue)"}, {key: "have", name: "Current allocated training GPUs", color: "var(--history)"}], "Training need, budget and current allocated GPUs", 0)}</div>
      <div class="panel-body"><p class="help">This chart always uses physical GPUs. Budget follows forecast need unless overridden. Current training allocations default to remaining usable company capacity after inference, unless a saved training allocation overrides it. Forecast training need still comes from scheduled runs, not from spare capacity. Training growth is independent of inference growth.</p></div>
      ${table(["Training plan / SKU", "Scheduled month", "Base concurrent runs", "Run growth", "Forecast runs", "GPUs per run", "Forecast GPUs", ""], rows)}
      <div class="training-scroll"><div class="training-board">${horizon.map(m => `<section class="training-lane" data-training-drop="${m}" aria-label="Training scheduled for ${m}"><h3>${m}</h3>${plans.filter(t => t.month === m).map(t => `<article class="training-drag-card" draggable="true" data-training-drag="${esc(t.id)}"><span class="help">Drag to reschedule</span><h3>${esc(t.name)}</h3><p>${fmt(M.training(t, workspace.startMonth).totalGpus)} GPUs<br><span class="help">${esc(skuName(t.pool))}</span></p><label class="help">Move to month<select data-training-month="${esc(t.id)}" aria-label="Move ${esc(t.name)} to month">${horizon.map(month => `<option ${month === m ? "selected" : ""}>${month}</option>`).join("")}</select></label><div class="form-actions"><button class="text-button" data-edit-training="${esc(t.id)}">Edit model</button>${calibrationButton("training", t)}</div></article>`).join("") || '<p class="help">Drop a training plan here.</p>'}</section>`).join("")}</div></div>
      ${plans.some(t => !horizon.includes(t.month)) ? '<p class="panel-body help">Some plans are outside this horizon and do not contribute. Open Training roadmap to see them.</p>' : ""}</section>`;
  }
  function planningView() {
    planningMonth = state.startMonth;
    const services = chosenServices();
    const quick = services.find(s => s.id === serviceFilter) || services.find(s => s.id === planningQuickService) || services[0];
    if (quick) planningQuickService = quick.id;
    const report = M.bottomUpForecast(state, serviceFilter, teamFilter, poolFilter);
    const scope = serviceFilter !== "all" || teamFilter !== "all" || poolFilter !== "all" ?
      `<p class="description">Selected scope: ${esc(serviceFilter !== "all" ? state.services.find(s => s.id === serviceFilter).name : teamFilter !== "all" ? teamFilter : "All services")}${poolFilter !== "all" ? ` / ${esc(skuName(poolFilter))}` : ""}. <button class="text-button" data-planning-root>Back to company forecast</button></p>` : "";
    return `${forecastLogicPanel(state, report)}${scope}
      <div class="callout info">Build the plan from services upward. Edit a growth number or drag its slider; results preview immediately and save on release or when you leave the field. Drag training cards between months, or use their month selectors. The demo's benchmark pairs are illustrative, not NVIDIA performance claims.</div>
      <div id="planning-results">${planningResults(state, report)}</div>
      <section class="panel"><div class="panel-heading"><h2>How normalization works</h2></div><div class="panel-body description">For each workload: ratio = benchmark throughput per selected-SKU GPU / benchmark throughput per H100 SXM GPU. H100 equivalents = required GPUs x that ratio. Convert back for that same workload: equivalents / ratio. Compare identical model versions, precision, request sizes and response-time targets; enter full-replica throughput divided by its GPU count.<br>Inference uses requests/second/GPU (RPS/GPU); training uses training tokens/second/GPU. Ratios are workload-specific, not a universal H100-to-B200 conversion. A GB200 superchip contains a CPU and two GPUs; it is not one interchangeable GPU.<br>Missing, changed or future-dated evidence makes normalized totals unavailable. Physical SKU demand remains visible. This index does not prove memory fit, interconnect compatibility, or that a job can move to another GPU.</div></section>`;
  }
  function previewServiceGrowth(input, persist) {
    const status = input.closest(".service-growth").querySelector("[data-growth-status]");
    status.classList.toggle("error", !input.checkValidity());
    if (!input.checkValidity()) {
      forecastSaveStatus("Unsaved changes. Enter valid growth before saving.", true);
      status.textContent = "Preview not applied. Enter growth between -90% and +300% in steps of 0.1%.";
      return;
    }
    const next = clone();
    const service = next.services.find(s => s.id === input.dataset.serviceGrowth);
    service.scenarioGrowthPct = Number(input.value);
    planningQuickService = service.id;
    document.querySelectorAll("[data-service-growth]").forEach(el => {
      if (el !== input && el.dataset.serviceGrowth === service.id) el.value = input.value;
    });
    if (persist) {
      if (!save(next, "Service growth saved. SKU demand and organization totals updated.", false, false)) {render(); return;}
      status.textContent = "Scenario saved.";
    } else {
      status.textContent = "Live preview - release the slider or leave the number field to save.";
      forecastSaveStatus("Unsaved changes. Finish editing or click Save forecast.");
    }
    const report = M.bottomUpForecast(next, serviceFilter, teamFilter, poolFilter);
    // Keep table inputs mounted so typing and pointer drags survive live previews.
    const preview = document.createElement("template");
    preview.innerHTML = planningResults(next, report);
    for (const id of ["planning-summary", "planning-rollups"]) {
      $(`#${id}`).replaceChildren(...preview.content.querySelector(`#${id}`).childNodes);
    }
    const projections = new Map([...preview.content.querySelectorAll("[data-service-projection]")]
      .map(cell => [cell.dataset.serviceProjection, cell]));
    document.querySelectorAll("[data-service-projection]").forEach(cell => {
      cell.replaceChildren(...projections.get(cell.dataset.serviceProjection).childNodes);
    });
    $("#forecast-logic-example").innerHTML = forecastLogicExample(next, report);
    makePlanningSectionsCollapsible($("#content"));
  }
  function rescheduleTraining(id, targetMonth) {
    try {
      const next = M.moveTraining(state, id, targetMonth);
      if (!save(next, "Training rescheduled. Monthly GPU requirements recalculated.")) render();
    } catch (error) {
      notice(`Training not moved: ${error.message}`, true);
      render();
    }
  }
  function capacityView() {
    const forecast = M.capacityForecast(state, serviceFilter, teamFilter, poolFilter);
    const rows = forecast.monthly.flatMap(m => m.pools);
    const options = forecast.options;
    const last = forecast.monthly.at(-1);
    const firstGap = rows.find(r => r.gap > 0);
    const ready = forecast.services.filter(e => e.available).length;
    const complete = ready === forecast.services.length && ready > 0;
    const points = [...forecast.historical.map(m => ({...m, planned: m.actual})), ...forecast.monthly.map(m => ({month: m.month,
      baseline: m.complete && ready ? m.baselineRequired : null, planned: m.complete && ready ? m.required : null, usable: m.usable}))];
    const historyCount = forecast.services.filter(e => e.demand.source === "history").length;
    const names = {linear_trend: "Learned weekly trend", recent_average: "Recent average + weekday pattern", drivers: "Entered user plan"};
    const serviceRows = forecast.services.map(e => {
      const first = e.demand.monthly?.[0], end = e.demand.monthly?.at(-1);
      return `<tr><td class="service-name">${esc(e.service.name)}<span class="subtext">${esc(e.service.team)} / ${esc(skuName(e.service.pool))}</span></td><td>${esc(e.available ? names[e.demand.method] : e.reason)}</td><td>${e.history.observedDays || 0} days<span class="subtext">${e.history.lastDate ? `Through ${e.history.lastDate}` : "No history"}${e.history.gapDays > 14 ? ` / ${e.history.gapDays}-day gap before plan` : ""}</span></td><td>${e.demand.source === "history" && e.history.selectedWape !== null ? `${fmt(e.history.selectedWape * 100, 1)}%` : "Not available"}</td><td>${first && end ? pct(M.growth(end.peakRps, first.peakRps)) : "Not available"}</td><td><button class="text-button" data-edit-service="${esc(e.service.id)}">Edit service plan</button></td></tr>`;
    }).join("");
    return `<div class="forecast-intro"><span class="badge green">HISTORY-BASED FORECAST</span><p>${historyCount} service${historyCount === 1 ? "" : "s"} learned from recorded traffic. User-based plans cover services without a traffic forecast.</p></div>
      <div class="kpis">${metric(`GPUs needed in ${last.month}`, ready ? fmt(last.required) : "Not available", complete ? "With your plans and adjustments" : "Partial estimate - check service coverage", true)}${metric("Change from base forecast", ready ? pct(M.growth(last.required, last.baselineRequired)) : "Not available", "Traffic changes, serving improvements and training")}${metric("First SKU shortage", firstGap ? firstGap.month : complete ? "None forecast" : "Unknown", firstGap ? `${skuName(firstGap.pool)}: ${fmt(firstGap.gap)} GPUs short${!firstGap.complete ? " (partial demand)" : ""}` : "Check each GPU SKU, not just the fleet total")}${metric("Services forecast", `${ready} / ${forecast.services.length}`, complete ? "All selected services have sizing inputs" : "Missing history or performance evidence")}</div>
      ${!complete ? '<div class="callout">Some services cannot be forecast. Known demand remains in the table; incomplete totals are not plotted as a complete forecast. Add history or explicitly configure a user-based plan.</div>' : ""}
      <div class="forecast-layout"><section class="panel forecast-main"><div class="panel-heading"><div><h2>GPU demand forecast</h2><p>See how your plans change the forecast over the next six months.</p></div><span class="badge">${state.startMonth} to ${last.month}</span></div>
        <div class="panel-body"><div class="legend"><span><i class="trend-key blue"></i>Historical assigned GPUs</span><span><i class="trend-key forecast-key"></i>Base serving forecast</span><span><i class="trend-key forecast-key blue"></i>With my plans</span><span><i class="trend-key forecast-key amber"></i>Available GPUs (planned)</span></div></div>
        <div class="chart-wrap">${chart(points, [{key: "baseline", name: "Base serving forecast", color: "var(--accent)"}, {key: "planned", name: "With my plans", historyName: "Historical daily assigned GPUs (monthly maximum)", color: "var(--blue)"}, {key: "usable", name: "Available GPUs", color: "var(--amber)", dashed: true}], "Historical GPU assignments continuing into a dotted six-month demand forecast", forecast.historical.length)}</div>
        <div class="panel-body description">History covers the 12 months before planning starts and shows the highest daily average assigned GPUs on recorded days. Future demand uses the busiest predicted day, converted through each service's serving performance. Training appears in the plan, not the base serving line. Pool shortages below take priority over the fleet total.</div>${historicalComparison(forecast)}</section>
      <section class="panel forecast-controls"><div class="panel-heading"><div><h2>Adjust the forecast</h2><p>Workspace-wide changes, applied to selected views.</p></div></div><form id="forecast-controls" class="panel-body">
        <label>Traffic above / below forecast (%)<input name="trafficAdjustmentPct" type="number" min="-90" max="300" step="any" value="${options.trafficAdjustmentPct}" required><span class="help">+20 means 20% more traffic than the learned forecast.</span></label>
        <label>Serving throughput change (%)<input name="throughputChangePct" type="number" min="-50" max="300" step="any" value="${options.throughputChangePct}" required><span class="help">+20 means each GPU group handles 20% more requests.</span></label>
        <label class="check-option"><input name="includeLaunches" type="checkbox" ${options.includeLaunches ? "checked" : ""}> Include planned launches</label>
        <label class="check-option"><input name="includeTraining" type="checkbox" ${options.includeTraining ? "checked" : ""}> Include training roadmap</label>
        <button class="button primary" type="submit">Update forecast</button><button class="text-button" type="button" data-reset-forecast>Reset adjustments</button>
        <div class="forecast-links"><button class="text-button" type="button" data-view="training">Edit training plans</button><button class="text-button" type="button" data-action="addition">Add future GPUs</button></div>
      </form></section></div>
      <section class="panel"><div class="panel-heading"><div><h2>Where will capacity run short?</h2><p>Positive gap = GPUs to add or demand to move. Each SKU has its own supply; no automatic substitution.</p></div><button class="button subtle" data-export-requirements>Download CSV</button></div>${table(["Month", "GPU SKU", "Base serving", "Planned serving", "Training", "Total planned", "Available", "Gap / spare", "Status"], rows.map(r => `<tr><td>${r.month}</td><td>${esc(skuName(r.pool))}</td><td>${fmt(r.baselineInference)}</td><td>${fmt(r.inference)}</td><td>${fmt(r.training)}</td><td>${fmt(r.required)}</td><td>${fmt(r.usable)}</td><td>${r.gap > 0 ? "+" : ""}${fmt(r.gap)}</td><td><span class="badge ${!r.complete || r.gap > 0 ? "red" : "green"}">${!r.complete ? "Partial inputs" : r.gap > 0 ? "Shortage" : "Within supply"}</span></td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>What is driving the forecast?</h2><p>Compare a recent average with a learned weekly trend. Pick the lower-error method on 14 later days, then refit with all recent history.</p></div><button class="button subtle" data-action="consumption">Add service history</button></div>${table(["Service / GPU SKU", "Forecast method", "History used", "Model selection error", "First to last forecast month", ""], serviceRows)}
      <div class="panel-body description">Up to 84 consecutive daily records are used; at least 42 are needed. Both methods learn weekday patterns. The 14-day selection error is not a six-month accuracy score. Gaps between the latest record and planning start are forecast forward, not filled with zero. Manual annual traffic growth is kept in Service plans; it does not set the learned trend. Driver plans in the capacity forecast use only their extra demand by month six, not annual user growth.</div></section>`;
  }
  function dataView() {
    const synthetic = state.records.filter(r => r.source === "synthetic").length;
    return `<div class="callout">This is a browser-local scenario workspace, not a live company telemetry feed. ${synthetic} of ${state.records.length} consumption rows are synthetic. User-entered rows are manual observations, not verified connector measurements. No data is sent to a backend.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Supply by GPU SKU</h2><p>Supply = installed − unavailable − reserve + additions. Counts are individual GPUs, not servers or racks.</p></div><button class="button subtle" data-action="supply">Edit supply</button></div>${table(["GPU SKU", "Installed", "Unavailable", "Protected reserve", "Base usable"], M.activePools(state).map(p => {const s = state.supply[p]; return `<tr><td>${esc(skuName(p))}</td><td>${fmt(s.installed)}</td><td>${fmt(s.unavailable)}</td><td>${fmt(s.reserve)}</td><td>${fmt(s.installed - s.unavailable - s.reserve)}</td></tr>`;}).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>Commissioned additions</h2><p>Capacity becomes usable at the start of the selected month; readiness is a user assumption.</p></div><button class="button subtle" data-action="addition">+ Addition</button></div>${table(["GPU SKU", "Available from", "GPUs", ""], state.supply.additions.map((a, i) => `<tr><td>${esc(skuName(a.pool))}</td><td>${a.month}</td><td>${fmt(a.gpus)}</td><td><button class="text-button" data-remove-addition="${i}">Remove</button></td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>GPU SKU catalog</h2><p>Memory and form factor identify the variant. Serving throughput must come from a matching workload test.</p></div></div>${table(["SKU", "Family", "Memory / GPU", "Form factor", "Source"], M.SKU_CATALOG.filter(s => !s.legacy || M.activePools(state).includes(s.id)).map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.family)}</td><td>${s.memoryGB === null ? "Not specified" : `${s.memoryGB} GB ${s.memoryType}`}</td><td>${s.formFactor}</td><td>${s.source ? `<a href="${esc(s.source)}" target="_blank" rel="noopener noreferrer">NVIDIA specs</a>` : "Legacy family only"}</td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>NVIDIA workload areas</h2><p>Publicly documented areas, not a ranked compute-spending breakdown. Demo volumes are illustrative.</p></div></div>${table(["Area", "Work being planned", "Source"], M.WORKLOAD_AREAS.map(w => `<tr><td class="service-name">${esc(w.name)}</td><td class="workload-description">${esc(w.description)}</td><td><a href="${esc(w.source)}" target="_blank" rel="noopener noreferrer">Read source</a></td></tr>`).join(""))}<div class="panel-body description">For render, simulation and evaluation services, a request means one fixed, benchmarked operation. Measure its throughput in requests/second using a matching test, not a text-generation benchmark. The dense training calculator is not a simulator or a universal robotics/video-model estimator.</div></section>
      <section class="panel"><div class="panel-heading"><h2>Workspace portability</h2></div><div class="panel-body"><p class="description">Version-3 exports include exact GPU SKU identifiers and forecast adjustments. Older family-only inventory remains labeled variant not specified. Import or loading the NVIDIA demo replaces the workspace only after confirmation.</p><div class="data-tools"><button class="button subtle" data-export-workspace>Export JSON</button><label class="button subtle">Import JSON <input type="file" id="import-file" accept=".json,application/json"></label><button class="button subtle" data-action="reset">Load NVIDIA workload demo</button></div></div></section>
      <section class="panel"><div class="panel-heading"><h2>How the forecast uses these inputs</h2></div><div class="panel-body description">Capacity forecast learns a recent average or weekly trend from up to 84 consecutive daily records. It compares 14-day predictions before selecting and refitting the method. Forecast adjustments are saved with the workspace.<br>User-based plans can replace the learned demand for new services. They multiply users, sessions, requests and model calls, account for calls avoided by cache, and apply a peak-traffic factor. Annual growth applies to users in this mode. Launch traffic is added once.<br>Selected performance profiles must match the service configuration and request sizes. Missing inputs remain visible as partial demand. Daily backtests are a separate next-day traffic check.</div></section>
      <section class="panel"><div class="panel-heading"><h2>Evidence & limitations</h2></div><div class="panel-body description"><strong>Observed:</strong> only what you manually enter; not independently verified.<br><strong>Derived:</strong> allocation summaries, comparable-period growth, replicas, compute/memory screens and monthly gaps.<br><strong>Synthetic:</strong> seeded 200,000-GPU inventory, 24-month daily service history in the updated demo, performance profiles and roadmaps. Independent of the Philly experiment.<br><strong>Not implemented:</strong> collectors, real-time streaming, effective-dated service migrations, shared-GPU attribution, authentication, uncertainty calibration, topology validation or scheduler enforcement.<br>FLOPs describe work; FLOP/s describes rate. Busy-time utilization must not be multiplied by hardware peak and called measured FLOP/s.<br>Historical YoY/two-year comparisons remain unavailable without complete matching history. Every growth rate in the inference planner is a scenario assumption.<br><a href="../README.md">Read the framework and reproduction instructions</a></div></section>`;
  }
  function makePlanningSectionsCollapsible(root) {
    for (const section of root.querySelectorAll("section.panel")) {
      const heading = section.querySelector(":scope > .panel-heading");
      if (!heading) continue;
      const key = section.id || heading.querySelector("h2").textContent;
      const details = document.createElement("details");
      for (const attr of section.attributes) details.setAttribute(attr.name, attr.value);
      details.classList.add("collapsible-panel");
      details.open = planningSectionState.get(key) ?? false;
      const summary = document.createElement("summary");
      summary.className = heading.className;
      summary.append(...heading.childNodes);
      heading.replaceWith(summary);
      details.append(...section.childNodes);
      details.addEventListener("toggle", () => planningSectionState.set(key, details.open));
      section.replaceWith(details);
    }
    for (const details of root.querySelectorAll("details")) details.classList.add("collapsible-panel");
  }
  function render() {
    $("#page-title").textContent = titles[view][0];
    $("#page-subtitle").textContent = titles[view][1];
    $("#main-action").textContent = titles[view][2];
    $("#service-filter").innerHTML = `<option value="all">All services</option>${serviceOptions(serviceFilter)}`;
    $("#service-filter").value = serviceFilter;
    $("#team-filter").innerHTML = `<option value="all">All organizations</option>${[...new Set(state.services.map(s => s.team))].sort().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}`;
    $("#team-filter").value = teamFilter;
    $("#pool-filter").innerHTML = `<option value="all">All GPU SKUs</option>${poolOptions(poolFilter)}`;
    $("#pool-filter").value = poolFilter;
    $("#start-month").value = state.startMonth;
    $("#forecast-start-month").value = state.startMonth;
    $("#forecast-start-form").hidden = view !== "planning";
    forecastSaveStatus(forecastSaveMessage, forecastSaveError);
    $("#workspace-filters").hidden = view === "planning";
    document.querySelectorAll("nav button").forEach(b => {
      b.classList.toggle("active", b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    $("#content").innerHTML = ({overview, inference: inferenceView, benchmarks: benchmarksView, forecasts: forecastsView,
      training: trainingView, capacity: capacityView, planning: planningView, data: dataView})[view]();
    if (view === "planning") makePlanningSectionsCollapsible($("#content"));
    const logic = $("#content .forecast-logic");
    $("#planning-introduction").replaceChildren(...(logic ? [logic] : []));
  }
  function field(name, label, value, type = "number", extra = "", help = "") {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} required>${help ? `<span class="help">${help}</span>` : ""}</label>`;
  }
  function selectField(name, label, options) {
    return `<label>${label}<select name="${name}">${options}</select></label>`;
  }
  function openEditor(kind, id) {
    editContext = {kind, id};
    $("#form-error").textContent = "";
    let fields = "", title = "", intro = "";
    if (kind === "service") {
      const s = state.services.find(s => s.id === id) || {name: "", team: "", pool: "H100-SXM-80GB", gpusPerReplica: 8, rpsPerReplica: 20, annualGrowth: 30, monthlyLaunchRps: 0, headroom: 20, profile: "",
        demandMethod: "historical", benchmarkId: "", workloadKey: "", inputTokens: 1024, outputTokens: 256, drivers: M.defaultDrivers()};
      title = id ? "Configure service profile" : "Register a service";
      intro = "Choose historical-peak growth OR a driver scenario. Historical mode needs consumption history; drivers can plan a new service. Linked profiles must match configuration and token range. Inline values are used only when no library profile is selected.";
      fields = field("name", "Service name", s.name, "text", 'maxlength="150"') + field("team", "Owning team", s.team, "text", 'maxlength="150"') +
        selectField("pool", "GPU SKU", poolOptions(s.pool)) + field("gpusPerReplica", "GPUs per replica", s.gpusPerReplica, "number", 'min="1" max="1024" step="1"') +
        field("rpsPerReplica", "Sustainable RPS per replica at SLO", s.rpsPerReplica, "number", 'min="0.0001" max="1000000000" step="any"') +
        field("annualGrowth", "Annual growth (%) - manual traffic plan or driver-based users", s.annualGrowth, "number", 'min="-90" max="1000" step="any"', "History-based forecasts learn their own trend. Use Adjust the forecast on the main page to change it.") +
        field("monthlyLaunchRps", "Additional peak RPS added each month", s.monthlyLaunchRps, "number", 'min="0" max="1000000000" step="any"', "Separate named initiative assumption; do not include it again in organic growth.") +
        field("headroom", "Spare serving headroom (%)", s.headroom, "number", 'min="0" max="80" step="any"') +
        field("profile", "Inline performance evidence / assumptions", s.profile, "text", 'maxlength="150"') +
        selectField("demandMethod", "Organic demand method", ["historical", "drivers"].map(v => `<option value="${v}" ${s.demandMethod === v ? "selected" : ""}>${v === "historical" ? "Historical peak + annual traffic growth" : "Business demand drivers + annual user growth"}</option>`).join("")) +
        selectField("benchmarkId", "Reusable performance profile", `<option value="">Use inline service assumption</option>${state.benchmarks.map(b => `<option value="${esc(b.id)}" ${s.benchmarkId === b.id ? "selected" : ""}>${esc(b.name)} (${esc(skuName(b.pool))}; ${b.source})</option>`).join("")}`) +
        field("workloadKey", "Configuration key (model/version + precision + runtime + SLO)", s.workloadKey, "text", 'maxlength="150"', "Must exactly match a selected library profile. Do not reuse a key for a different configuration.") +
        field("inputTokens", "Input tokens / request (0 for non-text jobs)", s.inputTokens, "number", 'min="0" max="10000000" step="any"') +
        field("outputTokens", "Output tokens / request (0 for non-text jobs)", s.outputTokens, "number", 'min="0" max="10000000" step="any"') +
        '<h3 class="wide">Demand drivers (used only in driver mode)</h3>' +
        field("activeUsers", "Daily active users at scenario baseline", s.drivers.activeUsers, "number", 'min="0" max="1000000000000" step="1"') +
        field("sessionsPerUser", "Sessions per active user / day", s.drivers.sessionsPerUser, "number", 'min="0" max="1000" step="any"') +
        field("requestsPerSession", "User requests per session", s.drivers.requestsPerSession, "number", 'min="0" max="10000" step="any"') +
        field("callsPerRequest", "Backend model calls per user request", s.drivers.callsPerRequest, "number", 'min="0" max="1000" step="any"') +
        field("cacheHitPct", "Backend calls avoided by cache (%)", s.drivers.cacheHitPct, "number", 'min="0" max="100" step="any"') +
        field("peakToAverage", "Peak-to-average backend traffic ratio", s.drivers.peakToAverage, "number", 'min="1" max="1000" step="any"');
    } else if (kind === "benchmark") {
      const b = state.benchmarks.find(b => b.id === id) || {name: "", pool: "H100-SXM-80GB", workloadKey: "",
        gpusPerReplica: 8, rpsPerReplica: 20, minInputTokens: 0, maxInputTokens: 2048,
        minOutputTokens: 0, maxOutputTokens: 512, measuredOn: new Date().toISOString().slice(0, 10),
        source: "user-benchmark", evidence: ""};
      title = id ? "Edit reusable performance profile" : "Add performance evidence";
      intro = "User-entered measurements are not independently verified. Encode model/version, precision, runtime, batching/concurrency and latency SLO in the configuration key. Changing this shared profile affects all linked services.";
      fields = field("name", "Profile name", b.name, "text", 'maxlength="150"') + selectField("pool", "GPU SKU", poolOptions(b.pool)) +
        field("workloadKey", "Configuration key", b.workloadKey, "text", 'maxlength="150"') +
        field("gpusPerReplica", "GPUs per replica", b.gpusPerReplica, "number", 'min="1" max="1024" step="1"') +
        field("rpsPerReplica", "Sustainable RPS per replica at SLO", b.rpsPerReplica, "number", 'min="0.0001" max="1000000000" step="any"') +
        field("minInputTokens", "Minimum validated input tokens", b.minInputTokens, "number", 'min="0" max="10000000" step="any"') +
        field("maxInputTokens", "Maximum validated input tokens", b.maxInputTokens, "number", 'min="0" max="10000000" step="any"') +
        field("minOutputTokens", "Minimum validated output tokens", b.minOutputTokens, "number", 'min="0" max="10000000" step="any"') +
        field("maxOutputTokens", "Maximum validated output tokens", b.maxOutputTokens, "number", 'min="0" max="10000000" step="any"') +
        field("measuredOn", "Evidence date", b.measuredOn, "date") +
        selectField("source", "Evidence provenance", `<option value="user-benchmark" ${b.source === "user-benchmark" ? "selected" : ""}>User-supplied benchmark (unverified)</option><option value="synthetic" ${b.source === "synthetic" ? "selected" : ""}>Synthetic / illustrative</option>`) +
        field("evidence", "Evidence reference and limits (avoid secrets)", b.evidence, "text", 'maxlength="150"');
    } else if (kind === "consumption") {
      title = "Add daily service consumption";
      intro = "Daily exclusive-GPU allocation summary. An existing row for the same service/date will be explicitly replaced. Keep shared/MIG accounting outside these physical GPU-hour inputs.";
      fields = selectField("serviceId", "Service", serviceOptions(serviceFilter === "all" ? state.services[0].id : serviceFilter)) +
        field("date", "Observation date", latest() || new Date().toISOString().slice(0, 10), "date") +
        field("gpuHours", "Allocated GPU-hours (daily total)", "", "number", 'min="0" max="240000000" step="any"') +
        field("activity", "Reported average GPU activity (%)", "", "number", 'min="0" max="100" step="any"', "Activity while allocated; not measured percentage of peak FLOP/s.") +
        field("peakRps", "Daily peak request rate (RPS)", "", "number", 'min="0" max="1000000000" step="any"') +
        field("requests", "Total requests in the day", "", "number", 'min="0" max="1000000000000000" step="1"');
    } else if (kind === "normalize-inference" || kind === "normalize-training") {
      const workload = kind === "normalize-inference" ? "inference" : "training";
      const item = (workload === "inference" ? state.services : state.training).find(r => r.id === id);
      const existing = item.normalization;
      const performance = workload === "inference" ? M.profileFor(state, item) : null;
      const selectedRate = performance?.available ? performance.rpsPerReplica / performance.gpusPerReplica : existing?.selectedRate ?? "";
      const units = workload === "inference" ? "requests/second/GPU (RPS/GPU) at the same response-time target" : "training tokens/second/GPU";
      const rateUnit = workload === "inference" ? "RPS/GPU" : "tokens/sec/GPU";
      title = `H100 benchmark pair: ${item.name}`;
      intro = `Compare ${skuName(item.pool)} with H100 SXM 80GB for this exact workload. Units: ${units}. Match model, precision and execution configuration; rates are per GPU within full replicas, not a promise of single-GPU fit. Saving records the current configuration.`;
      fields = field("selectedRate", `${skuName(item.pool)} throughput (${rateUnit})`, selectedRate, "number", `min="0.000000001" max="1000000000000" step="any" ${performance?.available ? "readonly" : ""}`) +
        field("referenceRate", `H100 SXM throughput (${rateUnit})`, existing?.referenceRate ?? "", "number", 'min="0.000000001" max="1000000000000" step="any"') +
        field("measuredOn", "Evidence date (before planning starts)", existing?.measuredOn ?? new Date(Date.parse(`${state.startMonth}-01`) - 86400000).toISOString().slice(0, 10), "date") +
        selectField("source", "Evidence source", `<option value="user-benchmark" ${existing?.source !== "synthetic" ? "selected" : ""}>User-supplied benchmark</option><option value="synthetic" ${existing?.source === "synthetic" ? "selected" : ""}>Illustrative example</option>`) +
        field("evidence", "Benchmark evidence / configuration assumptions", existing?.evidence ?? "", "text", 'maxlength="150"');
    } else if (kind === "training") {
      const trainingPool = poolFilter === "all" ? "H200-SXM-141GB" : poolFilter;
      const t = state.training.find(t => t.id === id) || {name: "", serviceId: serviceFilter === "all" ? state.services[0].id : serviceFilter, pool: trainingPool, month: state.startMonth, parametersB: 70, tokensB: 1000, days: 14, peakTflops: "", mfu: 40, memoryGB: M.skuInfo(trainingPool).memoryGB ?? "", bytesPerParameter: 16, block: 256, runs: 1};
      title = id ? "Edit training roadmap input" : "Plan a training run";
      intro = "Dense-transformer pretraining only. Memory is filled from the selected SKU; you may budget less, but not more. Enter dense peak throughput at the intended precision and a supported MFU. No throughput equivalence is assumed between SKUs.";
      fields = field("name", "Plan name", t.name, "text", 'maxlength="150"') + selectField("serviceId", "Owning service", serviceOptions(t.serviceId)) +
        selectField("pool", "GPU SKU", poolOptions(t.pool)) + field("month", "Planned month", t.month, "month") +
        field("parametersB", "Dense parameters (billions)", t.parametersB, "number", 'min="0.001" max="10000" step="any"') +
        field("tokensB", "Total training tokens (billions)", t.tokensB, "number", 'min="0.001" max="10000000" step="any"') +
        field("days", "Active training window (days)", t.days, "number", 'min="0.01" max="31" step="any"') +
        field("runs", "Concurrent runs", t.runs, "number", 'min="1" max="1000" step="1"') +
        field("scenarioGrowthPct", "Extra concurrent runs by month six (%)", t.scenarioGrowthPct ?? 0, "number", 'min="-90" max="300" step="0.1"', "Compounds to the scheduled month; rounds up whole runs. Model size, tokens and days per run stay fixed.") +
        field("peakTflops", "Precision-matched dense peak TFLOP/s / GPU", t.peakTflops, "number", 'min="1" max="100000" step="any"') +
        field("mfu", "Model FLOPs utilization (%)", t.mfu, "number", 'min="1" max="100" step="any"') +
        field("memoryGB", "Memory budget per GPU (decimal GB)", t.memoryGB, "number", `min="1" max="${M.skuInfo(t.pool).memoryGB ?? 10000}" step="any"`) +
        field("bytesPerParameter", "Training-state bytes / parameter", t.bytesPerParameter, "number", 'min="1" max="100" step="any"', "Weights + gradients + optimizer state. Activations/buffers excluded; not proof of fit.") +
        field("block", "Topology rounding block (GPUs)", t.block, "number", 'min="1" max="65536" step="1"');
    } else if (kind === "budgets") {
      title = `GPU budget for ${planningMonth}`;
      intro = "Budget follows P90 forecast need automatically. Enter a count only to override it; leave blank to keep following the forecast. Overrides apply to this month and the selected service/organization scope, not other months. Gap always remains forecasted GPUs minus current allocated GPUs, independent of the budget.";
      const focused = M.capacityForecast(state, serviceFilter, teamFilter, poolFilter).monthly.find(m => m.month === planningMonth);
      fields = focused.pools.map(p => `<h3 class="wide">${esc(skuName(p.pool))}</h3>` + ["inference", "training"].map(kind => `<label>${kind === "inference" ? "Inference" : "Training"} budget (GPUs)<input name="${p.pool}_${kind}" type="number" min="0" max="1000000000" step="1" value="${p[`${kind}BudgetSource`] === "manual" ? p[`${kind}Budget`] : ""}" placeholder="${p[`${kind}Complete`] ? `Forecast: ${p[kind]}` : "Forecast unavailable"}" ${kind === "training" && !state.forecast?.includeTraining && state.forecast ? "disabled" : ""}><span class="help">Blank = follow forecast need. ${p[`${kind}Complete`] ? `Current need: ${fmt(p[kind])}.` : "Partial forecast: enter an explicit target or fix sizing inputs."}</span></label>`).join("")).join("");
    } else if (kind === "capacity") {
      title = "Review current allocated GPUs";
      intro = "Inference is prefilled from recorded service allocations. Training defaults to usable company supply minus inference for each SKU: all remaining usable GPUs are assumed assigned to training. Saved allocation counts are explicit corrections. Counts stay fixed across the horizon and cannot exceed supply at planning start. Clearing a correction restores its default calculation. Future training plans do not determine existing allocations. Previously saved splits remain allocation baselines.";
      fields = M.activePools(state).filter(p => poolFilter === "all" || p === poolFilter).map(p => {
        const have = M.segmentCapacity(state, p);
        return `<h3 class="wide">${esc(skuName(p))}: ${fmt(have.usable)} usable GPUs at planning start</h3>` + ["inference", "training"].map(kind => `<label>Current allocated ${kind} GPUs<input name="${p}_${kind}" type="number" min="0" max="1000000000" step="1" value="${have[kind] ?? ""}"></label>`).join("");
      }).join("");
    } else if (kind === "supply") {
      title = "Edit organization supply";
      intro = "Physical counts by compatible pool. Unavailable and protected reserve are disjoint deductions. This is a scenario, not an inventory connector.";
      fields = M.POOLS.map(p => `<h3 class="wide">${esc(skuName(p))}</h3>` +
        field(`${p}_installed`, "Installed GPUs", state.supply[p].installed, "number", 'min="0" max="10000000" step="1"') +
        field(`${p}_unavailable`, "Unavailable / not commissioned", state.supply[p].unavailable, "number", 'min="0" max="10000000" step="1"') +
        field(`${p}_reserve`, "Protected operational reserve", state.supply[p].reserve, "number", 'min="0" max="10000000" step="1"')).join("");
    } else if (kind === "addition") {
      title = "Plan a commissioned addition";
      intro = "Additional supply is usable from this month onward. Count new usable GPUs, not orders or deliveries awaiting qualification.";
      fields = selectField("pool", "GPU SKU", poolOptions("H200-SXM-141GB")) + field("month", "Usable from month", state.startMonth, "month") +
        field("gpus", "Additional usable GPUs", 8192, "number", 'min="1" max="10000000" step="1"');
    } else if (kind === "remove-training" || kind === "remove-addition" || kind === "reset" || kind === "import") {
      title = kind === "reset" ? "Replace workspace with NVIDIA workload demo?" : kind === "import" ? "Import and replace workspace?" : "Remove this planning input?";
      intro = "This changes the locally saved workspace. Export your current workspace first if you need a backup. This does not change any real infrastructure.";
      if (kind === "import") editContext.imported = id;
      fields = `<p class="description wide">Confirm using Save & recalculate, or cancel to keep your current data.</p>`;
    } else throw new Error("Unknown editor action.");
    $("#editor-title").textContent = title;
    $("#editor-intro").textContent = intro;
    $("#editor-fields").innerHTML = fields;
    $("#editor").showModal();
  }
  function submitEditor(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData($("#editor-form")));
    const {kind, id} = editContext;
    let next = clone();
    try {
      if (kind === "service") {
        const s = {...next.services.find(s => s.id === id), ...values, id: id || `service-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`};
        for (const key of ["gpusPerReplica", "rpsPerReplica", "annualGrowth", "monthlyLaunchRps", "headroom"]) s[key] = Number(values[key]);
        s.drivers = {};
        for (const key of Object.keys(M.defaultDrivers())) {s.drivers[key] = Number(values[key]); delete s[key];}
        s.inputTokens = Number(values.inputTokens); s.outputTokens = Number(values.outputTokens);
        const index = next.services.findIndex(s => s.id === id);
        if (index >= 0) {
          if (next.services[index].pool !== s.pool && next.records.some(r => r.serviceId === id)) {
            throw new Error("Changing the hardware pool of a service with history would relabel that history. Register a separate service/profile for a hardware migration.");
          }
          next.services[index] = s;
        } else next.services.push(s);
      } else if (kind === "benchmark") {
        const b = {...values, id: id || `benchmark-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`};
        for (const key of ["gpusPerReplica", "rpsPerReplica", "minInputTokens", "maxInputTokens", "minOutputTokens", "maxOutputTokens"]) b[key] = Number(values[key]);
        const index = next.benchmarks.findIndex(b => b.id === id);
        if (index >= 0) next.benchmarks[index] = b;
        else next.benchmarks.push(b);
      } else if (kind === "consumption") {
        const r = {...values, source: "user-entered"};
        for (const key of ["gpuHours", "activity", "peakRps", "requests"]) r[key] = Number(values[key]);
        const index = next.records.findIndex(old => old.serviceId === r.serviceId && old.date === r.date);
        if (index >= 0 && !$("#replace-record")) {
          $("#editor-fields").insertAdjacentHTML("beforeend", '<label class="wide"><span>Existing service/date found. Confirm replacing that daily record.</span><input id="replace-record" type="checkbox" required></label>');
          throw new Error("An existing daily record will be replaced. Confirm the checkbox and save again.");
        }
        if (index >= 0) next.records[index] = r;
        else next.records.push(r);
        M.validate(next);
      } else if (kind === "normalize-inference" || kind === "normalize-training") {
        const workload = kind === "normalize-inference" ? "inference" : "training";
        const item = (workload === "inference" ? next.services : next.training).find(r => r.id === id);
        item.normalization = {...values, selectedRate: Number(values.selectedRate), referenceRate: Number(values.referenceRate),
          sku: item.pool, referenceSku: M.NORMALIZATION_REFERENCE, configuration: M.normalizationKey(workload, item)};
      } else if (kind === "training") {
        const t = {...next.training.find(t => t.id === id), ...values, id: id || `training-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`};
        for (const key of ["parametersB", "tokensB", "days", "peakTflops", "mfu", "memoryGB", "bytesPerParameter", "block", "runs", "scenarioGrowthPct"]) t[key] = Number(values[key]);
        const index = next.training.findIndex(t => t.id === id);
        if (index >= 0) next.training[index] = t;
        else next.training.push(t);
      } else if (kind === "budgets") {
        next.segmentBudgets ||= [];
        for (const p of M.activePools(next).filter(p => poolFilter === "all" || p === poolFilter)) {
          const index = next.segmentBudgets.findIndex(b => b.pool === p && b.month === planningMonth && b.serviceId === serviceFilter && b.team === teamFilter);
          const budget = {...next.segmentBudgets[index], pool: p, month: planningMonth, serviceId: serviceFilter, team: teamFilter};
          for (const segment of ["inference", "training"]) {
            const value = values[`${p}_${segment}`];
            if (value === "") delete budget[segment];
            else if (value !== undefined) budget[segment] = Number(value);
          }
          if (index >= 0) next.segmentBudgets.splice(index, 1);
          if (budget.inference !== undefined || budget.training !== undefined) next.segmentBudgets.push(budget);
        }
      } else if (kind === "capacity") {
        for (const p of M.activePools(next).filter(p => poolFilter === "all" || p === poolFilter)) {
          delete next.supply[p].inferenceBudgetPct;
          for (const segment of ["inference", "training"]) {
            const value = values[`${p}_${segment}`];
            if (value === "") delete next.supply[p][`${segment}Available`];
            else next.supply[p][`${segment}Available`] = Number(value);
          }
        }
      } else if (kind === "supply") {
        for (const p of M.POOLS) for (const key of ["installed", "unavailable", "reserve"]) next.supply[p][key] = Number(values[`${p}_${key}`]);
      } else if (kind === "addition") {
        next.supply.additions.push({...values, gpus: Number(values.gpus)});
      } else if (kind === "remove-training") next.training = next.training.filter(t => t.id !== id);
      else if (kind === "remove-addition") next.supply.additions.splice(Number(id), 1);
      else if (kind === "reset") next = M.demo();
      else if (kind === "import") next = editContext.imported;
      M.validate(next);
      if (!save(next, "Workspace saved. All requirements have been recalculated.", ["reset", "import"].includes(kind))) {
        $("#form-error").textContent = "Could not save. See the workspace error notice. Your previous data is unchanged.";
        return;
      }
      if (kind === "consumption" || kind === "import" || kind === "reset") {
        endDate = latest();
        startDate = endDate ? new Date(Date.parse(endDate) - 27 * 86400000).toISOString().slice(0, 10) : "";
        if (!state.services.some(s => s.id === serviceFilter)) serviceFilter = "all";
        if (!state.services.some(s => s.team === teamFilter)) teamFilter = "all";
        if (poolFilter !== "all" && !M.activePools(state).includes(poolFilter)) poolFilter = "all";
        render();
      }
      $("#editor").close();
    } catch (error) {
      $("#form-error").textContent = error.message;
    }
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportWorkspace() {
    download("gpu-atlas-workspace.json", JSON.stringify(state, null, 2), "application/json");
    notice("Workspace JSON exported. It includes inputs and provenance, not live infrastructure state.");
  }
  function exportRequirements() {
    const heads = ["month", "pool", "baselineInference", "inference", "training", "required", "usable", "gap", "inferenceHave", "inferenceHaveSource", "inferenceBudget", "inferenceBudgetSource", "inferenceGap", "trainingHave", "trainingHaveSource", "trainingBudget", "trainingBudgetSource", "trainingGap", "allocationConflict", "budgetRequired", "budgetGap", "inferenceComplete", "trainingComplete", "complete", "missing", "skuName", "memoryGB", "formFactor", "normalizedRequired", "normalizationMissing"];
    const rows = M.bottomUpForecast(state, serviceFilter, teamFilter, poolFilter).monthly.flatMap(m => m.pools).map(r => ({...r, skuName: skuName(r.pool),
      memoryGB: M.skuInfo(r.pool).memoryGB ?? "Unspecified", formFactor: M.skuInfo(r.pool).formFactor}));
    const csv = [heads.join(","), ...rows.map(r => heads.map(h => String(r[h] ?? "")).join(","))].join("\r\n");
    download("gpu-capacity-requirements.csv", csv, "text/csv");
    notice("Forecast CSV exported with your saved adjustments and current filters.");
  }
  function exportCapacityForecast() {
    const forecast = view === "planning" ? M.bottomUpForecast(state, serviceFilter, teamFilter, poolFilter) :
      M.capacityForecast(state, serviceFilter, teamFilter, poolFilter);
    download("gpu-capacity-forecast.json", JSON.stringify({planningStart: state.startMonth,
      filters: {service: serviceFilter, team: teamFilter, pool: poolFilter}, skuCatalog: M.SKU_CATALOG, ...forecast}, null, 2), "application/json");
    notice("Forecast exported with model evidence, monthly demand, supply and your adjustments.");
  }
  function exportForecasts() {
    const evidence = chosenServices().map(s => ({serviceId: s.id, serviceName: s.name,
      evidence: M.forecastEvidence(state, s.id)}));
    download("gpu-forecast-evidence.json", JSON.stringify({horizon: "One-day-ahead peak RPS", planningStart: state.startMonth, evidence}, null, 2), "application/json");
    notice("Forecast evidence exported with split scores, predictions and unavailable-data reasons.");
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-planning-root")) {serviceFilter = "all"; teamFilter = "all"; poolFilter = "all"; render();}
    else if (button.dataset.drillOrg) {teamFilter = button.dataset.drillOrg; serviceFilter = "all"; render();}
    else if (button.dataset.drillService) {serviceFilter = button.dataset.drillService; render();}
    else if (button.dataset.calibrateKind) openEditor(`normalize-${button.dataset.calibrateKind}`, button.dataset.calibrateId);
    else if (button.dataset.view) {view = button.dataset.view; render();}
    else if (button.dataset.service) {serviceFilter = button.dataset.service; render();}
    else if (button.dataset.editService) openEditor("service", button.dataset.editService);
    else if (button.dataset.editBenchmark) openEditor("benchmark", button.dataset.editBenchmark);
    else if (button.dataset.editTraining) openEditor("training", button.dataset.editTraining);
    else if (button.dataset.removeTraining) openEditor("remove-training", button.dataset.removeTraining);
    else if (button.hasAttribute("data-remove-addition")) openEditor("remove-addition", button.dataset.removeAddition);
    else if (button.dataset.action) openEditor(button.dataset.action);
    else if (button.hasAttribute("data-export-workspace")) exportWorkspace();
    else if (button.hasAttribute("data-export-requirements")) exportRequirements();
    else if (button.hasAttribute("data-reset-budgets")) {
      const next = clone();
      next.segmentBudgets = (next.segmentBudgets || []).filter(b => !(b.month === planningMonth &&
        b.serviceId === serviceFilter && b.team === teamFilter && (poolFilter === "all" || b.pool === poolFilter)));
      save(next, "Budgets reset to follow the forecast for this month and selected scope.");
    }
    else if (button.hasAttribute("data-reset-forecast")) {
      const next = clone(); next.forecast = M.defaultForecast();
      save(next, "Forecast adjustments reset. Service plans are unchanged.");
    }
    else if (button.dataset.granularity) {weekly = button.dataset.granularity === "weekly"; render();}
  });
  document.addEventListener("dblclick", event => {
    if (event.target.closest("button,input,select")) return;
    const org = event.target.closest("[data-org-row]");
    const model = event.target.closest("[data-model-row]");
    const plan = event.target.closest("[data-training-row]");
    if (org) {teamFilter = org.dataset.orgRow; serviceFilter = "all"; render();}
    else if (model) {serviceFilter = model.dataset.modelRow; render();}
    else if (plan) openEditor("training", plan.dataset.trainingRow);
  });
  document.addEventListener("input", event => {
    if (event.target.matches("[data-service-growth]")) previewServiceGrowth(event.target, false);
    else if (event.target.matches("[data-training-growth]")) {
      forecastSaveStatus("Unsaved changes. Finish editing or click Save forecast.");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target.matches("[data-service-growth]")) {
      event.preventDefault(); event.target.blur();
    }
  });
  document.addEventListener("dragstart", event => {
    const card = event.target.closest("[data-training-drag]");
    if (!card || event.target.closest("input,select,button")) return;
    event.dataTransfer.setData("application/x-gpu-atlas-training", card.dataset.trainingDrag);
    event.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", event => {
    const lane = event.target.closest("[data-training-drop]");
    if (lane && Array.from(event.dataTransfer.types).includes("application/x-gpu-atlas-training")) {
      event.preventDefault(); event.dataTransfer.dropEffect = "move"; lane.classList.add("drop-target");
    }
  });
  document.addEventListener("dragleave", event => {
    const lane = event.target.closest("[data-training-drop]");
    if (lane && !lane.contains(event.relatedTarget)) lane.classList.remove("drop-target");
  });
  document.addEventListener("dragend", () => document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target")));
  document.addEventListener("drop", event => {
    const lane = event.target.closest("[data-training-drop]");
    if (!lane) return;
    event.preventDefault(); lane.classList.remove("drop-target");
    const id = event.dataTransfer.getData("application/x-gpu-atlas-training");
    if (!id) {notice("Drop a training card from this workspace.", true); return;}
    rescheduleTraining(id, lane.dataset.trainingDrop);
  });
  document.addEventListener("submit", event => {
    if (event.target.id === "forecast-start-form") {
      event.preventDefault();
      if (!event.target.reportValidity()) return;
      const next = clone();
      next.startMonth = $("#forecast-start-month").value;
      if (!save(next, `Forecast started for ${next.startMonth}. Showing all services for six months.`, false, false)) return;
      serviceFilter = "all"; teamFilter = "all"; poolFilter = "all";
      planningMonth = next.startMonth;
      render();
      return;
    }
    if (event.target.id !== "forecast-controls") return;
    event.preventDefault();
    const values = new FormData(event.target);
    const next = clone();
    next.forecast = {trafficAdjustmentPct: Number(values.get("trafficAdjustmentPct")),
      throughputChangePct: Number(values.get("throughputChangePct")),
      includeLaunches: values.has("includeLaunches"), includeTraining: values.has("includeTraining")};
    save(next, "Forecast updated and saved. The base forecast is unchanged.");
  });
  document.addEventListener("change", async event => {
    const input = event.target;
    if (input.matches("[data-service-growth]")) previewServiceGrowth(input, true);
    else if (input.matches("[data-training-growth]")) {
      if (!input.checkValidity()) {
        input.reportValidity();
        notice("Training growth not applied. Enter -90% to +300% in steps of 0.1%.", true);
        return;
      }
      const next = clone();
      next.training.find(t => t.id === input.dataset.trainingGrowth).scenarioGrowthPct = Number(input.value);
      save(next, "Training run growth saved. Inference inputs are unchanged.");
    }
    else if (input.dataset.trainingMonth) rescheduleTraining(input.dataset.trainingMonth, input.value);
    else if (input.id === "service-filter") {serviceFilter = input.value; render();}
    else if (input.name === "pool" && editContext?.kind === "training") {
      const hardware = M.skuInfo(input.value);
      const memory = $("#editor-fields [name=memoryGB]");
      memory.value = hardware.memoryGB ?? "";
      memory.max = hardware.memoryGB ?? 10000;
      $("#editor-fields [name=peakTflops]").value = "";
      $("#editor-intro").textContent = "SKU changed. Memory was updated; enter the dense peak TFLOP/s for this SKU and precision before saving.";
    }
    else if (input.id === "team-filter") {teamFilter = input.value; render();}
    else if (input.id === "pool-filter") {poolFilter = input.value; render();}
    else if (input.id === "start-month") {
      const next = clone(); next.startMonth = input.value;
      if (!save(next, "Planning horizon updated.")) render();
    } else if (input.id === "date-from" || input.id === "date-to") {
      const from = $("#date-from").value, to = $("#date-to").value;
      try {
        M.date(from); M.date(to);
        if (from > to) throw new Error("Start date must not follow end date.");
        startDate = from; endDate = to; render();
      } catch (error) {notice(error.message, true);}
    } else if (input.id === "import-file") {
      try {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw new Error("Workspace file exceeds 20 MB.");
        const imported = M.validate(JSON.parse(await file.text()));
        openEditor("import", imported);
      } catch (error) {notice(`Import rejected: ${error.message}`, true);}
      finally {input.value = "";}
    }
  });
  $("#save-forecast").addEventListener("click", () => {
    const invalid = [...document.querySelectorAll("[data-service-growth],[data-training-growth]")]
      .find(input => !input.checkValidity());
    if (invalid) {
      invalid.closest("details")?.setAttribute("open", "");
      invalid.reportValidity();
      forecastSaveStatus("Unsaved changes. Correct the invalid growth input before saving.", true);
      notice("Forecast not saved: correct the invalid growth input.", true);
      return;
    }
    if ($("#forecast-start-month").value !== state.startMonth) {
      forecastSaveStatus("Selected month not applied. Click Start forecast before saving.", true);
      notice("Click Start forecast to apply the selected month before saving.", true);
      return;
    }
    save(clone(), "Forecast saved. Reopen this page in the same browser to continue editing.", false, false);
  });
  $("#main-action").addEventListener("click", () => {
    if (view === "capacity" || view === "planning") exportCapacityForecast();
    else if (view === "forecasts") exportForecasts();
    else if (view === "benchmarks") openEditor("benchmark");
    else if (view === "data") exportWorkspace();
    else openEditor({overview: "consumption", inference: "service", training: "training"}[view]);
  });
  $("#export").addEventListener("click", exportWorkspace);
  $(".brand").addEventListener("click", event => {event.preventDefault(); view = "planning"; render();});
  $("#editor-form").addEventListener("submit", submitEditor);
  $("#close-editor").addEventListener("click", () => $("#editor").close());
  $("#cancel-editor").addEventListener("click", () => $("#editor").close());
  render();
  if (initialError) notice(initialError, storageBlocked);
})();
