import argparse
import csv
from datetime import datetime, timedelta
import html
import json
from pathlib import Path
import time

from capacity import forecast_backtest, load_trace, scenario_replay
from download_trace import EXPECTED_SHA256, URL


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        raise ValueError(f"No rows to export: {path}")
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def render_report(report: dict) -> str:
    audit, forecast, replay = report["audit"], report["forecast"], report["replay"]

    def optional_metric(value: float | None, format_spec: str) -> str:
        return "n/a" if value is None else format(value, format_spec)

    scenario_rows = "".join(
        "<tr>"
        f"<td>{html.escape(name)}</td>"
        f"<td>{sum(row['capacities'].values()):,}</td>"
        f"<td>{row['actual_duration_replay']['deadline_miss_rate']:.1%}</td>"
        f"<td>{row['actual_duration_replay']['infeasible_jobs']:,}</td>"
        f"<td>{optional_metric(row['actual_duration_replay']['p95_wait_hours'], '.2f')}</td>"
        f"<td>{row['sampled_mean_deadline_miss_rate']:.1%}</td>"
        "</tr>"
        for name, row in replay["scenarios"].items()
    )
    forecast_rows = "".join(
        f"<tr><td>{html.escape(name)}</td>"
        f"<td>{metrics['held_out']['mae_jobs_per_day']:.1f}</td>"
        f"<td>{optional_metric(metrics['held_out']['wape'], '.1%')}</td>"
        f"<td>{metrics['held_out']['bias_jobs_per_day']:.1f}</td></tr>"
        for name, metrics in forecast["metrics"].items()
    )
    assumptions = "".join(f"<li>{html.escape(note)}</li>" for note in replay["assumptions"])
    exclusions = "".join(
        f"<tr><td>{html.escape(reason)}</td><td>{count:,}</td></tr>"
        for reason, count in audit["counters"].items() if reason != "attempts_total"
    )
    worst = sorted(
        (row for row in replay["commitments"] if row["scenario"] == "baseline"),
        key=lambda row: (-row["modeled_miss_probability"], -row["gpus"]),
    )[:25]
    risk_rows = "".join(
        f"<tr><td>{html.escape(row['job_id'])}</td><td>{html.escape(row['pool'])}</td>"
        f"<td>{row['gpus']}</td><td>{row['modeled_miss_probability']:.1%}</td>"
        f"<td>{row['runtime_only_miss_probability_lower_bound']:.1%}</td>"
        f"<td>{html.escape(row['infeasibility_reason'] or 'queue/runtime uncertainty')}</td></tr>"
        for row in worst
    )
    status = html.escape(replay["capacity_selection_status"])
    selected = replay["lowest_tested_passing_capacity"]
    recommendation = (
        f"{selected['capacity_gpus']:,} GPUs in the lowest passing tested configuration"
        if selected else "No passing configuration on the tested grid"
    )
    return f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GPU Capacity Experiment</title>
