import {
    AppWindow,
    Bot,
    CalendarDays,
    CircleCheck,
    ExternalLink,
    Eye,
    FileText,
    Gauge,
    Globe,
    House,
    Link as LinkIcon,
    Mail,
    Megaphone,
    Radio,
    Search,
    Settings,
    Share2,
    Target,
    TriangleAlert,
    Users,
    Zap,
    type LucideIcon,
} from "lucide-react";

/**
 * Open-source icon set. The public names stay stable because preset records
 * persist them in D1, while the rendered glyphs come from Lucide (ISC).
 */
const ICONS = {
    bolt: Zap,
    "signal-stream": Radio,
    users: Users,
    eye: Eye,
    "file-lines": FileText,
    link: LinkIcon,
    globe: Globe,
    browser: AppWindow,
    "bullseye-arrow": Target,
    "gauge-high": Gauge,
    gear: Settings,
    "magnifying-glass": Search,
    robot: Bot,
    "share-nodes": Share2,
    envelope: Mail,
    "rectangle-ad": Megaphone,
    "arrow-up-right-from-square": ExternalLink,
    "circle-check": CircleCheck,
    "triangle-exclamation": TriangleAlert,
    house: House,
    calendar: CalendarDays,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

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

export default function Icon({ name, size = 16, className, title }: IconProps) {
    const LucideGlyph = ICONS[name];
    if (!LucideGlyph) return null;

    return (
        <LucideGlyph
            className={className ? `icon ${className}` : "icon"}
            width={size}
            height={size}
            strokeWidth={1.75}
            role={title ? "img" : undefined}
            aria-hidden={title ? undefined : true}
            aria-label={title}
            focusable="false"
        />
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
