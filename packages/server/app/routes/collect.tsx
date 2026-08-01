import { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { collectRequestHandler } from "~/analytics/collect";

// NOTE: This is the Remix/Vite entry point for the /collect endpoin
//
//       On Cloudflare Pages, the entry point is found in functions/collect.ts

export async function loader({ request, context }: LoaderFunctionArgs) {
    return collectRequestHandler(
        request,
        context.cloudflare.env,
        context.cloudflare.cf,
        context.cloudflare.ctx,
    );
}

/** `navigator.sendBeacon` transport. */
export async function action({ request, context }: ActionFunctionArgs) {
    return collectRequestHandler(
        request,
        context.cloudflare.env,
        context.cloudflare.cf,
        context.cloudflare.ctx,
    );
}
