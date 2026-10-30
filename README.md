# NCC Cadet Challenge

A 7-player online **NCC camp competition** available as an **Android app** and a **website game**. Each match has 3 levels: an obstacle course, target practice and map reading. You don't sign up: enter a name, then create or join a room. Phones and browsers play in the same rooms, from anywhere.

The same code is pushed to both repositories:
- Website: https://github.com/msmathu/NCC-WEBSITE-APP-
- Mobile: https://github.com/msmathu/NCC-MOBILE-APP

`client/` is the single Godot project. It builds the Android APK and the web version (`docs/`).

## Play from anywhere (free)

Double-click **`GO-PUBLIC.bat`** on the PC that hosts the game. It:
1. starts the game server
2. opens a free **Cloudflare quick tunnel** (no account needed), which gives a public `https://<random>.trycloudflare.com` address
3. writes that address to **`server.json`** and pushes it to the website repo

Every app and web page has its server set to `auto` by default. They read `server.json` from GitHub, so players on any network (4G, other Wi-Fi, other cities) connect with no setup, and the app never needs rebuilding when the address changes.

- **Website:** send players the printed `https://….trycloudflare.com` link. That page is the game.
- **Android:** players download the APK from the website's **GET THE ANDROID APP** button (or `docs/download/`). The app finds the server on its own.
- Keep the window open while people play. When the PC is off, online play stops, but Practice mode still works offline.
- A brand-new tunnel address can take a few minutes to reach every phone. If a phone shows **Offline** right after you start `GO-PUBLIC.bat`, turn its Wi-Fi off and on (this clears its DNS cache) or wait a few minutes.
- For a server that's always on, see "Permanent free hosting" below. Once it's set up, put its address in `server.json` and push.

Every tool and service used is free.

