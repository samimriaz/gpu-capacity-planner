from collections import Counter, defaultdict
import csv
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
import heapq
import json
import math
from pathlib import Path
import random
from statistics import mean
from typing import Any


@dataclass(frozen=True)
class Job:
    id: str
    team: str
    pool: str
    gpus: int
    arrival: datetime
    first_start: datetime
    completed: datetime
    duration_hours: float
    status: str
    attempts: int


@dataclass(frozen=True)
class Request:
    id: str
    team: str
    pool: str
    gpus: int
    arrival: float
    duration: float
    deadline: float


@dataclass(frozen=True)
class Allocation:
    request: Request
    start: float | None
    finish: float | None
    reason: str | None = None

    @property
    def missed(self) -> bool:
        return self.finish is None or self.finish > self.request.deadline + 1e-9


def quantile(values: list[float], probability: float) -> float:
    if not values or not 0 <= probability <= 1:
        raise ValueError("Quantiles require nonempty data and a probability in [0, 1].")
    ordered = sorted(values)
    index = probability * (len(ordered) - 1)
    lower = math.floor(index)
    upper = math.ceil(index)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


def timestamp(value: Any) -> datetime | None:
    if value in (None, "", "None"):
        return None
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")


def load_trace(directory: Path) -> tuple[list[Job], list[datetime], dict[str, int], dict[str, Any]]:
    machines: dict[str, tuple[int, str]] = {}
    inventory: Counter[str] = Counter()
    with (directory / "cluster_machine_list.csv").open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream, skipinitialspace=True):
            machine = row["machineId"].strip()
            count = int(row["number of GPUs"])
            memory = row["single GPU mem"].strip()
            if machine in machines or count <= 0:
                raise ValueError(f"Invalid or duplicate inventory machine: {machine}")
            pool = f"memory-{memory.lower()}"
            machines[machine] = (count, pool)
            inventory[pool] += count
    raw: list[dict[str, Any]] = json.loads(
        (directory / "cluster_job_log.json").read_text(encoding="utf-8")
    )
    counters: Counter[str] = Counter()
    inventory_warnings: Counter[str] = Counter()
    statuses: Counter[str] = Counter()
    submissions: list[datetime] = []
    jobs: list[Job] = []
    examples: list[dict[str, str]] = []
    seen: set[str] = set()

    def reject(job_id: str, reason: str) -> None:
        counters[reason] += 1
        if len(examples) < 25:
            examples.append({"job_id": job_id, "reason": reason})

    for row in raw:
        job_id = row["jobid"]
        if job_id in seen:
            reject(job_id, "duplicate_job_id")
            continue
        seen.add(job_id)
        statuses[row["status"]] += 1
        try:
            submitted = timestamp(row["submitted_time"])
        except (ValueError, TypeError):
            reject(job_id, "invalid_submission_timestamp")
            continue
        if submitted is None:
            reject(job_id, "missing_submission_timestamp")
            continue
        submissions.append(submitted)
        attempts = row["attempts"]
        counters["attempts_total"] += len(attempts)
        if not attempts:
            reject(job_id, "no_attempts")
            continue
        spans: list[tuple[datetime, datetime, int, str]] = []
        invalid_reason: str | None = None
        for attempt in attempts:
            try:
                start, end = timestamp(attempt["start_time"]), timestamp(attempt["end_time"])
            except (ValueError, TypeError):
                invalid_reason = "invalid_attempt_timestamp"
                break
            if start is None or end is None:
                invalid_reason = "missing_attempt_time_or_censored"
                break
            if end <= start or start < submitted:
                invalid_reason = "nonpositive_duration_or_start_before_submission"
                break
            allocated: set[tuple[str, str]] = set()
            for detail in attempt["detail"]:
                machine = detail["ip"]
                if machine not in machines:
                    inventory_warnings["allocation_details_on_unknown_machine"] += 1
                gpu_ids = detail["gpus"]
                if machine in machines and len(gpu_ids) > machines[machine][0]:
                    inventory_warnings["allocation_detail_count_above_static_machine_count"] += 1
                if len(set(gpu_ids)) != len(gpu_ids):
                    invalid_reason = "invalid_gpu_allocation"
                    break
                for gpu in gpu_ids:
                    if not isinstance(gpu, str) or not gpu:
                        invalid_reason = "invalid_gpu_identifier"
                        break
                    if (machine, gpu) in allocated:
                        invalid_reason = "invalid_gpu_allocation"
                        break
                    allocated.add((machine, gpu))
                if invalid_reason:
                    break
            if invalid_reason:
                break
            if not allocated:
                invalid_reason = "zero_gpu_attempt"
                break
            spans.append((start, end, len(allocated), "gpu-unspecified"))
        if invalid_reason:
            reject(job_id, invalid_reason)
            continue
        spans.sort()
        if any(left[1] > right[0] for left, right in zip(spans, spans[1:])):
            reject(job_id, "overlapping_attempts")
            continue
        if len({(span[2], span[3]) for span in spans}) != 1:
            reject(job_id, "changing_gpu_count_or_memory_pool")
            continue
        duration = sum((end - start).total_seconds() for start, end, _, _ in spans) / 3600
        jobs.append(Job(
            job_id, row["vc"], spans[0][3], spans[0][2], submitted,
            spans[0][0], max(span[1] for span in spans), duration,
            row["status"], len(spans),
        ))
    jobs.sort(key=lambda job: (job.arrival, job.id))
    submissions.sort()
    if not jobs or not submissions:
        raise ValueError("No usable workload records.")
    audit = {
        "raw_jobs": len(raw),
        "unique_valid_submissions": len(submissions),
        "modeled_complete_jobs": len(jobs),
        "excluded_from_policy_replay": len(raw) - len(jobs),
        "statuses": dict(statuses),
        "modeled_statuses": dict(Counter(job.status for job in jobs)),
        "counters": dict(counters),
        "exclusion_examples": examples,
        "machines": len(machines),
        "inventory_gpus": sum(inventory.values()),
        "memory_proxy_pools": dict(inventory),
        "inventory_reconciliation_warnings": dict(inventory_warnings),
        "modeled_supply_budget_reference": {"gpu-unspecified": sum(inventory.values())},
        "submission_start": submissions[0].isoformat(),
        "submission_end": submissions[-1].isoformat(),
        "observed_first_start_wait_p50_hours": quantile(
            [(job.first_start - job.arrival).total_seconds() / 3600 for job in jobs], 0.5
        ),
        "modeled_active_gpu_hours": sum(job.gpus * job.duration_hours for job in jobs),
        "timing_note": "Naive source wall-clock timestamps; timezone/DST ambiguity is not resolved.",
        "cohort_note": (
            "Replay includes only fully timed, fixed-size GPU jobs. "
            "Failed/Killed execution work and retry active time are retained; retry gaps are collapsed. "
            "Cohort membership and original allocated GPU requirements are retrospective/inferred. "
            "Machine/allocated-count inconsistencies prevent validated memory/topology compatibility. "
            "Replay assumes one synthetic homogeneous pool, using static inventory count only as a budget reference."
        ),
    }
    return jobs, submissions, {"gpu-unspecified": sum(inventory.values())}, audit


