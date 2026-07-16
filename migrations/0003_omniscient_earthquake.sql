-- Enforce: one catalyst yields at most one egg per ticker.
--
-- The same ticker under DIFFERENT catalysts is legitimate (each catalyst gives
-- it a different thesis), so the key is composite rather than unique-on-ticker.
--
-- Existing duplicates must go first or the index creation fails. We keep the
-- lowest id in each group (the first one recorded) and drop the rest, clearing
-- their dependent rows so nothing is left pointing at a deleted egg.

CREATE TEMP TABLE _dupe_eggs AS
SELECT id FROM golden_eggs
WHERE id NOT IN (SELECT MIN(id) FROM golden_eggs GROUP BY catalyst_id, ticker);
--> statement-breakpoint
DELETE FROM watchlist WHERE egg_id IN (SELECT id FROM _dupe_eggs);
--> statement-breakpoint
DELETE FROM price_alerts WHERE egg_id IN (SELECT id FROM _dupe_eggs);
--> statement-breakpoint
DELETE FROM golden_eggs WHERE id IN (SELECT id FROM _dupe_eggs);
--> statement-breakpoint
DROP TABLE _dupe_eggs;
--> statement-breakpoint
CREATE UNIQUE INDEX `eggs_catalyst_ticker_unique` ON `golden_eggs` (`catalyst_id`,`ticker`);