<style>
body{{font:15px system-ui;background:#101820;color:#e5edf4;margin:0}}
main{{max-width:1200px;margin:auto;padding:32px}}h1{{font-size:32px}}h2{{margin-top:32px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}}
.card{{background:#1d2a36;border:1px solid #344657;padding:18px;border-radius:10px}}
.value{{font-size:28px;color:#b8e986;font-weight:650}}
.warning{{border-left:4px solid #ffb454;padding:16px;background:#30291e}}
table{{width:100%;border-collapse:collapse;background:#17232e}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #344657}}
.scroll{{overflow:auto}}a{{color:#b8e986}}li{{margin:8px 0}}summary{{cursor:pointer}}small{{color:#b4c4d4}}
</style><main>
<p>TRACE-BACKED METHOD VALIDATION / SYNTHETIC PLANNING POLICY</p>
<h1>GPU Capacity Decision Experiment</h1>
<p>Forecast cutoff: {html.escape(replay['cutoff'])}; replay horizon: {replay['horizon_hours']} hours.
No NVIDIA internal data. No claim of hyperscale validation.</p>
<div class="cards">
<div class="card">Raw jobs<div class="value">{audit['raw_jobs']:,}</div></div>
<div class="card">Static inventory GPUs<div class="value">{audit['inventory_gpus']:,}</div><small>Budget reference; unreconciled</small></div>
<div class="card">Eligible replay jobs<div class="value">{replay['replay_jobs']:,}</div></div>
<div class="card">24h arrival forecast<div class="value">{forecast['predicted_next_24h_submissions']:,.0f}</div>
<small>Job submissions, NOT GPUs</small></div>
</div>
<h2>Capacity decision</h2><div class="warning"><strong>{html.escape(recommendation)}</strong><p>{status}</p>
Conditional simulations only; synthetic 10% per-job miss-risk target. Runtime tails can defeat the target even with more GPUs.</div>
<h2>Policy alternatives</h2><p>Actual-duration replay uses held-out execution time; scheduling does not inspect it.
Sampled outcomes use {replay['duration_draws']} paired pre-cutoff runtime draws per scenario.</p>
<div class="scroll"><table><thead><tr><th>Scenario</th><th>GPUs</th><th>Deadline misses</th>
<th>Infeasible jobs</th><th>P95 wait (h)</th><th>Sampled mean misses</th></tr></thead><tbody>{scenario_rows}</tbody></table></div>
<p>Borrowing may disadvantage donors; per-team changes are available in report.json. Additional capacity costs and lead times are not modeled.</p>
<h2>Chronological arrival forecast backtest</h2>
<p>Model selected before cutoff: <strong>{html.escape(forecast['selected_using_only_validation'])}</strong>.
Empirical 80% band held-out coverage: {forecast['held_out_band_coverage']:.1%}; this is measured, not guaranteed.</p>
<div class="scroll"><table><tr><th>Baseline</th><th>Held-out MAE jobs/day</th><th>WAPE</th><th>Bias jobs/day</th></tr>{forecast_rows}</table></div>
<h2>Highest baseline modeled commitment risks</h2><p>Top 25; all commitments and scenarios are in commitments.csv.
Probabilities are uncalibrated model outputs, not production assurances.</p>
<div class="scroll"><table><tr><th>Job</th><th>Surrogate pool</th><th>GPUs</th><th>Modeled miss risk</th><th>Runtime-only lower bound</th><th>Reason</th></tr>{risk_rows}</table></div>
<h2>Data audit</h2><p>{audit['modeled_complete_jobs']:,} jobs eligible for the retrospective policy cohort;
{audit['excluded_from_policy_replay']:,} excluded. All valid submissions still contribute to arrival forecasting.</p>
<details><summary>Exclusions and timing limitations</summary><table>{exclusions}</table>
<p>{html.escape(audit['timing_note'])}</p><p>{html.escape(audit['cohort_note'])}</p>
<p>Inventory reconciliation warnings: {html.escape(json.dumps(audit['inventory_reconciliation_warnings']))}</p></details>
<h2>Assumptions and scope</h2><ul>{assumptions}</ul>
<p>Runtime: {report['execution_seconds']:.2f}s. Seed: {replay['random_seed']}.
Arrival forecasting and conditional scheduling replay are separate experiments; future-arrival uncertainty is not propagated into commitment risks yet.</p>
<h2>Provenance and exports</h2>
<p>Microsoft Research / Project Fiddle, <a href="https://github.com/msr-fiddle/philly-traces">Philly traces</a>,
<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
Source publication: Analysis of Large-Scale Multi-Tenant GPU Clusters for DNN Training Workloads, USENIX ATC 2019.
This report derives summaries and applies modified, synthetic allocation/deadline policies. No endorsement is implied.</p>
<p>Archive SHA-256: <code>{EXPECTED_SHA256}</code></p>
<p><a href="report.json">Full JSON</a> · <a href="forecast_backtest.csv">Forecast backtest CSV</a> ·
<a href="hourly_forecast.csv">Hourly forecast CSV</a> · <a href="commitments.csv">Commitments CSV</a></p>
</main></html>"""


def run(data: Path, output: Path, cutoff: datetime, hours: int, draws: int, fraction: float, seed: int) -> dict:
    started = time.perf_counter()
    jobs, submissions, inventory, audit = load_trace(data)
    if cutoff.tzinfo is not None or cutoff.hour or cutoff.minute or cutoff.second or cutoff.microsecond:
        raise ValueError("Cutoff must be midnight in the source's wall-clock time.")
    if cutoff >= submissions[-1]:
        raise ValueError("Cutoff is beyond the observed trace.")
    if cutoff + timedelta(hours=hours) > submissions[-1]:
        raise ValueError("Replay horizon extends beyond observed submissions.")
    forecast = forecast_backtest(submissions, cutoff)
    replay = scenario_replay(jobs, inventory, cutoff, hours, fraction, draws, seed)
    report = {
        "schema_version": 1,
        "source_url": URL, "source_sha256": EXPECTED_SHA256,
        "audit": audit, "forecast": forecast, "replay": replay,
        "execution_seconds": time.perf_counter() - started,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    write_csv(output / "forecast_backtest.csv", forecast["daily_backtest"])
    write_csv(output / "hourly_forecast.csv", forecast["hourly_forecast"])
    write_csv(output / "commitments.csv", replay["commitments"])
    (output / "index.html").write_text(render_report(report), encoding="utf-8")
    print(json.dumps({
        "raw_jobs": audit["raw_jobs"], "modeled_complete_jobs": audit["modeled_complete_jobs"],
        "inventory_gpus": audit["inventory_gpus"], "replay_jobs": replay["replay_jobs"],
        "forecast_model": forecast["selected_using_only_validation"],
        "forecast_24h_jobs": forecast["predicted_next_24h_submissions"],
        "actual_24h_jobs": forecast["actual_next_24h_submissions"],
        "scenarios": {
            name: {"gpus": sum(row["capacities"].values()),
                   "miss_rate": row["actual_duration_replay"]["deadline_miss_rate"],
                   "infeasible": row["actual_duration_replay"]["infeasible_jobs"],
                   "sampled_mean_misses": row["sampled_mean_deadline_miss_rate"]}
            for name, row in replay["scenarios"].items()
        },
        "capacity_status": replay["capacity_selection_status"],
        "execution_seconds": report["execution_seconds"],
        "output": str(output),
    }, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run a trace-backed capacity planning experiment.")
    parser.add_argument("--data", type=Path, default=Path("data") / "philly")
    parser.add_argument("--output", type=Path, default=Path("results"))
    parser.add_argument("--cutoff", type=datetime.fromisoformat, default=datetime(2017, 11, 15))
    parser.add_argument("--hours", type=int, default=48)
    parser.add_argument("--draws", type=int, default=30)
    parser.add_argument("--capacity-fraction", type=float, default=0.35)
    parser.add_argument("--seed", type=int, default=20261107)
    args = parser.parse_args()
    run(args.data, args.output, args.cutoff, args.hours, args.draws, args.capacity_fraction, args.seed)
