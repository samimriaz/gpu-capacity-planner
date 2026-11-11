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

test("only the latest 84 days train the model, with no mutation of the workspace", () => {
  const state = fixture(undefined, 90);
  state.startMonth = "2027-01";
  const snapshot = JSON.stringify(state);
  assert.equal(M.trafficForecast(state, "assistant").observedDays, 84);
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
