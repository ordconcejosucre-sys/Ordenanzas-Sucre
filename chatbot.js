/**
 * Sucrebot - Asistente Virtual del Concejo Municipal de Sucre
 * OpenRouter (modelos gratuitos) - Agosto 2026
 * Tono: Espanol venezolano formal
 * Seguridad: API Key protegida por usuario/contrasena de administrador
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

        // === API KEY HARDCODEADA (funciona para todos los usuarios) ===
        // NOTA DE SEGURIDAD: Esta key esta expuesta en el frontend.
        // Cualquiera puede verla con DevTools. Considera usar un backend proxy.
        HARDCODED_API_KEY: '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',

        // === WEBHOOK HARDCODEADO (notificaciones de errores al admin) ===
        HARDCODED_WEBHOOK: 'https://formspree.io/f/xnpanzob',

        // === CREDENCIALES DE ADMINISTRADOR ===
        ADMIN_USER_HASH: '31c2dba39205cfa136524bdaf3982e0271a16cd57441d948ba0a10d44eaddefe',
        ADMIN_PASS_HASH: '5e7d91ecdda53344456707e0d5bcfca8951479965ae38478b55546731bd1ce51',
    };

    // ========================================================================
    // ESTADO
    // ========================================================================
    let ordinances = [];
    let chatHistory = [];
    let isChatOpen = false;
    let isTyping = false;
    let isAdminLoggedIn = false;
    let currentModel = CONFIG.DEFAULT_MODEL;

    // ========================================================================
    // REFERENCIAS DOM
    // ========================================================================
    let dom = {};

    // ========================================================================
    // UTILIDADES
    // ========================================================================
    const normalizeText = (text) => {
        if (!text) return '';
        return text.toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    };

    const escapeHTML = (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const extractOrdinanceNumber = (query) => {
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
    };

    // ========================================================================
    // 1. CREAR EL WIDGET EN EL DOM
    // ========================================================================
    function injectChatWidget() {
        const container = document.createElement('div');
        container.id = 'chatWidgetContainer';
        container.innerHTML = `
            <button id="chatToggleBtn" class="chat-toggle-btn" aria-label="Abrir Sucrebot">
                <img src="imagenes/sucrebot_avatar.png" alt="Sucrebot" class="chat-toggle-img">
                <span class="chat-notification-dot" id="chatNotification" style="display:none"></span>
            </button>

            <div id="chatWindow" class="chat-window" aria-hidden="true" role="dialog" aria-label="Sucrebot - Asistente Virtual del Concejo Municipal de Sucre">

                <div class="chat-header">
                    <div class="chat-header-info">
                        <div class="chat-avatar"><img src="imagenes/sucrebot_avatar.png" alt="Sucrebot"></div>
                        <div>
                            <h3 class="chat-title">Sucrebot</h3>
                            <span class="chat-status"><span class="status-dot"></span>En linea</span>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button id="chatSettingsBtn" class="chat-header-action" aria-label="Configuracion" title="Configuracion">
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
                        <p><strong>!Saludos! Soy Sucrebot, su asistente virtual del Concejo Municipal de Sucre.</strong></p>
                        <p>Puedo orientarle en:</p>
                        <ul>
                            <li>🔍 Consultar ordenanzas por N°, nombre, materia o ano</li>
                            <li>📋 Brindar informacion general sobre las normativas municipales</li>
                            <li>⚖️ Indicar el estado juridico de las ordenanzas vigentes</li>
                        </ul>
                        <p class="chat-welcome-note">¿En que puedo servirle, ciudadano?</p>
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

            <!-- Panel de configuracion -->
            <div id="chatSettingsPanel" class="chat-settings-panel" style="display:none">
                <div class="chat-settings-header">
                    <h4><i class="fas fa-cog"></i> Configuracion</h4>
                    <button id="chatSettingsClose" class="chat-settings-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="chat-settings-body">

                    <!-- LOGIN DE ADMIN (para desbloquear API Key) -->
                    <div id="adminLoginSection">
                        <div class="settings-group">
                            <label style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-lock" style="color:#d32f2f;"></i> 
                                <span>Acceso de Administrador</span>
                            </label>
                            <p style="font-size:11px;color:#888;margin:4px 0 8px;">
                                El campo de API Key esta protegido. Solo el administrador puede modificarlo.
                            </p>
                            <button id="btnShowAdminLogin" class="chat-settings-save" style="background:#6C7059;">
                                <i class="fas fa-lock"></i> Ingresar como Administrador
                            </button>
                        </div>

                        <!-- Formulario de login (inicialmente oculto) -->
                        <div id="adminLoginForm" style="display:none;margin-top:12px;padding:12px;background:#f5f5f5;border-radius:8px;border:1px solid #ddd;">
                            <div class="settings-group">
                                <label for="adminUser">Usuario</label>
                                <input type="text" id="adminUser" placeholder="Usuario administrador" autocomplete="off">
                            </div>
                            <div class="settings-group">
                                <label for="adminPass">Contrasena</label>
                                <input type="password" id="adminPass" placeholder="Contrasena" autocomplete="off">
                            </div>
                            <button id="btnAdminLogin" class="chat-settings-save" style="margin-top:8px;">
                                <i class="fas fa-sign-in-alt"></i> Acceder
                            </button>
                            <div id="adminLoginError" class="settings-error" style="display:none;margin-top:8px;"></div>
                        </div>
                    </div>

                    <!-- Seccion de API Key (bloqueada hasta login) -->
                    <div id="apiKeySection" style="display:none;opacity:0.5;pointer-events:none;">
                        <div class="settings-group">
                            <label for="apiKeyInput" style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-key" style="color:#C4A561;"></i>
                                <span>API Key de OpenRouter</span>
                                <span id="adminBadge" style="display:none;background:#2e7d32;color:white;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:auto;">ADMIN</span>
                            </label>
                            <input type="password" id="apiKeyInput" placeholder="sk-or-v1-..." readonly>
                            <small>Obtena su key gratuita en <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a></small>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:8px;">
                            <button id="btnShowKey" class="chat-settings-save" style="flex:1;background:#8FAED4;font-size:12px;">
                                <i class="fas fa-eye"></i> Ver/Ocultar
                            </button>
                        </div>

                        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">

                        <!-- Modelo de IA (solo admin) -->
                        <div class="settings-group">
                            <label for="modelSelect" style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-brain" style="color:#8FAED4;"></i>
                                <span>Modelo de IA Predeterminado</span>
                            </label>
                            <select id="modelSelect">
                                <option value="openrouter/free">🔀 OpenRouter Free (Auto - Recomendado)</option>
                                <option value="inclusionai/ling-3.0-flash:free">InclusionAI Ling 3.0 Flash (Free)</option>
                                <option value="nvidia/nemotron-3-super-120b-a12b:free">NVIDIA Nemotron 3 Super (Free)</option>
                                <option value="nvidia/nemotron-3-nano-30b-a3b:free">NVIDIA Nemotron 3 Nano (Free)</option>
                                <option value="google/gemma-4-26b-a4b-it:free">Google Gemma 4 26B (Free)</option>
                                <option value="poolside/laguna-s-2.1:free">Poolside Laguna S 2.1 (Free)</option>
                                <option value="cohere/north-mini-code:free">Cohere North Mini Code (Free)</option>
                            </select>
                            <small><strong>Recomendado:</strong> "OpenRouter Free" elige automaticamente el mejor modelo gratuito disponible. Nunca se cae.</small>
                        </div>

                        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">

                        <!-- Webhook de notificacion de errores (solo admin) -->
                        <div class="settings-group">
                            <label for="webhookInput" style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-bell" style="color:#e53935;"></i>
                                <span>Webhook de Notificaciones</span>
                            </label>
                            <input type="text" id="webhookInput" placeholder="https://formspree.io/f/XXXXXX" readonly>
                            <small>URL para recibir alertas cuando Sucrebot falle. Usa <a href="https://formspree.io" target="_blank" rel="noopener">Formspree</a> o cualquier endpoint POST.</small>
                        </div>
                    </div>

                    <button id="saveSettingsBtn" class="chat-settings-save">Guardar configuracion</button>
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
            apiKeyInput: document.getElementById('apiKeyInput'),
            modelSelect: document.getElementById('modelSelect'),
            webhookInput: document.getElementById('webhookInput'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            settingsError: document.getElementById('settingsError'),
            notification: document.getElementById('chatNotification'),
            btnShowAdminLogin: document.getElementById('btnShowAdminLogin'),
            adminLoginForm: document.getElementById('adminLoginForm'),
            adminUser: document.getElementById('adminUser'),
            adminPass: document.getElementById('adminPass'),
            btnAdminLogin: document.getElementById('btnAdminLogin'),
            adminLoginError: document.getElementById('adminLoginError'),
            apiKeySection: document.getElementById('apiKeySection'),
            adminBadge: document.getElementById('adminBadge'),
            btnShowKey: document.getElementById('btnShowKey'),
        };
    }

    // ========================================================================
    // 2. CARGAR ORDENANZAS
    // ========================================================================
    async function loadModelConfig() {
        // PRIORIDAD 1: Modelo guardado por el admin en localStorage
        const adminModel = localStorage.getItem('openrouter_model');
        if (adminModel && isValidModel(adminModel)) {
            currentModel = adminModel;
            console.log(`[Sucrebot] Modelo cargado desde localStorage (admin): ${currentModel}`);
            return;
        }

        // PRIORIDAD 2: Modelo desde modelo.json
        try {
            const response = await fetch('./modelo.json');
            if (!response.ok) throw new Error('No se pudo cargar modelo.json');
            const config = await response.json();
            if (config.modelo && isValidModel(config.modelo)) {
                currentModel = config.modelo;
                console.log(`[Sucrebot] Modelo cargado desde modelo.json: ${currentModel}`);
            } else {
                console.warn('[Sucrebot] modelo.json no tiene un modelo valido, usando default.');
                currentModel = CONFIG.DEFAULT_MODEL;
            }
        } catch (err) {
            console.warn('[Sucrebot] No se pudo cargar modelo.json, usando modelo predeterminado:', err.message);
            currentModel = CONFIG.DEFAULT_MODEL;
        }
    }

    /**
     * Valida que un string de modelo sea reconocido por OpenRouter.
     * Incluye el router automatico openrouter/free.
     */
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
            const response = await fetch('./ordenanzas.json');
            if (!response.ok) throw new Error('No se pudo cargar ordenanzas.json');
            ordinances = await response.json();

            const conContenido = ordinances.filter(o => o.contenido || o.resumen).length;
            console.log(`[Chatbot] Ordenanzas: ${ordinances.length} | Con contenido: ${conContenido}`);

            if (conContenido > 0) {
                addSystemMessage(`📚 Base cargada: ${ordinances.length} ordenanzas (${conContenido} con contenido de PDF).`);
            }
        } catch (err) {
            console.error('[Chatbot] Error:', err);
            addSystemMessage('⚠️ No se pudo cargar la base de ordenanzas.');
        }
    }

    // ========================================================================
    // 3. BUSCAR ORDENANZAS RELEVANTES
    // ========================================================================
    const SINONIMOS = {
        'mujer': ['proteccion a la mujer', 'proteccion de la mujer', 'mujeres', 'feminismo', 'violencia de genero', 'igualdad de genero'],
        'mujeres': ['proteccion a la mujer', 'proteccion de la mujer', 'mujer', 'feminismo', 'violencia de genero'],
        'aseo': ['aseo urbano', 'limpieza', 'basura', 'recoleccion de basura', 'reciclaje', 'higiene'],
        'basura': ['aseo', 'aseo urbano', 'limpieza', 'recoleccion de basura', 'reciclaje'],
        'tributo': ['tributos', 'impuestos', 'impuesto', 'recaudacion', 'fiscal'],
        'impuesto': ['tributos', 'tributo', 'impuestos', 'recaudacion', 'fiscal'],
        'salud': ['salud publica', 'hospital', 'medico', 'sanidad', 'enfermedad'],
        'educacion': ['escuela', 'colegio', 'universidad', 'estudio', 'academico', 'ensenanza'],
        'ecologia': ['medio ambiente', 'contaminacion', 'verde', 'sostenible', 'naturaleza', 'reciclaje'],
        'urbanismo': ['construccion', 'planificacion urbana', 'vivienda', 'obra', 'edificacion', 'desarrollo urbano'],
        'presupuesto': ['finanzas', 'gasto publico', 'economia', 'hacienda', 'dinero'],
        'hacienda': ['presupuesto', 'finanzas', 'economia', 'dinero', 'recaudacion'],
        'convivencia': ['convivencia ciudadana', 'orden publico', 'seguridad ciudadana', 'paz', 'ciudadano'],
        'seguridad': ['convivencia ciudadana', 'orden publico', 'policia', 'proteccion'],
        'deporte': ['deportes', 'recreacion', 'cancha', 'estadio', 'gimnasio', 'atletismo'],
        'cultura': ['arte', 'museo', 'patrimonio', 'tradicion', 'folklore', 'evento cultural'],
        'transporte': ['transito', 'via', 'carretera', 'avenida', 'calles', 'movilidad', 'vehiculo'],
        'transito': ['transporte', 'via', 'carretera', 'avenida', 'calles', 'movilidad'],
        'mercado': ['abastecimiento', 'comercio', 'venta', 'feria', 'economia local'],
        'comercio': ['mercado', 'abastecimiento', 'venta', 'economia local'],
        'nino': ['proteccion de ninos', 'proteccion de ninas', 'adolescente', 'infancia', 'menor', 'escolar'],
        'ninno': ['proteccion de ninos', 'proteccion de ninas', 'adolescente', 'infancia', 'menor'],
        'nina': ['proteccion de ninos', 'proteccion de ninas', 'adolescente', 'infancia', 'menor'],
        'adolescente': ['proteccion de ninos', 'proteccion de ninas', 'infancia', 'menor', 'joven'],
        'bien': ['bienes', 'patrimonio municipal', 'propiedad', 'activos'],
        'bienes': ['patrimonio municipal', 'propiedad', 'activos', 'inmueble'],
        'social': ['proteccion social', 'welfare', 'ayuda social', 'vulnerabilidad', 'pobreza'],
        'verde': ['areas verdes', 'parque', 'jardin', 'plaza', 'arbol', 'vegetacion', 'ecologia'],
        'arbol': ['areas verdes', 'parque', 'jardin', 'plaza', 'vegetacion', 'ecologia'],
        'parque': ['areas verdes', 'jardin', 'plaza', 'recreacion', 'deporte'],
        'deportes': ['deporte', 'recreacion', 'cancha', 'estadio'],
        'condecoracion': ['reconocimiento', 'honor', 'medalla', 'premio', 'distincion'],
        'reconocimiento': ['condecoracion', 'honor', 'medalla', 'premio', 'distincion'],
        'poder popular': ['consejo comunal', 'comuna', 'participacion ciudadana', 'comunitario'],
        'comunal': ['poder popular', 'consejo comunal', 'comuna', 'participacion ciudadana'],
        'contraloria': ['control fiscal', 'auditoria', 'fiscalizacion', 'transparencia'],
        'reglamento': ['reglamentos', 'norma', 'regulacion', 'disposicion'],
        'reglamentos': ['reglamento', 'norma', 'regulacion', 'disposicion'],
        'abastecimiento': ['mercado', 'comercio', 'abasto', 'provision'],
        'mercadeo': ['mercado', 'comercio', 'venta', 'abasto'],
        'proteccion': ['seguridad', 'defensa', 'cuidado', 'resguardo'],
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

    function findRelevantOrdinances(query) {
        if (!ordinances.length || !query.trim()) return [];

        const normalizedQuery = normalizeText(query);
        const queryTokens = expandirConsulta(query);
        const extractedNumbers = extractOrdinanceNumber(query);

        console.log('[Sucrebot] Buscando numeros:', extractedNumbers);
        console.log('[Sucrebot] Tokens expandidos:', queryTokens);

        const scored = ordinances.map(ord => {
            let score = 0;

            const ordId = normalizeText(ord.id || '');
            const ordNumero = normalizeText(ord.numero || '');
            const ordNombre = normalizeText(ord.nombre || '');
            const ordMateria = normalizeText(ord.materia || '');
            const ordEstado = normalizeText(ord.estado || '');
            const ordContenido = normalizeText(ord.contenido || ord.resumen || '');

            // === BUSQUEDA POR NUMERO (maxima prioridad) ===
            for (const num of extractedNumbers) {
                const normalizedNum = normalizeText(num);

                if (ordId === normalizedNum || ordId.includes(normalizedNum)) {
                    score += 100;
                }
                if (ordNumero === normalizedNum || ordNumero.includes(normalizedNum)) {
                    score += 90;
                }
                if (ordNombre.includes(normalizedNum)) {
                    score += 60;
                }

                const numSinGuiones = normalizedNum.replace(/-/g, '');
                const idSinGuiones = ordId.replace(/-/g, '');
                const numOrdSinGuiones = ordNumero.replace(/-/g, '');

                if (idSinGuiones.includes(numSinGuiones) || numSinGuiones.includes(idSinGuiones)) {
                    score += 70;
                }
                if (numOrdSinGuiones.includes(numSinGuiones) || numSinGuiones.includes(numOrdSinGuiones)) {
                    score += 60;
                }

                const yearMatch = normalizedNum.match(/(\d{4})/);
                if (yearMatch && ord.anio) {
                    const yearStr = yearMatch[1];
                    if (ord.anio.toString() === yearStr) {
                        score += 20;
                    }
                }
            }

            // === BUSQUEDA POR MATERIA ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;

                if (ordMateria === token) {
                    score += 50;
                }
                else if (ordMateria.includes(token)) {
                    score += 35;
                }
                else if (token.includes(ordMateria) && ordMateria.length > 4) {
                    score += 25;
                }
            }

            // === BUSQUEDA POR NOMBRE ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;

                if (ordNombre === token) {
                    score += 40;
                }
                else if (ordNombre.includes(token)) {
                    score += 25;
                }
                else if (token.includes(ordNombre) && ordNombre.length > 4) {
                    score += 15;
                }
            }

            // === BUSQUEDA POR CONTENIDO/RESUMEN ===
            for (const token of queryTokens) {
                if (token.length < 4) continue;

                if (ordContenido.includes(token)) {
                    score += 15;
                }
            }

            // === BUSQUEDA POR ESTADO ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;
                if (ordEstado.includes(token)) {
                    score += 10;
                }
            }

            // === BONIFICACIONES ===
            if (ordNombre.includes(normalizedQuery)) score += 20;
            if (ordMateria.includes(normalizedQuery)) score += 15;
            if (ord.contenido || ord.resumen) score += 5;

            return { ord, score };
        });

        scored.sort((a, b) => b.score - a.score);

        const topResults = scored.slice(0, 8);
        console.log('[Sucrebot] Top resultados:', topResults.map(s => ({id: s.ord.id, materia: s.ord.materia, score: s.score})));

        const conScore = scored.filter(s => s.score > 0);
        if (conScore.length > 0) {
            return conScore.slice(0, CONFIG.MAX_CONTEXT_ORDINANCES).map(s => s.ord);
        }

        // Fallback: devolver los primeros 3 por si acaso
        return scored.slice(0, 3).map(s => s.ord);
    }

    /**
     * Cuenta cuantas ordenanzas coinciden con la consulta (sin limite de 3).
     */
    function countMatchingOrdinances(query) {
        if (!ordinances.length || !query.trim()) return { total: 0, matches: [] };

        const normalizedQuery = normalizeText(query);
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

    /**
     * Formatea una lista completa de ordenanzas para mostrar en el chat.
     */
    function formatOrdinanceList(ordinances, materia) {
        const count = ordinances.length;
        let html = `<p><strong>Buenos dias.</strong> En la materia <strong>${escapeHTML(materia)}</strong> se encuentran <strong>${count}</strong> ordenanza${count > 1 ? 's' : ''} registradas:</p>`;
        html += `<ul style="margin:10px 0;padding-left:18px;max-height:300px;overflow-y:auto;">`;

        ordinances.forEach(ord => {
            const estadoColor = ord.estado === 'Vigente' ? '#2e7d32' :
                               ord.estado === 'Derogada' ? '#d32f2f' :
                               ord.estado === 'En revision' ? '#ed6c02' : '#757575';
            html += `<li style="margin-bottom:6px;font-size:12px;">`;
            html += `<strong>${escapeHTML(ord.id)}</strong> — ${escapeHTML(ord.nombre)} `;
            html += `<span style="color:${estadoColor};font-size:10px;font-weight:700;">(${escapeHTML(ord.estado || 'Se desconoce')})</span>`;
            html += `</li>`;
        });

        html += `</ul>`;
        html += `<p style="font-size:12px;color:#666;">¿Desea informacion detallada de alguna ordenanza en particular? Puede consultar por su numero. Quedamos a su orden. 👋</p>`;
        return html;
    }

    // ========================================================================
    // 4. CONSTRUIR SYSTEM PROMPT
    // ========================================================================
    function buildSystemPrompt(relevantOrdinances, userQuery) {
        const extractedNumbers = extractOrdinanceNumber(userQuery);
        const isNumberSearch = extractedNumbers.length > 0;

        const { total: totalMatches } = countMatchingOrdinances(userQuery);

        const tienenContenido = relevantOrdinances.some(o => o.contenido || o.resumen);

        let prompt = `Eres Sucrebot, el asistente virtual del Concejo Municipal de Sucre, Estado Miranda, Venezuela. Atiendes a los ciudadanos con cordialidad, respeto y profesionalismo propio de un ente gubernamental venezolano.

REGLAS DE COMUNICACION (MUY IMPORTANTE):
1. Usa SIEMPRE espanol venezolano formal. Ejemplos:
   - "Buenos dias/tardes", "Saludos", "Con gusto", "Quedamos a su orden"
   - "Puede consultar", "Le informamos que", "A continuacion"
   - NO uses "che", "boludo", "dale", "mira vos", ni expresiones argentinas
   - NO uses "tenes", "hace", "deci". Usa "tiene", "haga", "diga" (formal)
   - Dirigite al usuario como "usted", nunca "vos"
2. Se claro, conciso y servicial. Un funcionario publico venezolano es cordial pero directo.
3. Responde SIEMPRE en espanol.
4. No inventes datos especificos de ordenanzas que no esten en el contexto. Si tenes ordenanzas relacionadas en el contexto, usalas para responder. Si la consulta es muy general o no coincide exactamente, brinda una respuesta util orientando al ciudadano y ofreciendo alternativas de busqueda.
5. Si la ordenanza tiene link a Drive, NO lo comparta directamente; indique que esta disponible en la plataforma.
6. NUNCA indique al ciudadano que debe acercarse a oficinas fisicas, al Palacio Municipal o a cualquier sede presencial para obtener el texto completo de una ordenanza. En su lugar, indique SIEMPRE que el documento completo esta disponible en esta plataforma web y puede acceder a el desde su navegador. Si no hay link disponible, indique que puede consultarlo en la plataforma web de ordenanzas del Concejo Municipal de Sucre.

`;

        if (relevantOrdinances.length > 0) {
            if (isNumberSearch && !tienenContenido) {
                prompt += `INSTRUCCION ESPECIAL: El ciudadano consulto por el numero de ordenanza ${extractedNumbers.join(', ')}. 

IMPORTANTE: Las ordenanzas listadas abajo tienen metadatos disponibles (nombre, materia, ano, estado). Debes usar ESTA INFORMACION para responder al ciudadano. 

Podes decir:
- Numero y nombre de la ordenanza
- Materia a la que pertenece
- Ano de emision
- Estado juridico (Vigente, En revision, Derogada, etc.)
- Una breve sintesis general de QUE TRATA la ordenanza, basada en su titulo y materia
- Si tiene link a Drive, indica que el documento completo esta disponible en la plataforma

NO inventes articulos, disposiciones clave, ni contenido especifico que no este en los metadatos.

`;
            } else if (isNumberSearch && tienenContenido) {
                prompt += `INSTRUCCION ESPECIAL: El ciudadano consulto por el numero de ordenanza ${extractedNumbers.join(', ')}. 
Dale un resumen estructurado con:
- Numero y nombre de la ordenanza
- Materia y ano
- Estado juridico
- Disposiciones clave / articulos importantes (basados en el contenido del PDF)
- Objetivo general de la normativa

`;
            } else if (!isNumberSearch && relevantOrdinances.length > 0) {
                prompt += `INSTRUCCION ESPECIAL: El ciudadano consulto sobre ordenanzas de una materia o tema especifico. 

IMPORTANTE: Se encontraron ${totalMatches} ordenanzas en total que coinciden con su consulta. A continuacion se muestran las primeras ${relevantOrdinances.length} para contexto. DEBES usar esta informacion para responder. 

Tu respuesta DEBE incluir:
- Un saludo cordial
- Indicar que hay ${totalMatches} ordenanzas registradas de esta materia
- Mencionar las ordenanzas mostradas abajo con: numero, nombre, materia, ano y estado
- Una breve descripcion de cada una basada en su titulo
- Si tiene link a Drive, indica que el documento completo esta disponible en la plataforma
- Cerra con "Quedamos a su orden" o similar

NO digas "no se encontraron ordenanzas" porque SI se encontraron ${totalMatches} en total.
NO inventes articulos ni contenido que no este en los metadatos.

`;
            }
        }

        if (relevantOrdinances.length > 0) {
            prompt += `=== ORDENANZAS ENCONTRADAS ===\n\n`;

            let totalChars = 0;

            relevantOrdinances.forEach((ord, idx) => {
                const ordHeader = `--- ORDENANZA ${idx + 1} ---\n`;
                const ordMeta = `ID: ${ord.id || 'S/N'} | Nombre: ${ord.nombre || 'Sin nombre'}\nMateria: ${ord.materia || 'N/A'} | Ano: ${ord.anio || 'N/A'} | Estado: ${ord.estado || 'N/A'}\n`;

                let contenido = '';
                const tieneContenido = !!(ord.contenido || ord.resumen);

                if (tieneContenido) {
                    if (ord.resumen) {
                        contenido = `RESUMEN: ${ord.resumen}\n`;
                    }
                    if (ord.contenido) {
                        const maxLen = CONFIG.MAX_CONTENT_LENGTH;
                        const texto = ord.contenido.length > maxLen 
                            ? ord.contenido.substring(0, maxLen) + '... [continua]' 
                            : ord.contenido;
                        contenido += `CONTENIDO COMPLETO:\n${texto}\n`;
                    }
                } else {
                    contenido = `(Metadatos disponibles: nombre, materia, ano, estado. Usa esta informacion para responder al ciudadano.)\n`;
                }

                const ordBlock = ordHeader + ordMeta + contenido + '\n';

                if (totalChars + ordBlock.length > CONFIG.MAX_TOTAL_CONTEXT && idx > 0) {
                    prompt += `[Se omitieron mas ordenanzas por limite de contexto]\n`;
                    return;
                }

                prompt += ordBlock;
                totalChars += ordBlock.length;
            });

            prompt += `=== FIN DE ORDENANZAS ===\n\n`;
        } else {
            prompt += `No se encontraron ordenanzas que coincidan EXACTAMENTE con los terminos de busqueda, pero el ciudadano hizo una consulta informal. Brinda una respuesta util basada en tu conocimiento general del Concejo Municipal de Sucre. Podes:
- Indicar que no se encontro una ordenanza especifica con ese nombre exacto
- Sugerir al ciudadano que pruebe con terminos mas generales (ej: "aseo" en vez de "aseo callejero")
- Ofrecer orientacion sobre donde puede obtener mas informacion
- Mencionar que puede consultar por numero de ordenanza si lo conoce
Se cordial, servicial y ofrezcase a ayudar con otra consulta.

`;
        }

        prompt += `Responda la consulta del ciudadano:`;
        return prompt;
    }

    // ========================================================================
    // 5. ENVIAR MENSAJE A OPENROUTER
    // ========================================================================
    async function notifyAdmin(errorInfo) {
        const webhookUrl = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;
        if (!webhookUrl) return;

        const payload = {
            subject: '[URGENTE] Sucrebot - Falla con modelo de IA',
            message: `Sucrebot ha detectado un problema con el modelo de IA.\n\nModelo: ${errorInfo.model}\nError: ${errorInfo.status} - ${errorInfo.message}\nFecha: ${new Date().toLocaleString('es-VE')}\nNavegador: ${navigator.userAgent.substring(0, 100)}`,
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
            console.log('[Sucrebot] Notificacion de error enviada al admin.');
        } catch (e) {
            console.warn('[Sucrebot] No se pudo enviar notificacion:', e);
        }
    }

    async function fetchWithRetry(url, options, maxRetries = 2) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);

                if (response.status === 429 && attempt < maxRetries) {
                    const delayMs = 3000 * (attempt + 1);
                    console.log(`[Sucrebot] Limite alcanzado (429). Reintentando en ${delayMs / 1000}s... (intento ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }

                return response;
            } catch (networkErr) {
                if (attempt < maxRetries) {
                    const delayMs = 2000 * (attempt + 1);
                    console.log(`[Sucrebot] Error de red. Reintentando en ${delayMs / 1000}s... (intento ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
                throw networkErr;
            }
        }
        throw new Error('Se agotaron los reintentos');
    }

    async function sendToAI(userMessage) {
        const savedKey = localStorage.getItem('openrouter_api_key');
        const key = (savedKey && savedKey.startsWith('sk-or-v1-')) ? savedKey : CONFIG.HARDCODED_API_KEY;
        let model = currentModel;

        console.log('[Sucrebot] Enviando peticion:', { model: model, keyPrefix: key.substring(0, 15) + '...' });

        const relevant = findRelevantOrdinances(userMessage);
        const extractedNumbers = extractOrdinanceNumber(userMessage);
        const isNumberSearch = extractedNumbers.length > 0;

        const { total: totalMatches, matches: allMatches } = countMatchingOrdinances(userMessage);

        if (!isNumberSearch && totalMatches > 0) {
            const materiaPrincipal = allMatches[0].materia || 'la materia consultada';
            const responseHtml = formatOrdinanceList(allMatches, materiaPrincipal);
            chatHistory.push({ role: 'user', content: userMessage });
            chatHistory.push({ role: 'assistant', content: responseHtml });
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

        // === FALLBACK AUTOMATICO: si el modelo principal falla, intentar con openrouter/free ===
        const modelStack = [model];
        if (model !== 'openrouter/free') {
            modelStack.push('openrouter/free');
        }

        let lastError = null;

        for (const tryModel of modelStack) {
            try {
                const response = await fetchWithRetry(CONFIG.OPENROUTER_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': window.location.href,
                        'X-Title': 'Concejo Municipal de Sucre - Sucrebot'
                    },
                    body: JSON.stringify({
                        model: tryModel,
                        messages: apiMessages,
                        temperature: 0.2,
                        max_tokens: 2000
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errMsg = errorData.error?.message || `Error HTTP ${response.status}`;

                    if (response.status === 401) {
                        throw new Error('API Key invalida. Por favor contacte al administrador.');
                    }
                    if (response.status === 429) {
                        throw new Error('Limite de solicitudes alcanzado. Se agotaron los reintentos automaticos.');
                    }
                    if (response.status === 402) {
                        throw new Error(`El modelo "${tryModel}" ya no esta disponible de forma gratuita. Seleccione otro en la configuracion ⚙️.`);
                    }
                    if (response.status === 404 || errMsg.includes('not a valid model') || errMsg.includes('model not found')) {
                        // Si es el primer modelo y tenemos fallback, intentar siguiente
                        if (tryModel !== 'openrouter/free' && modelStack.length > 1) {
                            console.warn(`[Sucrebot] Modelo "${tryModel}" no disponible (404). Intentando con fallback...`);
                            lastError = { status: 404, message: errMsg };
                            continue; // Intentar siguiente modelo en el stack
                        }
                        throw new Error(`El modelo "${tryModel}" no esta disponible. Cambielo en la configuracion ⚙️.`);
                    }
                    throw new Error(errMsg);
                }

                const data = await response.json();
                let reply = data.choices?.[0]?.message?.content || 'No se recibio una respuesta valida.';

                // Limpiar metadatos de seguridad que algunos modelos gratuitos incluyen
                reply = reply.replace(/User Safety:\s*safe\s*Response Safety:\s*safe/gi, '').trim();

                chatHistory.push({ role: 'user', content: userMessage });
                chatHistory.push({ role: 'assistant', content: reply });

                if (chatHistory.length > CONFIG.MAX_HISTORY_MESSAGES * 2) {
                    chatHistory = chatHistory.slice(-CONFIG.MAX_HISTORY_MESSAGES * 2);
                }

                addBotMessage(reply);
                return; // Exitoso, salir del loop

            } catch (err) {
                // Si es el ultimo modelo del stack, propagar el error
                if (tryModel === modelStack[modelStack.length - 1]) {
                    throw err;
                }
                // Si no, guardar error y continuar con el siguiente
                lastError = err;
                console.warn(`[Sucrebot] Fallo con ${tryModel}: ${err.message}. Probando fallback...`);
            }
        }

        // Si llegamos aqui, todos los modelos fallaron
        throw lastError || new Error('Todos los modelos fallaron');
    }

    // Manejador de errores global de sendToAI
    async function sendToAIWrapper(userMessage) {
        try {
            await sendToAI(userMessage);
        } catch (err) {
            console.error('[Sucrebot] Error completo:', err);
            console.error('[Sucrebot] Mensaje:', err.message);
            console.error('[Sucrebot] Modelo usado:', currentModel);

            notifyAdmin({
                model: currentModel,
                status: 'ERROR',
                message: err.message,
                stack: err.stack || 'No disponible'
            });

            addBotMessage(`🛠️ <strong>Disculpe las molestias.</strong><br><br>Sucrebot esta experimentando un pequeno problema tecnico de funcionamiento en este momento. Nuestro equipo de soporte ya ha sido notificado y estamos trabajando para restablecer el servicio a la brevedad.<br><br>Por favor, intente de nuevo mas tarde. Quedamos a su orden.`);
        } finally {
            hideTyping();
        }
    }

    // ========================================================================
    // 6. UI - RENDERIZAR MENSAJES
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
    // 7. SISTEMA DE LOGIN DE ADMINISTRADOR
    // ========================================================================
    function showAdminLoginForm() {
        dom.adminLoginForm.style.display = 'block';
        dom.btnShowAdminLogin.style.display = 'none';
        setTimeout(() => dom.adminUser.focus(), 100);
    }

    function hideAdminLoginForm() {
        dom.adminLoginForm.style.display = 'none';
        dom.btnShowAdminLogin.style.display = 'block';
        dom.adminUser.value = '';
        dom.adminPass.value = '';
        dom.adminLoginError.style.display = 'none';
    }

    async function attemptAdminLogin() {
        const user = dom.adminUser.value.trim();
        const pass = dom.adminPass.value.trim();

        if (!user || !pass) {
            dom.adminLoginError.textContent = 'Debe ingresar usuario y contrasena.';
            dom.adminLoginError.style.display = 'block';
            return;
        }

        const userHash = await sha256(user);
        const passHash = await sha256(pass);

        if (userHash === CONFIG.ADMIN_USER_HASH && passHash === CONFIG.ADMIN_PASS_HASH) {
            isAdminLoggedIn = true;
            sessionStorage.setItem('chatbot_admin', 'true');

            dom.apiKeySection.style.display = 'block';
            dom.apiKeySection.style.opacity = '1';
            dom.apiKeySection.style.pointerEvents = 'all';
            dom.apiKeyInput.readOnly = true;
            dom.webhookInput.readOnly = true;
            dom.adminBadge.style.display = 'inline-block';

            hideAdminLoginForm();

            dom.apiKeyInput.value = localStorage.getItem('openrouter_api_key') || CONFIG.HARDCODED_API_KEY;
            dom.webhookInput.value = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;

            dom.adminLoginError.style.display = 'none';

            addSystemMessage('🔓 Acceso de administrador concedido. Puede modificar la API Key.');
        } else {
            dom.adminLoginError.textContent = 'Usuario o contrasena incorrectos.';
            dom.adminLoginError.style.display = 'block';
            dom.adminPass.value = '';
        }
    }

    function logoutAdmin() {
        isAdminLoggedIn = false;
        sessionStorage.removeItem('chatbot_admin');

        dom.apiKeySection.style.opacity = '0.5';
        dom.apiKeySection.style.pointerEvents = 'none';
        dom.apiKeyInput.readOnly = true;
        dom.webhookInput.readOnly = true;
        dom.adminBadge.style.display = 'none';

        dom.btnShowAdminLogin.style.display = 'block';
        dom.btnShowAdminLogin.innerHTML = '<i class="fas fa-lock"></i> Ingresar como Administrador';

        addSystemMessage('🔒 Sesion de administrador cerrada.');
    }

    function checkAdminSession() {
        if (sessionStorage.getItem('chatbot_admin') === 'true') {
            isAdminLoggedIn = true;
            dom.apiKeySection.style.display = 'block';
            dom.apiKeySection.style.opacity = '1';
            dom.apiKeySection.style.pointerEvents = 'all';
            dom.apiKeyInput.readOnly = true;
            dom.webhookInput.readOnly = true;
            dom.adminBadge.style.display = 'inline-block';
            dom.btnShowAdminLogin.style.display = 'none';

            dom.apiKeyInput.value = localStorage.getItem('openrouter_api_key') || CONFIG.HARDCODED_API_KEY;
            dom.webhookInput.value = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;
        }
    }

    // ========================================================================
    // 8. UI - ABRIR/CERRAR/CONFIGURACION
    // ========================================================================
    function toggleChat() {
        isChatOpen = !isChatOpen;
        dom.chatWindow.classList.toggle('show', isChatOpen);
        dom.chatWindow.setAttribute('aria-hidden', !isChatOpen);
        dom.toggleBtn.setAttribute('aria-expanded', isChatOpen);

        if (isChatOpen) {
            dom.notification.style.display = 'none';
            setTimeout(() => dom.input.focus(), 300);
        }
    }

    function openSettings() {
        dom.settingsPanel.style.display = 'block';
        dom.settingsError.style.display = 'none';
        dom.modelSelect.value = currentModel;
        dom.apiKeyInput.value = localStorage.getItem('openrouter_api_key') || CONFIG.HARDCODED_API_KEY;
        dom.webhookInput.value = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;
    }

    function closeSettings() {
        dom.settingsPanel.style.display = 'none';
        if (!isAdminLoggedIn) {
            hideAdminLoginForm();
        }
    }

    function saveSettings() {
        if (!isAdminLoggedIn) {
            dom.settingsError.textContent = 'Debe iniciar sesion como administrador para guardar cambios.';
            dom.settingsError.style.display = 'block';
            return;
        }

        const model = dom.modelSelect.value;
        localStorage.setItem('openrouter_model', model);
        currentModel = model; // Actualizar inmediatamente en memoria

        dom.settingsError.style.display = 'none';
        closeSettings();
        addSystemMessage('✅ Modelo de IA actualizado a: ' + model + '. Quedamos a su orden.');
    }

    // ========================================================================
    // 9. EVENT LISTENERS
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

        dom.btnShowAdminLogin.addEventListener('click', showAdminLoginForm);
        dom.btnAdminLogin.addEventListener('click', attemptAdminLogin);
        dom.adminPass.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') attemptAdminLogin();
        });

        dom.btnShowKey.addEventListener('click', () => {
            if (dom.apiKeyInput.type === 'password') {
                dom.apiKeyInput.type = 'text';
                dom.btnShowKey.innerHTML = '<i class="fas fa-eye-slash"></i> Ocultar';
            } else {
                dom.apiKeyInput.type = 'password';
                dom.btnShowKey.innerHTML = '<i class="fas fa-eye"></i> Ver/Ocultar';
            }
        });

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
        if (!text || isTyping) return;

        dom.input.value = '';
        addUserMessage(text);
        sendToAIWrapper(text);
    }

    // ========================================================================
    // 10. INICIALIZACION
    // ========================================================================
    function init() {
        injectChatWidget();
        bindEvents();
        loadModelConfig();
        loadOrdinances();
        checkAdminSession();

        if (!localStorage.getItem('openrouter_api_key')) {
            dom.notification.style.display = 'block';
        }
    }

    init();
});
