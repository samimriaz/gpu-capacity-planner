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

function replaceHistory(state, id, previousPeak, currentPeak) {
  state.records = state.records.filter(r => r.serviceId !== id);
  for (let day = 0; day < 56; day++) {
    const date = new Date(Date.UTC(2026, 8, 15) + day * 86400000).toISOString().slice(0, 10);
    state.records.push({serviceId: id, date, peakRps: day < 28 ? previousPeak : currentPeak,
      gpuHours: 8 * 24, activity: 60, requests: 0, source: "synthetic"});
  }
}

test("training growth sizes whole concurrent runs at the scheduled month independently of inference", () => {
  const state = M.demo(), before = M.bottomUpForecast(state);
  const plan = state.training[0];
  plan.month = M.months(state.startMonth)[5];
  plan.runs = 2;
  plan.scenarioGrowthPct = 50;
  const result = M.training(plan, state.startMonth);
  assert.equal(result.plannedRuns, 3);
  assert.equal(result.totalGpus, result.gang * 3);
  assert.equal(result.reservedGpuHours, result.gang * 3 * plan.days * 24);
  const after = M.bottomUpForecast(M.validate(state));
  assert.deepEqual(after.inferenceServices, before.inferenceServices);
  const last = after.monthly[5];
  assert.equal(last.training, result.totalGpus);
  assert.equal(last.workloads.find(w => w.id === plan.id).gpus, result.totalGpus);
  assert.equal(M.portfolio(state)[5].pools.find(p => p.pool === plan.pool).training, result.totalGpus);
  assert.equal(M.capacityForecast(state).monthly[5].pools.find(p => p.pool === plan.pool).training, result.totalGpus);
});

test("training growth compounds to schedule, rounds runs and does not create recurring plans", () => {
  const state = M.demo(), plan = state.training[0];
  plan.runs = 2; plan.scenarioGrowthPct = 100;
  plan.month = state.startMonth;
  assert.equal(M.training(plan, state.startMonth).plannedRuns, Math.ceil(2 * 2 ** (1 / 6)));
  assert.equal(M.training(plan).plannedRuns, 2);
  const report = M.bottomUpForecast(state);
  assert.equal(report.monthly[1].workloads.some(w => w.id === plan.id), false);
  plan.month = M.months(state.startMonth)[5]; plan.scenarioGrowthPct = -90;
  assert.equal(M.training(plan, state.startMonth).plannedRuns, 1);
  const base = M.training({...plan, scenarioGrowthPct: 0}, state.startMonth);
  assert.equal(M.training(plan, state.startMonth).gang, base.gang);
});

test("budgets default to forecast need while unentered Have leaves gaps unknown", () => {
  const state = M.demo(), pool = M.bottomUpForecast(state).monthly[0].pools[0];
  assert.equal(pool.inferenceBudget, pool.inference);
  assert.equal(pool.trainingBudget, pool.training);
  assert.equal(pool.inferenceBudgetSource, "forecast");
  assert.equal(pool.trainingBudgetSource, "forecast");
  assert.equal(pool.inferenceHave, null);
  assert.equal(pool.trainingHave, null);
  assert.equal(pool.inferenceGap, null);
  assert.equal(pool.trainingGap, null);
  assert.equal(pool.gap, pool.required - pool.usable);
});

test("legacy percentage splits preserve starting available capacity, not forecast budgets", () => {
  const state = M.demo(), sku = state.services[0].pool;
  state.supply[sku] = {installed: 11, unavailable: 1, reserve: 1, inferenceBudgetPct: 50};
  state.supply.additions.push({pool: sku, month: state.startMonth, gpus: 2});
  const before = JSON.stringify(state);
  const report = M.bottomUpForecast(M.validate(state));
  const pool = report.monthly[0].pools.find(p => p.pool === sku);
  assert.equal(pool.usable, 11);
  assert.equal(pool.inferenceHave, 5);
  assert.equal(pool.trainingHave, 6);
  assert.equal(pool.inferenceBudget, pool.inference);
  assert.equal(pool.trainingBudget, pool.training);
  assert.equal(pool.inferenceGap, pool.inference - 5);
  assert.equal(pool.trainingGap, pool.training - 6);
  assert.equal(pool.inferenceGap + pool.trainingGap, pool.gap);
  assert.equal(JSON.stringify(state), before);
  const scoped = M.bottomUpForecast(state, state.services[0].id).monthly[0].pools.find(p => p.pool === sku);
  assert.equal(scoped.inferenceBudget, scoped.inference);
  assert.equal(scoped.inferenceHave, pool.inferenceHave);
});

