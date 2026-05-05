# SOF2 VETERANS HUB Ultimate Bot

Professional SOF2 Discord PUG bot.

## Features
- `++` join queue
- `--` leave queue
- Auto popup lobby messages
- Buttons: Join / Leave / Profile / Leaderboard
- Random captains
- Captain pick menu
- Auto-pick if captain is AFK
- Profile, Rank, LP, Winrate, KD
- Leaderboard
- Result system
- MongoDB database
- Railway ready

## Railway Variables
```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
MONGO_URI=
QUEUE_CHANNEL_NAME=pug-ing
QUEUE_SIZE=8
DRAFT_PICK_SECONDS=45
WIN_LP=25
LOSS_LP=-18
BRAND_NAME=SOF2 VETERANS HUB
```

## Discord Developer Portal
Enable:
- Presence Intent
- Server Members Intent
- Message Content Intent

## Start
```bash
npm install
npm start
```

Then in Discord:
```text
/setup
```
