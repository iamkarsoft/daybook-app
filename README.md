# Daybook

Tasks, calendar, habits and a focus timer for the Mac. Everything is stored locally; there is no account and no sync.

    npm start          # build and run
    npm run package    # dist/Daybook-darwin-*/Daybook.app
    npm run install-app    # package, then install or update it in /Applications
    npm test           # unit tests
    E2E_DIR=/some/empty/dir node test/e2e.mjs    # drives the app on its own data; set DAYBOOK_BIN to test a packaged build

## Quick add

`Call Ama friday 3pm every week #family !high ~Personal remind 30 min`

Dates, times, repeats, `#tag`, `!high/medium/low` and `~List` are read from what you type and shown as chips. Click a chip to keep it as plain text. ⌃⌥Space opens quick add from any app.

## Menu bar

Click the icon for a panel with today, the next 7 days and Inbox: add, complete, reschedule, start the focus timer and log habits. Click a task to open it in the app. Right-click for Open, Quick Add and Quit. Settings decides whether the icon shows the number due, the next timed task, or nothing; a running timer always shows its countdown.

## GitHub backup

Settings > GitHub backup. Connect with the GitHub CLI, or a fine-grained token with Contents: read and write (kept in the keychain). Choose how often: a few minutes after changes, hourly, daily, or only when asked.

- The repository must be private. This is checked before every upload, and uploads stop if it is made public.
- Only the `daybook/` folder is written: `daybook.json` (everything), `tasks.md` (optional, readable) and `device.json`. No force pushes.
- Backups are not encrypted beyond GitHub's own storage.
- A second Mac, or a reinstall, cannot replace an existing backup until you say so.
- Restore replaces everything, keeps a copy in backups/, and can be undone.
- Automatic backups run only while Daybook is open. Failures retry every 15 minutes and show next to Settings.

Test with `E2E_DIR=/some/empty/dir node test/github.mjs`, which uses a fake GitHub on this Mac.

## Keys

⌘N new task · ⌘K search · ⌘Z undo · ⌘1 to ⌘7 views · ↑↓ move · Space complete · T today · M tomorrow · 0 to 3 priority · ⌫ Trash

## How it behaves

- Dates are local calendar days and wall-clock times, so travel and daylight saving do not move tasks.
- Completing a repeating task leaves a finished copy and moves the task to its next date, skipping any it missed.
- Closing the window keeps Daybook in the menu bar so reminders fire. Reminders missed while it was quit fire at next launch if under 12 hours old.
- Data: ~/Library/Application Support/Daybook/daybook.sqlite, with 14 daily copies in backups/.
- Settings > Import reads a Daybook backup or a CSV with a Title column, including TickTick's CSV backup layout.
