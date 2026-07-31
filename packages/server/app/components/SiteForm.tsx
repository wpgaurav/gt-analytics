import { Form, Link } from "react-router";

import type { Site } from "~/sites/sites";

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

    const enabled =
        values.enabled !== undefined
            ? values.enabled === "on"
            : site
              ? site.enabled === 1
              : true;

    return (
        <Form method="post" className="stack-md">
            <div className="card">
                <div className="card-head">
                    <h2>Site</h2>
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

                    <div className="field-row field-row--2">
                        <div className="field">
                            <label htmlFor="base_url">Site URL</label>
                            <input
                                id="base_url"
                                name="base_url"
                                type="url"
                                className="input"
                                defaultValue={value("base_url")}
                                aria-invalid={errors.base_url ? true : undefined}
                                aria-describedby="base_url-hint"
                                placeholder="https://gauravtiwari.org"
                            />
                            <span className="field-hint" id="base_url-hint">
                                Optional. Recorded paths become clickable links
                                against this origin. No trailing slash.
                            </span>
                            {errors.base_url && (
                                <span className="field-error">
                                    {errors.base_url}
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

                    <div className="field-check">
                        <input
                            id="enabled"
                            name="enabled"
                            type="checkbox"
                            defaultChecked={enabled}
                        />
                        <label htmlFor="enabled">
                            Enabled
                            <span className="field-hint">
                                Turning this off hides the site from the
                                dashboard picker. Hits are still recorded and
                                nothing already stored is lost.
                            </span>
                        </label>
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
