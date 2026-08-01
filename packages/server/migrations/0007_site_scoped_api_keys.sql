-- API credentials are site capabilities, not account-wide credentials.
-- Existing keys from single-site accounts can be scoped safely. Keys from
-- multi-site accounts remain unassigned and therefore cannot authenticate
-- until an owner explicitly selects their site in Account & API.
ALTER TABLE api_keys
    ADD COLUMN site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_api_keys_site
    ON api_keys (account_id, site_id);

UPDATE api_keys
   SET site_id = (
       SELECT MIN(s.site_id)
         FROM sites s
        WHERE s.account_id = api_keys.account_id
   )
 WHERE site_id IS NULL
   AND 1 = (
       SELECT COUNT(*)
         FROM sites s
        WHERE s.account_id = api_keys.account_id
   );
