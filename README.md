# CapacityIQ: GPU planning and forecasting

Plan training-heavy GPU capacity by service, team and project. Combine historical
demand, baseline growth and new training requirements; see shortages and purchase
estimates by exact GPU type. Inference is planned separately.

**[Open the live platform](https://purple-rock-02dda530f.6.azurestaticapps.net/)**

## Screenshots

**Capacity overview:** physical GPU requirements, allocated baselines, gaps and
GPU-only purchase estimates.

![CapacityIQ overview](docs/screenshots/capacityiq-overview.png)

**Training forecast:** current baseline + baseline growth + new project demand.
Multiple projects can belong to the same service/team.

![Training baseline, growth and scheduled projects](docs/screenshots/capacityiq-training-projects.png)

**Project inputs and preview:** model parameters, tokens, deadline, concurrency,
GPU specifications and estimated GPUs per run.

![Training project inputs and GPU sizing preview](docs/screenshots/capacityiq-training-input.png)

Screenshots use synthetic data. The overview shows the default demo; the
training screenshots add two illustrative projects, not default user inputs.

[Training GPU calculation](#training-gpu-calculation) |
[Forecast logic](#forecast-logic) |
[Use the platform](#use-the-platform) |
[Run locally](#run-locally) |
[Deployment](#deployment)

## Training GPU calculation

For dense-transformer pretraining, estimate compute and memory separately.
**Take the larger GPU count, not their sum**, then round up to the configured
allocation block.

```text
Training work = 6 × model parameters × training tokens per run

Compute GPUs = ceil(
  training work / (days per run × 86,400 × peak FLOPs/sec per GPU × MFU)
)

Memory GPUs = ceil(
  model parameters × training-state bytes per parameter / memory bytes per GPU
)

GPUs per run = ceil(max(compute GPUs, memory GPUs) / block size) × block size
```

- Convert billions to raw counts: **70B parameters = 70 × 10⁹**.
- Convert TFLOP/s to FLOP/s by multiplying by **10¹²**.
- Use MFU as a fraction: **40% = 0.40**. Enter peak throughput before MFU.
- Match the selected GPU's **non-sparse** rating to the training precision,
  such as BF16 or FP16. The FP32 H100 comparison index is not used for sizing.
- Memory includes the configured weights, gradients and optimizer state.
  Activations, buffers, sharding and topology still need validation.

### Example: a 70B model

**Inputs:** 1 trillion tokens/run, 12 days/run, H200 SXM 141GB,
989 TFLOP/s/GPU, 40% MFU, 16 bytes/parameter and a 256-GPU block.

```text
Work             = 6 × 70 × 10⁹ × 10¹² = 4.2 × 10²³ FLOPs
Time             = 12 × 86,400 = 1,036,800 seconds
Effective speed  = 989 × 10¹² × 0.40 = 3.956 × 10¹⁴ FLOPs/sec/GPU
Compute GPUs     = ceil(1,023.995) = 1,024
Memory GPUs      = ceil(1,120 GB / 141 GB) = 8
GPUs per run     = ceil(max(1,024, 8) / 256) × 256 = 1,024
```

**Result: 1,024 GPUs per run.** Three runs with at most two running together
use two back-to-back batches: 2,048 GPUs for 12 days, then 1,024 for 12 days.

989 is a rounded **H200 SXM BF16/FP16 dense** planning value, not a universal GPU
rating. [NVIDIA's specifications](https://www.nvidia.com/en-us/data-center/h200/)
list 1,979 TFLOP/s with sparsity, approximately twice the dense rate.
The formula is an estimate, not proof of memory fit or achievable runtime.

## Forecast logic

### 1. Grow the existing baseline

Use the latest pre-plan month's training peak for each service/SKU. Convert
observed annual growth to a six-month rate, or enter an override:

```text
Suggested six-month growth = sqrt(1 + YoY growth / 100) - 1
Baseline forecast = ceil(current demand × (1 + six-month growth)^(i / 6))
```

Growth is a fraction here; `i = 1` for the first forecast month.
**+44% YoY becomes +20% over six months.** Selecting a later month extends
the same compounded pace without changing the baseline.

### 2. Add new projects without double-counting

- Include only projects **not already in historical baseline demand**.
- Size each run with the formula above; schedule total runs in back-to-back
  batches up to the maximum concurrency. The last batch may be smaller.
- Use UTC calendar dates. A run is active from its start date until, but not
  including, its end date; the UI shows the inclusive last active date.
- Hold the grown baseline constant within each month. Add overlapping project
  GPUs and take the **monthly peak jointly for each SKU**.
- Do not apply baseline growth again to projects. Non-overlapping same-SKU
  projects reuse capacity; different GPU types cannot offset one another.

In the screenshot, the first project's peak is 2,048 GPUs. A later
1,024-GPU project does not overlap it, so the joint peak remains **2,048**:

**5,227 baseline + 147 growth + 2,048 new project peak = 7,422 training GPUs.**

Individual service/project peaks need not sum to the company peak. Missing
baseline history or growth leaves the full forecast unavailable, even when
project demand is known. Supply an explicit zero record when demand is zero.
When refreshing history, remove incremental projects now covered by the baseline.
Legacy roadmap plans are preserved but never added automatically.

### 3. Compare with allocations and estimate cost

```text
Net gap = required GPUs - allocated baseline
Additional GPUs = max(0, net gap), calculated separately per SKU and workload
Purchase estimate = sum(additional GPUs × price per GPU)
```

Training defaults to **allocation = current demand**, assuming no spare
capacity. Recorded allocations and company corrections remain stored; choose
**Use recorded allocations** to use them instead. Negative gaps do not reclaim
assigned GPUs.

Prices are editable SKU-specific USD budgeting estimates with source notes in
the UI. Missing prices on shortages make cost unavailable, not zero. Costs cover
**GPU hardware only**, excluding servers, networking, power, tax and operations.
Inference surpluses do not offset training shortages.

### 4. Keep inference and H100 comparisons separate

Inference projects peak requests/sec, then uses serving throughput, headroom,
whole model instances and a historical high-demand P90 allowance where available.
The chart shows average traffic, not sizing peaks; P90 is a heuristic, not a
calibrated guarantee.

H100 equivalents use `physical GPUs × SKU FP32 TFLOPS / 67`. This is a separate
approximate comparison index, **not physical purchase units or measured training
performance**.

## Use the platform

1. Choose a forecast month, up to two years beyond the planning start.
2. Open **Training** to review baseline growth and add projects by service/team.
3. Preview GPU sizing, then **Save & recalculate**. Edit or remove projects
   from their rows.
4. Use **Overview** for combined requirements, gaps and purchase estimates.
5. Open **Data & assumptions** for service ownership, history imports,
   performance evidence, allocation basis and prices.

Inputs save in browser-local storage. Use workspace JSON export/import to back
up or transfer them; import validates and asks before replacing the workspace.
Forecast JSON includes calculations, project schedules and monthly breakdowns.
Each browser/origin has independent data. Former GPU Atlas workspaces remain
compatible. Confirmed decisions are recorded in [REQUIREMENTS.md](REQUIREMENTS.md).

**Limits:** synthetic demo data; no backend, sign-in, shared editing, live
inventory connector, quota enforcement or job placement. Training sizing is
for dense pretraining, not a universal fine-tuning/MoE calculator. MFU at scale,
full memory fit and interconnect feasibility require validation. Long-range
growth is a scenario, not a guaranteed forecast.

## Run locally

No frontend build or package installation is needed:

```powershell
Start-Process .\portal\index.html
```

Run the model tests with Node.js:

```powershell
node --test .\tests\training-projects.test.cjs .\tests\planner-tabs.test.cjs .\tests\portal-model.test.cjs .\tests\forecast-model.test.cjs .\tests\sku-model.test.cjs .\tests\bottom-up-model.test.cjs
```

Code: [calculations](portal/model.js) · [UI](portal/app.js) · [tests](tests).

## Deployment

The public site runs on **Azure Static Web Apps Free**, app `capacityiq`,
resource group `rg-capacityiq-demo`, East US 2. Only the four portal files are
published. The Dev Box need not stay running. There is **no automatic deployment
on Git push** and browser data is not uploaded or synchronized.

<details>
<summary>Redeploy from the repository root</summary>

Use the app's isolated Azure CLI profile; if needed, authenticate with
`az login --use-device-code` after setting `AZURE_CONFIG_DIR` and select the
intended subscription. Run outside the `portal` artifact directory.

```powershell
$env:AZURE_CONFIG_DIR = Join-Path $env:LOCALAPPDATA 'CapacityIQ\AzureCLI'
$env:SWA_CLI_DEPLOYMENT_TOKEN = az staticwebapp secrets list `
  --name capacityiq --resource-group rg-capacityiq-demo `
  --query properties.apiKey --output tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:SWA_CLI_DEPLOYMENT_TOKEN)) {
  throw 'Unable to retrieve deployment credential.'
}
try {
  npx.cmd --yes --package=@azure/static-web-apps-cli@2.1.0 swa deploy .\portal `
    --env production --no-use-keychain
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }
} finally {
  Remove-Item Env:\SWA_CLI_DEPLOYMENT_TOKEN -ErrorAction SilentlyContinue
}
```

Never print or commit deployment tokens. Verify the public assets after publishing.

</details>

## Separate public-data experiment

The Python experiment uses Microsoft's **Philly GPU job trace**, not the portal's
sample data. It explores scheduling, hypothetical quotas/deadlines and job-arrival
forecasts; results are not production placement recommendations.

With Python 3.12+ and `curl.exe` (no Python packages required; download ~1 GB):

```powershell
python download_trace.py
python prepare_trace.py
python -m unittest discover -s tests -v
python experiment.py
Start-Process .\results\index.html
```

**Attribution:** [Microsoft Research / Project Fiddle Philly traces](https://github.com/msr-fiddle/philly-traces),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Publication:
*Analysis of Large-Scale Multi-Tenant GPU Clusters for DNN Training Workloads*,
USENIX ATC 2019. This experiment filters/summarizes the trace and adds hypothetical
planning rules; preserve attribution when sharing derived data.

Verified archive SHA-256:
`2037ccf63a725a02be718b0e1aeee6142c90b7f62d0d849295120e9f6ba13d2c`.
