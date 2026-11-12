# CapacityIQ requirements and decision record

This is the working agreement for this project. Read it before proposing or
implementing changes. It records confirmed requirements separately from current
implementation choices and unresolved questions.

The user's latest explicit direction takes precedence. Update this document when
the user makes a decision; do not turn an assistant suggestion into an approved
requirement. Ask before changing product behavior where the intent is unclear.

## 1. Product goal

Build an internal GPU capacity planning and forecasting platform for an
infrastructure organization. Help teams understand current
allocations, future GPU demand, budgets, and capacity gaps.

The current deliverable is a local browser-based prototype, not a production
allocation controller. Do not introduce production integrations or new platform
architecture without agreement.

## 2. Confirmed planning requirements

- Allow forecast dates through at least two years beyond the planning start.
  Keep six months as the default chart length and growth-input period; extend
  the chart through the chosen month when it is later.
- Use 12 months of traffic history for history-based inference forecasts.
  The agreed implementation uses 52 full weeks (364 days), not two years.
- Separate inference and training. Show inference first.
- Use requests per second (RPS) to explain inference demand.
- Keep GPU requirements split by exact GPU type/SKU. Capacity of one SKU must
  not automatically offset a shortage of another.
- Show Current allocated GPUs, Forecast need, Budget, and Gap.
- Gap = forecast need - current allocated GPUs.
- A positive gap means additional capacity is needed. A negative gap does not
  authorize reclaiming or reallocating a team's GPUs.
- Retain existing allocations. Lower demand or budget edits must not reclaim
  GPUs from a team.
- Training-only planning assumption: default the
  allocated baseline to current training GPU demand in the latest pre-plan month,
  with no spare capacity. Inference allocation behavior is unchanged.
  Label this as assumed allocation, not measured assigned capacity. It remains
  fixed when the selected forecast month or growth changes.
- Preserve recorded training allocations and company corrections without
  overwriting them. They are not used in the no-spare scenario.
  Reflect the selected basis in service/SKU totals, gaps, costs, normalization,
  saved workspaces and exports. Missing baseline demand stays unavailable.
- Budget follows forecast need by default. A manual budget override must not
  change the forecast or the gap.
- Use the hybrid forecast: history for existing services, explicit demand
  drivers for services without sufficient history, and planned launches/growth.
- Show the P50 and high-demand P90 cases; use P90 for default forecast sizing
  and budget. Do not describe the current heuristic as a calibrated guarantee.
- Growth inputs describe a six-month change. For later dates, continue that
  same compounded pace, without treating it as a monthly rate or counting it
  twice. For example, +20% per six months implies +44% after twelve months.
- Training forecast = current historical baseline + baseline growth + new
  parameter-sized training projects. Keep these three components visible.
  Baseline growth must not be applied again to new projects.
- Let a service/team own multiple named training projects, with editable model
  parameters, tokens per run, days per run, exact GPU SKU, peak training
  throughput, MFU, memory assumptions, and topology block size.
- Include only new projects not already covered by baseline history. Require
  explicit confirmation of this when entering a project. Do not automatically
  add retained legacy roadmap plans to the current planner.
- Schedule projects from a start date and training duration. Users enter total
  runs and maximum concurrent runs; schedule batches back-to-back, including
  a smaller final batch when necessary. Do not invent recurring runs.
- Sum new project GPUs only during overlapping dates and take the monthly
  peak jointly for each SKU across services/teams. Add that peak to the grown
  historical baseline for that SKU. Sum SKU requirements without substituting
  GPU types. Individual service peaks need not sum to the organization total.
- Preserve current allocations and inference logic. Update training gaps,
  purchase estimates, charts, normalized comparisons and exports consistently.
  Save project inputs with the workspace and support editing/removal.

## 3. Confirmed presentation and saving requirements

- Label training throughput "Peak training compute per GPU (TFLOP/s)".
  Explain training precision, non-sparse performance and the separate MFU
  adjustment. This wording change must not alter saved inputs or defaults.
- Name the application CapacityIQ, with the subtitle GPU Planning & Forecasting.
  Update visible branding and workspace export filenames while preserving
  compatibility with existing saved workspaces and import formats.

- Use generic GPU planning/forecasting language and sample workload names,
  rather than company-specific branding. Retain exact GPU SKU identifiers and
  factual hardware specification sources. Rename only original demo labels;
  preserve custom names, historical data, and forecast inputs.
