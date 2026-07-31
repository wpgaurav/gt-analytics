export interface LogoProps {
    size?: number;
    className?: string;
}

/**
 * GT Analytics mark.
 *
 * Three ascending bars, echoing the per-minute sparkline the app draws on its
 * own real-time page -- the product's most recognisable shape rather than a
 * generic chart glyph.
 *
 * Drawn in `currentColor` with stepped opacity rather than three literal
 * brand tints, so one file works on the light shell, inside a dark band, and
 * in a monochrome context without needing variants. The 4px corner radius is
 * the CFDS `--r-xs`, so the mark sits in the same geometry as the buttons
 * beside it.
 */
export default function Logo({ size = 24, className }: LogoProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            className={className ? `logo ${className}` : "logo"}
            role="img"
            aria-label="GT Analytics"
            focusable="false"
        >
            <rect
                x="3"
                y="18"
                width="7"
                height="11"
                rx="2"
                fill="currentColor"
                opacity="0.35"
            />
            <rect
                x="12.5"
                y="11"
                width="7"
                height="18"
                rx="2"
                fill="currentColor"
                opacity="0.62"
            />
            <rect
                x="22"
                y="3"
                width="7"
                height="26"
                rx="2"
                fill="currentColor"
            />
        </svg>
    );
}
