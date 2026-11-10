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
  function serviceCheck(s) {
    text(s.id, "Service ID"); text(s.name, "Service name"); text(s.team, "Team");
    pool(s.pool);
    number(s.gpusPerReplica, "GPUs per replica", 1, 1024, true);
    number(s.rpsPerReplica, "Sustainable RPS per replica", 0.0001, 1e9);
    number(s.annualGrowth, "Annual demand growth %", -90, 1000);
    number(s.monthlyLaunchRps, "Additional peak RPS per month", 0, 1e9);
    number(s.headroom, "Spare headroom %", 0, 80);
    text(s.profile, "Performance profile assumptions");
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
    if (!state || state.version !== 1) fail("Unsupported workspace version.");
    month(state.startMonth);
    if (!Array.isArray(state.services) || !state.services.length || state.services.length > 1000) fail("Workspace requires 1–1,000 services.");
    if (!Array.isArray(state.records) || state.records.length > 100000) fail("At most 100,000 consumption rows are supported.");
    if (!Array.isArray(state.training) || state.training.length > 1000) fail("At most 1,000 training plans are supported.");
    state.services.forEach(serviceCheck);
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
    if (!base) return {available: false, reason: "No consumption baseline; enter daily data.", gpus: null, peakRps: null};
    const peakRps = base.peakRps * (1 + service.annualGrowth / 100) ** ((index + 1) / 12) +
      service.monthlyLaunchRps * (index + 1);
    const replicas = Math.ceil(peakRps / (1 - service.headroom / 100) / service.rpsPerReplica);
    return {available: true, peakRps, replicas, gpus: replicas * service.gpusPerReplica, base};
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
      version: 1, startMonth: "2026-12", services, records,
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
  const api = {POOLS, validate, number, date, months, growth, trend, baseline, inference, training, portfolio, comparePeriods, demo};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CapacityModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
