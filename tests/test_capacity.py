from datetime import datetime, timedelta
import json
from pathlib import Path
import random
import tempfile
import unittest

from capacity import (
    DurationModel, Job, Request, apportion, build_requests, forecast_backtest,
    load_trace, predict_day, quantile, scenario_replay, simulate, summarize,
)


class SchedulingTests(unittest.TestCase):
    def setUp(self):
        self.requests = [
            Request("A", "team", "pool", 128, 0, 12, 24),
            Request("B", "team", "pool", 96, 0, 8, 12),
            Request("C", "team", "pool", 128, 0, 10, 18),
        ]

    def test_baseline_and_edf_deadlines(self):
        baseline = simulate(self.requests, {"pool": 224}, {("pool", "team"): 224})
        self.assertEqual([row.finish for row in baseline], [12, 8, 22])
        reordered = simulate(self.requests, {"pool": 224}, {("pool", "team"): 224}, ordering="edf")
        self.assertEqual([row.finish for row in reordered], [22, 8, 10])
        self.assertEqual(sum(row.missed for row in baseline), 1)
        self.assertFalse(any(row.missed for row in reordered))

    def test_hyperscale_arithmetic(self):
        jobs = [
            Request(job.id, job.team, job.pool, job.gpus * 128, job.arrival, job.duration, job.deadline)
            for job in self.requests
        ]
        allocations = simulate(jobs, {"pool": 28672}, {("pool", "team"): 28672})
        self.assertEqual([row.finish for row in allocations], [12, 8, 22])
        expanded = simulate(jobs, {"pool": 32768}, {("pool", "team"): 32768})
        self.assertEqual([row.finish for row in expanded], [12, 8, 18])

    def test_borrowing_changes_entitlement_not_physical_supply(self):
        request = Request("a", "a", "p", 8, 0, 1, 2)
        quotas = {("p", "a"): 4, ("p", "b"): 4}
        baseline = simulate([request], {"p": 8}, quotas)
        self.assertEqual(baseline[0].reason, "team_quota_too_small")
        borrowed = simulate([request], {"p": 8}, quotas, borrowing=True)
        self.assertEqual(borrowed[0].finish, 1)
        too_large = Request("x", "a", "p", 9, 0, 1, 2)
        self.assertEqual(
            simulate([too_large], {"p": 8}, quotas, borrowing=True)[0].reason,
            "physical_pool_too_small",
        )

    def test_arrivals_are_not_visible_early(self):
        requests = [Request("late", "t", "p", 8, 10, 2, 20)]
        self.assertEqual(simulate(requests, {"p": 8}, {("p", "t"): 8})[0].start, 10)

    def test_borrowing_can_hurt_donor_without_preemption(self):
        jobs = [
            Request("a", "a", "p", 8, 0, 10, 20),
            Request("b", "b", "p", 4, 1, 1, 3),
        ]
        result = simulate(jobs, {"p": 8}, {("p", "a"): 4, ("p", "b"): 4}, borrowing=True)
        self.assertEqual(result[1].start, 10)
        self.assertTrue(result[1].missed)

    def test_pools_do_not_substitute(self):
        jobs = [Request("x", "t", "p1", 9, 0, 1, 3)]
        result = simulate(jobs, {"p1": 8, "p2": 100}, {("p1", "t"): 8, ("p2", "t"): 100}, True)
        self.assertEqual(result[0].reason, "physical_pool_too_small")

    def test_invalid_requests_and_budgets_raise(self):
        with self.assertRaises(ValueError):
            simulate(self.requests, {"pool": 224}, {("pool", "team"): 225})
        with self.assertRaises(ValueError):
            simulate(self.requests, {"pool": 224.5}, {("pool", "team"): 224})
        with self.assertRaises(ValueError):
            simulate(self.requests + self.requests, {"pool": 224}, {("pool", "team"): 224})
        with self.assertRaises(ValueError):
            simulate([Request("x", "t", "p", 0, 0, 1, 2)], {"p": 8}, {("p", "t"): 8})
        with self.assertRaises(ValueError):
            simulate([Request("x", "t", "p", 1.5, 0, 1, 2)], {"p": 8}, {("p", "t"): 8})
        with self.assertRaises(ValueError):
            simulate([Request("x", "t", "p", 1, 0, float("nan"), 2)], {"p": 8}, {("p", "t"): 8})

    def test_capacity_invariant_with_many_arrivals(self):
        rng = random.Random(7)
        jobs = [
            Request(str(index), str(index % 3), "p", rng.randint(1, 8),
                    rng.uniform(0, 10), rng.uniform(0.1, 4), 20)
            for index in range(300)
        ]
        allocations = simulate(jobs, {"p": 24}, {("p", str(i)): 8 for i in range(3)}, True, "edf")
        events = []
        for row in allocations:
            self.assertIsNotNone(row.start)
            events.extend([(row.start, 1, row.request.gpus), (row.finish, 0, -row.request.gpus)])
        usage = 0
        for _, _, change in sorted(events):
            usage += change
            self.assertLessEqual(usage, 24)
            self.assertGreaterEqual(usage, 0)
        self.assertEqual(usage, 0)
        self.assertEqual(summarize(allocations)["jobs"], 300)


