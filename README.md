# GPU Atlas: GPU capacity forecasting

## What is the goal?

Help infrastructure teams answer one question:

**How many GPUs will the company need over the next six months, and where will
we run short?**

The tool learns from each service's traffic history and forecasts GPU demand.
Users can then adjust that forecast for launches, serving improvements, training
plans, and new capacity.

It helps them understand:

- Which services and teams use GPUs today.
- How usage and customer traffic are growing.
- What new models teams plan to train.
- Whether available GPUs can cover those needs.

The main screen separates **the base forecast** from **the forecast with your
plans**. You can see what changed and when each GPU type runs short.

The portal runs in your browser and includes a sample 200,000-GPU inventory
and service history.

[GPU SKUs](#does-it-account-for-the-gpu-sku) |
[NVIDIA workloads](#which-nvidia-workloads-are-in-the-example) |
[Data inputs](#where-would-the-data-come-from) |
[Planning logic](#how-the-planning-logic-works) |
[Using the portal](#what-does-the-user-do) |
[Screenshots](#screenshots) |
[Run locally](#run-the-portal) |
[Limitations](#what-it-does-not-do-yet)

## Does it account for the GPU SKU?

Yes. The tool tracks the **GPU variant, memory, and form factor**, not just the
family name. The example inventory includes:

| SKU | Memory per GPU | Form factor |
|---|---|---|
| H100 SXM | 80 GB HBM3 | SXM |
| H100 PCIe | 80 GB HBM2e | PCIe |
| H200 SXM | 141 GB HBM3e | SXM |
| B200, DGX B200 configuration | 180 GB HBM3e | SXM |
| RTX PRO 6000 Blackwell Server Edition | 96 GB GDDR7 | PCIe |

Counts are individual GPUs, not servers or racks. NVIDIA specification links
are available in **Data & assumptions**. The B200 memory entry refers to the
[DGX B200 configuration](https://docs.nvidia.com/dgx/dgxb200-user-guide/introduction-to-dgxb200.html),
which lists eight GPUs and 1,440 GB of total GPU memory.

Each service, serving test, training plan, inventory count, and planned addition
uses a SKU. Filters and exports use those same identifiers.

- A serving profile for H100 SXM cannot size an H100 PCIe service.
- Spare H100 PCIe GPUs do not automatically cover an H100 SXM shortage.
- Training memory cannot exceed the selected SKU's capacity. Changing the SKU
  fills its memory capacity and clears the old peak-throughput input, so the
  user must enter the right speed for the new hardware and precision.
- Older workspaces keep their family-only counts as **variant not specified**.
  The tool does not guess which hardware was installed.

The SKU identifies hardware; it does not determine serving speed by itself.
That still needs a benchmark for the model, software setup, and response-time
target.

## Which NVIDIA workloads are in the example?

The example replaces generic search and assistant services with these areas:

- **[Nemotron / NIM](https://www.nvidia.com/en-us/ai-data-science/foundation-models/nemotron/):**
  language-model development and serving.
- **[DRIVE / Alpamayo](https://blogs.nvidia.com/blog/robotaxi-leaders-full-stack-open-platform/):**
  autonomous-driving model training, simulation, and cloud evaluation.
  In-vehicle inference on DRIVE hardware is a separate capacity problem.
- **[Isaac / GR00T](https://www.nvidia.com/en-us/industries/robotics/isaac-groot/):**
  robotics model development, simulation, and policy evaluation. On-robot
  Jetson inference is separate from the data-center fleet.
- **[Cosmos](https://www.nvidia.com/en-us/ai/cosmos/):**
  world models, synthetic video generation, and physical-AI data.
- **[Omniverse](https://www.nvidia.com/en-us/omniverse/):**
  digital twins, rendering, and simulation.
- **[BioNeMo](https://www.nvidia.com/en-us/clara/bionemo/):**
  biomolecular model development and inference.
- **[ChipNeMo](https://blogs.nvidia.com/blog/llm-semiconductors-chip-nemo/):**
  NVIDIA's published research on language models for chip-design assistance.

Public sources do not show how NVIDIA splits its own GPU usage across these
areas, so this is not a spending ranking. The example's traffic, GPU counts,
and performance inputs are illustrative planning data.

For non-text services, a request means one fixed, benchmarked work item—for
example, a render, a video generation, or a policy evaluation. Request rates
from different kinds of work are not interchangeable. The forecast converts
each service's own work into GPUs before adding capacity requirements.

The training examples are dense language-model experiments. The dense training
formula below is not applied to every Cosmos, robotics, or simulation workload.

## How would it work?

Collect service history, learn its traffic trend, and predict future demand.
Then layer team plans onto the prediction and compare it with supply.

```mermaid
flowchart TD
    Usage["GPU usage and service traffic"] --> History["Show current usage and growth"]
    History --> Forecast["Learn traffic trend and weekday pattern"]
    Forecast --> Serving["Convert predicted traffic into GPUs"]
    Growth["Users adjust traffic, launches and serving performance"] --> Serving
    Tests["Performance tests: requests each GPU group can handle"] --> Serving
    Plans["Teams enter model training plans"] --> Training["Estimate GPUs needed for training"]
    Serving --> Total["Add requirements by month and GPU type"]
    Training --> Total
    Inventory["Available GPUs and planned additions"] --> Compare["Compare demand with supply"]
    Total --> Compare
    Compare --> Review["Review shortages and change the plan"]
```

In the current prototype, users enter or import the inputs themselves.
The connections described next are suggestions for a real deployment.

## Where would the data come from?

A **data pipeline** collects records from another system, checks them, and puts
them into a format the portal can use. A production version could use five:

### 1. GPU usage

Collect GPU activity from NVIDIA DCGM or Prometheus, and GPU assignment records
from Kubernetes or Slurm.

This tells us **which service was assigned GPUs, for how long, and how busy they
were**. Keep assigned capacity separate from actual activity: a team can hold
GPUs without keeping them busy.

### 2. Service traffic

Collect request counts, peak requests per second, response times, and request
sizes from API gateways or model-serving systems.

This tells us **how much work users are asking the service to do**. GPU usage
alone can miss demand that was queued or rejected.

### 3. Performance test results

Import tests showing how many requests a particular model and GPU configuration
can handle while meeting the required response time.

This tells us **how to convert expected traffic into GPUs**. Record the model,
exact GPU SKU, software setup, and input/output sizes alongside each result.

### 4. Hardware inventory

Read infrastructure records for installed GPUs, unavailable hardware, reserved
capacity, and new GPUs expected to become ready.

This tells us **how much capacity we can actually plan against**. A production
version should also track data-center locations, maintenance, and retirements.

### 5. Service ownership

Read the service catalog and team directory to connect jobs and usage records
to the right team.

This tells us **who is responsible for the demand**. Keep ownership history so a
service moving between teams does not change old reports incorrectly.

Before combining these inputs, agree on service IDs, dates, units, and GPU types.
Reject duplicates and flag missing records. Start with daily summaries; add
updates every few minutes when the source systems support them.

**None of these automated connections is built yet.** The current portal accepts
manual inputs and workspace JSON imports. Daily and weekly views are available;
live updates and historical ownership tracking are not.

## What does the user do?

The data tells us what happened. Teams still need to tell us what they intend
to do next.

1. **Open Capacity forecast.** It starts with a six-month prediction learned
   from service history. Filter by service, team, or GPU SKU.
2. **Adjust the prediction.** Enter traffic above or below the forecast, or a
   change in serving throughput. Click **Update forecast** to save and compare.
   The base forecast stays unchanged.
3. **Set service plans.** Add launch traffic and serving test results. A new
   service without enough history can use an explicit plan based on users.
4. **Add training plans.** In **Training roadmap**, enter model size, training
   data size, timing, hardware assumptions, and the number of simultaneous runs.
5. **Update supply.** In **Data & assumptions**, enter inventory, unavailable
   GPUs, reserves, and additions.
6. **Review shortages.** Back in **Capacity forecast**, compare the base forecast,
   your plan, and supply. Turn launches or training on/off to see their effect.
   Export the forecast as JSON or the monthly numbers as CSV.

For example, a planner could move a training plan from March to April or add
GPUs starting in February and see the effect. The portal recalculates the result;
it does not make those operational changes itself.

## How the planning logic works

### A. Measure current usage

Each daily service record contains assigned GPU-hours, average GPU activity,
peak requests per second, total requests, and whether the record is sample data
or user-entered.

**GPU-hours measure assigned capacity over time.** Eight GPUs assigned for three
hours equals 24 GPU-hours. That does not mean they were busy for all three hours.
The activity percentage is shown separately.

The portal adds these records into daily or weekly totals. Average assigned GPUs
uses the number of observed days; missing days are not filled with zero.
Activity averages are weighted by assigned GPU-hours.

Year-over-year and two-year comparisons need complete records for the matching
periods. If history is missing or the earlier value is zero, the portal says the
comparison is unavailable. These comparisons help users choose growth assumptions;
they do not automatically set the future growth rate.

### B. Estimate GPUs needed to serve requests

Using a trained model to answer requests is called **inference**.
The portal first estimates traffic, then converts that traffic into GPUs.

**For an existing service, learn from its history:**

1. Take up to 84 consecutive daily records before planning starts. At least
   42 are needed; missing days are not filled with zero.
2. Try two methods: a recent average and a straight-line trend fitted to weekly
   averages. Both also learn which weekdays tend to be busier.
3. Keep the final 14 days aside. Predict those days using only the earlier data
   and choose the method with the smaller average error. These are multi-day
   predictions, not predictions updated with each day's actual result.
4. Fit the selected method again with all the recent history. Predict daily
   peaks through the next six planning months, including any gap between the
   latest observation and the start of the plan.
5. Use the busiest predicted day in each month to size serving capacity.

The method, days of history, last observation, and selection error appear under
**What is driving the forecast?** The 14-day error helps choose a method; it does
not measure accuracy six months ahead.

**Then apply your adjustments:**

- **Traffic +20%:** increase predicted traffic by 20%.
- **Throughput +20%:** each serving group handles 20% more requests, reducing
  the number of groups needed.
- **Include launches:** add the launch traffic entered for each service. Monthly
  increments accumulate once; they are not also multiplied by the traffic adjustment.
- **Include training:** add the training roadmap to the serving requirement.

Adjustments apply across the workspace and are saved with it.
The base serving line excludes these changes and training. It still includes
each service's existing spare-capacity allowance.

**For a new service without history:** select a user-based plan in **Service
plans**. Multiply daily users by sessions, requests, and model calls; subtract
calls avoided entirely by cache; convert to requests per second and apply the
peak-traffic factor. Annual growth applies to users in this mode.
This is labeled as an entered plan, not a learned traffic trend.

The **Service plans** page retains the earlier manual annual-growth calculator
for comparison. Its annual traffic growth input does not drive the learned
forecast.

**Then convert peak traffic into GPUs:**

```text
GPU groups needed =
    round up(peak requests per second /
             (requests per second per group * usable share of serving capacity))

GPUs needed = GPU groups needed * GPUs per group
```

A group is one copy of the serving model, which may need several GPUs.
For 20% spare serving capacity, use 0.8 as the usable share.

**Example:** suppose the traffic forecast predicts a peak of 126,000 requests
per second. If an eight-GPU group handles 40 requests per second, with 20% capacity kept
spare, the service needs **3,938 groups, or 31,504 GPUs**.
These are illustrative inputs, not measured hardware performance.

A saved performance profile lets services share a test result. It must match
the exact GPU SKU, configuration key, and request-size limits, and its evidence must
be dated before planning starts. A mismatch makes the estimate unavailable;
the portal does not quietly use a different number. User-supplied test results
are not independently verified.

### C. Estimate GPUs needed for training

Teams enter model parameters, total training tokens, planned month, active days,
GPU speed and memory, expected training efficiency, and simultaneous runs.
Parameters and tokens are entered in billions.

The current calculator supports **dense-transformer pretraining**:

1. Estimate the work as roughly `6 * model parameters * training tokens`.
2. Divide that work by the available time and effective computing speed of one
   GPU to estimate the GPU count needed to finish.
3. Estimate a minimum GPU count for model weights, gradients, and optimizer memory.
4. Take the larger count and round up to the requested GPU group size.
5. Multiply by the number of runs happening at once.

Effective computing speed is the GPU's stated peak speed multiplied by expected
training efficiency. The UI calls that efficiency **MFU**: the share of peak
computing speed used for model work. It is not the GPU busy percentage.

The memory estimate excludes temporary working memory and communication buffers.
It is a minimum check, not proof that the job fits. The calculator also assumes
runs in the same month overlap; it does not find an efficient schedule.

### D. Compare demand with supply

For each month and GPU SKU:

```text
Total needed = serving GPUs + training GPUs

Available = installed - unavailable - reserve + additions ready by that month

Shortage = total needed - available
```

For example, `64,000 - 4,000 - 3,200 + 8,192` gives 64,992 available GPUs.
If demand is 70,000, the shortage is **5,008 GPUs**.

Keep SKUs separate: even two H100 variants have separate demand and inventory.
Likewise, a job needing 4,096 GPUs at once cannot run simply because
enough GPU-hours are available across different days.

New additions count from the start of their entered month. Service and team
filters reduce the displayed demand, but supply remains the shared company
inventory; the result is not a team's guaranteed allocation.

If a service cannot be estimated, the portal marks the total **partial** and
still shows the requirements it can calculate. A complete total means the inputs
exist, not that every assumption or physical placement has been verified.

### E. Check short-term traffic predictions

The **Daily backtests** page asks a smaller question: *could a simple method
have predicted the next day's peak traffic?*

It compares:

- Yesterday's peak.
- The peak on the same weekday last week.
- The average peak over the previous 28 days.

Each prediction uses only earlier observations. All three methods need the same
28 complete prior days and at least 14 days to test predictions on.
The earlier part of that test period chooses the method; the later part checks it
on days that were not used to choose it. Each part has at least seven days.

The page reports average error, percentage error, and whether predictions tend
to be too high or too low. You can export the scores and daily predictions.
These are separate one-day checks. The main capacity forecast uses the multi-day
model comparison described above.

## Screenshots

**Capacity forecast:** historical usage, a learned forecast, and a plan with
25% extra traffic. The controls let users compare changes directly.

![History-based GPU forecast with editable scenario controls](docs/screenshots/capacity-forecast.png)

The supporting pages use the same NVIDIA workload example and exact GPU SKUs.

**Consumption:** see which services use GPUs and how usage changes.

![Service usage, filters, and consumption trends](docs/screenshots/consumption.png)

**Inference planning:** edit growth and serving assumptions.

![Six-month inference planning](docs/screenshots/inference-growth.png)

**Training:** enter model plans and inspect estimated GPU needs.

![Training plans and GPU estimates](docs/screenshots/training-roadmap.png)

<details>
<summary>Show the training input form</summary>

![Training plan input form](docs/screenshots/training-input.png)

</details>

<details>
<summary>Show inventory and workspace controls</summary>

![Supply inputs and workspace import/export](docs/screenshots/data-assumptions.png)

</details>

## Run the portal

Open [portal/index.html](portal/index.html) in a browser. On Windows:

```powershell
Start-Process .\portal\index.html
```

There is no server, build step, or package installation.
Edits save in the browser's local storage. Export workspace JSON to keep a copy
or move it to another browser. Import replaces the workspace after validation
and confirmation. Version-1 and version-2 workspaces upgrade to version 3 while
preserving their inputs. Existing family-level counts remain unspecified
variants; loading the new NVIDIA workload demo requires explicit confirmation
in **Data & assumptions**. Forecast adjustments are included in workspace exports.
The `pool` field now holds the SKU ID. Monthly CSV also includes the SKU name,
memory, and form factor; forecast JSON includes the SKU catalog.

The sample history ends November 9, 2026. The default plan covers December 2026
through May 2027. You can enter a different planning start month.

Run the JavaScript calculation tests with Node.js:

```powershell
node --test .\tests\portal-model.test.cjs .\tests\forecast-model.test.cjs .\tests\sku-model.test.cjs
```

The calculations are in [portal/model.js](portal/model.js), the UI is in
[portal/app.js](portal/app.js), and tests are in
[tests/portal-model.test.cjs](tests/portal-model.test.cjs) and
[tests/forecast-model.test.cjs](tests/forecast-model.test.cjs), with SKU and
migration checks in [tests/sku-model.test.cjs](tests/sku-model.test.cjs).

## What it does not do yet

- **No live company data:** connections to monitoring, inventory, and service
  catalogs still need to be built. The sample inventory is not a fleet-scale
  performance test.
- **No shared company service:** there is no login, backend, or multi-user editing.
  Do not enter sensitive information in a shared browser.
- **No automatic allocation:** the portal does not grant quotas, borrow capacity,
  start jobs, purchase GPUs, or enforce a schedule.
- **No guarantee that a job can run:** it does not check network layout, connected
  GPU placement, complete memory fit, or detailed hardware compatibility.
- **No universal model calculator:** training support does not yet cover
  mixture-of-experts models, fine-tuning, or detailed long-context costs.
- **No annual seasonal model:** the learned forecast uses recent history and
  weekday patterns, not annual holidays or business cycles.
- **No guaranteed forecast:** past trends and plans can change. Failures,
  changing efficiency, delayed deliveries, and correlated demand can change the
  outcome. There are no calibrated confidence ranges for the six-month plan.

Serving spare capacity is included in demand; the inventory reserve is deducted
from supply. Do not use both to cover the same risk.

## Separate experiment with public GPU job data

The repository also includes a Python experiment using Microsoft's public
**Philly trace**, a record of historical GPU jobs. It is separate from the
portal and does not provide the portal's sample data.

The experiment compares job scheduling with fixed team shares, borrowing unused
shares, prioritizing deadlines, and adding GPUs. It also tests simple forecasts
of daily job arrivals. Job-arrival counts are not themselves a GPU requirement.

The trace has no real planning deadlines or team quotas, so the experiment
creates those assumptions. Some job allocations do not match the static
inventory; the experiment reports that problem and uses a simplified shared
GPU budget instead of claiming exact hardware placement.

Risk estimates vary job runtimes, not every possible source of uncertainty.
Borrowing can delay another team, and adding GPUs cannot fix a deadline shorter
than a job's own runtime. Treat the results as experiments, not production
recommendations or proof that the approach works at hyperscale.

To run it on Windows, use Python 3.12+ and `curl.exe`. No Python packages are
required. The initial download is approximately **1 GB**:

```powershell
python download_trace.py
python prepare_trace.py
python -m unittest discover -s tests -v
python experiment.py
Start-Process .\results\index.html
```

The downloader verifies the archive's size and SHA-256. Preparation reads the job
log and machine inventory without expanding all the telemetry.
Generated files under `results` include an HTML report, JSON results, traffic
forecast CSVs, and per-job outcomes. Data and generated results are not committed.

## Data attribution

The experiment uses the [Microsoft Research / Project Fiddle Philly traces](https://github.com/msr-fiddle/philly-traces),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The source publication is *Analysis of Large-Scale Multi-Tenant GPU Clusters
for DNN Training Workloads*, USENIX ATC 2019.

Archive SHA-256:
`2037ccf63a725a02be718b0e1aeee6142c90b7f62d0d849295120e9f6ba13d2c`.

The experiment filters and summarizes the trace and adds hypothetical planning
rules. Preserve the source attribution and describe those changes when sharing
derived data.
