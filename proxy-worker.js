/**
 * ========================================================================
 * proxy-worker.js — Proxy de OpenRouter para Sucrebot
 * Cloudflare Workers (plan gratuito)
 * ========================================================================
 *
 * PROTEGE tu API key: la clave real vive como SECRETO en el servidor
 * y jamás se expone en el navegador.
 *
 * DESPLIEGUE (5 minutos):
 *
 * 1. Crear cuenta en https://dash.cloudflare.com
 * 2. Instalar Wrangler:  npm install -g wrangler
 * 3. Login:              wrangler login
 * 4. Crear el secreto (tu NUEVA key de OpenRouter, rotada):
 *    wrangler secret put OPENROUTER_API_KEY
 *    (pega la key sk-or-v1-... cuando lo pida)
 * 5. Publicar:           wrangler deploy proxy-worker.js --name sucrebot-proxy
 * 6. Copiar la URL que te da (ej: https://sucrebot-proxy.tu-usuario.workers.dev)
 * 7. Pegarla en chatbot.js:  PROXY_URL: 'https://sucrebot-proxy.tu-usuario.workers.dev'
 *
 * LÍMITES DEL PLAN GRATUITO DE CLOUDFLARE: 100.000 peticiones/día
 * (más que suficiente para el tráfico de un portal municipal).
 */

const ALLOWED_ORIGINS = ['*']; // TODO: en producción, restringir a tu dominio:
// const ALLOWED_ORIGINS = ['https://www.concejosucre.gob.ve', 'https://concejosucre.gob.ve'];

function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
    return {
        'Access-Control-Allow-Origin': allowed ? (ALLOWED_ORIGINS.includes('*') ? '*' : origin) : 'null',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        // Preflight CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== 'POST') {
            return new Response('Sucrebot Proxy — en línea. Use POST.', {
                status: 200,
                headers: corsHeaders(origin)
            });
        }

        try {
            const body = await request.json();
            const { model, messages, temperature, max_tokens } = body;

            if (!model || !Array.isArray(messages)) {
                return new Response(
                    JSON.stringify({ error: { message: 'Petición inválida: se requiere "model" y "messages".' } }),
                    { status: 400, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } }
                );
            }

            const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://concejosucre.gob.ve',
                    'X-Title': 'Concejo Municipal de Sucre - Sucrebot'
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: temperature ?? 0.2,
                    max_tokens: max_tokens ?? 2000
                })
            });

            const respBody = await resp.text();
            return new Response(respBody, {
                status: resp.status,
                headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
            });

        } catch (e) {
            return new Response(
                JSON.stringify({ error: { message: 'Error del proxy: ' + e.message } }),
                { status: 500, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } }
            );
        }
    }
};