- Show prominent, separate inference and training physical GPU requirements
  for the selected month at the top of Overview. Repeat the relevant requirement
  at the top of each Inference/Training tab, with a visible per-SKU breakdown.
  Distinguish mixed-SKU physical totals from approximate H100 equivalents.
  Incomplete requirements remain unavailable, not zero or a complete-looking sum.
- Show a top-level physical-GPU summary table with inference, training, and
  combined allocated counts, requirements, and gaps. Keep H100-equivalent
  comparisons in a separate, clearly labeled expandable section.
- Estimate one-time GPU hardware purchase cost in USD using editable per-SKU
  prices. Use SKU-specific starting estimates informed by public web pricing,
  replacing the earlier uniform $30,000 assumption. Show the source and caveats:
  historical/discontinued listings and indicative SXM ranges are not live quotes;
  do not label a server/baseboard price divided by GPU count as a GPU-only quote.
  Keep every price editable. Upgrade the complete old all-$30,000 default set
  once; preserve other saved custom prices, zero prices, and cleared fields.
  Record that upgrade so later user-entered $30,000 values are not overwritten.
  Missing prices are not zero. This excludes servers, networking, tax, power,
  and operating costs.
- Price additional physical GPUs, never the normalized H100 gap. Retain existing
  allocations: sum positive shortages by SKU and inference/training segment,
  without silently using one segment's or SKU's surplus to cover another.
  Show both the net gap and additional units needed to make this distinction clear.
  Training uses the selected allocation baseline; the default no-spare assumption
  changes estimates, not actual assignments or stored history.
- Save price assumptions with the workspace and include physical totals and
  purchase estimates in forecast exports. Price edits must not change demand.
- Display purchase estimates of at least $1 billion in billions with two decimal
  places; display estimates from $1 million to below $1 billion in millions.
  Smaller amounts remain in dollars. Show the exact dollar amount on hover and
  retain full numeric precision in calculations, editable prices, saved data,
  and exports.

- Explain "How this capacity forecast is calculated" as short, numbered steps
  in ordinary language. Avoid dense paragraphs and unexplained technical terms.
- Explain the sequence: historical traffic, forecast traffic, GPU demand,
  comparison with current allocations.
- Do not use "copies" as the name for model-serving capacity.
- Use "headroom" in the main explanation rather than introducing "usable RPS"
  as another concept the reader must learn.
- Display growth inputs with at most one decimal place in the Inference and
  Training tabs. This is display rounding only; preserve calculation precision.
- Show the exact GPU SKU directly beside or below each forecast GPU count in
  the Inference and Training tables. Label these as physical GPUs, not H100
  equivalents; users must not have to find the unit under the service name.
- Keep technical formulas and assumptions in expandable detail.
- Section collapse arrows belong on the right. Collapsible sections should be
  closed by default.
- Provide a Save forecast button near the top of the planner. Saved forecasts
  must be available to reopen and edit next time.
- Label the month picker "Forecast for which month?". The user selects the
  target month whose GPU need should be displayed, not a new planning start.
  Update the results when the selection changes and save that selection.
- Replace generic "Month-six" demand/GPU column labels with the actual forecast
  month and year across Overview, Inference, and Training. Both labels and values
  must use the selected month, including P50/P90 GPU needs, normalized totals,
  gaps, SKU rollups and exports. Do not keep showing the sixth month's values.
- Keep the history baseline and growth assumptions fixed when selecting a
  target. Permit the planning start through the same calendar month two years
  later, inclusive (for example, December 2026 through December 2028).
  Show the available range beside the picker. Default to the planning start
  for older workspaces.
  Changing the planning start in Data & assumptions resets the target to that start.
- Extend inference and training projections, selected-month totals, and exports
  consistently for long-range dates. Label these scenarios as extrapolations;
  do not imply that the P90 heuristic is calibrated for two-year forecasts.
- Current saving is browser-local. Do not imply authenticated, cross-device,
  or multi-user persistence.
- Do not reintroduce sections the user removed without asking. If their
  identity is unclear, clarify rather than guessing.
- Remove the Service / Organization / GPU SKU filter bar from the capacity
  planner tabs. These tabs show all services, teams, and SKUs without hidden
  filters. Keep filters available in Data & assumptions.
- Keep only Capacity planner and Data & assumptions in the sidebar. Remove
  Advanced forecast, Consumption, Service plans, Performance profiles,
  Training roadmap, and Daily backtests as separate navigation entries.
- Consolidate service/team/SKU settings, serving throughput, headroom,
  performance profiles, history/allocation inputs, H100 conversion assumptions,
  and file import/export under Data & assumptions.
