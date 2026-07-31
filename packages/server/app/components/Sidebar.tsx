import { useState } from "react";
import { Form, NavLink, useLocation } from "react-router";

import Icon from "./Icon";
import type { IconName } from "./icon-paths";
import {
    isPresetActive,
    presetHref,
    type Preset,
} from "~/sites/presets";

export interface SidebarProps {
    presets: Preset[];
    /** Current site, so presets keep you on it. */
    siteId: string | null;
}

export default function Sidebar({ presets, siteId }: SidebarProps) {
    const location = useLocation();
    const [saving, setSaving] = useState(false);

    const onDashboard = location.pathname.startsWith("/dashboard");
    const search = location.search;

    return (
        <aside className="sidebar" aria-label="Views and saved filters">
            <nav className="sidebar__group">
                <p className="sidebar__label">Reports</p>
                <SidebarLink to="/dashboard" icon="gauge-high">
                    Dashboard
                </SidebarLink>
                <SidebarLink to="/realtime" icon="bolt">
                    Real-time
                </SidebarLink>
            </nav>

            <nav className="sidebar__group">
                <p className="sidebar__label">Saved views</p>
                {presets.length === 0 && (
                    <p className="sidebar__empty">
                        No saved views yet. Filter the dashboard, then save it.
                    </p>
                )}
                {presets.map((preset) => (
                    <PresetLink
                        key={preset.id}
                        preset={preset}
                        siteId={siteId}
                        active={
                            onDashboard && isPresetActive(preset, search)
                        }
                    />
                ))}

                {onDashboard &&
                    (saving ? (
                        <Form
                            method="post"
                            action="/presets"
                            className="sidebar__save"
                            onSubmit={() => setSaving(false)}
                        >
                            <input
                                type="hidden"
                                name="intent"
                                value="create"
                            />
                            <input
                                type="hidden"
                                name="search"
                                value={search}
                            />
                            <label
                                className="visually-hidden"
                                htmlFor="preset-name"
                            >
                                Name for this view
                            </label>
                            <input
                                id="preset-name"
                                name="name"
                                className="input"
                                placeholder="Name this view"
                                required
                                maxLength={60}
                            />
                            <div className="sidebar__save-actions">
                                <button className="btn btn-primary btn-sm">
                                    Save
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setSaving(false)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </Form>
                    ) : (
                        <button
                            type="button"
                            className="sidebar__add"
                            onClick={() => setSaving(true)}
                        >
                            <Icon name="circle-check" size={14} />
                            Save current view
                        </button>
                    ))}
            </nav>

            <nav className="sidebar__group">
                <p className="sidebar__label">Manage</p>
                <SidebarLink to="/admin/sites" icon="browser">
                    Sites
                </SidebarLink>
                <SidebarLink to="/admin/settings" icon="gear">
                    Install &amp; tracking
                </SidebarLink>
            </nav>
        </aside>
    );
}

function SidebarLink({
    to,
    icon,
    children,
}: {
    to: string;
    icon: IconName;
    children: React.ReactNode;
}) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                isActive ? "sidebar__link is-active" : "sidebar__link"
            }
        >
            <Icon name={icon} size={14} />
            <span>{children}</span>
        </NavLink>
    );
}

function PresetLink({
    preset,
    siteId,
    active,
}: {
    preset: Preset;
    siteId: string | null;
    active: boolean;
}) {
    return (
        <div className={active ? "sidebar__preset is-active" : "sidebar__preset"}>
            <a className="sidebar__link" href={presetHref(preset, siteId)}>
                <Icon name={preset.icon as IconName} size={14} />
                <span>{preset.name}</span>
            </a>
            {preset.built_in === 0 && (
                <Form method="post" action="/presets">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={preset.id} />
                    <button
                        className="sidebar__remove"
                        aria-label={`Delete saved view ${preset.name}`}
                        title="Delete"
                    >
                        ×
                    </button>
                </Form>
            )}
        </div>
    );
}
