const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

function pair(state, item, kind, ratio) {
  const selectedRate = kind === "inference" ? M.profileFor(state, item).rpsPerReplica /
    M.profileFor(state, item).gpusPerReplica : 900;
  return {sku: item.pool, referenceSku: M.NORMALIZATION_REFERENCE, configuration: M.normalizationKey(kind, item),
    selectedRate, referenceRate: selectedRate / ratio, measuredOn: "2026-11-09", source: "user-benchmark",
    evidence: "Same workload and precision on both SKUs; per-GPU rates from full model replicas."};
}

test("per-service six-month growth compounds on the learned base and leaves other services unchanged", () => {
  const state = M.demo(), before = M.capacityForecast(state);
  state.services[0].scenarioGrowthPct = 100;
  const after = M.capacityForecast(state);
  const get = (f, i, id) => f.monthly[i].pools.flatMap(p => p.estimates).find(e => e.serviceId === id);
  assert.equal(get(after, 5, "assistant").peakRps, get(before, 5, "assistant").peakRps * 2);
  assert.ok(Math.abs(get(after, 0, "assistant").growthFactor - 2 ** (1 / 6)) < 1e-12);
  assert.equal(after.monthly[5].baselineRequired, before.monthly[5].baselineRequired);
  assert.deepEqual(get(after, 5, "search"), get(before, 5, "search"));
});

test("local growth and global traffic adjustments compose but launches are added only once", () => {
  const state = M.demo();
  state.services[0].scenarioGrowthPct = 100;
  state.services[0].monthlyLaunchRps = 100;
  state.forecast = {...M.defaultForecast(), trafficAdjustmentPct: 25};
  const row = M.capacityForecast(state).monthly[5].pools.flatMap(p => p.estimates).find(e => e.serviceId === "assistant");
  assert.equal(row.peakRps, row.baseRps * 2 * 1.25 + 600);
});

test("invalid service growth and malformed calibration inputs are rejected", () => {
  for (const value of [NaN, Infinity, -91, 301, "20"]) {
    const state = M.demo(); state.services[0].scenarioGrowthPct = value;
    assert.throws(() => M.validate(state), /Extra demand/);
  }
  for (const value of [0, -1, Infinity, "1"]) {
    const state = M.demo(); state.services[0].normalization.referenceRate = value;
    assert.throws(() => M.validate(state), /benchmark rate/);
  }
  const same = M.demo(), h100 = same.services.find(s => s.pool === M.NORMALIZATION_REFERENCE);
  h100.normalization.referenceRate *= 2;
  assert.throws(() => M.validate(same), /Identical SKUs/);
});

test("normalization is per workload, not a universal SKU weight, and reverses to assigned counts", () => {
  const state = M.demo(), services = state.services.filter(s => s.pool === "H200-SXM-141GB");
  services[0].normalization = pair(state, services[0], "inference", 2);
  services[1].normalization = pair(state, services[1], "inference", 3);
  const rows = M.bottomUpForecast(state).monthly[5].workloads;
  for (const [i, service] of services.entries()) {
    const row = rows.find(r => r.id === service.id);
    assert.equal(row.normalizedGpus, row.gpus * (i + 2));
    assert.equal(row.normalizedGpus / row.calibration.ratio, row.gpus);
    assert.equal(row.pool, service.pool);
  }
});

test("organization, workload and SKU rollups match the same physical and normalized total", () => {
  const state = M.demo();
  for (const month of M.bottomUpForecast(state).monthly) {
    const expected = M.capacityForecast(state).monthly.find(m => m.month === month.month);
    assert.equal(month.required, expected.required);
    assert.equal(month.required, month.workloads.reduce((n, r) => n + r.gpus, 0));
    assert.equal(month.required, month.organizations.reduce((n, o) => n + o.required, 0));
    assert.equal(month.required, month.pools.reduce((n, p) => n + p.required, 0));
    assert.ok(Math.abs(month.normalizedRequired - month.organizations.reduce((n, o) => n + o.normalizedRequired, 0)) < 1e-6);
  }
});

test("missing and stale benchmark pairs mark normalized totals partial without changing SKU demand", () => {
  const state = M.demo(), physical = M.capacityForecast(state).monthly[5].required;
  delete state.services[0].normalization;
  let result = M.bottomUpForecast(state).monthly[5];
  assert.equal(result.normalizedRequired, null);
  assert.equal(result.missing, 1);
  assert.equal(result.required, physical);
  assert.ok(result.knownNormalized > 0);
  state.services[0].normalization = pair(state, state.services[0], "inference", 2);
  state.services[0].workloadKey = "another-model-precision";
  result = M.bottomUpForecast(state).monthly[5];
  assert.equal(result.normalizedRequired, null);
  assert.match(result.workloads[0].reason, /Recalibrate/);
});

