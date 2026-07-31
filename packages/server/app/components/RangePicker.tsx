import { useEffect, useRef, useState } from "react";

import Icon from "./Icon";
import { formatCustomRange, isCustomRange } from "~/analytics/range";

export interface Coverage {
    earliest: string;
    latest: string;
    archive: { earliest: string | null; days: number; enabled: boolean };
}

export interface RangePickerProps {
    value: string;
    onChange: (interval: string) => void;
}

const PRESETS: { value: string; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
    { value: "180d", label: "6 months" },
    { value: "365d", label: "12 months" },
];

/**
 * Time range: presets plus an explicit start and end.
 *
 * The custom inputs are bounded by what the two stores can actually answer,
 * fetched rather than assumed. A picker that offers five years when four
 * months exist produces empty charts that read as lost data, and the honest
 * bound moves on its own -- Analytics Engine's window slides forward every day
 * and the archive grows behind it.
 */
export default function RangePicker({ value, onChange }: RangePickerProps) {
    const [coverage, setCoverage] = useState<Coverage | null>(null);
    const [open, setOpen] = useState(false);
    const [start, setStart] = useState("");
    const [end, setEnd] = useState("");
    const [error, setError] = useState("");
    const container = useRef<HTMLDivElement>(null);

    const custom = isCustomRange(value);

    useEffect(() => {
        let cancelled = false;

        // Coverage is an affordance, not data: without it the presets still
        // work and the custom inputs are simply unbounded. So every failure
        // mode is swallowed, including fetch not returning a promise at all --
        // this component renders above the whole dashboard, and it must not be
        // able to take the page down.
        (async () => {
            try {
                const response = await fetch("/resources/coverage");
                if (!response?.ok) return;
                const data = await response.json();
                if (!cancelled && data) setCoverage(data as Coverage);
            } catch {
                // Intentionally ignored.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Seed the inputs from the current range so reopening the panel shows what
    // is actually applied rather than empty fields.
    useEffect(() => {
        if (custom) {
            const [from, to] = value.split("..");
            setStart(from);
            setEnd(to);
        }
    }, [value, custom]);

    useEffect(() => {
        if (!open) return;

        function onDocumentClick(event: MouseEvent) {
            if (!container.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        function onEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }

        document.addEventListener("mousedown", onDocumentClick);
        document.addEventListener("keydown", onEscape);
        return () => {
            document.removeEventListener("mousedown", onDocumentClick);
            document.removeEventListener("keydown", onEscape);
        };
    }, [open]);

    function apply() {
        if (!start || !end) {
            setError("Pick both a start and an end date.");
            return;
        }
        if (start > end) {
            setError("The start date is after the end date.");
            return;
        }
        setError("");
        setOpen(false);
        onChange(formatCustomRange(start, end));
    }

    return (
        <div className="range-picker" ref={container}>
            <label className="visually-hidden" htmlFor="interval-picker">
                Time range
            </label>
            <select
                id="interval-picker"
                className="select"
                value={custom ? "__custom" : value}
                onChange={(event) => {
                    if (event.target.value === "__custom") {
                        setOpen(true);
                        return;
                    }
                    onChange(event.target.value);
                }}
            >
                {PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                        {preset.label}
                    </option>
                ))}
                <option value="__custom">
                    {custom ? `${start} to ${end}` : "Custom range…"}
                </option>
            </select>

            <button
                type="button"
                className="btn btn-ghost btn-sm range-picker__toggle"
                aria-expanded={open}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
                <Icon name="calendar" size={14} />
                <span className="visually-hidden">Choose a date range</span>
            </button>

            {open && (
                <div className="range-picker__panel">
                    <div className="range-picker__fields">
                        <div>
                            <label htmlFor="range-start">From</label>
                            <input
                                id="range-start"
                                type="date"
                                className="input"
                                value={start}
                                min={coverage?.earliest}
                                max={coverage?.latest}
                                onChange={(event) =>
                                    setStart(event.target.value)
                                }
                            />
                        </div>
                        <div>
                            <label htmlFor="range-end">To</label>
                            <input
                                id="range-end"
                                type="date"
                                className="input"
                                value={end}
                                min={start || coverage?.earliest}
                                max={coverage?.latest}
                                onChange={(event) => setEnd(event.target.value)}
                            />
                        </div>
                    </div>

                    {error && (
                        <p className="range-picker__error" role="alert">
                            {error}
                        </p>
                    )}

                    {coverage && (
                        <p className="range-picker__note">
                            Data available from {coverage.earliest}.
                            {coverage.archive.enabled &&
                            coverage.archive.days > 0
                                ? ` Anything before the last 90 days is read from ${coverage.archive.days} archived ${coverage.archive.days === 1 ? "day" : "days"}.`
                                : " Only the last 90 days are stored so far."}
                        </p>
                    )}

                    <div className="range-picker__actions">
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={apply}
                        >
                            Apply
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
