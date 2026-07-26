import 'fake-indexeddb/auto'

// Vite injects import.meta.env at build time; provide a stub for tests.
// (Supabase stays undefined -> pure local mode, which is what unit tests use.)
