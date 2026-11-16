# Launchers

One-click scripts for testers.

## Run the desktop game from this repository

Needs [Node.js](https://nodejs.org) 22 or newer. The first run installs the project's dependencies and takes a minute or two; after that it starts in seconds.

| System | Do this |
| --- | --- |
| macOS | Double-click `Play-Cordite.command` (the first time: right-click, *Open*) |
| Windows | Double-click `Play-Cordite.bat` |
| Linux | Run `./play-cordite.sh` |

## Run a web build

The scripts in [`web`](web) serve a web build on your own machine and open it in the browser. They ship inside `Cordite-web.zip` on every release and work with the `cordite-web` artifact from any CI run: copy them next to `index.html` and start the one for your system. They need Python 3 or Node.js.

## No scripts needed

Ready-made launchers for people who just want to play are on the [latest release](https://github.com/Bassman8K/cordite/releases/latest): the portable Windows `.exe`, the Linux AppImage and the macOS `.zip` all run without installing.
