/* ===========================================================
   MotoLog online — konfigurasi Supabase
   Isi dua nilai di bawah dari Supabase Dashboard:
     Project Settings → API → Project URL & anon public key
   Kunci anon aman dipublikasikan karena akses dibatasi RLS.
   =========================================================== */
'use strict';

window.MOTOLOG_CONFIG = {
  SUPABASE_URL: 'https://hkhjaixaeeqmofrmilka.supabase.co/rest/v1/',      // contoh: https://abcdefghijklm.supabase.co
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhraGphaXhhZWVxbW9mcm1pbGthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5OTEwOTEsImV4cCI6MjEwOTU2NzA5MX0.fZShazO4WvBi_TPR3piNVUygonJRuQ434JqC6uEnh6A'  // contoh: eyJhbGciOiJIUzI1NiIs...
};
