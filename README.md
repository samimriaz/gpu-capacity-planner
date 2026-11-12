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

The Capacity forecast screen separates **the base forecast** from **the forecast with your
plans**. The **Scenario planner** adds hands-on controls: change a service's
growth, move training between months, and see the company requirement change.
You can inspect both physical GPUs by SKU and a common H100-equivalent index.

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

## Build the plan from the bottom up

The starting point is each service, not a company-wide GPU growth target:

1. Learn the service's future traffic from its history, or use its entered
   business-demand plan.
2. Convert that work into GPUs using its selected SKU and serving profile.
3. Let the planner add extra growth for that service.
4. Add training runs in the months they are scheduled.
5. Add those requirements by organization and SKU.
6. Compare the SKU requirements with inventory. Also show H100 equivalents
   so changes in hardware mix do not look like changes in equal-performance
   GPU counts.

### Change inputs and see the result

Open **Scenario planner**, the default page:

The interface uses a white background, dark text, and subdued chart colors.

The planner starts with **Which month should the forecast start?** and a
**Start forecast** button, instead of the Service, Organization and GPU SKU
filter bar. Choose a month and start one six-month forecast for all services.
Changing the picker alone does not save or recalculate the forecast; submitting
it saves the planning start, clears prior scope filters, and selects the first
forecast month for inspection. Existing inputs and allocations are retained,
and starting a forecast does not create another plan or workspace. Other pages
keep their existing filters; organization and model drill-down remains available.

A **Save forecast** button beside **Start forecast** explicitly saves the current
forecast inputs, start month, budgets and allocations. The saved forecast reopens
automatically on the next visit and remains editable. Growth edits also auto-save
when the slider is released or the input loses focus; other editors save on
confirmation. The top status distinguishes saved, pending edits and failed saves.
A different month in the picker must be applied with **Start forecast** before
saving. Saving updates the same forecast rather than creating duplicate plans.
Storage is local to this browser and device, not a signed-in account or shared
backend. Export workspace JSON for backup or to move the forecast elsewhere.

**How this capacity forecast is calculated** follows the month picker, then
the scenario controls. The planner separates **Inference** and **Training**, with
three summary cards: **Current allocated GPUs**, **Forecast GPU need**, and
**Gap** (forecast minus current allocated GPUs, not the budget gap). Current
allocations and forecast need include both segments unless training is excluded.
Incomplete allocations show a labeled known subtotal; the summary gap remains
unavailable until both allocations and forecast are complete. This net physical
GPU comparison does not imply transfers or SKU substitutability. The detailed
segment/SKU tables use the same formula: forecasted GPUs minus current GPUs.
Manual budget edits change neither the forecast nor the gap.
Each titled forecast section has an arrow on the right of its heading to collapse
or expand its content independently. Sections start collapsed, and their open/closed state
is retained while editing growth or re-rendering the current page. Heading
toggles also support keyboard interaction.
The extra planning toolbar is removed: summaries and budget edits
use the forecast start month, charts use physical GPUs, and the full six-month
forecast remains visible. Training inclusion and global adjustments are still
available on **Capacity forecast**; saved settings are not reset. Organization
and model drill-down has a contextual **Back to company forecast** link only
when a narrower scope is open. The small explanation example uses 3 inference GPUs and 6 training
GPUs: 9 total. Current allocated GPUs are 2 for inference and 4 for training; budgets default
to the needs of 3 and 6, leaving gaps of 1 and 2.
These are teaching numbers, not benchmark measurements.

The inference section forecasts service traffic and GPU requirements. The
training section has its own forecast, editable run-growth percentages and
schedule. The optional combined history and normalization section is removed
from the planner to keep the focus on current GPUs, forecasts and gaps.
Historical and prior-year comparisons remain on **Capacity forecast**.
The standalone service-trend panel is also omitted. The service table retains
current usage, growth controls, monthly GPU requirements and model drill-down.

Open **Show detailed formulas and forecasting assumptions** for the inference
and training methods. Actual workspace calculations, including large service
numbers, are in a separate nested **Inspect actual workspace numbers** section;
they update with the selected service, month, growth, and filters. Current
traffic alone does not establish sustainable serving capacity. The current
engine still represents one serving configuration per service; this does not
add fleet telemetry ingestion or multi-model service support.

