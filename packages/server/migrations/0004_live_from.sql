-- The date a site's own collection became authoritative.
--
-- Without this, imported history is invisible. The router hands any day inside
-- Analytics Engine's 90-day window to Analytics Engine, which is right for a
-- site that has been collecting all along and wrong for one that was imported:
-- gauravtiwari.org has four months of history in the archive but only started
-- writing to Analytics Engine on 2026-07-20, so the overlapping weeks would be
-- answered by the store that barely has them.
--
-- live_from is the first day to read from Analytics Engine. Days before it come
-- from the archive, whatever retention would otherwise allow. NULL means the
-- site has always collected its own data and the retention window is correct.
ALTER TABLE sites ADD COLUMN live_from TEXT;

-- gauravtiwari.org ran Independent Analytics until today, so every day before
-- today is better answered by the imported archive.
UPDATE sites SET live_from = '2026-07-31' WHERE site_id = 'gauravtiwari.org';
