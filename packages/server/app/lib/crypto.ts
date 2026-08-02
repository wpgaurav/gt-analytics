const encoder = new TextEncoder();

export function randomId(prefix: string, bytes = 18): string {
    const value = new Uint8Array(bytes);
    crypto.getRandomValues(value);
    return `${prefix}_${toBase64Url(value)}`;
}

export function randomSecret(bytes = 32): string {
    const value = new Uint8Array(bytes);
    crypto.getRandomValues(value);
    return toBase64Url(value);
}

export async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return toBase64Url(new Uint8Array(digest));
}

export async function hmacSha256(secret: string, value: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(value),
    );
    return toBase64Url(new Uint8Array(signature));
}

export function toBase64Url(value: Uint8Array): string {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
