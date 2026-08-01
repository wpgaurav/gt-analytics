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
    createAccountWithOwner,
    getAccount,
    listAccounts,
    updateAccount,
    validAccountSlug,
} from "~/accounts/accounts";
import { createApiKey, listApiKeys, revokeApiKey } from "~/accounts/api-keys";
import { deletePasskey, listPasskeys } from "~/accounts/passkeys";
import { getUserById, requireAuth } from "~/lib/auth";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);
    const db = context.cloudflare.env.SITES_DB;
    return {
        user,
        account: await getAccount(db, user.accountId!),
        apiKeys: await listApiKeys(db, user.accountId!),
        passkeys: user.userId ? await listPasskeys(db, user.userId) : [],
        accounts: user.isSystemAdmin ? await listAccounts(db) : [],
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
        const key = await createApiKey(db, user.accountId!, String(form.get("key_name") || "API key"));
        return { notice: "API key created. Copy it now; it cannot be shown again.", token: key.token };
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
    if (intent === "delete-passkey" && user.userId) {
        await deletePasskey(db, user.userId, String(form.get("credential_id") || ""));
        return { notice: "Passkey removed." };
    }
    if (intent === "create-account") {
        if (!user.isSystemAdmin) throw new Response("Forbidden", { status: 403 });
        const name = String(form.get("account_name") || "").trim();
        const slug = String(form.get("slug") || "").trim().toLowerCase();
        const timezone = String(form.get("account_timezone") || "UTC").trim();
        const username = String(form.get("username") || "").trim().toLowerCase();
        const password = String(form.get("password") || "");
        if (!name || !validAccountSlug(slug) || !/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 12 || !validTimezone(timezone)) {
            return { error: "Account details are invalid. Passwords must be at least 12 characters." };
        }
        try {
            await createAccountWithOwner(db, { name, slug, timezone, username, password });
            return { notice: `Account ${name} created.` };
        } catch {
            return { error: "That account slug or username is already in use." };
        }
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
        {result?.token && <div className="card"><div className="card-head"><h2>New API key</h2></div><div className="card-body stack-md"><p>Copy this credential now. Only its hash is stored.</p><code className="api-token">{result.token}</code></div></div>}

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
            <p className="muted">Keys can read this account&rsquo;s analytics and real-time data. Store them server-side, including in WordPress.</p>
            {data.apiKeys.map((key) => <div className="setting-row" key={key.id}><div><strong>{key.name}</strong><div className="cell-sub mono">gta_{key.prefix}_… · {key.revoked_at ? "revoked" : key.last_used_at ? `used ${new Date(key.last_used_at).toLocaleDateString()}` : "never used"}</div></div>{!key.revoked_at && <Form method="post"><input type="hidden" name="intent" value="revoke-key" /><input type="hidden" name="key_id" value={key.id} /><button className="btn btn-ghost btn-sm">Revoke</button></Form>}</div>)}
            <Form method="post" className="form-inline"><input type="hidden" name="intent" value="create-key" /><label className="visually-hidden" htmlFor="key-name">Key name</label><input className="input" id="key-name" name="key_name" placeholder="WordPress dashboard" required /><button className="btn btn-primary" disabled={busy}>Create key</button></Form>
        </div></section>

        {data.user.isSystemAdmin && <section className="card"><div className="card-head"><h2>Accounts</h2></div><div className="card-body stack-md">
            <p className="muted">Create an isolated account with its own owner, sites, saved views, passkeys, and API keys.</p>
            {data.accounts.map((account) => <div className="setting-row" key={account.id}><div><strong>{account.name}</strong><div className="cell-sub mono">{account.slug}</div></div><span className="pill pill--muted">{account.timezone}</span></div>)}
            <Form method="post" className="settings-grid"><input type="hidden" name="intent" value="create-account" /><div className="field"><label htmlFor="new-account-name">Account name</label><input className="input" id="new-account-name" name="account_name" required /></div><div className="field"><label htmlFor="new-account-slug">Slug</label><input className="input" id="new-account-slug" name="slug" pattern="[a-z0-9-]+" required /></div><div className="field"><label htmlFor="new-account-timezone">Timezone</label><input className="input" id="new-account-timezone" name="account_timezone" defaultValue="UTC" required /></div><div className="field"><label htmlFor="new-owner">Owner username</label><input className="input" id="new-owner" name="username" autoComplete="off" required /></div><div className="field"><label htmlFor="new-password">Temporary password</label><input className="input" type="password" id="new-password" name="password" minLength={12} autoComplete="new-password" required /></div><div><button className="btn btn-primary" disabled={busy}>Create account</button></div></Form>
        </div></section>}
    </>;
}

function validTimezone(value: string): boolean {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
