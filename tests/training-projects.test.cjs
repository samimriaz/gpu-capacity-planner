const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

function fixture() {
  const state = M.demo();
  state.services = [state.services[0]];
  state.records = state.records.filter(r => r.serviceId === state.services[0].id);
  state.training = [];
  state.trainingHistory = ["2025-11", "2026-11"].map(month => ({
    serviceId: state.services[0].id, pool: state.services[0].pool,
    month, peakGpus: 100, allocatedGpus: 120, source: "user-entered",
  }));
  return state;
}

function project(overrides = {}) {
  return {id: "project-1", name: "New pretraining", serviceId: "assistant", pool: "H200-SXM-141GB",
    startDate: "2026-12-01", parametersB: 1, tokensB: 1, days: 4, peakTflops: 100,
    mfu: 50, memoryGB: 141, bytesPerParameter: 16, block: 8, runs: 1, concurrentRuns: 1,
    incremental: true, ...overrides};
}

test("parameter-based projects reproduce the 70B / 1T / 12-day sizing example", () => {
  const result = M.trainingProject(project({parametersB: 70, tokensB: 1000, days: 12,
    peakTflops: 989, mfu: 40, block: 256}));
  assert.equal(result.computeGpus, 1024);
  assert.equal(result.memoryGpus, 8);
  assert.equal(result.gang, 1024);
  assert.equal(result.endDate, "2026-12-13");
  assert.equal(result.lastActiveDate, "2026-12-12");
  assert.equal(result.reservedGpuHours, 1024 * 12 * 24);
});

test("memory can dominate compute and topology blocks round up, not down", () => {
  const result = M.trainingProject(project({parametersB: 70, tokensB: 0.001, memoryGB: 80, block: 8}));
  assert.equal(result.computeGpus, 1);
  assert.equal(result.memoryGpus, 14);
  assert.equal(result.gang, 16);
});

test("back-to-back batches schedule all runs and reduce the last partial batch", () => {
  const result = M.trainingProject(project({startDate: "2026-12-28", days: 4, runs: 5, concurrentRuns: 2}));
  assert.equal(result.batches, 3);
  assert.equal(result.peakGpus, 16);
  assert.equal(result.endDate, "2027-01-09");
  assert.equal(result.lastActiveDate, "2027-01-08");
  assert.deepEqual(result.schedule, [
    {startDate: "2026-12-28", endDate: "2027-01-05", gpus: 16},
    {startDate: "2027-01-05", endDate: "2027-01-09", gpus: 8},
  ]);
  assert.equal(result.reservedGpuHours, 8 * 5 * 4 * 24);
  assert.equal(M.trainingProjectPeak([result], "2027-01"), 16);
  assert.equal(M.trainingProjectPeak([result], "2027-02"), 0);
  const tailOnly = M.trainingProject(project({startDate: "2026-12-24", days: 4, runs: 5, concurrentRuns: 2}));
  assert.equal(M.trainingProjectPeak([tailOnly], "2026-12"), 16);
  assert.equal(M.trainingProjectPeak([tailOnly], "2027-01"), 8);
});

test("sequential projects reuse GPUs at an exclusive end boundary", () => {
  const first = M.trainingProject(project());
  const next = M.trainingProject(project({id: "project-2", startDate: "2026-12-05"}));
  assert.equal(M.trainingProjectPeak([first, next], "2026-12"), 8);
  const overlapping = M.trainingProject(project({id: "project-2", startDate: "2026-12-04"}));
  assert.equal(M.trainingProjectPeak([first, overlapping], "2026-12"), 16);
});

test("UTC schedule handles leap days, year transitions and no extra end-day demand", () => {
  const leap = M.trainingProject(project({startDate: "2028-02-28", days: 2}));
  assert.equal(leap.lastActiveDate, "2028-02-29");
  assert.equal(M.trainingProjectPeak([leap], "2028-02"), 8);
  assert.equal(M.trainingProjectPeak([leap], "2028-03"), 0);
  const year = M.trainingProject(project({startDate: "2026-12-31", days: 2}));
  assert.equal(M.trainingProjectPeak([year], "2026-12"), 8);
  assert.equal(M.trainingProjectPeak([year], "2027-01"), 8);
});