def daily_counts(submissions: list[datetime]) -> dict[datetime, float]:
    counts: Counter[datetime] = Counter(stamp.replace(hour=0, minute=0, second=0) for stamp in submissions)
    start = min(counts) + timedelta(days=1)
    end = max(counts)
    result: dict[datetime, float] = {}
    while start < end:
        result[start] = float(counts[start])
        start += timedelta(days=1)
    return result


def predict_day(counts: dict[datetime, float], cutoff: datetime, model: str) -> float:
    history = [counts[cutoff - timedelta(days=offset)] for offset in range(1, 29)]
    if model == "seasonal_7d":
        return counts[cutoff - timedelta(days=7)]
    if model == "rolling_28d":
        return mean(history)
    if model == "weekday_4w":
        return mean(counts[cutoff - timedelta(days=offset)] for offset in (7, 14, 21, 28))
    raise ValueError(f"Unknown forecast model: {model}")


def forecast_backtest(submissions: list[datetime], cutoff: datetime) -> dict[str, Any]:
    counts = daily_counts(submissions)
    if not counts or cutoff - timedelta(days=28) < min(counts) or cutoff > max(counts):
        raise ValueError("Forecast cutoff needs 28 complete history days and a complete observed target day.")
    models = ("seasonal_7d", "rolling_28d", "weekday_4w")
    rows: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {}
    for model in models:
        model_rows: list[dict[str, Any]] = []
        first = min(counts) + timedelta(days=28)
        while first <= max(counts):
            predicted = predict_day(counts, first, model)
            row = {
                "date": first.isoformat(), "model": model,
                "predicted_submissions": predicted, "actual_submissions": counts[first],
                "split": "validation" if first < cutoff else "held_out",
            }
            rows.append(row)
            model_rows.append(row)
            first += timedelta(days=1)
        metrics[model] = {}
        for split in ("validation", "held_out"):
            selected = [row for row in model_rows if row["split"] == split]
            if not selected:
                raise ValueError(f"Empty {split} forecast evaluation.")
            error = [row["predicted_submissions"] - row["actual_submissions"] for row in selected]
            actual_sum = sum(row["actual_submissions"] for row in selected)
            metrics[model][split] = {
                "days": len(selected),
                "mae_jobs_per_day": mean(abs(value) for value in error),
                "wape": sum(abs(value) for value in error) / actual_sum if actual_sum else None,
                "bias_jobs_per_day": mean(error),
            }
    selected_model = min(models, key=lambda name: metrics[name]["validation"]["mae_jobs_per_day"])
    residuals = [
        row["actual_submissions"] - row["predicted_submissions"]
        for row in rows if row["model"] == selected_model and row["split"] == "validation"
    ]
    if len(residuals) < 10:
        raise ValueError("Too few prior forecast residuals for empirical uncertainty bands.")
    lower_error, upper_error = quantile(residuals, 0.1), quantile(residuals, 0.9)
    evaluated = [row for row in rows if row["model"] == selected_model and row["split"] == "held_out"]
    covered = sum(
        max(0.0, row["predicted_submissions"] + lower_error)
        <= row["actual_submissions"] <= max(0.0, row["predicted_submissions"] + upper_error)
        for row in evaluated
    )
    predicted = predict_day(counts, cutoff, selected_model)
    history_hours: dict[int, int] = Counter(
        stamp.hour for stamp in submissions if cutoff - timedelta(days=28) <= stamp < cutoff
    )
    hour_total = sum(history_hours.values())
    hourly = [
        {"hour": (cutoff + timedelta(hours=hour)).isoformat(),
         "expected_submissions": predicted * history_hours.get(hour, 0) / hour_total}
        for hour in range(24)
    ]
    return {
        "target": "All valid job submissions, including jobs excluded from policy replay.",
        "horizon_hours": 24,
        "cutoff": cutoff.isoformat(),
        "selected_using_only_validation": selected_model,
        "predicted_next_24h_submissions": predicted,
        "actual_next_24h_submissions": counts[cutoff],
        "empirical_80pct_band": [
            max(0.0, predicted + lower_error), max(0.0, predicted + upper_error)
        ],
        "held_out_band_coverage": covered / len(evaluated),
        "uncertainty_note": (
            "Bands use pre-cutoff validation residuals. Coverage is measured, not assumed. "
            "Hourly shape uses only the preceding 28 days. Counts are not a GPU capacity forecast."
        ),
        "metrics": metrics,
        "daily_backtest": rows,
        "hourly_forecast": hourly,
    }