test("legacy zero and full splits preserve available capacity correctly", () => {
  const state = M.demo(), sku = state.services[0].pool;
  for (const pct of [0, 100]) {
    state.supply[sku].inferenceBudgetPct = pct;
    const p = M.capacityForecast(state).monthly[0].pools.find(p => p.pool === sku);
    assert.equal(p.inferenceHave, pct === 0 ? 0 : p.usable);
    assert.equal(p.trainingHave, p.usable - p.inferenceHave);
    assert.equal(p.inferenceBudget, p.inference);
  }
});

test("training exclusion zeros active budget while leaving Have and inference unchanged", () => {
  const state = M.demo(), sku = state.training[0].pool;
  state.training[0].scenarioGrowthPct = 100;
  state.supply[sku].inferenceBudgetPct = 75;
  const before = M.bottomUpForecast(state);
  state.forecast = {...M.defaultForecast(), includeTraining: false};
  const after = M.bottomUpForecast(state);
  for (const [i, m] of after.monthly.entries()) {
    assert.equal(m.training, 0);
    assert.equal(m.inference, before.monthly[i].inference);
    const p = m.pools.find(p => p.pool === sku);
    assert.equal(p.trainingBudget, 0);
    assert.equal(p.trainingGap, -p.trainingHave);
  }
});

test("invalid training growth and capacity splits are rejected", () => {
  const state = M.demo();
  state.training[0].scenarioGrowthPct = 301;
  assert.throws(() => M.validate(state), /training runs/);
  delete state.training[0].scenarioGrowthPct;
  state.supply[state.services[0].pool].inferenceBudgetPct = 101;
  assert.throws(() => M.validate(state), /capacity budget/);
});

test("incomplete inference sizing leaves its gap unknown while training gap remains usable", () => {
  const state = M.demo(), service = state.services[0];
  state.supply[service.pool].inferenceBudgetPct = 50;
  state.records = state.records.filter(r => r.serviceId !== service.id);
  const report = M.bottomUpForecast(state);
  const p = report.monthly[1].pools.find(p => p.pool === service.pool);
  assert.equal(p.inferenceComplete, false);
  assert.equal(p.inferenceGap, null);
  assert.equal(p.trainingComplete, true);
  assert.equal(p.trainingGap, p.trainingBudget - p.trainingHave);
});

test("manual budget overrides are scoped by month, service, organization and GPU SKU", () => {
  const state = M.demo(), service = state.services[0], month = M.months(state.startMonth)[1];
  state.supply[service.pool].inferenceAvailable = 10;
  state.supply[service.pool].trainingAvailable = 20;
  state.segmentBudgets = [{pool: service.pool, month, serviceId: "all", team: "all", inference: 15, training: 25}];
  const report = M.bottomUpForecast(M.validate(state));
  const p = report.monthly[1].pools.find(p => p.pool === service.pool);
  assert.equal(p.inferenceBudget, 15);
  assert.equal(p.trainingBudget, 25);
  assert.equal(p.inferenceGap, 5);
  assert.equal(p.trainingGap, 5);
  assert.equal(p.budgetRequired, 40);
  assert.equal(p.budgetGap, 40 - p.usable);
  assert.equal(p.inferenceBudgetSource, "manual");
  const first = report.monthly[0].pools.find(p => p.pool === service.pool);
  assert.equal(first.inferenceBudget, first.inference);
  const scoped = M.bottomUpForecast(state, service.id).monthly[1].pools.find(p => p.pool === service.pool);
  assert.equal(scoped.inferenceBudget, scoped.inference);
  const org = M.bottomUpForecast(state, "all", service.team).monthly[1].pools.find(p => p.pool === service.pool);
  assert.equal(org.inferenceBudget, org.inference);
  assert.ok(report.monthly[1].pools.filter(p => p.pool !== service.pool).every(p => p.inferenceBudget === p.inference));
});

