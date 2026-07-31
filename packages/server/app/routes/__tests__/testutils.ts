import { AnalyticsEngineAPI } from "../../analytics/query";
import { HistoryAPI } from "../../analytics/history";

export function createFetchResponse<T>(data: T) {
    return {
        ok: true,
        json: () => new Promise<T>((resolve) => resolve(data)),
    };
}

export function getDefaultContext() {
    const analyticsEngine = new AnalyticsEngineAPI(
        "testAccountId",
        "testApiToken",
    );

    return {
        context: {
            analyticsEngine,
            // No R2 bucket and no sites database, so every range routes to
            // Analytics Engine and reaches the same mocked fetch. Tests that
            // care about archive behaviour construct their own HistoryAPI with
            // a stub bucket.
            history: new HistoryAPI(analyticsEngine, undefined),
            cloudflare: {
                env: {
                    CF_BEARER_TOKEN: "fake",
                    CF_ACCOUNT_ID: "fake",
                    CF_PASSWORD_HASH: "$2b$12$test.hash.value",
                    CF_JWT_SECRET: "test-secret",
                },
                // eslint-disable-next-line
                cf: {} as any,
            },
        },
    };
}
