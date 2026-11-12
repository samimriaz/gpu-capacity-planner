const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

function fixture(value = i => 1000 + i * 10, count = 84) {
  const state = M.demo();
  state.services = [state.services[0]];
  state.training = [];
  state.records = Array.from({length: count}, (_, i) => ({
    serviceId: state.services[0].id,
    date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
    peakRps: value(i), requests: 0, gpuHours: 2400, activity: 70, source: "user-entered"
  }));
  return state;
}

function assignmentFixture(currentMonth = "2026-04", currentDays = 30, previousDays = 30) {
  const state = M.demo();
  state.services = state.services.slice(0, 2);
  state.training = [];
  state.records = [];
  const previousMonth = `${Number(currentMonth.slice(0, 4)) - 1}${currentMonth.slice(4)}`;
  for (const [month, days, previous] of [[currentMonth, currentDays, false], [previousMonth, previousDays, true]]) {
    for (let day = 1; day <= days; day++) {
      state.services.forEach((s, i) => {
        const gpus = previous ? 10 : (day + i) % 2 ? 10 : 30;
        state.records.push({serviceId: s.id, date: `${month}-${String(day).padStart(2, "0")}`,
          peakRps: 100, requests: 0, gpuHours: gpus * 24, activity: 70, source: "user-entered"});
      });
    }
  }
  return state;
}

test("demo exposes 12 chronological actual months with matching previous-year history", () => {
  const history = M.capacityForecast(M.demo()).historical;
  assert.equal(history.length, 12);
  assert.deepEqual(history.map(m => m.month), M.months("2025-12", 12));
  assert.ok(history.every(m => m.actual > 0 && m.previousActual > 0 && m.comparisonComplete));
  assert.equal(history.at(-1).periodEnd, "2026-11-09");
  assert.equal(history.at(-1).previousPeriodEnd, "2025-11-09");
});

test("annual gaps use simultaneous daily assignments, not the sum of separate service peaks", () => {
  const row = M.capacityForecast(assignmentFixture()).historical.find(m => m.month === "2026-04");
  assert.equal(row.actual, 40);
  assert.equal(row.previousActual, 20);
  assert.equal(row.gap, 20);
  assert.equal(row.growthPct, 100);
  assert.equal(row.completeDays, 30);
  assert.equal(row.previousCompleteDays, 30);
});

test("missing entire months remain in the annual timeline as unavailable, not zero", () => {
  const state = assignmentFixture();
  state.records = state.records.filter(r => r.date.startsWith("2025"));
  const history = M.capacityForecast(state).historical;
  assert.equal(history.length, 12);
  const row = history.find(m => m.month === "2026-04");
  assert.equal(row.actual, null);
  assert.equal(row.previousActual, 20);
  assert.equal(row.gap, null);
  assert.equal(row.growthPct, null);
  assert.match(row.comparisonReason, /Current period has 0\/30/);
});

test("partial daily coverage keeps observed values but does not calculate misleading annual gaps", () => {
  const state = assignmentFixture();
  state.records = state.records.filter(r => r.date !== "2026-04-03");
  const row = M.capacityForecast(state).historical.find(m => m.month === "2026-04");
  assert.equal(row.actual, 40);
  assert.equal(row.completeDays, 29);
  assert.equal(row.gap, null);
  assert.match(row.comparisonReason, /Current period has 29\/30/);
  const previous = assignmentFixture();
  previous.records = previous.records.filter(r => !(r.date === "2025-04-03" && r.serviceId === "assistant"));
  const missing = M.capacityForecast(previous).historical.find(m => m.month === "2026-04");
  assert.equal(missing.previousActual, null);
  assert.equal(missing.growthPct, null);
  assert.match(missing.comparisonReason, /Previous year has 29\/30/);
});

