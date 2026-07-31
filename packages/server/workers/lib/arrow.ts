/**
 * Nightly rollup: one Arrow file per finished day, in R2.
 *
 * Analytics Engine keeps 90 days and cannot be written to retroactively --
 * `writeDataPoint` has no timestamp field -- so once a day ages out, this file
 * is the only copy of it that will ever exist. That makes the archive the
 * long-term store rather than a backup, and makes what the rollup omits a
 * permanent loss rather than a temporary one.
 */

import { AnalyticsEngineAPI } from "../../app/analytics/query";
import { ARCHIVE_DIMENSIONS } from "../../app/analytics/archive";
import { tableFromJSON, tableToIPC } from "apache-arrow";
import dayjs from "dayjs";

export interface RollupResult {
    filename: string;
    recordCount: number;
    truncated: boolean;
}

/**
 * Archives one day, defaulting to yesterday.
 *
 * Yesterday rather than today because a day is only archived once and a
 * partial day would be frozen in place -- Analytics Engine still holds the
 * live copy of today, so there is nothing to gain by archiving it early.
 */
export async function extractAsArrow(
    {
        accountId,
        bearerToken,
        dataset,
        date,
    }: {
        accountId: string;
        bearerToken: string;
        dataset?: string;
        date?: string;
    },
    bucket: R2Bucket,
): Promise<RollupResult> {
    const api = new AnalyticsEngineAPI(accountId, bearerToken, dataset);
    const day = date || dayjs().subtract(1, "day").format("YYYY-MM-DD");

    const { rows, truncated } = await api.getDailyRollup(
        [...ARCHIVE_DIMENSIONS],
        day,
        day,
    );

    const filename = `analytics-${day}.arrow`;

    if (rows.length === 0) {
        // Writing an empty Arrow file would be worse than writing nothing:
        // tableFromJSON cannot infer a schema from zero records, and a
        // zero-row file is indistinguishable from a day with no traffic.
        console.log(`No data for ${day}; nothing archived.`);
        return { filename, recordCount: 0, truncated: false };
    }

    const table = tableFromJSON(rows);
    await bucket.put(filename, new Uint8Array(tableToIPC(table, "file")));

    if (truncated) {
        console.error(
            `Rollup for ${day} hit the row limit -- the archive for that day is incomplete.`,
        );
    }
    console.log(`Saved ${rows.length} records to ${filename}`);

    return { filename, recordCount: rows.length, truncated };
}
