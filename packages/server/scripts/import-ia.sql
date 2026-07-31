SELECT
  DATE(v.viewed_at)                              AS date,
  COALESCE(r.cached_url, '')                     AS url,
  COALESCE(er.cached_url, '')                    AS entry_url,
  COALESCE(ref.referrer, '')                     AS referrer,
  COALESCE(ref.domain, '')                       AS referrer_host,
  COALESCE(c.country_code, '')                   AS country,
  COALESCE(b.device_browser, '')                 AS browser_name,
  COALESCE(dt.device_type, '')                   AS device_type,
  COALESCE(us.utm_source, '')                    AS utm_source,
  COALESCE(um.utm_medium, '')                    AS utm_medium,
  COALESCE(uc.utm_campaign, '')                  AS utm_campaign,
  COALESCE(cam.utm_term, '')                     AS utm_term,
  COALESCE(cam.utm_content, '')                  AS utm_content,
  COUNT(*)                                       AS views,
  SUM(CASE WHEN v.id = fv.first_view_id THEN 1 ELSE 0 END)                        AS visitors,
  SUM(CASE WHEN v.id = s.initial_view_id AND s.total_views = 1 THEN 1 ELSE 0 END) AS bounces
FROM wp_independent_analytics_views v
LEFT JOIN wp_independent_analytics_sessions s   ON s.session_id = v.session_id
LEFT JOIN wp_independent_analytics_resources r  ON r.id = v.resource_id
LEFT JOIN wp_independent_analytics_views ev     ON ev.id = s.initial_view_id
LEFT JOIN wp_independent_analytics_resources er ON er.id = ev.resource_id
LEFT JOIN wp_independent_analytics_referrers ref ON ref.id = s.referrer_id
LEFT JOIN wp_independent_analytics_countries c  ON c.country_id = s.country_id
LEFT JOIN wp_independent_analytics_device_browsers b ON b.device_browser_id = s.device_browser_id
LEFT JOIN wp_independent_analytics_device_types dt   ON dt.device_type_id = s.device_type_id
LEFT JOIN wp_independent_analytics_campaigns cam ON cam.campaign_id = s.campaign_id
LEFT JOIN wp_independent_analytics_utm_sources us   ON us.id = cam.utm_source_id
LEFT JOIN wp_independent_analytics_utm_mediums um   ON um.id = cam.utm_medium_id
LEFT JOIN wp_independent_analytics_utm_campaigns uc ON uc.id = cam.utm_campaign_id
LEFT JOIN (
  SELECT DATE(vv.viewed_at) AS d, ss.visitor_id AS vid, MIN(vv.id) AS first_view_id
  FROM wp_independent_analytics_views vv
  JOIN wp_independent_analytics_sessions ss ON ss.session_id = vv.session_id
  GROUP BY d, ss.visitor_id
) fv ON fv.d = DATE(v.viewed_at) AND fv.vid = s.visitor_id
GROUP BY date, url, entry_url, referrer, referrer_host, country,
         browser_name, device_type, utm_source, utm_medium,
         utm_campaign, utm_term, utm_content
