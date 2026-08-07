/**
 * Sucrebot - Asistente Virtual del Concejo Municipal de Sucre
 * OpenRouter (modelos gratuitos) - Agosto 2026
 * Tono: Español venezolano formal
 * Seguridad: API Key protegida por usuario/contraseña de administrador
 */

document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // CONFIGURACIÓN
    // ========================================================================
    const CONFIG = {
        OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
        DEFAULT_MODEL: 'openai/gpt-oss-20b:free',
        MAX_CONTEXT_ORDINANCES: 3,
        MAX_HISTORY_MESSAGES: 6,
        MAX_CONTENT_LENGTH: 12000,
        MAX_TOTAL_CONTEXT: 25000,

        // === API KEY HARDCODEADA (funciona para todos los usuarios) ===
        // Cambiar aquí si se necesita una nueva key
        HARDCODED_API_KEY: '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',

        // === WEBHOOK HARDCODEADO (notificaciones de errores al admin) ===
        // Reemplazar con tu URL de Formspree u otro servicio
        HARDCODED_WEBHOOK: 'https://formspree.io/f/xnpanzob',

        // === CREDENCIALES DE ADMINISTRADOR ===
        // Cambiá estos valores por los que vos quieras.
        // El usuario y la contraseña se comparan con estos hashes SHA-256.
        // Para generar el hash de tu contraseña, andá a:
        // https://emn178.github.io/online-tools/sha256.html
        // Escribí tu contraseña, copiá el hash (64 caracteres) y pegalo acá.
        ADMIN_USER_HASH: '31c2dba39205cfa136524bdaf3982e0271a16cd57441d948ba0a10d44eaddefe', // hash de "admin"
        ADMIN_PASS_HASH: '5e7d91ecdda53344456707e0d5bcfca8951479965ae38478b55546731bd1ce51', // hash de "1234" <-- CAMBIÁ ESTO
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

    /**
     * Genera hash SHA-256 de un string.
     */
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Extrae posibles números de ordenanza de la consulta del usuario.
     */
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
                    <input type="text" id="chatInput" placeholder="Ej: N.º504-12-2025 o 'tributos'..." autocomplete="off" maxlength="500">
                    <button id="chatSendBtn" aria-label="Enviar mensaje">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>

            <!-- Panel de configuración -->
            <div id="chatSettingsPanel" class="chat-settings-panel" style="display:none">
                <div class="chat-settings-header">
                    <h4><i class="fas fa-cog"></i> Configuración</h4>
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
                                El campo de API Key está protegido. Solo el administrador puede modificarlo.
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
                                <label for="adminPass">Contraseña</label>
                                <input type="password" id="adminPass" placeholder="Contraseña" autocomplete="off">
                            </div>
                            <button id="btnAdminLogin" class="chat-settings-save" style="margin-top:8px;">
                                <i class="fas fa-sign-in-alt"></i> Acceder
                            </button>
                            <div id="adminLoginError" class="settings-error" style="display:none;margin-top:8px;"></div>
                        </div>
                    </div>

                    <!-- Sección de API Key (bloqueada hasta login) -->
                    <div id="apiKeySection" style="display:none;opacity:0.5;pointer-events:none;">
                        <div class="settings-group">
                            <label for="apiKeyInput" style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-key" style="color:#C4A561;"></i>
                                <span>API Key de OpenRouter</span>
                                <span id="adminBadge" style="display:none;background:#2e7d32;color:white;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:auto;">ADMIN</span>
                            </label>
                            <input type="password" id="apiKeyInput" placeholder="sk-or-v1-..." readonly>
                            <small>Obtené su key gratuita en <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a></small>
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
                                <option value="google/gemma-4-31b-it:free">Google Gemma 4 31B (Free) ⭐</option>
                                <option value="nvidia/nemotron-3-ultra-550b-a55b:free">NVIDIA Nemotron 3 Ultra (Free)</option>
                                <option value="nvidia/nemotron-3-super-120b-a12b:free">NVIDIA Nemotron 3 Super (Free)</option>
                                <option value="inclusionai/ling-3.0-flash:free">Ling 3.0 Flash (Free)</option>
                                <option value="openai/gpt-oss-20b:free">OpenAI GPT-OSS 20B (Free)</option>
                                <option value="nvidia/nemotron-3-nano-30b-a3b:free">NVIDIA Nemotron 3 Nano (Free)</option>
                                <option value="poolside/laguna-s-2.1:free">Poolside Laguna S 2.1 (Free)</option>
                                <option value="cohere/north-mini-code:free">Cohere North Mini Code (Free)</option>
                            </select>
                            <small>Solo el administrador puede cambiar el modelo. Los ciudadanos usarán el modelo predeterminado.</small>
                        </div>

                        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">

                        <!-- Webhook de notificación de errores (solo admin) -->
                        <div class="settings-group">
                            <label for="webhookInput" style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-bell" style="color:#e53935;"></i>
                                <span>Webhook de Notificaciones</span>
                            </label>
                            <input type="text" id="webhookInput" placeholder="https://formspree.io/f/XXXXXX" readonly>
                            <small>URL para recibir alertas cuando Sucrebot falle. Usá <a href="https://formspree.io" target="_blank" rel="noopener">Formspree</a> o cualquier endpoint POST.</small>
                        </div>
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
            apiKeyInput: document.getElementById('apiKeyInput'),
            modelSelect: document.getElementById('modelSelect'),
            webhookInput: document.getElementById('webhookInput'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            settingsError: document.getElementById('settingsError'),
            notification: document.getElementById('chatNotification'),
            // Admin login
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
        try {
            const response = await fetch('./modelo.json');
            if (!response.ok) throw new Error('No se pudo cargar modelo.json');
            const config = await response.json();
            if (config.modelo && config.modelo.startsWith('google/') || config.modelo.startsWith('nvidia/') || config.modelo.startsWith('openai/') || config.modelo.startsWith('inclusionai/') || config.modelo.startsWith('poolside/') || config.modelo.startsWith('cohere/')) {
                currentModel = config.modelo;
                console.log(`[Sucrebot] Modelo cargado desde modelo.json: ${currentModel}`);
            } else {
                console.warn('[Sucrebot] modelo.json no tiene un modelo válido, usando default.');
            }
        } catch (err) {
            console.warn('[Sucrebot] No se pudo cargar modelo.json, usando modelo predeterminado:', err.message);
            currentModel = CONFIG.DEFAULT_MODEL;
        }
    }

    async function loadOrdinances() {
        try {
            const response = await fetch('./ordenanzas.json');
            if (!response.ok) throw new Error('No se pudo cargar ordenanzas.json');
            ordinances = await response.json();

            const conContenido = ordinances.filter(o => o.contenido || o.resumen).length;
            console.log(`[Chatbot] Ordenanzas: ${ordinances.length} | Con contenido: ${conContenido}`);

            if (conContenido > 0) {
                addSystemMessage(`📚 Base cargada: ${ordinanzas.length} ordenanzas (${conContenido} con contenido de PDF).`);
            }
        } catch (err) {
            console.error('[Chatbot] Error:', err);
            addSystemMessage('⚠️ No se pudo cargar la base de ordenanzas.');
        }
    }

    // ========================================================================
    // 3. BUSCAR ORDENANZAS RELEVANTES
    // ========================================================================
    // Diccionario de sinónimos para materias y términos comunes
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
        'niño': ['proteccion de ninos', 'proteccion de ninas', 'adolescente', 'infancia', 'menor', 'escolar'],
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

    /**
     * Expande una consulta con sus sinónimos para búsqueda más flexible.
     */
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

        console.log('[Sucrebot] Buscando números:', extractedNumbers);
        console.log('[Sucrebot] Tokens expandidos:', queryTokens);

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

            // === BÚSQUEDA POR MATERIA (alta prioridad) ===
            // Coincidencia exacta o parcial en materia
            for (const token of queryTokens) {
                if (token.length < 3) continue;

                // Coincidencia exacta en materia
                if (ordMateria === token) {
                    score += 50;
                }
                // Materia contiene el token
                else if (ordMateria.includes(token)) {
                    score += 35;
                }
                // Token contiene la materia (ej: "proteccion a la mujer" contiene "mujer")
                else if (token.includes(ordMateria) && ordMateria.length > 4) {
                    score += 25;
                }
            }

            // === BÚSQUEDA POR NOMBRE ===
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

            // === BÚSQUEDA POR CONTENIDO/RESUMEN ===
            for (const token of queryTokens) {
                if (token.length < 4) continue;

                if (ordContenido.includes(token)) {
                    score += 15;
                }
            }

            // === BÚSQUEDA POR ESTADO ===
            for (const token of queryTokens) {
                if (token.length < 3) continue;
                if (ordEstado.includes(token)) {
                    score += 10;
                }
            }

            // === BONIFICACIONES ===
            // Si la query completa aparece en el nombre
            if (ordNombre.includes(normalizedQuery)) score += 20;
            // Si la query completa aparece en la materia
            if (ordMateria.includes(normalizedQuery)) score += 15;
            // Si tiene contenido/resumen cargado (más información disponible)
            if (ord.contenido || ord.resumen) score += 5;

            return { ord, score };
        });

        scored.sort((a, b) => b.score - a.score);

        // Siempre devolver los top resultados, aunque el score sea bajo
        // Esto permite que la IA decida si son relevantes o no
        const topResults = scored.slice(0, 8);
        console.log('[Sucrebot] Top resultados:', topResults.map(s => ({id: s.ord.id, materia: s.ord.materia, score: s.score})));

        // Devolver hasta MAX_CONTEXT_ORDINANCES, filtrando solo los que tienen score > 0
        // Si ninguno tiene score > 0, devolver los 3 primeros de todos modos
        const conScore = scored.filter(s => s.score > 0);
        if (conScore.length > 0) {
            return conScore.slice(0, CONFIG.MAX_CONTEXT_ORDINANCES).map(s => s.ord);
        }
        // Fallback: devolver los primeros 3 por si acaso
        return scored.slice(0, 3).map(s => s.ord);
    }

    // ========================================================================
    // 4. CONSTRUIR SYSTEM PROMPT
    // ========================================================================
    function buildSystemPrompt(relevantOrdinances, userQuery) {
        const extractedNumbers = extractOrdinanceNumber(userQuery);
        const isNumberSearch = extractedNumbers.length > 0;

        const tienenContenido = relevantOrdinances.some(o => o.contenido || o.resumen);

        let prompt = `Eres Sucrebot, el asistente virtual del Concejo Municipal de Sucre, Estado Miranda, Venezuela. Atiendes a los ciudadanos con cordialidad, respeto y profesionalismo propio de un ente gubernamental venezolano.

REGLAS DE COMUNICACIÓN (MUY IMPORTANTE):
1. Usá SIEMPRE español venezolano formal. Ejemplos:
   - "Buenos días/tardes", "Saludos", "Con gusto", "Quedamos a su orden"
   - "Puede consultar", "Le informamos que", "A continuación"
   - NO usés "che", "boludo", "dale", "mira vos", ni expresiones argentinas
   - NO usés "tenés", "hacé", "decí". Usá "tiene", "haga", "diga" (formal)
   - Dirigite al usuario como "usted", nunca "vos"
2. Sé claro, conciso y servicial. Un funcionario público venezolano es cordial pero directo.
3. Respondé SIEMPRE en español.
4. No inventes datos específicos de ordenanzas que no estén en el contexto. Si tenés ordenanzas relacionadas en el contexto, usalas para responder. Si la consulta es muy general o no coincide exactamente, brindá una respuesta útil orientando al ciudadano y ofréciendo alternativas de búsqueda.
5. Si la ordenanza tiene link a Drive, NO lo comparta directamente; indique que está disponible en la plataforma.

`;

        if (isNumberSearch && !tienenContenido) {
            prompt += `INSTRUCCIÓN ESPECIAL: El ciudadano consultó por el número de ordenanza ${extractedNumbers.join(', ')}. 

IMPORTANTE: Las ordenanzas listadas abajo tienen metadatos disponibles (nombre, materia, año, estado). Debés usar ESTA INFORMACIÓN para responder al ciudadano. 

Podés decir:
- Número y nombre de la ordenanza
- Materia a la que pertenece
- Año de emisión
- Estado jurídico (Vigente, En revisión, Derogada, etc.)
- Una breve síntesis general de QUÉ TRATA la ordenanza, basada en su título y materia
- Si tiene link a Drive, indicá que el documento completo está disponible en la plataforma

NO inventes artículos, disposiciones clave, ni contenido específico que no esté en los metadatos.

`;
        } else if (isNumberSearch && tienenContenido) {
            prompt += `INSTRUCCIÓN ESPECIAL: El ciudadano consultó por el número de ordenanza ${extractedNumbers.join(', ')}. 
Dale un resumen estructurado con:
- Número y nombre de la ordenanza
- Materia y año
- Estado jurídico
- Disposiciones clave / artículos importantes (basados en el contenido del PDF)
- Objetivo general de la normativa

`;
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
                    contenido = `(Metadatos disponibles: nombre, materia, año, estado. Usá esta información para responder al ciudadano.)\n`;
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
            prompt += `No se encontraron ordenanzas que coincidan EXACTAMENTE con los términos de búsqueda, pero el ciudadano hizo una consulta informal. Brindá una respuesta útil basada en tu conocimiento general del Concejo Municipal de Sucre. Podés:
- Indicar que no se encontró una ordenanza específica con ese nombre exacto
- Sugerir al ciudadano que pruebe con términos más generales (ej: "aseo" en vez de "aseo callejero")
- Ofrecer orientación sobre dónde puede obtener más información
- Mencionar que puede consultar por número de ordenanza si lo conoce
Sé cordial, servicial y ofrézcase a ayudar con otra consulta.

`;
        }

        prompt += `Responda la consulta del ciudadano:`;
        return prompt;
    }

    // ========================================================================
    // 5. ENVIAR MENSAJE A OPENROUTER
    // ========================================================================
    /**
     * Notifica al administrador vía webhook cuando hay un error crítico con la IA.
     */
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
            console.log('[Sucrebot] Notificación de error enviada al admin.');
        } catch (e) {
            console.warn('[Sucrebot] No se pudo enviar notificación:', e);
        }
    }


    /**
     * Realiza fetch con reintentos automáticos en caso de error 429 (rate limit).
     */
    async function fetchWithRetry(url, options, maxRetries = 2) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);

                // Si es 429 (Too Many Requests), esperar y reintentar
                if (response.status === 429 && attempt < maxRetries) {
                    const delayMs = 3000 * (attempt + 1); // 3s, 6s
                    console.log(`[Sucrebot] Límite alcanzado (429). Reintentando en ${delayMs / 1000}s... (intento ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }

                return response;
            } catch (networkErr) {
                // Error de red (fetch falló), reintentar si quedan intentos
                if (attempt < maxRetries) {
                    const delayMs = 2000 * (attempt + 1); // 2s, 4s
                    console.log(`[Sucrebot] Error de red. Reintentando en ${delayMs / 1000}s... (intento ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
                throw networkErr;
            }
        }
        // No debería llegar aquí, pero por seguridad
        throw new Error('Se agotaron los reintentos');
    }

    async function sendToAI(userMessage) {
        const savedKey = localStorage.getItem('openrouter_api_key');
        const key = (savedKey && savedKey.startsWith('sk-or-v1-')) ? savedKey : CONFIG.HARDCODED_API_KEY;
        const model = currentModel;

        console.log('[Sucrebot] Enviando petición:', { model: model, keyPrefix: key.substring(0, 15) + '...' });

        const relevant = findRelevantOrdinances(userMessage);
        const systemPrompt = buildSystemPrompt(relevant, userMessage);

        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory.slice(-CONFIG.MAX_HISTORY_MESSAGES),
            { role: 'user', content: userMessage }
        ];

        showTyping();

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
                    model: model,
                    messages: apiMessages,
                    temperature: 0.2,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.error?.message || `Error HTTP ${response.status}`;

                if (response.status === 401) {
                    throw new Error('API Key inválida. Por favor contacte al administrador.');
                }
                if (response.status === 429) {
                    throw new Error('Límite de solicitudes alcanzado. Se agotaron los reintentos automáticos.');
                }
                if (response.status === 402) {
                    throw new Error(`El modelo "${model}" ya no está disponible de forma gratuita. Seleccione otro en la configuración ⚙️.`);
                }
                if (response.status === 404 || errMsg.includes('not a valid model')) {
                    throw new Error(`El modelo "${model}" no está disponible. Cámbielo en la configuración ⚙️.`);
                }
                throw new Error(errMsg);
            }

            const data = await response.json();
            const reply = data.choices?.[0]?.message?.content || 'No se recibió una respuesta válida.';

            chatHistory.push({ role: 'user', content: userMessage });
            chatHistory.push({ role: 'assistant', content: reply });

            if (chatHistory.length > CONFIG.MAX_HISTORY_MESSAGES * 2) {
                chatHistory = chatHistory.slice(-CONFIG.MAX_HISTORY_MESSAGES * 2);
            }

            addBotMessage(reply);

        } catch (err) {
            console.error('[Sucrebot] Error completo:', err);
            console.error('[Sucrebot] Mensaje:', err.message);
            console.error('[Sucrebot] Modelo usado:', model);

            // Notificar al admin con todos los detalles técnicos
            notifyAdmin({
                model: model,
                status: 'ERROR',
                message: err.message,
                stack: err.stack || 'No disponible'
            });

            // Mensaje simple y amigable para el ciudadano (sin razones técnicas)
            addBotMessage(`🛠️ <strong>Disculpe las molestias.</strong><br><br>Sucrebot está experimentando un pequeño problema técnico de funcionamiento en este momento. Nuestro equipo de soporte ya ha sido notificado y estamos trabajando para restablecer el servicio a la brevedad.<br><br>Por favor, intente de nuevo más tarde. Quedamos a su orden.`);
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
            dom.adminLoginError.textContent = 'Debe ingresar usuario y contraseña.';
            dom.adminLoginError.style.display = 'block';
            return;
        }

        // Hashear y comparar
        const userHash = await sha256(user);
        const passHash = await sha256(pass);

        if (userHash === CONFIG.ADMIN_USER_HASH && passHash === CONFIG.ADMIN_PASS_HASH) {
            // Login exitoso
            isAdminLoggedIn = true;
            sessionStorage.setItem('chatbot_admin', 'true');

            // Desbloquear sección de API Key
            dom.apiKeySection.style.display = 'block';
            dom.apiKeySection.style.opacity = '1';
            dom.apiKeySection.style.pointerEvents = 'all';
            dom.apiKeyInput.readOnly = true;
            dom.webhookInput.readOnly = true;
            dom.adminBadge.style.display = 'inline-block';

            // Ocultar formulario de login
            hideAdminLoginForm();

            // Cargar valores (hardcodeados como fallback si localStorage está vacío)
            dom.apiKeyInput.value = localStorage.getItem('openrouter_api_key') || CONFIG.HARDCODED_API_KEY;
            dom.webhookInput.value = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;

            dom.adminLoginError.style.display = 'none';

            // Mensaje de éxito
            addSystemMessage('🔓 Acceso de administrador concedido. Puede modificar la API Key.');
        } else {
            dom.adminLoginError.textContent = 'Usuario o contraseña incorrectos.';
            dom.adminLoginError.style.display = 'block';
            dom.adminPass.value = '';
        }
    }

    function logoutAdmin() {
        isAdminLoggedIn = false;
        sessionStorage.removeItem('chatbot_admin');

        // Bloquear sección de API Key
        dom.apiKeySection.style.opacity = '0.5';
        dom.apiKeySection.style.pointerEvents = 'none';
        dom.apiKeyInput.readOnly = true;
        dom.webhookInput.readOnly = true;
        dom.adminBadge.style.display = 'none';

        // Mostrar botón de login
        dom.btnShowAdminLogin.style.display = 'block';
        dom.btnShowAdminLogin.innerHTML = '<i class="fas fa-lock"></i> Ingresar como Administrador';

        addSystemMessage('🔒 Sesión de administrador cerrada.');
    }

    function checkAdminSession() {
        // Verificar si hay sesión activa en esta pestaña
        if (sessionStorage.getItem('chatbot_admin') === 'true') {
            isAdminLoggedIn = true;
            dom.apiKeySection.style.display = 'block';
            dom.apiKeySection.style.opacity = '1';
            dom.apiKeySection.style.pointerEvents = 'all';
            dom.apiKeyInput.readOnly = true;
            dom.webhookInput.readOnly = true;
            dom.adminBadge.style.display = 'inline-block';
            dom.btnShowAdminLogin.style.display = 'none';

            // Cargar valores hardcodeados
            dom.apiKeyInput.value = localStorage.getItem('openrouter_api_key') || CONFIG.HARDCODED_API_KEY;
            dom.webhookInput.value = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;
        }
    }

    // ========================================================================
    // 8. UI - ABRIR/CERRAR/CONFIGURACIÓN
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

        // Mostrar modelo actual
        dom.modelSelect.value = currentModel;

        // Cargar API Key y Webhook (hardcodeados como fallback si localStorage está vacío)
        dom.apiKeyInput.value = localStorage.getItem('openrouter_api_key') || CONFIG.HARDCODED_API_KEY;
        dom.webhookInput.value = localStorage.getItem('sucrebot_webhook') || CONFIG.HARDCODED_WEBHOOK;
    }

    function closeSettings() {
        dom.settingsPanel.style.display = 'none';
        // Limpiar formulario de login si quedó abierto
        if (!isAdminLoggedIn) {
            hideAdminLoginForm();
        }
    }

    function saveSettings() {
        // La configuración solo se guarda si es admin
        if (!isAdminLoggedIn) {
            dom.settingsError.textContent = 'Debe iniciar sesión como administrador para guardar cambios.';
            dom.settingsError.style.display = 'block';
            return;
        }

        const model = dom.modelSelect.value;
        localStorage.setItem('openrouter_model', model);

        dom.settingsError.style.display = 'none';
        closeSettings();
        addSystemMessage('✅ Modelo de IA actualizado. Quedamos a su orden.');
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

        // Admin login events
        dom.btnShowAdminLogin.addEventListener('click', showAdminLoginForm);
        dom.btnAdminLogin.addEventListener('click', attemptAdminLogin);
        dom.adminPass.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') attemptAdminLogin();
        });

        // Mostrar/ocultar API Key
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
        sendToAI(text);
    }

    // ========================================================================
    // 10. INICIALIZACIÓN
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