def size_bucket(gpus: int) -> int:
    if gpus <= 0:
        raise ValueError("GPU count must be positive.")
    return gpus.bit_length() - 1


class DurationModel:
    def __init__(self, jobs: list[Job], cutoff: datetime):
        self.by_size: dict[tuple[str, int], list[float]] = defaultdict(list)
        self.by_pool: dict[str, list[float]] = defaultdict(list)
        self.estimates: dict[tuple[str, int, float], float] = {}
        self.training_jobs = 0
        for job in jobs:
            if cutoff - timedelta(days=28) <= job.arrival < cutoff and job.completed < cutoff:
                self.by_size[(job.pool, size_bucket(job.gpus))].append(job.duration_hours)
                self.by_pool[job.pool].append(job.duration_hours)
                self.training_jobs += 1
        if not self.training_jobs:
            raise ValueError("No completed, pre-cutoff jobs for the duration model.")

    def samples(self, pool: str, gpus: int) -> list[float]:
        sample = self.by_size.get((pool, size_bucket(gpus)), [])
        if len(sample) >= 10:
            return sample
        fallback = self.by_pool.get(pool, [])
        if not fallback:
            raise ValueError(f"No historical runtime evidence for pool {pool}.")
        return fallback

    def estimate(self, pool: str, gpus: int, probability: float = 0.5) -> float:
        key = (pool, size_bucket(gpus), probability)
        if key not in self.estimates:
            self.estimates[key] = quantile(self.samples(pool, gpus), probability)
        return self.estimates[key]

    def draw(self, pool: str, gpus: int, rng: random.Random) -> float:
        return rng.choice(self.samples(pool, gpus))


