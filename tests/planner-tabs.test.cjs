const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

function fixture() {
  const state = M.demo();
  state.trainingAllocationBasis = "recorded";
  const service = state.services.find(s => s.pool === "H100-SXM-80GB");
  state.services = [service];
  state.training = [];
  state.records = [];
  service.rpsPerReplica = 50;
  service.gpusPerReplica = 1;
  for (const [month, rps] of [["2025-11", 100], ["2026-11", 144]]) {
    for (let day = 1; day <= 30; day++) {
      state.records.push({serviceId: service.id, date: `${month}-${String(day).padStart(2, "0")}`,
        requests: rps * 86400, peakRps: rps, gpuHours: 240, activity: 50, source: "user-entered"});
    }
  }
  state.trainingHistory = [
    {serviceId: service.id, pool: service.pool, month: "2025-11", peakGpus: 100, allocatedGpus: 150, source: "user-entered"},
    {serviceId: service.id, pool: service.pool, month: "2026-11", peakGpus: 144, allocatedGpus: 180, source: "user-entered"},
  ];
  state.plannerTargetMonth = M.months(state.startMonth).at(-1);
  return state;
}

test("segment summaries show selected-month physical needs separately from normalized totals", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  for (const month of [state.startMonth, "2028-12"]) {
    state.plannerTargetMonth = month;
    const report = M.plannerForecast(state);
    for (const kind of ["inference", "training"]) {
      const rows = report.rows.filter(r => r.kind === kind);
      const segment = report.segments[kind];
      assert.equal(segment.forecast, rows.reduce((sum, r) => sum + r.selected.gpus, 0));
      assert.equal(segment.missing, 0);
      assert.equal(segment.forecast, segment.pools.reduce((sum, p) => sum + p.forecast, 0));
      for (const p of segment.pools) {
        assert.equal(p.forecast, rows.filter(r => r.pool === p.pool).reduce((sum, r) => sum + r.forecast, 0));
      }
    }
    assert.notEqual(report.normalizedForecast, report.segments.inference.forecast + report.segments.training.forecast);
    assert.deepEqual(JSON.parse(JSON.stringify(report)).segments, report.segments);
  }
});

test("missing segment inputs do not become zero or hide known SKU requirements", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  const missing = state.services.find(s => s.id === "search");
  state.trainingHistory = state.trainingHistory.filter(r => r.serviceId !== missing.id);
  const report = M.plannerForecast(state);
  assert.equal(report.segments.training.forecast, null);
  assert.equal(report.segments.training.missing, 1);
  assert.equal(report.segments.training.pools.find(p => p.pool === missing.pool).forecast, null);
  assert.ok(report.segments.training.pools.some(p => p.forecast > 0));
  assert.ok(report.segments.inference.forecast > 0);
});

test("explicit zero demand remains zero in segment summaries", () => {
  const state = fixture();
  state.plannerGrowth = ["inference", "training"].map(kind => ({
    kind, serviceId: state.services[0].id, pool: state.services[0].pool, growthPct: -100,
  }));
  const report = M.plannerForecast(state);
  for (const segment of Object.values(report.segments)) {
    assert.equal(segment.forecast, 0);
    assert.equal(segment.missing, 0);
    assert.equal(segment.pools[0].forecast, 0);
  }
});

test("original demo labels upgrade without resetting inputs or changing custom labels", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  state.services[0].name = "Nemotron / NIM inference";
  state.benchmarks[0].name = "Nemotron / NIM inference demo profile";
  state.services[1].name = "My scientific service";
  state.benchmarks[1].name = "My performance evidence";
  state.services[0].headroom = 35;
  const snapshot = JSON.stringify(state);
  const before = M.plannerForecast(state);
  const updated = M.validate(state);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(updated.services[0].name, "Language model inference");
  assert.equal(updated.benchmarks[0].name, "Language model inference demo profile");
  assert.equal(updated.services[1].name, "My scientific service");
  assert.equal(updated.benchmarks[1].name, "My performance evidence");
  for (const field of ["records", "trainingHistory", "training", "supply"]) {
    assert.deepEqual(updated[field], state[field]);
  }
  assert.equal(updated.services[0].headroom, 35);
  assert.deepEqual(M.plannerForecast(updated).segments, before.segments);
  assert.deepEqual(M.validate(updated), updated);
});