test("automatic budgets follow forecast growth while manual budgets remain fixed", () => {
  const state = M.demo(), service = state.services[0], month = M.months(state.startMonth)[5];
  state.segmentBudgets = [{pool: service.pool, month, serviceId: "all", team: "all", inference: 123}];
  const before = M.bottomUpForecast(state);
  service.scenarioGrowthPct = 100;
  state.training[0].scenarioGrowthPct = 100;
  const after = M.bottomUpForecast(state);
  assert.equal(after.monthly[5].pools.find(p => p.pool === service.pool).inferenceBudget, 123);
  assert.ok(after.monthly[5].inference > before.monthly[5].inference);
  for (const [i, m] of after.monthly.entries()) for (const p of m.pools) {
    if (i !== 5 || p.pool !== service.pool) assert.equal(p.inferenceBudget, p.inference);
    assert.equal(p.trainingBudget, p.training);
  }
  const roundTrip = M.validate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(roundTrip.segmentBudgets, state.segmentBudgets);
  delete roundTrip.segmentBudgets;
  const reset = M.bottomUpForecast(roundTrip).monthly[5].pools.find(p => p.pool === service.pool);
  assert.equal(reset.inferenceBudget, reset.inference);
  assert.equal(reset.inferenceBudgetSource, "forecast");
});

test("available counts remain fixed despite future additions and do not have to exhaust supply", () => {
  const state = M.demo(), sku = state.services[0].pool;
  state.supply[sku] = {installed: 20, unavailable: 2, reserve: 2, inferenceAvailable: 4, trainingAvailable: 6};
  state.supply.additions = [{pool: sku, month: M.months(state.startMonth)[2], gpus: 10}];
  const report = M.bottomUpForecast(M.validate(state));
  for (const [i, m] of report.monthly.entries()) {
    const p = m.pools.find(p => p.pool === sku);
    assert.equal(p.inferenceHave, 4);
    assert.equal(p.trainingHave, 6);
    assert.equal(p.usable, i < 2 ? 16 : 26);
    assert.equal(p.inferenceGap, p.inferenceBudget - 4);
  }
});

test("invalid or duplicate overrides and double-counted available GPUs are rejected", () => {
  const state = M.demo(), sku = state.services[0].pool;
  state.supply[sku] = {installed: 6, unavailable: 0, reserve: 0, inferenceAvailable: 4, trainingAvailable: 3};
  state.supply.additions = [];
  assert.throws(() => M.validate(state), /exceed usable supply/);
  state.supply[sku].trainingAvailable = 2;
  state.segmentBudgets = [{pool: sku, month: state.startMonth, serviceId: "all", team: "all", inference: -1}];
  assert.throws(() => M.validate(state), /GPU budget/);
  state.segmentBudgets[0].inference = 0.5;
  assert.throws(() => M.validate(state), /GPU budget/);
  state.segmentBudgets[0].inference = 0;
  assert.doesNotThrow(() => M.validate(state));
  state.segmentBudgets.push({...state.segmentBudgets[0]});
  assert.throws(() => M.validate(state), /Duplicate segment budget/);
});

test("manual targets do not fabricate missing forecast need", () => {
  const state = M.demo(), service = state.services[0];
  state.records = state.records.filter(r => r.serviceId !== service.id);
  state.supply[service.pool].inferenceAvailable = 2;
  const p = M.bottomUpForecast(state).monthly[0].pools.find(p => p.pool === service.pool);
  assert.equal(p.inferenceBudget, null);
  assert.equal(p.inferenceGap, null);
  state.segmentBudgets = [{pool: service.pool, month: state.startMonth, serviceId: "all", team: "all", inference: 3}];
  const manual = M.bottomUpForecast(state).monthly[0].pools.find(p => p.pool === service.pool);
  assert.equal(manual.inferenceComplete, false);
  assert.equal(manual.inferenceBudget, 3);
  assert.equal(manual.inferenceGap, 1);
});

test("training exclusion preserves a zero manual target and restores it when re-enabled", () => {
  const state = M.demo(), plan = state.training[0];
  state.segmentBudgets = [{pool: plan.pool, month: plan.month, serviceId: "all", team: "all", training: 0}];
  const get = () => M.bottomUpForecast(state).monthly.find(m => m.month === plan.month).pools.find(p => p.pool === plan.pool);
  assert.equal(get().trainingBudget, 0);
  assert.equal(get().trainingBudgetSource, "manual");
  assert.ok(get().training > 0);
  state.forecast = {...M.defaultForecast(), includeTraining: false};
  assert.equal(get().trainingBudgetSource, "excluded");
  assert.equal(state.segmentBudgets[0].training, 0);
  state.forecast.includeTraining = true;
  assert.equal(get().trainingBudgetSource, "manual");
  assert.equal(get().trainingBudget, 0);
  assert.ok(get().training > 0);
});