test("month-to-date comparison uses the same ending day in the previous year", () => {
  const state = assignmentFixture("2026-11", 9, 30);
  state.records.filter(r => r.date.startsWith("2025-11") && r.date > "2025-11-09")
    .forEach(r => { r.gpuHours = 1000 * 24; });
  const row = M.capacityForecast(state).historical.at(-1);
  assert.equal(row.expectedDays, 9);
  assert.equal(row.previousExpectedDays, 9);
  assert.equal(row.previousActual, 20);
  assert.equal(row.gap, 20);
  assert.equal(row.growthPct, 100);
  assert.equal(row.previousPeriodEnd, "2025-11-09");
});

test("complete leap-year months compare with the complete corresponding previous month", () => {
  const state = assignmentFixture("2024-02", 29, 28);
  state.startMonth = "2024-03";
  const row = M.capacityForecast(state).historical.at(-1);
  assert.equal(row.month, "2024-02");
  assert.equal(row.expectedDays, 29);
  assert.equal(row.previousExpectedDays, 28);
  assert.equal(row.previousPeriodEnd, "2023-02-28");
  assert.equal(row.growthPct, 100);
});

test("zero previous-year values allow an absolute gap but never invent percentage growth", () => {
  const state = assignmentFixture();
  state.records.filter(r => r.date.startsWith("2025")).forEach(r => { r.gpuHours = 0; });
  const row = M.capacityForecast(state).historical.find(m => m.month === "2026-04");
  assert.equal(row.previousActual, 0);
  assert.equal(row.gap, 40);
  assert.equal(row.growthPct, null);
  assert.match(row.comparisonReason, /zero/);
  state.records.forEach(r => { r.gpuHours = r.date.startsWith("2026") ? 0 : 10 * 24; });
  const decline = M.capacityForecast(state).historical.find(m => m.month === "2026-04");
  assert.equal(decline.actual, 0);
  assert.equal(decline.growthPct, -100);
});

test("historical comparisons use the same service, organization and SKU filters as the forecast", () => {
  const state = assignmentFixture();
  const get = report => report.historical.find(m => m.month === "2026-04");
  const selected = get(M.capacityForecast(state, "assistant"));
  assert.equal(selected.actual, 30);
  assert.equal(selected.previousActual, 10);
  assert.equal(selected.growthPct, 200);
  assert.deepEqual(get(M.capacityForecast(state, "all", "Language & Reasoning")), selected);
  assert.equal(get(M.capacityForecast(state, "all", "all", "H100-PCIE-80GB")).actual, 30);
});

test("unrepresentable annual percentage gaps remain unavailable with an explicit reason", () => {
  const state = assignmentFixture();
  state.records.filter(r => r.date.startsWith("2025")).forEach(r => { r.gpuHours = 1e-310; });
  const row = M.capacityForecast(state).historical.find(m => m.month === "2026-04");
  assert.ok(row.previousActual > 0);
  assert.equal(row.growthPct, null);
  assert.match(row.comparisonReason, /supported range/);
});

test("annual history is immutable, ignores post-plan records and does not change with scenario adjustments", () => {
  const state = assignmentFixture(), original = JSON.stringify(state);
  const before = M.capacityForecast(state).historical;
  assert.equal(JSON.stringify(state), original);
  state.forecast = {...M.defaultForecast(), trafficAdjustmentPct: 50};
  state.records.push({...state.records[0], date: "2026-12-01", gpuHours: 1e9});
  state.records.reverse();
  assert.deepEqual(M.capacityForecast(state).historical, before);
});

test("forecast learns a rising trend from history rather than the manual annual rate", () => {
  const state = fixture();
  const forecast = M.trafficForecast(state, state.services[0].id);
  assert.equal(forecast.available, true);
  assert.equal(forecast.method, "linear_trend");
  assert.equal(forecast.fit.slope, 10);
  assert.equal(forecast.monthly.length, 6);
  assert.ok(forecast.monthly[5].peakRps > forecast.monthly[0].peakRps);
  state.services[0].annualGrowth = -90;
  assert.deepEqual(M.trafficForecast(state, state.services[0].id), forecast);
});

test("flat demand chooses the simpler average model and stays flat", () => {
  const state = fixture(() => 100);
  const forecast = M.trafficForecast(state, state.services[0].id);
  assert.equal(forecast.method, "recent_average");
  assert.ok(forecast.monthly.every(m => m.peakRps === 100));
});