test("physical combined totals reconcile while H100 equivalents stay separate", () => {
  const state = M.demo();
  state.gpuPurchasePrices = [];
  state.trainingHistory = M.demoTrainingHistory(state);
  state.plannerTargetMonth = "2027-06";
  const report = M.plannerForecast(state);
  assert.equal(report.physical.forecast, report.segments.inference.forecast + report.segments.training.forecast);
  assert.equal(report.physical.allocated, report.segments.inference.allocated + report.segments.training.allocated);
  assert.equal(report.physical.gap, report.physical.forecast - report.physical.allocated);
  assert.equal(report.physical.additionalGpus, report.segments.inference.additionalGpus + report.segments.training.additionalGpus);
  assert.notEqual(report.physical.gap, report.normalizedGap);
  assert.equal(report.physical.costUsd, null);
});

test("purchase cost uses positive segment shortages without reclaiming a training surplus", () => {
  const state = fixture(), pool = state.services[0].pool;
  state.gpuPurchasePrices = [];
  state.records.forEach(r => r.gpuHours = 24);
  state.trainingHistory.forEach(r => r.allocatedGpus = 200);
  const unpriced = M.plannerForecast(state);
  assert.equal(unpriced.segments.inference.gap, 4);
  assert.equal(unpriced.segments.training.gap, -27);
  assert.equal(unpriced.physical.gap, -23);
  assert.equal(unpriced.physical.additionalGpus, 4);
  assert.equal(unpriced.physical.costUsd, null);
  state.gpuPurchasePrices = [{pool, usdPerGpu: 25000.50}];
  const priced = M.plannerForecast(M.validate(state));
  assert.equal(priced.physical.costUsd, 100002);
  assert.equal(priced.segments.training.costUsd, 0);
  assert.equal(priced.segments.inference.costUsd, 100002);
  assert.equal(priced.physical.forecast, unpriced.physical.forecast);
  assert.deepEqual(priced.rows, unpriced.rows);
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(state))).gpuPurchasePrices, state.gpuPurchasePrices);
  assert.deepEqual(JSON.parse(JSON.stringify(priced)).physical, priced.physical);
  assert.equal(priced.costBasis.currency, "USD");
});

test("zero additional need costs zero without a price; explicit zero price is preserved", () => {
  const state = fixture();
  state.gpuPurchasePrices = [];
  assert.equal(M.plannerForecast(state).physical.costUsd, 0);
  state.records.forEach(r => r.gpuHours = 24);
  state.gpuPurchasePrices = [{pool: state.services[0].pool, usdPerGpu: 0}];
  assert.equal(M.plannerForecast(state).physical.additionalGpus, 4);
  assert.equal(M.plannerForecast(state).physical.costUsd, 0);
});

test("missing prices and missing history never produce a complete-looking purchase estimate", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  state.plannerTargetMonth = "2027-06";
  state.gpuPurchasePrices = M.POOLS.map(pool => ({pool, usdPerGpu: 20000}));
  const full = M.plannerForecast(state);
  assert.equal(full.physical.costUsd, full.physical.additionalGpus * 20000);
  const needed = full.pools.find(p => p.additionalGpus > 0);
  state.gpuPurchasePrices = state.gpuPurchasePrices.filter(p => p.pool !== needed.pool);
  const partial = M.plannerForecast(state);
  assert.equal(partial.physical.costUsd, null);
  assert.match(partial.physical.costReason, /price/);
  assert.ok(partial.pools.some(p => p.costUsd > 0));
  state.gpuPurchasePrices.push({pool: needed.pool, usdPerGpu: 20000});
  state.trainingHistory = [];
  const missing = M.plannerForecast(state);
  assert.equal(missing.physical.gap, null);
  assert.equal(missing.physical.additionalGpus, null);
  assert.equal(missing.physical.costUsd, null);
  assert.match(missing.physical.costReason, /inputs are missing/);
});

test("company allocation corrections apply to segment gaps and purchase costs, not scoped records", () => {
  const state = fixture(), service = state.services[0];
  state.supply[service.pool].inferenceAvailable = 2;
  state.supply[service.pool].trainingAvailable = 100;
  state.gpuPurchasePrices = [{pool: service.pool, usdPerGpu: 10000}];
  const report = M.plannerForecast(state);
  assert.equal(report.segments.inference.allocated, 2);
  assert.equal(report.segments.training.allocated, 100);
  assert.equal(report.physical.additionalGpus, 76);
  assert.equal(report.physical.costUsd, 760000);
  assert.equal(M.plannerForecast(state, service.id).physical.costUsd, 0);
});

