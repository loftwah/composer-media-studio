-- MIT. Rename the allocated-cost column so its name matches what it holds.
--
-- The value was always the cost this studio allocated to a job when it settled
-- its budget reservation. It was never a provider invoice, and calling it
-- "observed" invited readers to treat an estimate as a charge. The rename keeps
-- every saved row and does not touch the reservation, the estimate or the budget.
--
-- A provider-reported charge, when a provider actually returns one, belongs in
-- its own field. That is a separate value and is not backfilled from this column:
-- an allocation is not evidence of what a provider billed. NULL means unknown,
-- never zero.

ALTER TABLE generations RENAME COLUMN cost_observed_micro TO cost_allocated_micro;

ALTER TABLE generations ADD COLUMN provider_charged_micro INTEGER;
