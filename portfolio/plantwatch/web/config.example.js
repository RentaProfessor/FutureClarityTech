// Copy this file to config.js (gitignored) and fill in your Supabase project
// (Supabase dashboard > Project Settings > API).
//
// The anon key is a public key: it only grants what row-level security allows,
// so it is safe to serve to browsers. It is kept out of git so that each
// deployment points at its own project.
//
// Without a config.js, or with these placeholders left in place, the dashboard
// starts in demo mode with sample data.
//
// index.html's Content-Security-Policy allows *.supabase.co and localhost. A
// self-hosted Supabase on another domain must be added to its connect-src.
window.PLANTWATCH_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-SUPABASE-ANON-KEY",
};