test("invalid purchase-price inputs are rejected explicitly", () => {
  for (const value of [-1, NaN, Infinity, "20000", 1e9 + 1]) {
    const state = fixture();
    state.gpuPurchasePrices = [{pool: state.services[0].pool, usdPerGpu: value}];
    assert.throws(() => M.validate(state), /purchase price/);
  }
  const state = fixture();
  state.gpuPurchasePrices = [{pool: "unknown", usdPerGpu: 10}];
  assert.throws(() => M.validate(state), /SKU/);
  state.gpuPurchasePrices = Array(2).fill({pool: state.services[0].pool, usdPerGpu: 10});
  assert.throws(() => M.validate(state), /Duplicate GPU purchase price/);
});

test("out-of-range hardware costs are unavailable with an explicit reason", () => {
  const state = fixture();
  state.trainingHistory.forEach(r => {r.peakGpus = 1e9; r.allocatedGpus = 0;});
  state.gpuPurchasePrices = [{pool: state.services[0].pool, usdPerGpu: 1e9}];
  const report = M.plannerForecast(state);
  assert.equal(report.segments.training.forecast, 1e9);
  assert.equal(report.physical.costUsd, null);
  assert.match(report.physical.costReason, /currency precision/);
});

test("combined costs are checked even when each segment is within currency precision", () => {
  const state = fixture();
  state.records.forEach(r => r.gpuHours = 24);
  state.trainingHistory.forEach(r => {r.peakGpus = 90070; r.allocatedGpus = 0;});
  state.gpuPurchasePrices = [{pool: state.services[0].pool, usdPerGpu: 1e9}];
  const report = M.plannerForecast(state);
  assert.equal(report.segments.inference.costUsd, 4e9);
  assert.equal(report.segments.training.costUsd, 90070e9);
  assert.equal(report.physical.costUsd, null);
  assert.match(report.physical.costReason, /currency precision/);
});

test("approved default purchase prices initialize demo and older workspaces without mutating inputs", () => {
  const demo = M.demo();
  assert.equal(demo.gpuPurchasePrices.length, M.SKU_CATALOG.filter(s => !s.legacy).length);
  assert.deepEqual(Object.fromEntries(demo.gpuPurchasePrices.map(p => [p.pool, p.usdPerGpu])), {
    "H100-SXM-80GB": 30000, "H100-PCIE-80GB": 32000, "H200-SXM-141GB": 35000,
    "B200-SXM-180GB": 40000, "RTX-PRO-6000-BW-SERVER-96GB": 17200,
  });
  assert.ok(M.GPU_PURCHASE_ASSUMPTIONS.every(p => !M.skuInfo(p.pool).legacy &&
    p.source.startsWith("https://") && p.checkedOn === "2026-11-12" && p.basis.length > 0));
  const state = fixture();
  delete state.gpuPurchasePrices;
  const before = JSON.stringify(state);
  const loaded = M.validate(state);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(loaded.gpuPurchasePrices, demo.gpuPurchasePrices);
  assert.deepEqual(loaded.records, state.records);
  assert.deepEqual(loaded.trainingHistory, state.trainingHistory);
  loaded.records.forEach(r => r.gpuHours = 24);
  assert.equal(M.plannerForecast(loaded).physical.costUsd, 4 * 30000);
});

