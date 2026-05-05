import "dotenv/config";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import mongoose from "mongoose";

const cfg = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  mongoUri: process.env.MONGO_URI,
  queueChannelName: process.env.QUEUE_CHANNEL_NAME || "pug-ing",
  queueSize: Number(process.env.QUEUE_SIZE || 8),
  draftPickSeconds: Number(process.env.DRAFT_PICK_SECONDS || 45),
  winLp: Number(process.env.WIN_LP || 25),
  lossLp: Number(process.env.LOSS_LP || -18),
  brandName: process.env.BRAND_NAME || "SOF2 VETERANS HUB"
};

for (const [key, val] of Object.entries({
  DISCORD_TOKEN: cfg.token, CLIENT_ID: cfg.clientId,
  GUILD_ID: cfg.guildId, MONGO_URI: cfg.mongoUri
})) {
  if (!val) {
    console.error(`Missing env variable: ${key}`);
    process.exit(1);
  }
}

const ranks = [
  { name: "Silver 1", min: 0, icon: "◇" },
  { name: "Silver 2", min: 25, icon: "◇" },
  { name: "Silver 3", min: 50, icon: "◈" },
  { name: "Gold 1", min: 100, icon: "◆" },
  { name: "Gold 2", min: 150, icon: "◆" },
  { name: "Gold 3", min: 225, icon: "✦" },
  { name: "Veteran", min: 325, icon: "★" },
  { name: "Elite Veteran", min: 500, icon: "✪" },
  { name: "SOF2 Legend", min: 800, icon: "♛" }
];

const maps = ["mp_shop2","mp_col1","mp_col2","mp_kam2","mp_hk1","mp_jor1","mp_jor2","mp_pra1"];

const Player = mongoose.model("Player", new mongoose.Schema({
  userId: { type: String, unique: true, index: true },
  username: String,
  lp: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  games: { type: Number, default: 0 },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  headshots: { type: Number, default: 0 },
  knifeKills: { type: Number, default: 0 },
  nadeKills: { type: Number, default: 0 },
  damage: { type: Number, default: 0 },
  last20: { type: [String], default: [] },
  banned: { type: Boolean, default: false },
  banReason: String
}, { timestamps: true }));

const Lobby = mongoose.model("Lobby", new mongoose.Schema({
  lobbyId: { type: Number, unique: true, index: true },
  status: String,
  players: [String],
  captainRed: String,
  captainBlue: String,
  redTeam: [String],
  blueTeam: [String],
  available: [String],
  turn: String,
  map: String,
  messageId: String,
  channelId: String,
  winner: String
}, { timestamps: true }));

const Counter = mongoose.model("Counter", new mongoose.Schema({
  name: { type: String, unique: true },
  value: { type: Number, default: 0 }
}));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ]
});

let queue = [];
let activeLobby = null;
let pickTimer = null;

function rankOf(lp = 0) {
  let r = ranks[0];
  for (const rank of ranks) if (lp >= rank.min) r = rank;
  return r;
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function winrate(p) {
  return p.games ? `${((p.wins / p.games) * 100).toFixed(1)}%` : "0.0%";
}

function kd(p) {
  return p.deaths ? (p.kills / p.deaths).toFixed(2) : (p.kills ? p.kills.toFixed(2) : "0.00");
}

function percent(a, b) {
  return b ? `${((a / b) * 100).toFixed(1)}%` : "0.0%";
}

function baseEmbed(color = 0xffb000) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: `${cfg.brandName} • Professional PUG System` })
    .setTimestamp();
}

