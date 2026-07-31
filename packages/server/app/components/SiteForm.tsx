import { Form, Link } from "react-router";

import type { Site } from "~/content/sites";

export interface SiteFormProps {
    /** Existing site when editing; omitted when creating. */
    site?: Site;
    errors?: Record<string, string>;
    /** Values to repopulate after a failed submit. */
    values?: Record<string, string>;
    busy?: boolean;
}

/**
 * The add/edit form for a tracked site, shared by both routes so the two can
 * never drift apart in validation or field set.
 */
export default function SiteForm({
    site,
    errors = {},
    values = {},
    busy = false,
}: SiteFormProps) {
    const isEdit = Boolean(site);

    // Prefer a rejected submission's values so the user does not lose typing,
    // then the stored record, then empty.
    const value = (name: keyof Site, fallback = "") =>
        values[name] ?? (site?.[name] as string | null) ?? fallback;

    const checked = (name: "enabled" | "wp_sync_enabled") => {
        if (values[name] !== undefined) return values[name] === "on";
        if (site) return site[name] === 1;
        return true;
    };

    return (
        <Form method="post" className="stack-md">
            <div className="card">
                <div className="card-head">
                    <h2>Identity</h2>
                </div>
                <div className="card-body">
                    <div className="field">
                        <label htmlFor="site_id">Site ID</label>
                        <input
                            id="site_id"
                            name="site_id"
                            type="text"
                            className="input mono"
                            defaultValue={value("site_id")}
                            readOnly={isEdit}
                            aria-invalid={errors.site_id ? true : undefined}
                            aria-describedby="site_id-hint"
                            placeholder="gauravtiwari.org"
                            autoComplete="off"
                        />
                        <span className="field-hint" id="site_id-hint">
                            {isEdit
                                ? "Fixed after creation. Changing it would orphan every hit already recorded under this ID."
                                : "Must match data-site-id on the tracking snippet exactly. The domain is the usual choice."}
                        </span>
                        {errors.site_id && (
                            <span className="field-error">{errors.site_id}</span>
                        )}
                    </div>

                    <div className="field">
                        <label htmlFor="label">Display name</label>
                        <input
                            id="label"
                            name="label"
                            type="text"
                            className="input"
                            defaultValue={value("label")}
                            aria-invalid={errors.label ? true : undefined}
                            placeholder="Gaurav Tiwari"
                        />
                        {errors.label && (
                            <span className="field-error">{errors.label}</span>
                        )}
                    </div>

                    <div className="field-check">
                        <input
                            id="enabled"
                            name="enabled"
                            type="checkbox"
                            defaultChecked={checked("enabled")}
                        />
                        <label htmlFor="enabled">
                            Enabled
                            <span className="field-hint">
                                Turning this off stops scheduled syncing and
                                post-ID enrichment. Pageviews are still
                                recorded, and nothing already stored is lost.
                            </span>
                        </label>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-head">
                    <h2>WordPress</h2>
                </div>
                <div className="card-body">
                    <div className="field-check">
                        <input
                            id="wp_sync_enabled"
                            name="wp_sync_enabled"
                            type="checkbox"
                            defaultChecked={checked("wp_sync_enabled")}
                        />
                        <label htmlFor="wp_sync_enabled">
                            Sync content from WordPress
                            <span className="field-hint">
                                Reads the public REST API hourly to map URL
                                paths to post IDs. No plugin and no credentials
                                are needed. Turn this off for non-WordPress
                                properties, which still get path analytics.
                            </span>
                        </label>
                    </div>

                    <div className="field">
                        <label htmlFor="wp_base_url">Site URL</label>
                        <input
                            id="wp_base_url"
                            name="wp_base_url"
                            type="url"
                            className="input"
                            defaultValue={value("wp_base_url")}
                            aria-invalid={errors.wp_base_url ? true : undefined}
                            aria-describedby="wp_base_url-hint"
                            placeholder="https://gauravtiwari.org"
                        />
                        <span className="field-hint" id="wp_base_url-hint">
                            No trailing slash. The REST API is read at{" "}
                            <span className="mono">/wp-json/wp/v2/</span>.
                        </span>
                        {errors.wp_base_url && (
                            <span className="field-error">
                                {errors.wp_base_url}
                            </span>
                        )}
                    </div>

                    <div className="field-row field-row--2">
                        <div className="field">
                            <label htmlFor="wp_admin_url">
                                Admin URL (optional)
                            </label>
                            <input
                                id="wp_admin_url"
                                name="wp_admin_url"
                                type="url"
                                className="input"
                                defaultValue={value("wp_admin_url")}
                                aria-invalid={
                                    errors.wp_admin_url ? true : undefined
                                }
                                placeholder="https://gauravtiwari.org/wp-admin"
                            />
                            <span className="field-hint">
                                Used for edit links in reports. Defaults to the
                                site URL plus /wp-admin.
                            </span>
                            {errors.wp_admin_url && (
                                <span className="field-error">
                                    {errors.wp_admin_url}
                                </span>
                            )}
                        </div>

                        <div className="field">
                            <label htmlFor="timezone">Reporting timezone</label>
                            <input
                                id="timezone"
                                name="timezone"
                                type="text"
                                className="input"
                                defaultValue={value("timezone", "UTC")}
                                placeholder="Asia/Kolkata"
                            />
                            <span className="field-hint">
                                An IANA name, e.g. Asia/Kolkata. Used to bucket
                                days in reports.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="app-actions">
                <button
                    className="btn btn-primary"
                    name="intent"
                    value="save"
                    disabled={busy}
                >
                    {busy ? "Saving…" : isEdit ? "Save changes" : "Add site"}
                </button>
                <Link className="btn btn-ghost" to="/admin/sites">
                    Cancel
                </Link>
            </div>
        </Form>
    );
}