test("saved custom, zero and cleared prices are never replaced with defaults", () => {
  const state = fixture();
  for (const prices of [[], [{pool: state.services[0].pool, usdPerGpu: 0}],
    [{pool: state.services[0].pool, usdPerGpu: 42000}]]) {
    state.gpuPurchasePrices = prices;
    delete state.gpuPurchasePriceVersion;
    const restored = M.validate(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(restored.gpuPurchasePrices, prices);
    assert.deepEqual(M.validate(restored).gpuPurchasePrices, prices);
  }
});

test("legacy uniform purchase defaults upgrade once without affecting forecasts", () => {
  const state = fixture();
  state.gpuPurchasePrices = M.GPU_PURCHASE_ASSUMPTIONS.map(p => ({pool: p.pool, usdPerGpu: 30000}));
  delete state.gpuPurchasePriceVersion;
  const before = JSON.stringify(state);
  const rows = M.plannerForecast(state).rows;
  const updated = M.validate(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(updated.gpuPurchasePriceVersion, 1);
  assert.deepEqual(updated.gpuPurchasePrices, M.demo().gpuPurchasePrices);
  assert.deepEqual(M.plannerForecast(updated).rows, rows);
  updated.gpuPurchasePrices.forEach(p => p.usdPerGpu = 30000);
  assert.deepEqual(M.validate(updated).gpuPurchasePrices, updated.gpuPurchasePrices);
});

test("partly customized old price lists are preserved and invalid revision markers rejected", () => {
  const state = fixture();
  state.gpuPurchasePrices = M.GPU_PURCHASE_ASSUMPTIONS.map(p => ({pool: p.pool, usdPerGpu: 30000}));
  state.gpuPurchasePrices[0].usdPerGpu = 45000;
  delete state.gpuPurchasePriceVersion;
  assert.deepEqual(M.validate(state).gpuPurchasePrices, state.gpuPurchasePrices);
  state.gpuPurchasePriceVersion = 2;
  assert.throws(() => M.validate(state), /price version/);
  delete state.gpuPurchasePrices;
  assert.throws(() => M.validate(state), /price version/);
});

test("training defaults to current demand without changing recorded history or inference", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  const history = JSON.stringify(state.trainingHistory);
  const report = M.plannerForecast(state);
  assert.equal(report.trainingAllocationBasis, "current-demand");
  assert.equal(report.segments.training.allocated, 5227);
  assert.equal(report.segments.training.forecast, 5374);
  assert.equal(report.segments.training.gap, 147);
  assert.equal(report.segments.training.additionalGpus, 147);
  assert.equal(report.segments.training.costUsd,
    report.segments.training.pools.reduce((sum, p) => sum + p.additionalGpus * p.unitPriceUsd, 0));
  assert.equal(report.normalizedAllocated,
    report.pools.reduce((sum, p) => sum + M.computeEquivalent(p.allocated, p.pool), 0));
  const language = report.trainingRows.find(r => r.serviceId === "assistant" && r.pool === "H200-SXM-141GB");
  assert.equal(language.allocated, 182);
  assert.equal(language.recordedAllocated, 216);
  assert.equal(language.forecast, 185);
  assert.equal(language.gap, 3);
  assert.equal(language.allocationSource, "assumed-current-demand");
  const recorded = M.plannerForecast({...state, trainingAllocationBasis: "recorded"});
  assert.equal(recorded.segments.training.allocated, 6048);
  assert.equal(recorded.segments.training.gap, -674);
  assert.deepEqual(report.inferenceRows, recorded.inferenceRows);
  assert.deepEqual(report.segments.inference, recorded.segments.inference);
  assert.equal(JSON.stringify(state.trainingHistory), history);
});

test("no-spare training baseline stays fixed across target months and growth edits", () => {
  const state = fixture(), service = state.services[0];
  state.trainingAllocationBasis = "current-demand";
  const start = M.plannerForecast(state);
  assert.equal(start.trainingRows[0].allocated, 144);
  state.plannerTargetMonth = "2028-12";
  state.plannerGrowth = [{kind: "training", serviceId: service.id, pool: service.pool, growthPct: 50}];
  const future = M.plannerForecast(state);
  assert.equal(future.trainingRows[0].allocated, 144);
  assert.equal(future.trainingRows[0].recordedAllocated, 180);
  assert.ok(future.trainingRows[0].forecast > start.trainingRows[0].forecast);
  assert.equal(future.normalizedAllocated, start.normalizedAllocated);
});

test("no-spare training bypasses stored company corrections without deleting them", () => {
  const state = fixture(), service = state.services[0];
  state.trainingAllocationBasis = "current-demand";
  state.supply[service.pool].trainingAvailable = 200;
  const report = M.plannerForecast(state);
  assert.equal(report.segments.training.allocated, 144);
  assert.equal(report.segments.training.gap, 29);
  assert.equal(report.pools[0].trainingOverrideIgnored, true);
  assert.equal(report.pools[0].allocationAdjusted, false);
  assert.equal(state.supply[service.pool].trainingAvailable, 200);
  assert.equal(M.plannerForecast(state, service.id).segments.training.allocated, 144);
  state.supply[service.pool].inferenceAvailable = 100;
  assert.equal(M.plannerForecast(state).segments.inference.allocated, 100);
  const recorded = M.plannerForecast({...state, trainingAllocationBasis: "recorded"});
  assert.equal(recorded.segments.training.allocated, 200);
  assert.equal(recorded.pools[0].trainingOverrideIgnored, false);
});

test("no-spare training does not fabricate current demand when the baseline month is missing", () => {
  const state = fixture();
  state.trainingAllocationBasis = "current-demand";
  state.trainingHistory = state.trainingHistory.filter(r => r.month !== "2026-11");
  const report = M.plannerForecast(state);
  assert.equal(report.trainingRows[0].recordedAllocated, 150);
  assert.equal(report.trainingRows[0].allocated, null);
  assert.equal(report.segments.training.gap, null);
  assert.equal(report.segments.training.costUsd, null);
});

test("zero and declining training growth keep nonpositive gaps and no purchase need", () => {
  const state = fixture(), service = state.services[0];
  state.trainingAllocationBasis = "current-demand";
  for (const growthPct of [0, -10, -100]) {
    state.plannerGrowth = [{kind: "training", serviceId: service.id, pool: service.pool, growthPct}];
    const report = M.plannerForecast(state);
    assert.equal(report.segments.training.allocated, 144);
    assert.ok(report.segments.training.gap <= 0);
    assert.equal(report.segments.training.additionalGpus, 0);
    assert.equal(report.segments.training.costUsd, 0);
  }
});

test("explicit zero current training demand means zero assumed allocation, not recorded capacity", () => {
  const state = fixture(), service = state.services[0];
  state.trainingAllocationBasis = "current-demand";
  state.trainingHistory.find(r => r.month === "2026-11").peakGpus = 0;
  state.plannerGrowth = [{kind: "training", serviceId: service.id, pool: service.pool, growthPct: 0}];
  const report = M.plannerForecast(state);
  assert.equal(report.trainingRows[0].recordedAllocated, 180);
  assert.equal(report.segments.training.allocated, 0);
  assert.equal(report.segments.training.forecast, 0);
  assert.equal(report.segments.training.gap, 0);
  assert.equal(report.segments.training.costUsd, 0);
});

test("training allocation basis upgrades and round-trips explicitly, rejecting invalid values", () => {
  const state = fixture();
  delete state.trainingAllocationBasis;
  const before = JSON.stringify(state);
  const updated = M.validate(state);
  assert.equal(updated.trainingAllocationBasis, "current-demand");
  assert.equal(JSON.stringify(state), before);
  for (const basis of ["current-demand", "recorded"]) {
    updated.trainingAllocationBasis = basis;
    assert.equal(M.validate(JSON.parse(JSON.stringify(updated))).trainingAllocationBasis, basis);
    assert.equal(JSON.parse(JSON.stringify(M.plannerForecast(updated))).trainingAllocationBasis, basis);
  }
  updated.trainingAllocationBasis = "unknown";
  assert.throws(() => M.validate(updated), /training allocation basis/);
});

test("annual 44% pace becomes 20% over six months for both segments", () => {
  const report = M.plannerForecast(fixture());
  for (const row of report.rows) {
    assert.ok(Math.abs(row.yoyPct - 44) < 1e-10);
    assert.ok(Math.abs(row.growthPct - 20) < 1e-10);
    assert.equal(row.future.length, 6);
  }
  assert.ok(Math.abs(report.inferenceRows[0].future[5].value - 172.8) < 1e-10);
  assert.equal(report.inferenceRows[0].forecast, 5);
  assert.equal(report.trainingRows[0].forecast, 173);
  assert.equal(report.series.inference.length, 18);
  assert.equal(report.series.training.length, 18);
});

test("manual six-month growth replaces the historical rate without stacking old controls", () => {
  const state = fixture(), service = state.services[0];
  state.plannerGrowth = [{kind: "inference", serviceId: service.id, pool: service.pool, growthPct: 0}];
  service.scenarioGrowthPct = 300;
  service.annualGrowth = 1000;
  state.forecast = {trafficAdjustmentPct: 300, throughputChangePct: 200, includeTraining: false, includeLaunches: true};
  const report = M.plannerForecast(state);
  assert.equal(report.inferenceRows[0].future[5].value, 144);
  assert.equal(report.inferenceRows[0].forecast, 4);
  assert.equal(report.trainingRows[0].forecast, 173);
});

test("missing prior year requires explicit growth and never implies zero", () => {
  const state = fixture();
  state.records = state.records.filter(r => r.date.startsWith("2026"));
  state.trainingHistory = state.trainingHistory.filter(r => r.month.startsWith("2026"));
  const report = M.plannerForecast(state);
  for (const row of report.rows) {
    assert.equal(row.yoyPct, null);
    assert.equal(row.forecast, null);
    assert.match(row.reason, /YoY unavailable/);
  }
  assert.equal(report.normalizedForecast, null);
});

test("manual growth works without YoY but cannot invent a missing current baseline", () => {
  const state = fixture(), service = state.services[0];
  state.trainingHistory = [];
  state.plannerGrowth = [{kind: "training", serviceId: service.id, pool: service.pool, growthPct: 10}];
  const row = M.plannerForecast(state).trainingRows[0];
  assert.equal(row.forecast, null);
  assert.equal(row.allocated, null);
  assert.match(row.reason, /missing or incomplete/);
});

test("negative growth reduces need but never reclaims allocations", () => {
  const state = fixture(), service = state.services[0];
  state.plannerGrowth = ["inference", "training"].map(kind => ({kind, serviceId: service.id, pool: service.pool, growthPct: -50}));
  const report = M.plannerForecast(state);
  assert.equal(report.inferenceRows[0].forecast, 2);
  assert.equal(report.inferenceRows[0].allocated, 10);
  assert.equal(report.trainingRows[0].forecast, 72);
  assert.equal(report.trainingRows[0].allocated, 180);
  assert.equal(report.normalizedGap, 74 - 190);
});

test("zero and minus 100% growth are distinct from unavailable data", () => {
  const state = fixture(), s = state.services[0];
  state.plannerGrowth = ["inference", "training"].map(kind => ({kind, serviceId: s.id, pool: s.pool, growthPct: -100}));
  assert.equal(M.plannerForecast(state).normalizedForecast, 0);
  state.trainingHistory[0].peakGpus = 0;
  state.plannerGrowth = [];
  assert.equal(M.plannerForecast(state).trainingRows[0].yoyPct, null);
});

test("inference partial month uses matching prior-year days and detects gaps", () => {
  const state = fixture();
  state.records = state.records.filter(r => !r.date.startsWith("2026") || +r.date.slice(8) <= 9);
  let row = M.plannerForecast(state).inferenceRows[0];
  assert.equal(row.history.at(-1).partial, true);
  assert.equal(row.history.at(-1).days, 9);
  assert.ok(Math.abs(row.yoyPct - 44) < 1e-10);
  state.records = state.records.filter(r => r.date !== "2026-11-05");
  row = M.plannerForecast(state).inferenceRows[0];
  assert.equal(row.current, null);
  assert.equal(row.forecast, null);
});

test("training history projection excludes scheduled roadmap plans and future history", () => {
  const state = fixture();
  const service = state.services[0];
  state.training = [{...M.demo().training[0], serviceId: service.id, pool: service.pool, runs: 100}];
  state.trainingHistory.push({...state.trainingHistory[0], month: "2027-01", peakGpus: 9999, allocatedGpus: 9999});
  const row = M.plannerForecast(state).trainingRows[0];
  assert.equal(row.forecast, 173);
  assert.equal(row.allocated, 180);
});

test("specification ratios normalize allocations and demand with exactly the same factor", () => {
  assert.equal(M.computeEquivalent(67, "H100-PCIE-80GB"), 51);
  assert.equal(M.computeEquivalent(67, "B200-SXM-180GB"), 75);
  assert.equal(M.computeEquivalent(67, "RTX-PRO-6000-BW-SERVER-96GB"), 120);
  assert.equal(M.computeEquivalent(10, "H100"), null);
  assert.equal(M.computeEquivalent(null, "H100-SXM-80GB"), null);
  const report = M.plannerForecast(fixture());
  assert.equal(report.normalizedAllocated, 190);
  assert.equal(report.normalizedForecast, 178);
  assert.equal(report.normalizedGap, -12);
});

test("normalization missing a SKU factor never presents a complete subtotal", () => {
  const state = fixture();
  state.services[0].pool = "H100";
  state.trainingHistory.forEach(r => { r.pool = "H100"; });
  const report = M.plannerForecast(state);
  assert.equal(report.normalizedAllocated, null);
  assert.equal(report.normalizedForecast, null);
  assert.equal(report.normalizedGap, null);
});

test("training import validates ownership, duplicates, types, and keeps unrelated rows", () => {
  const state = fixture(), original = JSON.stringify(state);
  const row = {...state.trainingHistory[0], month: "2026-10"};
  const imported = M.importTrainingHistory(state, [row]);
  assert.equal(imported.trainingHistory.length, 3);
  assert.equal(JSON.stringify(state), original);
  assert.throws(() => M.importTrainingHistory(state, [row, row]), /one training history row/);
  assert.throws(() => M.importTrainingHistory(state, [{...row, peakGpus: -1}]), /Historical peak/);
  assert.throws(() => M.importTrainingHistory(state, [{...row, serviceId: "unknown"}]), /unknown service/);
  assert.throws(() => M.importTrainingHistory(state, []), /empty/);
});

test("planner overrides and history survive workspace JSON round trips", () => {
  const state = fixture(), s = state.services[0];
  state.plannerGrowth = [{kind: "inference", serviceId: s.id, pool: s.pool, growthPct: 12.5}];
  const saved = M.validate(JSON.parse(JSON.stringify(state)));
  assert.equal(M.plannerForecast(saved).inferenceRows[0].growthPct, 12.5);
  assert.throws(() => M.validate({...state, plannerGrowth: [state.plannerGrowth[0], state.plannerGrowth[0]]}), /Duplicate planner/);
  assert.throws(() => M.validate({...state, plannerGrowth: [{...state.plannerGrowth[0], growthPct: -101}]}), /Six-month growth/);
});

test("demo training history is explicit, labeled and covers annual comparisons", () => {
  const state = M.demo();
  const rows = M.demoTrainingHistory(state);
  assert.ok(rows.every(r => r.source === "synthetic"));
  assert.equal(new Set(rows.map(r => r.month)).size, 24);
  assert.equal(state.trainingHistory, undefined);
  const report = M.plannerForecast(M.importTrainingHistory(state, rows));
  assert.ok(report.trainingRows.every(r => r.forecast > 0 && r.synthetic));
});

test("service, team and SKU filters apply to both segments", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  const s = state.services[0];
  const report = M.plannerForecast(state, s.id, s.team, s.pool);
  assert.ok(report.rows.every(r => r.serviceId === s.id && r.team === s.team && r.pool === s.pool));
  assert.equal(report.rows.length, 2);
  const empty = M.plannerForecast(state, "no-service");
  assert.equal(empty.rows.length, 0);
  assert.ok(empty.series.inference.every(p => p.value === null));
});