async function playerDoc(user) {
  return Player.findOneAndUpdate(
    { userId: user.id },
    { $set: { username: user.username } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function nextLobbyId() {
  const c = await Counter.findOneAndUpdate(
    { name: "lobbyId" },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return c.value;
}

async function playerLine(id) {
  const p = await Player.findOne({ userId: id }) || { lp: 0 };
  const r = rankOf(p.lp);
  return `<@${id}> ${r.icon}`;
}

async function queueEmbed(reason = null) {
  const need = Math.max(cfg.queueSize - queue.length, 0);
  const lines = await Promise.all(queue.map(playerLine));
  return baseEmbed(queue.length >= cfg.queueSize ? 0x00ff4c : 0xffb000)
    .setTitle(`@Registered, we are looking for ${need} player(s) 📣`)
    .setDescription([
      `**[${queue.length}/${cfg.queueSize}] Lobby Queue**`,
      lines.length ? lines.join(" | ") : "`Empty lobby`",
      "",
      reason ? `**Update:** ${reason}` : "Type `++` to join, `--` to leave.",
      "",
      "`/profile` • `/leaderboard` • `/promote` • `/result`"
    ].join("\n"));
}

function queueButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("join").setLabel("Join ++").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("leave").setLabel("Leave --").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("profile").setLabel("Profile").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("leaderboard").setLabel("Leaderboard").setStyle(ButtonStyle.Primary)
  );
}

async function profileEmbed(user) {
  const p = await playerDoc(user);
  const r = rankOf(p.lp);
  return baseEmbed(0xffd000)
    .setTitle(`Profile: ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription([
      "**KD Ratio:**", kd(p), "",
      "**Last 20 Matches:**", p.last20.length ? p.last20.join(" ") : "0G 0W 0L", "",
      "**Kill Stats:**",
      `Headshot Percentage: ${percent(p.headshots, p.kills)}`,
      `Knife Percentage: ${percent(p.knifeKills, p.kills)}`,
      `Nade Percentage: ${percent(p.nadeKills, p.kills)}`, "",
      "**Ranked Stats**",
      `${r.icon} ${r.name} (${p.lp} LP)`,
      `${p.wins}W ${p.losses}L`,
      `Winratio: ${winrate(p)} ${p.games} Games`, "",
      "**All Stats:**",
      `Total Kills: ${p.kills}`,
      `Total Deaths: ${p.deaths}`,
      `Total Headshots: ${p.headshots}`,
      `Total Knife Kills: ${p.knifeKills}`,
      `Total Nade Kills: ${p.nadeKills}`,
      `Total Damage Done: ${p.damage}`
    ].join("\n"));
}

async function leaderboardEmbed() {
  const top = await Player.find().sort({ lp: -1, wins: -1 }).limit(10);
  const lines = top.length
    ? top.map((p, i) => {
      const r = rankOf(p.lp);
      return `**#${i + 1} - ${p.username || "unknown"}** - ${r.icon} ${r.name} (${p.lp} LP)`;
    }).join("\n")
    : "`No ranked players yet.`";
  return baseEmbed(0xff0000).setTitle("🏆 INF5V5 LEADERBOARD").setDescription(`${lines}\n\nPage 1/1`);
}

async function postQueue(channel, reason = null) {
  await channel.send({ embeds: [await queueEmbed(reason)], components: [queueButtons()] });
}

async function joinQueue(member, channel, source = "typed ++") {
  if (activeLobby?.status === "picking") return channel.send(`<@${member.id}> a pick phase is already active.`);
  if (queue.includes(member.id)) return;

  const p = await playerDoc(member.user);
  if (p.banned) return channel.send(`<@${member.id}> you are banned. Reason: ${p.banReason || "No reason"}`);

  queue.push(member.id);
  await postQueue(channel, `<@${member.id}> has joined the lobby • ${source}`);
  if (queue.length >= cfg.queueSize) await promoteLobby(channel, member.id);
}

async function leaveQueue(userLike, channel, reason = "left") {
  const id = userLike.id;
  if (!queue.includes(id)) return;
  queue = queue.filter(x => x !== id);
  await postQueue(channel, `<@${id}> has been removed (${reason})`);
}

function pickMenu(lobby) {
  if (!lobby.available.length) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`pick:${lobby.lobbyId}`)
    .setPlaceholder("Captain: select a player to pick")
    .addOptions(lobby.available.slice(0, 25).map(id => ({
      label: `Player ${id}`,
      value: id,
      description: "Pick this player"
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

async function pickEmbed(lobby) {
  const red = await Player.findOne({ userId: lobby.captainRed }) || { lp: 0, games: 0, wins: 0 };
  const blue = await Player.findOne({ userId: lobby.captainBlue }) || { lp: 0, games: 0, wins: 0 };
  const redRank = rankOf(red.lp);
  const blueRank = rankOf(blue.lp);

  return baseEmbed(0x3b82f6)
    .setTitle("Match Status: Pick Phase")
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .setDescription([
      `${lobby.turn === "red" ? `<@${lobby.captainRed}>` : `<@${lobby.captainBlue}>`}'s turn to pick!`,
      "",
      "**Red Team 🟥**",
      (await Promise.all(lobby.redTeam.map(playerLine))).join("\n"),
      "**Rank**",
      `${redRank.icon} ${redRank.name} (${red.lp} LP)`, "",
      "**Blue Team 🟦**",
      (await Promise.all(lobby.blueTeam.map(playerLine))).join("\n"),
      "**Rank**",
      `${blueRank.icon} ${blueRank.name} (${blue.lp} LP)`, "",
      "**Available:**",
      lobby.available.length ? lobby.available.map(id => `<@${id}>`).join(" | ") : "`None`",
      `**Map:** ${lobby.map}`
    ].join("\n"));
}

async function promoteLobby(channel, promotedBy) {
  if (activeLobby?.status === "picking") return;
  if (queue.length < 2) return channel.send("Not enough players to promote lobby.");

  const lobbyId = await nextLobbyId();
  const selected = queue.splice(0, cfg.queueSize);
  const players = shuffle(selected);

  activeLobby = {
    lobbyId,
    status: "picking",
    players: selected,
    captainRed: players[0],
    captainBlue: players[1],
    redTeam: [players[0]],
    blueTeam: [players[1]],
    available: players.slice(2),
    turn: "red",
    map: maps[Math.floor(Math.random() * maps.length)],
    channelId: channel.id
  };

  const msg = await channel.send({
    content: `<@${activeLobby.captainRed}> <@${activeLobby.captainBlue}>`,
    embeds: [await pickEmbed(activeLobby)],
    components: pickMenu(activeLobby)
  });

  activeLobby.messageId = msg.id;
  await Lobby.create(activeLobby);
  await postQueue(channel, `<@${promotedBy}> has promoted the lobby • id: ${lobbyId}`);
  scheduleAutoPick(channel);
}

function nextTurn() {
  const target = Math.ceil(cfg.queueSize / 2);
  if (activeLobby.redTeam.length >= target && activeLobby.blueTeam.length < target) return "blue";
  if (activeLobby.blueTeam.length >= target && activeLobby.redTeam.length < target) return "red";
  return activeLobby.turn === "red" ? "blue" : "red";
}

function scheduleAutoPick(channel) {
  if (pickTimer) clearTimeout(pickTimer);
  pickTimer = setTimeout(async () => {
    if (!activeLobby || activeLobby.status !== "picking" || !activeLobby.available.length) return;
    const picked = activeLobby.available[Math.floor(Math.random() * activeLobby.available.length)];
    await doPick(channel, picked, true);
  }, cfg.draftPickSeconds * 1000);
}

async function doPick(channel, picked, auto = false) {
  if (!activeLobby || !activeLobby.available.includes(picked)) return;

  activeLobby.available = activeLobby.available.filter(id => id !== picked);
  if (activeLobby.turn === "red") activeLobby.redTeam.push(picked);
  else activeLobby.blueTeam.push(picked);

  const target = Math.ceil(cfg.queueSize / 2);
  if (activeLobby.redTeam.length >= target && activeLobby.blueTeam.length >= target) return finishPick(channel);

  activeLobby.turn = nextTurn();
  await Lobby.findOneAndUpdate({ lobbyId: activeLobby.lobbyId }, activeLobby);

  const msg = await channel.messages.fetch(activeLobby.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [await pickEmbed(activeLobby)], components: pickMenu(activeLobby) });

  await channel.send(`${auto ? "⏱️ Auto-pick:" : "✅ Pick:"} <@${picked}>`);
  scheduleAutoPick(channel);
}

async function finishPick(channel) {
  if (pickTimer) clearTimeout(pickTimer);
  activeLobby.status = "ready";
  await Lobby.findOneAndUpdate({ lobbyId: activeLobby.lobbyId }, activeLobby);

  const final = baseEmbed(0x00ff4c).setTitle(`✅ Lobby #${activeLobby.lobbyId} Ready`).setDescription([
    `**Map:** ${activeLobby.map}`, "",
    "**Red Team 🟥**", activeLobby.redTeam.map(id => `<@${id}>`).join("\n"), "",
    "**Blue Team 🟦**", activeLobby.blueTeam.map(id => `<@${id}>`).join("\n"), "",
    "Admin can finish it with `/result winner:red` or `/result winner:blue`."
  ].join("\n"));

  const msg = await channel.messages.fetch(activeLobby.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [final], components: [] });
  await channel.send({ embeds: [final] });
}

async function submitResult(interaction, winner) {
  if (!activeLobby || activeLobby.status !== "ready") return interaction.reply({ content: "No ready lobby found.", ephemeral: true });

  const winners = winner === "red" ? activeLobby.redTeam : activeLobby.blueTeam;
  const losers = winner === "red" ? activeLobby.blueTeam : activeLobby.redTeam;

  for (const id of winners) {
    await Player.findOneAndUpdate({ userId: id }, {
      $inc: { lp: cfg.winLp, wins: 1, games: 1 },
      $push: { last20: { $each: ["W"], $slice: -20 } }
    }, { upsert: true, setDefaultsOnInsert: true });
  }

  for (const id of losers) {
    await Player.findOneAndUpdate({ userId: id }, {
      $inc: { lp: cfg.lossLp, losses: 1, games: 1 },
      $push: { last20: { $each: ["L"], $slice: -20 } }
    }, { upsert: true, setDefaultsOnInsert: true });
  }

  activeLobby.status = "completed";
  activeLobby.winner = winner;
  await Lobby.findOneAndUpdate({ lobbyId: activeLobby.lobbyId }, activeLobby);

  await interaction.reply({ embeds: [baseEmbed(0x00ff4c).setTitle(`🏁 Lobby #${activeLobby.lobbyId} Result`).setDescription([
    `${winner === "red" ? "Red Team 🟥" : "Blue Team 🟦"} won.`,
    `Winners: +${cfg.winLp} LP`,
    `Losers: ${cfg.lossLp} LP`
  ].join("\n"))] });

  activeLobby = null;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("setup").setDescription("Create main PUG panel").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName("profile").setDescription("Show profile").addUserOption(o => o.setName("player").setDescription("Player").setRequired(false)),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Show leaderboard"),
    new SlashCommandBuilder().setName("promote").setDescription("Promote queue to pick phase").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName("cancel").setDescription("Cancel queue/lobby").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName("result").setDescription("Submit result").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName("winner").setDescription("Winner").setRequired(true).addChoices(
        { name: "Red Team", value: "red" },
        { name: "Blue Team", value: "blue" }
      )),
    new SlashCommandBuilder().setName("help").setDescription("Show help")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(cfg.token);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body: commands });
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  const c = msg.content.trim();

  if (c === "++") return joinQueue(msg.member, msg.channel, "typed ++");
  if (c === "--") return leaveQueue(msg.member, msg.channel, "left");
  if (c === "!top") return msg.reply({ embeds: [await leaderboardEmbed()] });
  if (c === "!profile") return msg.reply({ embeds: [await profileEmbed(msg.author)] });
});

