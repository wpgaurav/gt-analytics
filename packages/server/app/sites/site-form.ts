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

    const input: SiteInput = {
        site_id: text("site_id"),
        label: text("label"),
        base_url: text("base_url") || null,
        timezone: text("timezone") || "UTC",
        enabled,
    };

    const values: Record<string, string> = {
        site_id: input.site_id,
        label: input.label,
        base_url: input.base_url ?? "",
        timezone: input.timezone ?? "UTC",
    };
    if (enabled) values.enabled = "on";

    return { input, values };
}
