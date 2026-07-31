/**
 * Real-time state for one site.
 *
 * Analytics Engine cannot answer "who is on the site right now": it has
 * 20-60 seconds of ingestion lag, and the query layer deliberately excludes
 * the current five-minute bucket to avoid showing a half-filled one. Polling
 * it harder would not fix either problem, only the cost.
 *
 * So the collector also fans each hit out to this Durable Object, which keeps
 * a small rolling window in memory and answers snapshots instantly.
 *
 * Nothing here is persisted to Durable Object storage. The whole window is
 * worthless after thirty minutes, and writing it would add cost and latency
 * for data with no archival value -- Analytics Engine is the system of record.
 * If the object is evicted, the window simply refills within seconds.
 *
 * NOTE ON LOCAL DEVELOPMENT: `pnpm dev` (react-router dev) cannot run this.
 * Its cloudflareDevProxy proxies bindings via getPlatformProxy but does not
 * execute the Worker script, so the class is not registered and every call
 * fails with "no such actor class". The realtime page degrades to "no data"
 * rather than erroring. Use `pnpm preview` (wrangler dev), which runs the real
 * Worker, to exercise this locally.
 */

/** Buckets kept for the activity sparkline. */
const WINDOW_MINUTES = 30;

/** How far back someone counts as "active". */
const ACTIVE_MINUTES = 5;

/** Entries in the live feed. */
const FEED_LIMIT = 50;

/**
 * Ceiling on distinct visitors tracked per minute. Above this the count is
 * reported as at-least rather than growing without bound -- a runaway bot
 * must not be able to exhaust the object's memory.
 */
const VISITORS_PER_MINUTE_CAP = 20_000;

export interface RealtimeHit {
    siteId: string;
    /** Pseudonymous, in-memory only. See collect.ts for how it is derived. */
    visitor: string;
    path?: string;
    channel?: string;
    referrerHost?: string;
    country?: string;
    /** "pageview" | "conversion" | "event" */
    kind?: string;
    name?: string;
}

interface MinuteBucket {
    minute: number;
    views: number;
    conversions: number;
    visitors: Set<string>;
    paths: Map<string, number>;
    channels: Map<string, number>;
    countries: Map<string, number>;
    referrers: Map<string, number>;
}

export interface RealtimeSnapshot {
    /** Distinct visitors seen in the last ACTIVE_MINUTES. */
    activeVisitors: number;
    viewsLastMinute: number;
    viewsInWindow: number;
    conversionsInWindow: number;
    /** Oldest-first, one entry per minute, for the sparkline. */
    perMinute: { minute: number; views: number; visitors: number }[];
    topPaths: [string, number][];
    topChannels: [string, number][];
    topReferrers: [string, number][];
    topCountries: [string, number][];
    feed: {
        t: number;
        path?: string;
        channel?: string;
        referrerHost?: string;
        country?: string;
        kind?: string;
        name?: string;
    }[];
    /** Server clock, so the client can show drift-free relative times. */
    now: number;
}

export class RealtimeSite {
    private buckets = new Map<number, MinuteBucket>();
    private feed: RealtimeSnapshot["feed"] = [];

    // `state` is required by the Durable Object contract even though this
    // object keeps everything in memory.
    constructor(
        _state: DurableObjectState,
        _env: unknown,
    ) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname === "/hit") {
            const hit = (await request.json()) as RealtimeHit;
            this.record(hit);
            return new Response(null, { status: 204 });
        }

        if (url.pathname === "/snapshot") {
            return Response.json(this.snapshot());
        }

        return new Response("Not found", { status: 404 });
    }

    private record(hit: RealtimeHit) {
        const now = Date.now();
        const minute = Math.floor(now / 60_000);
        this.prune(minute);

        let bucket = this.buckets.get(minute);
        if (!bucket) {
            bucket = {
                minute,
                views: 0,
                conversions: 0,
                visitors: new Set(),
                paths: new Map(),
                channels: new Map(),
                countries: new Map(),
                referrers: new Map(),
            };
            this.buckets.set(minute, bucket);
        }

        const isConversion = hit.kind === "conversion";

        if (isConversion) {
            bucket.conversions += 1;
        } else {
            bucket.views += 1;
            if (hit.path) bump(bucket.paths, hit.path);
        }

        if (hit.visitor && bucket.visitors.size < VISITORS_PER_MINUTE_CAP) {
            bucket.visitors.add(hit.visitor);
        }
        if (hit.channel) bump(bucket.channels, hit.channel);
        if (hit.country) bump(bucket.countries, hit.country);
        if (hit.referrerHost) bump(bucket.referrers, hit.referrerHost);

        this.feed.unshift({
            t: now,
            path: hit.path,
            channel: hit.channel,
            referrerHost: hit.referrerHost,
            country: hit.country,
            kind: hit.kind,
            name: hit.name,
        });
        if (this.feed.length > FEED_LIMIT) this.feed.length = FEED_LIMIT;
    }

    private prune(currentMinute: number) {
        const oldest = currentMinute - WINDOW_MINUTES + 1;
        for (const minute of this.buckets.keys()) {
            if (minute < oldest) this.buckets.delete(minute);
        }
    }

    private snapshot(): RealtimeSnapshot {
        const now = Date.now();
        const currentMinute = Math.floor(now / 60_000);
        this.prune(currentMinute);

        const activeFrom = currentMinute - ACTIVE_MINUTES + 1;
        const activeVisitors = new Set<string>();

        const paths = new Map<string, number>();
        const channels = new Map<string, number>();
        const countries = new Map<string, number>();
        const referrers = new Map<string, number>();

        let viewsInWindow = 0;
        let conversionsInWindow = 0;

        for (const bucket of this.buckets.values()) {
            viewsInWindow += bucket.views;
            conversionsInWindow += bucket.conversions;
            merge(paths, bucket.paths);
            merge(channels, bucket.channels);
            merge(countries, bucket.countries);
            merge(referrers, bucket.referrers);

            if (bucket.minute >= activeFrom) {
                for (const visitor of bucket.visitors) {
                    activeVisitors.add(visitor);
                }
            }
        }

        // Emit every minute in the window, including empty ones, so the
        // sparkline shows real gaps instead of silently compressing them.
        const perMinute: RealtimeSnapshot["perMinute"] = [];
        for (
            let minute = currentMinute - WINDOW_MINUTES + 1;
            minute <= currentMinute;
            minute++
        ) {
            const bucket = this.buckets.get(minute);
            perMinute.push({
                minute,
                views: bucket?.views ?? 0,
                visitors: bucket?.visitors.size ?? 0,
            });
        }

        return {
            activeVisitors: activeVisitors.size,
            viewsLastMinute: this.buckets.get(currentMinute)?.views ?? 0,
            viewsInWindow,
            conversionsInWindow,
            perMinute,
            topPaths: top(paths),
            topChannels: top(channels),
            topReferrers: top(referrers),
            topCountries: top(countries),
            feed: this.feed.slice(0, FEED_LIMIT),
            now,
        };
    }
}

function bump(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) ?? 0) + 1);
}

function merge(into: Map<string, number>, from: Map<string, number>) {
    for (const [key, count] of from) {
        into.set(key, (into.get(key) ?? 0) + count);
    }
}

function top(map: Map<string, number>, limit = 8): [string, number][] {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
