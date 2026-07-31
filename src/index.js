import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { Client, Events, GatewayIntentBits } from 'discord.js';

const requiredEnvironment = ['DISCORD_TOKEN', 'GROQ_API_KEY'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
  throw new Error(`Faltan variables de entorno: ${missingEnvironment.join(', ')}`);
}

const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const port = Number(process.env.PORT || 3000);
const userCooldownMs = 2_000;
const requestSpacingMs = 2_200; // Se mantiene por debajo de las 30 peticiones/minuto de Groq.
const maxHistoryMessages = 6;

const app = express();
app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', discord: client.isReady() });
});
app.listen(port, () => console.log(`Health server listening on port ${port}`));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const histories = new Map();
const lastRequestByUser = new Map();
let nextRequestAt = 0;

function enqueueGroqRequest(task) {
  const startAt = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = startAt + requestSpacingMs;

  return new Promise((resolve, reject) => {
    setTimeout(() => task().then(resolve, reject), startAt - Date.now());
  });
}

function stripBotMention(content) {
  return content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
}

function addToHistory(channelId, role, content) {
  const history = histories.get(channelId) || [];
  history.push({ role, content });
  histories.set(channelId, history.slice(-maxHistoryMessages));
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

async function generateResponse(channelId, authorName, text) {
  const history = histories.get(channelId) || [];
  const completion = await enqueueGroqRequest(() => groq.chat.completions.create({
    model,
    temperature: 1,
    max_tokens: 110,
    messages: [
      {
        role: 'system',
        content: [
          'Eres un miembro juvenil y divertido de un servidor de Discord en espanol.',
          'Habla natural, breve y con personalidad. Puedes vacilar, devolver insultos suaves y sarcasmo jugueton cuando el contexto lo pida.',
          'No digas que eres una IA salvo que te lo pregunten. No inventes hechos ni autoridad.',
          'No ataques a grupos protegidos ni uses slurs, amenazas, acoso persistente, sexualizacion de menores o instrucciones peligrosas.',
          'No uses listas ni parrafos largos salvo que el usuario lo pida. Responde en un maximo de 80 palabras.',
        ].join(' '),
      },
      ...history,
      { role: 'user', content: `${authorName}: ${text}` },
    ],
  }));

  return completion.choices[0]?.message?.content?.trim() || 'Me dejaste pensando demasiado, intentalo otra vez.';
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connected to Discord as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const mentioned = message.mentions.has(client.user);
  const replyingToBot = !mentioned && await isReplyToBot(message);
  if (!mentioned && !replyingToBot) return;

  const text = stripBotMention(message.content);
  if (!text) {
    await message.reply('Di algo, no leo mentes todavia.');
    return;
  }

  const lastRequest = lastRequestByUser.get(message.author.id) || 0;
  if (Date.now() - lastRequest < userCooldownMs) {
    await message.reply('Baja dos cambios, te respondo en un segundo.');
    return;
  }
  lastRequestByUser.set(message.author.id, Date.now());

  try {
    await message.channel.sendTyping();
    const response = await generateResponse(message.channel.id, message.member?.displayName || message.author.username, text);
    addToHistory(message.channel.id, 'user', `${message.member?.displayName || message.author.username}: ${text}`);
    addToHistory(message.channel.id, 'assistant', response);
    await message.reply({ content: response, allowedMentions: { repliedUser: false } });
  } catch (error) {
    console.error('Groq request failed:', error.status || error.message);
    await message.reply('Estoy saturado un momento. Pruebame otra vez en unos segundos.');
  }
});

client.login(process.env.DISCORD_TOKEN);