test("company allocation corrections are honored without attributing them to every team", () => {
  const state = fixture(), service = state.services[0];
  state.supply[service.pool].inferenceAvailable = 100;
  state.supply[service.pool].trainingAvailable = 200;
  const company = M.plannerForecast(state);
  assert.equal(company.normalizedAllocated, 300);
  assert.equal(company.pools[0].allocationAdjusted, true);
  assert.equal(company.inferenceRows[0].allocated, 10);
  assert.equal(M.plannerForecast(state, service.id).normalizedAllocated, 190);
});

test("whole-GPU rounding does not add a GPU because of floating-point noise", () => {
  const state = fixture(), s = state.services[0];
  state.trainingHistory.at(-1).peakGpus = 100;
  state.plannerGrowth = [{kind: "training", serviceId: s.id, pool: s.pool, growthPct: 10}];
  assert.equal(M.plannerForecast(state).trainingRows[0].forecast, 110);
  state.plannerGrowth[0].growthPct = 10.01;
  assert.equal(M.plannerForecast(state).trainingRows[0].forecast, 111);
});

test("filtering does not invent a training group for a service that trains on a different SKU", () => {
  const state = fixture(), service = state.services[0];
  state.trainingHistory.forEach(r => { r.pool = "H200-SXM-141GB"; });
  assert.equal(M.plannerForecast(state, service.id, "all", service.pool).trainingRows.length, 0);
});

