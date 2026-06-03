# CanvasHQ — How to Run

## Quick Start

### 1. Install dependencies (one time, or after adding packages)
```
cd ~/Documents/Claude/Projects/Building\ a\ web\ browser\ for\ door\ to\ door
npm install
```

### 2. Start the server
```
node server.js
```

You'll see:
```
🚀 CanvasHQ server running at http://localhost:3000
```

### 3. Open the apps

| App | URL | Who uses it |
|-----|-----|-------------|
| Dashboard | http://localhost:3000/dashboard.html | Christina (you) |
| Canvasser App | http://localhost:3000/canvasser-app.html | Canvassers on their phones |
| Customer Portal | http://localhost:3000/customer-portal.html?token=TOKEN | Customers (link emailed automatically) |

**Dashboard login:** christina@heliogrowth.com / demo123

**Canvasser PINs (demo):**
- Marcus = 1111
- Priya = 2222
- DeShawn = 3333
- Sofia = 4444
- James = 5555
- Aisha = 6666

---

## What's been built

### Dashboard (Christina's view)
- **Live map** — satellite view with canvasser positions, territory zones, building footprints, flyered homes with photo proof
- **Canvassers** — add/edit/delete canvassers, auto-generated PINs, leaderboard, accountability scores
- **Messages** — real-time 1:1 chat with each canvasser (WebSocket)
- **Payouts** — live weekly totals from DB (flyered homes × tier rate), approve individual or all at once
- **Schedule** — weekly grid, click cells to assign shifts (Morning/Afternoon/Full Day), persists to DB
- **Canvasses** — create campaigns with customer name + email, portal link generated automatically

### Canvasser App (phone)
- Login with first name + PIN
- **Home tab** — homes flyered today, earnings estimate, shift time, current zone, schedule
- **Zones tab** — see available customer zones, claim one (one person per zone), release when done
- **Map tab** — satellite view of their zone, tap a building → take photo → logged and paid
- **Messages tab** — real-time chat with Christina, badge dot for unread
- **Milestone toasts** — motivational messages at 10, 25, 50, 100, 250, 500 homes

### Customer Portal (customers)
- Token-based access via emailed link (no login needed)
- Live satellite map with all flyered homes as green photo pins
- Zone breakdown showing progress per area
- Full photo proof feed — every verified home with canvasser name + timestamp
- Click any photo → lightbox with GPS coordinates + Street View link
- Real-time WebSocket updates + in-app notification when new homes are flyered

---

## Sharing with canvassers

**Same WiFi:** Find your IP (System Preferences → Network) and share:
`http://[your-ip]:3000/canvasser-app.html`

**Anywhere (field use):** Use ngrok:
```
ngrok http 3000
```
Then share the ngrok URL. Set `SERVER_URL=https://your-ngrok-url` for email links to work.

---

## Enabling real emails (optional)

Set these environment variables before starting the server:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=your@gmail.com
export SMTP_PASS=your-app-password   # Gmail: use an App Password
export SERVER_URL=https://your-public-url
node server.js
```

Without these, milestone emails print to the console instead of sending.

**Emails that get sent automatically:**
- Welcome email when a canvass is created with a customer email
- Milestone emails to the customer at 10, 25, 50, 100, 250, 500 homes flyered

---

## Payout tiers

| Tier | Rate | Requirement |
|------|------|-------------|
| Starter | $0.10/home | Any |
| Pro | $0.18/home | 3+ days · 1,000+ homes/week |
| Elite | $0.25/home | 4+ days · 1,500+ homes/week |

Cashout threshold: 500 homes. Resets every Monday.

---

## Resetting demo data

Delete `canvashq.db` and restart the server to re-seed fresh demo data including 4 zones across 2 active canvasses.
