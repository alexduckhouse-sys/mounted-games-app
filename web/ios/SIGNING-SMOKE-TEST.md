# Signing smoke test (B1-P2): free Apple ID on your own iPhone

This checks one thing: can the app **and** its Live Activity widget extension be signed with a free Apple ID (a "Personal Team") and run on your iPhone, showing a Live Activity the app starts itself.

Nothing here needs the paid Apple Developer Program. The project deliberately has **no Push Notifications capability and no App Group**, because a free team can't sign either. Don't add them.

Only you can run this: it needs your Apple ID, your Mac's Xcode and your iPhone. Simulator results don't count as evidence for this step.

## What you need

- A Mac with Xcode 27.1 or later.
- An iPhone on iOS 17 or later, with a USB cable (or already paired with Xcode over Wi-Fi).
- An Apple ID. A personal one is fine.

## 1. Build the web part and copy it into the Xcode project

From `web/` in this branch:

```sh
npm ci
npx tsc -b
VITE_API_BASE=https://<test site>/api VITE_LIVE_HUB_URL=https://<test api>/hubs/live npx vite build --mode ios
npx cap sync ios
```

Use a **test** deployment's addresses (a preview), never production. The build stops with a message if either address is missing or isn't https. For this smoke test only, the web content doesn't need to load: the Live Activity demo runs without it.

## 2. Sign in to Xcode with your Apple ID

1. Open `web/ios/App/App.xcodeproj` in Xcode.
2. Xcode › Settings › Accounts › **+** › Apple ID, and sign in. A team called "<Your Name> (Personal Team)" appears.

## 3. Choose a bundle id nobody else has used

Free teams can't reuse an id that's taken anywhere, and `uk.co.mgevents.app` may be. In the Project navigator, click the **App** project (blue icon) › select the **App project** (not a target) › Build Settings › search for `MG_BUNDLE_ID` and set it to something unique, for example `uk.co.mgevents.app.<yourname>`.

Both targets read this one setting: the app becomes `MG_BUNDLE_ID` and the widget becomes `MG_BUNDLE_ID.MGLiveActivity`. Don't edit `PRODUCT_BUNDLE_IDENTIFIER` on either target.

## 4. Select your team on **each** target

1. Select the **App** target › Signing & Capabilities › tick "Automatically manage signing" › Team: your Personal Team.
2. Select the **MGLiveActivity** target › Signing & Capabilities › same tick › same Personal Team.

Both must use the same team. Capabilities should show none beyond the defaults (no Push Notifications, no App Groups).

## 5. Run on the iPhone

1. Plug in the iPhone and unlock it. If asked, tap **Trust This Computer**.
2. On the iPhone: Settings › Privacy & Security › **Developer Mode** › on (it restarts). This option only appears after the phone has been connected to Xcode once.
3. In Xcode's toolbar, choose the **App** scheme and your iPhone as the destination.
4. Product › Scheme › Edit Scheme › Run › Arguments › Arguments Passed On Launch › add two entries:
   - `-MGDemoLiveActivity YES`
   - `-MGDemoStepSeconds 15`
5. Press Run (⌘R).
6. The first time, iOS refuses to open the app ("Untrusted Developer"). On the iPhone: Settings › General › **VPN & Device Management** › your Apple ID › **Trust**. Then run again from Xcode.

## 6. What you should see

- The app opens (the web page may show "can't connect" if no test server was given; that's fine here).
- Swipe home or lock the phone. A card for **Hollybrook A** appears on the lock screen, and in the Dynamic Island on iPhones that have one.
- Every 15 seconds it moves through: Checking… › 3 heats to go › 2 › 1 › You're on › Paused › Waiting for the draw › Finished for today, after which it ends.
- iOS stops a backgrounded app after roughly 30 seconds, so the steps may stop while the phone is locked. That's expected: app-driven updates only run while the app is open or briefly in the background. Server-driven updates (closed app) need the paid account and are tested in B2.
- If the card never appears, check Settings › MG App › **Live Activities** is on.

To see a single state and leave it there (for photos), use `-MGDemoStep 4` (0-based: 4 is "You're on") instead of `-MGDemoStepSeconds`.

Each state counts as current for 60 seconds, like the server's `staleAt`. After that iOS marks the card as out of date and it shows "Last update 10:42. Open MG App to refresh." That's deliberate (G4's stale date). Add `-MGDemoStaleSeconds 600` if you want photos without it.

## 7. What to record

Copy this into the gate report:

| Item | Result |
|---|---|
| Date, Xcode version, iPhone model, iOS version | |
| App target signed with Personal Team | Pass / Blocked |
| MGLiveActivity target signed with Personal Team | Pass / Blocked |
| Installed and opened on the iPhone | Pass / Blocked |
| Live Activity shown on the lock screen | Pass / Fail |
| Live Activity shown in the Dynamic Island (if the phone has one) | Pass / Fail / n/a |
| States changed while the app was open | Pass / Fail |
| Screen recording or photos saved at | |

- **Pass** only for what you saw working on the phone.
- If signing fails, mark it **Blocked** and copy the **exact** Xcode error text (Report navigator › the failed build › copy the red line). Common ones and what they mean:
  - "Failed Registering Bundle Identifier … cannot be registered to your development team": the id is taken. Change `MG_BUNDLE_ID` (step 3).
  - "Personal development teams … do not support the Push Notifications capability" (or App Groups): something added a capability. That's a project fault; report it rather than working round it.
  - "Your maximum App ID limit has been reached": free teams can register 10 App IDs per 7 days. Wait, or reuse an id you registered earlier.
- If the phone runs it but no card appears, mark it **Fail** and note whether Live Activities were on in Settings.

## 8. Things to know about free signing

- The app stops opening **7 days** after you install it. Run it from Xcode again to re-sign it.
- A free team can have at most 3 apps installed this way per device.
- Nothing here can send pushes. A Simulator push (`xcrun simctl push`) or an update made by the app itself is never a Pass for G2/G3.
