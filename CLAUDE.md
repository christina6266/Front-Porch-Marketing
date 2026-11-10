# Repository layout

This repository holds two **separate** apps. Keep them separate.

- **FrontPorch Marketing**: the files at the repository root (`server.js`, `*.html`).
  It is a door-to-door canvassing platform, deployed as its own Railway project.
- **Trimlight Control**: everything in `trimlight-control/`. It is a standalone app that
  controls the owner's Trimlight Edge house lights, deployed as a different Railway project.
  **Before working on the lights app, read `trimlight-control/CLAUDE.md`.** It covers the
  deployment, the Trimlight API quirks, the features built so far, the owner's preferences,
  and how to test.
