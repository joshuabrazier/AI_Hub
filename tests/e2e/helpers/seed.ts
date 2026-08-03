import { expect, type APIRequestContext } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";

import { deleteAuthTrail, withClient } from "./db";
import { enableTwoFactor } from "./two-factor";
import { readEnvVar } from "./env";

// Better Auth rejects state-changing requests without an Origin header (CSRF).
const ORIGIN = readEnvVar("NEXT_PUBLIC_APP_URL");

// The app resolves "today" in its own zone (todayInAppZone), not the server's.
// Seeded dates have to agree with that or a session seeded "tomorrow" lands on
// today - or yesterday - either side of midnight.
const APP_TIME_ZONE = readEnvVar("NEXT_PUBLIC_APP_TIME_ZONE");

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
// Dates
//
// Calendar dates are 'YYYY-MM-DD' strings everywhere in this app, and the DATE
// columns are read back as strings on purpose. These build them the same way
// the server does: in the APP's zone, never the machine's.
// -------------------------------------------------------------------
export function todayInAppZone(): string {
  // en-CA formats as YYYY-MM-DD, and `timeZone` makes it the app's calendar
  // day rather than the test machine's.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// A date `days` either side of today, in the app's zone. The arithmetic runs
// on a UTC instant built from the calendar parts, so a daylight-saving change
// in the app zone cannot shift the answer by a day.
export function appDateOffsetBy(days: number): string {
  const [year, month, day] = todayInAppZone().split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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

export type SeededClass = {
  id: string;
  name: string;
  programId: string;
  locationId: string;
  teamId: string | null;
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
  private readonly attendeeIds: string[] = [];
  private readonly classMemberIds: string[] = [];
  private readonly classSessionIds: string[] = [];
  private readonly classIds: string[] = [];
  private readonly programIds: string[] = [];
  private readonly locationIds: string[] = [];
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
  // A class, with the program and location it needs. Classes carry their own
  // start_date / end_date - there are no terms in this model.
  //
  // `team` is optional: a class with no team is admin-only, and one with a team
  // is administered by that team's managers.
  // -----------------------------------------------------------------
  async class(options?: {
    team?: SeededTeam;
    name?: string;
    capacity?: number;
    startDate?: string;
    endDate?: string;
    isActive?: boolean;
  }): Promise<SeededClass> {
    const id = newId();
    const programId = newId();
    const locationId = newId();
    const name = options?.name ?? this.label(`E2E Class ${this.classIds.length + 1}`);

    await withClient(async (client) => {
      await client.query(
        "INSERT INTO locations (id, name, address, is_active) VALUES ($1, $2, '1 Test Street', TRUE)",
        [locationId, this.label("E2E Location")],
      );
      await client.query("INSERT INTO programs (id, name, is_active) VALUES ($1, $2, TRUE)", [
        programId,
        this.label("E2E Program"),
      ]);
      await client.query(
        `INSERT INTO classes (id, program_id, location_id, team_id, name, schedule, capacity, start_date, end_date, is_active)
         VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8, $9)`,
        [
          id,
          programId,
          locationId,
          options?.team?.id ?? null,
          name,
          options?.capacity ?? 10,
          options?.startDate ?? appDateOffsetBy(-30),
          options?.endDate ?? appDateOffsetBy(90),
          options?.isActive ?? true,
        ],
      );
    });

    this.locationIds.push(locationId);
    this.programIds.push(programId);
    this.classIds.push(id);

    return { id, name, programId, locationId, teamId: options?.team?.id ?? null };
  }

  // -----------------------------------------------------------------
  // One dated occurrence of a class.
  // -----------------------------------------------------------------
  async classSession(
    seededClass: SeededClass,
    options?: { date?: string; start?: string; end?: string; status?: "scheduled" | "completed" | "cancelled" },
  ): Promise<string> {
    const id = newId();

    await withClient((client) =>
      client.query(
        `INSERT INTO class_sessions (id, class_id, session_date, session_start, session_end, status)
         VALUES ($1, $2, $3, $4, $5, $6::session_status)`,
        [
          id,
          seededClass.id,
          options?.date ?? appDateOffsetBy(3),
          options?.start ?? "16:00",
          options?.end ?? "16:30",
          options?.status ?? "scheduled",
        ],
      ),
    );
    this.classSessionIds.push(id);

    return id;
  }

  /** Class membership: this user is in this class. */
  async joinClass(seededClass: SeededClass, user: SeededUser): Promise<string> {
    const id = newId();

    await withClient((client) =>
      client.query("INSERT INTO class_members (id, class_id, user_id) VALUES ($1, $2, $3)", [
        id,
        seededClass.id,
        user.id,
      ]),
    );
    this.classMemberIds.push(id);

    return id;
  }

  // -----------------------------------------------------------------
  // A place on one session: the row a member gives up when they cancel.
  // Returns the session_attendees id, which is the "booking id" the portal
  // sends back - and which the service re-checks against the session before it
  // writes anything.
  // -----------------------------------------------------------------
  async booking(
    classSessionId: string,
    user: SeededUser,
    attendanceStatus: "booked" | "attended" | "absent" | "cancelled" = "booked",
  ): Promise<string> {
    const id = newId();

    await withClient((client) =>
      client.query(
        `INSERT INTO session_attendees (id, class_session_id, user_id, attendance_status)
         VALUES ($1, $2, $3, $4::attendance_status)`,
        [id, classSessionId, user.id, attendanceStatus],
      ),
    );
    this.attendeeIds.push(id);

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
  // Several of these would cascade anyway (a class takes its sessions and its
  // members with it), but they are listed explicitly so the order is a
  // statement of the foreign keys rather than a bet on them.
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

      await remove("session_attendees", "id", this.attendeeIds);
      await remove("class_members", "id", this.classMemberIds);
      await remove("class_sessions", "id", this.classSessionIds);
      await remove("classes", "id", this.classIds);
      await remove("programs", "id", this.programIds);
      await remove("locations", "id", this.locationIds);
      await remove("notifications", "id", this.notificationIds);
      // Invitations reference the inviter, so they go before the users do.
      await remove("user_invitations", "id", this.invitationIds);
      await remove("team_members", "id", this.teamMemberIds);
      await remove("teams", "id", this.teamIds);

      // Signing in, failing to sign in and cancelling a place all write an
      // audit entry, and a two-factor sign-in leaves verification rows behind.
      // None of it blocks the delete - actor_user_id is ON DELETE SET NULL -
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
