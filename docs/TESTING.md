# Testing CORDITE

Thank you for helping. A useful test takes about ten minutes.

## 1. Get a build

The quickest options need no installation:

| You have | Use |
| --- | --- |
| Any computer or phone | [Play in the browser](https://bassman8k.github.io/cordite/play/) |
| Windows | `Cordite-Portable-win-x64.exe` |
| Linux | `Cordite-linux-x64.AppImage` (run `chmod +x` on it first) |
| macOS | `Cordite-mac-arm64.zip` or `Cordite-mac-x64.zip`: unzip and open |
| Android | `Cordite-android.apk` |
| iPhone or iPad | Open the browser link in Safari, then *Share, Add to Home Screen* |

All files are on the [latest release](https://github.com/Bassman8K/cordite/releases/latest). The builds are not code-signed yet; the [README](../README.md#download) explains the one-time prompt on each system.

**Builds of unreleased changes:** every commit is built by the *CI* workflow. Open the [Actions tab](https://github.com/Bassman8K/cordite/actions), pick the newest green run and download the `cordite-web` artifact, then start it with the scripts in [`launchers/web`](../launchers/web).

**From source:** clone the repository and double-click the script for your system in [`launchers`](../launchers). It installs what it needs and starts the desktop app. Node.js 22 or newer is required.

## 2. Turn on the tester tools

In the game: **Settings, Tester**.

| Option | What it does |
| --- | --- |
| Invulnerable | Take no damage |
| Bottomless magazines | Firing uses no ammunition |
| Unlock every chapter | Start any chapter without finishing the ones before it |
| Performance readout | Frame time, draw calls and triangles on screen |
| Complete objective | While playing: jumps the mission to the next checkpoint |
| Erase progress / Restore default settings | Start again from a clean state |

## 3. What to look at

A pass through this list covers most of the game:

- [ ] The game starts and the menu is readable at your screen size.
- [ ] **Chapter 1:** move, sprint, crouch, aim, fire, reload, swap weapons, throw a grenade, use a medkit.
- [ ] Reach the first checkpoint, pause, quit to the menu and use **Continue**: you resume at that checkpoint.
- [ ] Die on purpose: you restart from the last checkpoint with the right objective.
- [ ] **Armory:** search for a weapon, rotate its model, equip it, and check it appears in the next chapter.
- [ ] Open each of the six chapters (use *Unlock every chapter*) and play a minute of each.
- [ ] **Settings:** change quality, field of view, sensitivity and a key binding; the changes survive a restart.
- [ ] A scoped rifle: the scope view shows the target clearly.
- [ ] Sound: gunfire, footsteps, radio and music play, and the volume sliders work.
- [ ] Touch devices: both thumbs work at once (move and look), and no control sits under a notch or rounded corner.
- [ ] Gamepad, if you have one: sticks move and look, triggers aim and fire.

## 4. Report what you find

Open a [bug report](https://github.com/Bassman8K/cordite/issues/new/choose). The form asks for:

- the version (bottom-left of the main menu) and which file you ran,
- your device, operating system and, on desktop, graphics card,
- the chapter and objective,
- what you did, what you expected and what happened.

A screenshot or short recording helps a great deal. If performance is the problem, turn on the performance readout and include its numbers along with your quality setting.

## Known limits

- Builds are not code-signed or notarised, so each system warns once before running them.
- The native iOS app is unsigned. Use the Home Screen version unless you sign apps yourself.
- Saves stay on the device and in the build that made them: the browser version and the desktop app do not share progress.