def simulate(
    requests: list[Request],
    capacities: dict[str, int],
    quotas: dict[tuple[str, str], int],
    borrowing: bool = False,
    ordering: str = "fifo",
) -> list[Allocation]:
    if ordering not in ("fifo", "edf"):
        raise ValueError(f"Unknown queue order: {ordering}")
    if any(type(capacity) is not int or capacity <= 0 for capacity in capacities.values()):
        raise ValueError("Capacities must be positive integers.")
    for pool, capacity in capacities.items():
        pool_quotas = [quota for (name, _), quota in quotas.items() if name == pool]
        if any(type(quota) is not int or quota < 0 for quota in pool_quotas) or sum(pool_quotas) > capacity:
            raise ValueError(f"Invalid quota budget for {pool}.")
    if len({job.id for job in requests}) != len(requests):
        raise ValueError("Duplicate request IDs.")
    incoming: list[Request] = []
    result: list[Allocation] = []
    for job in requests:
        if (
            type(job.gpus) is not int or job.gpus <= 0 or job.duration <= 0 or job.arrival < 0
            or job.deadline < job.arrival
            or not all(math.isfinite(value) for value in (job.duration, job.arrival, job.deadline))
        ):
            raise ValueError(f"Invalid request: {job.id}")
        if job.pool not in capacities or (job.pool, job.team) not in quotas:
            raise ValueError(f"Missing pool/quota for {job.id}")
        limit = capacities[job.pool] if borrowing else quotas[(job.pool, job.team)]
        if job.gpus > limit:
            reason = "physical_pool_too_small" if job.gpus > capacities[job.pool] else "team_quota_too_small"
            result.append(Allocation(job, None, None, reason))
        else:
            incoming.append(job)
    incoming.sort(key=lambda job: (job.arrival, job.id))
    usage: Counter[str] = Counter()
    team_usage: Counter[tuple[str, str]] = Counter()
    running: list[tuple[float, int, Request]] = []
    pending: list[Request] = []
    index = 0
    serial = 0
    now = 0.0
    while index < len(incoming) or pending or running:
        while running and running[0][0] <= now + 1e-9:
            _, _, job = heapq.heappop(running)
            usage[job.pool] -= job.gpus
            team_usage[(job.pool, job.team)] -= job.gpus
        while index < len(incoming) and incoming[index].arrival <= now + 1e-9:
            pending.append(incoming[index])
            index += 1
        pending.sort(key=lambda job: (
            (job.deadline if ordering == "edf" else job.arrival), job.arrival, job.id
        ))
        waiting: list[Request] = []
        for job in pending:
            team_key = (job.pool, job.team)
            fits = usage[job.pool] + job.gpus <= capacities[job.pool]
            if not borrowing:
                fits = fits and team_usage[team_key] + job.gpus <= quotas[team_key]
            if not fits:
                waiting.append(job)
                continue
            usage[job.pool] += job.gpus
            team_usage[team_key] += job.gpus
            if usage[job.pool] > capacities[job.pool]:
                raise AssertionError("Physical capacity exceeded.")
            if not borrowing and team_usage[team_key] > quotas[team_key]:
                raise AssertionError("Team entitlement exceeded.")
            serial += 1
            finish = now + job.duration
            heapq.heappush(running, (finish, serial, job))
            result.append(Allocation(job, now, finish))
        pending = waiting
        next_events = []
        if index < len(incoming):
            next_events.append(incoming[index].arrival)
        if running:
            next_events.append(running[0][0])
        if not next_events:
            if pending:
                raise AssertionError("Feasible jobs stalled without a future event.")
            break
        now = min(next_events)
    return sorted(result, key=lambda allocation: allocation.request.id)


