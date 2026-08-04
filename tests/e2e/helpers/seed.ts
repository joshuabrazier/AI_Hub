import { expect, type APIRequestContext } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";

import { deleteAuthTrail, withClient } from "./db";
import { enableTwoFactor } from "./two-factor";
import { readEnvVar } from "./env";

// Better Auth rejects state-changing requests without an Origin header (CSRF).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// The suite's standard password. Long enough for PASSWORD_MIN_LENGTH and the
// same everywhere, so a spec never has to invent one.
export const SEED_PASSWORD = "Passw0rd12345";

// A 32-char id matching the app's TABLE_ID_LENGTH (several schemas take a
// minimum length, so shorter ids would be rejected by Zod before the server
// ever looked them up).
export function newId(): string {
  return randomUUID().replace(/-/g, "");
}

// -------------------------------------------------------------------
// Seeded shapes
// -------------------------------------------------------------------
export type SeededUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: "admin" | "manager" | "member";
  // The TOTP secret for staff, who must be enrolled in 2FA before the proxy
  // lets them into /admin or /manage. Null for members, for whom 2FA is
  // optional and who are not asked for it at sign-in.
  totpSecret: string | null;
};

export type SeededTeam = {
  id: string;
  name: string;
};

// -------------------------------------------------------------------
// Seeder
//
// Every helper records the id of the row it inserted, and cleanup() deletes
// exactly those ids in foreign-key order, plus the auth trail those accounts
// leave behind (see deleteAuthTrail, which is where the single deliberate
// exception to "delete only recorded ids" is explained). That matters because
// the suite points at a real database, just a local one.
//
// One seeder per test. The specs create it in the test body and call
// cleanup() from afterEach, so it runs on failure as well as on success.
//
// A spec must assign it to the variable afterEach reads BEFORE the first
// insert, and afterEach must clear that variable afterwards. A seeder that is
// only published once seeding has finished is invisible to cleanup if seeding
// throws part-way, and a variable still holding the previous test's seeder
// hides the leak by cleaning up something that is already gone.
// -------------------------------------------------------------------
export class Seeder {
  constructor(private readonly request: APIRequestContext) {}

  // Recorded in the order rows must be REMOVED, which is the reverse of the
  // order they are created in.
  private readonly notificationIds: string[] = [];
  private readonly invitationIds: string[] = [];
  private readonly teamMemberIds: string[] = [];
  private readonly teamIds: string[] = [];
  private readonly userIds: string[] = [];
  // Every address this seeder is responsible for, whether or not it still has
  // an account. Some of the trail an account leaves is keyed by ADDRESS rather
  // than by id - a failed sign-in is audited with no actor at all - so the id
  // list alone cannot collect it.
  private readonly seededEmails: string[] = [];
  // Addresses the app may create an account for during the test. Resolved to
  // ids at cleanup time, so it does not matter whether the account exists yet
  // - or whether the test got far enough to create it.
  private readonly claimedEmails: string[] = [];

  // A short unique tag so parallel workers never collide on an email or on a
  // team name a spec asserts against.
  private readonly stamp = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

  /** A label unique to this seeder, for names a spec needs to assert on. */
  label(prefix: string): string {
    return `${prefix} ${this.stamp}`;
  }

