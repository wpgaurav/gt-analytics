import { getFiltersFromSearchParams } from "./utils";

const NAMED_INTERVALS = new Set(["today", "yesterday", "1d", "7d", "30d", "90d", "180d", "365d"]);

export function readApiQuery(request: Request) {
    const url = new URL(request.url);
    const site = url.searchParams.get("site") || "";
    const interval = url.searchParams.get("interval") || "7d";
    const timezone = url.searchParams.get("timezone") || "UTC";
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 20));
    if (!site) throw badRequest("site is required");
    if (!validInterval(interval)) throw badRequest("interval is invalid");
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw badRequest("timezone must be an IANA timezone"); }
    const filters = getFiltersFromSearchParams(url.searchParams);
    for (const value of Object.values(filters)) {
        if (value.length > 500 || value.includes("'") || [...value].some((character) => character.charCodeAt(0) < 32)) {
            throw badRequest("filter value is invalid");
        }
    }
    return { site, interval, timezone, limit, filters };
}

function validInterval(value: string): boolean {
    if (NAMED_INTERVALS.has(value)) return true;
    const match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value);
    if (!match) return false;
    const start = Date.parse(`${match[1]}T00:00:00Z`);
    const end = Date.parse(`${match[2]}T00:00:00Z`);
    return Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start <= 366 * 86400000;
}

function badRequest(message: string) {
    return new Response(JSON.stringify({ error: "invalid_request", message }), {
        status: 400,
        headers: { "content-type": "application/json" },
    });
}

export function apiJson(data: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return Response.json(data, { ...init, headers });
}
