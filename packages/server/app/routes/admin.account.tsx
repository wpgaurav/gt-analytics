import { startRegistration } from "@simplewebauthn/browser";
import bcrypt from "bcryptjs";
import { useState } from "react";
import {
    Form,
    useActionData,
    useLoaderData,
    useNavigation,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
} from "react-router";
import {
    getAccount,
    listAccounts,
    updateAccount,
    validAccountSlug,
} from "~/accounts/accounts";
import {
    createAccountInvitation,
    InvitationConflictError,
    listAccountInvitations,
    regenerateAccountInvitation,
    revokeAccountInvitation,
} from "~/accounts/invitations";
import {
    createApiKey,
    deleteApiKey,
    listApiKeys,
    revokeApiKey,
    scopeApiKeyToSite,
} from "~/accounts/api-keys";
import { deletePasskey, listPasskeys } from "~/accounts/passkeys";
import CopyableSecret from "~/components/CopyableSecret";
import { getUserById, requireAuth } from "~/lib/auth";
import { getSite, listSites } from "~/sites/sites";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);
    const db = context.cloudflare.env.SITES_DB;
    const origin = new URL(request.url).origin;
    const invitations = user.isSystemAdmin
        ? await listAccountInvitations(db, context.cloudflare.env.CF_JWT_SECRET)
        : [];
    return {
        user,
        account: await getAccount(db, user.accountId!),
        sites: await listSites(db, user.accountId!),
        apiKeys: await listApiKeys(db, user.accountId!),
        passkeys: user.userId ? await listPasskeys(db, user.userId) : [],
        accounts: user.isSystemAdmin ? await listAccounts(db) : [],
        invitations: invitations.map(({ token, ...invitation }) => ({
            ...invitation,
            inviteUrl: token ? invitationUrl(origin, token) : null,
        })),
    };
}

export async function action({ request, context }: ActionFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);
    const db = context.cloudflare.env.SITES_DB;
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "account") {
        const name = String(form.get("name") || "").trim();
        const timezone = String(form.get("timezone") || "UTC").trim();
        if (!name || !validTimezone(timezone)) return { error: "Enter a name and valid IANA timezone." };
        await updateAccount(db, user.accountId!, { name, timezone });
        return { notice: "Account settings saved." };
    }
    if (intent === "create-key") {
        const siteId = String(form.get("site_id") || "").trim();
        const site = await getSite(db, user.accountId!, siteId);
        if (!site) return { error: "Select a site for this API key." };
        const key = await createApiKey(db, user.accountId!, siteId, String(form.get("key_name") || "API key"));
        if (!key) return { error: "The API key could not be created for that site." };
        return {
            notice: `API key created for ${site.label}. Copy it now; it cannot be shown again.`,
            token: key.token,
            tokenSite: site.label,
        };
    }
    if (intent === "scope-key") {
        const scoped = await scopeApiKeyToSite(
            db,
            user.accountId!,
            String(form.get("key_id") || ""),
            String(form.get("site_id") || ""),
        );
        return scoped
            ? { notice: "API key is now restricted to the selected site." }
            : { error: "The API key could not be assigned to that site." };
    }
    if (intent === "password" && user.userId) {
        const currentPassword = String(form.get("current_password") || "");
        const newPassword = String(form.get("new_password") || "");
        const row = await getUserById(db, user.userId);
        if (!row?.password_hash || !(await bcrypt.compare(currentPassword, row.password_hash))) {
            return { error: "Current password is incorrect." };
        }
        if (newPassword.length < 12) return { error: "New passwords must be at least 12 characters." };
        await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(await bcrypt.hash(newPassword, 12), user.userId).run();
        return { notice: "Password updated." };
    }
    if (intent === "revoke-key") {
        await revokeApiKey(db, user.accountId!, String(form.get("key_id") || ""));
        return { notice: "API key revoked." };
    }
    if (intent === "delete-key") {
        const deleted = await deleteApiKey(db, user.accountId!, String(form.get("key_id") || ""));
        return deleted
            ? { notice: "API key permanently deleted." }
            : { error: "API key not found." };
    }
    if (intent === "delete-passkey" && user.userId) {
        await deletePasskey(db, user.userId, String(form.get("credential_id") || ""));
        return { notice: "Passkey removed." };
    }
    if (intent === "create-invitation") {
        if (!user.isSystemAdmin) throw new Response("Forbidden", { status: 403 });
        const name = String(form.get("account_name") || "").trim();
        const slug = String(form.get("slug") || "").trim().toLowerCase();
        const timezone = String(form.get("account_timezone") || "UTC").trim();
        if (!name || !validAccountSlug(slug) || !validTimezone(timezone)) {
            return { error: "Enter a valid account name, slug, and IANA timezone." };
        }
        try {
            const created = await createAccountInvitation(db, {
                accountName: name,
                accountSlug: slug,
                accountTimezone: timezone,
                createdByUserId: user.userId ?? null,
            }, context.cloudflare.env.CF_JWT_SECRET);
            return {
                notice: `Invitation for ${name} created. It expires in seven days.`,
                inviteUrl: invitationUrl(new URL(request.url).origin, created.token),
            };
        } catch (error) {
            return {
                error: error instanceof InvitationConflictError
                    ? error.message
                    : "The invitation could not be created.",
            };
        }
    }
    if (intent === "regenerate-invitation") {
        if (!user.isSystemAdmin) throw new Response("Forbidden", { status: 403 });
        const token = await regenerateAccountInvitation(
            db,
            String(form.get("invitation_id") || ""),
            context.cloudflare.env.CF_JWT_SECRET,
        );
        return token
            ? {
                notice: "Invitation link generated and saved.",
                inviteUrl: invitationUrl(new URL(request.url).origin, token),
            }
            : { error: "That invitation is no longer active." };
    }
    if (intent === "revoke-invitation") {
        if (!user.isSystemAdmin) throw new Response("Forbidden", { status: 403 });
        await revokeAccountInvitation(db, String(form.get("invitation_id") || ""));
        return { notice: "Invitation revoked." };
    }
    return { error: "Unknown action." };
}

