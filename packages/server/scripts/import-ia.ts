/**
 * Imports Independent Analytics history into the R2 archive.
 *
 * Analytics Engine cannot be backdated -- `writeDataPoint` takes no timestamp
 * -- so history from another tool can only land in the archive. Writing it in
 * exactly the format the nightly rollup produces means the reader, the query
 * router and every report treat imported days and native days identically;
 * there is no "imported data" code path to keep working.
 *
 * Usage:
 *
 *   node scripts/import-ia.ts --input ia-export.tsv --site gauravtiwari.org \
 *     [--out ./ia-arrow] [--upload] [--remote]
 *
 * The input is the TSV produced by the companion query (scripts/import-ia.sql),
 * one row per day and dimension combination.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { tableFromJSON, tableToIPC } from "apache-arrow";

// The real classifier, not a copy of it. A second implementation would drift
// from the collector's and quietly split the same source across two channels.
import { classifyChannel, referrerHost } from "../app/analytics/referrer.ts";

const BUCKET = "counterscale-gauravtiwari-daily-rollups";

/** Columns of the export, in order. */
const COLUMNS = [
    "date",
    "url",
    "entryUrl",
    "referrer",
    "referrerHost",
    "country",
    "browserName",
    "deviceType",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "utmTerm",
    "utmContent",
    "views",
    "visitors",
    "bounces",
] as const;

interface Options {
    input: string;
    site: string;
    out: string;
    upload: boolean;
    remote: boolean;
}

function parseArgs(argv: string[]): Options {
    const get = (flag: string, fallback?: string) => {
        const index = argv.indexOf(flag);
        if (index === -1) return fallback;
        return argv[index + 1];
    };

    const input = get("--input");
    const site = get("--site");
    if (!input || !site) {
        console.error(
            "Usage: node scripts/import-ia.ts --input <tsv> --site <siteId> [--out <dir>] [--upload] [--remote]",
        );
        process.exit(1);
    }

    return {
        input,
        site,
        out: get("--out", "./ia-arrow")!,
        upload: argv.includes("--upload"),
        remote: argv.includes("--remote"),
    };
}

/**
 * A full URL becomes the path the collector would have recorded.
 *
 * Paths have to match what the tracker sends or imported days and native days
 * would report the same page under two different keys and never add up.
 */
export function toPath(url: string): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        // Query strings and fragments are not part of the recorded path.
        return parsed.pathname || "/";
    } catch {
        return url.startsWith("/") ? url : "";
    }
}

/**
 * Independent Analytics stores a source label, not a URL.
 *
 * "Direct" is its word for no referrer; keeping it as a literal referrer would
 * produce a source called Direct sitting alongside real ones.
 */
function normalizeReferrer(referrer: string, host: string): string {
    if (!referrer || referrer.toLowerCase() === "direct") return "";
    if (!host) return "";
    return `https://${host}/`;
}

export function rowsFromTsv(tsv: string, siteId: string) {
    const rows: Record<string, string | number>[] = [];
    let skipped = 0;

    for (const line of tsv.split("\n")) {
        if (!line.trim()) continue;

        const cells = line.split("\t");
        if (cells.length < COLUMNS.length) {
            skipped++;
            continue;
        }

        const raw = Object.fromEntries(
            COLUMNS.map((name, index) => [name, cells[index] ?? ""]),
        ) as Record<string, string>;

        const host = raw.referrerHost.trim();
        const referrer = normalizeReferrer(raw.referrer, host);

        rows.push({
            date: raw.date,
            siteId,
            views: Number(raw.views) || 0,
            visitors: Number(raw.visitors) || 0,
            bounces: Number(raw.bounces) || 0,

            path: toPath(raw.url),
            entryPath: toPath(raw.entryUrl),
            referrer,
            referrerHost: referrerHost(referrer, siteId),
            channel: classifyChannel({
                referrer,
                selfHost: siteId,
                utmMedium: raw.utmMedium,
                utmSource: raw.utmSource,
            }),
            // Independent Analytics does not record ad click IDs, browser
            // versions or device models. Empty is honest; a guess would be
            // indistinguishable from a real reading.
            clickId: "",
            country: raw.country,
            browserName: raw.browserName,
            browserVersion: "",
            deviceType: raw.deviceType,
            deviceModel: "",
            host: siteId,
            utmSource: raw.utmSource,
            utmMedium: raw.utmMedium,
            utmCampaign: raw.utmCampaign,
            utmTerm: raw.utmTerm,
            utmContent: raw.utmContent,
        });
    }

    return { rows, skipped };
}

function main() {
    const options = parseArgs(process.argv.slice(2));

    const { rows, skipped } = rowsFromTsv(
        readFileSync(options.input, "utf8"),
        options.site,
    );
    if (skipped) console.warn(`Skipped ${skipped} malformed rows.`);

    const byDate = new Map<string, Record<string, string | number>[]>();
    for (const row of rows) {
        const date = String(row.date);
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push(row);
    }

    if (!existsSync(options.out)) mkdirSync(options.out, { recursive: true });

    const dates = [...byDate.keys()].sort();
    let totalViews = 0;

    for (const date of dates) {
        const dayRows = byDate.get(date)!;
        totalViews += dayRows.reduce(
            (sum, row) => sum + (row.views as number),
            0,
        );

        const file = join(options.out, `analytics-${date}.arrow`);
        const table = tableFromJSON(dayRows);
        writeFileSync(file, Buffer.from(tableToIPC(table, "file")));

        if (options.upload) {
            execFileSync(
                "pnpm",
                [
                    "exec",
                    "wrangler",
                    "r2",
                    "object",
                    "put",
                    `${BUCKET}/analytics-${date}.arrow`,
                    "--file",
                    file,
                    options.remote ? "--remote" : "--local",
                ],
                { stdio: "inherit" },
            );
        }
    }

    console.log(
        `${dates.length} days, ${rows.length} rows, ${totalViews} views -> ${options.out}` +
            (options.upload ? " (uploaded)" : ""),
    );
    console.log(`Range: ${dates[0]} to ${dates[dates.length - 1]}`);
}

// Only run when invoked directly, so the parsing above stays unit-testable.
if (process.argv[1]?.endsWith("import-ia.ts")) {
    main();
}
