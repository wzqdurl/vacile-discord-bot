import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from 'discord.js';

const requiredEnvironment = ['DISCORD_TOKEN', 'GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
  throw new Error(`Faltan variables de entorno: ${missingEnvironment.join(', ')}`);
}

const port = Number(process.env.PORT || 3000);
const userCooldownMs = 2_000;
const requestSpacingMs = 2_200;
const maxRecentMessages = 4;
const personalities = {
  neutro: 'Neutro: colega equilibrado, conversacion natural y vacile ligero solo si encaja.',
  filoso: 'Mas filoso y competitivo: responde a los insultos con un roast ingenioso y proporcionado. Defiendete con ingenio, sin amenazas ni acoso.',
  rude: 'Rude: mas borde y directo, con insultos coloquiales fuertes si te insultan. Defiendete con ingenio, sin amenazas ni acoso persistente.',
  ekitten: 'eKitten: tierno, pegajoso y jugueton con los emotes. Cuando haya ambiente adulto y consensuado puedes coquetear y subir el tono, manteniendo el papel.',
  tranqui: 'Relajado y amable: evita insultos, baja el tono y conversa sin buscar pelea.',
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const lastRequestByUser = new Map();
let nextRequestAt = 0;

const app = express();
app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', discord: client.isReady() });
});
app.listen(port, () => console.log(`Health server listening on port ${port}`));

function enqueueRequest(task) {
  const startAt = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = startAt + requestSpacingMs;
  return new Promise((resolve, reject) => {
    setTimeout(() => task().then(resolve, reject), Math.max(0, startAt - Date.now()));
  });
}

function stripBotMention(content) {
  return content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
}

async function replySafely(message, content) {
  try {
    await message.reply(content);
  } catch (error) {
    // A channel override can deny Send Messages even when the bot is online.
    console.error('Could not send Discord reply:', error.message);
  }
}

function estimateInputTokens(messages) {
  return Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 4);
}

async function reserveBudget(provider, units, limit) {
  const { data, error } = await supabase.rpc('reserve_provider_budget', {
    provider_name: provider,
    requested_units: units,
    daily_limit: limit,
  });
  if (error) throw new Error(`No se pudo reservar presupuesto de ${provider}: ${error.message}`);
  return data;
}

async function getMemory(guildId, userId) {
  const [serverResult, userResult] = await Promise.all([
    supabase.from('server_memories').select('summary').eq('guild_id', guildId).maybeSingle(),
    supabase.from('user_memories').select('summary, personality, recent_messages').eq('guild_id', guildId).eq('user_id', userId).maybeSingle(),
  ]);
  if (serverResult.error || userResult.error) {
    throw new Error(serverResult.error?.message || userResult.error?.message);
  }

  return {
    serverSummary: serverResult.data?.summary || '',
    userSummary: userResult.data?.summary || '',
    personality: userResult.data?.personality || 'neutro',
    recentMessages: Array.isArray(userResult.data?.recent_messages) ? userResult.data.recent_messages : [],
  };
}

