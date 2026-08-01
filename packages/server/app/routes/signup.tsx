import {
    Form,
    redirect,
    useActionData,
    useLoaderData,
    useNavigation,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
    type MetaFunction,
} from "react-router";
import {
    acceptAccountInvitation,
    getPublicInvitation,
    validUsername,
} from "~/accounts/invitations";
import { createSession, createSessionCookie } from "~/lib/session";

export const meta: MetaFunction = () => [
    { title: "Accept invitation — GT Analytics" },
    { name: "description", content: "Create an invited GT Analytics account" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
    const token = new URL(request.url).searchParams.get("token") || "";
    return {
        token,
        invitation: await getPublicInvitation(context.cloudflare.env.SITES_DB, token),
    };
}

export async function action({ request, context }: ActionFunctionArgs) {
    const form = await request.formData();
    const token = String(form.get("token") || "");
    const username = String(form.get("username") || "").trim().toLowerCase();
    const displayName = String(form.get("display_name") || "").trim();
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirm_password") || "");

    if (!validUsername(username)) {
        return { error: "Use 3–64 lowercase letters, numbers, dots, underscores, or hyphens for the username." };
    }
    if (!displayName || displayName.length > 100) {
        return { error: "Enter a display name of up to 100 characters." };
    }
    if (password.length < 12) {
        return { error: "Passwords must be at least 12 characters." };
    }
    if (password !== confirmPassword) {
        return { error: "Passwords do not match." };
    }

    try {
        const created = await acceptAccountInvitation(context.cloudflare.env.SITES_DB, {
            token,
            username,
            displayName,
            password,
        });
        const session = await createSession(
            context.cloudflare.env.SITES_DB,
            created.userId,
            created.accountId,
        );
        return redirect("/dashboard", {
            headers: { "Set-Cookie": createSessionCookie(session, request) },
        });
    } catch (error) {
        const message = error instanceof Error && /invitation/i.test(error.message)
            ? error.message
            : "That username is already in use or the account could not be created.";
        return { error: message };
    }
}

export default function Signup() {
    const { invitation, token } = useLoaderData<typeof loader>();
    const result = useActionData<typeof action>();
    const navigation = useNavigation();
    const busy = navigation.state === "submitting";

    return (
        <div className="container-narrow signin signup">
            <div className="card">
                <div className="card-body">
                    <header className="section-head signin__head">
                        <span className="kicker">GT Analytics</span>
                        <h1>{invitation ? "Create your account" : "Invitation unavailable"}</h1>
                        <p>
                            {invitation
                                ? `You have been invited to manage ${invitation.accountName}.`
                                : "This link is invalid, expired, revoked, or has already been used."}
                        </p>
                    </header>

                    {invitation ? (
                        <Form method="post">
                            <input type="hidden" name="token" value={token} />
                            <div className="field">
                                <label htmlFor="display-name">Your name</label>
                                <input className="input" id="display-name" name="display_name" autoComplete="name" maxLength={100} required disabled={busy} />
                            </div>
                            <div className="field">
                                <label htmlFor="signup-username">Username</label>
                                <input className="input" id="signup-username" name="username" autoComplete="username" pattern="[a-z0-9._-]{3,64}" required disabled={busy} />
                                <span className="field-hint">Lowercase letters, numbers, dots, underscores, or hyphens.</span>
                            </div>
                            <div className="field">
                                <label htmlFor="signup-password">Password</label>
                                <input className="input" type="password" id="signup-password" name="password" autoComplete="new-password" minLength={12} required disabled={busy} />
                            </div>
                            <div className="field">
                                <label htmlFor="confirm-password">Confirm password</label>
                                <input className="input" type="password" id="confirm-password" name="confirm_password" autoComplete="new-password" minLength={12} required disabled={busy} aria-invalid={result?.error ? true : undefined} aria-describedby={result?.error ? "signup-error" : undefined} />
                                {result?.error && <span className="field-error" id="signup-error" role="alert">{result.error}</span>}
                            </div>
                            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                                {busy ? "Creating account…" : "Create account"}
                            </button>
                        </Form>
                    ) : (
                        <a className="btn btn-secondary btn-block" href="/">Return to sign in</a>
                    )}
                </div>
            </div>
        </div>
    );
}