class ForecastTests(unittest.TestCase):
    def test_predictions_do_not_read_future(self):
        start = datetime(2017, 1, 1)
        counts = {start + timedelta(days=i): float(i % 7 + 1) for i in range(90)}
        cutoff = start + timedelta(days=60)
        predictions = {model: predict_day(counts, cutoff, model) for model in (
            "seasonal_7d", "rolling_28d", "weekday_4w"
        )}
        for day in counts:
            if day >= cutoff:
                counts[day] = 1_000_000
        self.assertEqual(predictions, {
            model: predict_day(counts, cutoff, model) for model in predictions
        })

    def test_model_selection_and_hourly_shape_do_not_use_holdout(self):
        start = datetime(2017, 1, 1)
        cutoff = start + timedelta(days=70)
        arrivals = [
            start + timedelta(days=i, hours=j)
            for i in range(100) for j in range(1, i % 7 + 2)
        ]
        original = forecast_backtest(arrivals, cutoff)
        changed = forecast_backtest(
            arrivals + [cutoff + timedelta(days=1, hours=12)] * 1000, cutoff
        )
        self.assertEqual(original["selected_using_only_validation"], changed["selected_using_only_validation"])
        self.assertEqual(original["hourly_forecast"], changed["hourly_forecast"])
        self.assertAlmostEqual(
            sum(row["expected_submissions"] for row in original["hourly_forecast"]),
            original["predicted_next_24h_submissions"],
        )
        with self.assertRaises(ValueError):
            forecast_backtest(arrivals, start + timedelta(days=10))

    def test_duration_samples_exclude_future_completions(self):
        cutoff = datetime(2017, 2, 1)
        past = Job("past", "t", "p", 8, cutoff - timedelta(days=2),
                   cutoff - timedelta(days=2), cutoff - timedelta(days=1), 1, "Pass", 1)
        future = Job("future", "t", "p", 8, cutoff - timedelta(days=2),
                     cutoff - timedelta(days=2), cutoff + timedelta(days=1), 999, "Pass", 1)
        model = DurationModel([past, future], cutoff)
        self.assertEqual(model.samples("p", 8), [1])
        self.assertEqual(model.estimate("p", 8), 1)
        with self.assertRaises(ValueError):
            model.samples("unknown", 8)

    def test_deadlines_use_prior_estimates_not_actual_runtime(self):
        cutoff = datetime(2017, 2, 1)
        prior = Job("prior", "t", "p", 8, cutoff - timedelta(days=2),
                    cutoff - timedelta(days=2), cutoff - timedelta(days=1), 3, "Pass", 1)
        target = Job("target", "t", "p", 8, cutoff + timedelta(hours=1),
                     cutoff + timedelta(hours=1), cutoff + timedelta(days=3), 50, "Pass", 1)
        requests = build_requests([target], cutoff, 24, DurationModel([prior], cutoff), {"t": "t"})
        self.assertEqual(requests[0].deadline, 7)

    def test_replay_is_reproducible_and_runtime_risk_is_a_lower_bound(self):
        cutoff = datetime(2017, 2, 1)
        training = [
            Job(str(i), "t", "p", 1, cutoff - timedelta(days=20),
                cutoff - timedelta(days=20), cutoff - timedelta(days=1),
                1 if i < 20 else 100, "Pass", 1)
            for i in range(24)
        ]
        target = Job("target", "t", "p", 1, cutoff, cutoff,
                     cutoff + timedelta(hours=1), 1, "Pass", 1)
        first = scenario_replay(training + [target], {"p": 48}, cutoff, 24, 0.5, 300, 7)
        second = scenario_replay(training + [target], {"p": 48}, cutoff, 24, 0.5, 300, 7)
        self.assertEqual(first, second)
        for row in first["commitments"]:
            self.assertLessEqual(
                row["runtime_only_miss_probability_lower_bound"], row["modeled_miss_probability"]
            )
        self.assertGreater(first["maximum_runtime_only_miss_probability_lower_bound"], 0.1)
        self.assertIsNone(first["lowest_tested_passing_capacity"])