client.on("presenceUpdate", async (_, presence) => {
  if (!presence || presence.status !== "offline") return;
  const id = presence.userId;
  if (!queue.includes(id)) return;
  const guild = client.guilds.cache.get(cfg.guildId);
  const channel = guild?.channels.cache.find(ch => ch.name === cfg.queueChannelName);
  if (channel) await leaveQueue({ id }, channel, "went offline");
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup") return interaction.reply({ embeds: [await queueEmbed("Panel created. Players can type `++` here.")], components: [queueButtons()] });
      if (interaction.commandName === "profile") return interaction.reply({ embeds: [await profileEmbed(interaction.options.getUser("player") || interaction.user)] });
      if (interaction.commandName === "leaderboard") return interaction.reply({ embeds: [await leaderboardEmbed()] });
      if (interaction.commandName === "promote") {
        await interaction.deferReply({ ephemeral: true });
        await promoteLobby(interaction.channel, interaction.user.id);
        return interaction.editReply("Lobby promoted.");
      }
      if (interaction.commandName === "cancel") {
        queue = [];
        activeLobby = null;
        if (pickTimer) clearTimeout(pickTimer);
        return interaction.reply("Active lobby and queue cancelled.");
      }
      if (interaction.commandName === "result") return submitResult(interaction, interaction.options.getString("winner"));
      if (interaction.commandName === "help") return interaction.reply({ content: "`++` join, `--` leave, `/profile`, `/leaderboard`, `/promote`, `/result`", ephemeral: true });
    }

    if (interaction.isButton()) {
      if (interaction.customId === "join") {
        await joinQueue(interaction.member, interaction.channel, "button");
        return interaction.reply({ content: "Joined queue.", ephemeral: true });
      }
      if (interaction.customId === "leave") {
        await leaveQueue(interaction.member, interaction.channel, "left");
        return interaction.reply({ content: "Left queue.", ephemeral: true });
      }
      if (interaction.customId === "profile") return interaction.reply({ embeds: [await profileEmbed(interaction.user)], ephemeral: true });
      if (interaction.customId === "leaderboard") return interaction.reply({ embeds: [await leaderboardEmbed()], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("pick:")) {
      if (!activeLobby || activeLobby.status !== "picking") return interaction.reply({ content: "No active pick phase.", ephemeral: true });
      const captain = activeLobby.turn === "red" ? activeLobby.captainRed : activeLobby.captainBlue;
      if (interaction.user.id !== captain) return interaction.reply({ content: "Only the current captain can pick.", ephemeral: true });
      await interaction.deferUpdate();
      await doPick(interaction.channel, interaction.values[0], false);
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Error. Check logs.", ephemeral: true }).catch(() => {});
  }
});

process.on("unhandledRejection", err => console.error("Unhandled rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught exception:", err));

console.log(`Starting ${cfg.brandName} Ultimate Bot...`);
await mongoose.connect(cfg.mongoUri);
console.log("Connected to MongoDB.");
client.login(cfg.token);