test("weekday patterns are learned without inventing annual seasonality", () => {
  const state = fixture(i => i % 7 === 0 ? 500 : 100);
  const forecast = M.trafficForecast(state, state.services[0].id);
  assert.ok(forecast.monthly.every(m => m.peakRps === 500));
  assert.ok(forecast.monthly[0].daily.some(p => p.peakRps === 100));
});

test("falling forecasts never become negative", () => {
  const state = fixture(i => 1000 - 10 * i);
  const forecast = M.trafficForecast(state, state.services[0].id);
  assert.equal(forecast.method, "linear_trend");
  assert.ok(forecast.monthly.flatMap(m => m.daily).every(p => p.peakRps >= 0));
  assert.equal(forecast.monthly.at(-1).peakRps, 0);
});

test("zero traffic is a valid forecast, with WAPE unavailable", () => {
  const state = fixture(() => 0);
  const forecast = M.trafficForecast(state, state.services[0].id);
  assert.equal(forecast.available, true);
  assert.equal(forecast.selectedWape, null);
  assert.equal(M.capacityForecast(state).monthly[0].required, 0);
});

test("P90 sizing widens the P50 base by the holdout spread scaled by the square root of months ahead", () => {
  const state = fixture(i => 1000 + (i % 5) * 60);
  const forecast = M.trafficForecast(state, state.services[0].id);
  assert.ok(forecast.band.relativeSd > 0);
  const ratios = M.capacityForecast(state).monthly.map(m => {
    const e = m.pools.flatMap(p => p.estimates)[0];
    return {p50: e.peakRps, p90: e.peakRpsP90};
  }).map(({p50, p90}) => p90 / p50 - 1);
  const first = ratios[0];
  ratios.forEach((r, i) => assert.ok(Math.abs(r - first * Math.sqrt(i + 1)) < 1e-9));
  assert.ok(ratios.every(r => r >= 0));
});

test("flat history has zero spread, so P90 equals P50 for GPUs and budget defaults", () => {
  const state = fixture(() => 100);
  const forecast = M.capacityForecast(state);
  assert.equal(forecast.monthly[0].pools.flatMap(p => p.estimates)[0].bandAvailable, true);
  for (const m of forecast.monthly) {
    for (const p of m.pools) {
      assert.equal(p.inferenceP50, p.inference);
      assert.equal(p.requiredP50, p.required);
    }
  }
});

test("zero traffic has no spread band, so the P90 need falls back to P50", () => {
  const state = fixture(() => 0);
  assert.equal(M.trafficForecast(state, state.services[0].id).band, null);
  const first = M.capacityForecast(state).monthly[0].pools.flatMap(p => p.estimates)[0];
  assert.equal(first.bandAvailable, false);
  assert.equal(first.gpusP50, first.gpus);
});

test("noisy history makes the default budget the P90 need, never below the P50 need", () => {
  const state = fixture(i => 1000 + (i % 5) * 60);
  for (const m of M.capacityForecast(state).monthly) {
    for (const p of m.pools) {
      assert.ok(p.inferenceP50 <= p.inference);
      assert.equal(p.inferenceBudget, p.inference);
      assert.ok(p.requiredP50 <= p.required);
    }
  }
});


test("model selection predicts all 14 later days without reading their observations", () => {
  const state = fixture();
  const original = M.trafficForecast(state, state.services[0].id);
  for (const row of state.records.slice(-14)) row.peakRps *= 2;
  const changed = M.trafficForecast(state, state.services[0].id);
  for (const before of original.scores) {
    const after = changed.scores.find(s => s.method === before.method);
    assert.deepEqual(after.predictions.map(p => p.predicted), before.predictions.map(p => p.predicted));
    assert.notEqual(after.mae, before.mae);
  }
});

test("post-plan observations do not leak into models or capacity history", () => {
  const state = fixture();
  const expected = M.capacityForecast(state);
  state.records.push({...state.records[0], date: "2027-01-01", peakRps: 1e9});
  assert.deepEqual(M.capacityForecast(state), expected);
});

