# Sky_View project work (formerly Atlas Watch)

- Before adding or proposing a feature, search the current source and matching tests for its workflow, adapters,
  persistence and UI. Improve the existing implementation when it already addresses the request.
- Read `docs/PROGRESS.md` and the later v0.5–v0.7 sections of `docs/FEATURES-v0.4.md`. The original
  `docs/FEATURE_MATRIX.md` is historical; its missing-feature rows must be checked against current code.
- Preserve working features and user changes, settings, saved locations, watchlists and recorded history.
- Keep real observations, predictions, reported journeys, unavailable fields and simulated visual effects distinct.
  Never silently substitute demonstration data into a production provider.
- Preserve Electron isolation, narrow validated IPC, destination allow-lists and encrypted credentials. Do not
  activate billing, create accounts, publish deployments or send messages without explicit authorization.
- Verify the workflow affected by a change. Record source evidence, completed repairs, live checks, credential
  limits and next steps in `docs/PROGRESS.md`; passing fixture tests alone do not establish live verification.
