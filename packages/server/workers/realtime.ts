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
 * The short window is checkpointed to Durable Object storage so routine idle
 * eviction and deploys do not make current traffic disappear. Analytics
 * Engine remains the historical system of record.
 *
 * NOTE ON LOCAL DEVELOPMENT: `pnpm dev` (react-router dev) cannot run this.
 * Its cloudflareDevProxy proxies bindings via getPlatformProxy but does not
 * execute the Worker script, so the class is not registered and every call
 * fails with "no such actor class". `wrangler dev --remote` cannot run it
 * either -- Cloudflare dropped remote-mode support for Durable Objects, and
 * every snapshot comes back as "unavailable", which looks exactly like a
 * production fault. Use plain `wrangler dev` (`pnpm preview`), which runs the
 * real Worker locally.
 */

/** Buckets kept for the activity sparkline. */
const WINDOW_MINUTES = 30;

/** Heartbeats arrive every 30 seconds; tolerate three missed beats. */
const ACTIVE_TIMEOUT_MS = 2 * 60_000;

/** Entries in the live feed. */
const FEED_LIMIT = 50;

/** How often the window is written to storage, at most. */
const SAVE_INTERVAL_MS = 1000;

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

/** The window as it is written to storage: Sets and Maps flattened to arrays. */
interface StoredWindow {
    buckets: {
        minute: number;
        views: number;
        conversions: number;
        events?: number;
        visitors: string[];
        paths: [string, number][];
        channels: [string, number][];
        countries: [string, number][];
        referrers: [string, number][];
    }[];
    feed: RealtimeSnapshot["feed"];
    presence?: [string, Presence][];
}

interface MinuteBucket {
    minute: number;
    views: number;
    conversions: number;
    events: number;
    visitors: Set<string>;
    paths: Map<string, number>;
    channels: Map<string, number>;
    countries: Map<string, number>;
    referrers: Map<string, number>;
}

interface Presence {
    seenAt: number;
    path?: string;
    country?: string;
}

export interface RealtimeSnapshot {
    /** Distinct visible visitors inside the heartbeat tolerance window. */
    activeVisitors: number;
    viewsLastMinute: number;
    viewsInWindow: number;
    conversionsInWindow: number;
    eventsInWindow: number;
    /** Oldest-first, one entry per minute, for the sparkline. */
    perMinute: { minute: number; views: number; visitors: number }[];
    topPaths: [string, number][];
    /** Distinct visible visitors by their latest page. */
    activePages: [string, number][];
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
    private presence = new Map<string, Presence>();
    private state: DurableObjectState;
    private lastSave = 0;
    private ready: Promise<void>;

    constructor(state: DurableObjectState, _env: unknown) {
        this.state = state;

        // Restore before any request is served. A snapshot arriving in the
        // same instant as construction would otherwise answer from an empty
        // window and report nobody on a site that has visitors.
        //
        // Held as a promise and awaited in fetch as well as passed to
        // blockConcurrencyWhile: the runtime guarantee is the real mechanism,
        // but depending on it alone makes the object silently wrong anywhere
        // it is not honoured, and the failure looks like missing traffic
        // rather than a broken contract.
        this.ready = this.restore();
        state.blockConcurrencyWhile(() => this.ready);
    }

