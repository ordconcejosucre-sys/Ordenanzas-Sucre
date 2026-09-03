/**
 * Portal de Consulta de Ordenanzas Municipales - Concejo Municipal de Sucre
 * Desarrollado en JavaScript Vanilla ES6+
 * Versión corregida y mejorada
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
        isExpandedCards: false,
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

        // Menú desplegable
        menuToggleBtn: document.getElementById('menuToggleBtn'),
        dropdownMenu: document.getElementById('dropdownMenu'),
        btnFullInventory: document.getElementById('btnFullInventory'),

        // Nuevos elementos
        activeFilters: document.getElementById('activeFilters')
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
     * unifica singulares/plurales y redacciones duplicadas.
     */
    const normalizeCategory = (text) => {
        if (!text) return 'Sin Categoría';

        let formatted = text
            .toString()
            .trim()
            .toLowerCase()
            .replace(/(^\w|\s\w)/g, (letra) => letra.toUpperCase());

        // Unificación explícita de equivalencias, singulares/plurales y variantes
        const equivalencias = {
            "Reglamento": "Reglamentos",
            "Tributo": "Tributos",
            "Bien": "Bienes",
            "Protección De La Mujer": "Protección A La Mujer",
            "Proteccion De La Mujer": "Protección A La Mujer",
            "Proteccion A La Mujer": "Protección A La Mujer",
            "Convivencia Al Ciudadano": "Convivencia Ciudadana",
            "Convivencia al Ciudadano": "Convivencia Ciudadana",
            "Convivencia Al ciudadano": "Convivencia Ciudadana",
            "Convivencia Social": "Convivencia Ciudadana",
            "Convivencia social": "Convivencia Ciudadana",
            "Condecoracion": "Condecoración",
            "Condecoración": "Condecoración",
            "Ecologia": "Ecología",
            "Ecología": "Ecología"
        };

        return equivalencias[formatted] || formatted;
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
            const response = await fetch('./ordenanzas.json');
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

                // Aplicar a los controles del DOM
                DOM.searchInput.value = AppState.searchTerm;
                DOM.materiaFilter.value = AppState.selectedCategory === 'TODAS' ? 'all' : AppState.selectedCategory;
                DOM.yearFilter.value = AppState.selectedYear;
                DOM.statusFilter.value = AppState.selectedStatus;
            }

            applyFilters();
            renderCategories();

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
            const years = AppState.ordinances.map(o => o.anio).filter(Boolean);
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
            el.innerHTML = `<span>${chip.label}</span><span class="chip-remove">&times;</span>`;
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
            DOM.searchInput.value = '';
        }
        applyFilters();
    }

    function applyFilters() {
        const query = normalizeText(AppState.searchTerm);
        const searchTokens = query.split(' ').filter(Boolean);

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
                <span class="card-header-badge ${statusClass}">${item.estado || 'Se desconoce'}</span>
                <div class="card-icon-wrapper"><i class="fas ${iconClass}"></i></div>
                <h3 class="card-title" title="${item.nombre}">${item.nombre}</h3>
                <div class="card-id">${item.id} &middot; ${item.anio || 'N/A'}</div>
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
        const allPill = document.createElement('div');
        allPill.className = `pill ${AppState.selectedCategory === 'TODAS' ? 'active' : ''}`;
        allPill.innerHTML = `
            <span class="pill-count">${allCount}</span>
            <i class="fas fa-border-all"></i>
            <span>TODAS</span>
        `;
        allPill.addEventListener('click', () => selectCategory('TODAS'));
        fragment.appendChild(allPill);

        AppState.categories.forEach(cat => {
            const pill = document.createElement('div');
            pill.className = `pill ${AppState.selectedCategory === cat ? 'active' : ''}`;
            const iconClass = CategoryIcons[cat.toUpperCase()] || CategoryIcons.DEFAULT;
            const count = AppState.categoryCounts[cat] || 0;

            pill.innerHTML = `
                <span class="pill-count">${count}</span>
                <i class="fas ${iconClass}"></i>
                <span>${cat}</span>
            `;
            pill.addEventListener('click', () => selectCategory(cat));
            fragment.appendChild(pill);
        });

        DOM.categoriesContainer.appendChild(fragment);
    }

    function selectCategory(categoryName) {
        AppState.selectedCategory = categoryName;
        DOM.materiaFilter.value = categoryName === 'TODAS' ? 'all' : categoryName;
        renderCategories();
        applyFilters();
    }

    // ==========================================================================
    // 8. MANEJO DE MODAL CON FOCUS TRAPPING
    // ==========================================================================
    function openModal(item) {
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

        // Construir footer del modal con botón Drive + Copiar enlace
        const modalFooter = modalBox.querySelector('.modal-footer') || modalBox;

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

        // Botón copiar enlace (reemplazar si existe, crear si no)
        let copyBtn = modalBox.querySelector('.modal-copy-btn');
        if (!copyBtn) {
            copyBtn = document.createElement('button');
            copyBtn.className = 'modal-btn secondary modal-copy-btn';
            copyBtn.innerHTML = '<i class="fas fa-link"></i> Copiar enlace de la ordenanza';
            modalBox.querySelector('.modal-footer').appendChild(copyBtn);
        }

        const shareUrl = `${window.location.origin}${window.location.pathname}?ordenanza=${encodeURIComponent(item.id)}`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(shareUrl).then(() => {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> ¡Enlace copiado!';
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                }, 2000);
            });
        };

        DOM.ordinanceModal.classList.add('show');
        DOM.ordinanceModal.setAttribute('aria-hidden', 'false');

        // Focus trapping: enfocar el botón de cerrar
        setTimeout(() => DOM.btnModalClose.focus(), 50);
    }

    function closeModal() {
        DOM.ordinanceModal.classList.remove('show');
        DOM.ordinanceModal.setAttribute('aria-hidden', 'true');

        // Restaurar focus
        if (AppState.savedFocus) {
            AppState.savedFocus.focus();
            AppState.savedFocus = null;
        }
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
    // 9. EVENT LISTENERS
    // ==========================================================================
    DOM.searchInput.addEventListener('input', debounce((e) => {
        AppState.searchTerm = e.target.value;
        applyFilters();
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
        AppState.cardsPage = 1;

        DOM.searchInput.value = '';
        DOM.materiaFilter.value = 'all';
        DOM.yearFilter.value = 'all';
        DOM.statusFilter.value = 'all';

        // Limpiar localStorage
        try {
            localStorage.removeItem('ordenanzas_filters');
        } catch (e) {}

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
        if (e.target === DOM.ordinanceModal) closeModal();
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

    // Inicializar aplicación
    loadData();
});