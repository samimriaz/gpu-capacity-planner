const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

test("demo validates and has a synthetic 200,000-GPU inventory", () => {
  const s = M.demo();
  assert.equal(M.POOLS.reduce((n, p) => n + s.supply[p].installed, 0), 200000);
  assert.equal(s.records.length, 420);
  assert.ok(s.records.every(r => r.source === "synthetic"));
  assert.equal(M.validate(JSON.parse(JSON.stringify(s))).services.length, 7);
});

test("calendar months cross year boundaries", () => {
  assert.deepEqual(M.months("2026-12", 3), ["2026-12", "2027-01", "2027-02"]);
});

test("baseline uses only 28-day observed window before planning starts", () => {
  const s = M.demo();
  const base = M.baseline(s, "assistant");
  assert.equal(base.days, 28);
  const before = M.inference(s, s.services[0], 0);
  s.records.push({serviceId: "assistant", date: "2027-01-01", gpuHours: 240, activity: 80, peakRps: 1e8, requests: 100, source: "user-entered"});
  assert.deepEqual(M.inference(s, s.services[0], 0), before);
  s.startMonth = "2026-01";
  assert.equal(M.baseline(s, "assistant"), null);
});

test("inference combines compound annual growth, launch increment, spare headroom and replicas", () => {
  const s = M.demo();
  const service = {...s.services[0], annualGrowth: 100, monthlyLaunchRps: 100, headroom: 20, rpsPerReplica: 50, gpusPerReplica: 8};
  const base = M.baseline(s, service.id);
  const e = M.inference(s, service, 5);
  const rps = base.peakRps * Math.sqrt(2) + 600;
  assert.equal(e.peakRps, rps);
  assert.equal(e.gpus, Math.ceil(rps / 0.8 / 50) * 8);
});

test("missing baseline remains missing, not zero healthy demand", () => {
  const s = M.demo();
  s.records = [];
  assert.equal(M.inference(s, s.services[0], 0).gpus, null);
  const p = M.portfolio(s)[0].pools.find(p => p.pool === "H200-SXM-141GB");
  assert.equal(p.complete, false);
  assert.equal(p.missing, 2);
});

test("training uses 6ND FLOPs, MFU, memory screen and topology rounding", () => {
  const p = {...M.demo().training[0], parametersB: 70, tokensB: 1000, days: 30, month: "2027-01", peakTflops: 1000, mfu: 40, memoryGB: 80, bytesPerParameter: 16, block: 8, runs: 2};
  const t = M.training(p);
  assert.equal(t.flops, 4.2e23);
  assert.equal(t.computeGpus, 406);
  assert.equal(t.memoryGpus, 14);
  assert.equal(t.gang, 408);
  assert.equal(t.totalGpus, 816);
  assert.equal(t.reservedGpuHours, 816 * 30 * 24);
  assert.ok(t.activeRuntimeDays <= 30);
});

test("memory screen can dominate compute without claiming full fit", () => {
  const p = {...M.demo().training[0], parametersB: 1000, tokensB: 0.001, memoryGB: 10, bytesPerParameter: 20, block: 256, runs: 1};
  const t = M.training(p);
  assert.equal(t.memoryGpus, 2000);
  assert.equal(t.gang, 2048);
  assert.match(t.warning, /activations/);
});

test("increased token count and worse MFU cannot reduce gang requirement", () => {
  const p = M.demo().training[0], base = M.training(p);
  assert.ok(M.training({...p, tokensB: p.tokensB * 2}).gang >= base.gang);
  assert.ok(M.training({...p, mfu: p.mfu / 2}).gang >= base.gang);
});

test("supply additions apply only after commissioning; reserve is deducted once", () => {
  const s = M.demo();
  const result = M.portfolio(s);
  const jan = result[1].pools.find(p => p.pool === "H200-SXM-141GB");
  const feb = result[2].pools.find(p => p.pool === "H200-SXM-141GB");
  assert.equal(jan.usable, 56800);
  assert.equal(feb.usable, 64992);
  assert.equal(jan.training, M.training(s.training[0]).totalGpus);
  assert.equal(feb.training, 0);
  assert.equal(jan.required, jan.inference + jan.training);
  assert.equal(jan.gap, jan.required - jan.usable);
});

test("service filtering changes demand, not shared organization supply", () => {
  const s = M.demo();
  const full = M.portfolio(s)[0], filtered = M.portfolio(s, "assistant")[0];
  assert.equal(filtered.usable, full.usable);
  assert.ok(filtered.required < full.required);
});