test("throughput changes and future-dated evidence cannot silently reuse a normalization ratio", () => {
  const state = M.demo(), service = state.services[0];
  service.rpsPerReplica *= 2;
  assert.match(M.normalizationFor(state, "inference", service).reason, /throughput changed/);
  service.normalization = pair(state, service, "inference", 2);
  service.normalization.measuredOn = `${state.startMonth}-01`;
  assert.equal(M.normalizationFor(state, "inference", service).available, false);
});

test("training adds to organization totals, uses its own ratio, and disappears when switched off", () => {
  const state = M.demo(), plan = state.training[0];
  plan.normalization = pair(state, plan, "training", 2);
  const month = M.bottomUpForecast(state).monthly.find(m => m.month === plan.month);
  const row = month.workloads.find(r => r.kind === "training" && r.id === plan.id);
  assert.equal(row.normalizedGpus, M.training(plan).totalGpus * 2);
  assert.equal(month.organizations.find(o => o.team === state.services[0].team).training, row.gpus);
  state.forecast = {...M.defaultForecast(), includeTraining: false};
  assert.equal(M.bottomUpForecast(state).monthly[1].workloads.some(r => r.kind === "training"), false);
});

test("SKU filters retain training even when the owning service serves on another SKU", () => {
  const state = M.demo(), plan = state.training[1];
  assert.notEqual(state.services.find(s => s.id === plan.serviceId).pool, plan.pool);
  const report = M.bottomUpForecast(state, "all", "all", plan.pool).monthly.find(m => m.month === plan.month);
  assert.equal(report.training, M.training(plan).totalGpus);
  assert.ok(report.workloads.some(r => r.id === plan.id && r.kind === "training"));
  const org = state.services.find(s => s.id === plan.serviceId).team;
  const filtered = M.bottomUpForecast(state, "all", org, plan.pool).monthly.find(m => m.month === plan.month);
  assert.equal(filtered.training, report.training);
  assert.equal(filtered.inference, 0);
});

test("moving training is immutable, preserves calibration, and changes only the scheduled month", () => {
  const state = M.demo(), before = JSON.stringify(state), plan = state.training[0];
  const moved = M.moveTraining(state, plan.id, "2027-02");
  assert.equal(JSON.stringify(state), before);
  assert.equal(M.bottomUpForecast(moved).monthly[1].training, 0);
  assert.equal(M.bottomUpForecast(moved).monthly[2].training, M.training(plan).totalGpus);
  assert.equal(M.normalizationFor(moved, "training", moved.training[0]).available, true);
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(moved))), moved);
});

test("invalid training moves reject impossible calendars and unknown plans without mutating state", () => {
  const state = M.demo(), plan = state.training[0];
  plan.days = 31;
  const before = JSON.stringify(state);
  assert.throws(() => M.moveTraining(state, plan.id, "2027-02"), /Active training days/);
  assert.throws(() => M.moveTraining(state, "missing-plan", "2027-02"), /no longer exists/);
  assert.throws(() => M.moveTraining(state, plan.id, "2029-01"), /current planning horizon/);
  assert.equal(JSON.stringify(state), before);
});

test("unsupported training counts are partial in both the exact-SKU and bottom-up forecasts", () => {
  const state = M.demo(), plan = state.training[0];
  Object.assign(plan, {parametersB: 10000, tokensB: 10000000, days: 0.01, peakTflops: 1, mfu: 1, runs: 1000});
  M.validate(state);
  const exact = M.capacityForecast(state).monthly[1];
  const report = M.bottomUpForecast(state).monthly[1];
  assert.equal(exact.complete, false);
  assert.equal(report.physicalComplete, false);
  assert.equal(report.normalizedRequired, null);
  assert.equal(report.required, exact.required);
  assert.equal(report.workloads.find(r => r.id === plan.id).gpus, null);
});

test("old workspaces without extra growth or normalization preserve physical forecasts", () => {
  const state = M.demo(), before = M.capacityForecast(state);
  for (const service of state.services) {delete service.scenarioGrowthPct; delete service.normalization;}
  for (const plan of state.training) delete plan.normalization;
  assert.deepEqual(M.capacityForecast(M.validate(state)), before);
  assert.equal(M.bottomUpForecast(state).monthly[0].normalizedRequired, null);
  assert.equal(M.bottomUpForecast(state).monthly[0].required, before.monthly[0].required);
});