- **Inference uses requests per second (RPS).** Demand is the incoming peak
  request rate. Throughput is the RPS one GPU replica can serve for that model
  and SKU at the required response time. Keep spare capacity, round up to
  whole replicas, then multiply by GPUs per replica. Size each service
  separately before adding GPU counts; do not divide combined service RPS
  by one company-wide throughput number.
- **Dense training uses model work and MFU**, plus a deadline, memory screen,
  topology rounding, and concurrent runs. Training throughput benchmark pairs
  serve the normalization index; they do not replace the MFU-based sizing math.
- **Capacity is not busy percentage.** GPU-hours and activity describe observed
  usage. The forecast estimates capacity to provision and assumes monthly peaks
  and scheduled training can overlap; it does not optimize their sharing.

- Set growth directly in each row of **Inference demand by service**, beside
  that service's current usage. Drag the slider or type a percentage. Results
  preview immediately without losing keyboard focus or interrupting a drag;
  release the slider or leave the number field to save. **Edit model inputs**
  and **Benchmark pair** are available in the same row. The separate service
  selector and growth panel are no longer needed.
- **+50% means 50% extra demand by month six**, on top of the traffic forecast.
  The increase compounds across six months, so month one gets a smaller
  increase. It is not a flat increase in every month or a replacement for the
  learned trend.
- **Training growth** means extra concurrent runs by month six. For a plan
  scheduled in forecast month `i` (1–6), runs are
  `ceil(baseRuns * (1 + growthPct / 100) ** (i / 6))`. Model size, tokens,
  active days, MFU and GPUs per run stay fixed. Only the scheduled month
  contributes; no recurring jobs are invented in empty months. Growth for
  plans outside the horizon is capped at the horizon endpoints and those
  plans remain excluded from horizon totals. Missing growth defaults to zero,
  preserving existing workspaces. Rescheduling recomputes the growth factor.
- Each segment shows **Current allocated GPUs → Forecast need → Budget → Gap** in that order.
  **Budget follows forecast need automatically**, including growth edits.
  **Edit budget** creates a fixed GPU-count override only for the selected
  month, SKU and service/organization scope. Blank fields follow the forecast;
  zero is an explicit manual budget. **Reset budget to forecast** clears
  overrides for the selected month and scope. Manual budgets never change
  forecast need; budgets below need can leave demand unfunded.
- **Current allocated inference GPUs are populated from existing allocation records.** For each
  selected service, take its highest daily allocated GPU-hours before planning
  start, divide by 24 and round up to whole GPUs. Sum those retained allocations
  by SKU and owning organization. This is a conservative no-reclamation policy:
  lower traffic, GPU activity or subsequent daily allocations do not take GPUs
  back from a team. Current allocated GPUs stay fixed throughout the forecast, independently of
  growth, budget edits and training inclusion. It is derived from daily allocation
  records, not an exact live inventory snapshot. Current service ownership and
  SKU apply; effective-dated service migrations are not modeled.
- **Review allocation baseline** is optional: recorded inference allocations
  are prefilled, not blank inputs to re-enter. Saved company counts are explicit
  inventory corrections and take precedence over derived records at company
  scope. Clearing the inference correction restores the recorded baseline.
  Existing percentage splits remain saved company allocation baselines, not
  forecast budgets. Under service/organization filters, current allocated inference GPUs use
  only that scope's recorded allocations, not the entire company count.
- At company scope, **current allocated training GPUs = usable supply at
  planning start - current allocated inference GPUs**, separately for each SKU.
  This is an explicit planning assumption that all remaining usable capacity
  belongs to training, not unassigned inventory or measured training history.
  Saved training allocation counts (including zero) and legacy splits take
  precedence; clearing a correction restores the remaining-capacity calculation.
  Both current segments therefore sum to usable starting supply unless an
  explicit baseline overrides the assumption.
- Training allocations remain constant across the forecast. Additions ready
  by planning start are included; future additions do not automatically change
  current allocations. Training requirements still come from scheduled runs,
  independently of allocated capacity. Past plans do not recur automatically.
  Company training capacity is not duplicated into each team: scoped training
  allocations remain unavailable without ownership attribution. If inference
  allocation is unknown or exceeds supply, the remaining training count is
  unavailable rather than an invented zero or negative allocation.
