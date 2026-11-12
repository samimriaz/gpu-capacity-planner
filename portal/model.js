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
    {name: "Language models", description: "Language-model training, evaluation and inference."},
    {name: "Autonomous systems", description: "Driving-model development, simulation and cloud evaluation. In-vehicle inference is separate."},
    {name: "Robotics", description: "Robot-model development, simulation and policy evaluation. On-device inference is separate."},
    {name: "Video generation", description: "World models, synthetic video generation and evaluation."},
    {name: "Rendering and simulation", description: "Rendering, physics, digital twins and synthetic sensor data."},
    {name: "Scientific models", description: "Biomolecular model training, protein design and scientific inference."},
    {name: "Engineering assistants", description: "Language models for chip design and engineering assistance."},
  ];
  const DEMO_SERVICE_LABELS = {
    assistant: {previous: "Nemotron / NIM inference", name: "Language model inference"},
    search: {previous: "BioNeMo model inference", name: "Scientific model inference"},
    copilot: {previous: "Cosmos video generation", name: "Video generation"},
    vision: {previous: "DRIVE / Alpamayo cloud evaluation", name: "Autonomous driving evaluation"},
    recommend: {previous: "Omniverse render requests", name: "Rendering and simulation"},
    agents: {previous: "Isaac / GR00T policy evaluation", name: "Robotics policy evaluation"},
    "chip-design": {previous: "ChipNeMo design assistance", name: "Chip design assistance"},
  };
  const DAY = 86400000;
  const NORMALIZATION_REFERENCE = "H100-SXM-80GB";
  const PLANNER_MAX_MONTHS_AHEAD = 24;
  const GPU_PURCHASE_ASSUMPTIONS = [
    {pool: "H100-SXM-80GB", usdPerGpu: 30000, checkedOn: "2026-11-12",
      source: "https://intuitionlabs.ai/articles/nvidia-ai-gpu-pricing-guide",
      basis: "Indicative H100 pricing guide; $30,000 SXM budgeting allowance, not a standalone supplier quote."},
    {pool: "H100-PCIE-80GB", usdPerGpu: 32000, checkedOn: "2026-11-12",
      source: "https://gpuperhour.com/blog/nvidia-h100-price",
      basis: "Rounded from a reported $32,411.99 historical PCIe listing. Listing was discontinued; this is not a current offer."},
    {pool: "H200-SXM-141GB", usdPerGpu: 35000, checkedOn: "2026-11-12",
      source: "https://www.mercatus-ai.com/blog/h200-price",
      basis: "Planning allowance within a secondary guide's $32,000-$40,000 standalone SXM range; availability and quotes require confirmation."},
    {pool: "B200-SXM-180GB", usdPerGpu: 40000, checkedOn: "2026-11-12",
      source: "https://intuitionlabs.ai/articles/nvidia-ai-gpu-pricing-guide",
      basis: "Midpoint of an indicative $30,000-$50,000 B200 range, not a verified standalone quote. SXM procurement normally requires integrated systems."},
    {pool: "RTX-PRO-6000-BW-SERVER-96GB", usdPerGpu: 17200, checkedOn: "2026-11-12",
      source: "https://www.cdw.com/product/nvidia-rtx-pro-6000-blackwell-server-edition-graphics-card-rtx-pro-60/8426124",
      basis: "Rounded from a $17,158.99 advertised Server Edition card-kit listing; not the workstation edition. Confirm availability and quote."},
  ];
  const COMPUTE_SPECS = [
    {pool: "H100-SXM-80GB", fp32: 67, source: "https://i.dell.com/sites/csdocuments/App-Merchandizing_Documents/en/us/h100-gpu.pdf"},
    {pool: "H100-PCIE-80GB", fp32: 51, source: "https://i.dell.com/sites/csdocuments/App-Merchandizing_Documents/en/us/h100-gpu.pdf"},
    {pool: "H200-SXM-141GB", fp32: 67, source: "https://www.nvidia.com/en-us/data-center/h200/"},
    {pool: "B200-SXM-180GB", fp32: 75, source: "https://lenovopress.lenovo.com/lp2226-thinksystem-nvidia-b200-180gb-1000w-gpu"},
    {pool: "RTX-PRO-6000-BW-SERVER-96GB", fp32: 120, source: "https://www.nvidia.com/en-us/data-center/rtx-pro-6000-blackwell-server-edition/"},
  ];
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
      state = {...state, version: 3, supply: {...emptySupply(), ...state.supply}};
    }
    if (state?.version === 3 && Array.isArray(state.services) && Array.isArray(state.benchmarks)) {
      state = {...state, services: state.services.map(s => {
        const label = DEMO_SERVICE_LABELS[s.id];
        return label && s.name === label.previous ? {...s, name: label.name} : s;
      }), benchmarks: state.benchmarks.map(b => {
        const label = Object.entries(DEMO_SERVICE_LABELS).find(([id]) => b.id === `profile-${id}`)?.[1];
        return label && b.source === "synthetic" && b.name === `${label.previous} demo profile` ?
          {...b, name: `${label.name} demo profile`} : b;
      })};
    }
    if (state?.version === 3) {
      if (state.trainingAllocationBasis === undefined) state = {...state, trainingAllocationBasis: "current-demand"};
      if (state.trainingProjects === undefined) state = {...state, trainingProjects: []};
      const defaults = GPU_PURCHASE_ASSUMPTIONS.map(({pool, usdPerGpu}) => ({pool, usdPerGpu}));
      if (state.gpuPurchasePrices === undefined) {
        state = {...state, gpuPurchasePrices: defaults,
          gpuPurchasePriceVersion: state.gpuPurchasePriceVersion === undefined ? 1 : state.gpuPurchasePriceVersion};
      } else if (Array.isArray(state.gpuPurchasePrices) && state.gpuPurchasePriceVersion === undefined) {
        const uniformLegacyDefaults = state.gpuPurchasePrices.length === defaults.length &&
          defaults.every(d => state.gpuPurchasePrices.some(p => p.pool === d.pool && p.usdPerGpu === 30000));
        state = {...state, gpuPurchasePrices: uniformLegacyDefaults ? defaults : state.gpuPurchasePrices,
          gpuPurchasePriceVersion: 1};
      }
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
  function trainingSizingCheck(t) {
    pool(t.pool);
    number(t.parametersB, "Parameters (billions)", 0.001, 10000);
    number(t.tokensB, "Training tokens (billions)", 0.001, 1e7);
    number(t.peakTflops, "Dense peak TFLOP/s per GPU", 1, 100000);
    number(t.mfu, "Model FLOPs utilization %", 1, 100);
    number(t.memoryGB, "Memory per GPU (GB)", 1, 10000);
    const hardware = skuInfo(t.pool);
    if (hardware.memoryGB !== null && t.memoryGB > hardware.memoryGB) fail(`Memory budget exceeds ${hardware.name}'s ${hardware.memoryGB} GB per GPU.`);
    number(t.bytesPerParameter, "Training-state bytes per parameter", 1, 100);
    number(t.block, "Topology block size", 1, 65536, true);
  }
  function trainingCheck(t, services) {
    text(t.id, "Plan ID"); text(t.name, "Training plan name");
    if (!services.some(s => s.id === t.serviceId)) fail("Training plan references an unknown service.");
    trainingSizingCheck(t);
    month(t.month);
    number(t.days, "Active training days", 0.01, 31);
    const daysInMonth = new Date(Date.UTC(+t.month.slice(0, 4), +t.month.slice(5, 7), 0)).getUTCDate();
    if (t.days > daysInMonth) fail("Active training days exceed days in the chosen month.");
    number(t.runs, "Concurrent runs", 1, 1000, true);
    if (t.scenarioGrowthPct !== undefined) number(t.scenarioGrowthPct, "Extra concurrent training runs by month six %", -90, 300);
  }
  function validate(state) {
    state = upgrade(state);
    if (!state || state.version !== 3) fail("Unsupported workspace version.");
    month(state.startMonth);
    if (!["current-demand", "recorded"].includes(state.trainingAllocationBasis)) fail("Choose a supported training allocation basis.");
    forecastTargetMonth(state);
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
    if (!Array.isArray(state.trainingProjects) || state.trainingProjects.length > 1000) fail("At most 1,000 new training projects are supported.");
    for (const project of state.trainingProjects) {
      trainingProject(project);
      if (!state.services.some(s => s.id === project.serviceId)) fail("Training project references an unknown service.");
    }
    if (new Set(state.trainingProjects.map(p => p.id)).size !== state.trainingProjects.length) fail("Training project IDs must be unique.");
    if (state.trainingHistory !== undefined) trainingHistoryCheck(state.trainingHistory, state.services);
    if (state.gpuPurchasePriceVersion !== undefined) number(state.gpuPurchasePriceVersion, "GPU purchase price version", 1, 1, true);
    if (state.gpuPurchasePrices !== undefined) {
      if (!Array.isArray(state.gpuPurchasePrices) || state.gpuPurchasePrices.length > POOLS.length) fail("GPU purchase prices must be a per-SKU list.");
      const seen = new Set();
      for (const price of state.gpuPurchasePrices) {
        pool(price.pool);
        number(price.usdPerGpu, "GPU purchase price (USD)", 0, 1e9);
        if (seen.has(price.pool)) fail("Duplicate GPU purchase price for SKU.");
        seen.add(price.pool);
      }
    }
    if (state.plannerGrowth !== undefined) {
      if (!Array.isArray(state.plannerGrowth) || state.plannerGrowth.length > 20000) fail("Too many planner growth overrides.");
      const seen = new Set();
      for (const row of state.plannerGrowth) {
        if (!["inference", "training"].includes(row.kind)) fail("Unknown planner growth segment.");
        if (!state.services.some(s => s.id === row.serviceId)) fail("Planner growth references an unknown service.");
        pool(row.pool);
        number(row.growthPct, "Six-month growth %", -100, 10000);
        const key = JSON.stringify([row.kind, row.serviceId, row.pool]);
        if (seen.has(key)) fail("Duplicate planner growth override.");
        seen.add(key);
      }
    }
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
      if ((capacity.inferenceSource === "recorded-allocation" ? 0 : capacity.inference ?? 0) +
          (capacity.training ?? 0) > capacity.usable) {
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
  // Current allocation per service: highest pre-plan daily GPU-hours / 24, rounded up; null without records.
  function recordedAllocations(state, serviceIds) {
    const allocations = new Map(serviceIds.map(id => [id, null]));
    for (const r of state.records) {
      if (r.date >= `${state.startMonth}-01` || !allocations.has(r.serviceId)) continue;
      allocations.set(r.serviceId, Math.max(allocations.get(r.serviceId) ?? 0, Math.ceil(r.gpuHours / 24)));
    }
    return allocations;
  }
  function segmentCapacity(state, p, selectedId = "all", selectedTeam = "all") {
    const supply = state.supply[p];
    const usable = supply.installed - supply.unavailable - supply.reserve +
      state.supply.additions.filter(a => a.pool === p && a.month <= state.startMonth).reduce((n, a) => n + a.gpus, 0);
    const legacyInference = supply.inferenceBudgetPct === undefined ? null : Math.floor(usable * supply.inferenceBudgetPct / 100);
    const services = state.services.filter(s => s.pool === p && (selectedId === "all" || s.id === selectedId) &&
      (selectedTeam === "all" || s.team === selectedTeam));
    const allocations = recordedAllocations(state, services.map(s => s.id));
    const recordedInference = [...allocations.values()].some(n => n === null) ? null :
      [...allocations.values()].reduce((sum, n) => sum + n, 0);
    const companyScope = selectedId === "all" && selectedTeam === "all";
    const explicitInference = companyScope ? supply.inferenceAvailable ?? legacyInference : null;
    const inference = explicitInference ?? recordedInference;
    const enteredTraining = companyScope ? supply.trainingAvailable ?? (legacyInference === null ? null : usable - legacyInference) : null;
    const training = enteredTraining ?? (companyScope && inference !== null && inference <= usable ? usable - inference : null);
    return {usable, inference, training, recordedInference,
      inferenceSource: explicitInference !== null ? "entered-allocation" : recordedInference !== null ? "recorded-allocation" : "missing",
      trainingSource: training === null ? "missing" : enteredTraining !== null ? "entered-allocation" : "remaining-capacity"};
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
  function driverRps(d, m, annualGrowthPct) {
    return d.activeUsers * (1 + annualGrowthPct / 100) ** (m / 12) *
      d.sessionsPerUser * d.requestsPerSession * d.callsPerRequest *
      (1 - d.cacheHitPct / 100) / 86400 * d.peakToAverage;
  }
  function inference(state, service, index) {
    const base = baseline(state, service.id);
    if (service.demandMethod === "historical" && !base) return {available: false, reason: "No consumption baseline; enter daily data.", gpus: null, peakRps: null};
    const m = index + 1;
    let organicRps;
    if (service.demandMethod === "drivers") organicRps = driverRps(service.drivers, m, service.annualGrowth);
    else organicRps = base.peakRps * (1 + service.annualGrowth / 100) ** (m / 12);
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
  // 52 whole weeks: the trend is fitted on complete weekly averages, so the window must be a multiple of 7.
  const TRAFFIC_WINDOW_DAYS = 364;
  function fitTraffic(rows, method) {
    const count = Math.floor(Math.min(rows.length, method === "recent_average" ? 28 : TRAFFIC_WINDOW_DAYS) / 7) * 7;
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
  // Standard-normal 90th percentile; P90 widens P50 by this many SDs of relative error.
  const P90_Z = 1.2815515655446004;
  // Holdout one-day residual SD relative to mean traffic; null when mean traffic is zero.
  function residualSpread(predictions) {
    const n = predictions.length;
    const errors = predictions.map(p => p.actual - p.predicted);
    const meanError = errors.reduce((sum, e) => sum + e, 0) / n;
    const meanActual = predictions.reduce((sum, p) => sum + p.actual, 0) / n;
    if (!(meanActual > 0) || n < 2) return null;
    return Math.sqrt(errors.reduce((sum, e) => sum + (e - meanError) ** 2, 0) / (n - 1)) / meanActual;
  }
  // P90 level multiplier for a planning month. Uncertainty grows with the square root of months ahead; this is a heuristic.
  function p90Multiplier(history, index) {
    if (!history?.band) return 1;
    return 1 + history.band.z * history.band.relativeSd * Math.sqrt(index + 1);
  }
  function trafficForecast(state, serviceId) {
    const eligible = state.records.filter(r => r.serviceId === serviceId && r.date < `${state.startMonth}-01`)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!eligible.length) return {available: false, reason: "Add at least 42 consecutive daily observations to learn this service's traffic."};
    const history = new Map(eligible.map(r => [r.date, r]));
    const lastDate = eligible.at(-1).date;
    const rows = [];
    for (let offset = 0; offset < TRAFFIC_WINDOW_DAYS; offset++) {
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
    const relativeSd = residualSpread(best.predictions);
    return {available: true, source: "history", method: best.method, fit, scores, monthly,
      band: relativeSd === null ? null : {relativeSd, z: P90_Z, holdoutDays: best.predictions.length,
        basis: "Holdout one-day residual SD / mean traffic; P90 = P50 × (1 + z × SD × √months ahead)."},
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
        monthly: months(state.startMonth).map((m, i) => ({month: m, peakRps: driverRps(service.drivers, i + 1, 0)}))} : history;
      const performance = profileFor(state, service);
      return {service, history, demand, performance, available: demand.available && performance.available,
        reason: !demand.available ? demand.reason : !performance.available ? performance.reason : ""};
    });
    const monthly = months(state.startMonth).map((m, index) => {
      const pools = activePools(state).filter(p => selectedPool === "all" || p === selectedPool).map(p => {
        const entries = evidence.filter(e => e.service.pool === p);
        const estimates = entries.filter(e => e.available).map(e => {
          const baseRps = e.demand.monthly[index].peakRps;
          const baseRpsP90 = baseRps * p90Multiplier(e.history, index);
          const launchRps = options.includeLaunches ? e.service.monthlyLaunchRps * (index + 1) : 0;
          const growthFactor = (1 + (e.service.scenarioGrowthPct ?? 0) / 100) ** ((index + 1) / 6);
          const adjustment = 1 + options.trafficAdjustmentPct / 100;
          const peakRps = baseRps * growthFactor * adjustment + launchRps;
          const peakRpsP90 = baseRpsP90 * growthFactor * adjustment + launchRps;
          const usableShare = 1 - e.service.headroom / 100;
          const replicaRps = e.performance.rpsPerReplica * (1 + options.throughputChangePct / 100);
          const baselineGpus = Math.ceil(baseRps / usableShare / e.performance.rpsPerReplica) * e.performance.gpusPerReplica;
          const gpusP50 = Math.ceil(peakRps / usableShare / replicaRps) * e.performance.gpusPerReplica;
          const gpus = Math.ceil(peakRpsP90 / usableShare / replicaRps) * e.performance.gpusPerReplica;
          const available = Number.isSafeInteger(baselineGpus) && Number.isSafeInteger(gpusP50) && Number.isSafeInteger(gpus);
          return {serviceId: e.service.id, baseRps, launchRps, growthFactor, peakRps, peakRpsP90, baselineGpus,
            gpusP50, gpus, bandAvailable: Boolean(e.history?.band), available,
            reason: available ? "" : "GPU estimate exceeds the supported count range. Check traffic and serving throughput."};
        });
        const inferenceGpus = estimates.filter(e => e.available).reduce((n, e) => n + e.gpus, 0);
        const inferenceGpusP50 = estimates.filter(e => e.available).reduce((n, e) => n + e.gpusP50, 0);
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
        const requiredP50 = inferenceGpusP50 + trainingGpus;
        const inferenceComplete = entries.every(e => e.available) && estimates.every(e => e.available);
        const trainingComplete = trainingCounts.every(Number.isSafeInteger);
        const have = segmentCapacity(state, p, selectedId, selectedTeam);
        const override = state.segmentBudgets?.find(b => b.pool === p && b.month === m &&
          b.serviceId === selectedId && b.team === selectedTeam);
        const inferenceBudget = override?.inference ?? (inferenceComplete ? inferenceGpus : null);
        const trainingBudget = !options.includeTraining ? 0 : override?.training ?? (trainingComplete ? trainingGpus : null);
        const budgetRequired = inferenceBudget === null || trainingBudget === null ? null : inferenceBudget + trainingBudget;
        return {month: m, pool: p, baselineInference, inference: inferenceGpus, inferenceP50: inferenceGpusP50,
          training: trainingGpus, required, requiredP50, usable, gap: required - usable, gapP50: requiredP50 - usable,
          missing, complete: missing === 0, estimates,
          inferenceComplete, trainingComplete, inferenceBudget, trainingBudget,
          inferenceHave: have.inference, trainingHave: have.training,
          inferenceHaveSource: have.inferenceSource, trainingHaveSource: have.trainingSource,
          allocationConflict: (have.inference ?? 0) + (have.training ?? 0) > have.usable,
          inferenceBudgetSource: override?.inference !== undefined ? "manual" : "forecast",
          trainingBudgetSource: !options.includeTraining ? "excluded" : override?.training !== undefined ? "manual" : "forecast",
          inferenceGap: inferenceComplete && have.inference !== null ? inferenceGpus - have.inference : null,
          trainingGap: trainingComplete && have.training !== null ? trainingGpus - have.training : null,
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
          gpus: e.available && estimate?.available ? estimate.gpus : null,
          gpusP50: e.available && estimate?.available ? estimate.gpusP50 : null,
          reason: e.reason || estimate?.reason || ""};
      });
      if (forecast.options.includeTraining) {
        for (const plan of state.training) {
          const owner = state.services.find(s => s.id === plan.serviceId);
          if (plan.month === m.month && (selectedId === "all" || owner.id === selectedId) &&
              (selectedTeam === "all" || owner.team === selectedTeam) && (selectedPool === "all" || plan.pool === selectedPool)) {
            const totalGpus = training(plan, state.startMonth).totalGpus;
            rows.push({kind: "training", item: plan, serviceId: owner.id, gpus: totalGpus, gpusP50: totalGpus, reason: ""});
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
          gpusP50: physicalComplete ? r.gpusP50 : null,
          normalizedGpus, calibration, reason: !physicalComplete ? r.reason || "GPU count is outside the supported range." :
            normalizedGpus === null ? calibration.reason || "Normalized count is outside the supported range." : ""};
      });
      const summarize = items => {
        const missing = items.filter(r => r.normalizedGpus === null).length;
        const knownNormalized = items.reduce((n, r) => n + (r.normalizedGpus ?? 0), 0);
        const physicalComplete = items.every(r => r.gpus !== null);
        return {inference: items.filter(r => r.kind === "inference").reduce((n, r) => n + (r.gpus ?? 0), 0),
          training: items.filter(r => r.kind === "training").reduce((n, r) => n + (r.gpus ?? 0), 0),
          required: items.reduce((n, r) => n + (r.gpus ?? 0), 0),
          requiredP50: items.reduce((n, r) => n + (r.gpusP50 ?? 0), 0), physicalComplete,
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
  function trainingSizing(plan) {
    const flops = 6 * plan.parametersB * 1e9 * plan.tokensB * 1e9;
    const effectiveFlops = plan.peakTflops * 1e12 * plan.mfu / 100;
    const computeGpus = Math.ceil(flops / (plan.days * 86400 * effectiveFlops));
    const memoryGpus = Math.ceil(plan.parametersB * 1e9 * plan.bytesPerParameter / (plan.memoryGB * 1e9));
    const gang = Math.ceil(Math.max(computeGpus, memoryGpus) / plan.block) * plan.block;
    return {flops, effectiveFlops, computeGpus, memoryGpus, gang};
  }
  function training(plan, startMonth) {
    if (startMonth !== undefined) month(startMonth);
    const elapsed = startMonth === undefined ? 0 : Math.max(0, Math.min(6,
      (+plan.month.slice(0, 4) - +startMonth.slice(0, 4)) * 12 + +plan.month.slice(5, 7) - +startMonth.slice(5, 7) + 1));
    const growthFactor = (1 + (plan.scenarioGrowthPct ?? 0) / 100) ** (elapsed / 6);
    const plannedRuns = Math.ceil(plan.runs * growthFactor);
    const {flops, effectiveFlops, computeGpus, memoryGpus, gang} = trainingSizing(plan);
    return {
      flops, computeGpus, memoryGpus, gang, plannedRuns, baseRuns: plan.runs, growthFactor, totalGpus: gang * plannedRuns,
      activeRuntimeDays: flops / (gang * effectiveFlops) / 86400,
      reservedGpuHours: gang * plannedRuns * plan.days * 24,
      warning: "Dense pretraining only. Memory screen excludes activations/buffers; MFU and topology feasibility need calibration.",
    };
  }
  function trainingProject(plan) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) fail("Training project must be an object.");
    text(plan.id, "Project ID"); text(plan.name, "Project name"); text(plan.serviceId, "Owning service");
    if (plan.incremental !== true) fail("Confirm that the project is new demand not already included in the historical baseline.");
    trainingSizingCheck(plan);
    if (skuInfo(plan.pool).legacy) fail("New training projects require an exact GPU SKU.");
    date(plan.startDate);
    if (plan.startDate < "1000-01-01") fail("Project start date must be in year 1000 or later.");
    number(plan.days, "Training days per run", 1, 365, true);
    number(plan.runs, "Total project runs", 1, 1000, true);
    number(plan.concurrentRuns, "Maximum concurrent runs", 1, plan.runs, true);
    const sizing = trainingSizing(plan);
    const peakGpus = sizing.gang * plan.concurrentRuns;
    const reservedGpuHours = sizing.gang * plan.runs * plan.days * 24;
    number(peakGpus, "Project peak GPU count", 1, Number.MAX_SAFE_INTEGER, true);
    number(reservedGpuHours, "Project reserved GPU-hours", 1, Number.MAX_SAFE_INTEGER, true);
    const batches = Math.ceil(plan.runs / plan.concurrentRuns);
    const start = Date.parse(plan.startDate), end = start + batches * plan.days * DAY;
    if (end > Date.parse("9999-12-31")) fail("Project schedule must finish before the end of year 9999.");
    const fullBatches = Math.floor(plan.runs / plan.concurrentRuns);
    const fullEnd = start + fullBatches * plan.days * DAY;
    const stamp = value => new Date(value).toISOString().slice(0, 10);
    const schedule = [{startDate: plan.startDate, endDate: stamp(fullEnd), gpus: peakGpus}];
    const remaining = plan.runs % plan.concurrentRuns;
    if (remaining) schedule.push({startDate: stamp(fullEnd), endDate: stamp(end), gpus: sizing.gang * remaining});
    return {...plan, ...sizing, peakGpus, reservedGpuHours, batches, schedule,
      endDate: stamp(end), lastActiveDate: stamp(end - DAY),
      warning: "Dense pretraining estimate. Validate MFU at scale, topology and memory including activations/buffers. Dates reserve full run windows; no cluster placement is guaranteed."};
  }
  function trainingProjectPeak(projects, targetMonth) {
    month(targetMonth);
    const start = Date.parse(`${targetMonth}-01`), end = Date.parse(`${shiftedMonth(targetMonth, 1)}-01`);
    const events = new Map();
    for (const project of projects) for (const interval of project.schedule) {
      const from = Math.max(start, Date.parse(interval.startDate)), to = Math.min(end, Date.parse(interval.endDate));
      if (from >= to) continue;
      events.set(from, (events.get(from) || 0) + interval.gpus);
      events.set(to, (events.get(to) || 0) - interval.gpus);
    }
    let current = 0, peak = 0;
    for (const [, change] of [...events].sort((a, b) => a[0] - b[0])) {
      current += change;
      if (!Number.isSafeInteger(current)) return null;
      peak = Math.max(peak, current);
    }
    return peak;
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
  function trainingHistoryCheck(rows, services) {
    if (!Array.isArray(rows) || rows.length > 100000) fail("Training history must be an array of at most 100,000 rows.");
    const seen = new Set();
    for (const row of rows) {
      if (!services.some(s => s.id === row.serviceId)) fail("Training history references an unknown service.");
      pool(row.pool); month(row.month);
      number(row.peakGpus, "Historical peak training GPUs", 0, 1e9, true);
      number(row.allocatedGpus, "Historical allocated training GPUs", 0, 1e9, true);
      if (!["synthetic", "user-entered"].includes(row.source)) fail("Unknown training history provenance.");
      const key = JSON.stringify([row.serviceId, row.pool, row.month]);
      if (seen.has(key)) fail("Only one training history row per service, SKU and month is allowed.");
      seen.add(key);
    }
    return rows;
  }
  function importTrainingHistory(state, rows) {
    trainingHistoryCheck(rows, state.services);
    if (!rows.length) fail("Training history import is empty.");
    const key = row => JSON.stringify([row.serviceId, row.pool, row.month]);
    const merged = new Map((state.trainingHistory || []).map(row => [key(row), row]));
    for (const row of rows) merged.set(key(row), row);
    return validate({...state, trainingHistory: [...merged.values()]});
  }
  function shiftedMonth(value, offset) {
    const [year, m] = value.split("-").map(Number);
    return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
  }
  function demoTrainingHistory(state) {
    const groups = new Map(state.services.map(s => [JSON.stringify([s.id, s.pool]), {serviceId: s.id, pool: s.pool}]));
    state.training.forEach(t => groups.set(JSON.stringify([t.serviceId, t.pool]), {serviceId: t.serviceId, pool: t.pool}));
    return [...groups.values()].flatMap((group, i) => months(shiftedMonth(state.startMonth, -24), 24).map((m, n) => {
      const peakGpus = Math.ceil((128 + i * 64) * (1.2 + i * 0.04) ** (n / 12));
      return {...group, month: m, peakGpus, allocatedGpus: Math.ceil(peakGpus * 1.15 / 8) * 8, source: "synthetic"};
    }));
  }
  function computeEquivalent(gpus, sku) {
    const spec = COMPUTE_SPECS.find(s => s.pool === sku);
    return gpus === null || !spec ? null : gpus * spec.fp32 / 67;
  }
  const completeSum = values => values.every(Number.isFinite) ? values.reduce((n, v) => n + v, 0) : null;
  // Avoid rounding an exact GPU boundary up because of floating-point noise.
  const plannerCeil = value => value === 0 ? 0 : Math.ceil(value - Number.EPSILON * Math.abs(value) * 4);
  function forecastTargetMonth(state) {
    const target = state.plannerTargetMonth ?? state.startMonth;
    month(target);
    const window = months(state.startMonth, PLANNER_MAX_MONTHS_AHEAD + 1);
    if (!window.includes(target)) {
      fail(`Choose a forecast month from ${state.startMonth} through ${window.at(-1)}.`);
    }
    return target;
  }
  function plannerForecast(state, selectedId = "all", selectedTeam = "all", selectedPool = "all") {
    const trainingAllocationBasis = state.trainingAllocationBasis ?? "current-demand";
    const assumeTrainingDemand = trainingAllocationBasis === "current-demand";
    const owners = state.services.filter(s => (selectedId === "all" || s.id === selectedId) &&
      (selectedTeam === "all" || s.team === selectedTeam));
    const historicalMonths = months(shiftedMonth(state.startMonth, -12), 12);
    const latestMonth = historicalMonths.at(-1), previousYear = shiftedMonth(latestMonth, -12);
    const targetMonth = forecastTargetMonth(state);
    const window = months(state.startMonth, PLANNER_MAX_MONTHS_AHEAD + 1);
    const targetIndex = window.indexOf(targetMonth);
    const futureMonths = window.slice(0, Math.max(6, targetIndex + 1));
    const trainingProjects = (state.trainingProjects || [])
      .filter(p => owners.some(s => s.id === p.serviceId) && (selectedPool === "all" || p.pool === selectedPool))
      .map(p => ({...trainingProject(p), team: owners.find(s => s.id === p.serviceId).team}));
    const allocations = recordedAllocations(state, owners.map(s => s.id));
    const demandRows = new Map();
    for (const row of state.records) {
      if (!demandRows.has(row.serviceId)) demandRows.set(row.serviceId, new Map());
      const buckets = demandRows.get(row.serviceId), m = row.date.slice(0, 7);
      if (!buckets.has(m)) buckets.set(m, []);
      buckets.get(m).push(row);
    }
    const monthTraffic = (serviceId, m, through = null) => {
      const rows = demandRows.get(serviceId)?.get(m) || [];
      const calendarDays = new Date(Date.parse(`${shiftedMonth(m, 1)}-01`) - DAY).getUTCDate();
      const lastDay = rows.length ? Math.max(...rows.map(r => +r.date.slice(8))) : 0;
      const days = through ?? (m === latestMonth ? lastDay : calendarDays);
      const selected = rows.filter(r => +r.date.slice(8) <= days);
      const complete = days > 0 && selected.length === days;
      return {month: m, value: complete ? selected.reduce((n, r) => n + r.requests, 0) / (days * 86400) : null,
        peak: complete ? Math.max(...selected.map(r => r.peakRps)) : null, days, observedDays: selected.length,
        partial: days < calendarDays, synthetic: selected.some(r => r.source === "synthetic")};
    };
    const applyGrowth = row => {
      row.yoyPct = row.current === null || row.previous === null ? null : growth(row.current, row.previous);
      row.suggestedGrowthPct = row.yoyPct === null ? null : (Math.sqrt(1 + row.yoyPct / 100) - 1) * 100;
      const override = state.plannerGrowth?.find(g => g.kind === row.kind && g.serviceId === row.serviceId && g.pool === row.pool);
      row.growthPct = override ? override.growthPct : row.suggestedGrowthPct;
      row.manual = Boolean(override);
      row.reason = row.current === null ? "Latest pre-plan month is missing or incomplete." :
        row.growthPct === null ? "YoY unavailable: matching prior-year history and a nonzero baseline are required. Enter six-month growth." : "";
      return row;
    };
    const inferenceRows = owners.filter(s => selectedPool === "all" || s.pool === selectedPool).map(s => {
      const history = historicalMonths.map(m => monthTraffic(s.id, m));
      const current = history.at(-1), previous = monthTraffic(s.id, previousYear, current.days);
      const drivers = s.demandMethod === "drivers";
      const driverAverage = drivers ? driverRps(s.drivers, 0, 0) / s.drivers.peakToAverage : null;
      const row = applyGrowth({kind: "inference", serviceId: s.id, name: s.name, team: s.team, pool: s.pool,
        history, current: drivers ? driverAverage : current.value, previous: drivers ? null : previous.value,
        allocated: allocations.get(s.id) ?? null, baselineMonth: latestMonth,
        synthetic: history.some(h => h.synthetic), drivers});
      const performance = profileFor(state, s);
      const evidence = trafficForecast(state, s.id);
      row.future = futureMonths.map((m, i) => {
        const factor = row.growthPct === null ? null : (1 + row.growthPct / 100) ** ((i + 1) / 6);
        const value = row.current === null || factor === null ? null : row.current * factor;
        const baselinePeak = drivers ? driverAverage * s.drivers.peakToAverage : current.peak;
        const peak = baselinePeak === null || factor === null ? null : baselinePeak * factor;
        const size = rps => {
          if (rps === null || !performance.available) return null;
          const count = plannerCeil(rps / (performance.rpsPerReplica * (1 - s.headroom / 100))) * performance.gpusPerReplica;
          return Number.isSafeInteger(count) ? count : null;
        };
        return {month: m, value, peak, gpusP50: size(peak), gpus: size(peak === null ? null : peak * p90Multiplier(evidence, i))};
      });
      if (!performance.available) row.reason = performance.reason;
      else if (!row.reason && row.future.some(m => m.gpus === null)) row.reason = "GPU count exceeds the supported range.";
      return row;
    });
    const trainingGroups = new Map();
    const addGroup = (serviceId, p) => {
      const owner = owners.find(s => s.id === serviceId);
      if (owner) {
        trainingGroups.set(JSON.stringify([serviceId, p]), {owner, pool: p});
      }
    };
    (state.trainingHistory || []).forEach(r => addGroup(r.serviceId, r.pool));
    state.training.forEach(t => addGroup(t.serviceId, t.pool));
    for (const s of owners) {
      if (![...trainingGroups.values()].some(g => g.owner.id === s.id)) addGroup(s.id, s.pool);
    }
    const baselinePools = new Set([...inferenceRows.map(r => r.pool), ...[...trainingGroups.values()].map(g => g.pool)]);
    trainingProjects.forEach(p => addGroup(p.serviceId, p.pool));
    const trainingRows = [...trainingGroups.values()].filter(g => selectedPool === "all" || g.pool === selectedPool).map(({owner: s, pool: p}) => {
      const rows = (state.trainingHistory || []).filter(r => r.serviceId === s.id && r.pool === p);
      const byMonth = new Map(rows.map(r => [r.month, r]));
      const current = byMonth.get(latestMonth), previous = byMonth.get(previousYear);
      const before = rows.filter(r => r.month < state.startMonth);
      const recordedAllocated = before.length ? Math.max(...before.map(r => r.allocatedGpus)) : null;
      const row = applyGrowth({kind: "training", serviceId: s.id, name: s.name, team: s.team, pool: p,
        history: historicalMonths.map(m => ({month: m, value: byMonth.get(m)?.peakGpus ?? null})),
        current: current?.peakGpus ?? null, previous: previous?.peakGpus ?? null,
        allocated: assumeTrainingDemand ? current?.peakGpus ?? null : recordedAllocated,
        recordedAllocated, allocationSource: assumeTrainingDemand ? "assumed-current-demand" : "recorded-allocation",
        baselineMonth: latestMonth, synthetic: before.some(r => r.source === "synthetic")});
      const projects = trainingProjects.filter(project => project.serviceId === s.id && project.pool === p);
      row.future = futureMonths.map((m, i) => {
        const estimate = row.current === null || row.growthPct === null ? null :
          plannerCeil(row.current * (1 + row.growthPct / 100) ** ((i + 1) / 6));
        const baselineGpus = Number.isSafeInteger(estimate) ? estimate : null;
        const projectGpus = trainingProjectPeak(projects, m);
        const total = completeSum([baselineGpus, projectGpus]);
        const gpus = Number.isSafeInteger(total) ? total : null;
        return {month: m, value: gpus, gpus, gpusP50: gpus, baselineGpus,
          baselineGrowth: baselineGpus === null ? null : baselineGpus - row.current, projectGpus};
      });
      if (!row.reason && row.future.some(m => m.gpus === null)) row.reason = "GPU count exceeds the supported range.";
      return row;
    });
    const trainingProjection = futureMonths.map((m, i) => {
      const pools = [...new Set(trainingRows.map(r => r.pool))].map(p => {
        const items = trainingRows.filter(r => r.pool === p);
        const current = completeSum(items.map(r => r.current));
        const baselineGpus = completeSum(items.map(r => r.future[i].baselineGpus));
        const projectGpus = trainingProjectPeak(trainingProjects.filter(project => project.pool === p), m);
        const total = completeSum([baselineGpus, projectGpus]);
        return {pool: p, current, baselineGpus, baselineGrowth: current === null || baselineGpus === null ? null : baselineGpus - current,
          projectGpus, forecast: Number.isSafeInteger(total) ? total : null};
      });
      return {month: m, pools, ...Object.fromEntries(["current", "baselineGpus", "baselineGrowth", "projectGpus", "forecast"]
        .map(key => {
          const value = completeSum(pools.map(p => p[key]));
          return [key, Number.isSafeInteger(value) ? value : null];
        }))};
    });
    const rows = [...inferenceRows, ...trainingRows];
    for (const row of rows) {
      row.selected = row.future[targetIndex];
      row.forecast = row.selected.gpus;
      row.normalizedAllocated = computeEquivalent(row.allocated, row.pool);
      row.normalizedForecast = computeEquivalent(row.forecast, row.pool);
      row.gap = row.allocated === null || row.forecast === null ? null : row.forecast - row.allocated;
    }
    const totals = items => {
      const result = Object.fromEntries(["allocated", "forecast", "gap", "additionalGpus", "costUsd"]
        .map(key => [key, completeSum(items.map(item => item[key]))]));
      result.costReason = [...new Set(items.map(item => item.costReason).filter(Boolean))].join(" ");
      for (const key of ["allocated", "forecast", "gap", "additionalGpus"]) {
        if (result[key] !== null && !Number.isSafeInteger(result[key])) {
          result[key] = null;
          result.costUsd = null;
          result.costReason = "GPU count exceeds the supported range.";
        }
      }
      if (result.costUsd !== null && result.costUsd > Number.MAX_SAFE_INTEGER / 100) {
        result.costUsd = null;
        result.costReason = "Cost exceeds supported currency precision.";
      }
      return result;
    };
    const poolSegments = [...new Set(rows.map(r => r.pool))].map(p => {
      const selected = rows.filter(r => r.pool === p);
      const current = segmentCapacity(state, p, selectedId, selectedTeam);
      const entered = ["inference", "training"].filter(kind =>
        !(kind === "training" && assumeTrainingDemand) && !(kind === "inference" && !baselinePools.has(p)) &&
        current[`${kind}Source`] === "entered-allocation");
      const unitPriceUsd = state.gpuPurchasePrices?.find(price => price.pool === p)?.usdPerGpu ?? null;
      const kinds = Object.fromEntries(["inference", "training"].map(kind => {
        const items = selected.filter(r => r.kind === kind);
        const allocated = entered.includes(kind) ? current[kind] : completeSum(items.map(r => r.allocated));
        const forecast = kind === "training" ?
          trainingProjection[targetIndex].pools.find(row => row.pool === p)?.forecast ?? (items.length ? null : 0) :
          completeSum(items.map(r => r.forecast));
        const gap = allocated === null || forecast === null ? null : forecast - allocated;
        const additionalGpus = gap === null ? null : Math.max(0, gap);
        let costReason = additionalGpus === null ? "Demand or allocation inputs are missing or exceed the supported GPU range." :
          additionalGpus > 0 && unitPriceUsd === null ? "Enter a purchase price for this SKU." : "";
        let costUsd = costReason ? null : additionalGpus === 0 ? 0 : additionalGpus * unitPriceUsd;
        if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd > Number.MAX_SAFE_INTEGER / 100)) {
          costUsd = null;
          costReason = "Cost exceeds supported currency precision.";
        }
        return [kind, {pool: p, allocated, forecast, gap, additionalGpus, unitPriceUsd, costUsd, costReason}];
      }));
      return {pool: p, unitPriceUsd, allocationAdjusted: entered.length > 0,
        trainingOverrideIgnored: assumeTrainingDemand && current.trainingSource === "entered-allocation", ...kinds};
    });
    const pools = poolSegments.map(p => {
      const total = totals([p.inference, p.training]);
      return {...total, pool: p.pool, unitPriceUsd: p.unitPriceUsd, allocationAdjusted: p.allocationAdjusted,
        trainingOverrideIgnored: p.trainingOverrideIgnored,
        normalizedAllocated: computeEquivalent(total.allocated, p.pool), normalizedForecast: computeEquivalent(total.forecast, p.pool)};
    });
    const physical = totals(pools);
    const normalizedAllocated = completeSum(pools.map(p => p.normalizedAllocated));
    const normalizedForecast = completeSum(pools.map(p => p.normalizedForecast));
    const segments = Object.fromEntries(["inference", "training"].map(kind => {
      const selected = rows.filter(r => r.kind === kind);
      const items = poolSegments.map(p => p[kind]);
      return [kind, {
        ...totals(items),
        missing: selected.filter(r => r.forecast === null).length,
        pools: items,
      }];
    }));
    const series = kind => {
      const items = rows.filter(r => r.kind === kind);
      return [...historicalMonths.map((m, i) => ({month: m, value: items.length ? completeSum(items.map(r => r.history[i].value)) : null})),
        ...futureMonths.map((m, i) => ({month: m, value: items.length ?
          kind === "training" ? trainingProjection[i].forecast : completeSum(items.map(r => r.future[i].value)) : null}))];
    };
    return {rows, pools, segments, physical, trainingAllocationBasis, costBasis: {currency: "USD", type: "one-time GPU hardware purchase",
      allocationPolicy: "Retain allocations; positive shortages by SKU and workload segment are not offset by surpluses."},
      inferenceRows, trainingRows, trainingProjects, trainingProjection, historicalMonths, futureMonths, targetMonth,
      trainingProjectPolicy: "Incremental projects only. Baseline demand plus growth is held constant within each month. New project batches use UTC dates with exclusive end dates. Monthly project peaks are calculated jointly per SKU; individual service peaks are not additive across services.",
      series: {inference: series("inference"), training: series("training")},
      normalizedAllocated, normalizedForecast,
      normalizedGap: normalizedAllocated === null || normalizedForecast === null ? null : normalizedForecast - normalizedAllocated};
  }
  function demo() {
    const defs = [
      ["assistant", DEMO_SERVICE_LABELS.assistant.name, "Language & Reasoning", "H200-SXM-141GB", 8, 24, 90, 15000],
      ["search", DEMO_SERVICE_LABELS.search.name, "AI for Science", "H100-PCIE-80GB", 4, 90, 45, 60000],
      ["copilot", DEMO_SERVICE_LABELS.copilot.name, "World Models", "B200-SXM-180GB", 8, 30, 120, 18000],
      ["vision", DEMO_SERVICE_LABELS.vision.name, "Autonomous Vehicles", "H100-SXM-80GB", 4, 50, 60, 20000],
      ["recommend", DEMO_SERVICE_LABELS.recommend.name, "Simulation & Digital Twins", "RTX-PRO-6000-BW-SERVER-96GB", 4, 120, 30, 80000],
      ["agents", DEMO_SERVICE_LABELS.agents.name, "Robotics", "B200-SXM-180GB", 8, 20, 150, 10000],
      ["chip-design", DEMO_SERVICE_LABELS["chip-design"].name, "Chip Design Research", "H200-SXM-141GB", 8, 40, 45, 10000],
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
    normalizationKey, normalizationFor, bottomUpForecast, serviceDemandHistory, recordedAllocations, segmentCapacity, moveTraining, training, portfolio, comparePeriods, demo,
    COMPUTE_SPECS, PLANNER_MAX_MONTHS_AHEAD, GPU_PURCHASE_ASSUMPTIONS, computeEquivalent, plannerForecast, trainingProject, trainingProjectPeak, demoTrainingHistory, importTrainingHistory};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CapacityModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
