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
  try {
    const saved = localStorage.getItem(KEY);
    const parsed = saved ? JSON.parse(saved) : null;
    state = parsed ? M.validate(parsed) : M.demo();
    if (parsed?.version === 1) initialError = "Your version-1 workspace has been upgraded in memory. Existing historical-growth calculations are preserved. Save an input or export to retain the new format; the original stored copy is unchanged until you save.";
  } catch (error) {
    state = M.demo();
    storageBlocked = true;
    initialError = `Saved workspace could not be loaded: ${error.message} Showing a demo preview only. Export/repair the saved data outside this portal, import a valid workspace, or explicitly reset the demo. No data has been overwritten.`;
  }
  let view = "capacity";
  let serviceFilter = "all";
  let teamFilter = "all";
  let poolFilter = "all";
  let weekly = false;
  const latest = () => state.records.length ? [...state.records].sort((a, b) => a.date.localeCompare(b.date)).at(-1).date : "";
  let endDate = latest();
  let startDate = endDate ? new Date(Date.parse(endDate) - 27 * 86400000).toISOString().slice(0, 10) : "";
  let editContext = null;
  const titles = {
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
  function save(next, message, override = false) {
    try {
      if (storageBlocked && !override) throw new Error("Saving is blocked because stored data could not be loaded. Import a valid workspace or explicitly reset.");
      next = M.validate(next);
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next;
      storageBlocked = false;
      $("#save-state").textContent = "Saved in this browser";
      render();
      notice(message);
      return true;
    } catch (error) {
      notice(`Not saved: ${error.message}`, true);
      return false;
    }
  }
  const clone = () => JSON.parse(JSON.stringify(state));
  const chosenServices = () => state.services.filter(s =>
    (serviceFilter === "all" || s.id === serviceFilter) && (teamFilter === "all" || s.team === teamFilter) &&
    (poolFilter === "all" || s.pool === poolFilter));
  const selectedRecords = () => {
    const ids = new Set(chosenServices().map(s => s.id));
    return state.records.filter(r => ids.has(r.serviceId));
  };
  const poolOptions = selected => M.POOLS.map(p => `<option ${p === selected ? "selected" : ""}>${p}</option>`).join("");
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
      let connected = false;
      const path = points.map((p, i) => {
        if (!Number.isFinite(p[s.key])) {connected = false; return "";}
        const segment = `${connected ? "L" : "M"}${x(i)},${y(p[s.key])}`;
        connected = true;
        return segment;
      }).join(" ");
      return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dashed ? 'stroke-dasharray="6 5"' : ""}/>` +
        points.map((p, i) => Number.isFinite(p[s.key]) ? `<circle cx="${x(i)}" cy="${y(p[s.key])}" r="${points.length < 10 ? 3 : 1.5}" fill="${s.color}"><title>${esc(p.date || p.month)} · ${esc(s.name)}: ${fmt(p[s.key], 1)}</title></circle>` : "").join("");
    }).join("");
    const labels = (forecastStart !== null ? points.map((_, i) => i) : [...new Set([0, Math.floor(points.length / 2), points.length - 1])]).map(i =>
      `<text x="${x(i)}" y="${h - 9}" text-anchor="middle">${esc(points[i].date || points[i].month)}</text>`).join("");
    const boundary = forecastStart === null ? "" : (() => {
      const edge = forecastStart ? (x(forecastStart - 1) + x(forecastStart)) / 2 : left;
      return `<rect x="${edge}" y="${top}" width="${w - right - edge}" height="${h - top - bottom}" fill="#8daaff" opacity=".045"/><line x1="${edge}" x2="${edge}" y1="${top}" y2="${h - bottom}" stroke-dasharray="4 5"/><text x="${edge + 8}" y="16">FORECAST</text>`;
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
      return `<tr><td><button class="text-button service-name" data-service="${esc(s.id)}">${esc(s.name)}</button><span class="subtext">${esc(s.team)}</span></td><td><span class="badge">${esc(s.pool)}</span></td><td>${fmt(hours)}</td><td>${history.length ? fmt(hours / history.length / 24) : "No data"}</td><td>${pct(change)}<span class="subtext">First vs last observed day</span></td><td>${history.length} days</td><td><button class="text-button" data-edit-service="${esc(s.id)}">Edit profile</button></td></tr>`;
    }).join("");
    const maxHours = Math.max(1, ...chosenServices().map(s => rows.filter(r => r.serviceId === s.id).reduce((n, r) => n + r.gpuHours, 0)));
    const bars = chosenServices().map((s, i) => {
      const hours = rows.filter(r => r.serviceId === s.id).reduce((n, r) => n + r.gpuHours, 0);
      return `<div class="bar-row"><div class="bar-heading"><span>${esc(s.name)}</span><span>${compact(hours)} h</span></div><div class="bar-track"><div class="bar-fill" style="width:${hours / maxHours * 100}%;background:${i % 2 ? "var(--blue)" : "var(--green)"}"></div></div></div>`;
    }).join("");
    return `<div class="kpis">${metric("Allocated GPU-hours", fmt(gpuHours), "Physical allocation time · selected dates", true)}${metric("Average allocated GPUs", days ? fmt(gpuHours / days / 24) : "No data", "Aggregate per observed day; inspect coverage")}${metric("Allocation-weighted activity", activity === null ? "No data" : `${fmt(activity, 1)}%`, "Reported daily activity; not measured FLOP/s")}${metric("Year-over-year allocation", pct(yoy), yoy === null ? "Requires complete comparable history" : "Same dates one year earlier")}</div>
      <div class="grid-two"><section class="panel"><div class="panel-heading"><div><h2>Consumption over time</h2><p>Average allocated GPUs per observed day · ${weekly ? "weekly buckets (edges may be partial)" : "daily buckets"}</p></div><div class="segmented"><button data-granularity="daily" class="${!weekly ? "selected" : ""}">Daily</button><button data-granularity="weekly" class="${weekly ? "selected" : ""}">Weekly</button></div></div>
      <div class="panel-body"><div class="data-tools"><label class="help">From <input aria-label="Consumption start date" id="date-from" type="date" value="${esc(startDate)}"></label><label class="help">To <input aria-label="Consumption end date" id="date-to" type="date" value="${esc(endDate)}"></label></div></div>
      <div class="chart-wrap">${chart(points, [{key: "averageAllocated", name: "Average allocated GPUs", color: "#b7ef6a"}], "Allocated GPU trend for selected services and dates")}</div>
      <div class="panel-body"><details><summary>View exact trend values</summary>${table(["Period", "Observed days", "GPU-hours", "Average GPUs"], points.map(p => `<tr><td>${p.date}</td><td>${p.observedDays}</td><td>${fmt(p.gpuHours)}</td><td>${fmt(p.averageAllocated, 1)}</td></tr>`).join(""))}</details></div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Service contribution</h2><p>Allocated GPU-hours · selected window</p></div></div><div class="panel-body">${bars || "No matching services."}</div></section></div>
      <section class="panel"><div class="panel-heading"><div><h2>Service consumption ledger</h2><p>Click a service to focus the workspace. Resource counts remain hardware-specific in planning.</p></div><button class="button subtle" data-action="service">+ Service</button></div>${table(["Service / team", "GPU pool", "GPU-hours", "Avg GPUs", "Period change", "Coverage", ""], serviceRows)}</section>
      <div class="callout info">Two-year cumulative change: <strong>${pct(twoYear)}</strong> · Two-year annualized: <strong>${twoYear === null ? "Not available" : pct(((1 + twoYear / 100) ** 0.5 - 1) * 100)}</strong>. Comparisons require complete matching daily coverage. History is synthetic unless explicitly entered by you. No live telemetry is connected.</div>`;
  }
  function inferenceView() {
    const services = chosenServices();
    const months = M.months(state.startMonth);
    const rows = services.map(s => {
      const base = M.baseline(state, s.id);
      const first = M.inference(state, s, 0), last = M.inference(state, s, 5);
      const performance = M.profileFor(state, s);
      return `<tr><td class="service-name">${esc(s.name)}<span class="subtext">${esc(s.team)}</span></td><td>${esc(s.pool)}</td><td>${base ? fmt(base.peakRps) : "No baseline"}<span class="subtext">${base ? `${base.days}/28 days · through ${base.end}` : "Driver scenarios can work without history"}</span></td><td>${s.demandMethod === "drivers" ? "User demand drivers" : "Historical peak growth"}<span class="subtext">${pct(s.annualGrowth)} annual ${s.demandMethod === "drivers" ? "user" : "traffic"} growth assumption</span></td><td>${performance.available ? `${performance.gpusPerReplica} GPUs / ${fmt(performance.rpsPerReplica, 2)} RPS` : "Incompatible profile"}<span class="subtext">${esc(performance.available ? performance.name : performance.reason)}</span></td><td>${fmt(first.gpus)}</td><td class="accent">${fmt(last.gpus)}</td><td><button class="text-button" data-edit-service="${esc(s.id)}">Configure</button></td></tr>`;
    }).join("");
    const projection = months.map((m, i) => ({month: m, gpus: services.reduce((n, s) => n + (M.inference(state, s, i).gpus || 0), 0)}));
    const incomplete = services.some(s => !M.inference(state, s, 0).available);
    const decomposition = services.map(s => {
      const e = M.inference(state, s, 5);
      return `<tr><td>${esc(s.name)}</td><td>${s.demandMethod === "drivers" ? "DAU × sessions × requests × calls × cache misses × peak ratio" : "Recorded peak × compounded annual traffic growth"}</td><td>${fmt(e.organicRps, 1)}</td><td>${fmt(e.launchRps, 1)}</td><td>${fmt(e.peakRps, 1)}</td><td>${esc(e.available ? "Scenario inputs available" : e.reason)}</td></tr>`;
    }).join("");
    return `<div class="callout info">The chart here is a manual scenario using entered annual growth or user-based inputs. <strong>Capacity forecast learns its own traffic trend.</strong> Launch and performance inputs here are shared with that forecast; annual growth only drives this manual chart or a user-based service plan. ${incomplete ? "<strong>Some service inputs are missing.</strong>" : ""} <button class="text-button" data-view="capacity">Open capacity forecast</button></div>
      <section class="panel"><div class="panel-heading"><div><h2>Manual serving scenario</h2><p>Compare an entered growth assumption with the history-based forecast.</p></div></div><div class="chart-wrap">${chart(projection, [{key: "gpus", name: "Inference GPUs", color: "#8daaff"}], "Monthly manual serving GPU scenario")}</div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Service performance & growth profiles</h2><p>Configure demand method, drivers, configuration key, token mix and optional reusable benchmark.</p></div></div>${table(["Service", "Pool", "Baseline peak RPS", "Demand method", "Replica profile", months[0], months[5], ""], rows)}</section>
      <section class="panel"><div class="panel-heading"><div><h2>Month-six demand decomposition</h2><p>Organic demand and named launch increments are separate to prevent double counting.</p></div></div>${table(["Service", "Organic demand logic", "Organic peak RPS", "Launch RPS", "Total peak RPS", "Input status"], decomposition)}</section>
      <section class="panel"><div class="panel-heading"><h2>Calculation contract</h2></div><div class="panel-body description"><strong>Historical mode:</strong> baseline peak × (1 + annual traffic growth)^(months / 12).<br><strong>Driver mode:</strong> daily active users × compounded user growth × sessions/user/day × requests/session × backend calls/request × (1 − cache hit fraction) × peak-to-average ratio / 86,400.<br>Add cumulative launch RPS once, after either organic calculation. The two demand methods are alternatives, not additive.<br><strong>Replicas</strong> = ceil(peak RPS / (1 − spare headroom fraction) / sustainable RPS per replica).<br><strong>GPUs</strong> = replicas × GPUs per replica. Selected library profiles must match the pool, workload key and token range; there is no silent fallback to inline throughput.<br>One-day backtests in Forecast evidence do not validate or replace these six-month scenarios. Queueing, memory/KV-cache fit and statistical uncertainty remain unmodeled.</div></section>`;
  }
  function benchmarksView() {
    const services = chosenServices();
    const relevant = new Set(services.map(s => s.workloadKey));
    const profiles = state.benchmarks.filter(b => (poolFilter === "all" || b.pool === poolFilter) &&
      ((serviceFilter === "all" && teamFilter === "all") || relevant.has(b.workloadKey)));
    return `<div class="callout">Profiles are explicit configurations, not universal hardware speeds. A workload key must encode the model/version, precision, serving engine, batching/concurrency and latency SLO. Token ranges are user-attested validity bounds, not automatically verified measurements.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Reusable RPS-at-SLO profiles</h2><p>Select a profile in a service's Configure form. Inline assumptions remain available for existing services.</p></div></div>${table(["Profile / configuration", "Pool", "Replica throughput", "Input / output range", "Evidence", "Date", ""], profiles.map(b => `<tr><td class="service-name">${esc(b.name)}<span class="subtext">${esc(b.workloadKey)}</span></td><td>${b.pool}</td><td>${b.gpusPerReplica} GPUs / ${fmt(b.rpsPerReplica, 2)} RPS</td><td>${fmt(b.minInputTokens)}–${fmt(b.maxInputTokens)} in<br>${fmt(b.minOutputTokens)}–${fmt(b.maxOutputTokens)} out</td><td><span class="badge ${b.source === "synthetic" ? "" : "green"}">${b.source === "synthetic" ? "Synthetic" : "User-supplied benchmark"}</span><span class="subtext">${esc(b.evidence)}</span></td><td>${b.measuredOn}</td><td><button class="text-button" data-edit-benchmark="${esc(b.id)}">Edit</button></td></tr>`).join(""))}</section>
      <div class="callout info">No interpolation, extrapolation or automatic substitution is performed. A mismatched pool/key or out-of-range token mix makes the service requirement unavailable and portfolio totals partial. Editing a shared profile recalculates every linked service. User-supplied evidence is not independently verified.</div>`;
  }
  function forecastsView() {
    const evidence = chosenServices().map(s => ({service: s, result: M.forecastEvidence(state, s.id)}));
    const rows = evidence.map(({service: s, result: e}) => e.available ? e.scored.map(r => `<tr><td>${esc(s.name)}<span class="subtext">${esc(e.source)} · ${e.evaluationDays} folds</span></td><td>${r.method}${r.method === e.selected ? ' <span class="badge green">Selected</span>' : ""}</td><td>${fmt(r.validation.mae, 1)}</td><td>${fmt(r.heldOut.mae, 1)}</td><td>${r.heldOut.wape === null ? "Not available" : `${fmt(r.heldOut.wape * 100, 1)}%`}</td><td>${fmt(r.heldOut.bias, 1)}</td><td>${r.validation.days} / ${r.heldOut.days}</td></tr>`).join("") :
      `<tr><td>${esc(s.name)}</td><td colspan="6">${esc(e.reason)} Eligible evaluation days: ${e.evaluationDays}.</td></tr>`).join("");
    const plots = evidence.filter(({result}) => result.available).map(({service: s, result: e}) =>
      `<section class="panel"><div class="panel-heading"><div><h2>${esc(s.name)}: held-out daily peak</h2><p>${e.selected} selected on earlier validation MAE · next observed-day prediction for ${e.nextDate}: ${fmt(e.nextPeakRps, 1)} RPS${e.nextPeakRps === null ? " (recent history incomplete)" : ""}</p></div></div><div class="panel-body"><div class="legend"><span><i></i>Actual peak RPS</span><span><i class="blue"></i>One-day-ahead prediction</span></div></div><div class="chart-wrap">${chart(e.predictions.slice(-28), [{key: "actual", name: "Actual peak RPS", color: "#b7ef6a"}, {key: "predicted", name: "Predicted peak RPS", color: "#8daaff"}], `${s.name}: held-out actual and predicted daily peak RPS`)}</div></section>`).join("");
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
      const result = M.training(t);
      const service = state.services.find(s => s.id === t.serviceId);
      const slow = M.training({...t, mfu: Math.max(1, t.mfu * 0.8)});
      const fast = M.training({...t, mfu: Math.min(100, t.mfu * 1.2)});
      return `<article class="plan-card"><span class="badge">${esc(t.pool)} · ${esc(t.month)}</span><h3>${esc(t.name)}</h3><span class="help">${esc(service.name)} · dense pretraining</span><div class="big-number">${fmt(result.totalGpus)} GPUs</div><span class="help">${fmt(result.gang)} per run × ${t.runs} concurrent runs</span>
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
      <section class="panel"><div class="panel-heading"><h2>From model plan to resource envelope</h2></div><div class="panel-body description">Compute GPU count = ceil(model FLOPs / (active seconds × dense peak FLOP/s per GPU × MFU)).<br>Training-state memory screen = ceil(parameters × bytes per parameter / memory per GPU).<br>Gang size = the larger compute/memory requirement, rounded up to your topology block.<br>All entered runs in a month are treated as concurrent for peak planning. This is intentionally conservative, not a calendar-placement optimizer. GPU-hours use the reserved time window, not a claim of actual execution.<br>MFU must match the arithmetic precision and hardware configuration. Default FLOP/s, memory and training-state assumptions are illustrative; replace them with validated profiles.</div></section>`;
  }
  function requirementRows() {
    return M.capacityForecast(state, serviceFilter, teamFilter, poolFilter).monthly.flatMap(m => m.pools);
  }
  function capacityView() {
    const forecast = M.capacityForecast(state, serviceFilter, teamFilter, poolFilter);
    const rows = forecast.monthly.flatMap(m => m.pools);
    const options = forecast.options;
    const last = forecast.monthly.at(-1);
    const firstGap = rows.find(r => r.gap > 0);
    const ready = forecast.services.filter(e => e.available).length;
    const complete = ready === forecast.services.length && ready > 0;
    const points = [...forecast.historical, ...forecast.monthly.map(m => ({month: m.month,
      baseline: m.complete && ready ? m.baselineRequired : null, planned: m.complete && ready ? m.required : null, usable: m.usable}))];
    const historyCount = forecast.services.filter(e => e.demand.source === "history").length;
    const names = {linear_trend: "Learned weekly trend", recent_average: "Recent average + weekday pattern", drivers: "Entered user plan"};
    const serviceRows = forecast.services.map(e => {
      const first = e.demand.monthly?.[0], end = e.demand.monthly?.at(-1);
      return `<tr><td class="service-name">${esc(e.service.name)}<span class="subtext">${esc(e.service.team)} / ${e.service.pool}</span></td><td>${esc(e.available ? names[e.demand.method] : e.reason)}</td><td>${e.history.observedDays || 0} days<span class="subtext">${e.history.lastDate ? `Through ${e.history.lastDate}` : "No history"}${e.history.gapDays > 14 ? ` / ${e.history.gapDays}-day gap before plan` : ""}</span></td><td>${e.demand.source === "history" && e.history.selectedWape !== null ? `${fmt(e.history.selectedWape * 100, 1)}%` : "Not available"}</td><td>${first && end ? pct(M.growth(end.peakRps, first.peakRps)) : "Not available"}</td><td><button class="text-button" data-edit-service="${esc(e.service.id)}">Edit service plan</button></td></tr>`;
    }).join("");
    return `<div class="forecast-intro"><span class="badge green">HISTORY-BASED FORECAST</span><p>${historyCount} service${historyCount === 1 ? "" : "s"} learned from recorded traffic. User-based plans cover services without a traffic forecast.</p></div>
      <div class="kpis">${metric(`GPUs needed in ${last.month}`, ready ? fmt(last.required) : "Not available", complete ? "With your plans and adjustments" : "Partial estimate - check service coverage", true)}${metric("Change from base forecast", ready ? pct(M.growth(last.required, last.baselineRequired)) : "Not available", "Traffic changes, serving improvements and training")}${metric("First pool shortage", firstGap ? firstGap.month : complete ? "None forecast" : "Unknown", firstGap ? `${firstGap.pool}: ${fmt(firstGap.gap)} GPUs short${!firstGap.complete ? " (partial demand)" : ""}` : "Check each GPU type, not just the fleet total")}${metric("Services forecast", `${ready} / ${forecast.services.length}`, complete ? "All selected services have sizing inputs" : "Missing history or performance evidence")}</div>
      ${!complete ? '<div class="callout">Some services cannot be forecast. Known demand remains in the table; incomplete totals are not plotted as a complete forecast. Add history or explicitly configure a user-based plan.</div>' : ""}
      <div class="forecast-layout"><section class="panel forecast-main"><div class="panel-heading"><div><h2>GPU demand forecast</h2><p>See how your plans change the forecast over the next six months.</p></div><span class="badge">${state.startMonth} to ${last.month}</span></div>
        <div class="panel-body"><div class="legend"><span><i class="gray"></i>Historical assigned GPUs</span><span><i></i>Base serving forecast</span><span><i class="blue"></i>With my plans</span><span><i class="amber"></i>Available GPUs</span></div></div>
        <div class="chart-wrap">${chart(points, [{key: "actual", name: "Historical daily assigned GPUs (monthly maximum)", color: "#a7b3c5"}, {key: "baseline", name: "Base serving forecast", color: "#b7ef6a"}, {key: "planned", name: "With my plans", color: "#8daaff"}, {key: "usable", name: "Available GPUs", color: "#f2bd6d", dashed: true}], "Historical GPU assignments and six-month demand forecast", forecast.historical.length)}</div>
        <div class="panel-body description">History shows the highest daily average assigned GPUs in each observed month. Future demand uses the busiest predicted day, converted through each service's serving performance. Training appears in the plan, not the base serving line. Pool shortages below take priority over the fleet total.</div></section>
      <section class="panel forecast-controls"><div class="panel-heading"><div><h2>Adjust the forecast</h2><p>Workspace-wide changes, applied to selected views.</p></div></div><form id="forecast-controls" class="panel-body">
        <label>Traffic above / below forecast (%)<input name="trafficAdjustmentPct" type="number" min="-90" max="300" step="any" value="${options.trafficAdjustmentPct}" required><span class="help">+20 means 20% more traffic than the learned forecast.</span></label>
        <label>Serving throughput change (%)<input name="throughputChangePct" type="number" min="-50" max="300" step="any" value="${options.throughputChangePct}" required><span class="help">+20 means each GPU group handles 20% more requests.</span></label>
        <label class="check-option"><input name="includeLaunches" type="checkbox" ${options.includeLaunches ? "checked" : ""}> Include planned launches</label>
        <label class="check-option"><input name="includeTraining" type="checkbox" ${options.includeTraining ? "checked" : ""}> Include training roadmap</label>
        <button class="button primary" type="submit">Update forecast</button><button class="text-button" type="button" data-reset-forecast>Reset adjustments</button>
        <div class="forecast-links"><button class="text-button" type="button" data-view="training">Edit training plans</button><button class="text-button" type="button" data-action="addition">Add future GPUs</button></div>
      </form></section></div>
      <section class="panel"><div class="panel-heading"><div><h2>Where will capacity run short?</h2><p>Positive gap = GPUs to add or demand to move. Supply is shared company capacity.</p></div><button class="button subtle" data-export-requirements>Download CSV</button></div>${table(["Month", "GPU type", "Base serving", "Planned serving", "Training", "Total planned", "Available", "Gap / spare", "Status"], rows.map(r => `<tr><td>${r.month}</td><td>${r.pool}</td><td>${fmt(r.baselineInference)}</td><td>${fmt(r.inference)}</td><td>${fmt(r.training)}</td><td>${fmt(r.required)}</td><td>${fmt(r.usable)}</td><td>${r.gap > 0 ? "+" : ""}${fmt(r.gap)}</td><td><span class="badge ${!r.complete || r.gap > 0 ? "red" : "green"}">${!r.complete ? "Partial inputs" : r.gap > 0 ? "Shortage" : "Within supply"}</span></td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>What is driving the forecast?</h2><p>Compare a recent average with a learned weekly trend. Pick the lower-error method on 14 later days, then refit with all recent history.</p></div><button class="button subtle" data-action="consumption">Add service history</button></div>${table(["Service / GPU type", "Forecast method", "History used", "Model selection error", "First to last forecast month", ""], serviceRows)}
      <div class="panel-body description">Up to 84 consecutive daily records are used; at least 42 are needed. Both methods learn weekday patterns. The 14-day selection error is not a six-month accuracy score. Gaps between the latest record and planning start are forecast forward, not filled with zero. Manual annual traffic growth is kept in Service plans; it does not set the learned trend.</div></section>`;
  }
  function dataView() {
    const synthetic = state.records.filter(r => r.source === "synthetic").length;
    return `<div class="callout">This is a browser-local scenario workspace, not a live company telemetry feed. ${synthetic} of ${state.records.length} consumption rows are synthetic. User-entered rows are manual observations, not verified connector measurements. No data is sent to a backend.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Supply by compatible GPU pool</h2><p>Supply = installed − unavailable − protected reserve + additions from their commissioning month.</p></div><button class="button subtle" data-action="supply">Edit supply</button></div>${table(["Pool", "Installed", "Unavailable", "Protected reserve", "Base usable"], M.POOLS.map(p => {const s = state.supply[p]; return `<tr><td>${p}</td><td>${fmt(s.installed)}</td><td>${fmt(s.unavailable)}</td><td>${fmt(s.reserve)}</td><td>${fmt(s.installed - s.unavailable - s.reserve)}</td></tr>`;}).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>Commissioned additions</h2><p>Capacity becomes usable at the start of the selected month; readiness is a user assumption.</p></div><button class="button subtle" data-action="addition">+ Addition</button></div>${table(["Pool", "Available from", "GPUs", ""], state.supply.additions.map((a, i) => `<tr><td>${a.pool}</td><td>${a.month}</td><td>${fmt(a.gpus)}</td><td><button class="text-button" data-remove-addition="${i}">Remove</button></td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><h2>Workspace portability</h2></div><div class="panel-body"><p class="description">Version-2 exports include service profiles, demand drivers, reusable performance evidence, daily records, training plans and supply assumptions. Version-1 workspaces retain historical sizing and inline throughput when upgraded. Import replaces this workspace after validation and confirmation. Local storage is scoped to this browser/location, not shared across users. Do not enter sensitive information on a shared device.</p><div class="data-tools"><button class="button subtle" data-export-workspace>Export JSON</button><label class="button subtle">Import JSON <input type="file" id="import-file" accept=".json,application/json"></label><button class="button subtle" data-action="reset">Reset to demo</button></div></div></section>
      <section class="panel"><div class="panel-heading"><h2>How the forecast uses these inputs</h2></div><div class="panel-body description">Capacity forecast learns a recent average or weekly trend from up to 84 consecutive daily records. It compares 14-day predictions before selecting and refitting the method. Forecast adjustments are saved with the workspace.<br>User-based plans can replace the learned demand for new services. They multiply users, sessions, requests and model calls, account for calls avoided by cache, and apply a peak-traffic factor. Annual growth applies to users in this mode. Launch traffic is added once.<br>Selected performance profiles must match the service configuration and request sizes. Missing inputs remain visible as partial demand. Daily backtests are a separate next-day traffic check.</div></section>
      <section class="panel"><div class="panel-heading"><h2>Evidence & limitations</h2></div><div class="panel-body description"><strong>Observed:</strong> only what you manually enter; not independently verified.<br><strong>Derived:</strong> allocation summaries, comparable-period growth, replicas, compute/memory screens and monthly gaps.<br><strong>Synthetic:</strong> seeded 200,000-GPU inventory, 60-day service history, performance profiles and roadmaps. Independent of the Philly experiment.<br><strong>Not implemented:</strong> collectors, real-time streaming, effective-dated service migrations, shared-GPU attribution, authentication, uncertainty calibration, topology validation or scheduler enforcement.<br>FLOPs describe work; FLOP/s describes rate. Busy-time utilization must not be multiplied by hardware peak and called measured FLOP/s.<br>Historical YoY/two-year comparisons remain unavailable without complete matching history. Every growth rate in the inference planner is a scenario assumption.<br><a href="../README.md">Read the framework and reproduction instructions</a></div></section>`;
  }
  function render() {
    $("#page-title").textContent = titles[view][0];
    $("#page-subtitle").textContent = titles[view][1];
    $("#main-action").textContent = titles[view][2];
    $("#service-filter").innerHTML = `<option value="all">All services</option>${serviceOptions(serviceFilter)}`;
    $("#service-filter").value = serviceFilter;
    $("#team-filter").innerHTML = `<option value="all">All teams</option>${[...new Set(state.services.map(s => s.team))].sort().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}`;
    $("#team-filter").value = teamFilter;
    $("#pool-filter").value = poolFilter;
    $("#start-month").value = state.startMonth;
    document.querySelectorAll("nav button").forEach(b => {
      b.classList.toggle("active", b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    $("#content").innerHTML = ({overview, inference: inferenceView, benchmarks: benchmarksView, forecasts: forecastsView,
      training: trainingView, capacity: capacityView, data: dataView})[view]();
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
      const s = state.services.find(s => s.id === id) || {name: "", team: "", pool: "H100", gpusPerReplica: 8, rpsPerReplica: 20, annualGrowth: 30, monthlyLaunchRps: 0, headroom: 20, profile: "",
        demandMethod: "historical", benchmarkId: "", workloadKey: "", inputTokens: 1024, outputTokens: 256, drivers: M.defaultDrivers()};
      title = id ? "Configure service profile" : "Register a service";
      intro = "Choose historical-peak growth OR a driver scenario. Historical mode needs consumption history; drivers can plan a new service. Linked profiles must match configuration and token range. Inline values are used only when no library profile is selected.";
      fields = field("name", "Service name", s.name, "text", 'maxlength="150"') + field("team", "Owning team", s.team, "text", 'maxlength="150"') +
        selectField("pool", "Compatible GPU pool", poolOptions(s.pool)) + field("gpusPerReplica", "GPUs per replica", s.gpusPerReplica, "number", 'min="1" max="1024" step="1"') +
        field("rpsPerReplica", "Sustainable RPS per replica at SLO", s.rpsPerReplica, "number", 'min="0.0001" max="1000000000" step="any"') +
        field("annualGrowth", "Annual growth (%) - manual traffic plan or driver-based users", s.annualGrowth, "number", 'min="-90" max="1000" step="any"', "History-based forecasts learn their own trend. Use Adjust the forecast on the main page to change it.") +
        field("monthlyLaunchRps", "Additional peak RPS added each month", s.monthlyLaunchRps, "number", 'min="0" max="1000000000" step="any"', "Separate named initiative assumption; do not include it again in organic growth.") +
        field("headroom", "Spare serving headroom (%)", s.headroom, "number", 'min="0" max="80" step="any"') +
        field("profile", "Inline performance evidence / assumptions", s.profile, "text", 'maxlength="150"') +
        selectField("demandMethod", "Organic demand method", ["historical", "drivers"].map(v => `<option value="${v}" ${s.demandMethod === v ? "selected" : ""}>${v === "historical" ? "Historical peak + annual traffic growth" : "Business demand drivers + annual user growth"}</option>`).join("")) +
        selectField("benchmarkId", "Reusable performance profile", `<option value="">Use inline service assumption</option>${state.benchmarks.map(b => `<option value="${esc(b.id)}" ${s.benchmarkId === b.id ? "selected" : ""}>${esc(b.name)} (${b.pool}; ${b.source})</option>`).join("")}`) +
        field("workloadKey", "Configuration key (model/version + precision + runtime + SLO)", s.workloadKey, "text", 'maxlength="150"', "Must exactly match a selected library profile. Do not reuse a key for a different configuration.") +
        field("inputTokens", "Scenario input tokens / request", s.inputTokens, "number", 'min="0" max="10000000" step="any"') +
        field("outputTokens", "Scenario output tokens / request", s.outputTokens, "number", 'min="0" max="10000000" step="any"') +
        '<h3 class="wide">Demand drivers (used only in driver mode)</h3>' +
        field("activeUsers", "Daily active users at scenario baseline", s.drivers.activeUsers, "number", 'min="0" max="1000000000000" step="1"') +
        field("sessionsPerUser", "Sessions per active user / day", s.drivers.sessionsPerUser, "number", 'min="0" max="1000" step="any"') +
        field("requestsPerSession", "User requests per session", s.drivers.requestsPerSession, "number", 'min="0" max="10000" step="any"') +
        field("callsPerRequest", "Backend model calls per user request", s.drivers.callsPerRequest, "number", 'min="0" max="1000" step="any"') +
        field("cacheHitPct", "Backend calls avoided by cache (%)", s.drivers.cacheHitPct, "number", 'min="0" max="100" step="any"') +
        field("peakToAverage", "Peak-to-average backend traffic ratio", s.drivers.peakToAverage, "number", 'min="1" max="1000" step="any"');
    } else if (kind === "benchmark") {
      const b = state.benchmarks.find(b => b.id === id) || {name: "", pool: "H100", workloadKey: "",
        gpusPerReplica: 8, rpsPerReplica: 20, minInputTokens: 0, maxInputTokens: 2048,
        minOutputTokens: 0, maxOutputTokens: 512, measuredOn: new Date().toISOString().slice(0, 10),
        source: "user-benchmark", evidence: ""};
      title = id ? "Edit reusable performance profile" : "Add performance evidence";
      intro = "User-entered measurements are not independently verified. Encode model/version, precision, runtime, batching/concurrency and latency SLO in the configuration key. Changing this shared profile affects all linked services.";
      fields = field("name", "Profile name", b.name, "text", 'maxlength="150"') + selectField("pool", "GPU pool", poolOptions(b.pool)) +
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
    } else if (kind === "training") {
      const t = state.training.find(t => t.id === id) || {name: "", serviceId: serviceFilter === "all" ? state.services[0].id : serviceFilter, pool: poolFilter === "all" ? "H200" : poolFilter, month: state.startMonth, parametersB: 70, tokensB: 1000, days: 14, peakTflops: 989, mfu: 40, memoryGB: 80, bytesPerParameter: 16, block: 256, runs: 1};
      title = id ? "Edit training roadmap input" : "Plan a training run";
      intro = "Dense-transformer pretraining only. All tokens are total tokens across epochs. MFU must be calibrated for the precision/configuration; initial peak throughput and memory values are illustrative, not selected automatically by hardware.";
      fields = field("name", "Plan name", t.name, "text", 'maxlength="150"') + selectField("serviceId", "Owning service", serviceOptions(t.serviceId)) +
        selectField("pool", "Compatible GPU pool", poolOptions(t.pool)) + field("month", "Planned month", t.month, "month") +
        field("parametersB", "Dense parameters (billions)", t.parametersB, "number", 'min="0.001" max="10000" step="any"') +
        field("tokensB", "Total training tokens (billions)", t.tokensB, "number", 'min="0.001" max="10000000" step="any"') +
        field("days", "Active training window (days)", t.days, "number", 'min="0.01" max="31" step="any"') +
        field("runs", "Concurrent runs", t.runs, "number", 'min="1" max="1000" step="1"') +
        field("peakTflops", "Precision-matched dense peak TFLOP/s / GPU", t.peakTflops, "number", 'min="1" max="100000" step="any"') +
        field("mfu", "Model FLOPs utilization (%)", t.mfu, "number", 'min="1" max="100" step="any"') +
        field("memoryGB", "Memory per GPU (decimal GB)", t.memoryGB, "number", 'min="1" max="10000" step="any"') +
        field("bytesPerParameter", "Training-state bytes / parameter", t.bytesPerParameter, "number", 'min="1" max="100" step="any"', "Weights + gradients + optimizer state. Activations/buffers excluded; not proof of fit.") +
        field("block", "Topology rounding block (GPUs)", t.block, "number", 'min="1" max="65536" step="1"');
    } else if (kind === "supply") {
      title = "Edit organization supply";
      intro = "Physical counts by compatible pool. Unavailable and protected reserve are disjoint deductions. This is a scenario, not an inventory connector.";
      fields = M.POOLS.map(p => `<h3 class="wide">${p}</h3>` +
        field(`${p}_installed`, "Installed GPUs", state.supply[p].installed, "number", 'min="0" max="10000000" step="1"') +
        field(`${p}_unavailable`, "Unavailable / not commissioned", state.supply[p].unavailable, "number", 'min="0" max="10000000" step="1"') +
        field(`${p}_reserve`, "Protected operational reserve", state.supply[p].reserve, "number", 'min="0" max="10000000" step="1"')).join("");
    } else if (kind === "addition") {
      title = "Plan a commissioned addition";
      intro = "Additional supply is usable from this month onward. Count new usable GPUs, not orders or deliveries awaiting qualification.";
      fields = selectField("pool", "Compatible pool", poolOptions("H200")) + field("month", "Usable from month", state.startMonth, "month") +
        field("gpus", "Additional usable GPUs", 8192, "number", 'min="1" max="10000000" step="1"');
    } else if (kind === "remove-training" || kind === "remove-addition" || kind === "reset" || kind === "import") {
      title = kind === "reset" ? "Replace workspace with demo?" : kind === "import" ? "Import and replace workspace?" : "Remove this planning input?";
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
        const s = {...values, id: id || `service-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`};
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
      } else if (kind === "training") {
        const t = {...values, id: id || `training-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`};
        for (const key of ["parametersB", "tokensB", "days", "peakTflops", "mfu", "memoryGB", "bytesPerParameter", "block", "runs"]) t[key] = Number(values[key]);
        const index = next.training.findIndex(t => t.id === id);
        if (index >= 0) next.training[index] = t;
        else next.training.push(t);
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
    const heads = ["month", "pool", "baselineInference", "inference", "training", "required", "usable", "gap", "complete", "missing"];
    const rows = requirementRows();
    const csv = [heads.join(","), ...rows.map(r => heads.map(h => String(r[h])).join(","))].join("\r\n");
    download("gpu-capacity-requirements.csv", csv, "text/csv");
    notice("Forecast CSV exported with your saved adjustments and current filters.");
  }
  function exportCapacityForecast() {
    const forecast = M.capacityForecast(state, serviceFilter, teamFilter, poolFilter);
    download("gpu-capacity-forecast.json", JSON.stringify({planningStart: state.startMonth,
      filters: {service: serviceFilter, team: teamFilter, pool: poolFilter}, ...forecast}, null, 2), "application/json");
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
    if (button.dataset.view) {view = button.dataset.view; render();}
    else if (button.dataset.service) {serviceFilter = button.dataset.service; render();}
    else if (button.dataset.editService) openEditor("service", button.dataset.editService);
    else if (button.dataset.editBenchmark) openEditor("benchmark", button.dataset.editBenchmark);
    else if (button.dataset.editTraining) openEditor("training", button.dataset.editTraining);
    else if (button.dataset.removeTraining) openEditor("remove-training", button.dataset.removeTraining);
    else if (button.hasAttribute("data-remove-addition")) openEditor("remove-addition", button.dataset.removeAddition);
    else if (button.dataset.action) openEditor(button.dataset.action);
    else if (button.hasAttribute("data-export-workspace")) exportWorkspace();
    else if (button.hasAttribute("data-export-requirements")) exportRequirements();
    else if (button.hasAttribute("data-reset-forecast")) {
      const next = clone(); next.forecast = M.defaultForecast();
      save(next, "Forecast adjustments reset. Service plans are unchanged.");
    }
    else if (button.dataset.granularity) {weekly = button.dataset.granularity === "weekly"; render();}
  });
  document.addEventListener("submit", event => {
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
    if (input.id === "service-filter") {serviceFilter = input.value; render();}
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
  $("#main-action").addEventListener("click", () => {
    if (view === "capacity") exportCapacityForecast();
    else if (view === "forecasts") exportForecasts();
    else if (view === "benchmarks") openEditor("benchmark");
    else if (view === "data") exportWorkspace();
    else openEditor({overview: "consumption", inference: "service", training: "training"}[view]);
  });
  $("#export").addEventListener("click", exportWorkspace);
  $(".brand").addEventListener("click", event => {event.preventDefault(); view = "capacity"; render();});
  $("#editor-form").addEventListener("submit", submitEditor);
  $("#close-editor").addEventListener("click", () => $("#editor").close());
  $("#cancel-editor").addEventListener("click", () => $("#editor").close());
  render();
  if (initialError) notice(initialError, storageBlocked);
})();