test("forecast bridges the calendar gap before planning starts", () => {
  const state = fixture();
  const forecast = M.trafficForecast(state, state.services[0].id);
  const target = forecast.monthly[0].daily[0];
  const elapsed = (Date.parse(target.date) - Date.parse(state.records[0].date)) / 86400000;
  assert.equal(target.peakRps, 1000 + elapsed * 10);
  assert.ok(forecast.gapDays > 0);
  assert.equal(forecast.monthly[0].daily.length, 31);
  assert.equal(forecast.monthly[2].daily.length, 28);
});

test("minimum coverage is exactly 42 consecutive days and gaps stay missing", () => {
  assert.equal(M.trafficForecast(fixture(undefined, 41), "assistant").available, false);
  assert.equal(M.trafficForecast(fixture(undefined, 42), "assistant").available, true);
  const state = fixture();
  state.records.splice(-10, 1);
  const forecast = M.trafficForecast(state, "assistant");
  assert.equal(forecast.available, false);
  assert.equal(forecast.observedDays, 9);
  assert.match(forecast.reason, /missing days/);
});

test("only the latest 364 days (52 whole weeks) train the model, with no mutation of the workspace", () => {
  const state = fixture(undefined, 400);
  state.startMonth = "2027-11";
  const snapshot = JSON.stringify(state);
  assert.equal(M.trafficForecast(state, "assistant").observedDays, 364);
  M.capacityForecast(state);
  assert.equal(JSON.stringify(state), snapshot);
});

test("forecast adjustments change planned demand but not the learned base", () => {
  const state = fixture();
  const base = M.capacityForecast(state);
  state.forecast = {...M.defaultForecast(), trafficAdjustmentPct: 20};
  const raised = M.capacityForecast(state);
  for (const [i, month] of raised.monthly.entries()) {
    assert.equal(month.baselineRequired, base.monthly[i].baselineRequired);
    assert.ok(month.required > base.monthly[i].required);
    const row = month.pools.find(p => p.pool === "H200-SXM-141GB").estimates[0];
    assert.equal(row.peakRps, row.baseRps * 1.2);
  }
  state.forecast.throughputChangePct = 50;
  assert.ok(M.capacityForecast(state).monthly[0].required < raised.monthly[0].required);
});

test("launches are added once, after traffic adjustment, and can be excluded", () => {
  const state = fixture();
  state.services[0].monthlyLaunchRps = 100;
  state.forecast = {...M.defaultForecast(), trafficAdjustmentPct: 20};
  const row = M.capacityForecast(state).monthly[5].pools.find(p => p.pool === "H200-SXM-141GB").estimates[0];
  assert.equal(row.launchRps, 600);
  assert.equal(row.peakRps, row.baseRps * 1.2 + 600);
  state.forecast.includeLaunches = false;
  const excluded = M.capacityForecast(state).monthly[5].pools.find(p => p.pool === "H200-SXM-141GB").estimates[0];
  assert.equal(excluded.launchRps, 0);
});

test("training toggles, supply additions and filters all affect the same forecast", () => {
  const state = M.demo();
  const full = M.capacityForecast(state);
  const jan = full.monthly[1].pools.find(p => p.pool === "H200-SXM-141GB");
  const feb = full.monthly[2].pools.find(p => p.pool === "H200-SXM-141GB");
  assert.equal(jan.training, M.training(state.training[0]).totalGpus);
  assert.equal(feb.usable - jan.usable, 8192);
  const filtered = M.capacityForecast(state, "assistant", "all", "H200-SXM-141GB");
  assert.equal(filtered.services.length, 1);
  assert.equal(filtered.monthly[1].pools.length, 1);
  assert.equal(filtered.monthly[1].usable, jan.usable);
  assert.equal(filtered.monthly[1].pools[0].training, jan.training);
  state.forecast = {...M.defaultForecast(), includeTraining: false};
  const without = M.capacityForecast(state);
  assert.equal(without.monthly[1].pools.find(p => p.pool === "H200-SXM-141GB").training, 0);
  assert.equal(full.monthly[1].required - without.monthly[1].required, jan.training);
});