test("team filtering includes owning-team training and does not change supply", () => {
  const s = M.demo();
  const team = M.portfolio(s, "all", s.services[0].team);
  const full = M.portfolio(s);
  assert.equal(team[1].pools.find(p => p.pool === "H200-SXM-141GB").training, M.training(s.training[0]).totalGpus);
  assert.equal(team[3].pools.find(p => p.pool === "B200-SXM-180GB").training, 0);
  assert.equal(team[0].usable, full[0].usable);
  assert.ok(team[0].required < full[0].required);
});

test("weekly average divides by observed days, not seven blindly", () => {
  const rows = [
    {date: "2026-11-02", gpuHours: 240, requests: 100, activity: 50},
    {date: "2026-11-03", gpuHours: 480, requests: 200, activity: 80}
  ];
  const t = M.trend(rows, true);
  assert.equal(t.length, 1);
  assert.equal(t[0].averageAllocated, 15);
  assert.equal(t[0].gpuHours, 720);
  assert.equal(t[0].activity, 70);
  assert.equal(t[0].observedDays, 2);
});

test("growth handles zero baseline and two-year annualization is distinct", () => {
  assert.equal(M.growth(5, 0), null);
  assert.equal(M.growth(150, 100), 50);
  assert.equal((1 + M.growth(400, 100) / 100) ** 0.5 - 1, 1);
});

test("YoY requires complete matching coverage; missing history is unavailable", () => {
  const rows = [
    {serviceId: "a", date: "2026-11-01", gpuHours: 400},
    {serviceId: "a", date: "2026-11-02", gpuHours: 600},
    {serviceId: "a", date: "2025-11-01", gpuHours: 200},
    {serviceId: "a", date: "2025-11-02", gpuHours: 300},
  ];
  assert.equal(M.comparePeriods(rows, "2026-11-01", "2026-11-02", 1), 100);
  assert.equal(M.comparePeriods(rows.slice(0, 3), "2026-11-01", "2026-11-02", 1), null);
  assert.equal(M.comparePeriods(M.demo().records, "2026-11-01", "2026-11-02", 1), null);
});

test("invalid inputs do not produce success-shaped defaults", () => {
  for (const [field, value] of [["mfu", 0], ["tokensB", -1], ["runs", 1.5], ["peakTflops", Infinity]]) {
    const s = M.demo(); s.training[0][field] = value;
    assert.throws(() => M.validate(s));
  }
  const s = M.demo(); s.services[0].rpsPerReplica = 0;
  assert.throws(() => M.validate(s), /RPS/);
});

test("input validation rejects impossible dates, supply and malformed workspaces", () => {
  assert.throws(() => M.date("2026-02-30"), /valid/);
  assert.throws(() => M.validate({version: 99}), /version/);
  const s = M.demo(); s.supply.H100.reserve = 80000;
  assert.throws(() => M.validate(s), /reserve/);
});

test("consumption validates ownership, duplicates, provenance and request totals", () => {
  const s = M.demo();
  s.records.push({...s.records[0]});
  assert.throws(() => M.validate(s), /one daily/);
  s.records.pop(); s.records[0].requests = 1e15;
  assert.throws(() => M.validate(s), /Daily requests/);
  s.records[0].requests = 0; s.records[0].serviceId = "unknown";
  assert.throws(() => M.validate(s), /unknown service/);
});

test("training days cannot exceed calendar month", () => {
  const s = M.demo(); s.training[0].month = "2027-02"; s.training[0].days = 30;
  assert.throws(() => M.validate(s), /days in/);
});

test("serialization round trip preserves computed requirements", () => {
  const s = M.demo();
  const restored = M.validate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(M.portfolio(restored), M.portfolio(s));
});

test("v1 migration preserves historical sizing, does not mutate input, and is serializable", () => {
  const current = M.demo();
  const expected = M.portfolio(current);
  const legacy = JSON.parse(JSON.stringify(current));
  legacy.version = 1;
  delete legacy.benchmarks;
  for (const s of legacy.services) {
    for (const key of ["demandMethod", "drivers", "benchmarkId", "workloadKey", "inputTokens", "outputTokens"]) delete s[key];
  }
  const snapshot = JSON.stringify(legacy);
  const migrated = M.validate(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(JSON.stringify(legacy), snapshot);
  assert.equal(migrated.services[0].demandMethod, "historical");
  assert.deepEqual(M.portfolio(migrated), expected);
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(migrated))), migrated);
});

