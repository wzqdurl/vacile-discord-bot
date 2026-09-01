# NPC con WiFi

Bot de Discord pensado para hablar como un miembro mas del servidor. Solo responde si lo mencionan o si responden directamente a uno de sus mensajes.

## Que hace

- Usa OpenRouter Free como proveedor principal, seguido de OpenCode Zen, Groq, Cloudflare Workers AI y Gemini.
- Mantiene memoria persistente por usuario y servidor con Supabase. No mezcla conversaciones entre usuarios.
- Cada usuario puede elegir como el bot le habla, sin gastar cuota de IA.
- Limita cada usuario a una consulta cada dos segundos.
- Reserva presupuesto propio antes de cada llamada para cambiar de proveedor antes de alcanzar sus cuotas gratuitas.
- Expone `GET /health` para Northflank.

## Crear las credenciales

1. Crea una aplicacion en el [Discord Developer Portal](https://discord.com/developers/applications), anade un bot y copia su token.
2. En **Bot > Privileged Gateway Intents**, activa **Message Content Intent**.
3. En **OAuth2 > URL Generator**, selecciona los scopes `bot` y `applications.commands`; concede al bot permisos para ver canales, enviar mensajes y leer historial.
4. Crea una clave en [OpenRouter](https://openrouter.ai/settings/keys) y claves gratuitas en [Groq](https://console.groq.com/keys), [Cloudflare Workers AI](https://dash.cloudflare.com/) y [Google AI Studio](https://aistudio.google.com/app/apikey).
5. Crea un proyecto gratuito en [Supabase](https://supabase.com/).

## Preparar Supabase

1. En Supabase abre **SQL Editor** y crea una consulta nueva.
2. Pega y ejecuta el contenido de `supabase/schema.sql`.
3. En **Project Settings > API**, copia `Project URL` y la `service_role key` o `secret key`.

La clave de servicio evita reglas de acceso desde el bot y debe mantenerse exclusivamente en variables secretas de Northflank.

## Personalidades

El servidor usa vacile de amigos y humor negro no dirigido como tono base. El bot puede defenderse con roasts proporcionales, pero no permite amenazas, slurs ni ataques a grupos protegidos.

Cada persona puede mencionarlo o responderle con:

```text
!personalidad
!modo neutro
!modo filoso
!modo rude
!modo ekitten
!modo tranqui
```

`/personalidad` abre un panel con botones y aparece en Apps del servidor. Tambien puedes usar `@NPC con WiFi !personalidad`. La eleccion se guarda por usuario y servidor, no afecta a otros miembros y no consume una llamada de IA.

El bot se dirige a adultos: permite vacile, ofensas de vuelta, humor adulto y contenido NSFW entre usuarios mayores de edad. La personalidad es adaptativa: sube o baja el tono segun como te hable cada persona. Mantiene siempre limites fijos que no se negocian: nunca menores, nada no consensuado, sin amenazas creibles, acoso, doxxeo ni instrucciones para causar dano real.

## Desarrollo local

```bash
npm install
Copy-Item .env.example .env
npm start
```

Completa todas las variables de `.env.example` en `.env`. No publiques ese archivo.

## OpenCode Zen opcional

Crea una clave propia en [OpenCode Zen](https://opencode.ai/auth) y definela como `OPENCODE_ZEN_API_KEY`. Por defecto usa `ling-3.0-flash-fin-free` como proveedor principal. Los modelos `Free` de Zen son temporales, su cuota puede cambiar sin aviso y algunos pueden usar las conversaciones para mejorar el modelo, asi que no le mandes datos privados.

## Desplegar en Northflank

1. Conecta GitHub en Northflank y crea un proyecto.
2. Crea un **Combined Service** desde `wzqdurl/vacile-discord-bot`, rama `master`.
3. En **Build options**, selecciona `Dockerfile`; la ruta y el contexto son `/`.
4. Añade como secretos/runtime variables todos los valores necesarios de `.env.example`. Define `PORT=3000`.
5. En **Ports & DNS**, publica el puerto `3000` con protocolo HTTP.
6. Configura el health check HTTP con la ruta `/health`.
7. Usa una sola instancia y activa CI/CD para desplegar cada push de `master`.

El `Dockerfile` instala solo dependencias de produccion y arranca el bot con `npm start`.

## Limites

Las cuotas gratuitas pueden cambiar. Sin comprar creditos, OpenRouter Free permite oficialmente 50 solicitudes al dia y 20 por minuto. El bot cambia despues a Zen, Groq, Cloudflare y Gemini. Sus presupuestos internos son: OpenRouter 50 solicitudes, Zen 1.000 solicitudes, Groq 350.000 tokens estimados, Cloudflare 7.500 neuronas estimadas y Gemini 100 solicitudes al dia. Si todos se agotan, el bot permanece conectado y explica que volvera cuando se reinicien las cuotas.
