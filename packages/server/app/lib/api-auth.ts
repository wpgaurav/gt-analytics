import { getUser, isAuthEnabled } from "./auth";

/**
 * Authentication for JSON API routes (`/resources/*`, `/api/*`).
 *
 * This differs from `requireAuth` in two ways that matter:
 *
 *  1. It accepts a bearer token as well as the browser session cookie, so
 *     machine callers (the WordPress admin widget, scripts) can read the API
 *     without holding a JWT cookie.
 *  2. It throws a 401 rather than a redirect to `/`. A redirect answers an
 *     XHR with a 200 and a login page, which a JSON caller cannot distinguish
 *     from real data.
 */
export async function requireApiAuth(request: Request, env: Env) {
    // Auth disabled deployment-wide: everything is public by choice.
    if (!isAuthEnabled(env)) {
        return { authenticated: true as const, via: "disabled" as const };
    }

    const header = request.headers.get("Authorization");
    if (header?.startsWith("Bearer ")) {
        const presented = header.slice("Bearer ".length).trim();
        if (env.CF_API_TOKEN && constantTimeEqual(presented, env.CF_API_TOKEN)) {
            return { authenticated: true as const, via: "bearer" as const };
        }
        // A bearer token was offered and it was wrong. Do not fall through to
        // the cookie check -- that would let a bad token probe be answered by
        // an unrelated valid session.
        throw unauthorized();
    }

    const user = await getUser(request, env);
    if (!user.authenticated) {
        throw unauthorized();
    }

    return { authenticated: true as const, via: "cookie" as const };
}

function unauthorized() {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: {
            "content-type": "application/json",
            "WWW-Authenticate": 'Bearer realm="gt-analytics"',
        },
    });
}

/**
 * Compares two strings without leaking, through timing, how many leading
 * characters matched. Length is not hidden -- that is standard for token
 * comparison and not worth the complexity of hashing first.
 */
export function constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const left = encoder.encode(a);
    const right = encoder.encode(b);

    if (left.length !== right.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < left.length; i++) {
        diff |= left[i] ^ right[i];
    }
    return diff === 0;
}