def summarize(allocations: list[Allocation]) -> dict[str, Any]:
    if not allocations:
        raise ValueError("Cannot summarize an empty replay.")
    waits = [
        allocation.start - allocation.request.arrival
        for allocation in allocations if allocation.start is not None
    ]
    by_team: dict[str, Any] = {}
    for team in sorted({allocation.request.team for allocation in allocations}):
        members = [allocation for allocation in allocations if allocation.request.team == team]
        team_waits = [
            allocation.start - allocation.request.arrival
            for allocation in members if allocation.start is not None
        ]
        by_team[team] = {
            "jobs": len(members), "miss_rate": mean(float(allocation.missed) for allocation in members),
            "p95_wait_hours": quantile(team_waits, 0.95) if team_waits else None,
        }
    return {
        "jobs": len(allocations),
        "infeasible_jobs": sum(allocation.finish is None for allocation in allocations),
        "deadline_miss_rate": mean(float(allocation.missed) for allocation in allocations),
        "mean_wait_hours": mean(waits) if waits else None,
        "p95_wait_hours": quantile(waits, 0.95) if waits else None,
        "executed_gpu_hours": sum(
            allocation.request.gpus * allocation.request.duration
            for allocation in allocations if allocation.finish is not None
        ),
        "infeasibility_reasons": dict(Counter(
            allocation.reason for allocation in allocations if allocation.reason
        )),
        "by_team": by_team,
    }


def apportion(capacity: int, teams: list[str]) -> dict[str, int]:
    if not teams or capacity <= 0:
        raise ValueError("Positive capacity and nonempty teams required.")
    base, remainder = divmod(capacity, len(teams))
    return {team: base + int(index < remainder) for index, team in enumerate(sorted(teams))}


def build_requests(
    jobs: list[Job], cutoff: datetime, hours: int, duration_model: DurationModel,
    team_map: dict[str, str],
) -> list[Request]:
    result = []
    for job in jobs:
        if cutoff <= job.arrival < cutoff + timedelta(hours=hours):
            arrival = (job.arrival - cutoff).total_seconds() / 3600
            deadline_budget = max(2.0, 2 * duration_model.estimate(job.pool, job.gpus, 0.75))
            result.append(Request(
                job.id, team_map.get(job.team, "other"), job.pool, job.gpus,
                arrival, job.duration_hours, arrival + deadline_budget,
            ))
    if not result:
        raise ValueError("No eligible replay jobs in the selected window.")
    return result