async function setPersonality(guildId, userId, personality) {
  const { error } = await supabase.from('user_memories').upsert({
    guild_id: guildId,
    user_id: userId,
    personality,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function saveMemory(guildId, userId, memory, userText, response) {
  const allMessages = [
    ...memory.recentMessages,
    { role: 'user', content: userText },
    { role: 'assistant', content: response },
  ];
  const archivedMessages = allMessages.slice(0, -maxRecentMessages);
  const recentMessages = allMessages.slice(-maxRecentMessages);
  // Keep a compact, persistent trace once the recent turn window rolls over.
  const summary = `${memory.userSummary} ${archivedMessages.map((message) => `${message.role}: ${message.content}`).join(' ')}`
    .trim()
    .slice(-700);

  const { error } = await supabase.from('user_memories').upsert({
    guild_id: guildId,
    user_id: userId,
    summary,
    personality: memory.personality,
    recent_messages: recentMessages,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('Could not save user memory:', error.message);
}

function buildMessages(guildName, memberName, text, memory) {
  const serverContext = memory.serverSummary || 'No hay resumen previo del servidor.';
  const userContext = memory.userSummary || 'No hay datos persistentes previos de este usuario.';

  return [
    {
      role: 'system',
      content: [
        'Eres NPC con WiFi, un miembro divertido y breve de un servidor de Discord en espanol.',
        'Este es un server de amigos adultos que consienten el vacile y el contenido adulto. Puedes defenderte, picarte, insultar de vuelta y coquetear segun como te hablen.',
        'Adapta tu energia, vocabulario, humor y crudeza al tono con el que te hable ese usuario. Si te tratan duro, respondes duro; si son tranquilos, bajas el tono. Nunca fuerces el nivel.',
        'Habla como un miembro real del chat: una o dos frases, sin monologos, moralinas, explicaciones ni roasts largos. Prefiere respuestas rapidas y coloquiales.',
        'Deja que tu personalidad salga sola dentro del modo elegido; no suenes como una politica ambulante ni como un bot ultra filtrado.',
        'Se permite humor adulto, groserias y contenido sexual solo si todos los implicados son adultos y se mantiene el consentimiento y el tono acordado.',
        'Limites fijos que no se negocian: nunca menores ni contenido sobre menores, nada no consentido ni forzado, sin amenazas creibles, sin acoso persistente, sin doxxeo ni datos personales reales, y sin instrucciones para causar daño real.',
        'No uses slurs dirigidos a grupos protegidos como ataque directo. No digas que eres IA salvo que te lo pregunten.',
        'Responde como maximo en 35 palabras y prioriza sonar natural.',
        `Servidor: ${guildName}. Contexto del servidor: ${serverContext}`,
        `Usuario: ${memberName}. Contexto del usuario: ${userContext}`,
        `Modo elegido por este usuario: ${memory.personality}. ${personalities[memory.personality] || personalities.neutro}`,
      ].join(' '),
    },
    ...memory.recentMessages,
    { role: 'user', content: text },
  ];
}

async function callGroq(messages) {
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    temperature: 1.1,
    max_tokens: 50,
    messages,
  });
  return completion.choices[0]?.message?.content?.trim();
}

async function callCloudflare(messages) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${process.env.CLOUDFLARE_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8'}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, max_tokens: 50, temperature: 1 }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.errors?.[0]?.message || 'Cloudflare request failed');
  return payload.result?.response?.trim();
}

async function callGemini(messages) {
  const [system, ...conversation] = messages;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system.content }] },
        contents: conversation.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: { temperature: 1, maxOutputTokens: 50 },
      }),
    },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Gemini request failed');
  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

async function generateResponse(messages) {
  const estimatedTokens = estimateInputTokens(messages) + 50;
  const cloudflareNeurons = (estimateInputTokens(messages) * 0.004625) + (50 * 0.030475);
  const providers = [
    { name: 'groq', enabled: true, units: estimatedTokens, limit: 350_000, call: callGroq },
    {
      name: 'cloudflare',
      enabled: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
      units: cloudflareNeurons,
      limit: 7_500,
      call: callCloudflare,
    },
    {
      name: 'gemini',
      enabled: Boolean(process.env.GEMINI_API_KEY),
      units: 1,
      limit: 100,
      call: callGemini,
    },
  ];

  for (const provider of providers) {
    if (!provider.enabled) continue;
    try {
      if (!await reserveBudget(provider.name, provider.units, provider.limit)) {
        console.warn(`${provider.name} budget exhausted or unavailable`);
        continue;
      }
      const response = await enqueueRequest(() => provider.call(messages));
      if (response) {
        console.log(`AI response generated by ${provider.name}`);
        return response;
      }
      console.warn(`${provider.name} returned no message content`);
    } catch (error) {
      console.error(`${provider.name} failed:`, error.message);
    }
  }

  return null;
}

