# Kharcha — In-App Update System & Release Process

How the Android app updates itself, and the exact steps to ship every future
version. Read this before bumping any version number.

---

## 1. How the update system works

```
App opens
  ↓ (2.5s after launch, once per session)
Check connectivity (expo-network)          ── offline → skip silently
  ↓
GET https://<backend>/api/app-version      ── timeout 10s, any failure → skip silently
  ↓
Validate response (strict schema)
  ↓
Compare versionCodes (INTEGER compare)
server.versionCode > installed.versionCode ?
  ├─ no  → nothing happens
  └─ yes → "New Update Available" dialog
              ├─ Later      → dialog closes, app continues (optional updates)
              └─ Update     → download APK to app cache (progress %)
                               ↓ download completes
                             Android package installer opens (content:// URI)
                               ↓ user confirms
                             app updated in place
```

Key properties:

- **The backend is the single source of truth.** The app contains NO version
  configuration except its own installed versionCode (read from the build via
  `expo-application`). No download URLs are hardcoded in the app.
- **Once per launch.** The check never repeats on navigation/render (module
  flag + guard refs, StrictMode-safe).
- **Never blocks, never crashes.** Offline / API down / timeout / 404 / 500 /
  invalid JSON / invalid payload / missing versionCode — every failure path
  resolves silently and the app opens normally.
- **versionCode is the ONLY comparison value.** Semantic version strings
  ("1.1.0") are display-only.
- **Download → `.part` file → verified move.** A corrupt/interrupted download
  can never be handed to the installer. A *complete* APK from a previous
  attempt (same versionCode) is reused — e.g. returning from the Android
  "install unknown apps" consent screen retries without re-downloading.
- **60-second no-progress watchdog.** A hung socket cancels itself into the
  "Update failed / Retry / Cancel" dialog instead of spinning forever.

### Feature code map (`src/features/update/`)

| File | Role |
| --- | --- |
| `types.ts` | `RemoteRelease` (validated payload), `UpdatePhase` (dialog state machine) |
| `validation.ts` | Strict response validation — null on any violation (unit-tested) |
| `api.ts` | Connectivity check (`expo-network`) + fetch with 10s `AbortController` timeout |
| `config.ts` | Backend URL from `app.json → expo.extra`, installed versionCode (`expo-application`) |
| `installer.ts` | APK download with progress + install intent (`expo-file-system/legacy` + `expo-intent-launcher`) |
| `useAppUpdate.ts` | Once-per-session check + download/install state machine |
| `AppUpdateDialog.tsx` | Themed dialog (available / downloading / launching / failed) |
| `AppUpdateManager.tsx` | Root-level mount point |

---

## 2. Current state — 1.2.0 (Smart Notifications release)

```
version:      1.2.0
versionCode:  3          (app.json → expo.android.versionCode)
```

`app.json` now says **1.2.0 / 3** — bumped for the Smart Notifications
release (local-only `expo-notifications` feature). Ship it by building the
APK (step 3.2), hosting it (3.3), and pointing the backend at it (3.4) —
see the versionCode ledger in section 4. Never reuse an old versionCode.

---

## 3. Releasing version 1.1.0 (first in-app-update-capable release)

### 3.1 Bump the version

`app.json`:

```diff
-    "version": "1.0.0",
+    "version": "1.1.0",
     ...
     "android": {
       "package": "com.kharcha",
-      "versionCode": 1,
+      "versionCode": 2,
```

### 3.2 Build the APK (Codemagic)

The existing `kharcha-android-apk` workflow already does everything:
`npm ci` → Jest suite → `expo prebuild --platform android --clean` →
`./android/gradlew assembleRelease`. Trigger a build and download the APK
artifact (`android/app/build/outputs/apk/release/*.apk`).

