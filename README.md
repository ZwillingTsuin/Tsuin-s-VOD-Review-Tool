# VOD Review Tool

Review your VALORANT games like a coach would. Runs on your own PC, in your browser.

- **Matches**: the ranked games of all your accounts. Each match has the scoreboard, a quick analysis (what went well, what leaked, the lobby's standout), every round on the minimap (you can draw on it, saved per round), and a duel window: click a kill and the map zooms onto that fight with the facts (players alive, weapons, distance, damage, traded or not).
- **VOD review**: go through a match with your Twitch VOD, a recording on your PC, a YouTube upload, or just the minimap. Notes go on a round, a duel and the video time.
- **Pro review**: clutches, retakes, site takes, opening duels and whole games from pros' Twitch VODs, found from their match data. "For you" puts plays on your agents and maps first.
- **Reviews**: everything you reviewed, the ones you haven't finished, and your key lessons.
- **Insights**: your habits across all your matches, next to players on your role in your own lobbies, the best player of each lobby, or a pro.

## What it does on your PC

Worth reading before you run it. The same list is shown in the app's setup.

- **It runs only on your PC.** `Start.bat` starts a small server (Node.js) that only the browser on your PC can reach (`localhost:3710`). Nothing is opened to your network or the internet. No installation, no admin rights, nothing added to Windows startup, no Windows settings changed.
- **It stops by itself** about 45 minutes after you close its last tab (once nothing is downloading anymore), or right away with the power button in the app.
- **It only touches its own folders.** It writes only to its data folder (see [Your data](#your-data)). A recordings folder is read only if you set one, and only the video files in it. It doesn't look anywhere else on your PC.
- **It talks to three services:** [HenrikDev](https://docs.henrikdev.xyz) (your match data, with your key), [valorant-api.com](https://valorant-api.com) (maps and agent, rank and weapon pictures) and, only if you add Twitch keys, Twitch (the public VOD lists of the channels you add). Your browser loads those pictures too, and the Twitch or YouTube player when you watch a video.
- **It never** logs into your Riot or Twitch account, sends anything to its developer or anyone else, collects usage data, updates itself, or starts other programs (apart from opening your browser, and Explorer when you click "Open folder").
- **Your keys** are stored in the data folder, sent only to HenrikDev and Twitch, and left out of backups. Like most app settings they are plain text, so don't share the data folder itself.
- **Everything is readable.** `Start.bat` is a short text file (right-click → Edit). The app has no dependencies (nothing is fetched from npm) and no build step: what's in this folder is what runs.
- Other websites can't use the app: it only answers requests addressed to `localhost`, and every change needs a header only the app's own page sends.

## Setup (about 10 minutes)

### 1. Install Node.js

Get the **LTS** version from [nodejs.org](https://nodejs.org) and install it with the default options. Version 22.13 or newer is needed (`node -v` in a terminal shows yours).

### 2. Get the app

With git (recommended: updating is then one double-click):

```bash
git clone <repository link> "VOD Review Tool"
```

Or download the zip from the repository page and unpack it anywhere, e.g. `Documents\VOD Review Tool`. Windows marks files from a downloaded zip, so the first start may show a warning ("Windows protected your PC" or "The publisher could not be verified"). That is Windows being careful with any unsigned script from the internet: read `Start.bat` if you like, then click *More info → Run anyway* or *Run*. To avoid it, right-click the zip → Properties → *Unblock* before unpacking. A git clone doesn't get this mark.

### 3. Start it

Double-click **`Start.bat`**. A small window says "Starting…", your browser opens the app, and the window closes by itself; the app keeps running without a window. If something is wrong, the window stays open and says what.

- **Stop it** with the power button at the top right of the app, or let it stop by itself (see above).
- **Start it again** with `Start.bat`. If it's already running, that just opens it.
- `Start.bat console` runs it in the window instead and shows everything it does.
- On macOS / Linux: `./start.sh` (runs in the terminal; Ctrl+C stops it).

### 4. Follow the setup guide in the app

The first start opens a short guide:

1. **What the app does on your PC** and where your data goes (you can pick another folder).
2. **A HenrikDev API key** (required, free, two minutes). Your match data comes from the [HenrikDev API](https://docs.henrikdev.xyz), an unofficial VALORANT API.
   - Open the [HenrikDev dashboard](https://api.henrikdev.xyz/dashboard/) and log in (with Discord).
   - Go to **API Keys** in the menu and generate a new key: product **VALORANT**, type **Basic**. You get it right away.
   - Paste the key (`HDEV-…`) into the app and press *Test & save*.
   - If the dashboard doesn't work for you: join the [HenrikDev Discord](https://discord.com/invite/X3GaVkX2YN), go to **#get-a-key** and pick **VALORANT (Basic Key)**.
3. **Your Riot account(s)**: your Riot ID as it shows in game (`Name#TAG`). Add every account you play on. A name change doesn't break anything: the app follows the account and picks up the new name by itself (the same for pros).
4. **Twitch** (optional): needed for pro VODs and for reviewing your own streams.
   - Twitch requires two-factor authentication on your account for this (Settings → Security and Privacy).
   - Open the [Twitch developer console](https://dev.twitch.tv/console/apps) → **Register Your Application**: any unique name, OAuth Redirect URL `http://localhost`, any category (e.g. Other), Client Type **Confidential**.
   - **Manage** → copy the **Client ID**, click **New Secret** and copy it. Paste both into the app.
   - If you stream, add your channel too: your VODs are matched to your games.
5. **Pros** (optional): name, Riot IDs (main and alts) and Twitch channel of players you want to learn from. Their Riot IDs are on tracker.gg, their stream overlay or their socials.

After that your match history downloads in the background. The first time takes a while: the free key allows 30 requests per minute, about 2 seconds per match. The line at the top of the app shows how far it is.

## Your data

Everything stays on your PC, by default in:

| | |
|---|---|
| Windows | `%APPDATA%\VOD Review Tool` |
| macOS | `~/Library/Application Support/VOD Review Tool` |
| Linux | `~/.local/share/vod-review-tool` |

It holds your settings and keys, reviews, notes, screenshots and the downloaded matches (about 30 KB each). **Settings → Your data** shows where it is, opens it, and moves it somewhere else: the data is copied, checked, and only then removed from the old place. A folder synced by OneDrive or Dropbox is not a good place for it (a sync running while the app writes can damage the database).

The same section makes a backup file of your accounts, pros, reviews, notes and drawings, and restores one.

## Updating

The app folder only holds code; your data is somewhere else, so an update never touches it.

- **Downloaded with git:** double-click **`Update.bat`**. It gets the newest version and tells you which one.
- **Downloaded as a zip:** download the new zip and replace the app folder with it.

Then run `Start.bat`: if the old version is still running, the new one replaces it. When a new version changes the database, it upgrades it on the first start and keeps a copy of the old one in the data folder's `backups` folder. What changed is in `CHANGELOG.md`.

## Your own recordings

Set your recordings folder in Settings (OBS, Medal, Outplayed, ShadowPlay …). In a match review, pick *Recording*: the files that were recording during that match are suggested first. MP4 works everywhere; OBS records MKV by default, which browsers often can't play. In OBS: *File → Remux Recordings* turns an MKV into an MP4, or set the recording format to MP4 / fragmented MP4.

To line a video up with the match: pause where a round starts (the barriers drop, the timer shows 1:40) and press **Line up the rounds → Round N starts here**. After that, the round buttons and duels jump to the right second.

## If something doesn't work

- **Nothing happens / the window closes too fast:** run `Start.bat console`; it shows what the app does. The normal mode writes the same to `app.log` in the data folder.
- **"Node.js is too old":** install the current LTS from nodejs.org.
- **Port 3710 is in use:** the app takes the next free one (3711 …) by itself. It never touches another program's port.
- **"The data folder can't be used"** after moving it to a drive that's gone: plug the drive back in, or delete `data-folder.json` in the default folder to go back to it.

## For developers

```bash
npm start          # run in the terminal
npm run dev        # restart on changes, without opening the browser
npm test           # tests (node:test)
node src/server.js --port=3799 --data=./tmp-data --no-open   # another port and a throwaway data folder
```

Plain Node.js (22.13+) with its built-in SQLite, no dependencies, no build step. `src/launch.js` is what `Start.bat` runs; the server is `src/server.js` (routes in `src/routes/`, logic in `src/lib/`); the frontend is plain ES modules in `public/`.
