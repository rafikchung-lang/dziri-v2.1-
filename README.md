# Dziri System

Discord moderation & server-management bot with a dark-purple liquid-glass dashboard.
Lightweight: ~65 MB of dependencies, JSON-file storage, no database / Docker / PM2 / Redis.

## Deploy on Wispbyte (Node.js 20)

1. Upload the **contents** of this ZIP into `/home/container/` (so `/home/container/index.js` exists).
2. Copy `.env.example` → `.env` and fill in:
   - `MAIN_DISCORD_TOKEN`, `MAIN_CLIENT_ID`, `CLIENT_SECRET` (the old `DISCORD_TOKEN` / `CLIENT_ID` names still work)
   - `TICKET_DISCORD_TOKEN`, `TICKET_CLIENT_ID` for the second (ticket) bot — leave empty to disable tickets
   - `PORT` = the port Wispbyte assigned to your server
   - `SESSION_SECRET` = any long random string
   - `DASHBOARD_URL` = `http://<your-wispbyte-ip>:<port>`, and add `<DASHBOARD_URL>/auth/callback` as an OAuth2 redirect in the Discord developer portal
   - optional `DASHBOARD_PASSWORD` for owner password login
3. In the Discord developer portal → Bot, enable **Server Members Intent** and **Message Content Intent**.
4. Startup command: `npm install --omit=dev && node index.js` (or just `node index.js` once installed).

## Two bots, one process

`node index.js` starts the main bot (moderation, leveling, logs, temporary voice rooms), the
ticket bot (second Discord application) and the dashboard. If the ticket token is missing the
rest keeps running and the dashboard shows a configuration warning.

## Commands

`/textmute /textunmute /voicemute /voiceunmute /ban /unban /kick /purge /lock /unlock /role /rank /leaderboard /history /help`

Every command also works as a prefix command, under any alias (Arabic/Unicode included), and with an **empty prefix**
(only messages whose first word is exactly a command name or alias are treated as commands).
Slash, prefix and alias triggers all go through the same handler and the same permission checks.

**Reply targeting:** reply to a member's message and type `!mute` (or `!ban`, `!kick`, `!role ods`, …) to target
that member. An explicit mention always wins over the reply; with neither you get a usage hint.

**Custom role names** (Commands → Role in the dashboard) give a Discord role extra names inside Dziri System only —
the Discord role is never renamed, and the role **ID** is stored, so renaming the role in Discord keeps the names working:
`!role @user ods` / `!role @user أوديسي` → the real role.

## Tickets & Temporary Rooms

* **Tickets** (`/dashboard/tickets`, `…/panel`, `…/types`, `…/notifications`) — panel with banner image and type
  select menu, private ticket channels per category, support-role permissions, Claim / Close / Reopen / Transcript /
  Delete controls, ticket logs, and a separate moderator **notification channel** that receives exactly one embed per
  ticket with the member, the exact type and an **Open Ticket** button.
  The select menu contains **exactly** the ticket types you configured — nothing is added automatically.
* **Temporary rooms** (`/dashboard/temp-rooms`, `…/panel`) — join-to-create voice rooms, owner control panel with
  Lock / Unlock / Hide / Unhide / Allow / Deny / Disconnect / Limit ± / Rename / Transfer / Delete (real Discord actions),
  automatic cleanup of empty rooms. Buttons are fully editable: add, delete, reorder, label, emoji, style, enable/disable.

### Panel sender & delivery

Both panels have their own, independent settings:

| Setting | Options | Meaning |
| --- | --- | --- |
| **Panel Sender Bot** | `Dziri System` / `Ticket Bot` | The bot that posts the panel. Discord routes component interactions to the application that owns the message, so **the sender is always the handler** — both clients register both systems. |
| **Panel Delivery** | `Discord Message` / `Webhook` | `Discord Message` = a normal message from the selected bot, no webhook is created. `Webhook` = an application-owned webhook created by that bot (its buttons still route back to it). |

Uploaded images and image/thumbnail URLs work in **both** delivery modes.

## Data

Everything is stored under `data/` (guild configs, aliases, reasons, history, levels, uploaded rank-card backgrounds, rotated logs).
Keep this folder when you update the bot.

## Self-test

`npm test` runs both suites:

* `tests/dispatcher.test.js` — prefix `!`, empty prefix, English/Arabic aliases, collisions, permissions,
  restart persistence, custom role names, reply targeting.
* `tests/systems.test.js` — ticket creation/permissions/notifications/controls and temporary room
  lock/hide/limit/rename/allow/deny/transfer/cleanup.
* `tests/panels.test.js` — panel sender/delivery, webhook vs message, exact ticket menu options,
  interaction acknowledgement timing, temporary room owner detection and configurable buttons.