- Explicit company allocation counts must fit usable supply at planning start.
  If recorded allocations exceed supply in a scenario, a conflict is shown
  rather than silently capping or reclaiming recorded allocations. Future
  additions increase company supply but are not assigned to a team automatically.
- **Segment gap = Forecasted GPUs - Current allocated GPUs.** Positive means capacity to add to that
  segment; negative means capacity retained by that team, not capacity released
  for other teams to borrow. Manual budget edits do not change this gap.
  The top-level gap sums the selected inference and training forecasts and
  subtracts their current allocations. Review per-SKU gaps separately: spare
  capacity on one SKU does not automatically cover another SKU's shortage.
- JSON forecasts and requirements CSVs include current allocated GPUs (the existing
  `inferenceHave` and `trainingHave` fields), allocation source
  (`recorded-allocation`, `entered-allocation`, `remaining-capacity`, or `missing`), supply conflict
  flags, budget, budget source
  (`forecast`, `manual`, or training `excluded`), segment gaps and completeness
  flags. `gap` remains the forecast need minus all usable supply; the separate
  `budgetGap` uses budget targets instead. Workspace JSON preserves optional
  `inferenceAvailable`/`trainingAvailable` supply counts, scoped `segmentBudgets`
  overrides, and training growth. Missing budget overrides always follow need.
  Excluding training sets its active need and budget to zero without deleting
  its stored overrides or available GPUs; re-enabling restores them.
- Drag a training card to another month. A month selector provides the same
  action without dragging. Active run days stay unchanged; a 31-day run cannot
  move into February.
- On **Capacity forecast**, turn **Include training** off to compare inference-only demand. Training
  plans remain editable and are not deleted.
- The planner's organization/SKU summary and budget editor use the forecast
  start month; monthly service requirements and the training forecast show the
  full horizon.
- The bottom-up chart shows recorded GPU assignments as a **solid historical
  trend that connects directly to the dotted total forecast**, in the same
  color. The dotted portion starts at the final historical point and continues
  through the forecast months. Inference and training forecasts are also dotted.
  The forecast boundary marks where the six-month plan begins. History shows
  the highest daily assignment on recorded days in each observed month; it is
  not a measurement of future capacity needs or a separate training-usage
  history. Missing observations stay blank. Historical assignments are recorded
  in physical GPUs; the H100-equivalent view does not guess historical ratios.
- The chart includes **12 calendar months of actuals**, followed by the six-month
  forecast. Directly underneath, **Actual usage vs previous year** shows each
  month's recorded GPUs, the same month last year, and the gap in GPUs and
  percent. Both periods use the same selected services. The latest partial
  month is compared through the same day last year; complete calendar months
  include all their days, including leap days.
- Gaps are calculated only when both periods have daily records for every
  selected service. Missing months remain blank; partial history is labeled.
  A zero previous-year value has an absolute gap but no percentage growth.
  These comparisons stay in physical GPUs even when the forecast chart uses
  H100 equivalents. They are included in the forecast JSON export.
- The updated demo contains daily synthetic history from **December 2024 through
  November 9, 2026**, enough for all 12 prior-year comparisons. Existing saved
  workspaces are not expanded or overwritten automatically. Import more history,
  or use **Data & assumptions > Load NVIDIA workload demo** to replace a workspace
  with the updated example after confirmation.
- **Inference demand by service** is visible directly below the bottom-up demand
  chart, without opening organization drill-downs. It lists every service name,
  owning organization, exact SKU, current observed peak requests/second, average
  assigned GPUs, historical demand growth, and all six monthly GPU requirements.
  Service names remain visible while scrolling across the monthly columns.
- Select a service name to see its observed daily demand and forecast GPU trend.
  Historical growth compares the latest complete 28-day peak-demand window with
  the preceding 28 days; missing coverage or a zero earlier peak makes it
  unavailable. Forecast GPU growth compares planning month one with month six.
  These are separate measures, not a comparison of average usage with peak
  capacity. Observation dates are shown so older data is not mistaken for live
  demand. The scenario JSON export includes these per-service series.
- Double-click an organization row, or use **Open models**, to see its
  inference services and scheduled training models. Open an inference model
  to see its configuration and assumptions; open a training model to edit its
  parameters, tokens, timing, and hardware.

The existing service-owning team is used as the organization. Global service,
organization and SKU filters apply to the planner. Training is filtered by its
own GPU SKU, even if its owning service uses a different SKU for inference.
Existing saved workspaces keep their inputs.

