import bcrypt from "bcryptjs";
import { randomId, randomSecret, sha256 } from "~/lib/crypto";

const INVITATION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export interface AccountInvitation {
    id: string;
    account_name: string;
    account_slug: string;
    account_timezone: string;
    expires_at: number;
    accepted_at: number | null;
    revoked_at: number | null;
    created_at: number;
}

export interface PublicInvitation {
    accountName: string;
    accountSlug: string;
    accountTimezone: string;
    expiresAt: number;
}

export class InvitationConflictError extends Error {}

export async function createAccountInvitation(
    db: D1Database,
    input: {
        accountName: string;
        accountSlug: string;
        accountTimezone: string;
        createdByUserId: string | null;
    },
): Promise<{ invitation: AccountInvitation; token: string }> {
    const now = Math.floor(Date.now() / 1000);
    const conflict = await db.prepare(
        `SELECT slug FROM accounts WHERE slug = ? COLLATE NOCASE
         UNION ALL
         SELECT account_slug AS slug FROM account_invitations
          WHERE account_slug = ? COLLATE NOCASE
            AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
         LIMIT 1`,
    ).bind(input.accountSlug, input.accountSlug, now).first<{ slug: string }>();
    if (conflict) throw new InvitationConflictError("That account slug already exists or has a pending invitation.");

    const id = randomId("inv", 12);
    const token = randomSecret(32);
    const expiresAt = now + INVITATION_LIFETIME_SECONDS;
    await db.prepare(
        `INSERT INTO account_invitations
            (id, token_hash, account_name, account_slug, account_timezone,
             created_by_user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        id,
        await sha256(token),
        input.accountName,
        input.accountSlug,
        input.accountTimezone,
        input.createdByUserId,
        expiresAt,
        now,
    ).run();

    return {
        token,
        invitation: {
            id,
            account_name: input.accountName,
            account_slug: input.accountSlug,
            account_timezone: input.accountTimezone,
            expires_at: expiresAt,
            accepted_at: null,
            revoked_at: null,
            created_at: now,
        },
    };
}

export async function findValidInvitation(
    db: D1Database,
    token: string,
): Promise<(AccountInvitation & { token_hash: string }) | null> {
    if (!token || token.length > 256) return null;
    return db.prepare(
        `SELECT * FROM account_invitations
          WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL
            AND expires_at > ?`,
    ).bind(await sha256(token), Math.floor(Date.now() / 1000))
        .first<AccountInvitation & { token_hash: string }>();
}

export async function getPublicInvitation(
    db: D1Database,
    token: string,
): Promise<PublicInvitation | null> {
    const invitation = await findValidInvitation(db, token);
    return invitation ? {
        accountName: invitation.account_name,
        accountSlug: invitation.account_slug,
        accountTimezone: invitation.account_timezone,
        expiresAt: invitation.expires_at,
    } : null;
}

export async function acceptAccountInvitation(
    db: D1Database,
    input: { token: string; username: string; displayName: string; password: string },
): Promise<{ accountId: string; userId: string }> {
    const invitation = await findValidInvitation(db, input.token);
    if (!invitation) throw new Error("This invitation is invalid, expired, or already used.");

    const accountId = randomId("acct", 12);
    const userId = randomId("usr", 12);
    const acceptedAt = Math.floor(Date.now() / 1000);
    const passwordHash = await bcrypt.hash(input.password, 12);

    await db.batch([
        db.prepare(
            `UPDATE account_invitations SET accepted_at = ?
              WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
        ).bind(acceptedAt, invitation.id, acceptedAt),
        db.prepare(
            `INSERT INTO accounts (id, slug, name, timezone) VALUES (?, ?, ?, ?)`,
        ).bind(
            accountId,
            invitation.account_slug,
            invitation.account_name,
            invitation.account_timezone,
        ),
        db.prepare(
            `INSERT INTO users
                (id, account_id, username, display_name, password_hash, role)
             VALUES (?, ?, ?, ?, ?, 'owner')`,
        ).bind(userId, accountId, input.username, input.displayName, passwordHash),
    ]);
    return { accountId, userId };
}

export async function listAccountInvitations(db: D1Database): Promise<AccountInvitation[]> {
    const { results } = await db.prepare(
        `SELECT id, account_name, account_slug, account_timezone, expires_at,
                accepted_at, revoked_at, created_at
           FROM account_invitations
          ORDER BY created_at DESC LIMIT 50`,
    ).all<AccountInvitation>();
    return results ?? [];
}

export async function revokeAccountInvitation(db: D1Database, id: string): Promise<void> {
    await db.prepare(
        `UPDATE account_invitations SET revoked_at = ?
          WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    ).bind(Math.floor(Date.now() / 1000), id).run();
}

export function validUsername(value: string): boolean {
    return /^[a-z0-9._-]{3,64}$/.test(value);
}
