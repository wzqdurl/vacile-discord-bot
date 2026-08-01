# NPC con WiFi

Bot de Discord pensado para hablar como un miembro mas del servidor. Solo responde si lo mencionan o si responden directamente a uno de sus mensajes.

## Que hace

- Usa Groq como proveedor principal, Cloudflare Workers AI como respaldo y Gemini como tercer respaldo.
- Mantiene memoria persistente por usuario y servidor con Supabase. No mezcla conversaciones entre usuarios.
- Cada usuario puede elegir como el bot le habla, sin gastar cuota de IA.
- Limita cada usuario a una consulta cada dos segundos.
- Reserva presupuesto propio antes de cada llamada para cambiar de proveedor antes de alcanzar sus cuotas gratuitas.
- Expone `GET /health` para Render y UptimeRobot.

## Crear las credenciales

1. Crea una aplicacion en el [Discord Developer Portal](https://discord.com/developers/applications), anade un bot y copia su token.
2. En **Bot > Privileged Gateway Intents**, activa **Message Content Intent**.
3. En **OAuth2 > URL Generator**, selecciona los scopes `bot` y `applications.commands`; concede al bot permisos para ver canales, enviar mensajes y leer historial.
4. Crea claves gratuitas en [Groq](https://console.groq.com/keys), [Cloudflare Workers AI](https://dash.cloudflare.com/) y [Google AI Studio](https://aistudio.google.com/app/apikey).
5. Crea un proyecto gratuito en [Supabase](https://supabase.com/).

## Preparar Supabase

1. En Supabase abre **SQL Editor** y crea una consulta nueva.
2. Pega y ejecuta el contenido de `supabase/schema.sql`.
3. En **Project Settings > API**, copia `Project URL` y la `service_role key` o `secret key`.

La clave de servicio evita reglas de acceso desde el bot y debe mantenerse exclusivamente en variables de entorno de Render.

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

`!personalidad` abre un panel con botones. La eleccion se guarda por usuario y servidor, no afecta a otros miembros y no consume una llamada de IA. El modo `ekitten` es estrictamente SFW.

## Desarrollo local

```bash
npm install
Copy-Item .env.example .env
npm start
```

Completa todas las variables de `.env.example` en `.env`. No publiques ese archivo.

## Desplegar en Render

1. Crea un **Web Service** desde este repositorio y deja que Render lea `render.yaml`.
2. En las variables de entorno de Render, crea los secretos de `.env.example`.
3. Despliega. Comprueba `https://TU-SERVICIO.onrender.com/health`.
4. En UptimeRobot crea un monitor HTTP(S) que consulte esa URL cada 5 minutos.

Render debe ser un **Web Service** para que UptimeRobot pueda mantenerlo despierto.

## Limites

Las cuotas gratuitas pueden cambiar. El bot aplica presupuestos propios conservadores: Groq usa hasta 350.000 tokens estimados, Cloudflare hasta 7.500 neuronas estimadas y Gemini hasta 100 solicitudes al dia. Cuando un proveedor agota su presupuesto o falla, intenta el siguiente. Si todos se agotan, el bot permanece conectado y explica que volvera cuando se reinicien las cuotas.