- Preserve existing data, calculations, saved roadmap plans, and legacy fields
  in workspace exports. Removing navigation is not permission to delete them.
  Do not expose unused legacy annual-growth or launch controls in the service
  editor; edit current forecast growth only in the planner tabs.

## 4. Current implementation choices, not new user approvals

These explain existing behavior. Preserve them during wording-only changes;
request approval before materially changing the forecasting method.

- Traffic fitting uses up to 364 consecutive daily observations, with at least
  42 required. Missing observations are not silently replaced with zero.
- Compare a recent average with a linear trend using the last 14 days as a
  holdout. Only the linear-trend method includes a weekday pattern.
- Refit the selected method and size each month against its busiest predicted
  day. This does not model annual seasonality.
- The P90 band uses holdout errors and widens with the forecast horizon. It is
  an uncertainty heuristic, not evidence of six-month forecast accuracy.
- Serving demand is rounded up to whole replicas, then multiplied by GPUs
  per replica. A replica is one running instance of the model and can require
  multiple GPUs. "Replica" is the current replacement for "copy", not a request
  to make the main explanation more technical.
- Current 20% headroom keeps 20% of measured serving capacity free: size using
  measured RPS multiplied by 0.8. This is not the same as adding 20% to the
  baseline GPU count.
- Current inference allocations are derived from recorded allocation history,
  with explicit saved corrections supported.
- At company scope, training allocation defaults to remaining usable supply
  after inference allocation unless explicitly corrected. This is an assumption,
  not measured training allocation history, and must be labeled as such.

## 5. Open decision: meaning of "extra 20%"

The user asked for simple wording: "headroom extra 20%".
There is no explicit approval to replace the current calculation with
baseline GPU demand multiplied by 1.2.

Do not silently change the math or call the two calculations equivalent.
If a calculation change is needed, ask whether the intent is:

- Keep 20% of provisioned serving capacity free (current behavior); or
- Provision 20% extra capacity above baseline demand (a different calculation).

## 6. Change discipline

- A wording request is a wording change, not permission to redesign the model.
- A question about terminology is not blanket approval for broader UI changes.
- Keep changes limited to the requested scope. Propose unrelated improvements
  separately instead of implementing them.
- Ask before choosing between materially different behaviors.
- Keep UI explanations and directly related documentation consistent with the
  actual calculation. Clearly distinguish illustrative numbers from benchmarks.
- Validate changed behavior with relevant tests; verify rendered UI for UI
  changes. Documentation-only changes do not require model tests.
- Report what changed, what was verified, and what remains unresolved briefly.

## 7. Decision history

- Earlier project decisions: six-month planner, separate inference/training,
  retained allocations, forecast-based budgets, right-side collapse arrows,
  initially closed sections, and saved editable forecasts.
- 2026-11-11: user selected 12 months of traffic history.
- 2026-11-11: user rejected "copies" and requested simpler headroom wording.
- 2026-11-11: user requested a persistent requirements file to prevent
  unapproved assumptions and scope drift.

For detailed implementation and usage, see [README.md](README.md).

## 8. Deployment scope: CSV-backed tool

Confirmed on 2026-11-11:

- Keep persistent data in CSV files rather than PostgreSQL or another database.
  This includes historical demand, allocations, forecast inputs, and saved
  forecast results.
- Do not add company SSO, user accounts, or a permissions system.
- Do not add scheduled data imports, a separate validation platform, audit
  history, or a managed backup system.
- Keep data updates manual and deployment lightweight. Retain the existing
  browser UI rather than introducing a frontend rewrite.
- File-format/read/write errors must still be reported explicitly; malformed
  data must not silently produce a successful forecast.

A small Python API that reads and writes server-side CSV files is the proposed
deployment approach, not an implemented backend. The current portal still runs
its calculations in JavaScript and saves in browser-local storage. Do not claim
that CSV persistence or a Python backend is working until it is implemented and
verified.

## 9. Public Azure hosting

- Approved November 12, 2026: deploy the static website to Azure Static Web Apps
  Free, in East US 2, using resource group `rg-capacityiq-demo` and app `capacityiq`.
- Allow public access through the generated Azure HTTPS address. Do not add a
  paid plan, custom domain, backend, or database without further approval.
- Upload only the website assets, not local browser workspaces or credentials.
  Keep the CapacityIQ Azure CLI login separate from the pre-existing login.
- Hosting does not synchronize forecasts: each browser/origin has its own data.
  Transfer existing workspaces through the existing JSON export/import flow.
- Current production URL: https://purple-rock-02dda530f.6.azurestaticapps.net/
