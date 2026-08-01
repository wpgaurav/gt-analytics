import { DEFAULT_ACCOUNT_ID } from "~/accounts/accounts";
import { authenticateApiKey, type ApiScope } from "~/accounts/api-keys";
import { accountOwnsSite } from "~/sites/sites";
import { getUser, isAuthEnabled } from "./auth";

export interface ApiPrincipal {
    authenticated: true;
    accountId: string;
    via: "disabled" | "legacy-bearer" | "api-key" | "cookie";
    scopes: ApiScope[];
    userId?: string;
}

export async function requireApiAuth(
    request: Request,
    env: Env,
    requiredScope?: ApiScope,
): Promise<ApiPrincipal> {
    let principal: ApiPrincipal;
    if (!isAuthEnabled(env)) {
        principal = fullAccess(DEFAULT_ACCOUNT_ID, "disabled");
    } else {
        const header = request.headers.get("Authorization");
        if (header?.startsWith("Bearer ")) {
            const presented = header.slice("Bearer ".length).trim();
            if (env.CF_API_TOKEN && constantTimeEqual(presented, env.CF_API_TOKEN)) {
                principal = fullAccess(DEFAULT_ACCOUNT_ID, "legacy-bearer");
            } else if (env.SITES_DB) {
                const key = await authenticateApiKey(env.SITES_DB, presented);
                if (!key) throw unauthorized();
                principal = {
                    authenticated: true,
                    accountId: key.accountId,
                    via: "api-key",
                    scopes: key.scopes,
                };
            } else {
                throw unauthorized();
            }
        } else {
            const user = await getUser(request, env);
            if (!user.authenticated || !user.accountId) throw unauthorized();
            principal = {
                authenticated: true,
                accountId: user.accountId,
                userId: user.userId,
                via: "cookie",
                scopes: ["analytics:read", "realtime:read"],
            };
        }
    }

    if (requiredScope && !principal.scopes.includes(requiredScope)) {
        throw new Response(JSON.stringify({ error: "insufficient_scope", requiredScope }), {
            status: 403,
            headers: { "content-type": "application/json" },
        });
    }

    const siteId = new URL(request.url).searchParams.get("site");
    if (siteId && env.SITES_DB && !(await accountOwnsSite(env.SITES_DB, principal.accountId, siteId))) {
        throw new Response(JSON.stringify({ error: "site_not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
        });
    }
    return principal;
}

function fullAccess(accountId: string, via: ApiPrincipal["via"]): ApiPrincipal {
    return {
        authenticated: true,
        accountId,
        via,
        scopes: ["analytics:read", "realtime:read"],
    };
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

export function constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
    return diff === 0;
}
