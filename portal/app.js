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
    if (parsed && parsed.version < 3) initialError = "Workspace upgraded for GPU SKUs. Old family-level inventory is kept as 'variant not specified'; no variant has been guessed. Your services and plans are unchanged. Load the NVIDIA workload demo from Data & assumptions to replace the example data.";
  } catch (error) {
    state = M.demo();
    storageBlocked = true;
    initialError = `Saved workspace could not be loaded: ${error.message} Showing a demo preview only. Export/repair the saved data outside this portal, import a valid workspace, or explicitly reset the demo. No data has been overwritten.`;
  }
  let view = "planning";
  let serviceFilter = "all";
  let teamFilter = "all";
  let poolFilter = "all";
  let weekly = false;
  let planningMonth = M.months(state.startMonth).at(-1);
  let planningUnit = "physical";
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
      if (redraw) render();
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
      <div class="chart-wrap">${chart(points, [{key: "averageAllocated", name: "Average allocated GPUs", color: "#b7ef6a"}], "Allocated GPU trend for selected services and dates")}</div>
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
      <section class="panel"><div class="panel-heading"><div><h2>Manual serving scenario</h2><p>Compare an entered growth assumption with the history-based forecast.</p></div></div><div class="chart-wrap">${chart(projection, [{key: "gpus", name: "Inference GPUs", color: "#8daaff"}], "Monthly manual serving GPU scenario")}</div></section>
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
      return `<article class="plan-card"><span class="badge">${esc(skuName(t.pool))} · ${esc(t.month)}</span><h3>${esc(t.name)}</h3><span class="help">${esc(service.name)} · dense pretraining</span><div class="big-number">${fmt(result.totalGpus)} GPUs</div><span class="help">${fmt(result.gang)} per run × ${t.runs} concurrent runs</span>
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
      serving = `<h3>One service: ${esc(service.name)} in ${focused.month}</h3>
        <ol class="logic-calculation">
          <li>Start with ${fmt(estimate.baseRps, 2)} peak work items/second from ${selected.demand.source === "history" ? "the learned traffic forecast" : "the entered user-demand plan"}. Apply this service's growth and the global traffic change, then add launches:<br><code>${fmt(estimate.baseRps, 2)} x ${fmt(estimate.growthFactor, 6)} x ${fmt(1 + report.options.trafficAdjustmentPct / 100, 4)} + ${fmt(estimate.launchRps, 2)} = ${fmt(estimate.peakRps, 2)} peak work items/second.</code></li>
          <li>One replica uses ${performance.gpusPerReplica} ${esc(skuName(service.pool))} GPUs and handles ${fmt(performance.rpsPerReplica, 4)} work items/second at the required response time. The ${pct(report.options.throughputChangePct)} throughput adjustment makes that ${fmt(throughput, 4)}. Keep ${fmt(service.headroom, 2)}% spare capacity, leaving ${fmt(throughput * capacityShare, 4)} usable work items/second per replica.</li>
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
      const result = M.training(plan);
      const status = !report.options.includeTraining ? "Excluded from totals because Include training is off." :
        plan.month === focused.month ? "Included in the inspected month's total." :
          `Scheduled in ${plan.month}, not in the inspected month ${focused.month}.`;
      training = `<h3>Training example: ${esc(plan.name)}</h3><p>${esc(skuName(plan.pool))}. ${status}</p>
        <ol class="logic-calculation">
          <li>Dense-model work: <code>6 x ${fmt(plan.parametersB, 3)} billion parameters x ${fmt(plan.tokensB, 3)} billion training tokens = ${result.flops.toExponential(2)} FLOPs.</code></li>
          <li>Effective GPU speed: <code>${fmt(plan.peakTflops, 3)} peak TFLOP/s x ${fmt(plan.mfu, 2)}% MFU = ${fmt(plan.peakTflops * plan.mfu / 100, 3)} effective TFLOP/s per GPU.</code> MFU is the share of theoretical computing speed achieved on model work, not the GPU busy percentage.</li>
          <li>Finishing within ${fmt(plan.days, 2)} active days needs ${fmt(result.computeGpus)} GPUs for compute. The training-state memory minimum is ${fmt(result.memoryGpus)} GPUs. Take the larger count and round up to blocks of ${fmt(plan.block)} GPUs: ${fmt(result.gang)} per run. Multiply by ${fmt(plan.runs)} concurrent runs: <strong>${Number.isSafeInteger(result.totalGpus) ? `${fmt(result.totalGpus)} required training GPUs` : "GPU count outside the supported range"}</strong>.</li>
        </ol><p class="help">This estimates dense-transformer pretraining only. Peak speed and MFU must refer to the same precision and configuration. The memory screen excludes activations and communication buffers; it does not prove fit. Training tokens/second benchmark pairs are used for H100 normalization, not to replace this MFU-based sizing calculation.</p>`;
    }
    return `<div class="logic-example">${serving}<h3>Repeat the calculation for every service</h3>
      <p>Each model has its own request size, response-time target, GPU SKU and serving throughput. Do not add a render's work/second to a language model's requests/second and divide by one company-wide speed. Convert each service to GPUs first:</p>
      ${table(["Service / SKU", "Planned peak work/s", "Work/s per replica", "Spare share", "GPUs per replica", "Required GPUs"], rows)}
      <div class="logic-training">${training}</div>
      <h3>The result for ${focused.month}, within the current filters</h3>
      <p><strong>${fmt(focused.inference)} inference GPUs + ${fmt(focused.training)} scheduled training GPUs = <span id="logic-total-gpus">${fmt(focused.required)}</span> required GPUs${focused.physicalComplete ? "" : " (partial: some workloads cannot be sized)"}.</strong> Group these counts by owning organization and exact GPU SKU. Monthly planning assumes service peaks and same-month training can overlap; it does not credit shared idle time.</p>
      <p>For each SKU: <code>usable supply = installed - unavailable - protected reserve + additions ready by that month</code>. Then <code>shortage = required GPUs - usable supply</code>. A positive shortage is the number to add or the demand to reschedule; spare capacity in another SKU is not an automatic substitute.</p>
      <p>For a common growth index, multiply each workload's GPU count by its own selected-SKU/H100 throughput ratio, then add those H100 equivalents. Normalization compares the plan; it does not change the required SKU counts or normalize idle inventory.</p></div>`;
  }
  function forecastLogicPanel(workspace, report) {
    return `<section class="panel forecast-logic" aria-labelledby="forecast-logic-title"><div class="panel-heading"><div><h2 id="forecast-logic-title">How this capacity forecast is calculated</h2><p>Goal: know which GPU SKUs are needed, how many, and in which month the company will run short.</p></div></div>
      <ol class="logic-steps">
        <li><h3>1. Forecast each service's work</h3><p>Use traffic history or an entered demand plan. Apply that service's growth and launch traffic.</p></li>
        <li><h3>2. Convert inference work to GPUs</h3><p>Use that model and SKU's benchmarked or entered throughput at the required response time. Keep spare headroom and round up to whole replicas.</p></li>
        <li><h3>3. Add training separately</h3><p>Use model size, training tokens, deadline, memory, and peak computing speed x MFU. Round for topology and concurrent runs.</p></li>
        <li><h3>4. Add up the company plan</h3><p>Add GPU counts, not unlike services' request rates. Roll up by organization, SKU and month, then compare with usable inventory.</p></li>
      </ol>
      <p class="logic-key"><strong>Inference uses throughput, not MFU. Training uses MFU.</strong> GPU-hours and GPU busy % describe observed usage; this forecast estimates capacity to provision, not future busy %. Busy % is not MFU.</p>
      <details id="forecast-logic-details" ${$("#forecast-logic-details")?.open ? "open" : ""}><summary>Show the formulas and live calculation for the selected service and month</summary>
        <div class="logic-formulas"><p><strong>Inference:</strong> <code>replicas = round up (peak work/s / (work/s per replica x usable capacity share))</code>; <code>GPUs = replicas x GPUs per replica</code>.</p>
        <p><strong>Training:</strong> <code>work = 6 x parameters x training tokens</code>; <code>compute GPUs = round up (work / (active seconds x peak FLOP/s per GPU x MFU fraction))</code>. Use the larger compute/memory count, round to topology blocks, then multiply by concurrent runs.</p>
        <p>For history-based services, compare a recent average with a weekly trend plus weekday pattern using 14 held-out days, refit, then size against the busiest predicted day of each month. At least 42 consecutive days are needed; up to 84 are used. Missing history requires an explicit demand plan, not an assumed zero.</p></div>
        <div id="forecast-logic-example">${forecastLogicExample(workspace, report)}</div>
      </details></section>`;
  }
  function planningResults(workspace, report = M.bottomUpForecast(workspace, serviceFilter, teamFilter, poolFilter)) {
    const focused = report.monthly.find(m => m.month === planningMonth) || report.monthly.at(-1);
    const first = report.monthly[0], last = report.monthly.at(-1);
    const normalized = planningUnit === "h100";
    const subtotal = (m, kind) => {
      const rows = m.workloads.filter(r => r.kind === kind);
      return normalized ? rows.some(r => r.normalizedGpus === null) ? null :
        rows.reduce((n, r) => n + r.normalizedGpus, 0) : rows.some(r => r.gpus === null) ? null :
        rows.reduce((n, r) => n + r.gpus, 0);
    };
    const points = report.monthly.map(m => ({month: m.month, inference: subtotal(m, "inference"),
      training: subtotal(m, "training"), total: normalized ? m.normalizedRequired : m.physicalComplete ? m.required : null}));
    const growth = first.normalizedRequired !== null && last.normalizedRequired !== null ?
      M.growth(last.normalizedRequired, first.normalizedRequired) : null;
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
    return `<div class="kpis">${metric(`GPUs required in ${focused.month}`, fmt(focused.required), focused.physicalComplete ? "Inference plus scheduled training; see SKU split below" : "Partial physical demand: missing sizing inputs", true)}${metric("H100-equivalent requirement", fmt(focused.normalizedRequired, 1), `${focused.count - focused.missing} / ${focused.count} workloads covered; a comparison index`)}${metric("Normalized growth: month 1 to 6", pct(growth), "Same reference SKU, workload-specific ratios")}${metric("Training in selected month", fmt(focused.training), "Added on top of service demand")}</div>${partial}
      <section class="panel"><div class="panel-heading"><div><h2>Bottom-up demand: inference + training</h2><p>${normalized ? "H100 SXM 80GB equivalents. Missing benchmark pairs leave gaps, not zeros." : "Individual GPUs. Mixed-SKU counts are physical totals, not equal-performance units."}</p></div></div><div class="panel-body"><div class="legend"><span><i></i>Inference</span><span><i class="amber"></i>Training</span><span><i class="blue"></i>Total</span></div></div><div class="chart-wrap">${chart(points, [{key: "inference", name: "Inference", color: "#b7ef6a"}, {key: "training", name: "Training", color: "#f2bd6d"}, {key: "total", name: "Inference + training", color: "#8daaff"}], normalized ? "H100-equivalent demand by month" : "Physical GPU demand by month", 0)}</div></section>
      ${scope}${detail}<section class="panel"><div class="panel-heading"><div><h2>Convert the plan back to assigned SKUs</h2><p>${focused.month}. Counts retain each workload's chosen hardware; ratios do not move jobs or normalize idle supply.</p></div><button class="button subtle" data-export-requirements>Download CSV</button></div>${table(["GPU SKU", "Inference", "Training", "Physical total", "H100 equivalents", "Available", "Gap / spare"], focused.pools.map(p => `<tr><td>${esc(skuName(p.pool))}</td><td>${fmt(p.inference)}</td><td>${fmt(p.training)}</td><td>${fmt(p.required)}${p.physicalComplete ? "" : " (partial)"}</td><td>${fmt(p.normalizedRequired, 1)}</td><td>${fmt(p.usable)}</td><td><span class="badge ${p.gap > 0 ? "red" : "green"}">${p.gap > 0 ? "+" : ""}${fmt(p.gap)}${p.physicalComplete ? "" : " (partial)"}</span></td></tr>`).join(""))}</section>`;
  }
  function planningView() {
    const horizon = M.months(state.startMonth);
    if (!horizon.includes(planningMonth)) planningMonth = horizon.at(-1);
    const services = chosenServices();
    const quick = services.find(s => s.id === serviceFilter) || services.find(s => s.id === planningQuickService) || services[0];
    if (quick) planningQuickService = quick.id;
    const plans = planningPlans(state);
    const options = state.forecast || M.defaultForecast();
    const report = M.bottomUpForecast(state, serviceFilter, teamFilter, poolFilter);
    return `<div class="planning-toolbar"><div class="planning-breadcrumb"><button class="text-button" data-planning-root>All organizations</button>${teamFilter !== "all" ? ` / <button class="text-button" data-drill-org="${esc(teamFilter)}">${esc(teamFilter)}</button>` : ""}${serviceFilter !== "all" ? ` / ${esc(state.services.find(s => s.id === serviceFilter).name)}` : ""}</div><label>Inspect month<select id="planning-month">${horizon.map(m => `<option ${m === planningMonth ? "selected" : ""}>${m}</option>`).join("")}</select></label><label>Chart units<select id="planning-unit"><option value="physical" ${planningUnit === "physical" ? "selected" : ""}>Physical GPUs</option><option value="h100" ${planningUnit === "h100" ? "selected" : ""}>H100 equivalents</option></select></label><label class="check-option"><input id="planning-training" type="checkbox" ${options.includeTraining ? "checked" : ""}> Include training</label><button class="text-button" data-view="capacity">Global traffic / efficiency adjustments</button></div>
      ${forecastLogicPanel(state, report)}
      <div class="callout info">Build the plan from services upward. Edit a growth number or drag its slider; results preview immediately and save on release or when you leave the field. Drag training cards between months, or use their month selectors. The demo's benchmark pairs are illustrative, not NVIDIA performance claims.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Set service growth</h2><p>Extra demand by month six, on top of the learned traffic trend. It compounds over six months; +0% keeps that trend. Launch traffic is added separately.</p></div></div><div class="panel-body planning-quick">${quick ? `<label>Service to adjust<select id="planning-quick-service">${services.map(s => `<option value="${esc(s.id)}" ${s.id === quick.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><span class="help">${esc(quick.team)} / ${esc(skuName(quick.pool))}</span></label><div><label class="help">Extra demand by month six (%)</label><div class="growth-editor"><input type="range" min="-90" max="300" step="0.1" value="${quick.scenarioGrowthPct ?? 0}" data-service-growth="${esc(quick.id)}" aria-label="Growth slider for ${esc(quick.name)}"><input type="number" min="-90" max="300" step="0.1" value="${quick.scenarioGrowthPct ?? 0}" required data-service-growth="${esc(quick.id)}" aria-label="Growth percentage for ${esc(quick.name)}"></div></div><div><button class="text-button" data-edit-service="${esc(quick.id)}">Edit model inputs</button>${calibrationButton("inference", quick)}</div>` : '<p class="help">No inference service matches these filters. Training on this SKU is still included below.</p>'}</div><p id="planning-preview-status" class="panel-body help" role="status">Saved scenario. Change a slider to preview.</p></section>
      <div id="planning-results">${planningResults(state, report)}</div>
      <section class="panel"><div class="panel-heading"><div><h2>Schedule training on top</h2><p>${options.includeTraining ? "Included in totals. Plans within a month are treated as concurrent." : "Excluded from totals. You can still edit or reschedule the roadmap."} Moves preserve the run's active days; impossible calendar moves are rejected.</p></div><button class="button subtle" data-action="training">Add training plan</button></div><div class="training-scroll"><div class="training-board">${horizon.map(m => `<section class="training-lane" data-training-drop="${m}" aria-label="Training scheduled for ${m}"><h3>${m}</h3>${plans.filter(t => t.month === m).map(t => `<article class="training-drag-card" draggable="true" data-training-drag="${esc(t.id)}"><span class="help">Drag to reschedule</span><h3>${esc(t.name)}</h3><p>${fmt(M.training(t).totalGpus)} GPUs<br><span class="help">${esc(skuName(t.pool))}</span></p><label class="help">Move to month<select data-training-month="${esc(t.id)}" aria-label="Move ${esc(t.name)} to month">${horizon.map(month => `<option ${month === m ? "selected" : ""}>${month}</option>`).join("")}</select></label><div class="form-actions"><button class="text-button" data-edit-training="${esc(t.id)}">Edit model</button>${calibrationButton("training", t)}</div></article>`).join("") || '<p class="help">Drop a training plan here.</p>'}</section>`).join("")}</div></div>${plans.some(t => !horizon.includes(t.month)) ? '<p class="panel-body help">Some plans are outside this horizon. Open Training roadmap to see them.</p>' : ""}</section>
      <section class="panel"><div class="panel-heading"><h2>How normalization works</h2></div><div class="panel-body description">For each workload: ratio = benchmark throughput per selected-SKU GPU / benchmark throughput per H100 SXM GPU. H100 equivalents = required GPUs x that ratio. Convert back for that same workload: equivalents / ratio. Compare identical model versions, precision, job sizes and response-time targets; enter full-replica throughput divided by its GPU count.<br>Inference uses fixed work items/second/GPU; training uses training tokens/second/GPU. Ratios are workload-specific, not a universal H100-to-B200 conversion. A GB200 superchip contains a CPU and two GPUs; it is not one interchangeable GPU.<br>Missing, changed or future-dated evidence makes normalized totals unavailable. Physical SKU demand remains visible. This index does not prove memory fit, interconnect compatibility, or that a job can move to another GPU.</div></section>`;
  }
  function previewServiceGrowth(input, persist) {
    const status = $("#planning-preview-status");
    if (!input.checkValidity()) {
      status.textContent = "Preview not applied. Enter growth between -90% and +300% in steps of 0.1%.";
      return;
    }
    const next = clone();
    const service = next.services.find(s => s.id === input.dataset.serviceGrowth);
    service.scenarioGrowthPct = Number(input.value);
    document.querySelectorAll("[data-service-growth]").forEach(el => {
      if (el !== input && el.dataset.serviceGrowth === service.id) el.value = input.value;
    });
    if (persist) {
      if (!save(next, "Service growth saved. SKU demand and organization totals updated.", false, false)) {render(); return;}
      status.textContent = "Scenario saved.";
    } else status.textContent = "Live preview - release the slider or leave the number field to save.";
    const report = M.bottomUpForecast(next, serviceFilter, teamFilter, poolFilter);
    $("#planning-results").innerHTML = planningResults(next, report);
    $("#forecast-logic-example").innerHTML = forecastLogicExample(next, report);
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
    const points = [...forecast.historical, ...forecast.monthly.map(m => ({month: m.month,
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
      <section class="panel"><div class="panel-heading"><div><h2>Where will capacity run short?</h2><p>Positive gap = GPUs to add or demand to move. Each SKU has its own supply; no automatic substitution.</p></div><button class="button subtle" data-export-requirements>Download CSV</button></div>${table(["Month", "GPU SKU", "Base serving", "Planned serving", "Training", "Total planned", "Available", "Gap / spare", "Status"], rows.map(r => `<tr><td>${r.month}</td><td>${esc(skuName(r.pool))}</td><td>${fmt(r.baselineInference)}</td><td>${fmt(r.inference)}</td><td>${fmt(r.training)}</td><td>${fmt(r.required)}</td><td>${fmt(r.usable)}</td><td>${r.gap > 0 ? "+" : ""}${fmt(r.gap)}</td><td><span class="badge ${!r.complete || r.gap > 0 ? "red" : "green"}">${!r.complete ? "Partial inputs" : r.gap > 0 ? "Shortage" : "Within supply"}</span></td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>What is driving the forecast?</h2><p>Compare a recent average with a learned weekly trend. Pick the lower-error method on 14 later days, then refit with all recent history.</p></div><button class="button subtle" data-action="consumption">Add service history</button></div>${table(["Service / GPU SKU", "Forecast method", "History used", "Model selection error", "First to last forecast month", ""], serviceRows)}
      <div class="panel-body description">Up to 84 consecutive daily records are used; at least 42 are needed. Both methods learn weekday patterns. The 14-day selection error is not a six-month accuracy score. Gaps between the latest record and planning start are forecast forward, not filled with zero. Manual annual traffic growth is kept in Service plans; it does not set the learned trend.</div></section>`;
  }
  function dataView() {
    const synthetic = state.records.filter(r => r.source === "synthetic").length;
    return `<div class="callout">This is a browser-local scenario workspace, not a live company telemetry feed. ${synthetic} of ${state.records.length} consumption rows are synthetic. User-entered rows are manual observations, not verified connector measurements. No data is sent to a backend.</div>
      <section class="panel"><div class="panel-heading"><div><h2>Supply by GPU SKU</h2><p>Supply = installed − unavailable − reserve + additions. Counts are individual GPUs, not servers or racks.</p></div><button class="button subtle" data-action="supply">Edit supply</button></div>${table(["GPU SKU", "Installed", "Unavailable", "Protected reserve", "Base usable"], M.activePools(state).map(p => {const s = state.supply[p]; return `<tr><td>${esc(skuName(p))}</td><td>${fmt(s.installed)}</td><td>${fmt(s.unavailable)}</td><td>${fmt(s.reserve)}</td><td>${fmt(s.installed - s.unavailable - s.reserve)}</td></tr>`;}).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>Commissioned additions</h2><p>Capacity becomes usable at the start of the selected month; readiness is a user assumption.</p></div><button class="button subtle" data-action="addition">+ Addition</button></div>${table(["GPU SKU", "Available from", "GPUs", ""], state.supply.additions.map((a, i) => `<tr><td>${esc(skuName(a.pool))}</td><td>${a.month}</td><td>${fmt(a.gpus)}</td><td><button class="text-button" data-remove-addition="${i}">Remove</button></td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>GPU SKU catalog</h2><p>Memory and form factor identify the variant. Serving throughput must come from a matching workload test.</p></div></div>${table(["SKU", "Family", "Memory / GPU", "Form factor", "Source"], M.SKU_CATALOG.filter(s => !s.legacy || M.activePools(state).includes(s.id)).map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.family)}</td><td>${s.memoryGB === null ? "Not specified" : `${s.memoryGB} GB ${s.memoryType}`}</td><td>${s.formFactor}</td><td>${s.source ? `<a href="${esc(s.source)}" target="_blank" rel="noopener noreferrer">NVIDIA specs</a>` : "Legacy family only"}</td></tr>`).join(""))}</section>
      <section class="panel"><div class="panel-heading"><div><h2>NVIDIA workload areas</h2><p>Publicly documented areas, not a ranked compute-spending breakdown. Demo volumes are illustrative.</p></div></div>${table(["Area", "Work being planned", "Source"], M.WORKLOAD_AREAS.map(w => `<tr><td class="service-name">${esc(w.name)}</td><td class="workload-description">${esc(w.description)}</td><td><a href="${esc(w.source)}" target="_blank" rel="noopener noreferrer">Read source</a></td></tr>`).join(""))}<div class="panel-body description">For render, simulation and evaluation services, a request means one fixed, benchmarked work item. Do not reuse a text-generation throughput test. The dense training calculator is not a simulator or a universal robotics/video-model estimator.</div></section>
      <section class="panel"><div class="panel-heading"><h2>Workspace portability</h2></div><div class="panel-body"><p class="description">Version-3 exports include exact GPU SKU identifiers and forecast adjustments. Older family-only inventory remains labeled variant not specified. Import or loading the NVIDIA demo replaces the workspace only after confirmation.</p><div class="data-tools"><button class="button subtle" data-export-workspace>Export JSON</button><label class="button subtle">Import JSON <input type="file" id="import-file" accept=".json,application/json"></label><button class="button subtle" data-action="reset">Load NVIDIA workload demo</button></div></div></section>
      <section class="panel"><div class="panel-heading"><h2>How the forecast uses these inputs</h2></div><div class="panel-body description">Capacity forecast learns a recent average or weekly trend from up to 84 consecutive daily records. It compares 14-day predictions before selecting and refitting the method. Forecast adjustments are saved with the workspace.<br>User-based plans can replace the learned demand for new services. They multiply users, sessions, requests and model calls, account for calls avoided by cache, and apply a peak-traffic factor. Annual growth applies to users in this mode. Launch traffic is added once.<br>Selected performance profiles must match the service configuration and request sizes. Missing inputs remain visible as partial demand. Daily backtests are a separate next-day traffic check.</div></section>
      <section class="panel"><div class="panel-heading"><h2>Evidence & limitations</h2></div><div class="panel-body description"><strong>Observed:</strong> only what you manually enter; not independently verified.<br><strong>Derived:</strong> allocation summaries, comparable-period growth, replicas, compute/memory screens and monthly gaps.<br><strong>Synthetic:</strong> seeded 200,000-GPU inventory, 60-day service history, performance profiles and roadmaps. Independent of the Philly experiment.<br><strong>Not implemented:</strong> collectors, real-time streaming, effective-dated service migrations, shared-GPU attribution, authentication, uncertainty calibration, topology validation or scheduler enforcement.<br>FLOPs describe work; FLOP/s describes rate. Busy-time utilization must not be multiplied by hardware peak and called measured FLOP/s.<br>Historical YoY/two-year comparisons remain unavailable without complete matching history. Every growth rate in the inference planner is a scenario assumption.<br><a href="../README.md">Read the framework and reproduction instructions</a></div></section>`;
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
    document.querySelectorAll("nav button").forEach(b => {
      b.classList.toggle("active", b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    $("#content").innerHTML = ({overview, inference: inferenceView, benchmarks: benchmarksView, forecasts: forecastsView,
      training: trainingView, capacity: capacityView, planning: planningView, data: dataView})[view]();
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
      const units = workload === "inference" ? "fixed work items/second/GPU at the same SLO" : "training tokens/second/GPU";
      title = `H100 benchmark pair: ${item.name}`;
      intro = `Compare ${skuName(item.pool)} with H100 SXM 80GB for this exact workload. Units: ${units}. Match model, precision and execution configuration; rates are per GPU within full replicas, not a promise of single-GPU fit. Saving records the current configuration.`;
      fields = field("selectedRate", `${skuName(item.pool)} throughput per GPU`, selectedRate, "number", `min="0.000000001" max="1000000000000" step="any" ${performance?.available ? "readonly" : ""}`) +
        field("referenceRate", "H100 SXM throughput per GPU", existing?.referenceRate ?? "", "number", 'min="0.000000001" max="1000000000000" step="any"') +
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
        field("peakTflops", "Precision-matched dense peak TFLOP/s / GPU", t.peakTflops, "number", 'min="1" max="100000" step="any"') +
        field("mfu", "Model FLOPs utilization (%)", t.mfu, "number", 'min="1" max="100" step="any"') +
        field("memoryGB", "Memory budget per GPU (decimal GB)", t.memoryGB, "number", `min="1" max="${M.skuInfo(t.pool).memoryGB ?? 10000}" step="any"`) +
        field("bytesPerParameter", "Training-state bytes / parameter", t.bytesPerParameter, "number", 'min="1" max="100" step="any"', "Weights + gradients + optimizer state. Activations/buffers excluded; not proof of fit.") +
        field("block", "Topology rounding block (GPUs)", t.block, "number", 'min="1" max="65536" step="1"');
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
    const heads = ["month", "pool", "baselineInference", "inference", "training", "required", "usable", "gap", "complete", "missing", "skuName", "memoryGB", "formFactor", "normalizedRequired", "normalizationMissing"];
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
    if (button.hasAttribute("data-planning-root")) {serviceFilter = "all"; teamFilter = "all"; render();}
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
    else if (input.dataset.trainingMonth) rescheduleTraining(input.dataset.trainingMonth, input.value);
    else if (input.id === "planning-quick-service") {planningQuickService = input.value; render();}
    else if (input.id === "planning-month") {planningMonth = input.value; render();}
    else if (input.id === "planning-unit") {planningUnit = input.value; render();}
    else if (input.id === "planning-training") {
      const next = clone(); next.forecast = {...(state.forecast || M.defaultForecast()), includeTraining: input.checked};
      save(next, "Training inclusion updated.");
    }
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
