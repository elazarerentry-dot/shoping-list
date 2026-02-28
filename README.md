# 🏠 Family List

A warm, friendly shared list app for the whole family — with accounts, families, and persistent storage.

## Features
- ✅ Sign up & log in with email + password
- 👨‍👩‍👧‍👦 Create a **Family** with a password and get a unique invite code (e.g. `BLUE-7492`)
- 🔗 Others **join your family** with the invite code + password
- 🗄️ **SQLite database** — data persists between restarts
- Add items with category, urgency & notes
- Tick off items when done
- Filter by category or urgent items
- Save reusable lists (stored on your device)
- Auto-refreshes every 30s — all family members see the same list
- Works on phones too!

---

## Run Locally

```bash
npm install
npm start
# Open http://localhost:3001
```

**First time:** Sign up → Create or join a family → Start adding items!

---

## Deploy (Free — 5 minutes)

### Railway (Easiest)
1. Push this folder to GitHub
2. railway.app → New Project → Deploy from repo
3. Get a live URL → share with family

> **Note:** Railway's filesystem can reset on redeploys. To make storage permanent on Railway, add a Volume to your project pointing at `/app` (or wherever your server runs).

### Render
1. Push to GitHub
2. render.com → New Web Service → connect repo
3. Build: `npm install` | Start: `npm start`

---

## How It Works

| Step | What happens |
|------|-------------|
| Sign up | Creates an account with your name, email & hashed password |
| Create Family | Makes a new family, gives you an invite code like `BLUE-7492` |
| Share code | Tell family members your invite code + the family password |
| Join Family | Enter the code + password to join — you now share the same list |
| Add items | Items are saved to the database and visible to all family members |

---

## File Structure

```
server.js          — Express API + SQLite database
index.html         — Full frontend (put in /public folder or serve as static)
package.json       — Dependencies
familylist.db      — Created automatically on first run
```

> **Tip:** The `index.html` should be placed in a `public/` folder so Express can serve it, OR serve it directly via `app.get('/', ...)`.