test("selected month drives actual GPU needs, totals and gaps without shifting the baseline", () => {
  const state = fixture();
  const last = M.plannerForecast(state);
  state.plannerTargetMonth = "2026-12";
  const first = M.plannerForecast(state);
  assert.equal(first.targetMonth, "2026-12");
  assert.equal(first.trainingRows[0].forecast, 149);
  assert.equal(first.inferenceRows[0].forecast, 4);
  assert.equal(first.normalizedForecast, 153);
  assert.equal(first.normalizedGap, 153 - 190);
  assert.equal(last.normalizedForecast, 178);
  assert.equal(first.normalizedAllocated, last.normalizedAllocated);
  assert.deepEqual(first.inferenceRows[0].history, last.inferenceRows[0].history);
  assert.deepEqual(first.series, last.series);
  for (const target of first.futureMonths) {
    state.plannerTargetMonth = target;
    const report = M.plannerForecast(state);
    for (const row of report.rows) {
      assert.deepEqual(row.selected, row.future.find(m => m.month === target));
      assert.equal(row.forecast, row.selected.gpus);
      assert.equal(row.gap, row.forecast - row.allocated);
    }
  }
});

test("target selection survives JSON persistence and validates the forecast window", () => {
  const state = fixture();
  state.plannerTargetMonth = "2027-02";
  const saved = M.validate(JSON.parse(JSON.stringify(state)));
  assert.equal(M.plannerForecast(saved).targetMonth, "2027-02");
  for (const target of ["2026-11", "2029-01", "invalid"]) {
    assert.throws(() => M.validate({...state, plannerTargetMonth: target}), /forecast month|valid YYYY-MM/);
    assert.throws(() => M.plannerForecast({...state, plannerTargetMonth: target}), /forecast month|valid YYYY-MM/);
  }
  delete state.plannerTargetMonth;
  assert.equal(M.plannerForecast(state).targetMonth, state.startMonth);
});