test("missing history and incompatible profiles make totals partial, never healthy zero demand", () => {
  const state = fixture(undefined, 41);
  const forecast = M.capacityForecast(state);
  assert.equal(forecast.monthly[0].complete, false);
  assert.equal(forecast.services[0].available, false);
  const valid = fixture();
  valid.services[0].benchmarkId = valid.benchmarks[0].id;
  valid.services[0].workloadKey = "other-model";
  const mismatched = M.capacityForecast(valid);
  assert.equal(mismatched.monthly[0].complete, false);
  assert.match(mismatched.services[0].reason, /configuration/);
});

test("driver plans grow only with scenario growth in the capacity forecast, not annual growth too", () => {
  const withAnnual = fixture();
  withAnnual.records = [];
  withAnnual.services[0].demandMethod = "drivers";
  withAnnual.services[0].annualGrowth = 50;
  const withoutAnnual = structuredClone(withAnnual);
  withoutAnnual.services[0].annualGrowth = 0;
  const a = M.capacityForecast(withAnnual).monthly[5].pools.flatMap(p => p.estimates)[0];
  const b = M.capacityForecast(withoutAnnual).monthly[5].pools.flatMap(p => p.estimates)[0];
  assert.equal(a.baseRps, b.baseRps);
  assert.equal(a.peakRps, b.peakRps);
  withAnnual.services[0].scenarioGrowthPct = 20;
  const scenario = M.capacityForecast(withAnnual).monthly[5].pools.flatMap(p => p.estimates)[0];
  assert.ok(Math.abs(scenario.peakRps / a.peakRps - 1.2) < 1e-9);
});

test("new services can explicitly use driver plans without pretending they have history", () => {
  const state = fixture();
  state.records = [];
  state.services[0].demandMethod = "drivers";
  const forecast = M.capacityForecast(state);
  assert.equal(forecast.services[0].history.available, false);
  assert.equal(forecast.services[0].demand.source, "drivers");
  assert.equal(forecast.monthly[0].complete, true);
  assert.ok(forecast.monthly[0].required > 0);
});

test("invalid saved forecast options fail validation, while older workspaces retain defaults", () => {
  const state = fixture();
  assert.deepEqual(M.capacityForecast(state).options, M.defaultForecast());
  state.forecast = {...M.defaultForecast(), trafficAdjustmentPct: NaN};
  assert.throws(() => M.validate(state), /traffic adjustment/);
  state.forecast = {...M.defaultForecast(), includeTraining: "yes"};
  assert.throws(() => M.validate(state), /true or false/);
  state.forecast = {...M.defaultForecast(), trafficAdjustmentPct: 25};
  const restored = M.validate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(M.capacityForecast(restored), M.capacityForecast(state));
});

test("incomplete historical totals remain unavailable rather than plotted as zero", () => {
  const state = M.demo();
  state.records = state.records.filter(r => !(r.date === "2026-10-15" && r.serviceId === "assistant"));
  const forecast = M.capacityForecast(state);
  assert.equal(forecast.historical.find(p => p.month === "2026-10").actual, null);
});

test("unrepresentable GPU counts are explicitly unavailable, not rounded into plausible totals", () => {
  const state = fixture(() => 1e9);
  state.services[0].rpsPerReplica = 0.0001;
  state.services[0].gpusPerReplica = 1024;
  M.validate(state);
  const forecast = M.capacityForecast(state);
  assert.equal(forecast.services[0].available, false);
  assert.match(forecast.services[0].reason, /count range/);
  assert.ok(forecast.monthly.every(m => !m.complete));
});

test("reused benchmark edits recalculate learned forecasts, not just manual scenarios", () => {
  const state = fixture(), service = state.services[0];
  service.benchmarkId = state.benchmarks[0].id;
  const before = M.capacityForecast(state);
  state.benchmarks[0].rpsPerReplica /= 2;
  const after = M.capacityForecast(state);
  assert.ok(after.monthly[0].required > before.monthly[0].required);
  assert.deepEqual(after.services[0].history, before.services[0].history);
});
