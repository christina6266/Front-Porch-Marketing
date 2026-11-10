# Trimlight Control

A small app to control Trimlight Edge lights from your phone. It has no
dependencies, so there's nothing to install.

It can turn lights on, off, or back to their schedule; show custom colors and holiday presets
(Christmas, Halloween, USA, St. Patrick's, Valentine's); set brightness and speed;
step through the 180 built-in animations; and run patterns saved on the controller.

## Setup

1. Get your **Client ID** and **Client secret** at https://trimlight.ledhue.com ("Get API credentials").
2. Set these environment variables (on your host, e.g. Railway → Variables). **Never commit them.**

   | Variable | What it is |
   |---|---|
   | `TRIMLIGHT_CLIENT_ID` | Client ID from Trimlight |
   | `TRIMLIGHT_CLIENT_SECRET` | Client secret from Trimlight |
   | `APP_PASSWORD` | A password you choose for this page |
   | `DATA_DIR` | Optional. Folder for saved timers, e.g. `/data` on a Railway volume |

3. Start it with `npm start` (or `node server.js`), then open the site and sign in with `APP_PASSWORD`.

## Pattern Builder

Works like Trimlight's own pattern screen: 30 zones, each with its own color and
number of LEDs. Tap a zone, tap a color to paint it (it moves to the next zone),
and set the LED count with − / +. Empty zones are skipped and the pattern repeats
around the whole house. Pick an animation, brightness and speed, then **Show on
lights** or **💾 Save** it to *My patterns*. Saved patterns can be used in timers.
Themes load into the builder too, so any theme can be tweaked and saved.

## Timers

The ⏰ Timers card schedules any number of actions: turn on, turn off, or show a
theme (moving or still). Each runs at a clock time or relative to sunset/sunrise,
on chosen days, for All lights, Backyard, or one controller. The server runs them,
so your phone can be off.

- Sunrise/sunset are worked out fresh every day for **Austin, TX** in **Central Time**
  (daylight saving included), so sunset timers follow the real time all year.
- Somewhere else? Set `HOME_LAT`, `HOME_LON`, `HOME_NAME` and `HOME_TIMEZONE`
  (e.g. `America/Denver`), or tap **📍 Use this phone's location** on the page.
- **Keep timers across redeploys (Railway):** open the service, choose **Attach volume**
  (or right-click the service → Volume), mount it at `/data`, then add the variable
  `DATA_DIR` = `/data`. Without a volume, timers are erased on each redeploy and the
  page shows a warning.

## API

All routes except `/api/login` need `Authorization: Bearer <token>`.

| Method | Path | Body |
|---|---|---|
| POST | `/api/login` | `{ "password": "..." }` |
| GET | `/api/devices` | |
| GET | `/api/devices/:id` | |
| POST | `/api/devices/:id/switch` | `{ "state": "on" \| "off" \| "timer" }` |
| POST | `/api/devices/:id/custom` | `{ "colors": ["#ff0000"], "mode": 0-16, "brightness": 0-255, "speed": 0-255, "ledsPerColor": 1-60 }` |
| POST | `/api/devices/:id/builtin` | `{ "mode": 0-179, "brightness", "speed" }` |
| POST | `/api/devices/:id/effects/:effectId/run` | |

## Deploying on Railway (separate from FrontPorch)

This folder is its own app. It lives in the Front-Porch-Marketing repository but
shares no code, data or login with FrontPorch.

1. In Railway, create a **New Project** → **Deploy from GitHub repo** → `Front-Porch-Marketing`.
2. Open the new service → **Settings** → **Root Directory** → `trimlight-control`.
3. **Variables**: add `TRIMLIGHT_CLIENT_ID`, `TRIMLIGHT_CLIENT_SECRET`, `APP_PASSWORD`.
4. **Settings** → **Networking** → **Generate Domain**, then open it on your phone.