    async fetch(request: Request): Promise<Response> {
        await this.ready;
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname === "/hit") {
            const hit = (await request.json()) as RealtimeHit;
            this.record(hit);
            await this.persist();
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

        const kind = hit.kind || "pageview";
        const isPageview = kind === "pageview";
        const isPresence = kind === "presence";
        const isConversion = kind === "conversion";
        const isEvent = kind === "event";

        // Presence is exact latest state, not another view. Pageviews seed it
        // immediately; visible-tab heartbeats keep it fresh during long reads.
        if (hit.visitor && (isPageview || isPresence)) {
            this.presence.set(hit.visitor, {
                seenAt: now,
                path: hit.path,
                country: hit.country,
            });
        }

        if (isPresence) return;

        let bucket = this.buckets.get(minute);
        if (!bucket) {
            bucket = {
                minute,
                views: 0,
                conversions: 0,
                events: 0,
                visitors: new Set(),
                paths: new Map(),
                channels: new Map(),
                countries: new Map(),
                referrers: new Map(),
            };
            this.buckets.set(minute, bucket);
        }

        if (isConversion) {
            bucket.conversions += 1;
        } else if (isEvent) {
            bucket.events += 1;
        } else if (isPageview) {
            bucket.views += 1;
            if (hit.path) bump(bucket.paths, hit.path);
        }

        if (
            isPageview &&
            hit.visitor &&
            bucket.visitors.size < VISITORS_PER_MINUTE_CAP
        ) {
            bucket.visitors.add(hit.visitor);
        }
        // Traffic breakdowns describe pageviews, not conversions or custom
        // events. Mixing duration events into these maps inflated every live
        // total and made the top-page table disagree with historical reports.
        if (isPageview) {
            if (hit.channel) bump(bucket.channels, hit.channel);
            if (hit.country) bump(bucket.countries, hit.country);
            if (hit.referrerHost) bump(bucket.referrers, hit.referrerHost);
        }

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

    /**
     * Writes the window to storage so it survives eviction.
     *
     * This object was originally memory-only, on the reasoning that a
     * thirty-minute window has no archival value. That is true, but it assumed
     * eviction was rare. It is not: a Durable Object with no storage and no
     * alarm is evicted once it goes idle, and a site receiving roughly a hit a
     * minute is idle most of the time. The window was being lost between one
     * visit and the next, so the dashboard showed nobody on a site that had
     * just been visited. Deploys had the same effect, since they restart every
     * object.
     *
     * Rate-limited to one write a second so a burst cannot turn a write per
     * hit into the bottleneck, with an alarm guaranteeing the trailing write.
     * Skipping the write outright would drop exactly the newest state -- three
     * hits in one second persisted only the first, because the other two were
     * inside the window and nothing ever came back for them. An alarm is
     * durable and survives eviction, which a timer would not.
     */
    private async persist() {
        const now = Date.now();

        if (now - this.lastSave < SAVE_INTERVAL_MS) {
            try {
                if ((await this.state.storage.getAlarm()) === null) {
                    await this.state.storage.setAlarm(
                        this.lastSave + SAVE_INTERVAL_MS,
                    );
                }
            } catch (error) {
                console.error("realtime alarm failed", error);
            }
            return;
        }

        await this.write();
    }

    /** Alarm handler: the trailing write after a throttled burst. */
    async alarm() {
        await this.ready;
        await this.write();
    }

    private async write() {
        this.lastSave = Date.now();

        try {
            await this.state.storage.put("window", {
                buckets: [...this.buckets.values()].map((bucket) => ({
                    minute: bucket.minute,
                    views: bucket.views,
                    conversions: bucket.conversions,
                    events: bucket.events,
                    // Sets and Maps do not survive structured storage in a
                    // form that round-trips, so they go as arrays.
                    visitors: [...bucket.visitors],
                    paths: [...bucket.paths],
                    channels: [...bucket.channels],
                    countries: [...bucket.countries],
                    referrers: [...bucket.referrers],
                })),
                feed: this.feed,
                presence: [...this.presence],
            });
        } catch (error) {
            // Real-time is a convenience view. A storage failure must not turn
            // a hit into an error the collector has to handle.
            console.error("realtime persist failed", error);
        }
    }

    private async restore() {
        try {
            const saved = await this.state.storage.get<StoredWindow>("window");
            if (!saved) return;

            for (const bucket of saved.buckets ?? []) {
                this.buckets.set(bucket.minute, {
                    minute: bucket.minute,
                    views: bucket.views,
                    conversions: bucket.conversions,
                    events: bucket.events ?? 0,
                    visitors: new Set(bucket.visitors),
                    paths: new Map(bucket.paths),
                    channels: new Map(bucket.channels),
                    countries: new Map(bucket.countries),
                    referrers: new Map(bucket.referrers),
                });
            }
            this.feed = saved.feed ?? [];
            this.presence = new Map(saved.presence ?? []);

            // The object may have been evicted for longer than the window is
            // wide, in which case everything restored is already expired.
            this.prune(Math.floor(Date.now() / 60_000));
        } catch (error) {
            console.error("realtime restore failed", error);
        }
    }

    private prune(currentMinute: number) {
        const oldest = currentMinute - WINDOW_MINUTES + 1;
        for (const minute of this.buckets.keys()) {
            if (minute < oldest) this.buckets.delete(minute);
        }

        const activeCutoff = Date.now() - ACTIVE_TIMEOUT_MS;
        for (const [visitor, current] of this.presence) {
            if (current.seenAt < activeCutoff) this.presence.delete(visitor);
        }
    }

    private snapshot(): RealtimeSnapshot {
        const now = Date.now();
        const currentMinute = Math.floor(now / 60_000);
        this.prune(currentMinute);

        const paths = new Map<string, number>();
        const activePages = new Map<string, number>();
        const channels = new Map<string, number>();
        const countries = new Map<string, number>();
        const referrers = new Map<string, number>();

        let viewsInWindow = 0;
        let conversionsInWindow = 0;
        let eventsInWindow = 0;

        for (const bucket of this.buckets.values()) {
            viewsInWindow += bucket.views;
            conversionsInWindow += bucket.conversions;
            eventsInWindow += bucket.events;
            merge(paths, bucket.paths);
            merge(channels, bucket.channels);
            merge(countries, bucket.countries);
            merge(referrers, bucket.referrers);
        }

        for (const current of this.presence.values()) {
            if (current.path) bump(activePages, current.path);
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
            activeVisitors: this.presence.size,
            viewsLastMinute: this.buckets.get(currentMinute)?.views ?? 0,
            viewsInWindow,
            conversionsInWindow,
            eventsInWindow,
            perMinute,
            topPaths: top(paths),
            activePages: top(activePages),
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
