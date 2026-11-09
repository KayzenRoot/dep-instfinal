# Browser smoke checks

`npm run test:e2e` starts with all service credentials blank. It verifies the anonymous boundary, the health/setup response, CSRF rejection, and the login layout at the required widths. It does not establish live Supabase authentication or the authenticated app experience.

CI starts the repository's local Supabase stack and runs `npm run test:e2e:local`. That wrapper refuses non-local Supabase URLs, creates random synthetic owner/non-owner users through the local Auth admin API, passes only the local anon key and owner UID to the app, then tests valid/invalid login, owner UID enforcement, a persisted series across sign-out/sign-in, and the anonymous boundaries. The local service-role key is used only by the bootstrap process and is not passed to Playwright or the app.

Screenshots are written under the ignored `test-results/screenshots/` directory. The CI workflow uploads this directory as evidence.
