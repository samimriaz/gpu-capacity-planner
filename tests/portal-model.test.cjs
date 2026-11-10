const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

test("demo validates and has a synthetic 200,000-GPU inventory", () => {
  const s = M.demo();
  assert.equal(M.POOLS.reduce((n, p) => n + s.supply[p].installed, 0), 200000);
  assert.equal(s.records.length, 360);
  assert.ok(s.records.every(r => r.source === "synthetic"));
  assert.equal(M.validate(JSON.parse(JSON.stringify(s))).services.length, 6);
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
  const p = M.portfolio(s)[0].pools.find(p => p.pool === "H200");
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
  const jan = result[1].pools.find(p => p.pool === "H200");
  const feb = result[2].pools.find(p => p.pool === "H200");
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
  const team = M.portfolio(s, "all", "Applied AI");
  const full = M.portfolio(s);
  assert.equal(team[1].pools.find(p => p.pool === "H200").training, M.training(s.training[0]).totalGpus);
  assert.equal(team[3].pools.find(p => p.pool === "B200").training, 0);
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
  assert.throws(() => M.validate({version: 2}), /version/);
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
