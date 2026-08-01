import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type AuthenticatorTransportFuture,
    type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getUserById } from "~/lib/auth";
import { fromBase64Url, randomId, toBase64Url } from "~/lib/crypto";
import { readCookie } from "~/lib/session";

export const CHALLENGE_COOKIE_NAME = "__gt_webauthn_challenge";
const CHALLENGE_TTL_SECONDS = 5 * 60;

interface ChallengeRow {
    id: string;
    user_id: string | null;
    kind: "register" | "login";
    challenge: string;
    rp_id: string;
    origin: string;
    expires_at: number;
}

interface PasskeyRow {
    credential_id: string;
    user_id: string;
    public_key: string;
    counter: number;
    transports: string | null;
    device_type: string | null;
    backed_up: number;
    name: string;
    created_at: string;
    last_used_at: string | null;
}

export async function registrationOptions(
    db: D1Database,
    request: Request,
    userId: string,
) {
    const user = await getUserById(db, userId);
    if (!user) throw new Response("User not found", { status: 404 });
    const { results } = await db.prepare(
        "SELECT credential_id, transports FROM passkeys WHERE user_id = ?",
    ).bind(userId).all<{ credential_id: string; transports: string | null }>();
    const rp = relyingParty(request);
    const options = await generateRegistrationOptions({
        rpName: "GT Analytics",
        rpID: rp.rpId,
        userID: new TextEncoder().encode(user.id) as Uint8Array<ArrayBuffer>,
        userName: user.username,
        userDisplayName: user.display_name,
        attestationType: "none",
        authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
        },
        excludeCredentials: (results ?? []).map((key) => ({
            id: key.credential_id,
            transports: parseTransports(key.transports),
        })),
    });
    const cookie = await storeChallenge(db, userId, "register", options.challenge, rp);
    return { options, cookie };
}

export async function verifyRegistration(
    db: D1Database,
    request: Request,
    response: RegistrationResponseJSON,
    name: string,
) {
    const challenge = await consumeChallenge(db, request, "register");
    if (!challenge.user_id) throw new Error("Invalid registration challenge");
    const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
        throw new Error("Passkey verification failed");
    }
    const info = verification.registrationInfo;
    await db.prepare(
        `INSERT INTO passkeys
            (credential_id, user_id, public_key, counter, transports, device_type, backed_up, name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        info.credential.id,
        challenge.user_id,
        toBase64Url(info.credential.publicKey),
        info.credential.counter,
        JSON.stringify(response.response.transports ?? []),
        info.credentialDeviceType,
        info.credentialBackedUp ? 1 : 0,
        name.trim().slice(0, 80) || "Passkey",
    ).run();
    return { verified: true };
}

export async function authenticationOptions(db: D1Database, request: Request) {
    const rp = relyingParty(request);
    const options = await generateAuthenticationOptions({
        rpID: rp.rpId,
        userVerification: "required",
    });
    const cookie = await storeChallenge(db, null, "login", options.challenge, rp);
    return { options, cookie };
}

export async function verifyAuthentication(
    db: D1Database,
    request: Request,
    response: AuthenticationResponseJSON,
) {
    const challenge = await consumeChallenge(db, request, "login");
    const key = await db.prepare(
        "SELECT * FROM passkeys WHERE credential_id = ?",
    ).bind(response.id).first<PasskeyRow>();
    if (!key) throw new Error("Unknown passkey");
    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        credential: {
            id: key.credential_id,
            publicKey: fromBase64Url(key.public_key) as Uint8Array<ArrayBuffer>,
            counter: key.counter,
            transports: parseTransports(key.transports),
        },
        requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("Passkey verification failed");
    await db.prepare(
        `UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?`,
    ).bind(verification.authenticationInfo.newCounter, key.credential_id).run();
    const user = await getUserById(db, key.user_id);
    if (!user || user.disabled) throw new Error("User is unavailable");
    return user;
}

export async function listPasskeys(db: D1Database, userId: string): Promise<PasskeyRow[]> {
    const { results } = await db.prepare(
        `SELECT credential_id, user_id, counter, transports, device_type, backed_up,
                name, created_at, last_used_at
           FROM passkeys WHERE user_id = ? ORDER BY created_at DESC`,
    ).bind(userId).all<PasskeyRow>();
    return results ?? [];
}

export async function deletePasskey(db: D1Database, userId: string, credentialId: string) {
    await db.prepare("DELETE FROM passkeys WHERE user_id = ? AND credential_id = ?")
        .bind(userId, credentialId).run();
}

async function storeChallenge(
    db: D1Database,
    userId: string | null,
    kind: ChallengeRow["kind"],
    challenge: string,
    rp: { rpId: string; origin: string },
): Promise<string> {
    const id = randomId("wch", 18);
    const expires = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS;
    await db.batch([
        db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000)),
        db.prepare(
            `INSERT INTO auth_challenges (id, user_id, kind, challenge, rp_id, origin, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, userId, kind, challenge, rp.rpId, rp.origin, expires),
    ]);
    const secure = rp.origin.startsWith("https://") ? "; Secure" : "";
    return `${CHALLENGE_COOKIE_NAME}=${encodeURIComponent(id)}; HttpOnly; Max-Age=${CHALLENGE_TTL_SECONDS}; Path=/auth/passkey; SameSite=Strict${secure}`;
}

async function consumeChallenge(
    db: D1Database,
    request: Request,
    kind: ChallengeRow["kind"],
): Promise<ChallengeRow> {
    const id = readCookie(request, CHALLENGE_COOKIE_NAME);
    if (!id) throw new Error("Missing passkey challenge");
    const row = await db.prepare(
        "SELECT * FROM auth_challenges WHERE id = ? AND kind = ? AND expires_at > ?",
    ).bind(id, kind, Math.floor(Date.now() / 1000)).first<ChallengeRow>();
    await db.prepare("DELETE FROM auth_challenges WHERE id = ?").bind(id).run();
    if (!row) throw new Error("Passkey challenge expired");
    return row;
}

function relyingParty(request: Request) {
    const url = new URL(request.url);
    return { rpId: url.hostname, origin: url.origin };
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
    if (!value) return undefined;
    try {
        return JSON.parse(value) as AuthenticatorTransportFuture[];
    } catch {
        return undefined;
    }
}
