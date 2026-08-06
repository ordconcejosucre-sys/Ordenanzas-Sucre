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
        btnFullInventory: document.getElementById('btnFullInventory')
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
            "Convivencia Al ciudadano": "Convivencia Ciudadana"
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

        DOM.statTotal.textContent = total;
        DOM.statMaterias.textContent = materiasCount;
        DOM.statAnioInicio.textContent = minYear;
        DOM.statAnioFin.textContent = maxYear;
    }

    // ==========================================================================
    // 6. LÓGICA DE FILTRADO Y BÚSQUEDA INTELIGENTE
    // ==========================================================================
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

        visibleItems.forEach(item => {
            const card = document.createElement('article');
            card.className = 'card';
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
                <div class="card-icon"><i class="fas ${iconClass}"></i></div>
                <h3 class="card-title" title="${item.nombre}">${item.nombre}</h3>
                <div class="card-id">${item.id} (${item.anio || 'N/A'})</div>
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

        if (item.link && item.link.startsWith('http')) {
            DOM.modalLink.href = item.link;
            DOM.modalLink.classList.remove('disabled');
            DOM.modalLink.style.display = 'inline-flex';
            DOM.modalLink.textContent = 'Ver Documento en Drive';
        } else {
            DOM.modalLink.classList.add('disabled');
            DOM.modalLink.style.display = 'inline-flex';
            DOM.modalLink.textContent = 'Documento no disponible';
        }

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

    // Inicializar aplicación
    loadData();
});