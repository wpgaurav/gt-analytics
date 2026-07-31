import { EventColumnMappings } from "./events";
import { intervalToSql } from "./query";

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
    ): Promise<
        [name: string, count: number, value: number, type: string][]
    > {
        const { startIntervalSql, endIntervalSql } = intervalToSql(
            interval,
            tz,
        );

        const typeFilter = type
            ? `AND ${EventColumnMappings.type} = '${type}'`
            : "";

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