async function isReplyToBot(message) {
  if (!message.reference?.messageId) return false;
  try {
    const referencedMessage = await message.fetchReference();
    return referencedMessage.author.id === client.user.id;
  } catch {
    return false;
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connected to Discord as ${readyClient.user.tag}`);
  const personalityCommand = new SlashCommandBuilder()
    .setName('personalidad')
    .setDescription('Abre el panel de personalidades de NPC con WiFi');
  const commands = [personalityCommand.toJSON()];

  const registerCommands = async () => {
    if (process.env.DISCORD_GUILD_ID) {
      await readyClient.application.commands.set(commands, process.env.DISCORD_GUILD_ID);
      console.log(`Registered personality command in guild ${process.env.DISCORD_GUILD_ID}`);
    } else {
      await readyClient.application.commands.set(commands);
      console.log('Registered personality command globally');
    }
  };
  registerCommands().catch((error) => console.error('Could not register application commands:', error.message));
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error.message);
});

function personalityPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Personalidades')
    .setDescription('Elige como NPC con WiFi habla **contigo**. Tu eleccion no cambia el modo de los demas.')
    .addFields(
      { name: 'Neutro', value: 'Colega equilibrado y vacile ligero.', inline: true },
      { name: 'Filoso', value: 'Roasts ingeniosos y proporcionados.', inline: true },
      { name: 'Rude', value: 'Mas borde y directo.', inline: true },
      { name: 'eKitten', value: 'Tierno y SFW.', inline: true },
      { name: 'Tranqui', value: 'Relajado, sin buscar pelea.', inline: true },
    );
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('personality:neutro').setLabel('Neutro').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('personality:filoso').setLabel('Filoso').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('personality:rude').setLabel('Rude').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('personality:ekitten').setLabel('eKitten').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('personality:tranqui').setLabel('Tranqui').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [buttons] };
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'personalidad') {
    await interaction.reply(personalityPanel());
    return;
  }

  if (!interaction.isButton() || !interaction.guild || !interaction.customId.startsWith('personality:')) return;
  const personality = interaction.customId.slice('personality:'.length);
  if (!personalities[personality]) return;

  try {
    await interaction.deferReply({ ephemeral: true });
    await setPersonality(interaction.guild.id, interaction.user.id, personality);
    await interaction.editReply(`Listo. Contigo voy en modo **${personality}**.`);
  } catch (error) {
    console.error('Could not save personality button:', error.message);
    if (interaction.deferred) await interaction.editReply('No pude guardar tu modo. Intentalo otra vez.');
    else await interaction.reply({ content: 'No pude guardar tu modo. Intentalo otra vez.', ephemeral: true });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const mentioned = message.mentions.has(client.user);
  const replyingToBot = !mentioned && await isReplyToBot(message);
  if (!mentioned && !replyingToBot) return;

  const text = stripBotMention(message.content);
  if (!text) {
    await replySafely(message, 'Di algo, no leo mentes todavia.');
    return;
  }

  if (/^!(personalidad|modos)$/i.test(text)) {
    await message.reply(personalityPanel());
    return;
  }

  const personalityMatch = text.match(/^!modo\s+([a-z]+)$/i);
  if (personalityMatch) {
    const personality = personalityMatch[1].toLowerCase();
    if (!personalities[personality]) {
      await replySafely(message, 'Ese modo no existe. Usa `!modos` para ver los disponibles.');
      return;
    }
    try {
      await setPersonality(message.guild.id, message.author.id, personality);
      await replySafely(message, `Listo. Contigo voy en modo **${personality}**.`);
    } catch (error) {
      console.error('Could not save personality:', error.message);
      await replySafely(message, 'No pude guardar tu modo. Intentalo otra vez.');
    }
    return;
  }

  const lastRequest = lastRequestByUser.get(message.author.id) || 0;
  if (Date.now() - lastRequest < userCooldownMs) {
    await replySafely(message, 'Baja dos cambios, te respondo en un segundo.');
    return;
  }
  lastRequestByUser.set(message.author.id, Date.now());

  try {
    await message.channel.sendTyping();
    const memory = await getMemory(message.guild.id, message.author.id);
    const messages = buildMessages(message.guild.name, message.member?.displayName || message.author.username, text, memory);
    const response = await generateResponse(messages);
    if (!response) {
      await replySafely(message, 'Hoy me fundi el cerebro. Vuelvo cuando se reinicien las cuotas.');
      return;
    }
    await saveMemory(message.guild.id, message.author.id, memory, text, response);
    await replySafely(message, { content: response, allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error('Message handling failed:', error.message);
    await replySafely(message, 'Se me cruzaron los cables. Pruebame otra vez en un momento.');
  }
});

client.login(process.env.DISCORD_TOKEN);