test("dates two calendar years ahead are selectable and extend both segment projections", () => {
  const state = fixture();
  const baseline = M.plannerForecast(state);
  state.plannerTargetMonth = "2028-12";
  const report = M.plannerForecast(M.validate(state));
  assert.equal(report.targetMonth, "2028-12");
  assert.equal(report.futureMonths.length, 25);
  assert.equal(report.futureMonths.at(-1), "2028-12");
  assert.equal(report.series.inference.length, 37);
  assert.equal(report.series.training.length, 37);
  for (const row of report.rows) {
    assert.equal(row.selected.month, "2028-12");
    assert.equal(row.forecast, row.future[24].gpus);
  }
  assert.deepEqual(report.inferenceRows[0].history, baseline.inferenceRows[0].history);
  assert.equal(report.normalizedAllocated, baseline.normalizedAllocated);
  assert.equal(report.normalizedGap, report.normalizedForecast - report.normalizedAllocated);
});

test("long-range growth continues the six-month rate without capping or monthly double counting", () => {
  const state = fixture(), service = state.services[0];
  state.plannerGrowth = ["inference", "training"].map(kind => ({kind, serviceId: service.id, pool: service.pool, growthPct: 20}));
  state.plannerTargetMonth = "2028-11";
  const report = M.plannerForecast(state);
  assert.ok(Math.abs(report.inferenceRows[0].selected.value - 144 * 1.2 ** 4) < 1e-10);
  assert.equal(report.trainingRows[0].forecast, Math.ceil(144 * 1.2 ** 4));
  assert.equal(report.futureMonths.length, 24);
  state.plannerTargetMonth = "2027-06";
  assert.equal(M.plannerForecast(state).futureMonths.length, 7);
});

test("extreme long-range training growth surfaces an unavailable count rather than an unsafe integer", () => {
  const state = fixture(), service = state.services[0];
  state.trainingHistory.at(-1).peakGpus = 1e9;
  state.plannerGrowth = [{kind: "training", serviceId: service.id, pool: service.pool, growthPct: 10000}];
  state.plannerTargetMonth = "2028-12";
  const row = M.plannerForecast(state).trainingRows[0];
  assert.equal(row.forecast, null);
  assert.match(row.reason, /exceeds the supported range/);
});
