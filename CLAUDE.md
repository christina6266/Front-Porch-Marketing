# Read this first: which app are we talking about?

The owner has several projects with similar names. **Always confirm which app a request
is about before changing anything.** If it's unclear, ask: "Is this for the **Lights app**
or the **FrontPorch app**?"

| Say this | What it is | Where the code is | Railway project | Web address |
|---|---|---|---|---|
| **Lights app** (also "Trimlight", "my lights") | Controls the owner's Trimlight Edge house lights | `trimlight-control/` folder in this repo | `creative-presence` | `front-porch-marketing-production-c68a45d6.up.railway.app` (name is misleading; it is the lights app) |
| **FrontPorch app** (FrontPorch Marketing, canvassing, door-to-door, flyers) | The canvassing and marketing business platform | Root of this repo: `server.js`, `dashboard.html`, `canvasser-app.html`, etc. | `radiant-emotion` | — |
| **`frontporch-marketing`** (all lowercase, private) | A different repository | Not this repo | — | — |

Rules:
- Work on the **Lights app** happens only inside `trimlight-control/`. **Before starting, read
  `trimlight-control/CLAUDE.md`.** It covers the deployment, Trimlight API quirks, the
  features built so far, the owner's preferences, and how to test.
- Work on the **FrontPorch app** happens only in the root files. Never touch `trimlight-control/`.
- Never edit the lowercase `frontporch-marketing` repository unless the owner names it explicitly.
- A good way to start a session is for the owner to say "Lights app" or "FrontPorch app".
  If they don't, ask.
- Planned: the Lights app may move to its own repository, `christina6266/trimlight-control`.
  If that repository exists and is attached, the Lights app lives there instead, so check before working here.
