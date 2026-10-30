-- Northwind Goods refund policy v1 (spec §5.4, docs/policy.md). New versions are new
-- migrations; a published version is never edited, because results are scored against it.
INSERT INTO policy (version, window_days, human_threshold_cents, daily_cap_cents, velocity_max, velocity_window_days, active)
VALUES (1, 30, 25000, 200000, 3, 30, true);
