/* ============================================================
   Ainex — Supabase connection config
   Get these from your Supabase dashboard: Project Settings > API
   The anon/public key is safe to expose in frontend code — it only
   works within the Row Level Security rules defined in schema.sql.
   ============================================================ */

const SUPABASE_URL = 'https://odttvcywjbnsqoufupqs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kdHR2Y3l3amJuc3FvdWZ1cHFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMjcxMDEsImV4cCI6MjEwMjYwMzEwMX0.kwIwa3j-A0MGOlfDHZz_RI5JaSRtfW45tt0_Hrs2BFU';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