def scenario_replay(
    jobs: list[Job], inventory: dict[str, int], cutoff: datetime,
    hours: int, capacity_fraction: float, draws: int, seed: int,
) -> dict[str, Any]:
    if hours <= 0 or draws < 2 or not 0 < capacity_fraction <= 1:
        raise ValueError("Positive horizon, >=2 draws, and capacity fraction in (0, 1] required.")
    model = DurationModel(jobs, cutoff)
    team_work: Counter[str] = Counter()
    for job in jobs:
        if cutoff - timedelta(days=28) <= job.arrival < cutoff and job.completed < cutoff:
            team_work[job.team] += job.gpus * job.duration_hours
    top_teams = [team for team, _ in team_work.most_common(5)]
    team_map = {team: team for team in top_teams}
    requests = build_requests(jobs, cutoff, hours, model, team_map)
    teams = sorted(top_teams + ["other"])
    capacities = {pool: max(1, int(gpus * capacity_fraction)) for pool, gpus in inventory.items()}

    def quota_budget(budget: dict[str, int]) -> dict[tuple[str, str], int]:
        return {
            (pool, team): quota
            for pool, capacity in budget.items()
            for team, quota in apportion(capacity, teams).items()
        }

    additions = {pool: math.ceil(capacity / 8 * 1.25) * 8 for pool, capacity in capacities.items()}
    scenario_specs = {
        "baseline": (capacities, False, "fifo"),
        "borrow_idle_entitlement": (capacities, True, "fifo"),
        "reschedule_edf": (capacities, False, "edf"),
        "add_25pct_rounded_8gpu": (additions, False, "fifo"),
    }
    duration_errors = [
        abs(model.estimate(job.pool, job.gpus) - job.duration)
        for job in requests
    ]
    global_duration_median = quantile(
        [value for sample in model.by_pool.values() for value in sample], 0.5
    )
    results: dict[str, Any] = {}
    all_risks: list[dict[str, Any]] = []
    sampled: list[list[Request]] = []
    rng = random.Random(seed)
    for _ in range(draws):
        sampled.append([
            replace(job, duration=model.draw(job.pool, job.gpus, rng))
            for job in requests
        ])
    runtime_only_risk = {
        job.id: sum(
            sample[index].duration > job.deadline - job.arrival + 1e-9 for sample in sampled
        ) / draws
        for index, job in enumerate(requests)
    }
    for name, (budget, borrowing, order) in scenario_specs.items():
        quota = quota_budget(budget)
        actual = simulate(requests, budget, quota, borrowing, order)
        draw_summaries = []
        misses: Counter[str] = Counter()
        waits: dict[str, list[float]] = defaultdict(list)
        for sample in sampled:
            allocations = simulate(sample, budget, quota, borrowing, order)
            draw_summaries.append(summarize(allocations))
            for allocation in allocations:
                misses[allocation.request.id] += int(allocation.missed)
                if allocation.start is not None:
                    waits[allocation.request.id].append(allocation.start - allocation.request.arrival)
        results[name] = {
            "capacities": budget,
            "quota_per_team": {
                pool: apportion(capacity, teams) for pool, capacity in budget.items()
            },
            "actual_duration_replay": summarize(actual),
            "sampled_mean_deadline_miss_rate": mean(row["deadline_miss_rate"] for row in draw_summaries),
            "sampled_p90_deadline_miss_rate": quantile(
                [row["deadline_miss_rate"] for row in draw_summaries], 0.9
            ),
        }
        for allocation in actual:
            job = allocation.request
            all_risks.append({
                "scenario": name, "job_id": job.id, "team": job.team, "pool": job.pool,
                "gpus": job.gpus, "arrival_hour": job.arrival, "deadline_hour": job.deadline,
                "observed_duration_hours": job.duration,
                "estimated_p50_duration_hours": model.estimate(job.pool, job.gpus),
                "modeled_miss_probability": misses[job.id] / draws,
                "runtime_only_miss_probability_lower_bound": runtime_only_risk[job.id],
                "mean_sampled_wait_hours": mean(waits[job.id]) if waits[job.id] else None,
                "actual_duration_start_hour": allocation.start,
                "actual_duration_finish_hour": allocation.finish,
                "infeasibility_reason": allocation.reason,
            })
    candidates = []
    for fraction in (capacity_fraction, min(1.0, capacity_fraction * 1.5), 1.0, 1.25):
        budget = {pool: max(8, math.ceil(gpus * fraction / 8) * 8) for pool, gpus in inventory.items()}
        quota = quota_budget(budget)
        misses_by_job: Counter[str] = Counter()
        for sample in sampled:
            for allocation in simulate(sample, budget, quota, True, "edf"):
                misses_by_job[allocation.request.id] += int(allocation.missed)
        max_risk = max(misses_by_job.values(), default=0) / draws
        candidates.append({
            "capacity_gpus": sum(budget.values()), "capacities": budget,
            "maximum_commitment_miss_probability": max_risk,
            "meets_synthetic_10pct_per_job_risk_target": max_risk <= 0.1,
            "policy": "idle-entitlement borrowing + EDF; non-preemptive",
        })
    passing = [row for row in candidates if row["meets_synthetic_10pct_per_job_risk_target"]]
    selected = min(passing, key=lambda row: row["capacity_gpus"]) if passing else None
    baseline_teams = results["baseline"]["actual_duration_replay"]["by_team"]
    for row in results.values():
        row["team_miss_rate_change_vs_baseline"] = {
            team: metrics["miss_rate"] - baseline_teams[team]["miss_rate"]
            for team, metrics in row["actual_duration_replay"]["by_team"].items()
        }
    return {
        "cutoff": cutoff.isoformat(), "horizon_hours": hours, "random_seed": seed,
        "duration_draws": draws, "training_jobs_completed_before_cutoff": model.training_jobs,
        "replay_jobs": len(requests),
        "duration_p50_mae_hours": mean(duration_errors),
        "duration_p50_constant_global_mae_hours": mean(
            abs(global_duration_median - job.duration) for job in requests
        ),
        "assumptions": [
            "Complete-job retrospective cohort; original requests inferred from observed allocation.",
            "Arrival times are revealed to the scheduler at arrival, but replay inputs are held-out actual arrivals, not forecast-generated traffic.",
            "All pools start empty. Pre-window running/pending jobs are omitted; this is not a live-fleet snapshot reconstruction.",
            "One synthetic homogeneous compatibility domain. Static inventory cannot be fully reconciled with allocation records; its total is only a declared supply-budget reference.",
            "No CPU/network/storage/power placement validation; resource feasibility means pool GPU budget only.",
            "Fixed-size non-preemptive jobs; active retry execution collapsed into one runtime, without retry gaps.",
            "Five historical top-work VCs plus an other group; equal synthetic per-pool quotas.",
            "Synthetic completion deadlines: arrival + max(2h, 2 * pre-cutoff size/pool runtime p75).",
            "Borrowing is within-pool idle entitlement, with no physical transfer, recall, or protected start guarantee.",
            "Runtime samples come only from pre-cutoff completed jobs; correlations and residual life of running jobs are not modeled.",
            "Additional GPUs are assumed immediately ready and compatible, in synthetic 8-GPU units; no cost/supply lead-time model.",
            "Capacity selection uses an illustrative 10% per-job risk target and a finite candidate grid, not a global optimum.",
            "Small-sample risk estimates are uncalibrated conditional model outputs, not reliable production probabilities.",
        ],
        "scenarios": results,
        "capacity_candidates": candidates,
        "lowest_tested_passing_capacity": selected,
        "maximum_runtime_only_miss_probability_lower_bound": max(runtime_only_risk.values()),
        "capacity_selection_status": (
            "A tested candidate met the conditional target." if selected
            else "Runtime uncertainty alone breaches the conditional risk target for at least one commitment; adding GPUs cannot fix that modeled deadline without other changes."
            if max(runtime_only_risk.values()) > 0.1
            else "No tested candidate met the conditional target; do not claim a capacity recommendation."
        ),
        "commitments": all_risks,
    }
