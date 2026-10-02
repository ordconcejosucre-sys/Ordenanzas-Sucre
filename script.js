/**
 * Portal de Consulta de Ordenanzas Municipales - Concejo Municipal de Sucre
 * Desarrollado en JavaScript Vanilla ES6+
 * v2.0 - Corrección de bugs, vista previa Drive, compartir, impresión,
 *        reveal-on-scroll, normalización de materias compartida con el chatbot.
 */

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // 1. ESTADO GLOBAL DE LA APLICACIÓN
    // ==========================================================================
    const AppState = {
        ordinances: [],
        filteredOrdinances: [],
        categories: [],
        categoryCounts: {},
        selectedCategory: 'TODAS',
        selectedYear: 'all',
        selectedStatus: 'all',
        searchTerm: '',
        searchTokens: [],
        isExpandedCats: false,
        cardsPage: 1,
        cardsPerPage: 12,
        savedFocus: null
    };

    // Placeholders rotativos para el buscador
    const SEARCH_PLACEHOLDERS = [
        'Buscar por N°, nombre, materia, año o estado...',
        'Ej: N.° 504-12-2025',
        'Ej: tributos',
        'Ej: convivencia ciudadana',
        'Ej: 2025'
    ];
    let placeholderIndex = 0;

    // Mapeo dinámico de íconos Font Awesome por materia
    const CategoryIcons = {
        "REGLAMENTOS": "fa-scroll",
        "CONVIVENCIA CIUDADANA": "fa-hands-helping",
        "ABASTECIMIENTO Y MERCADEO": "fa-store",
        "PRESUPUESTO": "fa-calculator",
        "ASEO": "fa-recycle",
        "URBANISMO": "fa-city",
        "CONTRALORÍA": "fa-balance-scale",
        "TRIBUTOS": "fa-file-invoice-dollar",
        "ECOLOGÍA": "fa-leaf",
        "CONDECORACIÓN": "fa-award",
        "SALUD": "fa-user-md",
        "BIENES": "fa-landmark",
        "PROTECCIÓN A LA MUJER": "fa-female",
        "PODER POPULAR": "fa-users",
        "ÁREAS VERDES": "fa-tree",
        "PROTECCIÓN SOCIAL": "fa-heart",
        "EDUCACIÓN": "fa-graduation-cap",
        "HACIENDA PÚBLICA MUNICIPAL": "fa-coins",
        "PROTECCIÓN DE NIÑOS, NIÑAS Y ADOLESCENTES": "fa-child",
        "VIALIDAD Y TRÁNSITO": "fa-road",
        "DEPORTES": "fa-futbol",
        "DEFAULT": "fa-file-alt"
    };

    // ==========================================================================
    // 2. REFERENCIAS AL DOM
    // ==========================================================================
    const DOM = {
        searchInput: document.getElementById('searchInput'),
        btnSearchSubmit: document.getElementById('btnSearchSubmit'),
        materiaFilter: document.getElementById('materiaFilter'),
        yearFilter: document.getElementById('yearFilter'),
        statusFilter: document.getElementById('statusFilter'),
        btnResetFilters: document.getElementById('btnResetFilters'),
        cardsContainer: document.getElementById('cardsContainer'),
        categoriesContainer: document.getElementById('categoriesContainer'),
        btnCards: document.getElementById('btnCards'),
        btnCats: document.getElementById('btnCats'),
        resultsCount: document.getElementById('resultsCount'),
        paginationInfo: document.getElementById('paginationInfo'),
        // KPIs
        statTotal: document.getElementById('statTotal'),
        statMaterias: document.getElementById('statMaterias'),
        statAnioInicio: document.getElementById('statAnioInicio'),
        statAnioFin: document.getElementById('statAnioFin'),

        // Modal
        ordinanceModal: document.getElementById('ordinanceModal'),
        btnModalClose: document.getElementById('btnModalClose'),
        modalTitle: document.getElementById('modalTitle'),
        modalId: document.getElementById('modalId'),
        modalDate: document.getElementById('modalDate'),
        modalCategory: document.getElementById('modalCategory'),
        modalStatus: document.getElementById('modalStatus'),
        modalLink: document.getElementById('modalLink'),
        modalPreview: document.getElementById('modalPreview'),
        modalIframe: document.getElementById('modalIframe'),
        btnWhatsApp: document.getElementById('btnWhatsApp'),
        btnNativeShare: document.getElementById('btnNativeShare'),
        btnCopyLink: document.getElementById('btnCopyLink'),
        btnPrint: document.getElementById('btnPrint'),

        // Menú desplegable
        menuToggleBtn: document.getElementById('menuToggleBtn'),
        dropdownMenu: document.getElementById('dropdownMenu'),
        btnFullInventory: document.getElementById('btnFullInventory'),

        // Nuevos elementos
        activeFilters: document.getElementById('activeFilters'),
        scrollProgress: document.getElementById('scrollProgress'),
        backToTop: document.getElementById('backToTop'),
        printArea: document.getElementById('printArea')
    };

    // ==========================================================================
    // 3. FUNCIONES DE UTILIDAD (NORMALIZACIÓN Y BÚSQUEDA)
    // ==========================================================================

    /**
     * Remueve acentos y diacríticos de un string para búsquedas flexibles
     */
    const normalizeText = (text) => {
        if (!text) return '';
        return text
            .toString()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    };

    /**
     * Normaliza los nombres de las categorías/materias a formato Título y
     * unifica singulares/plurales, conectores y redacciones duplicadas.
     * COMPARTIDA con el chatbot vía window.CMS.normalizeCategory.
     */
    const normalizeCategory = (text) => {
        if (!text) return 'Sin Categoría';

        let formatted = text
            .toString()
            .trim()
            .toLowerCase()
            .replace(/(^\w|\s\w)/g, (letra) => letra.toUpperCase());

        // Conectores en minúscula: "Abastecimiento Y Mercadeo" -> "Abastecimiento y Mercadeo"
        formatted = formatted.replace(/\s(Y|De|Del|La|Las|El|Los|En|A|Al)\s/g, (m) => m.toLowerCase());

        // Unificación de equivalencias. Las claves se comparan sin acentos
        // para que "Ecologia" y "Ecología" converjan en la misma entrada.
        const equivalencias = {
            "Reglamento": "Reglamentos",
            "Tributo": "Tributos",
            "Bien": "Bienes",
            "Protección De La Mujer": "Protección a la Mujer",
            "Proteccion A La Mujer": "Protección a la Mujer",
            "Convivencia Al Ciudadano": "Convivencia Ciudadana",
            "Convivencia Social": "Convivencia Ciudadana",
            "Condecoracion": "Condecoración",
            "Ecologia": "Ecología",
            "Viabilidad": "Vialidad y Tránsito",
            "Vialidad y Transito": "Vialidad y Tránsito",
            "Deporte y Recreacion": "Deportes",
            "Deportes y Recreacion": "Deportes"
        };

        const lookup = {};
        Object.entries(equivalencias).forEach(([k, v]) => {
            lookup[normalizeText(k)] = v;
        });

        return lookup[normalizeText(formatted)] || formatted;
    };

    // Exportar utilidades para que chatbot.js use EXACTAMENTE la misma
    // normalización de materias (antes veían categorías distintas).
    window.CMS = { normalizeText, normalizeCategory };

    /**
     * Escape de HTML para inyección segura en el DOM
     */
    const escapeHTML = (str) => {
        const div = document.createElement('div');
        div.textContent = (str === undefined || str === null) ? '' : str.toString();
        return div.innerHTML;
    };

    /**
     * Resalta con <mark> los términos de búsqueda en un texto (ya escapado)
     */
    const highlightTokens = (text, tokens) => {
        let out = escapeHTML(text);
        tokens.forEach(token => {
            if (!token || token.length < 2) return;
            const safe = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            out = out.replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
        });
        return out;
    };

    /**
     * Función debounce para optimizar búsquedas frecuentes
     */
    const debounce = (fn, delay = 200) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), delay);
        };
    };

    /**
     * Base del enlace compartible. Funciona también en file://
     * (window.location.origin devuelve "null" en ese caso).
     */
    const getShareBase = () => {
        if (window.location.origin && window.location.origin !== 'null') {
            return window.location.origin + window.location.pathname;
        }
        return window.location.href.split('?')[0];
    };

    /**
     * Extrae el file ID de un enlace de Google Drive
     */
    const extractDriveId = (url) => {
        if (!url) return null;
        const match = url.match(/\/d\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/);
        return match ? match[1] : null;
    };

    /**
     * Guardar estado de filtros en localStorage
     */
    const saveFilters = () => {
        try {
            localStorage.setItem('ordenanzas_filters', JSON.stringify({
                category: AppState.selectedCategory,
                year: AppState.selectedYear,
                status: AppState.selectedStatus,
                search: AppState.searchTerm
            }));
        } catch (e) {
            console.warn('No se pudo guardar filtros en localStorage');
        }
    };

    /**
     * Recuperar estado de filtros de localStorage
     */
    const loadFilters = () => {
        try {
            const saved = localStorage.getItem('ordenanzas_filters');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('No se pudo cargar filtros de localStorage');
        }
        return null;
    };

    // ==========================================================================
    // 4. CARGA ASÍNCRONA DE DATOS (FETCH)
    // ==========================================================================
    async function loadData() {
        // Mostrar skeleton loading
        DOM.cardsContainer.innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');

        try {
            const response = await fetch('./ordenanzas.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Error HTTP status: ${response.status}`);
            }

            const data = await response.json();

            // Normalización y unificación de materias en cada objeto
            const normalizedData = data.map(item => ({
                ...item,
                materia: normalizeCategory(item.materia)
            }));

            // Ordenamiento por fecha descendente
            AppState.ordinances = normalizedData.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            AppState.filteredOrdinances = [...AppState.ordinances];

            initFiltersAndCategories();
            calculateStats();

            // Cargar filtros guardados
            const saved = loadFilters();
            if (saved) {
                AppState.selectedCategory = saved.category || 'TODAS';
                AppState.selectedYear = saved.year || 'all';
                AppState.selectedStatus = saved.status || 'all';
                AppState.searchTerm = saved.search || '';
                AppState.searchTokens = normalizeText(AppState.searchTerm).split(' ').filter(Boolean);

                // Aplicar a los controles del DOM
                DOM.searchInput.value = AppState.searchTerm;
                DOM.materiaFilter.value = AppState.selectedCategory === 'TODAS' ? 'all' : AppState.selectedCategory;
                DOM.yearFilter.value = AppState.selectedYear;
                DOM.statusFilter.value = AppState.selectedStatus;
            }

            applyFilters();
            renderCategories();
            initRevealAnimations();

            // Verificar deep link después de cargar todo
            checkDeepLink();

        } catch (error) {
            console.error('Error cargando ordenanzas.json:', error);
            DOM.cardsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: #d32f2f;"></i>
                    <p>No se pudieron cargar las ordenanzas. Asegúrese de que <strong>ordenanzas.json</strong> exista en la raíz.</p>
                </div>`;
        }
    }

    // ==========================================================================
    // 5. INICIALIZACIÓN DE FILTROS Y MÉTRICAS
    // ==========================================================================
    function initFiltersAndCategories() {
        const materiasSet = new Set();
        const yearsSet = new Set();
        const counts = {};

        AppState.ordinances.forEach(item => {
            if (item.materia) {
                materiasSet.add(item.materia);
                counts[item.materia] = (counts[item.materia] || 0) + 1;
            }
            if (item.anio) yearsSet.add(item.anio);
        });

        AppState.categories = Array.from(materiasSet).sort();
        AppState.categoryCounts = counts;
        const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

        // Poblar Select de Materia
        DOM.materiaFilter.innerHTML = `<option value="all">Todas las materias</option>`;
        AppState.categories.forEach(materia => {
            const option = document.createElement('option');
            option.value = materia;
            option.textContent = `${materia} (${counts[materia]})`;
            DOM.materiaFilter.appendChild(option);
        });

        // Poblar Select de Año
        DOM.yearFilter.innerHTML = `<option value="all">Año: Todos</option>`;
        sortedYears.forEach(year => {
            const option = document.createElement('option');
            option.value = year.toString();
            option.textContent = year.toString();
            DOM.yearFilter.appendChild(option);
        });

        // Inicializar custom dropdowns
        initCustomDropdowns();
    }

    function initCustomDropdowns() {
        // Eliminar dropdowns previos si existen
        document.querySelectorAll('.custom-dropdown').forEach(el => el.remove());

        const selects = document.querySelectorAll('.custom-select');
        selects.forEach(select => {
            const group = select.closest('.filter-group');
            if (!group) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'custom-dropdown';

            // Ícono del trigger según tipo
            let triggerIcon = 'fa-filter';
            if (select.id === 'yearFilter') triggerIcon = 'fa-calendar';
            if (select.id === 'statusFilter') triggerIcon = 'fa-info-circle';

            const trigger = document.createElement('div');
            trigger.className = 'custom-dropdown-trigger';
            trigger.setAttribute('tabindex', '0');
            trigger.setAttribute('role', 'button');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.innerHTML = `
                <span class="trigger-icon"><i class="fas ${triggerIcon}"></i></span>
                <span class="trigger-text">${select.options[select.selectedIndex].text}</span>
                <span class="trigger-arrow"><i class="fas fa-chevron-down"></i></span>
            `;

            const menu = document.createElement('div');
            menu.className = 'custom-dropdown-menu';
            menu.setAttribute('role', 'listbox');

            Array.from(select.options).forEach((opt, idx) => {
                const option = document.createElement('div');
                option.className = 'custom-dropdown-option';
                option.setAttribute('role', 'option');
                option.dataset.value = opt.value;
                if (idx === select.selectedIndex) option.classList.add('selected');

                // Ícono según tipo
                let optionIcon = '';
                if (select.id === 'materiaFilter') {
                    const matName = opt.text.split(' (')[0].trim();
                    const iconClass = CategoryIcons[matName.toUpperCase()] || CategoryIcons.DEFAULT;
                    optionIcon = `<i class="fas ${iconClass} option-icon"></i>`;
                } else if (select.id === 'yearFilter') {
                    optionIcon = `<i class="fas fa-calendar-alt option-icon"></i>`;
                } else if (select.id === 'statusFilter') {
                    const statusIcons = {
                        'all': 'fa-border-all',
                        'Vigente': 'fa-check-circle',
                        'En revisión': 'fa-clock',
                        'Derogada': 'fa-times-circle',
                        'SE DESCONOCE': 'fa-question-circle'
                    };
                    const sIcon = statusIcons[opt.value] || 'fa-circle';
                    optionIcon = `<i class="fas ${sIcon} option-icon"></i>`;
                }

                option.innerHTML = `${optionIcon}<span class="option-text">${opt.text}</span>`;

                option.addEventListener('click', () => {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change'));
                    updateCustomDropdown(wrapper, select);
                    wrapper.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                });

                menu.appendChild(option);
            });

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = wrapper.classList.contains('open');
                document.querySelectorAll('.custom-dropdown.open').forEach(d => {
                    d.classList.remove('open');
                    d.querySelector('.custom-dropdown-trigger').setAttribute('aria-expanded', 'false');
                });
                if (!isOpen) {
                    wrapper.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                }
            });

            trigger.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    trigger.click();
                } else if (e.key === 'Escape') {
                    wrapper.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                }
            });

            wrapper.appendChild(trigger);
            wrapper.appendChild(menu);
            group.appendChild(wrapper);

            // Ocultar select nativo visualmente
            select.classList.add('sr-only');

            // Sincronizar cuando el select nativo cambie por código
            select.addEventListener('change', () => {
                updateCustomDropdown(wrapper, select);
            });
        });

        // Cerrar al hacer click fuera
        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-dropdown.open').forEach(d => {
                d.classList.remove('open');
                d.querySelector('.custom-dropdown-trigger').setAttribute('aria-expanded', 'false');
            });
        });
    }

    function updateCustomDropdown(wrapper, select) {
        const triggerText = wrapper.querySelector('.trigger-text');
        if (triggerText) triggerText.textContent = select.options[select.selectedIndex].text;

        wrapper.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === select.value);
        });
    }

    function animateValue(element, start, end, duration) {
        if (end === '-' || isNaN(end)) {
            element.textContent = end;
            return;
        }
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            element.textContent = Math.floor(progress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    function calculateStats() {
        const total = AppState.ordinances.length;
        const materiasCount = AppState.categories.length;

        let minYear = '-';
        let maxYear = '-';

        if (total > 0) {
            const years = AppState.ordinances.map(o => Number(o.anio)).filter(y => !isNaN(y));
            if (years.length > 0) {
                minYear = Math.min(...years);
                maxYear = Math.max(...years);
            }
        }

        animateValue(DOM.statTotal, 0, total, 1200);
        animateValue(DOM.statMaterias, 0, materiasCount, 1000);
        animateValue(DOM.statAnioInicio, 0, minYear, 1500);
        animateValue(DOM.statAnioFin, 0, maxYear, 1500);
    }

    // ==========================================================================
    // 6. LÓGICA DE FILTRADO Y BÚSQUEDA INTELIGENTE
    // ==========================================================================
    function renderActiveFilters() {
        if (!DOM.activeFilters) return;
        DOM.activeFilters.innerHTML = '';
        const chips = [];

        if (AppState.selectedCategory !== 'TODAS') {
            chips.push({ type: 'category', label: AppState.selectedCategory, value: AppState.selectedCategory });
        }
        if (AppState.selectedYear !== 'all') {
            chips.push({ type: 'year', label: `Año: ${AppState.selectedYear}`, value: AppState.selectedYear });
        }
        if (AppState.selectedStatus !== 'all') {
            chips.push({ type: 'status', label: `Estado: ${AppState.selectedStatus}`, value: AppState.selectedStatus });
        }
        if (AppState.searchTerm.trim()) {
            chips.push({ type: 'search', label: `Buscar: "${AppState.searchTerm}"`, value: AppState.searchTerm });
        }

        chips.forEach(chip => {
            const el = document.createElement('div');
            el.className = 'filter-chip';
            el.innerHTML = `<span>${escapeHTML(chip.label)}</span><span class="chip-remove">&times;</span>`;
            el.addEventListener('click', () => removeFilter(chip.type));
            DOM.activeFilters.appendChild(el);
        });
    }

    function removeFilter(type) {
        if (type === 'category') {
            AppState.selectedCategory = 'TODAS';
            DOM.materiaFilter.value = 'all';
            renderCategories();
        } else if (type === 'year') {
            AppState.selectedYear = 'all';
            DOM.yearFilter.value = 'all';
        } else if (type === 'status') {
            AppState.selectedStatus = 'all';
            DOM.statusFilter.value = 'all';
        } else if (type === 'search') {
            AppState.searchTerm = '';
            AppState.searchTokens = [];
            DOM.searchInput.value = '';
        }
        applyFilters();
    }

    function applyFilters() {
        const query = normalizeText(AppState.searchTerm);
        const searchTokens = query.split(' ').filter(Boolean);
        AppState.searchTokens = searchTokens;

        AppState.filteredOrdinances = AppState.ordinances.filter(item => {
            // Filtro por Categoría / Materia
            if (AppState.selectedCategory !== 'TODAS' && item.materia !== AppState.selectedCategory) {
                return false;
            }

            // Filtro por Select de Año
            if (AppState.selectedYear !== 'all' && item.anio?.toString() !== AppState.selectedYear) {
                return false;
            }

            // Filtro por Estado
            if (AppState.selectedStatus !== 'all' && item.estado !== AppState.selectedStatus) {
                return false;
            }

            // Búsqueda inteligente multicriterio (Tokenized Search)
            if (searchTokens.length > 0) {
                const searchableText = normalizeText(`
                    ${item.id}
                    ${item.numero}
                    ${item.nombre}
                    ${item.materia}
                    ${item.anio}
                    ${item.fechaImpresa}
                    ${item.estado}
                `);

                const matches = searchTokens.every(token => searchableText.includes(token));
                if (!matches) return false;
            }

            return true;
        });

        // Resetear paginación al filtrar
        AppState.cardsPage = 1;
        renderCards();
        renderActiveFilters();
        saveFilters();

        // Sacudida del buscador SOLO cuando no hay resultados (antes era en cada tipeo)
        const bar = document.querySelector('.search-bar');
        if (bar) {
            const noResults = AppState.filteredOrdinances.length === 0 && AppState.searchTerm.trim().length > 1;
            bar.classList.toggle('no-results', noResults);
        }
    }

    // ==========================================================================
    // 7. RENDERIZADO DE UI
    // ==========================================================================
    function renderCards() {
        DOM.cardsContainer.innerHTML = '';
        const list = AppState.filteredOrdinances;

        DOM.resultsCount.textContent = `Mostrando ${list.length} resultados`;

        if (list.length === 0) {
            DOM.cardsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No se encontraron ordenanzas que coincidan con la búsqueda.</p>
                    <button class="btn-reset-filters" style="margin-top:14px;" onclick="document.getElementById('btnResetFilters').click()">
                        <i class="fas fa-undo"></i> Limpiar filtros
                    </button>
                </div>`;
            DOM.btnCards.style.display = 'none';
            DOM.paginationInfo.textContent = '';
            return;
        }

        // Paginación: mostrar hasta cardsPage * cardsPerPage
        const endIndex = AppState.cardsPage * AppState.cardsPerPage;
        const visibleItems = list.slice(0, endIndex);
        const hasMore = endIndex < list.length;

        const fragment = document.createDocumentFragment();

        visibleItems.forEach((item, idx) => {
            const card = document.createElement('article');
            card.className = 'card';
            card.style.animationDelay = `${idx * 0.05}s`;
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `Ver detalles de ${item.nombre}`);

            let statusClass = 'se-desconoce';
            if (item.estado === 'Vigente') statusClass = 'vigente';
            else if (item.estado === 'Derogada') statusClass = 'derogada';
            else if (item.estado === 'En revisión') statusClass = 'en-revision';

            const iconClass = CategoryIcons[item.materia.toUpperCase()] || CategoryIcons.DEFAULT;

            card.innerHTML = `
                <span class="card-header-badge ${statusClass}">${escapeHTML(item.estado || 'Se desconoce')}</span>
                <div class="card-icon-wrapper"><i class="fas ${iconClass}"></i></div>
                <h3 class="card-title" title="${escapeHTML(item.nombre)}">${highlightTokens(item.nombre, AppState.searchTokens)}</h3>
                <span class="card-materia"><i class="fas ${iconClass}"></i> ${escapeHTML(item.materia)}</span>
                <div class="card-id">${escapeHTML(item.id)} &middot; ${item.anio || 'N/A'}</div>
                <div class="card-action">Ver detalles</div>
            `;

            card.addEventListener('click', () => openModal(item));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openModal(item);
                }
            });
            fragment.appendChild(card);
        });

        DOM.cardsContainer.appendChild(fragment);

        // Actualizar botón de paginación
        if (hasMore) {
            DOM.btnCards.style.display = 'block';
            DOM.btnCards.textContent = `Cargar más (${list.length - endIndex} restantes)`;
            DOM.btnCards.disabled = false;
        } else {
            DOM.btnCards.style.display = list.length <= AppState.cardsPerPage ? 'none' : 'block';
            DOM.btnCards.textContent = 'Ver menos';
            DOM.btnCards.disabled = false;
        }

        // Info de paginación
        DOM.paginationInfo.textContent = `Mostrando ${visibleItems.length} de ${list.length}`;
    }

    function renderCategories() {
        DOM.categoriesContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();

        // Opción: TODAS
        const allCount = AppState.ordinances.length;
        const allPill = createPill('TODAS', allCount, 'fa-border-all', AppState.selectedCategory === 'TODAS');
        fragment.appendChild(allPill);

        AppState.categories.forEach(cat => {
            const iconClass = CategoryIcons[cat.toUpperCase()] || CategoryIcons.DEFAULT;
            const count = AppState.categoryCounts[cat] || 0;
            fragment.appendChild(createPill(cat, count, iconClass, AppState.selectedCategory === cat));
        });

        DOM.categoriesContainer.appendChild(fragment);
    }

    /**
     * Crea una píldora de categoría accesible (focusable con teclado)
     */
    function createPill(name, count, iconClass, isActive) {
        const pill = document.createElement('div');
        pill.className = `pill ${isActive ? 'active' : ''}`;
        pill.setAttribute('role', 'button');
        pill.setAttribute('tabindex', '0');
        pill.setAttribute('aria-pressed', isActive);
        pill.innerHTML = `
            <span class="pill-count">${count}</span>
            <i class="fas ${iconClass}"></i>
            <span>${escapeHTML(name)}</span>
        `;
        const activate = () => selectCategory(name);
        pill.addEventListener('click', activate);
        pill.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
            }
        });
        return pill;
    }

    function selectCategory(categoryName) {
        AppState.selectedCategory = categoryName;
        DOM.materiaFilter.value = categoryName === 'TODAS' ? 'all' : categoryName;
        renderCategories();
        applyFilters();
    }

    // ==========================================================================
    // 8. ANIMACIONES REVEAL ON SCROLL
    // ==========================================================================
    function initRevealAnimations() {
        const targets = document.querySelectorAll(
            '.stat-card, .filters-container, .section-header, .col-left, .col-right'
        );

        if (!('IntersectionObserver' in window)) {
            targets.forEach(el => el.classList.add('in-view'));
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('in-view');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        targets.forEach(el => {
            el.classList.add('reveal');
            observer.observe(el);
        });
    }

    // ==========================================================================
    // 9. MANEJO DE MODAL CON FOCUS TRAPPING + VISTA PREVIA + COMPARTIR
    // ==========================================================================
    let currentOrdinance = null;

    function openModal(item) {
        currentOrdinance = item;

        // Guardar el elemento que tenía el focus
        AppState.savedFocus = document.activeElement;

        const modalBox = DOM.ordinanceModal.querySelector('.modal-box');
        modalBox.setAttribute('data-status', item.estado || 'Se desconoce');

        DOM.modalTitle.textContent = item.nombre;
        DOM.modalId.textContent = item.id;
        DOM.modalDate.textContent = item.fechaImpresa || 'No disponible';
        DOM.modalCategory.textContent = item.materia;

        DOM.modalStatus.textContent = item.estado || 'Se desconoce';
        DOM.modalStatus.className = 'status-pill';
        if (item.estado === 'Vigente') DOM.modalStatus.classList.add('vigente');
        else if (item.estado === 'Derogada') DOM.modalStatus.classList.add('derogada');
        else if (item.estado === 'En revisión') DOM.modalStatus.classList.add('en-revision');
        else DOM.modalStatus.classList.add('se-desconoce');

        // Botón de Google Drive
        if (item.link && item.link.startsWith('http')) {
            DOM.modalLink.href = item.link;
            DOM.modalLink.classList.remove('disabled');
            DOM.modalLink.style.display = 'inline-flex';
            DOM.modalLink.innerHTML = '<i class="fab fa-google-drive"></i> Ver documento original en Google Drive';
        } else {
            DOM.modalLink.href = '#';
            DOM.modalLink.classList.add('disabled');
            DOM.modalLink.style.display = 'inline-flex';
            DOM.modalLink.innerHTML = '<i class="fas fa-file-excel"></i> Documento no disponible';
        }

        // Vista previa embebida del documento (sin salir del portal)
        const driveId = extractDriveId(item.link);
        if (driveId && DOM.modalPreview && DOM.modalIframe) {
            DOM.modalIframe.src = `https://drive.google.com/file/d/${driveId}/preview`;
            DOM.modalPreview.hidden = false;
        } else if (DOM.modalPreview) {
            DOM.modalPreview.hidden = true;
            DOM.modalIframe.src = '';
        }

        // Botón de compartir nativo: solo si el navegador lo soporta
        if (DOM.btnNativeShare) {
            DOM.btnNativeShare.style.display = navigator.share ? '' : 'none';
        }

        // Datos estructurados por ordenanza (SEO)
        injectOrdinanceJsonLd(item);

        DOM.ordinanceModal.classList.add('show');
        DOM.ordinanceModal.setAttribute('aria-hidden', 'false');

        // Focus trapping: enfocar el botón de cerrar
        setTimeout(() => DOM.btnModalClose.focus(), 50);
    }

    /**
     * Inyecta JSON-LD de tipo Legislation para la ordenanza abierta
     */
    function injectOrdinanceJsonLd(item) {
        let ld = document.getElementById('ldOrdinance');
        if (!ld) {
            ld = document.createElement('script');
            ld.type = 'application/ld+json';
            ld.id = 'ldOrdinance';
            document.head.appendChild(ld);
        }
        ld.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Legislation',
            'name': item.nombre,
            'legislationType': 'Ordenanza Municipal',
            'identifier': item.id,
            'dateIssued': item.fecha,
            'legislationJurisdiction': {
                '@type': 'AdministrativeArea',
                'name': 'Municipio Sucre, Estado Miranda, Venezuela'
            }
        });
    }

    function getOrdinanceShareUrl(item) {
        return `${getShareBase()}?ordenanza=${encodeURIComponent(item.id)}`;
    }

    function closeModal() {
        DOM.ordinanceModal.classList.remove('show');
        DOM.ordinanceModal.setAttribute('aria-hidden', 'true');
        currentOrdinance = null;

        // Detener la vista previa para ahorrar recursos
        if (DOM.modalIframe) DOM.modalIframe.src = '';

        // Restaurar focus
        if (AppState.savedFocus) {
            AppState.savedFocus.focus();
            AppState.savedFocus = null;
        }
    }

    /**
     * Copia texto al portapapeles con fallback para HTTP y navegadores antiguos
     */
    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (success) resolve();
                else reject(new Error('execCommand falló'));
            } catch (err) {
                document.body.removeChild(textarea);
                reject(err);
            }
        });
    }

    // Botones de acción del modal
    if (DOM.btnWhatsApp) {
        DOM.btnWhatsApp.addEventListener('click', () => {
            if (!currentOrdinance) return;
            const text = `${currentOrdinance.nombre} — ${currentOrdinance.id}\n${getOrdinanceShareUrl(currentOrdinance)}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        });
    }

    if (DOM.btnNativeShare) {
        DOM.btnNativeShare.addEventListener('click', () => {
            if (!currentOrdinance || !navigator.share) return;
            navigator.share({
                title: `${currentOrdinance.id} — Concejo Municipal de Sucre`,
                text: `${currentOrdinance.nombre} (${currentOrdinance.id})`,
                url: getOrdinanceShareUrl(currentOrdinance)
            }).catch(() => { /* El usuario canceló: no hacer nada */ });
        });
    }

    if (DOM.btnCopyLink) {
        DOM.btnCopyLink.addEventListener('click', () => {
            if (!currentOrdinance) return;
            copyToClipboard(getOrdinanceShareUrl(currentOrdinance)).then(() => {
                const original = DOM.btnCopyLink.innerHTML;
                DOM.btnCopyLink.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
                DOM.btnCopyLink.classList.add('copied');
                setTimeout(() => {
                    DOM.btnCopyLink.innerHTML = original;
                    DOM.btnCopyLink.classList.remove('copied');
                }, 2000);
            }).catch(() => {
                const original = DOM.btnCopyLink.innerHTML;
                DOM.btnCopyLink.innerHTML = '<i class="fas fa-exclamation-circle"></i> Error';
                setTimeout(() => { DOM.btnCopyLink.innerHTML = original; }, 2500);
            });
        });
    }

    if (DOM.btnPrint) {
        DOM.btnPrint.addEventListener('click', () => {
            if (!currentOrdinance) return;
            printOrdinance(currentOrdinance);
        });
    }

    /**
     * Imprime una ficha limpia de la ordenanza (solo el contenido, no la página)
     */
    function printOrdinance(item) {
        if (!DOM.printArea) return;
        DOM.printArea.innerHTML = `
            <h1>Concejo Municipal de Sucre &middot; Estado Miranda</h1>
            <h2>${escapeHTML(item.nombre)}</h2>
            <p><strong>N° Identificador:</strong> ${escapeHTML(item.id)}</p>
            <p><strong>Fecha de Expedición:</strong> ${escapeHTML(item.fechaImpresa || 'No disponible')}</p>
            <p><strong>Materia:</strong> ${escapeHTML(item.materia)}</p>
            <p><strong>Estado Jurídico:</strong> ${escapeHTML(item.estado || 'Se desconoce')}</p>
            ${item.link ? `<p><strong>Documento fuente:</strong> ${escapeHTML(item.link)}</p>` : ''}
            <p class="print-footer">Ficha generada desde el Portal de Ordenanzas del Concejo Municipal de Sucre &middot; ${getShareBase()}</p>
        `;
        window.print();
    }

    // Focus trapping dentro del modal
    DOM.ordinanceModal.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;

        const focusableElements = DOM.ordinanceModal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
        }
    });

    // ==========================================================================
    // 10. EVENT LISTENERS
    // ==========================================================================
    DOM.searchInput.addEventListener('input', debounce((e) => {
        AppState.searchTerm = e.target.value;
        applyFilters();
        // Nota: la sacudida del buscador ahora ocurre SOLO cuando no hay resultados
    }, 200));

    DOM.materiaFilter.addEventListener('change', (e) => {
        AppState.selectedCategory = e.target.value === 'all' ? 'TODAS' : e.target.value;
        renderCategories();
        applyFilters();
    });

    DOM.yearFilter.addEventListener('change', (e) => {
        AppState.selectedYear = e.target.value;
        applyFilters();
    });

    DOM.statusFilter.addEventListener('change', (e) => {
        AppState.selectedStatus = e.target.value;
        applyFilters();
    });

    DOM.btnResetFilters.addEventListener('click', () => {
        AppState.selectedCategory = 'TODAS';
        AppState.selectedYear = 'all';
        AppState.selectedStatus = 'all';
        AppState.searchTerm = '';
        AppState.searchTokens = [];
        AppState.cardsPage = 1;

        DOM.searchInput.value = '';
        DOM.materiaFilter.value = 'all';
        DOM.yearFilter.value = 'all';
        DOM.statusFilter.value = 'all';

        // Limpiar localStorage
        try {
            localStorage.removeItem('ordenanzas_filters');
        } catch (e) {}

        const bar = document.querySelector('.search-bar');
        if (bar) bar.classList.remove('no-results');

        renderCategories();
        applyFilters();

        // Sincronizar custom dropdowns
        document.querySelectorAll('.custom-select').forEach(select => {
            const wrapper = select.closest('.filter-group')?.querySelector('.custom-dropdown');
            if (wrapper) updateCustomDropdown(wrapper, select);
        });
    });

    // Botón "Cargar más" con paginación
    DOM.btnCards.addEventListener('click', () => {
        const list = AppState.filteredOrdinances;
        const endIndex = AppState.cardsPage * AppState.cardsPerPage;

        if (endIndex >= list.length) {
            // Si ya mostró todo, volver al inicio (Ver menos)
            AppState.cardsPage = 1;
        } else {
            AppState.cardsPage++;
        }

        renderCards();

        // Scroll suave al final de las tarjetas nuevas
        if (AppState.cardsPage > 1) {
            setTimeout(() => {
                DOM.btnCards.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    });

    DOM.btnCats.addEventListener('click', () => {
        DOM.categoriesContainer.classList.toggle('expanded');
        AppState.isExpandedCats = DOM.categoriesContainer.classList.contains('expanded');
        DOM.btnCats.textContent = AppState.isExpandedCats ? "Ver menos" : "Ver todo";
    });

    // Cierre de modal
    DOM.btnModalClose.addEventListener('click', closeModal);
    DOM.ordinanceModal.addEventListener('click', (e) => {
        if (e.target === DOM.ordinanceModal || e.target.classList.contains('modal-overlay')) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && DOM.ordinanceModal.classList.contains('show')) {
            closeModal();
        }
    });

    // Menú Header con aria-expanded
    DOM.menuToggleBtn.addEventListener('click', () => {
        const isOpen = DOM.dropdownMenu.classList.toggle('show');
        DOM.menuToggleBtn.setAttribute('aria-expanded', isOpen);
        DOM.dropdownMenu.setAttribute('aria-hidden', !isOpen);
    });

    document.addEventListener('click', (e) => {
        if (!DOM.menuToggleBtn.contains(e.target) && !DOM.dropdownMenu.contains(e.target)) {
            DOM.dropdownMenu.classList.remove('show');
            DOM.menuToggleBtn.setAttribute('aria-expanded', 'false');
            DOM.dropdownMenu.setAttribute('aria-hidden', 'true');
        }
    });

    // Inventario completo - mostrar resumen en vez de alert simple
    DOM.btnFullInventory.addEventListener('click', () => {
        const total = AppState.ordinances.length;
        const vigentes = AppState.ordinances.filter(o => o.estado === 'Vigente').length;
        const revision = AppState.ordinances.filter(o => o.estado === 'En revisión').length;
        const derogadas = AppState.ordinances.filter(o => o.estado === 'Derogada').length;
        const desconocido = AppState.ordinances.filter(o => o.estado === 'SE DESCONOCE').length;

        alert(`📊 RESUMEN DEL INVENTARIO\n\n` +
              `Total de ordenanzas: ${total}\n` +
              `• Vigentes: ${vigentes}\n` +
              `• En revisión: ${revision}\n` +
              `• Derogadas: ${derogadas}\n` +
              `• Estado desconocido: ${desconocido}\n\n` +
              `Materias registradas: ${AppState.categories.length}`);
    });

    // Rotación de placeholders en el buscador
    function rotatePlaceholder() {
        if (!DOM.searchInput) return;
        placeholderIndex = (placeholderIndex + 1) % SEARCH_PLACEHOLDERS.length;
        DOM.searchInput.setAttribute('placeholder', SEARCH_PLACEHOLDERS[placeholderIndex]);
    }
    setInterval(rotatePlaceholder, 4000);

    // Barra de progreso de scroll + botón volver arriba
    function initScrollUI() {
        const root = document.documentElement;
        window.addEventListener('scroll', () => {
            const max = root.scrollHeight - root.clientHeight;
            if (DOM.scrollProgress) {
                DOM.scrollProgress.style.width = (max > 0 ? (root.scrollTop / max) * 100 : 0) + '%';
            }
            if (DOM.backToTop) {
                DOM.backToTop.classList.toggle('show', root.scrollTop > 600);
            }
        }, { passive: true });

        if (DOM.backToTop) {
            DOM.backToTop.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
    }
    initScrollUI();

    // Deep linking: abrir modal automáticamente si la URL tiene ?ordenanza=ID
    function checkDeepLink() {
        const params = new URLSearchParams(window.location.search);
        const ordinanceId = params.get('ordenanza');

        if (!ordinanceId) return;

        console.log('[DeepLink] Buscando ordenanza:', ordinanceId);

        // Buscar por ID exacto o por número
        let found = AppState.ordinances.find(o => o.id === ordinanceId);

        // Si no se encuentra exacto, intentar con decodeURIComponent
        if (!found) {
            const decodedId = decodeURIComponent(ordinanceId);
            found = AppState.ordinances.find(o => o.id === decodedId);
        }

        // Si aún no se encuentra, buscar por número
        if (!found) {
            found = AppState.ordinances.find(o => o.numero === ordinanceId);
        }

        if (found) {
            // Esperar a que el DOM se renderice completamente
            setTimeout(() => {
                openModal(found);
                // Limpiar el parámetro de la URL sin recargar
                if (window.history.replaceState) {
                    const url = new URL(window.location);
                    url.searchParams.delete('ordenanza');
                    window.history.replaceState({}, document.title, url);
                }
            }, 600);
        } else {
            console.warn('[DeepLink] No se encontró ordenanza con ID:', ordinanceId);
        }
    }

    // Inicializar aplicación
    loadData();
});
