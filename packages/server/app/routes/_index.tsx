import {
    ActionFunctionArgs,
    LoaderFunctionArgs,
    MetaFunction,
    Form,
    useActionData,
    useLoaderData,
    useNavigation,
    redirect,
} from "react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useState } from "react";
import { getUser, login, isAuthEnabled } from "~/lib/auth";

export const meta: MetaFunction = () => {
    return [
        { title: "Sign in — GT Analytics" },
        { name: "description", content: "GT Analytics" },
    ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env;
    const user = await getUser(request, env);
    const authEnabled = isAuthEnabled(env);

    // Return auth status to conditionally render the login form
    return { user, authEnabled };
}

export async function action({ request, context }: ActionFunctionArgs) {
    const env = context.cloudflare.env;

    // If auth is disabled, this action shouldn't be called, but handle it gracefully
    if (!isAuthEnabled(env)) {
        return redirect("/dashboard");
    }

    const formData = await request.formData();
    const usernameValue = formData.get("username");
    const password = formData.get("password");

    if (typeof password !== "string" || !password) {
        return { error: "Password is required" };
    }
    const username = typeof usernameValue === "string" && usernameValue.trim()
        ? usernameValue
        : "owner";

    try {
        return await login(request, username, password, env);
    } catch {
        return { error: "Invalid username or password" };
    }
}

export default function Index() {
    const { user, authEnabled } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const [passkeyError, setPasskeyError] = useState("");
    const [passkeyBusy, setPasskeyBusy] = useState(false);
    const isSubmitting = ["submitting", "loading"].includes(navigation.state);

    const alreadyIn = !authEnabled || user?.authenticated;

    async function signInWithPasskey() {
        setPasskeyBusy(true);
        setPasskeyError("");
        try {
            const optionsResponse = await fetch("/auth/passkey/login-options");
            if (!optionsResponse.ok) throw new Error("Passkey sign-in is unavailable");
            const optionsJSON = await optionsResponse.json() as PublicKeyCredentialRequestOptionsJSON;
            const response = await startAuthentication({ optionsJSON });
            const verifyResponse = await fetch("/auth/passkey/login-verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(response),
            });
            const result = await verifyResponse.json() as { redirect?: string; error?: string };
            if (!verifyResponse.ok) throw new Error(result.error || "Passkey sign-in failed");
            window.location.assign(result.redirect || "/dashboard");
        } catch (error) {
            setPasskeyError(error instanceof Error ? error.message : "Passkey sign-in failed");
        } finally {
            setPasskeyBusy(false);
        }
    }

    return (
        <div className="container-narrow signin">
            <div className="card">
                <div className="card-body">
                    <header className="section-head signin__head">
                        <span className="kicker">GT Analytics</span>
                        <h1>{alreadyIn ? "You're signed in" : "Sign in"}</h1>
                        <p>
                            {alreadyIn
                                ? "Continue to the dashboard."
                                : "Enter your username and password, or use a passkey."}
                        </p>
                    </header>

                    {alreadyIn ? (
                        <a className="btn btn-primary btn-block" href="/dashboard">
                            Go to dashboard
                        </a>
                    ) : (
                        <Form method="post">
                            <div className="field">
                                <label htmlFor="username">Username</label>
                                <input
                                    type="text"
                                    id="username"
                                    name="username"
                                    className="input"
                                    defaultValue="owner"
                                    required
                                    autoComplete="username webauthn"
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="field">
                                <label htmlFor="password">Password</label>
                                <input
                                    type="password"
                                    id="password"
                                    name="password"
                                    className="input"
                                    required
                                    autoComplete="current-password"
                                    disabled={isSubmitting}
                                    aria-invalid={
                                        actionData?.error ? true : undefined
                                    }
                                    aria-describedby={
                                        actionData?.error
                                            ? "password-error"
                                            : undefined
                                    }
                                />
                                {actionData?.error && (
                                    <span
                                        className="field-error"
                                        id="password-error"
                                        role="alert"
                                    >
                                        {actionData.error}
                                    </span>
                                )}
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary btn-block"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? "Signing in…" : "Sign in"}
                            </button>
                            <div className="signin__divider" aria-hidden="true">
                                <span>or</span>
                            </div>
                            <button
                                type="button"
                                className="btn btn-secondary btn-block"
                                disabled={passkeyBusy || isSubmitting}
                                onClick={signInWithPasskey}
                            >
                                {passkeyBusy ? "Checking passkey…" : "Sign in with a passkey"}
                            </button>
                            {passkeyError && <p className="field-error" role="alert">{passkeyError}</p>}
                            <p className="signin__invite">
                                New accounts are invite-only. Ask the administrator for an invitation link.
                            </p>
                        </Form>
                    )}
                </div>
            </div>
        </div>
    );
}