> **⚠️ Signing — the one thing that can break updates.**
> Android refuses to install an update whose signing key differs from the
> installed app (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Codemagic currently
> builds with the **template debug keystore**, which is stable per build
> machine but NOT guaranteed across machines/rebuilds.
> **Before shipping 1.1.0, pin a keystore:** generate one keystore, keep it
> safe (you can never lose it), and configure signing in `android/app/build.gradle`
> (or Codemagic code signing settings) so every future build uses the SAME key.
> If 1.0.0 was distributed from a debug-keystore build, 1.1.0 must be built
> with that same keystore.

### 3.3 Host the APK at a direct HTTPS URL

The `apkUrl` sent by the backend must be a **direct file link** (the app
downloads it, it is not a browser). Proven options:

- **Google Drive** (what the landing page already uses): upload the APK, copy
  the share link, and convert it to the direct form:
  `https://drive.usercontent.google.com/download?id=<FILE_ID>&export=download&confirm=t`
- **GitHub Releases** (recommended long-term): create a release tagged
  `v1.1.0`, attach the APK — the asset URL is a stable, fast, direct link:
  `https://github.com/<user>/<repo>/releases/download/v1.1.0/kharcha-1.1.0.apk`

Do NOT serve the APK from the Cloudflare Worker's own asset bundle —
Workers assets are capped at 25 MiB per file, and APKs grow past that.

### 3.4 Configure the backend (choose ONE)

Both places are validated identically (version string, positive integer
versionCode, **HTTPS** apkUrl). Sources are checked in this order:

1. env bindings (if fully configured) — explicit ops override, immune to DB outages
2. MongoDB `app_releases` — default store
3. `APP_RELEASE_SOURCE=environment|database` forces one mode

**Option A — MongoDB `app_releases` (default, preferred):**

Atlas web UI → your cluster → Browse Collections → database
`kharcha_analytics` → Create Collection `app_releases` → Insert Document:

```json
{
  "platform": "android",
  "version": "1.1.0",
  "versionCode": 2,
  "apkUrl": "https://drive.usercontent.google.com/download?id=XXXX&export=download&confirm=t",
  "releaseNotes": [
    "Added the in-app update system",
    "Performance improvements",
    "Fixed minor bugs"
  ],
  "mandatory": false,
  "enabled": true
}
```

or with `mongosh`:

```js
use("kharcha_analytics")
db.app_releases.insertOne({
  platform: "android", version: "1.1.0", versionCode: 2,
  apkUrl: "https://…", releaseNotes: ["…"], mandatory: false,
  enabled: true, createdAt: new Date(), updatedAt: new Date(),
})
```

Rules: highest `versionCode` among `enabled: true, platform: "android"` docs
wins; set `enabled: false` to pull a bad release without deleting it.

**Option B — Cloudflare env bindings (override):**
Dashboard → Workers → `kharcha-web` → Settings → Variables and Secrets →
**Production** tab → add as **Secret**, then redeploy:

| Name | Example |
| --- | --- |
| `APP_LATEST_VERSION` | `1.1.0` |
| `APP_LATEST_VERSION_CODE` | `2` |
| `APP_LATEST_APK_URL` | `https://…direct download link…` |
| `APP_RELEASE_NOTES` | `["Added the in-app update system","Bug fixes"]` (JSON array) |
| `APP_UPDATE_MANDATORY` | `false` |
| `APP_RELEASE_SOURCE` | `environment` (optional force-flag) |

### 3.5 Verify

```bash
curl -s https://kharcha-web.miankhizar-per.workers.dev/api/app-version
# → {"version":"1.1.0","versionCode":2,"apkUrl":"https://…","releaseNotes":[…],"mandatory":false}
```

---

## 4. Future releases — versionCode ledger

| version | versionCode | notes |
| --- | --- | --- |
| 1.0.0 | 1 | production (no in-app updater) |
| 1.1.0 | 2 | first release with the update checker |
| 1.2.0 | 3 | Smart Notifications (local-only, expo-notifications) |
| next   | 4 | always `last + 1`, never reuse |

Every release: bump BOTH `version` and `versionCode` in `app.json`, build,
host, insert/publish the new release config, verify with the curl above.
Old versionCodes are never reused; to yank a bad build, ship a *higher* one.

---

## 5. Test matrix (manual, on a device)

| # | Scenario | How to simulate | Expected |
| --- | --- | --- | --- |
| 1 | No internet | Airplane mode on, launch | App opens normally, no dialog, no error |
| 2 | API unavailable | Set `extra.updateApiBaseUrl` to a dead host (or stop the backend), launch | Opens normally, silent |
| 3 | Server versionCode = installed | Backend doc `versionCode: 1` vs installed 1 | No dialog |
| 4 | Server versionCode > installed | Backend `versionCode: 2` vs installed 1 | Update dialog appears |
| 5 | Optional update | `mandatory: false`, tap **Later** | Dialog closes, app usable, re-prompts next launch |
| 6 | Mandatory update | `mandatory: true` | No Later button, backdrop/back do nothing, only Update |
| 7 | Download success | Tap Update on a real APK URL | Progress % → installer opens |
| 8 | Download failure | Point apkUrl at a 404 URL | "Update failed / Please try again later." with Retry/Cancel |
| 9 | Invalid API response | Configure invalid payload (e.g. `http://` apkUrl) | Silently ignored (no dialog) |
| 10 | App restart | Kill + relaunch after "Later" | Check runs again once, no duplicates, no repeat fetch spam |
| 11 | Install/update flow | Accept the installer prompt | App updates, launches, all data intact (SQLite preserved) |

Extra things worth one look each: first-install consent screen (Android 8+
asks to allow installs from Kharcha once — after granting, tap Update again,
the APK is already cached), dark/light dialog theming, and the existing
expense/income/analytics features after updating.

**Regression safety net:** `npx tsc --noEmit` + `npx jest` (49 suites,
883 tests, incl. 35 new update-validation tests) — all green with this feature.

---

## 6. Android requirements & limitations

- **Same package name** (`com.kharcha`) — enforced; never change it.
- **Same signing key** as the installed app (see 3.2) — different key =
  uninstall/reinstall (data loss for users who never backed up).
- **Strictly higher versionCode** — equal or lower is rejected by Android.
- **`REQUEST_INSTALL_PACKAGES`** permission was added to `app.json`; Android
  8+ gates it behind the per-app "Install unknown apps" consent (the system
  handles prompting; the app never sees or stores that choice).
- **Downgrades are impossible** via the installer — a user on versionCode 3
  cannot "update" to 2. Test devices must be reset/uninstalled to downgrade.
- **The bootstrap gap:** every user still on the OLD 1.0.0 build has no
  update checker — 1.0.0 → 1.1.0 happens the same way as today (landing page
  download). From 1.1.0 onward every future update reaches users in-app.
- **Google Play note (if ever relevant):** self-update APK delivery violates
  Play policy — this flow is for direct APK distribution (landing page /
  Codemagic artifacts), which is exactly how Kharcha ships today.
- **In-app updates are Android-only** (`Platform.OS !== 'android'` short-
  circuits everything) — the iOS build is unaffected.
