import { EventColumnMappings } from "./events";
import { intervalToSql } from "./query";

export interface EventBreakdownRow {
    name: string;
    type: string;
    path: string;
    label: string;
    channel: string;
    referrerHost: string;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    country: string;
    currency: string;
    count: number;
    value: number;
}

export interface EventFilters {
    path?: string;
    channel?: string;
    country?: string;
    referrerHost?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
}

/**
 * Reads the events dataset.
 *
 * Deliberately a small separate class rather than more methods on
 * AnalyticsEngineAPI: it queries a different dataset with a different schema,
 * and folding the two together would mean every call site had to say which one
 * it meant.
 */
export class EventsAPI {
    constructor(
        private cfAccountId: string,
        private cfApiToken: string,
        private dataset: string,
    ) {}

    private async query(sql: string) {
        return fetch(
            `https://api.cloudflare.com/client/v4/accounts/${this.cfAccountId}/analytics_engine/sql`,
            {
                method: "POST",
                body: sql,
                headers: {
                    "content-type": "application/json;charset=UTF-8",
                    "X-Source": "Cloudflare-Workers",
                    Authorization: `Bearer ${this.cfApiToken}`,
                },
            },
        );
    }

    /**
     * Conversions and events by name, with how many fired and their total
     * value.
     */
    async getEventCounts(
        siteId: string,
        interval: string,
        tz?: string,
        type?: "conversion" | "event",
        limit = 20,
        filters: EventFilters = {},
    ): Promise<[name: string, count: number, value: number, type: string][]> {
        const { startIntervalSql, endIntervalSql } = intervalToSql(
            interval,
            tz,
        );

        const typeFilter = type
            ? `AND ${EventColumnMappings.type} = '${type}'`
            : "";
        const filterSql = eventFilterSql(filters);

        const sql = `
            SELECT ${EventColumnMappings.name} AS name,
                   ${EventColumnMappings.type} AS type,
                   SUM(_sample_interval) AS count,
                   SUM(_sample_interval * ${EventColumnMappings.value}) AS value
            FROM ${this.dataset}
            WHERE timestamp >= ${startIntervalSql}
              AND timestamp < ${endIntervalSql}
              AND ${EventColumnMappings.siteId} = '${siteId}'
              ${typeFilter}
              ${filterSql}
            GROUP BY name, type
            ORDER BY count DESC
            LIMIT ${limit}
        `;

        const response = await this.query(sql);
        if (!response.ok) return [];

        const body = (await response.json()) as {
            data?: {
                name: string;
                type: string;
                count: string;
                value: string;
            }[];
        };

        return (body.data ?? []).map((row) => [
            row.name,
            Number(row.count) || 0,
            Number(row.value) || 0,
            row.type,
        ]);
    }

    /**
     * Aggregated conversion/event contexts for drill-down reports.
     *
     * Analytics Engine is intentionally aggregate-only. A row represents a
     * unique reporting context, not a person or an individual order, so the
     * API can expose useful attribution without creating a visitor log.
     */
    async getEventBreakdown(
        siteId: string,
        interval: string,
        tz?: string,
        type?: "conversion" | "event",
        limit = 500,
        filters: EventFilters = {},
    ): Promise<EventBreakdownRow[]> {
        const { startIntervalSql, endIntervalSql } = intervalToSql(
            interval,
            tz,
        );
        const typeFilter = type
            ? `AND ${EventColumnMappings.type} = '${type}'`
            : "";
        const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
        const filterSql = eventFilterSql(filters);

        const sql = `
            SELECT ${EventColumnMappings.name} AS name,
                   ${EventColumnMappings.type} AS type,
                   ${EventColumnMappings.path} AS path,
                   ${EventColumnMappings.label} AS label,
                   ${EventColumnMappings.channel} AS channel,
                   ${EventColumnMappings.referrerHost} AS referrerHost,
                   ${EventColumnMappings.utmSource} AS utmSource,
                   ${EventColumnMappings.utmMedium} AS utmMedium,
                   ${EventColumnMappings.utmCampaign} AS utmCampaign,
                   ${EventColumnMappings.country} AS country,
                   ${EventColumnMappings.currency} AS currency,
                   SUM(_sample_interval) AS count,
                   SUM(_sample_interval * ${EventColumnMappings.value}) AS value
            FROM ${this.dataset}
            WHERE timestamp >= ${startIntervalSql}
              AND timestamp < ${endIntervalSql}
              AND ${EventColumnMappings.siteId} = '${siteId}'
              ${typeFilter}
              ${filterSql}
            GROUP BY name, type, path, label, channel, referrerHost,
                     utmSource, utmMedium, utmCampaign, country, currency
            ORDER BY count DESC
            LIMIT ${safeLimit}
        `;

        const response = await this.query(sql);
        if (!response.ok) return [];

        const body = (await response.json()) as {
            data?: Record<string, string>[];
        };

        return (body.data ?? []).map((row) => ({
            name: row.name || "",
            type: row.type || "event",
            path: row.path || "",
            label: row.label || "",
            channel: row.channel || "",
            referrerHost: row.referrerHost || "",
            utmSource: row.utmSource || "",
            utmMedium: row.utmMedium || "",
            utmCampaign: row.utmCampaign || "",
            country: row.country || "",
            currency: row.currency || "",
            count: Number(row.count) || 0,
            value: Number(row.value) || 0,
        }));
    }

    /**
     * Average engaged seconds per page.
     *
     * Engagement is a separate event fired when a page is hidden, so it lives
     * in the events dataset and is joined to pages by path. Pages viewed
     * before engagement tracking shipped simply have no entry.
     */
    async getDurationByPath(
        siteId: string,
        interval: string,
        tz?: string,
        limit = 200,
    ): Promise<Map<string, { avgSeconds: number; samples: number }>> {
        const { startIntervalSql, endIntervalSql } = intervalToSql(
            interval,
            tz,
        );

        const sql = `
            SELECT ${EventColumnMappings.path} AS path,
                   SUM(_sample_interval * ${EventColumnMappings.value}) AS total,
                   SUM(_sample_interval) AS samples
            FROM ${this.dataset}
            WHERE timestamp >= ${startIntervalSql}
              AND timestamp < ${endIntervalSql}
              AND ${EventColumnMappings.siteId} = '${siteId}'
              AND ${EventColumnMappings.name} = 'duration'
            GROUP BY path
            ORDER BY samples DESC
            LIMIT ${limit}
        `;

        const out = new Map<string, { avgSeconds: number; samples: number }>();

        const response = await this.query(sql);
        if (!response.ok) return out;

        const body = (await response.json()) as {
            data?: { path: string; total: string; samples: string }[];
        };

        for (const row of body.data ?? []) {
            const samples = Number(row.samples) || 0;
            if (!samples) continue;
            out.set(row.path, {
                avgSeconds: (Number(row.total) || 0) / samples,
                samples,
            });
        }

        return out;
    }
}

function eventFilterSql(filters: EventFilters): string {
    const mappings: Record<keyof EventFilters, string> = {
        path: EventColumnMappings.path,
        channel: EventColumnMappings.channel,
        country: EventColumnMappings.country,
        referrerHost: EventColumnMappings.referrerHost,
        utmSource: EventColumnMappings.utmSource,
        utmMedium: EventColumnMappings.utmMedium,
        utmCampaign: EventColumnMappings.utmCampaign,
    };

    return (Object.keys(mappings) as (keyof EventFilters)[])
        .filter((key) => filters[key])
        .map(
            (key) =>
                `AND ${mappings[key]} = '${String(filters[key]).replaceAll("'", "''")}'`,
        )
        .join("\n");
}
