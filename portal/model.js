(function (root) {
  "use strict";
  const SKU_CATALOG = [
    {id: "H100-SXM-80GB", name: "H100 SXM 80GB", family: "H100", memoryGB: 80, memoryType: "HBM3", formFactor: "SXM", source: "https://www.nvidia.com/en-us/data-center/h100/"},
    {id: "H100-PCIE-80GB", name: "H100 PCIe 80GB", family: "H100", memoryGB: 80, memoryType: "HBM2e", formFactor: "PCIe", source: "https://www.nvidia.com/en-us/data-center/h100/"},
    {id: "H200-SXM-141GB", name: "H200 SXM 141GB", family: "H200", memoryGB: 141, memoryType: "HBM3e", formFactor: "SXM", source: "https://www.nvidia.com/en-us/data-center/h200/"},
    {id: "B200-SXM-180GB", name: "B200 SXM 180GB", family: "B200", memoryGB: 180, memoryType: "HBM3e", formFactor: "SXM", source: "https://docs.nvidia.com/dgx/dgxb200-user-guide/introduction-to-dgxb200.html"},
    {id: "RTX-PRO-6000-BW-SERVER-96GB", name: "RTX PRO 6000 Blackwell Server 96GB", family: "RTX PRO", memoryGB: 96, memoryType: "GDDR7", formFactor: "PCIe", source: "https://www.nvidia.com/en-us/data-center/rtx-pro-6000-blackwell-server-edition/"},
    ...["H100", "H200", "B200"].map(id => ({id, name: `${id} - variant not specified`, family: id,
      memoryGB: null, memoryType: "Unspecified", formFactor: "Unspecified", legacy: true, source: ""})),
  ];
  const POOLS = SKU_CATALOG.map(s => s.id);
  const WORKLOAD_AREAS = [
    {name: "Nemotron / NIM", description: "Language-model training, evaluation and inference. The demo tracks model-serving requests.", source: "https://www.nvidia.com/en-us/ai-data-science/foundation-models/nemotron/"},
    {name: "DRIVE / Alpamayo", description: "Autonomous-driving model development and cloud evaluation. Training and simulation are data-center work; in-vehicle DRIVE inference is separate.", source: "https://blogs.nvidia.com/blog/robotaxi-leaders-full-stack-open-platform/"},
    {name: "Isaac / GR00T", description: "Robot-model development, simulation and policy evaluation. On-robot Jetson inference is separate from the server fleet.", source: "https://developer.nvidia.com/isaac/gr00t"},
    {name: "Cosmos", description: "World models, synthetic video generation and physical-AI evaluation.", source: "https://www.nvidia.com/en-us/ai/cosmos/"},
    {name: "Omniverse", description: "Rendering, physics, digital twins and synthetic sensor data.", source: "https://www.nvidia.com/en-us/omniverse/"},
    {name: "BioNeMo", description: "Biomolecular model training, protein design and drug-discovery inference.", source: "https://www.nvidia.com/en-us/clara/bionemo/"},
    {name: "ChipNeMo", description: "NVIDIA's published research on language models for chip-design assistance.", source: "https://blogs.nvidia.com/blog/llm-semiconductors-chip-nemo/"},
  ];
  const DAY = 86400000;
  const NORMALIZATION_REFERENCE = "H100-SXM-80GB";
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
    if (!POOLS.includes(value)) fail("Choose a supported GPU SKU; variants cannot be substituted automatically.");
  }
  function skuInfo(id) {
    pool(id);
    return SKU_CATALOG.find(s => s.id === id);
  }
  function emptySupply() {
    return {...Object.fromEntries(POOLS.map(p => [p, {installed: 0, unavailable: 0, reserve: 0}])), additions: []};
  }
  function activePools(state) {
    return POOLS.filter(p => state.supply[p].installed > 0 || state.services.some(s => s.pool === p) ||
      state.training.some(t => t.pool === p) || state.supply.additions.some(a => a.pool === p) ||
      state.segmentBudgets?.some(b => b.pool === p));
  }
  function defaultDrivers() {
    return {activeUsers: 10000000, sessionsPerUser: 2, requestsPerSession: 5,
      callsPerRequest: 1, cacheHitPct: 0, peakToAverage: 3};
  }
  function defaultForecast() {
    return {trafficAdjustmentPct: 0, throughputChangePct: 0, includeLaunches: true, includeTraining: true};
  }
  function forecastCheck(options) {
    number(options.trafficAdjustmentPct, "Forecast traffic adjustment %", -90, 300);
    number(options.throughputChangePct, "Serving throughput change %", -50, 300);
    for (const key of ["includeLaunches", "includeTraining"]) {
      if (typeof options[key] !== "boolean") fail("Forecast plan switches must be true or false.");
    }
  }
  function upgrade(state) {
    if (state?.version === 1) {
      if (!Array.isArray(state.services)) fail("Legacy workspace requires services.");
      state = {...state, version: 2, benchmarks: [], services: state.services.map(s => ({
        ...s, demandMethod: "historical", drivers: defaultDrivers(), benchmarkId: "",
        workloadKey: s.id, inputTokens: 1024, outputTokens: 256,
      }))};
    }
    if (state?.version === 2) {
      if (!state.supply || !Array.isArray(state.supply.additions)) fail("Legacy workspace requires supply inputs.");
      for (const p of ["H100", "H200", "B200"]) {
        if (!state.supply[p]) fail(`Missing legacy supply for ${p}.`);
      }
      return {...state, version: 3, supply: {...emptySupply(), ...state.supply}};
    }
    return state;
  }
  function serviceCheck(s) {
    text(s.id, "Service ID"); text(s.name, "Service name"); text(s.team, "Team");
    pool(s.pool);
    number(s.gpusPerReplica, "GPUs per replica", 1, 1024, true);
    number(s.rpsPerReplica, "Sustainable RPS per replica", 0.0001, 1e9);
    number(s.annualGrowth, "Annual demand growth %", -90, 1000);
    if (s.scenarioGrowthPct !== undefined) number(s.scenarioGrowthPct, "Extra demand by month six %", -90, 300);
    if (s.normalization !== undefined) normalizationCheck(s.normalization);
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
    const hardware = skuInfo(t.pool);
    if (hardware.memoryGB !== null && t.memoryGB > hardware.memoryGB) fail(`Memory budget exceeds ${hardware.name}'s ${hardware.memoryGB} GB per GPU.`);
    number(t.bytesPerParameter, "Training-state bytes per parameter", 1, 100);
    number(t.block, "Topology block size", 1, 65536, true);
    number(t.runs, "Concurrent runs", 1, 1000, true);
    if (t.scenarioGrowthPct !== undefined) number(t.scenarioGrowthPct, "Extra concurrent training runs by month six %", -90, 300);
  }
  function validate(state) {
    state = upgrade(state);
    if (!state || state.version !== 3) fail("Unsupported workspace version.");
    month(state.startMonth);
    if (state.forecast !== undefined) forecastCheck(state.forecast);
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
    state.training.forEach(t => {
      trainingCheck(t, state.services);
      if (t.normalization !== undefined) normalizationCheck(t.normalization);
    });
    if (new Set(state.training.map(t => t.id)).size !== state.training.length) fail("Training plan IDs must be unique.");
    if (!state.supply || !Array.isArray(state.supply.additions)) fail("Supply inputs are required.");
    if (Object.keys(state.supply).some(p => p !== "additions" && !POOLS.includes(p))) fail("Supply references an unknown GPU SKU.");
    for (const p of POOLS) {
      const s = state.supply[p];
      if (!s) fail(`Missing supply for ${p}.`);
      number(s.installed, "Installed GPUs", 0, 1e7, true);
      number(s.unavailable, "Unavailable GPUs", 0, s.installed, true);
      number(s.reserve, "Protected reserve GPUs", 0, s.installed - s.unavailable, true);
      if (s.inferenceBudgetPct !== undefined) number(s.inferenceBudgetPct, "Inference capacity budget %", 0, 100);
      for (const kind of ["inference", "training"]) {
        if (s[`${kind}Available`] !== undefined) number(s[`${kind}Available`], `${kind} available GPUs`, 0, 1e9, true);
      }
    }
    if (state.supply.additions.length > 1000) fail("Too many capacity additions.");
    state.supply.additions.forEach(a => { pool(a.pool); month(a.month); number(a.gpus, "Commissioned addition", 1, 1e7, true); });
    for (const p of POOLS) {
      const capacity = segmentCapacity(state, p);
      if ((capacity.inference ?? 0) + (capacity.training ?? 0) > capacity.usable) {
        fail(`Inference and training available counts exceed usable supply for ${p} at planning start.`);
      }
    }
    if (state.segmentBudgets !== undefined) {
      if (!Array.isArray(state.segmentBudgets) || state.segmentBudgets.length > 20000) fail("At most 20,000 segment budget overrides are supported.");
      const budgets = new Set();
      for (const b of state.segmentBudgets) {
        pool(b.pool); month(b.month);
        if (b.serviceId !== "all" && !state.services.some(s => s.id === b.serviceId)) fail("Budget references an unknown service.");
        if (b.team !== "all" && !state.services.some(s => s.team === b.team)) fail("Budget references an unknown organization.");
        if (b.serviceId !== "all" && b.team !== "all" && !state.services.some(s => s.id === b.serviceId && s.team === b.team)) fail("Budget service and organization do not match.");
        if (b.inference === undefined && b.training === undefined) fail("Budget override requires an inference or training target.");
        for (const kind of ["inference", "training"]) if (b[kind] !== undefined) number(b[kind], `${kind} GPU budget`, 0, 1e9, true);
        const key = JSON.stringify([b.pool, b.month, b.serviceId, b.team]);
        if (budgets.has(key)) fail("Duplicate segment budget override.");
        budgets.add(key);
      }
    }
    return state;
  }
  function segmentCapacity(state, p) {
    const supply = state.supply[p];
    const usable = supply.installed - supply.unavailable - supply.reserve +
      state.supply.additions.filter(a => a.pool === p && a.month <= state.startMonth).reduce((n, a) => n + a.gpus, 0);
    const legacyInference = supply.inferenceBudgetPct === undefined ? null : Math.floor(usable * supply.inferenceBudgetPct / 100);
    return {usable, inference: supply.inferenceAvailable ?? legacyInference,
      training: supply.trainingAvailable ?? (legacyInference === null ? null : usable - legacyInference)};
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
  function serviceDemandHistory(state, id) {
    if (!state.services.some(s => s.id === id)) fail("Choose an existing service for demand history.");
    const current = baseline(state, id);
    if (!current) return {current: null, currentStart: null, previousStart: null, previousEnd: null,
      previousDays: 0, previousPeakRps: null, observedGrowthPct: null,
      observedGrowthReason: "No consumption observations before planning starts.", observations: []};
    const end = Date.parse(current.end);
    const stamp = offset => new Date(end - offset * DAY).toISOString().slice(0, 10);
    const byDate = new Map(state.records.filter(r => r.serviceId === id && r.date >= stamp(55) && r.date <= current.end)
      .map(r => [r.date, r]));
    const observations = Array.from({length: 56}, (_, i) => {
      const date = stamp(55 - i);
      return {date, peakRps: byDate.get(date)?.peakRps ?? null};
    });
    const previous = observations.slice(0, 28).filter(r => r.peakRps !== null);
    const previousPeakRps = previous.length ? Math.max(...previous.map(r => r.peakRps)) : null;
    const complete = current.days === 28 && previous.length === 28;
    const observedGrowthPct = complete ? growth(current.peakRps, previousPeakRps) : null;
    return {current, currentStart: stamp(27), previousStart: stamp(55), previousEnd: stamp(28),
      previousDays: previous.length, previousPeakRps, observedGrowthPct,
      observedGrowthReason: !complete ? `Need two complete 28-day windows: recent ${current.days}/28 days; previous ${previous.length}/28 days.` :
        previousPeakRps === 0 ? "The previous 28-day peak is zero; percentage growth is unavailable." : "",
      observations};
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
  function fitTraffic(rows, method) {
    const count = Math.floor(Math.min(rows.length, method === "recent_average" ? 28 : 84) / 7) * 7;
    const sample = rows.slice(-count);
    const weeks = Array.from({length: count / 7}, (_, i) => ({
      x: i * 7 + 3, y: sample.slice(i * 7, i * 7 + 7).reduce((n, r) => n + r.peakRps, 0) / 7
    }));
    const meanX = weeks.reduce((n, w) => n + w.x, 0) / weeks.length;
    const meanY = weeks.reduce((n, w) => n + w.y, 0) / weeks.length;
    const slope = method === "linear_trend" ? weeks.reduce((n, w) => n + (w.x - meanX) * (w.y - meanY), 0) /
      weeks.reduce((n, w) => n + (w.x - meanX) ** 2, 0) : 0;
    const intercept = meanY - slope * meanX;
    const weekday = Array.from({length: 7}, (_, day) => {
      const residuals = sample.map((r, i) => ({day: new Date(r.date).getUTCDay(), residual: r.peakRps - intercept - slope * i}))
        .filter(r => r.day === day);
      return residuals.reduce((n, r) => n + r.residual, 0) / residuals.length;
    });
    return {level: intercept + slope * (count - 1), slope, weekday, end: sample.at(-1).date};
  }
  function projectTraffic(fit, target) {
    return Math.max(0, fit.level + fit.slope * ((Date.parse(target) - Date.parse(fit.end)) / DAY) +
      fit.weekday[new Date(target).getUTCDay()]);
  }
  function trafficForecast(state, serviceId) {
    const eligible = state.records.filter(r => r.serviceId === serviceId && r.date < `${state.startMonth}-01`)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!eligible.length) return {available: false, reason: "Add at least 42 consecutive daily observations to learn this service's traffic."};
    const history = new Map(eligible.map(r => [r.date, r]));
    const lastDate = eligible.at(-1).date;
    const rows = [];
    for (let offset = 0; offset < 84; offset++) {
      const key = new Date(Date.parse(lastDate) - offset * DAY).toISOString().slice(0, 10);
      if (!history.has(key)) break;
      rows.unshift(history.get(key));
    }
    if (rows.length < 42) return {available: false, observedDays: rows.length, lastDate,
      reason: `Only ${rows.length} consecutive recent days. Need 42; missing days are not filled with zero.`};
    const train = rows.slice(0, -14), holdout = rows.slice(-14);
    const scores = ["recent_average", "linear_trend"].map(method => {
      const fit = fitTraffic(train, method);
      const predictions = holdout.map(r => ({date: r.date, actual: r.peakRps, predicted: projectTraffic(fit, r.date)}));
      const absolute = predictions.reduce((n, p) => n + Math.abs(p.predicted - p.actual), 0);
      const total = predictions.reduce((n, p) => n + p.actual, 0);
      return {method, mae: absolute / 14, wape: total ? absolute / total : null, predictions};
    });
    const best = [...scores].sort((a, b) => a.mae - b.mae)[0];
    const fit = fitTraffic(rows, best.method);
    const monthly = months(state.startMonth).map(m => {
      const next = months(m, 2)[1];
      const daily = [];
      for (let stamp = Date.parse(`${m}-01`); stamp < Date.parse(`${next}-01`); stamp += DAY) {
        const target = new Date(stamp).toISOString().slice(0, 10);
        daily.push({date: target, peakRps: projectTraffic(fit, target)});
      }
      return {month: m, peakRps: Math.max(...daily.map(p => p.peakRps)), daily};
    });
    return {available: true, source: "history", method: best.method, fit, scores, monthly,
      observedDays: rows.length, firstDate: rows[0].date, lastDate,
      gapDays: Math.round((Date.parse(`${state.startMonth}-01`) - Date.parse(lastDate)) / DAY) - 1,
      selectionDays: 14, selectedWape: best.wape};
  }
  function capacityForecast(state, selectedId = "all", selectedTeam = "all", selectedPool = "all") {
    const options = state.forecast || defaultForecast();
    forecastCheck(options);
    if (selectedPool !== "all") pool(selectedPool);
    const owners = state.services.filter(s => (selectedId === "all" || s.id === selectedId) &&
      (selectedTeam === "all" || s.team === selectedTeam));
    const services = owners.filter(s => selectedPool === "all" || s.pool === selectedPool);
    const evidence = services.map(service => {
      const history = trafficForecast(state, service.id);
      const demand = service.demandMethod === "drivers" ? {available: true, source: "drivers", method: "drivers",
        monthly: months(state.startMonth).map((m, i) => ({month: m, peakRps: inference(state, service, i).organicRps}))} : history;
      const performance = profileFor(state, service);
      return {service, history, demand, performance, available: demand.available && performance.available,
        reason: !demand.available ? demand.reason : !performance.available ? performance.reason : ""};
    });
    const monthly = months(state.startMonth).map((m, index) => {
      const pools = activePools(state).filter(p => selectedPool === "all" || p === selectedPool).map(p => {
        const entries = evidence.filter(e => e.service.pool === p);
        const estimates = entries.filter(e => e.available).map(e => {
          const baseRps = e.demand.monthly[index].peakRps;
          const launchRps = options.includeLaunches ? e.service.monthlyLaunchRps * (index + 1) : 0;
          const growthFactor = (1 + (e.service.scenarioGrowthPct ?? 0) / 100) ** ((index + 1) / 6);
          const peakRps = baseRps * growthFactor * (1 + options.trafficAdjustmentPct / 100) + launchRps;
          const usableShare = 1 - e.service.headroom / 100;
          const baselineGpus = Math.ceil(baseRps / usableShare / e.performance.rpsPerReplica) * e.performance.gpusPerReplica;
          const gpus = Math.ceil(peakRps / usableShare / (e.performance.rpsPerReplica *
            (1 + options.throughputChangePct / 100))) * e.performance.gpusPerReplica;
          const available = Number.isSafeInteger(baselineGpus) && Number.isSafeInteger(gpus);
          return {serviceId: e.service.id, baseRps, launchRps, growthFactor, peakRps, baselineGpus, gpus, available,
            reason: available ? "" : "GPU estimate exceeds the supported count range. Check traffic and serving throughput."};
        });
        const inferenceGpus = estimates.filter(e => e.available).reduce((n, e) => n + e.gpus, 0);
        const baselineInference = estimates.filter(e => e.available).reduce((n, e) => n + e.baselineGpus, 0);
        const trainingCounts = options.includeTraining ? state.training.filter(t => t.month === m && t.pool === p &&
          owners.some(s => s.id === t.serviceId)).map(t => training(t, state.startMonth).totalGpus) : [];
        const missing = entries.filter(e => !e.available).length + estimates.filter(e => !e.available).length +
          trainingCounts.filter(n => !Number.isSafeInteger(n)).length;
        const trainingGpus = trainingCounts.filter(Number.isSafeInteger).reduce((n, count) => n + count, 0);
        const supply = state.supply[p];
        const usable = supply.installed - supply.unavailable - supply.reserve +
          state.supply.additions.filter(a => a.pool === p && a.month <= m).reduce((n, a) => n + a.gpus, 0);
        const required = inferenceGpus + trainingGpus;
        const inferenceComplete = entries.every(e => e.available) && estimates.every(e => e.available);
        const trainingComplete = trainingCounts.every(Number.isSafeInteger);
        const have = segmentCapacity(state, p);
        const override = state.segmentBudgets?.find(b => b.pool === p && b.month === m &&
          b.serviceId === selectedId && b.team === selectedTeam);
        const inferenceBudget = override?.inference ?? (inferenceComplete ? inferenceGpus : null);
        const trainingBudget = !options.includeTraining ? 0 : override?.training ?? (trainingComplete ? trainingGpus : null);
        const budgetRequired = inferenceBudget === null || trainingBudget === null ? null : inferenceBudget + trainingBudget;
        return {month: m, pool: p, baselineInference, inference: inferenceGpus, training: trainingGpus, required,
          usable, gap: required - usable, missing, complete: missing === 0, estimates,
          inferenceComplete, trainingComplete, inferenceBudget, trainingBudget,
          inferenceHave: have.inference, trainingHave: have.training,
          inferenceBudgetSource: override?.inference !== undefined ? "manual" : "forecast",
          trainingBudgetSource: !options.includeTraining ? "excluded" : override?.training !== undefined ? "manual" : "forecast",
          inferenceGap: inferenceBudget !== null && have.inference !== null ? inferenceBudget - have.inference : null,
          trainingGap: trainingBudget !== null && have.training !== null ? trainingBudget - have.training : null,
          budgetRequired, budgetGap: budgetRequired === null ? null : budgetRequired - usable};
      });
      return {month: m, pools, baselineRequired: pools.reduce((n, p) => n + p.baselineInference, 0),
        required: pools.reduce((n, p) => n + p.required, 0), usable: pools.reduce((n, p) => n + p.usable, 0),
        complete: pools.every(p => p.complete)};
    });
    for (const entry of evidence) {
      const invalid = monthly.flatMap(m => m.pools).flatMap(p => p.estimates)
        .find(e => e.serviceId === entry.service.id && !e.available);
      if (invalid) {entry.available = false; entry.reason = invalid.reason;}
    }
    const records = state.records.filter(r => services.some(s => s.id === r.serviceId) && r.date < `${state.startMonth}-01`);
    const byDate = new Map();
    for (const r of records) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r);
    }
    const latestDate = records.map(r => r.date).sort().at(-1);
    const historyStart = new Date(`${state.startMonth}-01T00:00:00Z`);
    historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 1);
    const window = (start, end) => {
      const days = [...byDate.entries()].filter(([d]) => d >= start && d <= end);
      const expectedDays = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
      const completeDays = days.filter(([, rows]) => rows.length === services.length).length;
      return {actual: days.length && completeDays === days.length ? Math.max(...days.map(([, rows]) =>
        rows.reduce((n, r) => n + r.gpuHours / 24, 0))) : null,
        observedDays: days.length, completeDays, expectedDays, complete: completeDays === expectedDays};
    };
    const historical = months(historyStart.toISOString().slice(0, 7), 12).map(m => {
      const end = new Date(`${m}-01T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0);
      const monthEnd = end.toISOString().slice(0, 10);
      const partialMonth = latestDate?.startsWith(m) && latestDate < monthEnd;
      const periodEnd = partialMonth ? latestDate : monthEnd;
      const previousStart = new Date(`${m}-01T00:00:00Z`);
      previousStart.setUTCFullYear(previousStart.getUTCFullYear() - 1);
      const previousMonth = previousStart.toISOString().slice(0, 7);
      const previousEnd = new Date(previousStart);
      previousEnd.setUTCMonth(previousEnd.getUTCMonth() + 1);
      previousEnd.setUTCDate(0);
      if (partialMonth) previousEnd.setUTCDate(Math.min(Number(periodEnd.slice(8)), previousEnd.getUTCDate()));
      const previousPeriodEnd = previousEnd.toISOString().slice(0, 10);
      const current = window(`${m}-01`, periodEnd);
      const previous = window(`${previousMonth}-01`, previousPeriodEnd);
      const comparable = current.complete && previous.complete;
      const growthPct = comparable ? growth(current.actual, previous.actual) : null;
      return {month: m, ...current, periodEnd, previousMonth, previousPeriodEnd,
        previousActual: previous.actual, previousCompleteDays: previous.completeDays,
        previousExpectedDays: previous.expectedDays, comparisonComplete: comparable,
        gap: comparable ? current.actual - previous.actual : null,
        growthPct: Number.isFinite(growthPct) ? growthPct : null,
        comparisonReason: !current.complete ? `Current period has ${current.completeDays}/${current.expectedDays} full-service days.` :
          !previous.complete ? `Previous year has ${previous.completeDays}/${previous.expectedDays} full-service days.` :
          previous.actual === 0 ? "Previous-year value is zero; percentage gap is unavailable." :
          !Number.isFinite(growthPct) ? "Percentage gap exceeds the supported range." : ""};
    });
    return {options, services: evidence, monthly, historical};
  }
  function normalizationCheck(n) {
    if (!n || typeof n !== "object" || Array.isArray(n)) fail("Normalization requires a workload benchmark pair.");
    pool(n.sku);
    if (skuInfo(n.sku).legacy) fail("Normalization requires an exact GPU SKU, not an unspecified variant.");
    if (n.referenceSku !== NORMALIZATION_REFERENCE) fail("Normalization reference must be H100 SXM 80GB.");
    number(n.selectedRate, "Selected-SKU benchmark rate per GPU", 0.000000001, 1e12);
    number(n.referenceRate, "H100 benchmark rate per GPU", 0.000000001, 1e12);
    if (n.sku === n.referenceSku && n.selectedRate !== n.referenceRate) fail("Identical SKUs must use identical benchmark rates.");
    date(n.measuredOn);
    text(n.evidence, "Normalization benchmark evidence");
    if (!["synthetic", "user-benchmark"].includes(n.source)) fail("Choose a normalization evidence source.");
    if (typeof n.configuration !== "string" || !n.configuration.length || n.configuration.length > 2000) {
      fail("Normalization requires a workload configuration snapshot.");
    }
  }
  function normalizationKey(kind, item) {
    return JSON.stringify(kind === "inference" ? [item.workloadKey, item.inputTokens, item.outputTokens, item.benchmarkId] :
      [item.parametersB, item.tokensB, item.days, item.peakTflops, item.mfu, item.memoryGB, item.bytesPerParameter, item.block, item.runs]);
  }
  function normalizationFor(state, kind, item) {
    if (item.pool === NORMALIZATION_REFERENCE) return {available: true, ratio: 1, source: "same-sku", reason: ""};
    const n = item.normalization;
    if (!n) return {available: false, ratio: null, reason: "Add a workload-specific H100 benchmark pair."};
    normalizationCheck(n);
    if (n.sku !== item.pool || n.configuration !== normalizationKey(kind, item)) {
      return {available: false, ratio: null, reason: "Workload or SKU changed. Recalibrate the benchmark pair."};
    }
    if (n.measuredOn >= `${state.startMonth}-01`) {
      return {available: false, ratio: null, reason: "Benchmark evidence must predate the planning window."};
    }
    if (kind === "inference") {
      const performance = profileFor(state, item);
      if (!performance.available) return {available: false, ratio: null, reason: performance.reason};
      const rate = performance.rpsPerReplica / performance.gpusPerReplica;
      if (Math.abs(rate - n.selectedRate) > Math.max(rate, n.selectedRate) * 1e-9) {
        return {available: false, ratio: null, reason: "Serving throughput changed. Recalibrate the benchmark pair."};
      }
    }
    return {available: true, ratio: n.selectedRate / n.referenceRate, selectedRate: n.selectedRate,
      referenceRate: n.referenceRate, configuration: n.configuration, source: n.source, evidence: n.evidence,
      measuredOn: n.measuredOn, reason: ""};
  }
  function bottomUpForecast(state, selectedId = "all", selectedTeam = "all", selectedPool = "all") {
    const forecast = capacityForecast(state, selectedId, selectedTeam, selectedPool);
    const horizon = forecast.monthly.map(m => {
      const rows = forecast.services.map(e => {
        const estimate = m.pools.flatMap(p => p.estimates).find(r => r.serviceId === e.service.id);
        return {kind: "inference", item: e.service, serviceId: e.service.id,
          gpus: e.available && estimate?.available ? estimate.gpus : null, reason: e.reason || estimate?.reason || ""};
      });
      if (forecast.options.includeTraining) {
        for (const plan of state.training) {
          const owner = state.services.find(s => s.id === plan.serviceId);
          if (plan.month === m.month && (selectedId === "all" || owner.id === selectedId) &&
              (selectedTeam === "all" || owner.team === selectedTeam) && (selectedPool === "all" || plan.pool === selectedPool)) {
            rows.push({kind: "training", item: plan, serviceId: owner.id, gpus: training(plan, state.startMonth).totalGpus, reason: ""});
          }
        }
      }
      const workloads = rows.map(r => {
        const calibration = normalizationFor(state, r.kind, r.item);
        const physicalComplete = r.gpus !== null && Number.isSafeInteger(r.gpus);
        const equivalent = physicalComplete && (r.gpus === 0 || calibration.available) ?
          r.gpus * (calibration.ratio ?? 0) : null;
        const normalizedGpus = equivalent !== null && Number.isFinite(equivalent) && equivalent <= Number.MAX_SAFE_INTEGER ? equivalent : null;
        return {kind: r.kind, id: r.item.id, name: r.item.name, serviceId: r.serviceId,
          team: state.services.find(s => s.id === r.serviceId).team, pool: r.item.pool, gpus: physicalComplete ? r.gpus : null,
          normalizedGpus, calibration, reason: !physicalComplete ? r.reason || "GPU count is outside the supported range." :
            normalizedGpus === null ? calibration.reason || "Normalized count is outside the supported range." : ""};
      });
      const summarize = items => {
        const missing = items.filter(r => r.normalizedGpus === null).length;
        const knownNormalized = items.reduce((n, r) => n + (r.normalizedGpus ?? 0), 0);
        const physicalComplete = items.every(r => r.gpus !== null);
        return {inference: items.filter(r => r.kind === "inference").reduce((n, r) => n + (r.gpus ?? 0), 0),
          training: items.filter(r => r.kind === "training").reduce((n, r) => n + (r.gpus ?? 0), 0),
          required: items.reduce((n, r) => n + (r.gpus ?? 0), 0), physicalComplete,
          normalizedRequired: !missing && Number.isFinite(knownNormalized) && knownNormalized <= Number.MAX_SAFE_INTEGER ? knownNormalized : null,
          knownNormalized, missing, normalizationMissing: missing, count: items.length,
          normalizationReason: missing ? "Some workloads lack usable benchmark pairs or sizing inputs." :
            knownNormalized > Number.MAX_SAFE_INTEGER || !Number.isFinite(knownNormalized) ? "Normalized total exceeds the supported count range." : ""};
      };
      return {...m, ...summarize(workloads), workloads,
        organizations: [...new Set(workloads.map(r => r.team))].sort().map(team => ({
          team, ...summarize(workloads.filter(r => r.team === team)),
        })),
        pools: m.pools.map(p => ({...p, ...summarize(workloads.filter(r => r.pool === p.pool)), missing: p.missing}))};
    });
    const inferenceServices = forecast.services.map(e => {
      const monthly = horizon.map(m => {
        const row = m.workloads.find(r => r.kind === "inference" && r.id === e.service.id);
        const estimate = m.pools.flatMap(p => p.estimates).find(r => r.serviceId === e.service.id);
        return {month: m.month, gpus: row?.gpus ?? null,
          peakRps: Number.isSafeInteger(row?.gpus) && estimate?.available ? estimate.peakRps : null,
          reason: row?.gpus === null ? row.reason : ""};
      });
      const complete = monthly.every(m => m.gpus !== null);
      return {id: e.service.id, name: e.service.name, team: e.service.team, pool: e.service.pool,
        history: serviceDemandHistory(state, e.service.id), monthly,
        forecastGrowthPct: complete ? growth(monthly.at(-1).gpus, monthly[0].gpus) : null,
        forecastGrowthReason: !complete ? "Some months lack usable sizing inputs." :
          monthly[0].gpus === 0 ? "Month-one GPU requirement is zero; percentage growth is unavailable." : ""};
    });
    return {...forecast, referenceSku: NORMALIZATION_REFERENCE, monthly: horizon, inferenceServices};
  }
  function moveTraining(state, id, targetMonth) {
    month(targetMonth);
    if (!months(state.startMonth).includes(targetMonth)) fail("Move training to a month in the current planning horizon.");
    if (!state.training.some(t => t.id === id)) fail("Training plan no longer exists.");
    const next = {...state, training: state.training.map(t => t.id === id ? {...t, month: targetMonth} : t)};
    return validate(next);
  }
  function training(plan, startMonth) {
    if (startMonth !== undefined) month(startMonth);
    const elapsed = startMonth === undefined ? 0 : Math.max(0, Math.min(6,
      (+plan.month.slice(0, 4) - +startMonth.slice(0, 4)) * 12 + +plan.month.slice(5, 7) - +startMonth.slice(5, 7) + 1));
    const growthFactor = (1 + (plan.scenarioGrowthPct ?? 0) / 100) ** (elapsed / 6);
    const plannedRuns = Math.ceil(plan.runs * growthFactor);
    const flops = 6 * plan.parametersB * 1e9 * plan.tokensB * 1e9;
    const effectiveFlops = plan.peakTflops * 1e12 * plan.mfu / 100;
    const computeGpus = Math.ceil(flops / (plan.days * 86400 * effectiveFlops));
    const memoryGpus = Math.ceil(plan.parametersB * 1e9 * plan.bytesPerParameter / (plan.memoryGB * 1e9));
    const gang = Math.ceil(Math.max(computeGpus, memoryGpus) / plan.block) * plan.block;
    return {
      flops, computeGpus, memoryGpus, gang, plannedRuns, baseRuns: plan.runs, growthFactor, totalGpus: gang * plannedRuns,
      activeRuntimeDays: flops / (gang * effectiveFlops) / 86400,
      reservedGpuHours: gang * plannedRuns * plan.days * 24,
      warning: "Dense pretraining only. Memory screen excludes activations/buffers; MFU and topology feasibility need calibration.",
    };
  }
  function portfolio(state, selectedId = "all", selectedTeam = "all") {
    return months(state.startMonth).map((m, index) => {
      const pools = activePools(state).map(p => {
        const services = state.services.filter(s => s.pool === p && (selectedId === "all" || s.id === selectedId) &&
          (selectedTeam === "all" || s.team === selectedTeam));
        const estimates = services.map(s => inference(state, s, index));
        const missing = estimates.filter(e => !e.available).length;
        const inferenceGpus = estimates.reduce((n, e) => n + (e.gpus ?? 0), 0);
        const trainingGpus = state.training.filter(t => t.pool === p && t.month === m &&
          (selectedId === "all" || t.serviceId === selectedId) &&
          (selectedTeam === "all" || state.services.find(s => s.id === t.serviceId).team === selectedTeam)
        ).reduce((n, t) => n + training(t, state.startMonth).totalGpus, 0);
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
      ["assistant", "Nemotron / NIM inference", "Language & Reasoning", "H200-SXM-141GB", 8, 24, 90, 15000],
      ["search", "BioNeMo model inference", "AI for Science", "H100-PCIE-80GB", 4, 90, 45, 60000],
      ["copilot", "Cosmos video generation", "World Models", "B200-SXM-180GB", 8, 30, 120, 18000],
      ["vision", "DRIVE / Alpamayo cloud evaluation", "Autonomous Vehicles", "H100-SXM-80GB", 4, 50, 60, 20000],
      ["recommend", "Omniverse render requests", "Simulation & Digital Twins", "RTX-PRO-6000-BW-SERVER-96GB", 4, 120, 30, 80000],
      ["agents", "Isaac / GR00T policy evaluation", "Robotics", "B200-SXM-180GB", 8, 20, 150, 10000],
      ["chip-design", "ChipNeMo design assistance", "Chip Design Research", "H200-SXM-141GB", 8, 40, 45, 10000],
    ];
    const services = defs.map(([id, name, team, p, gpus, rps, annualGrowth]) => ({
      id, name, team, pool: p, gpusPerReplica: gpus, rpsPerReplica: rps,
      annualGrowth, monthlyLaunchRps: 0, headroom: 20,
      profile: "Example requests/second for a fixed workload on this SKU. Match model, job size, software and response-time target.",
    }));
    const records = [];
    const firstDay = Math.round((Date.UTC(2024, 11, 1) - Date.UTC(2026, 8, 11)) / DAY);
    for (let day = firstDay; day < 60; day++) {
      const stamp = new Date(Date.UTC(2026, 8, 11) + day * DAY).toISOString().slice(0, 10);
      defs.forEach((d, i) => {
        const scale = day < 0 ? 0.72 * (1 + d[6] / 100) ** (day / 365) : 0.72 + day * 0.0045;
        const peakRps = Math.round(d[7] * 4 * scale * (1 + 0.045 * Math.sin(day * 0.5 + i)));
        const allocated = Math.ceil(peakRps / d[5] * d[4] * 1.18 / 8) * 8;
        records.push({date: stamp, serviceId: d[0], gpuHours: allocated * 24,
          activity: Math.round(54 + i * 3 + 9 * Math.sin(day / 6 + i)),
          peakRps, requests: Math.round(peakRps * 86400 * 0.36), source: "synthetic"});
      });
    }
    const workspace = {
      version: 3, startMonth: "2026-12",
      services: services.map(s => ({...s, demandMethod: "historical", drivers: defaultDrivers(),
        benchmarkId: "", workloadKey: `${s.id}-demo-fixed-request`, inputTokens: ["assistant", "chip-design"].includes(s.id) ? 1024 : 0,
        outputTokens: ["assistant", "chip-design"].includes(s.id) ? 256 : 0})),
      benchmarks: services.map(s => ({
        id: `profile-${s.id}`, name: `${s.name} demo profile`, pool: s.pool,
        workloadKey: `${s.id}-demo-fixed-request`, gpusPerReplica: s.gpusPerReplica,
        rpsPerReplica: s.rpsPerReplica, minInputTokens: 0, maxInputTokens: ["assistant", "chip-design"].includes(s.id) ? 2048 : 0,
        minOutputTokens: 0, maxOutputTokens: ["assistant", "chip-design"].includes(s.id) ? 512 : 0, measuredOn: "2026-11-09",
        source: "synthetic", evidence: "Illustrative only; not a real hardware benchmark. Match model, precision, runtime and latency SLO.",
      })), records,
      training: [
        {id: "train-1", name: "Dense language-model experiment", serviceId: "assistant", pool: "H200-SXM-141GB", month: "2027-01",
          parametersB: 70, tokensB: 1000, days: 12, peakTflops: 989, mfu: 40, memoryGB: 141, bytesPerParameter: 16, block: 256, runs: 2},
        {id: "train-2", name: "Chip-design dense-model experiment", serviceId: "chip-design", pool: "B200-SXM-180GB", month: "2027-03",
          parametersB: 43, tokensB: 1000, days: 14, peakTflops: 2250, mfu: 40, memoryGB: 180, bytesPerParameter: 16, block: 256, runs: 2},
      ],
      supply: {
        ...emptySupply(),
        "H100-SXM-80GB": {installed: 48000, unavailable: 3000, reserve: 2400},
        "H100-PCIE-80GB": {installed: 16000, unavailable: 1000, reserve: 800},
        "H200-SXM-141GB": {installed: 64000, unavailable: 4000, reserve: 3200},
        "B200-SXM-180GB": {installed: 56000, unavailable: 6000, reserve: 2800},
        "RTX-PRO-6000-BW-SERVER-96GB": {installed: 16000, unavailable: 1000, reserve: 800},
        additions: [{pool: "H200-SXM-141GB", month: "2027-02", gpus: 8192}],
      },
    };
    const ratios = [1.6, 0.8, 2.4, 1, 1.3, 1.8, 1.5];
    for (const [index, service] of workspace.services.entries()) {
      const selectedRate = service.rpsPerReplica / service.gpusPerReplica;
      service.normalization = {sku: service.pool, referenceSku: NORMALIZATION_REFERENCE,
        configuration: normalizationKey("inference", service), selectedRate, referenceRate: selectedRate / ratios[index],
        measuredOn: "2026-11-09", source: "synthetic",
        evidence: "Illustrative paired rates for this workload, not measured hardware performance."};
    }
    for (const [index, plan] of workspace.training.entries()) {
      plan.normalization = {sku: plan.pool, referenceSku: NORMALIZATION_REFERENCE,
        configuration: normalizationKey("training", plan), selectedRate: index ? 3000 : 900, referenceRate: index ? 1200 : 600,
        measuredOn: "2026-11-09", source: "synthetic",
        evidence: "Illustrative training tokens/second/GPU at the same model configuration, not measured performance."};
    }
    return validate(workspace);
  }
  const api = {POOLS, SKU_CATALOG, WORKLOAD_AREAS, NORMALIZATION_REFERENCE, skuInfo, activePools, validate, upgrade, defaultDrivers, defaultForecast, number, date, months, growth, trend, baseline,
    inference, profileFor, FORECAST_MODELS, predictPeak, forecastEvidence, trafficForecast, capacityForecast,
    normalizationKey, normalizationFor, bottomUpForecast, serviceDemandHistory, segmentCapacity, moveTraining, training, portfolio, comparePeriods, demo};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CapacityModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