  // -----------------------------------------------------------------
  // A user, created through the real sign-up endpoint so the account has a
  // password hash Better Auth will accept.
  //
  // Sign-up always produces a MEMBER: `role` is an input:false field, so Better
  // Auth ignores it in the request body. A staff account is made by writing the
  // role server-side afterwards, which is exactly how the invite flow does it.
  //
  // 2FA ORDER MATTERS. Better Auth only issues a session at sign-in while
  // two_factor_enabled is false; once it is true, sign-in returns a challenge
  // and no session. So the account is created and promoted FIRST and 2FA is
  // turned on LAST, and the secret comes back so a test can complete the
  // challenge. Getting this backwards looks exactly like an authorization
  // failure and is not one.
  // -----------------------------------------------------------------
  async user(options?: {
    role?: SeededUser["role"];
    name?: string;
    password?: string;
  }): Promise<SeededUser> {
    const role = options?.role ?? "member";
    const password = options?.password ?? SEED_PASSWORD;
    const name = options?.name ?? `E2E ${role}`;
    const email = `e2e-${role}-${this.stamp}-${this.userIds.length}@example.com`;
    // Recorded before the account exists, for the same reason claimEmail is
    // called before the flow that creates one: the sign-up below can fail
    // half-way, and the address is what collects the trail either way.
    this.seededEmails.push(email);

    const signUp = await this.request.post("/api/auth/sign-up/email", {
      headers: { Origin: ORIGIN },
      data: { name, email, password },
    });
    expect(signUp.ok(), `failed to seed the ${role} account`).toBeTruthy();

    // Sign the sign-up session out so the seeder's request context is not
    // carrying a stale cookie into the next seeded account.
    await this.request.post("/api/auth/sign-out", { headers: { Origin: ORIGIN } });

    const id = await withClient(async (client) => {
      const result = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      return result.rows[0]?.id as string;
    });
    expect(id, "the seeded account should exist").toBeTruthy();
    this.userIds.push(id);

    if (role !== "member") {
      await withClient((client) =>
        client.query("UPDATE users SET role = $1::user_role WHERE id = $2", [role, id]),
      );
    }

    // Staff cannot reach /admin or /manage without 2FA - the proxy sends them
    // to /setup-2fa - so a staff account is only usable once it is enrolled.
    const totpSecret =
      role === "member" ? null : (await enableTwoFactor(this.request, email, password)).secret;

    return { id, name, email, password, role, totpSecret };
  }

  // -----------------------------------------------------------------
  // Claim an address the APP is about to create an account for (the
  // accept-invite flow creates one), so cleanup removes it too.
  //
  // Call this BEFORE the flow runs, not after it succeeds. The account comes
  // into existence part-way through the test, so a test that fails after the
  // sign-up but before its last assertion would leave a real user behind - and
  // the next run seeds a fresh address, so nothing ever collects it. That is
  // how a "clean up exactly what you create" suite quietly accumulates rows.
  //
  // Claiming an address that never gets used is harmless: cleanup looks it up,
  // finds nothing, and moves on.
  // -----------------------------------------------------------------
  claimEmail(email: string): string {
    if (!this.claimedEmails.includes(email)) this.claimedEmails.push(email);

    return email;
  }

  // -----------------------------------------------------------------
  // A team. Teams are explicit in this model - nothing creates one implicitly -
  // so a test that needs one says so.
  // -----------------------------------------------------------------
  async team(options?: { name?: string; description?: string; isActive?: boolean }): Promise<SeededTeam> {
    const id = newId();
    const name = options?.name ?? this.label(`E2E Team ${this.teamIds.length + 1}`);

    await withClient((client) =>
      client.query("INSERT INTO teams (id, name, description, is_active) VALUES ($1, $2, $3, $4)", [
        id,
        name,
        options?.description ?? "Seeded by the end-to-end suite",
        options?.isActive ?? true,
      ]),
    );
    this.teamIds.push(id);

    return { id, name };
  }

  // -----------------------------------------------------------------
  // Put a user in a team. team_role is the role INSIDE the team: 'manager' is
  // how an admin assigns a manager to a team, and it is what the manager area's
  // scope is resolved from.
  // -----------------------------------------------------------------
  async addToTeam(
    team: SeededTeam,
    user: SeededUser,
    teamRole: "manager" | "member" = "member",
  ): Promise<string> {
    const id = newId();

    await withClient((client) =>
      client.query(
        "INSERT INTO team_members (id, team_id, user_id, team_role) VALUES ($1, $2, $3, $4::team_role)",
        [id, team.id, user.id, teamRole],
      ),
    );
    this.teamMemberIds.push(id);

    return id;
  }