### Compare unlike GPUs without inventing an exchange rate

There is no universal rule such as **10 H100 = 1 GB200**. The result depends on
the model, precision, memory needs, software and response-time target. GB200
is also a CPU-plus-two-GPU superchip, not a single GPU.

The common unit here is **one H100 SXM 80GB GPU for the same workload**.
Choose **Benchmark pair** beside a service or training model and enter:

- Throughput per selected-SKU GPU.
- Throughput per H100 SXM GPU for the same workload.
- The evidence date, source, and configuration assumptions.

For inference, the selected rate comes from the current serving profile.
Use requests per second per GPU (RPS/GPU), measured within a full replica at the
required response time. For training, use training tokens per second per GPU
under the same model configuration. Dividing a full replica's throughput by
its GPU count does not mean the model fits on one GPU.

```text
Workload ratio = selected-SKU throughput per GPU / H100 throughput per GPU
H100 equivalents = required selected-SKU GPUs * workload ratio
Assigned-SKU GPUs = H100 equivalents / that same workload ratio
```

For example, if a workload runs at twice the throughput per GPU on its selected
SKU, 100 of those GPUs represent 200 H100 equivalents. Another workload on that
same SKU can have a different ratio. The example pairs in the demo are explicitly
illustrative, not measured performance.

The planner sums these workload-specific equivalents. Training contributes in
its scheduled months. Planner charts use physical GPUs; normalized totals
remain in the organization, model and SKU tables and forecast exports.

The final hardware table retains each workload's assigned SKU and replica
rounding. It does not choose a new mix, move jobs, or treat normalized demand as
interchangeable supply. Inventory and shortages remain exact-SKU counts.

Missing benchmark pairs make normalized totals **unavailable**, with a clearly
labeled known subtotal. Changed model settings, changed serving throughput,
and future-dated evidence invalidate a pair instead of silently reusing it.
Physical requirements remain visible. Moving an unchanged training run between
valid months does not invalidate its pair.

Scenario JSON includes workload rows, organization rollups, SKU totals and
normalization evidence. Monthly CSV includes physical requirements, H100
equivalents and missing-calibration counts. Service growth and benchmark pairs
also persist in workspace JSON; older workspaces need no guessed benchmark data.

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

For non-text services, a request means one fixed, benchmarked operation—for
example, a render, a video generation, or a policy evaluation. Request rates
from different kinds of work are not interchangeable. The forecast converts
each service's own request demand into GPUs before adding capacity requirements.

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
    LocalGrowth["Per-service growth slider"] --> Serving
    Serving --> Total["Add requirements by month, organization and GPU SKU"]
    Training --> Total
    Total --> Normalize["Workload benchmark pairs: H100-equivalent comparison"]
    Normalize --> GrowthReport["Compare normalized growth; retain assigned SKU counts"]
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

1. **Open Scenario planner.** It starts with a six-month prediction learned
   from service history. Adjust service growth and drill into an organization
   or model. Filter by service, organization, or GPU SKU.
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
The Scenario planner also applies each service's extra growth:
`(1 + growth / 100) ^ (planning month number / 6)`.
That factor affects organic demand, before launches are added.
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

**Interactive scenario planner:** edit a service's growth and compare physical
and H100-equivalent demand.

![Interactive bottom-up scenario planner](docs/screenshots/scenario-planner.png)

**Organization drill-down:** inspect inference and training models together.

![Organization and model drill-down](docs/screenshots/organization-models.png)

**Training scheduling:** drag plans between months or use the month selector.

![Draggable training plans by month](docs/screenshots/training-schedule.png)

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
node --test .\tests\portal-model.test.cjs .\tests\forecast-model.test.cjs .\tests\sku-model.test.cjs .\tests\bottom-up-model.test.cjs
```

The calculations are in [portal/model.js](portal/model.js), the UI is in
[portal/app.js](portal/app.js), and tests are in
[tests/portal-model.test.cjs](tests/portal-model.test.cjs) and
[tests/forecast-model.test.cjs](tests/forecast-model.test.cjs), with SKU and
migration checks in [tests/sku-model.test.cjs](tests/sku-model.test.cjs).
Growth, normalization, organization rollups and rescheduling tests are in
[tests/bottom-up-model.test.cjs](tests/bottom-up-model.test.cjs).

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
