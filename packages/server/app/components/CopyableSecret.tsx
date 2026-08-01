import { useEffect, useId, useRef, useState } from "react";

interface CopyableSecretProps {
    value: string;
    label: string;
    focusOnMount?: boolean;
}

type CopyStatus = "idle" | "copied" | "error";

export default function CopyableSecret({ value, label, focusOnMount = false }: CopyableSecretProps) {
    const fieldId = useId();
    const fieldRef = useRef<HTMLTextAreaElement>(null);
    const [status, setStatus] = useState<CopyStatus>("idle");

    useEffect(() => {
        if (!focusOnMount || !fieldRef.current) return;
        fieldRef.current.focus();
        fieldRef.current.select();
    }, [focusOnMount]);

    async function copyValue() {
        let copied = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                copied = true;
            }
        } catch {
            // Clipboard permissions vary by browser. Fall through to the
            // selection-based copy path while the user gesture is still live.
        }

        if (!copied && fieldRef.current) {
            fieldRef.current.focus();
            fieldRef.current.select();
            fieldRef.current.setSelectionRange(0, value.length);
            try {
                copied = document.execCommand?.("copy") ?? false;
            } catch {
                copied = false;
            }
        }

        setStatus(copied ? "copied" : "error");
    }

    return (
        <div className="copyable-secret">
            <label className="visually-hidden" htmlFor={fieldId}>
                Full {label}
            </label>
            <textarea
                ref={fieldRef}
                id={fieldId}
                className="copyable-secret__field"
                value={value}
                readOnly
                rows={3}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onFocus={(event) => event.currentTarget.select()}
            />
            <div className="copyable-secret__actions">
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={copyValue}
                >
                    {status === "copied" ? "Copied" : `Copy ${label}`}
                </button>
                <span
                    className={`copyable-secret__status${status === "error" ? " field-error" : ""}`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {status === "copied"
                        ? `${label} copied to clipboard.`
                        : status === "error"
                            ? "Automatic copy failed. Select the full value above and copy it manually."
                            : ""}
                </span>
            </div>
        </div>
    );
}