  // -----------------------------------------------------------------
  // A notification in one person's inbox. read_at NULL is what "unread" means,
  // and it is what drives the unread count.
  // -----------------------------------------------------------------
  async notification(
    user: SeededUser,
    options?: { title?: string; body?: string | null; type?: string; readAt?: Date | null },
  ): Promise<string> {
    const id = newId();

    await withClient((client) =>
      client.query(
        `INSERT INTO notifications (id, user_id, type, title, body, read_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          user.id,
          options?.type ?? "general",
          options?.title ?? this.label("E2E Notification"),
          options?.body ?? "<p>Seeded by the end-to-end suite.</p>",
          options?.readAt ?? null,
        ],
      ),
    );
    this.notificationIds.push(id);

    return id;
  }

  // -----------------------------------------------------------------
  // A pending invitation. The token IS the row id, and inviter_id is a NOT NULL
  // foreign key, so the caller supplies a seeded inviter.
  //
  // A team placement on the invitation is what puts the new account into a team
  // on acceptance - and it is read from this row, never from the request.
  // -----------------------------------------------------------------
  async invitation(options: {
    inviter: SeededUser;
    email: string;
    name?: string;
    role?: SeededUser["role"];
    team?: SeededTeam;
    teamRole?: "manager" | "member";
    expiresAt?: Date;
    status?: "pending" | "completed" | "expired" | "revoked";
  }): Promise<string> {
    const id = randomBytes(24).toString("hex"); // 48 chars, over TABLE_ID_LENGTH

    await withClient((client) =>
      client.query(
        `INSERT INTO user_invitations (id, name, email, role, status, expires_at, inviter_id, team_id, team_role)
         VALUES ($1, $2, $3, $4::user_role, $5::invitation_status, $6, $7, $8, $9::team_role)`,
        [
          id,
          options.name ?? "E2E Invitee",
          options.email,
          options.role ?? "member",
          options.status ?? "pending",
          options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
          options.inviter.id,
          options.team?.id ?? null,
          options.team ? (options.teamRole ?? "member") : null,
        ],
      ),
    );
    this.invitationIds.push(id);

    return id;
  }

  // -----------------------------------------------------------------
  // Remove exactly what this seeder created, children before parents.
  //
  // Several of these would cascade anyway (a user takes their notifications
  // with them), but they are listed explicitly so the order is a statement of
  // the foreign keys rather than a bet on them.
  // -----------------------------------------------------------------
  async cleanup(): Promise<void> {
    await withClient(async (client) => {
      const remove = async (table: string, column: string, ids: string[]) => {
        if (ids.length === 0) return;
        await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::text[])`, [ids]);
      };

      // Resolve any address claimed for an account the app creates mid-test.
      // Done here, at the end, because that is the only point at which we know
      // whether the account was ever actually created.
      if (this.claimedEmails.length > 0) {
        const claimed = await client.query("SELECT id FROM users WHERE email = ANY($1::text[])", [
          this.claimedEmails,
        ]);

        for (const row of claimed.rows) {
          if (!this.userIds.includes(row.id)) this.userIds.push(row.id);
        }
      }

      await remove("notifications", "id", this.notificationIds);
      // Invitations reference the inviter, so they go before the users do.
      await remove("user_invitations", "id", this.invitationIds);
      await remove("team_members", "id", this.teamMemberIds);
      await remove("teams", "id", this.teamIds);

      // Signing in and failing to sign in both write an audit entry, and a
      // two-factor sign-in leaves verification rows behind. None of it blocks
      // the delete - actor_user_id is ON DELETE SET NULL -
      // so it would simply accumulate as anonymous rows in the local database.
      // Scoped to the seeded accounts and addresses, so no real trail is
      // touched, and run before the users go because the id is what half of it
      // is matched on.
      await deleteAuthTrail(client, this.userIds, [...this.seededEmails, ...this.claimedEmails]);

      if (this.userIds.length > 0) {
        // Better Auth's remaining rows. two_factor cascades from users;
        // sessions and accounts do not.
        await remove("sessions", "user_id", this.userIds);
        await remove("accounts", "user_id", this.userIds);
        await remove("two_factor", "user_id", this.userIds);
        await remove("users", "id", this.userIds);
      }
    });
  }
}