test("new projects add to baseline plus growth without changing history or inference", () => {
  const state = fixture();
  state.plannerTargetMonth = "2027-05";
  state.plannerGrowth = [{kind: "training", serviceId: "assistant", pool: "H200-SXM-141GB", growthPct: 20}];
  const before = M.plannerForecast(state);
  const retained = JSON.stringify({history: state.trainingHistory, records: state.records, supply: state.supply});
  state.trainingProjects = [project({startDate: "2027-05-01"})];
  const report = M.plannerForecast(M.validate(state));
  const month = report.trainingProjection.find(p => p.month === report.targetMonth);
  assert.equal(month.current, 100);
  assert.equal(month.baselineGrowth, 20);
  assert.equal(month.baselineGpus, 120);
  assert.equal(month.projectGpus, 8);
  assert.equal(month.forecast, 128);
  assert.equal(report.segments.training.allocated, 100);
  assert.equal(report.segments.training.forecast, 128);
  assert.equal(report.segments.training.gap, 28);
  assert.equal(report.segments.training.costUsd, 28 * 35000);
  assert.equal(report.series.training.at(-1).value, 128);
  assert.equal(report.normalizedForecast - before.normalizedForecast, 8);
  assert.deepEqual(report.inferenceRows, before.inferenceRows);
  assert.deepEqual(report.segments.inference, before.segments.inference);
  assert.equal(JSON.stringify({history: state.trainingHistory, records: state.records, supply: state.supply}), retained);
  assert.equal(report.trainingProjects[0].team, state.services[0].team);
});

test("SKU totals and charts use concurrent project peaks across services, not sums of service peaks", () => {
  const state = fixture();
  const second = {...state.services[0], id: "other", name: "Other service", team: "Other team"};
  state.services.push(second);
  state.trainingHistory.push(...state.trainingHistory.map(r => ({...r, serviceId: "other"})));
  state.trainingProjects = [project(), project({id: "project-2", serviceId: "other", startDate: "2026-12-05"})];
  const report = M.plannerForecast(state);
  assert.deepEqual(report.trainingRows.map(r => r.forecast), [108, 108]);
  assert.equal(report.segments.training.forecast, 208);
  assert.equal(report.segments.training.additionalGpus, 8);
  assert.equal(report.trainingProjection[0].projectGpus, 8);
  assert.equal(report.series.training[12].value, 208);
  assert.equal(M.plannerForecast(state, "other").segments.training.forecast, 108);
  assert.equal(M.plannerForecast(state, "all", "Other team").trainingProjects.length, 1);
  state.trainingProjects[1].startDate = "2026-12-04";
  assert.equal(M.plannerForecast(state).segments.training.forecast, 216);
});

test("different GPU SKUs do not offset each other's project capacity", () => {
  const state = fixture();
  state.trainingHistory.push(...state.trainingHistory.map(r => ({...r, pool: "B200-SXM-180GB"})));
  state.trainingProjects = [project(), project({id: "project-2", pool: "B200-SXM-180GB", startDate: "2026-12-05"})];
  const report = M.plannerForecast(state);
  assert.equal(report.segments.training.forecast, 216);
  assert.equal(report.segments.training.additionalGpus, 16);
  assert.equal(report.segments.training.costUsd, 8 * 35000 + 8 * 40000);
  const scoped = M.plannerForecast(state, "all", "all", "B200-SXM-180GB");
  assert.equal(scoped.trainingProjects.length, 1);
  assert.equal(scoped.segments.training.forecast, 108);
});

test("missing baseline remains unavailable but known project demand is shown", () => {
  const state = fixture();
  state.trainingHistory = state.trainingHistory.filter(r => r.month !== "2026-11");
  state.trainingProjects = [project()];
  const report = M.plannerForecast(state);
  assert.equal(report.trainingProjection[0].projectGpus, 8);
  assert.equal(report.trainingProjection[0].baselineGpus, null);
  assert.equal(report.segments.training.forecast, null);
  assert.equal(report.segments.training.costUsd, null);
  assert.match(report.trainingRows[0].reason, /missing/);
});

test("a new project SKU is represented without inventing a zero historical baseline", () => {
  const state = fixture();
  state.trainingProjects = [project({pool: "B200-SXM-180GB"})];
  const report = M.plannerForecast(state);
  const added = report.trainingRows.find(r => r.pool === "B200-SXM-180GB");
  assert.equal(added.current, null);
  assert.equal(added.selected.projectGpus, 8);
  assert.equal(added.forecast, null);
  assert.equal(report.segments.training.forecast, null);
});

test("adding a project-only SKU does not activate unrelated inference allocation corrections", () => {
  const state = fixture();
  state.supply["B200-SXM-180GB"].inferenceAvailable = 123;
  const before = M.plannerForecast(state);
  state.trainingProjects = [project({pool: "B200-SXM-180GB"})];
  const after = M.plannerForecast(M.validate(state));
  assert.deepEqual(after.inferenceRows, before.inferenceRows);
  for (const key of ["allocated", "forecast", "gap", "additionalGpus", "costUsd"]) {
    assert.equal(after.segments.inference[key], before.segments.inference[key]);
  }
});

