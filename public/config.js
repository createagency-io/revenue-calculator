/*
 * C.R.E.A.T.E. Revenue Calculator — connection settings
 *
 * Paste your two values from Supabase → Project Settings → API (or "Connect"):
 *   supabaseUrl      = the "Project URL"            (looks like https://abcd1234.supabase.co)
 *   supabaseAnonKey  = the "anon public" key (long code starting with eyJ...)
 *                      OR the newer "publishable" key (starts with sb_publishable_...)
 *
 * It is safe for these two values to be public: the anon key cannot read or change
 * anything on its own. Your data is protected by each person's password and the
 * database rules in supabase/schema.sql.
 *
 * NEVER put the "service_role" / "secret" key in this file.
 */
window.CREATE_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  idleMinutes: 30 // automatic sign-out after this many minutes without activity
};
