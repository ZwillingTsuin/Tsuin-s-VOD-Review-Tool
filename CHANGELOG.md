# Changelog

## 0.6.0

- Setup has a new step, "Your PC": what the app does on your PC (runs only locally, stops by itself, which folders it touches, which services it talks to, what it never does) and where your data is saved. The same is in Settings and in the README.
- The data folder can be moved (Settings → Your data → Change…, or during setup): it is copied, checked, and only then removed from the old place. "Open folder" shows it in Explorer. Folders synced by OneDrive or Dropbox get a warning.
- Start.bat no longer uses PowerShell to hide the window. A short window says "Starting…" and closes when the app runs; if it can't start, the window stays open and says why.
- If port 3710 is used by another program, the app takes the next free one instead of opening that program. If an older version of the app is still running after an update, Start.bat replaces it.
- A recordings folder is only read once you set one (it used to default to your Videos folder).
- Downloaded matches are stored compressed: about 13× less disk space. Existing ones are compressed in the background after the update.
- A banner says when the app has stopped (it stops by itself about 45 minutes after its last tab is closed) and when an update is installed but the old version still runs. The app no longer stops right after the PC wakes from sleep.
- Notes in a review: the panel keeps a fixed height, so new notes no longer push it below the player or shift the writing area out of reach (it happened on smaller windows); only the list scrolls. The list shows the notes of the round you are on, with "Whole game" and "All" one click away. "Overview" opens every note of the review in a big window, grouped by round, focus or key lesson. A saved note has a full-screen button next to the star, pencil and bin.
- One full-screen button for writing: the red one in the editor's toolbar (also when editing a saved note).
- The match page's "Continue review" counts the notes again (it always said 0).
- The Twitch secret is sent in the request body instead of the URL.
- Cleanup: unused code and styles removed.

## 0.5.1

- Picked options in menus (the "Saved to" menu, dropdowns) keep white text. The cause was one general "selected button" style (white background, dark text) that leaked into every menu; it is gone, and a test now fails if it or a similar rule comes back.
- While writing, pictures show a normal pointer (a click opens the size bar); a double-click opens them big.

## 0.5.0

- Pictures in notes have a size: folded into a small "Screenshot" button, S, M, L or full width. Click a picture while writing (or hover it in a saved note) for the size bar; the size is saved with the note. Pasted screenshots start at M, map pictures at S.
- The full screen editor has a clear "Full screen" button at the top of the notes (and in the toolbar when editing a note).
- "Key lesson" instead of the bare star / "Lesson": it says what it does (the note is collected on the Reviews page under "Key lessons").
- A note can be saved to the round you are on (the default), to several rounds, or to the whole game ("Saved to …" next to Add note, and when editing a note). The list shows "R3, R5, R8" or "Whole game", and the notes of the round you are on are marked.

## 0.4.0

- Draw on the round map: pen, arrow, line, circle, eraser, five colours, three sizes, undo / redo (Ctrl+Z / Ctrl+Y). Every round keeps its own drawing (saved by itself, the same on the match page and in the review, and in backups). In a review, "Add to note" puts the map with the drawing, the round's deaths and the spike into your note as a picture.
- The note editor opens in a big window over the page (the page behind it blurred) with the expand button; Esc or the button brings it back.
- Screenshots in saved notes can be folded into a small "Screenshot" button and opened again (remembered per screenshot).
- Minimaps are served by the app and kept in the data folder (they also work offline now).

## 0.3.0

- Notes are a real editor now: bold, italic, underline, strikethrough, headings, lists, quotes, links, and screenshots (paste with Ctrl+V, drop a file in, pick one, or take the current frame of a recording on your PC). Pictures are stored in the data folder and go into backups. A draft is kept while you type. Beside a video, the writing area takes the bigger part of the notes panel.
- Pro review: the streamer's Twitch picture, small, on every play, in the study window and in Settings.
- Insights: you in Valorant off-white and the benchmark in grey (green / red stay for better / worse); the icons on the top tiles are gone again.
- Map tabs keep their text white when picked and no longer zoom into a corner on hover; the pulsing ring around the planted spike is gone; agent pictures on cards sit on frosted glass instead of a dark border.
- Dropdown options stay white.

## 0.2.0

- Runs without a terminal window: Start.bat starts it in the background, the power button stops it, and it stops by itself after 45 minutes without an open tab and nothing to download. `Start.bat console` still shows the window.
- Setup: a closed flow without the navigation, a short welcome, the current way to get a HenrikDev key, a finished key or Twitch connection folds into one "connected" line, saving moves on to the next step, spinners while a match history is read or a pro is looked up, Twitch links work wherever a channel is asked for.
- Renamed accounts and pros are followed (the Riot ID updates by itself).
- Matches: a soft win / loss glow, "−18 RR", clearer lobby tags ("Higher-ranked lobby" …), the game's unranked icon, agent pictures without the name (on hover).
- Rounds: the side is written where it changes (ATK / DEF) instead of a dot on every round, with a legend of the marks; player names show as tags; clearer duel facts ("After the kill: Survived / Died 2.4 s later", "Your death traded: Yes by …"); the economy row no longer squashes half buys; a new spike marker.
- VOD review: change your focuses right in the notes; rate the game per focus when finishing (or skip); delete a review; "Find my VOD" for a single match; the notes are as tall as the player; the Twitch button is gone.
- Pro review: no "for you" tag on every play (the sort stays); VODs are checked by themselves after new matches download, and the empty page has a "Check their VODs now" button.
- Reviews: delete with a confirmation; your ratings per focus over time.
- Insights: a colour key (you / benchmark / better / worse) used the same way everywhere, icons on the top tiles, the spots table beside the map, compact "Rounds worth a look" cards, a proper "All numbers" button, no page jump when switching maps.
- Dropdowns look like the first project's.

## 0.1.0 — first prototype

- Setup guide on first start: HenrikDev key (with test), Riot accounts, Twitch (optional), pros (optional).
- Matches: all ranked games of your accounts, with RR, party size and where your rank sat in the lobby.
- Match page: banner with your numbers and the VOD review button, Quick analysis (can be switched off, remembered), full scoreboard (ACS, K/D/A, +/-, K/D, DDΔ, ADR, HS%, KAST, FK, FD, MK; sortable, parties marked), rounds on the minimap with the duel window, compact economy graph.
- VOD review for your matches with four sources: minimap only (step through kills), your Twitch VOD (opens by itself when there is one), a recording on your PC (suggested from the match time), YouTube. Notes on rounds, duels and video times; takeaways; lining up the rounds with the video.
- Pro review: clutches, retakes, post-plants, site takes, opening duels, holds and whole games from pros' Twitch VODs; "For you" sorting by your agents, role and maps.
- Reviews: open reviews to continue, lessons (starred notes), notes per week and per category, searchable list.
- Insights on one page: you against your lobbies, the standouts of your lobbies, or a pro, on your main role; what stands out, where you die (map, heatmap, side by side), duels by distance and weapon, when you die, rounds worth a look, all numbers.
- Settings: keys, accounts (smurfs can be left out of Insights), your Twitch channel, pros, recordings folder, note categories, backup and restore.
