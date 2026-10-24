// js/config.js.
const SUPABASE_URL = 'https://mtopqypcrmzihmfueujy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10b3BxeXBjcm16aWhtZnVldWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDQ2OTMsImV4cCI6MjEwNzU4MDY5M30.oocXGBr6pBA7GS1KjOhWIPejHausQ3k9UgRxKQ0fgh4'; 

// Initialize without 'window.'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// HANYA masukkan Anon Key (Public). 
// JANGAN SKALI-KALI masukkan Service Key dalam frontend.