import { ICON_PATHS, type IconName } from "./icon-paths";

export interface IconProps {
    name: IconName;
    /** Rendered size in px. Icons are square. */
    size?: number;
    className?: string;
    /**
     * Accessible label. Omit for decorative icons sitting next to text that
     * already says the same thing -- those are hidden from assistive tech
     * rather than read out twice.
     */
    title?: string;
}

export default function Icon({
    name,
    size = 16,
    className,
    title,
}: IconProps) {
    const icon = ICON_PATHS[name];
    if (!icon) return null;

    return (
        <svg
            className={className ? `icon ${className}` : "icon"}
            width={size}
            height={size}
            viewBox={icon.viewBox}
            fill="currentColor"
            role={title ? "img" : undefined}
            aria-hidden={title ? undefined : true}
            aria-label={title}
            focusable="false"
        >
            {icon.d.map((d, i) => (
                <path key={i} d={d} />
            ))}
        </svg>
    );
}

/** Maps a traffic channel to its icon. */
export function channelIcon(channel: string): IconName {
    switch (channel) {
        case "search":
            return "magnifying-glass";
        case "ai":
            return "robot";
        case "social":
            return "share-nodes";
        case "email":
            return "envelope";
        case "paid":
            return "rectangle-ad";
        case "referral":
            return "link";
        case "internal":
            return "browser";
        default:
            return "house";
    }
}
