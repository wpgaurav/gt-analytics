// Use a simpler approach with a comment to explain the type
declare global {
    interface Window {
        counterscale: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            q?: any[]; // Command queue for legacy API
            init: (opts: any) => void;
            trackPageview: (opts?: any) => Promise<void>;
            cleanup: () => void;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trackEvent?: (name: string, opts?: any) => void;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trackConversion?: (name: string, opts?: any) => void;
        };
        /**
         * Public command queue: gta('conversion', 'signup', { value: 49 }).
         * The install snippet defines a stub so calls made before tracker.js
         * loads are buffered rather than thrown away.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gta?: ((...args: any[]) => void) & { q?: any[] };
    }
}

export {};
