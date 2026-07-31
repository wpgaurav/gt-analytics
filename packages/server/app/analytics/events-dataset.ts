/**
 * Dataset name for custom events and conversions.
 *
 * Must match the EVENTS_AE binding in wrangler.json. The pageview dataset had
 * exactly this drift in production once -- writes went to one table, reads to
 * another, and every query returned zero rows with no error -- so the name is
 * configurable rather than hardcoded in the query layer.
 */
export const DEFAULT_EVENTS_DATASET = "gt_analytics_events";
