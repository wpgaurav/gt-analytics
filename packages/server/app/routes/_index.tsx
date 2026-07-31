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
    const password = formData.get("password");

    if (typeof password !== "string" || !password) {
        return { error: "Password is required" };
    }

    try {
        return await login(request, password, env);
    } catch {
        return { error: "Invalid password" };
    }
}

export default function Index() {
    const { user, authEnabled } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = ["submitting", "loading"].includes(navigation.state);

    const alreadyIn = !authEnabled || user?.authenticated;

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
                                : "Enter the dashboard password to continue."}
                        </p>
                    </header>

                    {alreadyIn ? (
                        <a className="btn btn-primary btn-block" href="/dashboard">
                            Go to dashboard
                        </a>
                    ) : (
                        <Form method="post">
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
                        </Form>
                    )}
                </div>
            </div>
        </div>
    );
}
