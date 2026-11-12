const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../portal/model.js");

function legacyWorkspace() {
  const state = M.demo();
  state.version = 2;
  state.services = state.services.filter(s => M.skuInfo(s.pool).family !== "RTX PRO")
    .map(s => ({...s, pool: M.skuInfo(s.pool).family}));
  const ids = new Set(state.services.map(s => s.id));
  state.records = state.records.filter(r => ids.has(r.serviceId));
  state.benchmarks = state.benchmarks.filter(b => M.skuInfo(b.pool).family !== "RTX PRO")
    .map(b => ({...b, pool: M.skuInfo(b.pool).family}));
  state.training = state.training.map(t => ({...t, pool: M.skuInfo(t.pool).family}));
  state.supply = {H100: {installed: 80000, unavailable: 5000, reserve: 4000},
    H200: {installed: 64000, unavailable: 4000, reserve: 3200},
    B200: {installed: 56000, unavailable: 6000, reserve: 2800},
    additions: [{pool: "H200", month: "2027-02", gpus: 8192}]};
  state.services[0].name = "My existing service";
  return state;
}

test("SKU catalog distinguishes H100 variants with the same memory capacity", () => {
  const sxm = M.skuInfo("H100-SXM-80GB"), pcie = M.skuInfo("H100-PCIE-80GB");
  assert.equal(sxm.family, pcie.family);
  assert.equal(sxm.memoryGB, 80);
  assert.equal(pcie.memoryGB, 80);
  assert.notEqual(sxm.id, pcie.id);
  assert.notEqual(sxm.formFactor, pcie.formFactor);
  assert.notEqual(sxm.memoryType, pcie.memoryType);
  assert.equal(M.skuInfo("H200-SXM-141GB").memoryGB, 141);
  assert.equal(M.skuInfo("B200-SXM-180GB").memoryGB, 180);
  assert.equal(M.skuInfo("RTX-PRO-6000-BW-SERVER-96GB").memoryGB, 96);
  assert.throws(() => M.skuInfo("DGX-server-count"), /SKU/);
});

test("v2 migration preserves family supply without inventing exact SKUs or changing names", () => {
  const legacy = legacyWorkspace();
  const expected = M.inference(legacy, legacy.services[0], 0);
  const before = JSON.stringify(legacy);
  const migrated = M.validate(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(migrated.services[0].name, "My existing service");
  assert.equal(migrated.services[0].pool, "H200");
  assert.match(M.skuInfo("H200").name, /not specified/);
  assert.equal(migrated.supply["H200-SXM-141GB"].installed, 0);
  assert.equal(migrated.supply.H200.installed, 64000);
  assert.deepEqual(M.inference(migrated, migrated.services[0], 0), expected);
  assert.deepEqual(M.activePools(migrated), ["H100", "H200", "B200"]);
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(migrated))), migrated);
});

test("legacy malformed supply is rejected rather than filled in as an observed zero", () => {
  const state = legacyWorkspace();
  delete state.supply.H100;
  assert.throws(() => M.validate(state), /Missing legacy supply/);
});

test("v3 workspaces require inventory entries and reject unknown SKU keys", () => {
  const state = M.demo();
  delete state.supply["H100-PCIE-80GB"];
  assert.throws(() => M.validate(state), /Missing supply/);
  const unknown = M.demo();
  unknown.supply["Invented GPU"] = {installed: 10, unavailable: 0, reserve: 0};
  assert.throws(() => M.validate(unknown), /unknown GPU SKU/);
});

test("exact-SKU benchmark mismatch cannot fall back to another H100 variant", () => {
  const state = M.demo(), service = state.services.find(s => s.pool === "H100-SXM-80GB");
  const profile = state.benchmarks.find(b => b.pool === service.pool);
  service.benchmarkId = profile.id;
  assert.equal(M.inference(state, service, 0).available, true);
  profile.pool = "H100-PCIE-80GB";
  M.validate(state);
  assert.equal(M.inference(state, service, 0).available, false);
  assert.equal(M.capacityForecast(state, service.id).monthly[0].complete, false);
});

test("supply additions stay inside the selected SKU, even within the same GPU family", () => {
  const state = M.demo();
  const before = M.capacityForecast(state).monthly[0];
  state.supply.additions.push({pool: "H100-PCIE-80GB", month: state.startMonth, gpus: 5000});
  const after = M.capacityForecast(state).monthly[0];
  const get = (m, id) => m.pools.find(p => p.pool === id);
  assert.equal(get(after, "H100-PCIE-80GB").usable - get(before, "H100-PCIE-80GB").usable, 5000);
  assert.equal(get(after, "H100-SXM-80GB").usable, get(before, "H100-SXM-80GB").usable);
  assert.equal(get(after, "H100-SXM-80GB").gap, get(before, "H100-SXM-80GB").gap);
});

test("training memory budget cannot exceed the selected GPU SKU", () => {
  const state = M.demo(), plan = state.training[0];
  plan.pool = "H100-PCIE-80GB";
  plan.memoryGB = 141;
  assert.throws(() => M.validate(state), /Memory budget exceeds/);
  plan.memoryGB = 80;
  assert.doesNotThrow(() => M.validate(state));
});

test("demo uses generic workload categories and exact individual-GPU inventory", () => {
  const state = M.demo();
  assert.equal(state.services.length, 7);
  for (const word of ["Language", "Scientific", "Video", "Autonomous", "Rendering", "Robotics", "Chip"]) {
    assert.ok(state.services.some(s => s.name.includes(word)));
  }
  assert.equal(M.WORKLOAD_AREAS.length, 7);
  assert.ok(M.WORKLOAD_AREAS.every(w => w.description.length > 0));
  assert.ok(state.services.every(s => !M.skuInfo(s.pool).legacy));
  assert.equal(M.activePools(state).length, 5);
  assert.equal(M.POOLS.reduce((n, p) => n + state.supply[p].installed, 0), 200000);
  assert.ok(state.services.every(s => !/Enterprise Assistant|Semantic Search/.test(s.name)));
});

test("non-text job examples declare zero text-token inputs and matching profile ranges", () => {
  const state = M.demo();
  const render = state.services.find(s => s.id === "recommend");
  const profile = state.benchmarks.find(b => b.pool === render.pool);
  assert.equal(render.inputTokens, 0);
  assert.equal(render.outputTokens, 0);
  assert.equal(profile.maxInputTokens, 0);
  render.benchmarkId = profile.id;
  assert.equal(M.inference(state, render, 0).available, true);
});