test("v1 migration supports maximum-length service IDs without invalid configuration keys", () => {
  const legacy = M.demo();
  legacy.version = 1;
  legacy.services[0].id = "s".repeat(150);
  legacy.records = [];
  legacy.training = [];
  const migrated = M.validate(legacy);
  assert.equal(migrated.services[0].workloadKey, legacy.services[0].id);
});

test("malformed v2 input does not silently receive v1 migration defaults", () => {
  const s = M.demo();
  s.version = 2;
  delete s.services[0].drivers;
  assert.throws(() => M.validate(s), /Demand-driver inputs are required/);
});

test("business drivers compound users, apply cache/agent multipliers, and add launches once", () => {
  const s = M.demo(), service = s.services[0];
  service.demandMethod = "drivers";
  service.annualGrowth = 100;
  service.monthlyLaunchRps = 10;
  service.drivers = {activeUsers: 100000, sessionsPerUser: 2, requestsPerSession: 3,
    callsPerRequest: 4, cacheHitPct: 25, peakToAverage: 5};
  s.records = [];
  const e = M.inference(s, service, 5);
  const organic = 100000 * Math.sqrt(2) * 2 * 3 * 4 * 0.75 / 86400 * 5;
  assert.equal(e.available, true);
  assert.equal(e.organicRps, organic);
  assert.equal(e.launchRps, 60);
  assert.equal(e.peakRps, organic + 60);
  assert.equal(e.base, null);
  assert.equal(M.portfolio(s, service.id)[0].complete, true);
});

test("100 percent cache avoidance yields no organic backend demand, but launches remain", () => {
  const s = M.demo(), service = s.services[0];
  service.demandMethod = "drivers";
  service.drivers.cacheHitPct = 100;
  assert.equal(M.inference(s, service, 0).gpus, 0);
  service.monthlyLaunchRps = 12;
  assert.equal(M.inference(s, service, 0).peakRps, 12);
});

test("invalid driver inputs are rejected rather than ignored", () => {
  const s = M.demo();
  s.services[0].drivers.cacheHitPct = 101;
  assert.throws(() => M.validate(s), /Cache/);
  s.services[0].drivers.cacheHitPct = 0;
  s.services[0].demandMethod = "magical-ai";
  assert.throws(() => M.validate(s), /historical/);
});

test("matching reusable profiles drive sizing instead of unused inline values", () => {
  const s = M.demo(), service = s.services[0], b = s.benchmarks[0];
  service.benchmarkId = b.id;
  service.rpsPerReplica = 99999;
  const e = M.inference(s, service, 0);
  assert.equal(e.gpus, Math.ceil(e.peakRps / 0.8 / b.rpsPerReplica) * b.gpusPerReplica);
  assert.equal(e.performance.source, "synthetic");
  const restored = M.validate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(M.inference(restored, restored.services[0], 0), e);
});

test("editing a shared profile recalculates all linked services", () => {
  const s = M.demo(), b = s.benchmarks[0];
  const linked = [s.services[0], s.services[6]];
  for (const service of linked) {
    service.benchmarkId = b.id;
    service.workloadKey = b.workloadKey;
  }
  M.validate(s);
  const before = linked.map(service => M.inference(s, service, 0).gpus);
  b.rpsPerReplica /= 2;
  for (const [i, service] of linked.entries()) {
    const e = M.inference(s, service, 0);
    assert.ok(e.gpus > before[i]);
    assert.equal(e.gpus, Math.ceil(e.peakRps / (1 - service.headroom / 100) / b.rpsPerReplica) * b.gpusPerReplica);
  }
});

test("profile mismatch and out-of-range token mix mark portfolio partial without fallback", () => {
  const s = M.demo(), service = s.services[0];
  service.benchmarkId = s.benchmarks[0].id;
  service.inputTokens = s.benchmarks[0].maxInputTokens + 1;
  assert.match(M.inference(s, service, 0).reason, /validity range/);
  assert.equal(M.inference(s, service, 0).gpus, null);
  assert.equal(M.portfolio(s)[0].complete, false);
  service.inputTokens = 1024;
  service.workloadKey = "other-model-or-slo";
  assert.match(M.inference(s, service, 0).reason, /configuration/);
  service.workloadKey = s.benchmarks[0].workloadKey;
  s.benchmarks[0].pool = "B200";
  assert.match(M.inference(s, service, 0).reason, /pool/);
});

test("future-dated performance evidence is not used in earlier plans", () => {
  const s = M.demo(), service = s.services[0];
  service.benchmarkId = s.benchmarks[0].id;
  s.benchmarks[0].measuredOn = `${s.startMonth}-01`;
  assert.match(M.inference(s, service, 0).reason, /dated/);
});