| Part | Tool | Licence / cost |
|---|---|---|
| Game client | Godot 4.7 (GDScript) | MIT, free |
| Game server | Node.js + [`ws`](https://github.com/websockets/ws) | MIT, free |
| Database | Node's built-in `node:sqlite` (one file); Supabase Postgres when hosted on Render | free |
| Art | Drawn in code (`cadet_art.gd`, `world.gd`) | no assets to license |
| Music / SFX | Synthesised at startup (`sfx.gd`) | no assets to license |
| Voice commands | The phone's built-in text-to-speech (Hindi voice when installed) | free |
| Hosting | Render free web service (or an Oracle Cloud Always Free VM) | free |

## Folder layout

```
client/            Godot project (open this folder in Godot)
  scripts/
    course.gd        course layout, obstacles, ranks, unlocks (mirror of server/src/course.js)
    net.gd           WebSocket client, auto-reconnect + session resume
    profile.gd       local device id, name, settings
    sfx.gd           synthesised march, effects, TTS drill commands
    main.gd          screen router
    screens/         title, menu, lobby, results, customize, leaderboard, settings
    race/            race controller, world renderer, cadet art, track map
    obstacles/       the 15 obstacle mini-games
  tests/           headless tests (obstacle autopilot, client<->server)
server/            Node.js lobby / matchmaking / race server
  src/lobby.js     rooms, bots, race sync, results, anti-cheat
  src/store.js     cadet profiles + directorate leaderboard (SQLite)
  src/pg-mirror.js loads/saves cadets in Postgres (Supabase) when DATABASE_URL is set
  test/            node:test suite
_tools/            Godot 4.7.2 editor + export templates (self-contained, not committed)
build/             exported APK
```

## Run it

### 1. Start the server (on your PC)

```bash
cd server
npm install
npm start            # listens on :2567, data in server/data/ncc.db
```

Check it's up: http://localhost:2567/health

### 2. Play on your PC

```bash
_tools/Godot_v4.7.2-stable_win64.exe --path client
```

Or open `_tools/Godot_v4.7.2-stable_win64.exe` and import `client/project.godot`. Press F5 to run.

### 3. Play on Android phones

1. Copy `build/ncc-cadet-challenge.apk` to each phone and install it (allow "install unknown apps").
2. Phones and PC must be on the **same Wi-Fi**. Find your PC's IP with `ipconfig` (for example `192.168.1.10`).
3. For a LAN-only game, open **Settings → Game server address** in the app and enter `ws://192.168.1.10:2567`, then tap Save. To play over the internet, leave it on `auto` and use `GO-PUBLIC.bat`.
4. The first time Node runs, Windows Firewall asks for permission. Allow it on private networks.

Practice mode (vs 6 bots) works offline with no server.

### Rebuild the APK

```bash
cd client
../_tools/Godot_v4.7.2-stable_win64_console.exe --headless --export-debug "Android" ../build/ncc-cadet-challenge.apk
```

This uses the Android SDK and JDK already on this machine (paths are in `_tools/editor_data/editor_settings-4.7.tres`).

## Tests

```bash
cd server && npm test        # rooms, auto-start at 7/7, spectators, bots, anti-cheat, reconnect, rank gates

cd client
../_tools/Godot_v4.7.2-stable_win64_console.exe --headless --path . res://tests/obstacle_tests.tscn   # every obstacle is clearable
../_tools/Godot_v4.7.2-stable_win64_console.exe --headless --path . res://tests/map_tests.tscn       # 300 generated Level 3 maps are fair
../_tools/Godot_v4.7.2-stable_win64_console.exe --headless --path . res://tests/net_test.tscn        # needs `npm start` running
```

Visual check: this plays a whole practice race with auto-cleared obstacles and saves a screenshot every 2.5 s.

```bash
_tools/Godot_v4.7.2-stable_win64_console.exe --path client -- --practice --autopilot --shots=C:/some/folder
```

## How the game works

**Lobby.** Enter a name and pick your Directorate; there's no password. The phone stores a random device ID. The server gives the phone a session token, so after a network drop or backgrounding the app you rejoin the same slot (you have 60 s).

A room has a 4-character code and **exactly 7 cadets**. At 7/7, a **10 s countdown** starts on its own. Anyone who joins a full room or a race in progress becomes a **spectator** and can send cheer emojis. The host can also press **Start now**, which fills empty slots with bot cadets.

**The camp: 3 levels per match.** In each level you earn camp points by placing (10/8/6/5/4/3/2 for 1st to 7th). The highest total wins the camp.

| Level | What you do | Score |
|---|---|---|
| **1. Obstacle Course** | all 15 obstacles in one course (3 sections) | finishing place |
| **2. Target Practice** | fictional 25 m game range. The instructor briefs you, then you **choose a position**: Standing (most sway, fastest between targets), Kneeling (balanced) or Lying (steadiest, slowest). These are game effects only. Your cadet and the target sheets are both on screen: drag to aim, hold **BREATH** to steady, and watch the wind. **Stage 1 Position Test:** 3 sighting shots with a group read-out. **Stage 2 Accuracy Test:** hit the numbered sheet the instructor calls. **Stage 3 Final Qualification:** 3 sheets, 6 shots, 2 per sheet, 40 s. Then target analysis and a qualification card. | 0-100 (accuracy 40 + final 60). 70+ Qualified, 80+ Good, 90+ Excellent. Stars give +10/+20/+30 bonus DP. |
| **3. Map Reading & Navigation** | topographic-style training map (1 square = 1 km): grid lines, eastings and northings with tenth ticks, roads, buildings, river, bridge, hill contours, forest, checkpoints and a restricted area. **M1** 4-figure reference of a highlighted building. **M2** 6-figure reference of a small object (a romer overlay appears after a miss). **M3** "Where am I?" (4- then 6-figure). **M4** tap the target from its 6-figure reference. **M5** navigation: direction, distance and route choice (direct, road or trail via the bridge), with the chosen route animated. | 0-1000 (100+150+150+150+50+50+250 + time bonus up to 100). Wrong answer -50. 900+ Excellent, 700+ Qualified, 500+ Training required, below 500 Retrain. |

Everyone in a room gets the same wind and the same map, because the server sends a shared random seed. In Practice you can play the full camp or any single level offline.

**Level 1 race.** Your cadet runs on their own. At each obstacle a mini-game appears and the camera zooms in. The track map at the top shows all 7 cadets live.

| # | Obstacle | Touch | Keyboard |
|---|---|---|---|
| 1 | Straight Balance | tap left/right side on the beat | ← → |
| 2 | Clear Jump | swipe up in the gold zone | ↑ |
| 3 | Zig-Zag Balance | tilt phone (or hold left/right side) | hold ← → |
| 4 | Low Wire Crawl | swipe down, keep holding | hold ↓ |
| 5 | Ramp Climb | rapid taps | Space |
| 6 | Gate Vault | swipe the arrow's direction | ← → |
| 7 | Right Hand Vault | swipe right+up at the mark | → then ↑ |
| 8 | Left Hand Vault | swipe left+up at the mark | ← then ↑ |
| 9 | Step Vault | tap footstep targets | Space |
| 10 | Monkey Crawl Beam | alternate left/right taps | ← → alternately |
| 11 | 6ft High Wall | power taps; nearby cadets give a "buddy lift" | Space |
| 12 | Double Ditch Jump | hold to charge, release in gold; tap mid-air to stretch a short jump | hold/release Space |
| 13 | Rope Climbing | tap when the ring closes | Space |
| 14 | Cargo Net | D-pad / swipes through the knots | arrows |
| 15 | Finish Line Sprint | tap fast, manage stamina | Space |

Section 2 of the course has mud patches that slow you down. In Section 3 you carry a .22 rifle and pack, which also slows you slightly.

**Squad roles** (the host switches these on): SUO/JUO gives a +12 % speed aura to cadets near them. Scouts see warnings earlier and get 35 % wider timing windows. Support cadets give a bigger lift at the High Wall.

**Progression.** Drill Points depend on your final camp place: 100/80/65/55/45/40/35, plus 20 for taking part. A match with only you and bots pays half. The ranks are Cadet → Lance Corporal (300) → Corporal (800) → Sergeant (1600) → Under Officer (3000) → SUO (5000). Higher ranks unlock the Navy White and Air Wing Blue uniforms, beret colours and badges.

**Leaderboard.** The Directorate leaderboard adds up DP for each of the 17 NCC Directorates and also shows the top cadets.

**Anti-cheat.** The server limits how fast progress can increase. It rejects a finish if the course isn't done or the time is under 45 s, and it times races itself.

### Website version

`docs/` is the exported web game. The game server serves it at `http://localhost:2567/` and through the tunnel. To rebuild it:

```bash
cd client
../_tools/Godot_v4.7.2-stable_win64_console.exe --headless --export-release "Web" ../docs/index.html
```

It can also go on **GitHub Pages** for free: in the repo, open Settings → Pages → Branch `main`, folder `/docs`. Pages sites use `server.json` to find the game server. You can add `?server=wss://host` to any web link to use a different server.

## Permanent free hosting on Render + Supabase (no PC needed)

`render.yaml` sets up **one free Render web service** that runs the game server and serves the web game. Profiles and the leaderboard are saved in a free **Supabase** Postgres database (table `ncc_cadets`), because Render's free disk is wiped on every restart. Your PC doesn't need to be on.

1. **Supabase:** create a free project (or reuse one). Click **Connect → Session pooler** and copy the URI (port 5432). Replace `[YOUR-PASSWORD]` with the database password; use only letters and numbers in it.
2. **Render:** **New → Blueprint** → connect GitHub → pick `NCC-WEBSITE-APP-` → **Apply**. Paste the URI into `DATABASE_URL`.
3. Wait for **Live**, then open `https://<service>.onrender.com/health`. It should say `"database":"postgres"`.
4. Set `server.json` to `{"server": "wss://<service>.onrender.com", "web": "https://<service>.onrender.com"}` and push. Installed apps switch over by themselves.
5. **Don't run `GO-PUBLIC.bat` any more:** it overwrites `server.json` with a temporary tunnel address.

Free-plan limits: the service sleeps after 15 minutes without players, and the first player waits about a minute while it wakes (the app retries by itself). Each Render workspace gets 750 free hours a month, shared by all its free services. Without `DATABASE_URL` the server uses the local SQLite file (`server/data/ncc.db`), as on a PC.

## Permanent free hosting on an Oracle VM (always on, players anywhere in India)

1. Create an **Oracle Cloud Free Tier** account and choose **India West (Mumbai)** or **India South (Hyderabad)** as the home region.
2. Create an *Always Free* **Ampere A1** VM running Ubuntu. Open **TCP 2567** in the VCN security list.
3. On the VM:
   ```bash
   sudo apt install -y nodejs npm git   # need Node >= 22.13 (use NodeSource if the distro's is older)
   git clone <your repo> ncc && cd ncc/server && npm install --omit=dev
   sudo npm i -g pm2 && pm2 start "npm start" --name ncc && pm2 save && pm2 startup
   ```
4. Put **Caddy** (free, automatic HTTPS) in front of it with a free domain (for example DuckDNS), so the address is `wss://your.domain`. Browsers on https pages need `wss`.
5. Set `"server": "wss://your.domain"` in `server.json` and push it. All installed apps switch over within about 5 minutes.

## Before publishing

- **Google Play** charges a one-time $25 registration fee. Sideloading the APK and publishing on itch.io are free.
- **Release signing.** Create your own keystore (`keytool -genkeypair ...`), set it in Godot's export preset, and export with `--export-release`. Back up that keystore: you can't update the app without it.
- **NCC name and insignia.** Get permission from your NCC unit or Directorate before publishing under the NCC name.
- **Tilt direction.** Steering uses the accelerometer and still needs checking on a real phone. If it steers the wrong way, turn on **Settings → Invert tilt**.