test("service rows expose names, current observed demand and all monthly GPU estimates", () => {
  const state = M.demo(), report = M.bottomUpForecast(state);
  assert.equal(report.inferenceServices.length, 7);
  for (const service of report.inferenceServices) {
    assert.equal(service.name, state.services.find(s => s.id === service.id).name);
    assert.deepEqual(service.history.current, M.baseline(state, service.id));
    assert.equal(service.monthly.length, 6);
  }
  for (const [i, month] of report.monthly.entries()) {
    assert.equal(report.inferenceServices.reduce((n, s) => n + s.monthly[i].gpus, 0), month.inference);
  }
});

test("historical growth compares complete 28-day peak-demand windows, not assigned GPUs", () => {
  const state = M.demo();
  replaceHistory(state, "assistant", 10, 20);
  const history = M.serviceDemandHistory(state, "assistant");
  assert.equal(history.current.peakRps, 20);
  assert.equal(history.current.averageAllocated, 8);
  assert.equal(history.previousPeakRps, 10);
  assert.equal(history.observedGrowthPct, 100);
  assert.equal(history.currentStart, "2026-10-13");
  assert.equal(history.previousEnd, "2026-10-12");
  assert.equal(history.observations.length, 56);
});

test("missing history is unavailable for growth and remains a gap rather than an observed zero", () => {
  const state = M.demo();
  replaceHistory(state, "assistant", 10, 20);
  state.records = state.records.filter(r => r.serviceId !== "assistant" || r.date !== "2026-09-20");
  const history = M.serviceDemandHistory(state, "assistant");
  assert.equal(history.observedGrowthPct, null);
  assert.match(history.observedGrowthReason, /previous 27\/28/);
  assert.equal(history.observations.find(r => r.date === "2026-09-20").peakRps, null);
  assert.equal(history.current.days, 28);
});

test("zero historical baselines and declining demand have explicit, distinct growth results", () => {
  const state = M.demo();
  replaceHistory(state, "assistant", 0, 20);
  assert.equal(M.serviceDemandHistory(state, "assistant").observedGrowthPct, null);
  assert.match(M.serviceDemandHistory(state, "assistant").observedGrowthReason, /previous 28-day peak is zero/);
  replaceHistory(state, "assistant", 10, 0);
  assert.equal(M.serviceDemandHistory(state, "assistant").observedGrowthPct, -100);
});

test("post-plan observations do not leak into current demand or historical growth", () => {
  const state = M.demo(), before = M.serviceDemandHistory(state, "assistant");
  state.records.push({...state.records.find(r => r.serviceId === "assistant"), date: "2026-12-01", peakRps: 1e9});
  assert.deepEqual(M.serviceDemandHistory(state, "assistant"), before);
  assert.throws(() => M.serviceDemandHistory(state, "unknown-service"), /existing service/);
});

test("new services can have forecast demand without invented current usage or historical growth", () => {
  const state = M.demo();
  state.records = state.records.filter(r => r.serviceId !== "assistant");
  state.services[0].demandMethod = "drivers";
  const row = M.bottomUpForecast(state).inferenceServices.find(s => s.id === "assistant");
  assert.equal(row.history.current, null);
  assert.equal(row.history.observedGrowthPct, null);
  assert.deepEqual(row.history.observations, []);
  assert.ok(row.monthly.every(m => m.gpus > 0));
});

test("service forecasts respond to growth adjustments, preserve historical data and respect filters", () => {
  const state = M.demo(), before = M.bottomUpForecast(state).inferenceServices.find(s => s.id === "assistant");
  state.services[0].scenarioGrowthPct = 100;
  const report = M.bottomUpForecast(state, "assistant");
  const after = report.inferenceServices[0];
  assert.equal(report.inferenceServices.length, 1);
  assert.deepEqual(after.history, before.history);
  assert.equal(after.monthly[5].peakRps, before.monthly[5].peakRps * 2);
  assert.ok(after.forecastGrowthPct > before.forecastGrowthPct);
  const trainingOnly = M.bottomUpForecast(state, "all", "Chip Design Research", "B200-SXM-180GB");
  assert.deepEqual(trainingOnly.inferenceServices, []);
  assert.ok(trainingOnly.monthly.some(m => m.training > 0));
});

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