export default function AccountSettings() {
    const data = useLoaderData<typeof loader>();
    const result = useActionData<typeof action>();
    const navigation = useNavigation();
    const [passkeyBusy, setPasskeyBusy] = useState(false);
    const [passkeyMessage, setPasskeyMessage] = useState("");
    const busy = navigation.state === "submitting";

    async function addPasskey() {
        setPasskeyBusy(true);
        setPasskeyMessage("");
        try {
            const optionsResponse = await fetch("/auth/passkey/register-options");
            if (!optionsResponse.ok) throw new Error("Could not start passkey registration");
            const response = await startRegistration({ optionsJSON: await optionsResponse.json() });
            const verifyResponse = await fetch("/auth/passkey/register-verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response, name: "Passkey" }),
            });
            const verified = await verifyResponse.json() as { error?: string };
            if (!verifyResponse.ok) throw new Error(verified.error || "Passkey registration failed");
            window.location.reload();
        } catch (error) {
            setPasskeyMessage(error instanceof Error ? error.message : "Passkey registration failed");
        } finally {
            setPasskeyBusy(false);
        }
    }

    return <>
        <header className="app-head">
            <div><p className="kicker">Account</p><h1>Account &amp; API</h1><p>Settings, passkeys, and credentials are isolated to this account.</p></div>
        </header>
        {result?.notice && <div className="flash flash--ok">{result.notice}</div>}
        {result?.error && <div className="flash flash--error" role="alert">{result.error}</div>}
        {result?.inviteUrl && <div className="card"><div className="card-head"><h2>Invitation link</h2></div><div className="card-body stack-md"><p>Send this single-use link to the account owner. It remains available below while the invitation is active.</p><CopyableSecret value={result.inviteUrl} label="invitation link" /></div></div>}

        <section className="card"><div className="card-head"><h2>Account settings</h2></div><div className="card-body">
            <Form method="post" className="stack-md">
                <input type="hidden" name="intent" value="account" />
                <div className="field"><label htmlFor="account-name">Name</label><input className="input" id="account-name" name="name" defaultValue={data.account?.name} required /></div>
                <div className="field"><label htmlFor="account-timezone">Timezone</label><input className="input" id="account-timezone" name="timezone" defaultValue={data.account?.timezone || "UTC"} required /><span className="field-hint">IANA name, for example Asia/Kolkata or America/New_York.</span></div>
                <button className="btn btn-primary" disabled={busy}>Save settings</button>
            </Form>
        </div></section>

        {data.user.userId && <section className="card"><div className="card-head"><h2>Password</h2></div><div className="card-body">
            <Form method="post" className="settings-grid"><input type="hidden" name="intent" value="password" /><div className="field"><label htmlFor="current-password">Current password</label><input className="input" type="password" id="current-password" name="current_password" autoComplete="current-password" required /></div><div className="field"><label htmlFor="new-account-password">New password</label><input className="input" type="password" id="new-account-password" name="new_password" minLength={12} autoComplete="new-password" required /></div><div><button className="btn btn-primary" disabled={busy}>Update password</button></div></Form>
        </div></section>}

        <section className="card"><div className="card-head"><h2>Passkeys</h2></div><div className="card-body stack-md">
            <p className="muted">Use your device unlock, fingerprint, or security key for passwordless sign-in. User verification is required.</p>
            {data.passkeys.map((key) => <div className="setting-row" key={key.credential_id}><div><strong>{key.name}</strong><div className="cell-sub">Added {new Date(key.created_at).toLocaleDateString()}</div></div><Form method="post"><input type="hidden" name="intent" value="delete-passkey" /><input type="hidden" name="credential_id" value={key.credential_id} /><button className="btn btn-ghost btn-sm">Remove</button></Form></div>)}
            <button type="button" className="btn btn-secondary" onClick={addPasskey} disabled={passkeyBusy || !data.user.userId}>{passkeyBusy ? "Waiting for device…" : "Add a passkey"}</button>
            {passkeyMessage && <p className="field-error" role="alert">{passkeyMessage}</p>}
        </div></section>

        <section className="card"><div className="card-head"><h2>API keys</h2></div><div className="card-body stack-md">
            <p className="muted">Every key is restricted to one site and can read only that site&rsquo;s analytics and real-time data. Store keys server-side, including in WordPress. The full value is shown only once after creation.</p>
            {data.apiKeys.map((key) => (
                <div className="setting-row" key={key.id}>
                    <div>
                        <strong>{key.name}</strong>
                        <div className="cell-sub">{key.site_id ? `Site: ${key.site_label || key.site_id}` : "No site assigned — inactive until a site is selected"}</div>
                        <div className="cell-sub mono">gta_{key.prefix}_… · {key.revoked_at ? "revoked" : key.site_id ? key.last_used_at ? `used ${new Date(key.last_used_at).toLocaleDateString()}` : "never used" : "inactive"}</div>
                    </div>
                    <div className="setting-row__actions">
                        {!key.revoked_at && !key.site_id && (
                            <Form method="post" className="api-key-scope-form">
                                <input type="hidden" name="intent" value="scope-key" />
                                <input type="hidden" name="key_id" value={key.id} />
                                <label className="visually-hidden" htmlFor={`scope-site-${key.id}`}>Site for {key.name}</label>
                                <select className="select" id={`scope-site-${key.id}`} name="site_id" required defaultValue="">
                                    <option value="" disabled>Select site</option>
                                    {data.sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.label}</option>)}
                                </select>
                                <button className="btn btn-secondary btn-sm" disabled={busy || data.sites.length === 0}>Set site</button>
                            </Form>
                        )}
                        {!key.revoked_at && key.site_id && <Form method="post"><input type="hidden" name="intent" value="revoke-key" /><input type="hidden" name="key_id" value={key.id} /><button className="btn btn-ghost btn-sm" disabled={busy}>Revoke</button></Form>}
                        <Form method="post" onSubmit={(event) => { if (!confirm(`Permanently delete the API key “${key.name}”? This cannot be undone.`)) event.preventDefault(); }}><input type="hidden" name="intent" value="delete-key" /><input type="hidden" name="key_id" value={key.id} /><button className="btn btn-danger btn-sm" disabled={busy}>Delete</button></Form>
                    </div>
                </div>
            ))}
            {data.sites.length > 0 ? (
                <Form method="post" className="api-key-create-form">
                    <input type="hidden" name="intent" value="create-key" />
                    <div className="field"><label htmlFor="key-name">Key name</label><input className="input" id="key-name" name="key_name" placeholder="WordPress dashboard" required /></div>
                    <div className="field"><label htmlFor="key-site">Site</label><select className="select" id="key-site" name="site_id" required defaultValue=""><option value="" disabled>Select site</option>{data.sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.label} — {site.site_id}</option>)}</select></div>
                    <button className="btn btn-primary" disabled={busy}>Create key</button>
                </Form>
            ) : <p className="field-error">Add a site before creating an API key.</p>}
            {result?.token && <div className="one-time-credential" role="region" aria-labelledby="new-api-key-heading"><div><h3 id="new-api-key-heading">New API key</h3><p>Restricted to {result.tokenSite}. Copy this credential now; it cannot be shown again.</p></div><CopyableSecret value={result.token} label="API key" focusOnMount /></div>}
        </div></section>

        {data.user.isSystemAdmin && <section className="card"><div className="card-head"><h2>Accounts &amp; invitations</h2></div><div className="card-body stack-md">
            <p className="muted">New accounts are invite-only. Create a seven-day, single-use link for the owner to choose their own username and password.</p>
            {data.accounts.map((account) => <div className="setting-row" key={account.id}><div><strong>{account.name}</strong><div className="cell-sub mono">{account.slug}</div></div><span className="pill pill--muted">{account.timezone}</span></div>)}
            {data.invitations.map((invitation) => {
                const active = !invitation.accepted_at && !invitation.revoked_at && invitation.expires_at > Math.floor(Date.now() / 1000);
                return <div className="invitation-item" key={invitation.id}>
                    <div className="setting-row"><div><strong>{invitation.account_name}</strong><div className="cell-sub mono">{invitation.account_slug} · {invitationStatus(invitation)}</div></div>{active && <div className="setting-row__actions">{!invitation.inviteUrl && <Form method="post"><input type="hidden" name="intent" value="regenerate-invitation" /><input type="hidden" name="invitation_id" value={invitation.id} /><button className="btn btn-secondary btn-sm" disabled={busy}>Generate link</button></Form>}<Form method="post"><input type="hidden" name="intent" value="revoke-invitation" /><input type="hidden" name="invitation_id" value={invitation.id} /><button className="btn btn-ghost btn-sm" disabled={busy}>Revoke</button></Form></div>}</div>
                    {active && invitation.inviteUrl && <div className="invitation-item__link"><CopyableSecret value={invitation.inviteUrl} label="invitation link" /></div>}
                    {active && !invitation.inviteUrl && <p className="field-hint">This invitation predates persistent links. Generate a replacement link to display and copy it here.</p>}
                </div>;
            })}
            <Form method="post" className="settings-grid"><input type="hidden" name="intent" value="create-invitation" /><div className="field"><label htmlFor="new-account-name">Account name</label><input className="input" id="new-account-name" name="account_name" required /></div><div className="field"><label htmlFor="new-account-slug">Slug</label><input className="input" id="new-account-slug" name="slug" pattern="[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?" required /></div><div className="field"><label htmlFor="new-account-timezone">Timezone</label><input className="input" id="new-account-timezone" name="account_timezone" defaultValue="UTC" required /></div><div><button className="btn btn-primary" disabled={busy}>Create invitation</button></div></Form>
        </div></section>}
    </>;
}

function validTimezone(value: string): boolean {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function invitationUrl(origin: string, token: string): string {
    const url = new URL("/signup", origin);
    url.searchParams.set("token", token);
    return url.toString();
}

function invitationStatus(invitation: { accepted_at: number | null; revoked_at: number | null; expires_at: number }): string {
    if (invitation.accepted_at) return "accepted";
    if (invitation.revoked_at) return "revoked";
    if (invitation.expires_at <= Math.floor(Date.now() / 1000)) return "expired";
    return `expires ${new Date(invitation.expires_at * 1000).toLocaleDateString()}`;
}