test("zero and declining baseline growth do not suppress or compound project demand", () => {
  const state = fixture();
  state.trainingHistory.forEach(r => r.peakGpus = 0);
  state.plannerGrowth = [{kind: "training", serviceId: "assistant", pool: "H200-SXM-141GB", growthPct: 0}];
  state.trainingProjects = [project()];
  assert.equal(M.plannerForecast(state).segments.training.forecast, 8);
  state.trainingHistory.forEach(r => r.peakGpus = 100);
  state.plannerGrowth[0].growthPct = -100;
  const report = M.plannerForecast(state);
  assert.equal(report.trainingProjection[0].baselineGpus, 0);
  assert.equal(report.trainingProjection[0].projectGpus, 8);
  assert.equal(report.segments.training.gap, -92);
});

test("recorded allocation corrections remain compatible with new project demand", () => {
  const state = fixture();
  state.trainingProjects = [project()];
  state.trainingAllocationBasis = "recorded";
  assert.equal(M.plannerForecast(state).segments.training.allocated, 120);
  state.supply["H200-SXM-141GB"].trainingAvailable = 200;
  const report = M.plannerForecast(state);
  assert.equal(report.segments.training.allocated, 200);
  assert.equal(report.segments.training.forecast, 108);
  assert.equal(report.segments.training.costUsd, 0);
});

test("old workspaces start with no new projects and legacy roadmap plans are not auto-added", () => {
  const state = M.demo();
  state.trainingHistory = M.demoTrainingHistory(state);
  delete state.trainingProjects;
  const before = JSON.stringify(state);
  const updated = M.validate(state);
  assert.deepEqual(updated.trainingProjects, []);
  assert.equal(JSON.stringify(state), before);
  assert.equal(M.plannerForecast(updated).trainingProjection[0].projectGpus, 0);
  updated.trainingProjects = [project()];
  const restored = M.validate(JSON.parse(JSON.stringify(updated)));
  assert.deepEqual(restored.trainingProjects, updated.trainingProjects);
  assert.deepEqual(M.plannerForecast(restored).trainingProjection, M.plannerForecast(updated).trainingProjection);
});

test("project validation rejects duplicate IDs, unknown owners, invalid sizing and schedule inputs", () => {
  const state = fixture();
  for (const invalid of [
    {incremental: false}, {serviceId: "missing"}, {pool: "H100"}, {days: 0}, {days: 1.5}, {days: 366},
    {runs: 0}, {runs: 1, concurrentRuns: 2}, {concurrentRuns: 0}, {startDate: "2027-02-29"},
    {startDate: "9999-12-30", days: 4}, {memoryGB: 142}, {peakTflops: 0}, {mfu: 0},
    {parametersB: NaN}, {tokensB: -1}, {block: 1.5}, {name: ""},
    {parametersB: 10000, tokensB: 1e7, days: 1, peakTflops: 1, mfu: 1, runs: 1000, concurrentRuns: 1000},
  ]) {
    state.trainingProjects = [project(invalid)];
    assert.throws(() => M.validate(state), undefined, JSON.stringify(invalid));
  }
  state.trainingProjects = [project(), project()];
  assert.throws(() => M.validate(state), /unique/);
  state.trainingProjects = null;
  assert.throws(() => M.validate(state), /training projects/);
  state.trainingProjects = [null];
  assert.throws(() => M.validate(state), /project must be an object/);
  state.trainingProjects = Array.from({length: 1001}, (_, i) => project({id: `project-${i}`}));
  assert.throws(() => M.validate(state), /1,000/);
  assert.throws(() => M.trainingProjectPeak([], "2026-13"), /valid YYYY-MM/);
});

test("event scheduling agrees with an independent daily batch-count oracle", () => {
  const inputs = Array.from({length: 25}, (_, i) => project({id: `project-${i}`,
    startDate: new Date(Date.UTC(2026, 11, 20 + i)).toISOString().slice(0, 10),
    days: i % 6 + 1, runs: i % 7 + 1, concurrentRuns: Math.min(i % 3 + 1, i % 7 + 1)}));
  const projects = inputs.map(M.trainingProject);
  for (const month of ["2026-12", "2027-01", "2027-02"]) {
    const start = Date.parse(`${month}-01`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    let peak = 0;
    for (let day = start; day < end.getTime(); day += 86400000) {
      const gpus = inputs.reduce((sum, p) => {
        const elapsed = (day - Date.parse(p.startDate)) / 86400000;
        const batch = Math.floor(elapsed / p.days);
        const runs = batch < 0 ? 0 : Math.max(0, Math.min(p.concurrentRuns, p.runs - batch * p.concurrentRuns));
        return sum + runs * 8;
      }, 0);
      peak = Math.max(peak, gpus);
    }
    assert.equal(M.trainingProjectPeak(projects, month), peak);
  }
});
