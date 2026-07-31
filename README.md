# Vacile Discord Bot

Bot de Discord con Groq pensado para hablar como un miembro mas del servidor. Solo responde si lo mencionan o si responden directamente a uno de sus mensajes.

## Que hace

- Usa `llama-3.1-8b-instant` de Groq por defecto.
- Mantiene una memoria temporal de seis mensajes por canal. Se pierde al reiniciar y no guarda nada en una base de datos.
- Limita cada usuario a una consulta cada dos segundos.
- Espacia llamadas a Groq para permanecer bajo 30 solicitudes por minuto.
- Expone `GET /health` para Render y UptimeRobot.

## Crear las credenciales

1. Crea una aplicacion en el [Discord Developer Portal](https://discord.com/developers/applications), anade un bot y copia su token.
2. En **Bot > Privileged Gateway Intents**, activa **Message Content Intent**.
3. En **OAuth2 > URL Generator**, selecciona los scopes `bot` y `applications.commands`; concede al bot permisos para ver canales, enviar mensajes y leer historial.
4. Crea una API key gratuita en [Groq](https://console.groq.com/keys).

## Desarrollo local

```bash
npm install
Copy-Item .env.example .env
npm start
```

Completa `DISCORD_TOKEN` y `GROQ_API_KEY` en `.env`. No publiques ese archivo.

## Desplegar en Render

1. Crea un **Web Service** desde este repositorio y deja que Render lea `render.yaml`.
2. En las variables de entorno de Render, crea `DISCORD_TOKEN` y `GROQ_API_KEY`.
3. Despliega. Comprueba `https://TU-SERVICIO.onrender.com/health`.
4. En UptimeRobot crea un monitor HTTP(S) que consulte esa URL cada 5 minutos.

Render debe ser un **Web Service** para que UptimeRobot pueda mantenerlo despierto.

## Limites

Las cuotas gratuitas de Groq pueden cambiar. Este proyecto controla el limite por minuto, pero no puede evitar agotar el limite diario de tokens. El bot responde corto y conserva poco contexto para reducir ese consumo.
