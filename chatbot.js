/**
 * Sucrebot - Asistente Virtual del Concejo Municipal de Sucre
 * OpenRouter (modelos gratuitos) - 2026
 * Tono: Español venezolano formal
 *
 * v2.0 - Cambios:
 *  - Usa la MISMA normalización de materias que script.js (window.CMS)
 *  - Eliminado el sistema de "login de admin" (era código muerto: nada se guardaba)
 *  - Corregido: ya no devuelve ordenanzas irrelevantes cuando el score es 0
 *    (antes el bot nunca decía "no encontré nada" y alucinaba)
 *  - Cola de mensajes + rate limiting (evita 429 de OpenRouter free)
 *  - Soporte de proxy servidor (PROXY_URL) para proteger la API key
 *  - Historial persistente en texto plano (fix: el modelo ya no imita HTML)
 *  - Respuestas protegidas contra etiquetas HTML literales
 *  - Compatibilidad con la vista previa embebida del portal
 */

document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // CONFIGURACION
    // ========================================================================
    const CONFIG = {
        OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
        DEFAULT_MODEL: 'openrouter/free',
        MAX_CONTEXT_ORDINANCES: 3,
        MAX_HISTORY_MESSAGES: 6,
        MAX_CONTENT_LENGTH: 12000,
        MAX_TOTAL_CONTEXT: 25000,
        MIN_INTERVAL_MS: 2500,        // pausa mínima entre llamadas a la API (rate limit)
        HISTORY_STORAGE_KEY: 'sucrebot_history',

        // ==== SEGURIDAD DE LA API KEY ====
        // La API key de OpenRouter vive EXCLUSIVAMENTE como secreto en el
        // Cloudflare Worker (proxy-worker.js). Aquí NO debe haber ninguna
        // clave: este archivo es público y cualquiera puede verlo con DevTools.
        HARDCODED_API_KEY: '',

        // ==== PROXY ====
        // Cloudflare Worker desplegado (proxy-worker.js). La API key de
        // OpenRouter vive como secreto en ese servidor; aquí no hay claves.
        PROXY_URL: 'https://sucrebot-proxy.ord-concejosucre.workers.dev',

        // === WEBHOOK DE NOTIFICACIÓN DE ERRORES (opcional) ===
        HARDCODED_WEBHOOK: 'https://formspree.io/f/xnpanzob',
    };

    // ========================================================================
    // ESTADO
    // ========================================================================
    let ordinances = [];
    let chatHistory = [];
    let isChatOpen = false;
    let isTyping = false;
    let currentModel = CONFIG.DEFAULT_MODEL;
    let messageQueue = [];
    let isProcessingQueue = false;
    let lastApiCallAt = 0;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ========================================================================
    // REFERENCIAS DOM
    // ========================================================================
    let dom = {};

    // ========================================================================
    // UTILIDADES
    // ========================================================================
    const normalizeText = (window.CMS && window.CMS.normalizeText) || ((text) => {
        if (!text) return '';
        return text.toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    });

    // Misma normalización de materias que el sitio principal
    const normalizeCategory = (window.CMS && window.CMS.normalizeCategory) || ((text) => {
        if (!text) return 'Sin Categoría';
        return text.toString().trim();
    });

    const escapeHTML = (str) => {
        const div = document.createElement('div');
        div.textContent = (str === undefined || str === null) ? '' : str.toString();
        return div.innerHTML;
    };

    /**
     * Convierte HTML a texto plano. El historial que se envía al modelo de IA
     * JAMÁS debe contener etiquetas HTML: si las ve, las imita y devuelve
     * etiquetas literales que se muestran como texto crudo en el chat.
     */
    function toPlainText(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return (div.textContent || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Formatea la respuesta de texto del LLM: bold markdown, enlaces y saltos
     */
    function formatBotReply(text) {
        let h = escapeHTML(text);
        // Red de seguridad: si el modelo devuelve etiquetas HTML literales,
        // se eliminan para que no se vean como texto crudo en el chat.
        h = h.replace(/&lt;\/?[a-zA-Z][\s\S]*?&gt;/g, '');
        h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
        h = h.replace(/\n/g, '<br>');
        return h;
    }

    function extractOrdinanceNumber(query) {
        const normalized = normalizeText(query);

        const patterns = [
            /n[\u00ba\u00b0o]?\.?\s*(\d[\d\-._\/]*)/i,
            /ord[\-._\s]*(\d{4})[\-._\s]*(\d+)/i,
            /(\d{2,4})[\-._\s]*(\d{1,2})[\-._\s]*(\d{4})/,
            /(\d{4})[\-._\s]*(\d{2,4})/,
            /ordenanza[\s]+(\d+)/i,
            /\b(\d{2,4})\b/
        ];

        const candidates = [];

        for (const pattern of patterns) {
            const match = normalized.match(pattern);
            if (match) {
                let num = match[0]
                    .replace(/n[\u00ba\u00b0o]?\.?\s*/i, '')
                    .replace(/ordenanza\s+/i, '')
                    .replace(/[\s._\/]/g, '-')
                    .replace(/-+/g, '-')
                    .trim();

                if (num && num.length >= 2) {
                    candidates.push(num);
                }

                for (let i = 1; i < match.length; i++) {
                    if (match[i]) {
                        candidates.push(match[i].replace(/[\s._\/]/g, '-'));
                    }
                }
            }
        }

        return [...new Set(candidates)].filter(n => n.length >= 2);
    }

    // ========================================================================
    // 1. CREAR EL WIDGET EN EL DOM
    // ========================================================================
    function injectChatWidget() {
        const container = document.createElement('div');
        container.id = 'chatWidgetContainer';
        container.innerHTML = `
            <button id="chatToggleBtn" class="chat-toggle-btn" aria-label="Abrir Sucrebot">
                <img src="imagenes/sucrebot_avatar.png" alt="Sucrebot" class="chat-toggle-img">
            </button>

            <div id="chatWindow" class="chat-window" aria-hidden="true" role="dialog" aria-label="Sucrebot - Asistente Virtual del Concejo Municipal de Sucre">

                <div class="chat-header">
                    <div class="chat-header-info">
                        <div class="chat-avatar"><img src="imagenes/sucrebot_avatar.png" alt="Sucrebot"></div>
                        <div>
                            <h3 class="chat-title">Sucrebot</h3>
                            <span class="chat-status"><span class="status-dot"></span>En línea</span>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button id="chatSettingsBtn" class="chat-header-action" aria-label="Configuración" title="Configuración">
                            <i class="fas fa-cog"></i>
                        </button>
                        <button id="chatCloseBtn" class="chat-header-action" aria-label="Cerrar chat">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <div id="chatMessages" class="chat-messages" aria-live="polite" aria-atomic="false">
                    <div class="chat-welcome">
                        <div class="chat-welcome-icon"><i class="fas fa-landmark"></i></div>
                        <p><strong>¡Saludos! Soy Sucrebot, su asistente virtual del Concejo Municipal de Sucre.</strong></p>
                        <p>Puedo orientarle en:</p>
                        <ul>
                            <li>🔍 Consultar ordenanzas por N°, nombre, materia o año</li>
                            <li>📋 Brindar información general sobre las normativas municipales</li>
                            <li>⚖️ Indicar el estado jurídico de las ordenanzas vigentes</li>
                            <li>👁️ Toda ordenanza puede leerse en vista previa, sin salir del portal</li>
                        </ul>
                        <p class="chat-welcome-note">¿En qué puedo servirle, ciudadano?</p>
                    </div>
                </div>

                <div id="chatTyping" class="chat-typing" style="display:none">
                    <div class="typing-bubble">
                        <span></span><span></span><span></span>
                    </div>
                </div>

                <div class="chat-input-area">
                    <input type="text" id="chatInput" placeholder="Ej: N.°504-12-2025 o 'tributos'..." autocomplete="off" maxlength="500">
                    <button id="chatSendBtn" aria-label="Enviar mensaje">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>

            <!-- Panel de configuración (simplificado: sin login ficticio) -->
            <div id="chatSettingsPanel" class="chat-settings-panel" style="display:none">
                <div class="chat-settings-header">
                    <h4><i class="fas fa-cog"></i> Configuración</h4>
                    <button id="chatSettingsClose" class="chat-settings-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="chat-settings-body">

                    <div class="settings-group">
                        <label for="modelSelect" style="display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-brain" style="color:#8FAED4;"></i>
                            <span>Modelo de IA</span>
                        </label>
                        <select id="modelSelect">
                            <option value="openrouter/free">🔀 OpenRouter Free (Auto - Recomendado)</option>
                            <option value="inclusionai/ling-3.0-flash:free">InclusionAI Ling 3.0 Flash (Free)</option>
                            <option value="nvidia/nemotron-3-super-120b-a12b:free">NVIDIA Nemotron 3 Super (Free)</option>
                            <option value="nvidia/nemotron-3-nano-30b-a3b:free">NVIDIA Nemotron 3 Nano (Free)</option>
                            <option value="google/gemma-4-26b-a4b-it:free">Google Gemma 4 26B (Free)</option>
                        </select>
                        <small><strong>Recomendado:</strong> "OpenRouter Free" elige automáticamente el mejor modelo gratuito disponible.</small>
                    </div>

                    <div class="settings-group">
                        <label style="display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-shield-halved" style="color:#2e7d32;"></i>
                            <span>Seguridad de la API Key</span>
                        </label>
                        <p class="settings-note">
                            La clave de OpenRouter reside de forma segura en un <strong>proxy de servidor</strong>
                            (Cloudflare Workers) y nunca se expone en el navegador del visitante.
                        </p>
                    </div>

                    <button id="saveSettingsBtn" class="chat-settings-save">Guardar configuración</button>
                    <div id="settingsError" class="settings-error" style="display:none"></div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        dom = {
            toggleBtn: document.getElementById('chatToggleBtn'),
            chatWindow: document.getElementById('chatWindow'),
            messagesArea: document.getElementById('chatMessages'),
            input: document.getElementById('chatInput'),
            sendBtn: document.getElementById('chatSendBtn'),
            typingIndicator: document.getElementById('chatTyping'),
            closeBtn: document.getElementById('chatCloseBtn'),
            settingsBtn: document.getElementById('chatSettingsBtn'),
            settingsPanel: document.getElementById('chatSettingsPanel'),
            settingsClose: document.getElementById('chatSettingsClose'),
            modelSelect: document.getElementById('modelSelect'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            settingsError: document.getElementById('settingsError'),
        };
    }

    // ========================================================================
    // 2. SUGERENCIAS RÁPIDAS
    // ========================================================================
    // ========================================================================
    // 3. CARGAR ORDENANZAS (con la MISMA normalización del sitio)
    // ========================================================================
    async function loadModelConfig() {
        // PRIORIDAD 1: Modelo guardado en localStorage
        const savedModel = localStorage.getItem('openrouter_model');
        if (savedModel && isValidModel(savedModel)) {
            currentModel = savedModel;
            console.log(`[Sucrebot] Modelo cargado desde localStorage: ${currentModel}`);
            return;
        }

        // PRIORIDAD 2: Modelo desde modelo.json
        try {
            const response = await fetch('./modelo.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('No se pudo cargar modelo.json');
            const config = await response.json();
            if (config.modelo && isValidModel(config.modelo)) {
                currentModel = config.modelo;
                console.log(`[Sucrebot] Modelo cargado desde modelo.json: ${currentModel}`);
            } else {
                currentModel = CONFIG.DEFAULT_MODEL;
            }
        } catch (err) {
            console.warn('[Sucrebot] Usando modelo predeterminado:', err.message);
            currentModel = CONFIG.DEFAULT_MODEL;
        }
    }

    function isValidModel(model) {
        if (!model || typeof model !== 'string') return false;
        const validPrefixes = [
            'google/', 'nvidia/', 'openai/', 'inclusionai/',
            'poolside/', 'cohere/', 'openrouter/'
        ];
        return validPrefixes.some(prefix => model.startsWith(prefix));
    }

    async function loadOrdinances() {
        try {
            const response = await fetch('./ordenanzas.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('No se pudo cargar ordenanzas.json');
            const data = await response.json();

            // CLAVE: normalizar materias con la misma función que script.js,
            // para que el bot y el sitio hablen del mismo inventario.
            ordinances = data.map(item => ({
                ...item,
                materia: normalizeCategory(item.materia)
            }));

            const conContenido = ordinances.filter(o => o.contenido || o.resumen).length;
            console.log(`[Sucrebot] Ordenanzas: ${ordinances.length} | Con contenido: ${conContenido}`);

            if (conContenido > 0) {
                addSystemMessage(`📚 Base cargada: ${ordinances.length} ordenanzas (${conContenido} con contenido de PDF).`);
            }
        } catch (err) {
            console.error('[Sucrebot] Error:', err);
            addSystemMessage('⚠️ No se pudo cargar la base de ordenanzas.');
        }
    }

    // ========================================================================
    // 4. BUSCAR ORDENANZAS RELEVANTES
    // ========================================================================
    const SINONIMOS = {
        'mujer': ['proteccion a la mujer', 'proteccion de la mujer', 'mujeres', 'violencia de genero', 'igualdad de genero'],
        'mujeres': ['proteccion a la mujer', 'proteccion de la mujer', 'mujer', 'violencia de genero'],
        'aseo': ['aseo urbano', 'limpieza', 'basura', 'recoleccion de basura', 'reciclaje', 'desechos solidos'],
        'basura': ['aseo', 'aseo urbano', 'limpieza', 'recoleccion de basura', 'reciclaje'],
        'tributo': ['tributos', 'impuestos', 'impuesto', 'recaudacion', 'fiscal'],
        'impuesto': ['tributos', 'tributo', 'impuestos', 'recaudacion', 'fiscal'],
        'salud': ['salud publica', 'hospital', 'medico', 'sanidad', 'enfermedad'],
        'educacion': ['escuela', 'colegio', 'universidad', 'estudio', 'ensenanza'],
        'ecologia': ['medio ambiente', 'contaminacion', 'verde', 'sostenible', 'naturaleza', 'reciclaje'],
        'urbanismo': ['construccion', 'planificacion urbana', 'vivienda', 'obra', 'edificacion', 'desarrollo urbano', 'zonificacion'],
        'presupuesto': ['finanzas', 'gasto publico', 'economia', 'hacienda', 'dinero'],
        'hacienda': ['presupuesto', 'finanzas', 'economia', 'dinero', 'recaudacion'],
        'convivencia': ['convivencia ciudadana', 'orden publico', 'seguridad ciudadana', 'paz', 'ciudadano'],
        'seguridad': ['convivencia ciudadana', 'orden publico', 'proteccion'],
        'deporte': ['deportes', 'recreacion', 'cancha', 'estadio', 'gimnasio'],
        'deportes': ['deporte', 'recreacion', 'cancha', 'estadio'],
        'cultura': ['arte', 'museo', 'patrimonio', 'tradicion', 'evento cultural'],
        'transporte': ['transito', 'via', 'carretera', 'avenida', 'calles', 'movilidad', 'vehiculo'],
        'transito': ['transporte', 'vialidad y transito', 'viabilidad', 'via', 'carretera', 'movilidad'],
        'viabilidad': ['vialidad y transito', 'transito', 'transporte'],
        'vialidad': ['vialidad y transito', 'transito'],
        'mercado': ['abastecimiento y mercadeo', 'comercio', 'venta', 'feria', 'economia local'],
        'comercio': ['mercado', 'abastecimiento y mercadeo', 'venta', 'economia local'],
        'mercadeo': ['abastecimiento y mercadeo', 'mercado', 'comercio'],
        'nino': ['proteccion de ninos', 'proteccion de ninas', 'adolescente', 'infancia', 'menor', 'escolar'],
        'nina': ['proteccion de ninos', 'proteccion de ninas', 'adolescente', 'infancia', 'menor'],
        'adolescente': ['proteccion de ninos', 'proteccion de ninas', 'infancia', 'menor', 'joven'],
        'bien': ['bienes', 'patrimonio municipal', 'propiedad', 'activos'],
        'bienes': ['patrimonio municipal', 'propiedad', 'activos', 'inmueble'],
        'social': ['proteccion social', 'ayuda social', 'vulnerabilidad', 'pobreza'],
        'verde': ['areas verdes', 'parque', 'jardin', 'plaza', 'arbol', 'vegetacion', 'ecologia'],
        'arbol': ['areas verdes', 'parque', 'jardin', 'plaza', 'vegetacion'],
        'parque': ['areas verdes', 'jardin', 'plaza', 'recreacion'],
        'condecoracion': ['reconocimiento', 'honor', 'medalla', 'premio', 'distincion'],
        'reconocimiento': ['condecoracion', 'honor', 'medalla', 'premio'],
        'poder popular': ['consejo comunal', 'comuna', 'participacion ciudadana', 'comunitario'],
        'comunal': ['poder popular', 'consejo comunal', 'comuna'],
        'contraloria': ['control fiscal', 'auditoria', 'fiscalizacion', 'transparencia'],
        'reglamento': ['reglamentos', 'norma', 'regulacion', 'disposicion'],
        'reglamentos': ['reglamento', 'norma', 'regulacion'],
        'abastecimiento': ['abastecimiento y mercadeo', 'mercado', 'comercio', 'abasto'],
    };

    function expandirConsulta(query) {
        const normalized = normalizeText(query);
        const tokens = normalized.split(/\s+/).filter(t => t.length >= 2);
        const expandidos = new Set(tokens);

        tokens.forEach(token => {
            if (SINONIMOS[token]) {
                SINONIMOS[token].forEach(sin => expandidos.add(normalizeText(sin)));
            }
        });

        return Array.from(expandidos);
    }

    /**
     * Busca las ordenanzas más relevantes.
     * FIX v2: ya NO devuelve ordenanzas con score 0 como "fallback".
     * Antes, al devolver las 3 primeras aunque no coincidieran, el LLM
     * recibía ordenanzas irrelevantes y podía presentarlas como válidas,
     * y la rama de "no se encontró nada" jamás se ejecutaba.
     */
    function findRelevantOrdinances(query) {
        if (!ordinances.length || !query.trim()) return [];

        const normalizedQuery = normalizeText(query);
        const queryTokens = expandirConsulta(query);
        const extractedNumbers = extractOrdinanceNumber(query);

        const scored = ordinances.map(ord => {
            let score = 0;

            const ordId = normalizeText(ord.id || '');
            const ordNumero = normalizeText(ord.numero || '');
            const ordNombre = normalizeText(ord.nombre || '');
            const ordMateria = normalizeText(ord.materia || '');
            const ordEstado = normalizeText(ord.estado || '');
            const ordContenido = normalizeText(ord.contenido || ord.resumen || '');

            // === BÚSQUEDA POR NÚMERO (máxima prioridad) ===
            for (const num of extractedNumbers) {
                const normalizedNum = normalizeText(num);

                if (ordId === normalizedNum) score += 100;
                if (ordId.includes(normalizedNum)) score += 80;
                if (ordNumero === normalizedNum) score += 90;
                if (ordNumero.includes(normalizedNum)) score += 70;
                if (ordNombre.includes(normalizedNum)) score += 50;

                const numSinGuiones = normalizedNum.replace(/-/g, '');
                const idSinGuiones = ordId.replace(/-/g, '');
                const numOrdSinGuiones = ordNumero.replace(/-/g, '');

                if (numSinGuiones && (idSinGuiones.includes(numSinGuiones) || numSinGuiones.includes(idSinGuiones))) {
                    score += 60;
                }
                if (numSinGuiones && (numOrdSinGuiones.includes(numSinGuiones) || numSinGuiones.includes(numOrdSinGuiones))) {
                    score += 50;
                }

                const yearMatch = normalizedNum.match(/(\d{4})/);
                if (yearMatch && ord.anio && ord.anio.toString() === yearMatch[1]) {
                    score += 15;
                }
            }

            // === BÚSQUEDA POR MATERIA ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;
                if (ordMateria === token) score += 50;
                else if (ordMateria.includes(token)) score += 35;
                else if (token.includes(ordMateria) && ordMateria.length > 4) score += 25;
            }

            // === BÚSQUEDA POR NOMBRE ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;
                if (ordNombre === token) score += 40;
                else if (ordNombre.includes(token)) score += 25;
                else if (token.includes(ordNombre) && ordNombre.length > 4) score += 15;
            }

            // === BÚSQUEDA POR CONTENIDO/RESUMEN ===
            for (const token of queryTokens) {
                if (token.length < 4) continue;
                if (ordContenido.includes(token)) score += 15;
            }

            // === BÚSQUEDA POR ESTADO ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;
                if (ordEstado.includes(token)) score += 10;
            }

            // === BONIFICACIONES ===
            if (ordNombre.includes(normalizedQuery)) score += 20;
            if (ordMateria.includes(normalizedQuery)) score += 15;
            if (ord.contenido || ord.resumen) score += 5;

            return { ord, score };
        });

        scored.sort((a, b) => b.score - a.score);

        // FIX: solo devolver las que realmente coinciden (score > 0)
        const relevantes = scored.filter(s => s.score > 0);
        return relevantes.slice(0, CONFIG.MAX_CONTEXT_ORDINANCES).map(s => s.ord);
    }

    function countMatchingOrdinances(query) {
        if (!ordinances.length || !query.trim()) return { total: 0, matches: [] };

        const queryTokens = expandirConsulta(query);

        const matches = ordinances.filter(ord => {
            const ordMateria = normalizeText(ord.materia || '');
            const ordNombre = normalizeText(ord.nombre || '');
            const ordId = normalizeText(ord.id || '');

            for (const token of queryTokens) {
                if (token.length < 3) continue;
                if (ordMateria.includes(token) || ordNombre.includes(token) || ordId.includes(token)) {
                    return true;
                }
            }
            return false;
        });

        return { total: matches.length, matches };
    }

    function formatOrdinanceList(ordinancesList, materia) {
        const count = ordinancesList.length;
        let html = `<p><strong>Buenos días.</strong> En la materia <strong>${escapeHTML(materia)}</strong> se encuentran <strong>${count}</strong> ordenanza${count > 1 ? 's' : ''} registradas:</p>`;
        html += `<ul style="margin:10px 0;padding-left:18px;max-height:300px;overflow-y:auto;">`;

        ordinancesList.forEach(ord => {
            const estadoColor = ord.estado === 'Vigente' ? '#2e7d32' :
                               ord.estado === 'Derogada' ? '#d32f2f' :
                               ord.estado === 'En revisión' ? '#ed6c02' : '#757575';
            html += `<li style="margin-bottom:6px;font-size:12px;">`;
            html += `<strong>${escapeHTML(ord.id)}</strong> — ${escapeHTML(ord.nombre)} `;
            html += `<span style="color:${estadoColor};font-size:10px;font-weight:700;">(${escapeHTML(ord.estado || 'Se desconoce')})</span>`;
            html += `</li>`;
        });

        html += `</ul>`;
        html += `<p style="font-size:12px;color:#666;">Cada ordenanza cuenta con vista previa del documento en esta plataforma. ¿Desea información detallada de alguna en particular? Puede consultar por su número. Quedamos a su orden. 👋</p>`;
        return html;
    }

    // ========================================================================
    // 5. CONSTRUIR SYSTEM PROMPT
    // ========================================================================
    function buildSystemPrompt(relevantOrdinances, userQuery) {
        const extractedNumbers = extractOrdinanceNumber(userQuery);
        const isNumberSearch = extractedNumbers.length > 0;
        const { total: totalMatches } = countMatchingOrdinances(userQuery);
        const tienenContenido = relevantOrdinances.some(o => o.contenido || o.resumen);

        let prompt = `Eres Sucrebot, el asistente virtual del Concejo Municipal de Sucre, Estado Miranda, Venezuela. Atiendes a los ciudadanos con cordialidad, respeto y profesionalismo propio de un ente gubernamental venezolano.

REGLAS DE COMUNICACIÓN (MUY IMPORTANTE):
1. Usa SIEMPRE español venezolano formal. Ejemplos:
   - "Buenos días/tardes", "Saludos", "Con gusto", "Quedamos a su orden"
   - "Puede consultar", "Le informamos que", "A continuación"
   - Dirígete al usuario como "usted", nunca "vos" ni "tú"
2. Se claro, conciso y servicial.
3. Responde SIEMPRE en español.
4. Responde SIEMPRE en TEXTO PLANO, sin etiquetas HTML de ningún tipo. Para énfasis usa únicamente **negritas** con doble asterisco. Nunca escribas <p>, <strong>, <br>, <div> ni atributos style: el sistema se encarga del formato.
5. No inventes datos específicos de ordenanzas que no estén en el contexto. Si la consulta no coincide exactamente, brinda una respuesta útil orientando al ciudadano y ofreciendo alternativas de búsqueda.
6. NO compartas enlaces de Google Drive directamente; indica que el documento completo está disponible con vista previa en esta plataforma web, sin necesidad de acudir a ninguna oficina.
7. NUNCA indique al ciudadano que debe acercarse a oficinas físicas, al Palacio Municipal o a cualquier sede presencial para obtener el texto completo de una ordenanza.
8. Cuando el prompt incluya una PLANTILLA EXACTA de respuesta, úsala AL PIE DE LA LETRA: mismos rótulos, mismo orden, mismo formato. No la mejores ni la reescribas con tu propio estilo.

`;

        if (relevantOrdinances.length > 0) {
            if (isNumberSearch && !tienenContenido) {
                prompt += `INSTRUCCIÓN ESPECIAL: El ciudadano consultó por el número de ordenanza ${extractedNumbers.join(', ')}.

Las ordenanzas listadas abajo tienen SOLO metadatos (nombre, materia, año, estado). Responde usando EXACTAMENTE esta plantilla, sustituyendo los valores reales de la ordenanza. No agregues, quites ni reordenes campos:

Buenos días. A continuación, le presento la información de la ordenanza solicitada:

Número: {id}
Nombre: {nombre}
Materia: {materia}
Año de emisión: {año}
Estado jurídico: {estado}

Síntesis general: {2 a 4 oraciones sobre de qué trata la ordenanza, basadas SOLO en su título y materia}

El documento completo puede leerse en vista previa en esta plataforma. Quedamos a su orden.

REGLAS DE LA PLANTILLA:
- Copia los rótulos exactos: "Número:", "Nombre:", "Materia:", "Año de emisión:", "Estado jurídico:".
- En "Estado jurídico" escribe únicamente el estado (Vigente, En revisión, Derogada, Se desconoce), sin explicaciones.
- NO inventes artículos, disposiciones clave ni contenido que no esté en los metadatos.
- Si hay varias candidatas, usa la de mayor coincidencia con el número consultado.

`;
            } else if (isNumberSearch && tienenContenido) {
                prompt += `INSTRUCCIÓN ESPECIAL: El ciudadano consultó por el número de ordenanza ${extractedNumbers.join(', ')}.
Dale un resumen estructurado con:
- Número y nombre de la ordenanza
- Materia y año
- Estado jurídico
- Disposiciones clave / artículos importantes (basados en el contenido disponible)
- Objetivo general de la normativa

`;
            } else if (!isNumberSearch) {
                prompt += `INSTRUCCIÓN ESPECIAL: El ciudadano consultó sobre un tema específico.

Se encontraron ${totalMatches} ordenanzas en total que coinciden con su consulta. A continuación se muestran las primeras ${relevantOrdinances.length} para contexto. Tu respuesta DEBE incluir:
- Un saludo cordial
- Indicar que hay ${totalMatches} ordenanzas registradas relacionadas
- Mencionar las ordenanzas mostradas abajo con: número, nombre, materia, año y estado
- Una breve descripción de cada una basada en su título
- Cerrar con "Quedamos a su orden" o similar

NO digas "no se encontraron ordenanzas" porque SÍ se encontraron ${totalMatches} en total.
NO inventes artículos ni contenido que no esté en los metadatos.

`;
            }
        }

        if (relevantOrdinances.length > 0) {
            prompt += `=== ORDENANZAS ENCONTRADAS ===\n\n`;

            let totalChars = 0;

            relevantOrdinances.forEach((ord, idx) => {
                const ordHeader = `--- ORDENANZA ${idx + 1} ---\n`;
                const ordMeta = `ID: ${ord.id || 'S/N'} | Nombre: ${ord.nombre || 'Sin nombre'}\nMateria: ${ord.materia || 'N/A'} | Año: ${ord.anio || 'N/A'} | Estado: ${ord.estado || 'N/A'}\n`;

                let contenido = '';
                const tieneContenido = !!(ord.contenido || ord.resumen);

                if (tieneContenido) {
                    if (ord.resumen) {
                        contenido = `RESUMEN: ${ord.resumen}\n`;
                    }
                    if (ord.contenido) {
                        const maxLen = CONFIG.MAX_CONTENT_LENGTH;
                        const texto = ord.contenido.length > maxLen
                            ? ord.contenido.substring(0, maxLen) + '... [continúa]'
                            : ord.contenido;
                        contenido += `CONTENIDO COMPLETO:\n${texto}\n`;
                    }
                } else {
                    contenido = `(Metadatos disponibles: nombre, materia, año, estado. Usa esta información para responder al ciudadano.)\n`;
                }

                const ordBlock = ordHeader + ordMeta + contenido + '\n';

                if (totalChars + ordBlock.length > CONFIG.MAX_TOTAL_CONTEXT && idx > 0) {
                    prompt += `[Se omitieron más ordenanzas por límite de contexto]\n`;
                    return;
                }

                prompt += ordBlock;
                totalChars += ordBlock.length;
            });

            prompt += `=== FIN DE ORDENANZAS ===\n\n`;
        } else {
            prompt += `No se encontraron ordenanzas que coincidan con la consulta del ciudadano. Sé honesto y cordial:
- Indica amablemente que no se encontró una ordenanza específica con ese nombre o número
- Sugiere probar con términos más generales (ej: "aseo" en vez de "recolección de basura domiciliaria")
- Ofrece orientación sobre otras materias disponibles
- NUNCA inventes una ordenanza ni des datos de una que no esté en el contexto
Cierra ofreciéndote a ayudar con otra consulta.

`;
        }

        prompt += `Responda la consulta del ciudadano:`;
        return prompt;
    }

    // ========================================================================
    // 6. ENVIAR MENSAJE A OPENROUTER (con proxy y rate limiting)
    // ========================================================================
    async function notifyAdmin(errorInfo) {
        const webhookUrl = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;
        if (!webhookUrl) return;

        const payload = {
            subject: '[URGENTE] Sucrebot - Falla con modelo de IA',
            message: `Sucrebot ha detectado un problema con el modelo de IA.\n\nModelo: ${errorInfo.model}\nError: ${errorInfo.status} - ${errorInfo.message}\nFecha: ${new Date().toLocaleString('es-VE')}`,
            model: errorInfo.model,
            errorStatus: errorInfo.status,
            errorMessage: errorInfo.message,
            timestamp: new Date().toISOString(),
            url: window.location.href
        };

        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.warn('[Sucrebot] No se pudo enviar notificación:', e);
        }
    }

    async function fetchWithRetry(url, options, maxRetries = 2) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);

                if (response.status === 429 && attempt < maxRetries) {
                    const delayMs = 3000 * (attempt + 1);
                    console.log(`[Sucrebot] Límite alcanzado (429). Reintentando en ${delayMs / 1000}s...`);
                    await sleep(delayMs);
                    continue;
                }

                return response;
            } catch (networkErr) {
                if (attempt < maxRetries) {
                    const delayMs = 2000 * (attempt + 1);
                    await sleep(delayMs);
                    continue;
                }
                throw networkErr;
            }
        }
        throw new Error('Se agotaron los reintentos');
    }

    async function sendToAI(userMessage) {
        const useProxy = CONFIG.PROXY_URL && CONFIG.PROXY_URL.length > 5;
        const savedKey = localStorage.getItem('openrouter_api_key');
        const key = (savedKey && savedKey.startsWith('sk-or-v1-')) ? savedKey : CONFIG.HARDCODED_API_KEY;
        let model = currentModel;

        const relevant = findRelevantOrdinances(userMessage);
        const extractedNumbers = extractOrdinanceNumber(userMessage);
        const isNumberSearch = extractedNumbers.length > 0;
        const { total: totalMatches, matches: allMatches } = countMatchingOrdinances(userMessage);

        // Respuesta directa (sin LLM) para consultas por materia: lista completa
        if (!isNumberSearch && totalMatches > 0) {
            const materiaPrincipal = allMatches[0].materia || 'la materia consultada';
            const responseHtml = formatOrdinanceList(allMatches, materiaPrincipal);
            chatHistory.push({ role: 'user', content: userMessage });
            // FIX: guardar texto plano en el historial, no el HTML de la lista.
            chatHistory.push({ role: 'assistant', content: toPlainText(responseHtml) });
            addBotMessage(responseHtml);
            return;
        }

        const systemPrompt = buildSystemPrompt(relevant, userMessage);

        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory.slice(-CONFIG.MAX_HISTORY_MESSAGES),
            { role: 'user', content: userMessage }
        ];

        showTyping();

        // FALLBACK AUTOMÁTICO: si el modelo falla, intentar con openrouter/free
        const modelStack = [model];
        if (model !== 'openrouter/free') {
            modelStack.push('openrouter/free');
        }

        let lastError = null;

        for (const tryModel of modelStack) {
            try {
                lastApiCallAt = Date.now();

                const endpoint = useProxy ? CONFIG.PROXY_URL : CONFIG.OPENROUTER_URL;
                const headers = { 'Content-Type': 'application/json' };
                if (!useProxy) {
                    headers['Authorization'] = `Bearer ${key}`;
                    headers['HTTP-Referer'] = window.location.href;
                    headers['X-Title'] = 'Concejo Municipal de Sucre - Sucrebot';
                }

                const response = await fetchWithRetry(endpoint, {
                    method: 'POST',
                    headers: headers,
                    cache: 'no-store',
                    body: JSON.stringify({
                        model: tryModel,
                        messages: apiMessages,
                        temperature: 0.1,
                        max_tokens: 2000
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errMsg = errorData.error?.message || `Error HTTP ${response.status}`;

                    if (response.status === 401) {
                        throw new Error(useProxy
                            ? 'El proxy rechazó la petición. Verifique la clave en el servidor.'
                            : 'API Key inválida. Por favor contacte al administrador.');
                    }
                    if (response.status === 429) {
                        throw new Error('Límite de solicitudes alcanzado. Intente de nuevo en unos segundos.');
                    }
                    if (response.status === 402) {
                        throw new Error(`El modelo "${tryModel}" ya no está disponible de forma gratuita. Seleccione otro en la configuración ⚙️.`);
                    }
                    if (response.status === 404 || errMsg.includes('not a valid model') || errMsg.includes('model not found')) {
                        if (tryModel !== 'openrouter/free' && modelStack.length > 1) {
                            console.warn(`[Sucrebot] Modelo "${tryModel}" no disponible. Intentando fallback...`);
                            lastError = { status: 404, message: errMsg };
                            continue;
                        }
                        throw new Error(`El modelo "${tryModel}" no está disponible. Cambie la configuración ⚙️.`);
                    }
                    throw new Error(errMsg);
                }

                const data = await response.json();
                let reply = data.choices?.[0]?.message?.content || 'No se recibió una respuesta válida.';

                // Limpiar metadatos de seguridad que algunos modelos gratuitos incluyen
                reply = reply.replace(/User Safety:\s*safe\s*Response Safety:\s*safe/gi, '').trim();

                chatHistory.push({ role: 'user', content: userMessage });
                chatHistory.push({ role: 'assistant', content: reply });

                if (chatHistory.length > CONFIG.MAX_HISTORY_MESSAGES * 2) {
                    chatHistory = chatHistory.slice(-CONFIG.MAX_HISTORY_MESSAGES * 2);
                }

                addBotMessage(formatBotReply(reply));
                return;

            } catch (err) {
                if (tryModel === modelStack[modelStack.length - 1]) {
                    throw err;
                }
                lastError = err;
                console.warn(`[Sucrebot] Fallo con ${tryModel}: ${err.message}. Probando fallback...`);
            }
        }

        throw lastError || new Error('Todos los modelos fallaron');
    }

    async function sendToAIWrapper(userMessage) {
        try {
            await sendToAI(userMessage);
        } catch (err) {
            console.error('[Sucrebot] Error:', err);

            notifyAdmin({
                model: currentModel,
                status: 'ERROR',
                message: err.message
            });

            addBotMessage(`🛠️ <strong>Disculpe las molestias.</strong><br><br>Sucrebot está experimentando un pequeño problema técnico en este momento. Nuestro equipo de soporte ya ha sido notificado y estamos trabajando para restablecer el servicio a la brevedad.<br><br>Por favor, intente de nuevo más tarde. Quedamos a su orden.`);
        } finally {
            hideTyping();
        }
    }

    // ========================================================================
    // 7. COLA DE MENSAJES (rate limiting + orden garantizado)
    // ========================================================================
    function enqueueMessage(text) {
        messageQueue.push(text);
        if (!isProcessingQueue) processQueue();
    }

    async function processQueue() {
        if (isProcessingQueue) return;
        isProcessingQueue = true;

        while (messageQueue.length) {
            const text = messageQueue.shift();
            addUserMessage(text);

            // Pausa mínima entre llamadas a la API (OpenRouter free ~20 RPM)
            const elapsed = Date.now() - lastApiCallAt;
            if (lastApiCallAt && elapsed < CONFIG.MIN_INTERVAL_MS) {
                const espera = Math.ceil((CONFIG.MIN_INTERVAL_MS - elapsed) / 1000);
                addSystemMessage(`⏳ Un momento por favor, evitando saturar el servicio (${espera}s)...`);
                await sleep(CONFIG.MIN_INTERVAL_MS - elapsed);
            }

            await sendToAIWrapper(text);
            saveHistory();
        }

        isProcessingQueue = false;
    }

    // ========================================================================
    // 8. UI - RENDERIZAR MENSAJES
    // ========================================================================
    function addUserMessage(text) {
        const div = document.createElement('div');
        div.className = 'chat-msg chat-msg-user';
        div.innerHTML = `<div class="chat-bubble-user">${escapeHTML(text)}</div>`;
        dom.messagesArea.appendChild(div);
        scrollToBottom();
    }

    function addBotMessage(html) {
        const div = document.createElement('div');
        div.className = 'chat-msg chat-msg-bot';
        div.innerHTML = `
            <div class="chat-avatar-small"><img src="imagenes/sucrebot_avatar.png" alt="Sucrebot"></div>
            <div class="chat-bubble-bot">${html}</div>
        `;
        dom.messagesArea.appendChild(div);
        scrollToBottom();
    }

    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'chat-system-msg';
        div.textContent = text;
        dom.messagesArea.appendChild(div);
        scrollToBottom();
    }

    function showTyping() {
        isTyping = true;
        dom.typingIndicator.style.display = 'flex';
        scrollToBottom();
    }

    function hideTyping() {
        isTyping = false;
        dom.typingIndicator.style.display = 'none';
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            dom.messagesArea.scrollTop = dom.messagesArea.scrollHeight;
        });
    }

    // ========================================================================
    // 9. HISTORIAL PERSISTENTE
    // ========================================================================
    function saveHistory() {
        try {
            localStorage.setItem(CONFIG.HISTORY_STORAGE_KEY, JSON.stringify(chatHistory.slice(-12)));
        } catch (e) { /* sin almacenamiento disponible */ }
    }

    function restoreHistory() {
        try {
            const raw = localStorage.getItem(CONFIG.HISTORY_STORAGE_KEY);
            if (!raw) return;
            const hist = JSON.parse(raw);
            if (!Array.isArray(hist) || !hist.length) return;

            hist.forEach(m => {
                if (m.role === 'user') {
                    addUserMessage(m.content);
                    chatHistory.push({ role: 'user', content: m.content });
                } else if (m.role === 'assistant') {
                    addBotMessage(m.content);
                    // El historial enviado al modelo va en texto plano (sin HTML)
                    chatHistory.push({ role: 'assistant', content: toPlainText(m.content) });
                }
            });
            addSystemMessage('🕘 Conversación anterior restaurada.');
        } catch (e) { /* ignorar */ }
    }

    // ========================================================================
    // 10. UI - ABRIR/CERRAR/CONFIGURACIÓN
    // ========================================================================
    function toggleChat() {
        isChatOpen = !isChatOpen;
        dom.chatWindow.classList.toggle('show', isChatOpen);
        dom.chatWindow.setAttribute('aria-hidden', !isChatOpen);
        dom.toggleBtn.setAttribute('aria-expanded', isChatOpen);

        if (isChatOpen) {
            setTimeout(() => dom.input.focus(), 300);
        }
    }

    function openSettings() {
        dom.settingsPanel.style.display = 'block';
        dom.settingsError.style.display = 'none';
        dom.modelSelect.value = currentModel;
    }

    function closeSettings() {
        dom.settingsPanel.style.display = 'none';
    }

    function saveSettings() {
        const model = dom.modelSelect.value;
        localStorage.setItem('openrouter_model', model);
        currentModel = model;

        closeSettings();
        addSystemMessage('✅ Modelo de IA actualizado a: ' + model + '. Quedamos a su orden.');
    }

    // ========================================================================
    // 11. EVENT LISTENERS
    // ========================================================================
    function bindEvents() {
        dom.toggleBtn.addEventListener('click', toggleChat);
        dom.closeBtn.addEventListener('click', toggleChat);

        dom.sendBtn.addEventListener('click', handleSend);
        dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        dom.settingsBtn.addEventListener('click', openSettings);
        dom.settingsClose.addEventListener('click', closeSettings);
        dom.saveSettingsBtn.addEventListener('click', saveSettings);

        document.addEventListener('click', (e) => {
            if (isChatOpen &&
                !dom.chatWindow.contains(e.target) &&
                !dom.toggleBtn.contains(e.target) &&
                !dom.settingsPanel.contains(e.target)) {
                toggleChat();
            }
        });
    }

    function handleSend() {
        const text = dom.input.value.trim();
        if (!text) return;
        dom.input.value = '';
        enqueueMessage(text);
    }

    // ========================================================================
    // 12. INICIALIZACIÓN
    // ========================================================================
    function init() {
        injectChatWidget();
        bindEvents();
        loadModelConfig();
        loadOrdinances();
        restoreHistory();
    }

    init();
});
