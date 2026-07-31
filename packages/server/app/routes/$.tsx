import { Link } from "react-router";

// The $ filename is a special convention in React Router for catch-all routes
export const path = "*";

export default function NotFound() {
    return (
        <div className="container-narrow errorbox">
            <div className="card">
                <div className="empty-state">
                    <span className="pill pill--muted">404</span>
                    <h3>Page not found</h3>
                    <p>That URL does not exist on this dashboard.</p>
                    <Link className="btn btn-primary" to="/dashboard">
                        Back to dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
