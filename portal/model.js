(function (root) {
  "use strict";
  const POOLS = ["H100", "H200", "B200"];
  const DAY = 86400000;
  const fail = (message) => { throw new Error(message); };
  function number(value, name, min = 0, max = 1e15, integer = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      fail(`${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}.`);
    }
    return value;
  }
  function text(value, name) {
    if (typeof value !== "string" || !value.trim() || value.length > 150) fail(`${name} is required (maximum 150 characters).`);
    return value;
  }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value) fail("Use a valid YYYY-MM-DD date.");
    return value;
  }
  function month(value) {
    if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail("Use a valid YYYY-MM month.");
    return value;
  }
  function pool(value) {
    if (!POOLS.includes(value)) fail("Choose H100, H200 or B200; pools cannot be substituted automatically.");
  }
  function defaultDrivers() {
    return {activeUsers: 10000000, sessionsPerUser: 2, requestsPerSession: 5,
      callsPerRequest: 1, cacheHitPct: 0, peakToAverage: 3};
  }
  function upgrade(state) {
    if (!state || state.version !== 1) return state;
    if (!Array.isArray(state.services)) fail("Legacy workspace requires services.");
    return {...state, version: 2, benchmarks: [], services: state.services.map(s => ({
      ...s, demandMethod: "historical", drivers: defaultDrivers(), benchmarkId: "",
      workloadKey: s.id, inputTokens: 1024, outputTokens: 256,
    }))};
  }
  function serviceCheck(s) {
    text(s.id, "Service ID"); text(s.name, "Service name"); text(s.team, "Team");
    pool(s.pool);
    number(s.gpusPerReplica, "GPUs per replica", 1, 1024, true);
    number(s.rpsPerReplica, "Sustainable RPS per replica", 0.0001, 1e9);
    number(s.annualGrowth, "Annual demand growth %", -90, 1000);
    number(s.monthlyLaunchRps, "Additional peak RPS per month", 0, 1e9);
    number(s.headroom, "Spare headroom %", 0, 80);
    text(s.profile, "Performance profile assumptions");
    if (!["historical", "drivers"].includes(s.demandMethod)) fail("Choose historical growth or demand drivers.");
    if (typeof s.benchmarkId !== "string") fail("Benchmark selection must be a string.");
    text(s.workloadKey, "Workload configuration key");
    number(s.inputTokens, "Input tokens", 0, 1e7);
    number(s.outputTokens, "Output tokens", 0, 1e7);
    if (!s.drivers) fail("Demand-driver inputs are required.");
    number(s.drivers.activeUsers, "Daily active users", 0, 1e12, true);
    number(s.drivers.sessionsPerUser, "Sessions per user per day", 0, 1000);
    number(s.drivers.requestsPerSession, "Requests per session", 0, 10000);
    number(s.drivers.callsPerRequest, "Backend calls per request", 0, 1000);
    number(s.drivers.cacheHitPct, "Cache hit %", 0, 100);
    number(s.drivers.peakToAverage, "Peak-to-average ratio", 1, 1000);
  }
  function benchmarkCheck(b) {
    text(b.id, "Profile ID"); text(b.name, "Profile name"); pool(b.pool);
    text(b.workloadKey, "Workload configuration key");
    text(b.evidence, "Benchmark evidence / assumptions");
    date(b.measuredOn);
    if (!["synthetic", "user-benchmark"].includes(b.source)) fail("Unknown performance evidence source.");
    number(b.gpusPerReplica, "Profile GPUs per replica", 1, 1024, true);
    number(b.rpsPerReplica, "Profile RPS at SLO", 0.0001, 1e9);
    number(b.minInputTokens, "Minimum input tokens", 0, 1e7);
    number(b.maxInputTokens, "Maximum input tokens", b.minInputTokens, 1e7);
    number(b.minOutputTokens, "Minimum output tokens", 0, 1e7);
    number(b.maxOutputTokens, "Maximum output tokens", b.minOutputTokens, 1e7);
  }
  function recordCheck(r, services) {
    date(r.date);
    if (!services.some(s => s.id === r.serviceId)) fail("Consumption references an unknown service.");
    number(r.gpuHours, "Allocated GPU-hours", 0, 240000000);
    number(r.activity, "Activity %", 0, 100);
    number(r.peakRps, "Peak RPS", 0, 1e9);
    number(r.requests, "Daily requests", 0, 1e15, true);
    if (r.requests > r.peakRps * 86400 + 1) fail("Daily requests cannot exceed peak RPS multiplied by a day.");
    if (!["synthetic", "user-entered"].includes(r.source)) fail("Unknown consumption provenance.");
  }
  function trainingCheck(t, services) {
    text(t.id, "Plan ID"); text(t.name, "Training plan name");
    if (!services.some(s => s.id === t.serviceId)) fail("Training plan references an unknown service.");
    pool(t.pool); month(t.month);
    number(t.parametersB, "Parameters (billions)", 0.001, 10000);
    number(t.tokensB, "Training tokens (billions)", 0.001, 1e7);
    number(t.days, "Active training days", 0.01, 31);
    const daysInMonth = new Date(Date.UTC(+t.month.slice(0, 4), +t.month.slice(5, 7), 0)).getUTCDate();
    if (t.days > daysInMonth) fail("Active training days exceed days in the chosen month.");
    number(t.peakTflops, "Dense peak TFLOP/s per GPU", 1, 100000);
    number(t.mfu, "Model FLOPs utilization %", 1, 100);
    number(t.memoryGB, "Memory per GPU (GB)", 1, 10000);
    number(t.bytesPerParameter, "Training-state bytes per parameter", 1, 100);
    number(t.block, "Topology block size", 1, 65536, true);
    number(t.runs, "Concurrent runs", 1, 1000, true);
  }
  function validate(state) {
    state = upgrade(state);
    if (!state || state.version !== 2) fail("Unsupported workspace version.");
    month(state.startMonth);
    if (!Array.isArray(state.services) || !state.services.length || state.services.length > 1000) fail("Workspace requires 1–1,000 services.");
    if (!Array.isArray(state.records) || state.records.length > 100000) fail("At most 100,000 consumption rows are supported.");
    if (!Array.isArray(state.training) || state.training.length > 1000) fail("At most 1,000 training plans are supported.");
    state.services.forEach(serviceCheck);
    if (!Array.isArray(state.benchmarks) || state.benchmarks.length > 1000) fail("At most 1,000 performance profiles are supported.");
    state.benchmarks.forEach(benchmarkCheck);
    if (new Set(state.benchmarks.map(b => b.id)).size !== state.benchmarks.length) fail("Performance profile IDs must be unique.");
    for (const service of state.services) {
      if (service.benchmarkId && !state.benchmarks.some(b => b.id === service.benchmarkId)) fail("Service references an unknown performance profile.");
    }
    if (new Set(state.services.map(s => s.id)).size !== state.services.length) fail("Service IDs must be unique.");
    const keys = new Set();
    state.records.forEach(r => {
      recordCheck(r, state.services);
      const key = `${r.serviceId}|${r.date}`;
      if (keys.has(key)) fail("Only one daily consumption row per service is allowed.");
      keys.add(key);
    });
    state.training.forEach(t => trainingCheck(t, state.services));
    if (new Set(state.training.map(t => t.id)).size !== state.training.length) fail("Training plan IDs must be unique.");
    if (!state.supply || !Array.isArray(state.supply.additions)) fail("Supply inputs are required.");
    for (const p of POOLS) {
      const s = state.supply[p];
      if (!s) fail(`Missing supply for ${p}.`);
      number(s.installed, "Installed GPUs", 0, 1e7, true);
      number(s.unavailable, "Unavailable GPUs", 0, s.installed, true);
      number(s.reserve, "Protected reserve GPUs", 0, s.installed - s.unavailable, true);
    }
    if (state.supply.additions.length > 1000) fail("Too many capacity additions.");
    state.supply.additions.forEach(a => { pool(a.pool); month(a.month); number(a.gpus, "Commissioned addition", 1, 1e7, true); });
    return state;
  }
  function months(start, count = 6) {
    month(start);
    const [year, m] = start.split("-").map(Number);
    return Array.from({length: count}, (_, i) => new Date(Date.UTC(year, m - 1 + i, 1)).toISOString().slice(0, 7));
  }
  function growth(current, previous) {
    return previous > 0 ? (current / previous - 1) * 100 : null;
  }
  function trend(records, weekly) {
    const groups = new Map();
    for (const r of records) {
      const d = new Date(`${r.date}T00:00:00Z`);
      if (weekly) d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
      const key = d.toISOString().slice(0, 10);
      if (!groups.has(key)) groups.set(key, {date: key, gpuHours: 0, requests: 0, activityWeight: 0, days: new Set()});
      const g = groups.get(key);
      g.gpuHours += r.gpuHours; g.requests += r.requests;
      g.activityWeight += r.activity * r.gpuHours; g.days.add(r.date);
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)).map(g => ({
      date: g.date, gpuHours: g.gpuHours, requests: g.requests,
      averageAllocated: g.gpuHours / (24 * g.days.size),
      activity: g.gpuHours ? g.activityWeight / g.gpuHours : null, observedDays: g.days.size
    }));
  }
  function baseline(state, id) {
    const rows = state.records.filter(r => r.serviceId === id && r.date < `${state.startMonth}-01`).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return null;
    const end = rows.at(-1).date;
    const start = new Date(Date.parse(end) - 27 * DAY).toISOString().slice(0, 10);
    const selected = rows.filter(r => r.date >= start);
    return {
      peakRps: Math.max(...selected.map(r => r.peakRps)),
      averageAllocated: selected.reduce((n, r) => n + r.gpuHours, 0) / selected.length / 24,
      days: selected.length, end,
    };
  }
  function inference(state, service, index) {
    const base = baseline(state, service.id);
    if (service.demandMethod === "historical" && !base) return {available: false, reason: "No consumption baseline; enter daily data.", gpus: null, peakRps: null};
    const m = index + 1;
    let organicRps;
    if (service.demandMethod === "drivers") {
      const d = service.drivers;
      organicRps = d.activeUsers * (1 + service.annualGrowth / 100) ** (m / 12) *
        d.sessionsPerUser * d.requestsPerSession * d.callsPerRequest *
        (1 - d.cacheHitPct / 100) / 86400 * d.peakToAverage;
    } else organicRps = base.peakRps * (1 + service.annualGrowth / 100) ** (m / 12);
    const launchRps = service.monthlyLaunchRps * m;
    const peakRps = organicRps + launchRps;
    const performance = profileFor(state, service);
    if (!performance.available) return {...performance, gpus: null, peakRps, organicRps, launchRps, base};
    const replicas = Math.ceil(peakRps / (1 - service.headroom / 100) / performance.rpsPerReplica);
    return {available: true, peakRps, organicRps, launchRps, replicas,
      gpus: replicas * performance.gpusPerReplica, base, performance};
  }
  function profileFor(state, service) {
    if (!service.benchmarkId) return {available: true, source: "inline-assumption",
      name: "Inline service assumption", rpsPerReplica: service.rpsPerReplica, gpusPerReplica: service.gpusPerReplica};
    const b = state.benchmarks.find(b => b.id === service.benchmarkId);
    if (!b) return {available: false, reason: "Selected performance profile no longer exists."};
    if (b.pool !== service.pool || b.workloadKey !== service.workloadKey) {
      return {available: false, reason: "Performance profile pool/configuration does not match the service."};
    }
    if (b.measuredOn >= `${state.startMonth}-01`) {
      return {available: false, reason: "Performance evidence is dated on or after planning starts; choose earlier evidence or a later planning window."};
    }
    if (service.inputTokens < b.minInputTokens || service.inputTokens > b.maxInputTokens ||
        service.outputTokens < b.minOutputTokens || service.outputTokens > b.maxOutputTokens) {
      return {available: false, reason: "Token mix lies outside the performance profile validity range; benchmark this configuration."};
    }
    return {...b, available: true};
  }
  const FORECAST_MODELS = ["last_day", "seasonal_7d", "rolling_28d"];
  function predictPeak(history, target, method) {
    date(target);
    const values = [];
    for (let offset = 1; offset <= 28; offset++) {
      const key = new Date(Date.parse(target) - offset * DAY).toISOString().slice(0, 10);
      if (!history.has(key)) return null;
      values.push(history.get(key));
    }
    if (method === "last_day") return values[0];
    if (method === "seasonal_7d") return values[6];
    if (method === "rolling_28d") return values.reduce((n, value) => n + value, 0) / 28;
    fail("Unknown peak-demand forecast method.");
  }
  function forecastEvidence(state, serviceId) {
    const rows = state.records.filter(r => r.serviceId === serviceId && r.date < `${state.startMonth}-01`)
      .sort((a, b) => a.date.localeCompare(b.date));
    const history = new Map(rows.map(r => [r.date, r.peakRps]));
    const folds = rows.filter(r => predictPeak(history, r.date, "last_day") !== null);
    if (folds.length < 14) return {available: false, reason: "Need at least 14 evaluation days, each with 28 complete preceding daily records (minimum 42 continuous days).", evaluationDays: folds.length};
    const validationSize = Math.max(7, Math.min(folds.length - 7, Math.floor(folds.length * 2 / 3)));
    const scored = FORECAST_MODELS.map(method => {
      const predictions = folds.map((r, i) => ({date: r.date, actual: r.peakRps,
        predicted: predictPeak(history, r.date, method), split: i < validationSize ? "validation" : "held_out"}));
      const score = split => {
        const selected = predictions.filter(p => p.split === split);
        const absolute = selected.reduce((n, p) => n + Math.abs(p.predicted - p.actual), 0);
        const total = selected.reduce((n, p) => n + p.actual, 0);
        return {days: selected.length, mae: absolute / selected.length,
          bias: selected.reduce((n, p) => n + p.predicted - p.actual, 0) / selected.length,
          wape: total > 0 ? absolute / total : null};
      };
      return {method, validation: score("validation"), heldOut: score("held_out"), predictions};
    });
    const best = [...scored].sort((a, b) => a.validation.mae - b.validation.mae)[0];
    const nextDate = new Date(Date.parse(rows.at(-1).date) + DAY).toISOString().slice(0, 10);
    return {available: true, selected: best.method, scored, evaluationDays: folds.length,
      nextDate, nextPeakRps: predictPeak(history, nextDate, best.method),
      source: rows.every(r => r.source === "synthetic") ? "synthetic" : "user-entered/mixed",
      horizon: "One-day-ahead daily peak RPS; not a six-month capacity forecast.",
      predictions: best.predictions.filter(p => p.split === "held_out")};
  }
  function training(plan) {
    const flops = 6 * plan.parametersB * 1e9 * plan.tokensB * 1e9;
    const effectiveFlops = plan.peakTflops * 1e12 * plan.mfu / 100;
    const computeGpus = Math.ceil(flops / (plan.days * 86400 * effectiveFlops));
    const memoryGpus = Math.ceil(plan.parametersB * 1e9 * plan.bytesPerParameter / (plan.memoryGB * 1e9));
    const gang = Math.ceil(Math.max(computeGpus, memoryGpus) / plan.block) * plan.block;
    return {
      flops, computeGpus, memoryGpus, gang, totalGpus: gang * plan.runs,
      activeRuntimeDays: flops / (gang * effectiveFlops) / 86400,
      reservedGpuHours: gang * plan.runs * plan.days * 24,
      warning: "Dense pretraining only. Memory screen excludes activations/buffers; MFU and topology feasibility need calibration.",
    };
  }
  function portfolio(state, selectedId = "all", selectedTeam = "all") {
    return months(state.startMonth).map((m, index) => {
      const pools = POOLS.map(p => {
        const services = state.services.filter(s => s.pool === p && (selectedId === "all" || s.id === selectedId) &&
          (selectedTeam === "all" || s.team === selectedTeam));
        const estimates = services.map(s => inference(state, s, index));
        const missing = estimates.filter(e => !e.available).length;
        const inferenceGpus = estimates.reduce((n, e) => n + (e.gpus ?? 0), 0);
        const trainingGpus = state.training.filter(t => t.pool === p && t.month === m &&
          (selectedId === "all" || t.serviceId === selectedId) &&
          (selectedTeam === "all" || state.services.find(s => s.id === t.serviceId).team === selectedTeam)
        ).reduce((n, t) => n + training(t).totalGpus, 0);
        const supply = state.supply[p];
        const additions = state.supply.additions.filter(a => a.pool === p && a.month <= m).reduce((n, a) => n + a.gpus, 0);
        const usable = supply.installed - supply.unavailable - supply.reserve + additions;
        const required = inferenceGpus + trainingGpus;
        return {pool: p, month: m, inference: inferenceGpus, training: trainingGpus, required, usable,
          gap: required - usable, missing, complete: missing === 0};
      });
      return {month: m, pools, required: pools.reduce((n, p) => n + p.required, 0),
        usable: pools.reduce((n, p) => n + p.usable, 0), complete: pools.every(p => p.complete)};
    });
  }
  function comparePeriods(records, start, end, years) {
    date(start); date(end);
    const shift = (value) => {
      const d = new Date(`${value}T00:00:00Z`);
      const oldMonth = d.getUTCMonth();
      d.setUTCFullYear(d.getUTCFullYear() - years);
      if (d.getUTCMonth() !== oldMonth) d.setUTCDate(0);
      return d.toISOString().slice(0, 10);
    };
    const oldStart = shift(start), oldEnd = shift(end);
    const current = records.filter(r => r.date >= start && r.date <= end);
    const old = records.filter(r => r.date >= oldStart && r.date <= oldEnd);
    const serviceIds = [...new Set(current.map(r => r.serviceId))];
    if (!serviceIds.length) return null;
    function complete(rows, a, b) {
      const days = Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
      return serviceIds.every(id => rows.filter(r => r.serviceId === id).length === days);
    }
    if (!complete(current, start, end) || !complete(old, oldStart, oldEnd)) return null;
    return growth(current.reduce((n, r) => n + r.gpuHours, 0), old.filter(r => serviceIds.includes(r.serviceId)).reduce((n, r) => n + r.gpuHours, 0));
  }
  function demo() {
    const defs = [
      ["assistant", "Enterprise Assistant", "Applied AI", "H200", 8, 24, 90, 15000],
      ["search", "Semantic Search", "Search & Discovery", "H100", 4, 90, 45, 60000],
      ["copilot", "Code Intelligence", "Developer Platforms", "B200", 8, 30, 120, 18000],
      ["vision", "Vision Understanding", "Multimodal AI", "H100", 4, 50, 60, 20000],
      ["recommend", "Recommendations", "Personalization", "H200", 4, 120, 30, 80000],
      ["agents", "Agent Runtime", "Applied AI", "B200", 8, 20, 150, 10000],
    ];
    const services = defs.map(([id, name, team, p, gpus, rps, annualGrowth]) => ({
      id, name, team, pool: p, gpusPerReplica: gpus, rpsPerReplica: rps,
      annualGrowth, monthlyLaunchRps: 0, headroom: 20,
      profile: "Illustrative RPS-at-SLO; not benchmarked. Replace with matching model/runtime/latency measurements.",
    }));
    const records = [];
    for (let day = 0; day < 60; day++) {
      const stamp = new Date(Date.UTC(2026, 8, 11) + day * DAY).toISOString().slice(0, 10);
      defs.forEach((d, i) => {
        const peakRps = Math.round(d[7] * 4 * (0.72 + day * 0.0045) * (1 + 0.045 * Math.sin(day * 0.5 + i)));
        const allocated = Math.ceil(peakRps / d[5] * d[4] * 1.18 / 8) * 8;
        records.push({date: stamp, serviceId: d[0], gpuHours: allocated * 24,
          activity: Math.round(54 + i * 3 + 9 * Math.sin(day / 6 + i)),
          peakRps, requests: Math.round(peakRps * 86400 * 0.36), source: "synthetic"});
      });
    }
    return validate({
      version: 2, startMonth: "2026-12",
      services: services.map(s => ({...s, demandMethod: "historical", drivers: defaultDrivers(),
        benchmarkId: "", workloadKey: `${s.id}-demo-fp16-slo`, inputTokens: 1024, outputTokens: 256})),
      benchmarks: services.map(s => ({
        id: `profile-${s.id}`, name: `${s.name} demo profile`, pool: s.pool,
        workloadKey: `${s.id}-demo-fp16-slo`, gpusPerReplica: s.gpusPerReplica,
        rpsPerReplica: s.rpsPerReplica, minInputTokens: 0, maxInputTokens: 2048,
        minOutputTokens: 0, maxOutputTokens: 512, measuredOn: "2026-11-09",
        source: "synthetic", evidence: "Illustrative only; not a real hardware benchmark. Match model, precision, runtime and latency SLO.",
      })), records,
      training: [
        {id: "train-1", name: "Foundation model refresh", serviceId: "assistant", pool: "H200", month: "2027-01",
          parametersB: 405, tokensB: 2000, days: 12, peakTflops: 989, mfu: 40, memoryGB: 141, bytesPerParameter: 16, block: 256, runs: 2},
        {id: "train-2", name: "Code model pretraining", serviceId: "copilot", pool: "B200", month: "2027-03",
          parametersB: 200, tokensB: 3000, days: 14, peakTflops: 2250, mfu: 40, memoryGB: 180, bytesPerParameter: 16, block: 256, runs: 2},
      ],
      supply: {
        H100: {installed: 80000, unavailable: 5000, reserve: 4000},
        H200: {installed: 64000, unavailable: 4000, reserve: 3200},
        B200: {installed: 56000, unavailable: 6000, reserve: 2800},
        additions: [{pool: "H200", month: "2027-02", gpus: 8192}],
      },
    });
  }
  const api = {POOLS, validate, upgrade, defaultDrivers, number, date, months, growth, trend, baseline,
    inference, profileFor, FORECAST_MODELS, predictPeak, forecastEvidence, training, portfolio, comparePeriods, demo};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CapacityModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
