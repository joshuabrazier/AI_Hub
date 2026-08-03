import "server-only";

import { CamelCasePlugin, Kysely, PostgresDialect, Transaction } from "kysely";
import { Database } from "./kysely-database-types";
import { Pool, types as pgTypes } from "pg";
import { envServer } from "../env-server";
import { SITE_MODES } from "../constants";

// -------------------------------------------------------------------
// Return DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings instead
// of JS Date objects. node-postgres parses DATE into a Date by default,
// which both breaks rendering (Date is not a valid React child) and
// risks a timezone day-shift. Date-only values stay strings end-to-end.
// -------------------------------------------------------------------
pgTypes.setTypeParser(pgTypes.builtins.DATE, (value) => value);

// -------------------------------------------------------------------
// Configure Kysely PostgresDialect
// -------------------------------------------------------------------
const dialect = new PostgresDialect({
  pool: async () =>
    new Pool({
      // database: envServer.DATABASE_NAME,
      // host: envServer.DATABASE_HOST,
      // port: envServer.DATABASE_PORT,
      // user: envServer.DATABASE_USER,
      // password: envServer.DATABASE_PASSWORD,
      connectionString: envServer.DATABASE_URL,
    }),
});

// -------------------------------------------------------------------
// Configure Kysely
// -------------------------------------------------------------------
export const database = new Kysely<Database>({
  dialect,
  plugins: [new CamelCasePlugin()],
  //------------------------------------------------------------------
  // Uncomment code below to log SQL queries
  //------------------------------------------------------------------
  log(event) {
    // Query parameters can contain sensitive data (password hashes, emails,
    // tokens), so never log them outside development. Verbose per-query logging
    // is a development-only debugging aid.
    const isDevelopment = envServer.MODE === SITE_MODES.DEVELOPMENT;

    if (event.level === "error") {
      console.error("Query failed : ", {
        durationMs: event.queryDurationMillis,
        error: event.error,
        sql: event.query.sql,
        params: isDevelopment ? event.query.parameters : undefined,
      });
    } else if (isDevelopment) {
      console.log("Query executed : ", {
        durationMs: event.queryDurationMillis,
        sql: event.query.sql,
        params: event.query.parameters,
      });
    }
  },
});

export type DBClient = Kysely<Database> | Transaction<Database>;