class AuditTests(unittest.TestCase):
    def test_censoring_and_retries_are_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "cluster_machine_list.csv").write_text(
                "machineId, number of GPUs, single GPU mem\nm0,8,24GB\n", encoding="utf-8"
            )

            def record(job_id, attempts):
                return {
                    "jobid": job_id, "vc": "t", "status": "Failed",
                    "submitted_time": "2017-01-01 00:00:00", "attempts": attempts,
                }

            def attempt(start, end):
                return {"start_time": start, "end_time": end,
                        "detail": [{"ip": "m0", "gpus": ["gpu0", "gpu1"]}]}

            rows = [
                record("retry", [
                    attempt("2017-01-01 01:00:00", "2017-01-01 02:00:00"),
                    attempt("2017-01-01 04:00:00", "2017-01-01 06:00:00"),
                ]),
                record("censored", [attempt("2017-01-01 01:00:00", None)]),
                record("missing", []),
                record("overlap", [
                    attempt("2017-01-01 01:00:00", "2017-01-01 03:00:00"),
                    attempt("2017-01-01 02:00:00", "2017-01-01 04:00:00"),
                ]),
            ]
            (path / "cluster_job_log.json").write_text(json.dumps(rows), encoding="utf-8")
            jobs, arrivals, inventory, audit = load_trace(path)
            self.assertEqual(len(arrivals), 4)
            self.assertEqual(len(jobs), 1)
            self.assertEqual(jobs[0].duration_hours, 3)
            self.assertEqual(jobs[0].attempts, 2)
            self.assertEqual(inventory, {"gpu-unspecified": 8})
            self.assertEqual(audit["excluded_from_policy_replay"], 3)
            self.assertEqual(audit["counters"]["missing_attempt_time_or_censored"], 1)
            self.assertEqual(audit["counters"]["overlapping_attempts"], 1)

    def test_gpu_ids_are_opaque_and_inventory_discrepancies_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "cluster_machine_list.csv").write_text(
                "machineId, number of GPUs, single GPU mem\nm0,2,12GB\n", encoding="utf-8"
            )
            rows = [{
                "jobid": "mismatch", "vc": "t", "status": "Pass",
                "submitted_time": "2017-01-01 00:00:00",
                "attempts": [{
                    "start_time": "2017-01-01 01:00:00", "end_time": "2017-01-01 02:00:00",
                    "detail": [{"ip": "m0", "gpus": ["gpu5", "gpu6", "gpu7"]}],
                }],
            }]
            (path / "cluster_job_log.json").write_text(json.dumps(rows), encoding="utf-8")
            jobs, _, inventory, audit = load_trace(path)
            self.assertEqual(jobs[0].gpus, 3)
            self.assertEqual(jobs[0].pool, "gpu-unspecified")
            self.assertEqual(inventory, {"gpu-unspecified": 2})
            self.assertEqual(
                audit["inventory_reconciliation_warnings"]["allocation_detail_count_above_static_machine_count"], 1
            )

    def test_quantile_and_quota_accounting(self):
        self.assertEqual(quantile([0, 10], 0.5), 5)
        with self.assertRaises(ValueError):
            quantile([], 0.5)
        quota = apportion(17, ["c", "a", "b"])
        self.assertEqual(sum(quota.values()), 17)
        self.assertLessEqual(max(quota.values()) - min(quota.values()), 1)


if __name__ == "__main__":
    unittest.main()