test("missing profile references and inverted validity bounds fail validation", () => {
  const s = M.demo();
  s.services[0].benchmarkId = "does-not-exist";
  assert.throws(() => M.validate(s), /unknown performance/);
  s.services[0].benchmarkId = "";
  s.benchmarks[0].minInputTokens = 9999;
  assert.throws(() => M.validate(s), /Maximum input/);
});

function forecastState(count = 70) {
  const s = M.demo();
  s.records = Array.from({length: count}, (_, i) => ({
    serviceId: s.services[0].id,
    date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
    peakRps: 10 * (i % 7 + 1), requests: 0, gpuHours: 24, activity: 50, source: "user-entered"
  }));
  return s;
}

test("seasonal backtest selects on validation and scores a separate later holdout", () => {
  const s = forecastState();
  const e = M.forecastEvidence(s, s.services[0].id);
  assert.equal(e.available, true);
  assert.equal(e.evaluationDays, 42);
  assert.equal(e.selected, "seasonal_7d");
  const model = e.scored.find(r => r.method === e.selected);
  assert.equal(model.validation.mae, 0);
  assert.equal(model.heldOut.mae, 0);
  assert.equal(model.validation.days, 28);
  assert.equal(model.heldOut.days, 14);
  assert.equal(e.source, "user-entered/mixed");
  assert.match(e.horizon, /not a six-month/);
  assert.ok(e.predictions.every(p => p.split === "held_out"));
});

test("predictors do not read target or future observations", () => {
  const s = forecastState();
  const history = new Map(s.records.map(r => [r.date, r.peakRps]));
  const target = s.records[40].date;
  const predictions = M.FORECAST_MODELS.map(m => M.predictPeak(history, target, m));
  for (const [d] of history) if (d >= target) history.set(d, 1e9);
  assert.deepEqual(M.FORECAST_MODELS.map(m => M.predictPeak(history, target, m)), predictions);
});

test("held-out actuals cannot influence method selection", () => {
  const s = forecastState();
  const original = M.forecastEvidence(s, s.services[0].id);
  const firstHeldOut = original.predictions[0].date;
  for (const row of s.records) if (row.date >= firstHeldOut) row.peakRps = 1000000;
  const changed = M.forecastEvidence(s, s.services[0].id);
  assert.equal(changed.selected, original.selected);
  assert.deepEqual(changed.scored.map(r => r.validation), original.scored.map(r => r.validation));
  assert.ok(changed.scored.some(r => r.heldOut.mae > 0));
});

test("post-plan records do not affect backtests", () => {
  const s = forecastState(), id = s.services[0].id;
  const before = M.forecastEvidence(s, id);
  s.records.push({...s.records[0], date: "2027-01-01", peakRps: 1e8});
  assert.deepEqual(M.forecastEvidence(s, id), before);
});

test("insufficient or missing daily history has an explicit unavailable result", () => {
  const s = forecastState(41);
  assert.equal(M.forecastEvidence(s, s.services[0].id).available, false);
  const complete = forecastState();
  complete.records.splice(-2, 1);
  const e = M.forecastEvidence(complete, complete.services[0].id);
  assert.equal(e.available, true);
  assert.equal(e.nextPeakRps, null);
  const history = new Map(complete.records.map(r => [r.date, r.peakRps]));
  assert.equal(M.predictPeak(history, e.nextDate, "rolling_28d"), null);
});

test("zero actual peaks yield undefined WAPE, not a division-by-zero score", () => {
  const s = forecastState();
  for (const r of s.records) r.peakRps = 0;
  const e = M.forecastEvidence(s, s.services[0].id);
  assert.equal(e.scored[0].heldOut.wape, null);
  assert.equal(e.scored[0].heldOut.mae, 0);
});

test("forecast errors use RPS units and WAPE is a ratio, not an already-scaled percentage", () => {
  const s = forecastState();
  const e = M.forecastEvidence(s, s.services[0].id);
  const r = e.scored.find(r => r.method === "last_day");
  const heldOut = r.predictions.filter(p => p.split === "held_out");
  const absolute = heldOut.reduce((n, p) => n + Math.abs(p.predicted - p.actual), 0);
  const signed = heldOut.reduce((n, p) => n + p.predicted - p.actual, 0);
  const actual = heldOut.reduce((n, p) => n + p.actual, 0);
  assert.equal(r.heldOut.mae, absolute / heldOut.length);
  assert.equal(r.heldOut.bias, signed / heldOut.length);
  assert.equal(r.heldOut.wape, absolute / actual);
  assert.ok(r.heldOut.mae > 0);
});
