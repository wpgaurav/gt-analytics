import type { SiteInput } from "./sites";

/**
 * Turns an admin form submission into a SiteInput, plus the raw values so a
 * rejected submit can repopulate the form instead of throwing away typing.
 *
 * Shared by the create and edit routes so their parsing cannot drift.
 */
export function formToSiteInput(form: FormData): {
    input: SiteInput;
    values: Record<string, string>;
} {
    const text = (name: string) => String(form.get(name) ?? "").trim();

    // An unchecked checkbox submits nothing at all, which is what makes
    // "absent" mean false here.
    const enabled = form.get("enabled") !== null;
    const wpSyncEnabled = form.get("wp_sync_enabled") !== null;

    const input: SiteInput = {
        site_id: text("site_id"),
        label: text("label"),
        wp_base_url: text("wp_base_url") || null,
        wp_admin_url: text("wp_admin_url") || null,
        timezone: text("timezone") || "UTC",
        enabled,
        wp_sync_enabled: wpSyncEnabled,
    };

    const values: Record<string, string> = {
        site_id: input.site_id,
        label: input.label,
        wp_base_url: input.wp_base_url ?? "",
        wp_admin_url: input.wp_admin_url ?? "",
        timezone: input.timezone ?? "UTC",
    };
    if (enabled) values.enabled = "on";
    if (wpSyncEnabled) values.wp_sync_enabled = "on";

    return { input, values };
}
