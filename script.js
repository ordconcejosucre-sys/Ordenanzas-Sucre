/**
 * Portal de Consulta de Ordenanzas Municipales - Concejo Municipal de Sucre
 * Desarrollado en JavaScript Vanilla ES6+
 */

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // 1. ESTADO GLOBAL DE LA APLICACIÓN
    // ==========================================================================
    const AppState = {
        ordinances: [],
        filteredOrdinances: [],
        categories: [],
        selectedCategory: 'TODAS',
        selectedYear: 'all',
        selectedStatus: 'all',
        searchTerm: '',
        isExpandedCards: false,
        isExpandedCats: false
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

        // 1. Dar formato Tipo Título inicial
        let formatted = text
            .toString()
            .trim()
            .toLowerCase()
            .replace(/(^\w|\s\w)/g, (letra) => letra.toUpperCase());

        // 2. Unificación explícita de equivalencias, singulares/plurales y variantes
        const equivalencias = {
            "Reglamento": "Reglamentos",
            "Tributo": "Tributos",
            "Bien": "Bienes",
            "Protección De La Mujer": "Protección A La Mujer",
            "Proteccion De La Mujer": "Protección A La Mujer",
            "Proteccion A La Mujer": "Protección A La Mujer"
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

    // ==========================================================================
    // 4. CARGA ASÍNCRONA DE DATOS (FETCH)
    // ==========================================================================
    async function loadData() {
        try {
            DOM.cardsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando ordenanzas...</p></div>`;
            
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
            renderCards();
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
        // Extraer materias únicas
        const materiasSet = new Set();
        const yearsSet = new Set();

        AppState.ordinances.forEach(item => {
            if (item.materia) materiasSet.add(item.materia);
            if (item.anio) yearsSet.add(item.anio);
        });

        AppState.categories = Array.from(materiasSet).sort();
        const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

        // Poblar Select de Materia
        DOM.materiaFilter.innerHTML = `<option value="all">Todas las materias</option>`;
        AppState.categories.forEach(materia => {
            const option = document.createElement('option');
            option.value = materia;
            option.textContent = materia;
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
            minYear = Math.min(...years);
            maxYear = Math.max(...years);
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
            if (AppState.selectedYear !== 'all' && item.anio.toString() !== AppState.selectedYear) {
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
                `);

                // Todos los tokens ingresados deben coincidir
                const matches = searchTokens.every(token => searchableText.includes(token));
                if (!matches) return false;
            }

            return true;
        });

        renderCards();
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
            return;
        }

        const fragment = document.createDocumentFragment();

        list.forEach(item => {
            const card = document.createElement('article');
            card.className = 'card';
            
            // Determinar clase de estado
            let statusClass = 'en-revision';
            if (item.estado === 'Vigente') statusClass = 'vigente';
            if (item.estado === 'Derogada') statusClass = 'derogada';

            const iconClass = CategoryIcons[item.materia.toUpperCase()] || CategoryIcons.DEFAULT;

            card.innerHTML = `
                <span class="card-header-badge ${statusClass}">${item.estado}</span>
                <div class="card-icon"><i class="fas ${iconClass}"></i></div>
                <h3 class="card-title" title="${item.nombre}">${item.nombre}</h3>
                <div class="card-id">${item.id} (${item.anio})</div>
                <div class="card-action">Ver detalles</div>
            `;

            card.addEventListener('click', () => openModal(item));
            fragment.appendChild(card);
        });

        DOM.cardsContainer.appendChild(fragment);
    }

    function renderCategories() {
        DOM.categoriesContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();

        // Opción: TODAS
        const allPill = document.createElement('div');
        allPill.className = `pill ${AppState.selectedCategory === 'TODAS' ? 'active' : ''}`;
        allPill.innerHTML = `<i class="fas fa-border-all"></i><span>TODAS</span>`;
        allPill.addEventListener('click', () => selectCategory('TODAS'));
        fragment.appendChild(allPill);

        AppState.categories.forEach(cat => {
            const pill = document.createElement('div');
            pill.className = `pill ${AppState.selectedCategory === cat ? 'active' : ''}`;
            const iconClass = CategoryIcons[cat.toUpperCase()] || CategoryIcons.DEFAULT;

            pill.innerHTML = `<i class="fas ${iconClass}"></i><span>${cat}</span>`;
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
    // 8. MANEJO DE MODAL
    // ==========================================================================
    function openModal(item) {
        DOM.modalTitle.textContent = item.nombre;
        DOM.modalId.textContent = item.id;
        DOM.modalDate.textContent = item.fechaImpresa;
        DOM.modalCategory.textContent = item.materia;
        
        DOM.modalStatus.textContent = item.estado;
        DOM.modalStatus.className = 'status-pill';
        if (item.estado === 'Vigente') DOM.modalStatus.classList.add('vigente');
        else if (item.estado === 'Derogada') DOM.modalStatus.classList.add('derogada');
        else DOM.modalStatus.classList.add('en-revision');

        if (item.link && item.link.startsWith('http')) {
            DOM.modalLink.href = item.link;
            DOM.modalLink.classList.remove('disabled');
            DOM.modalLink.style.display = 'inline-flex';
        } else {
            DOM.modalLink.classList.add('disabled');
            DOM.modalLink.style.display = 'none';
        }

        DOM.ordinanceModal.classList.add('show');
        DOM.ordinanceModal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
        DOM.ordinanceModal.classList.remove('show');
        DOM.ordinanceModal.setAttribute('aria-hidden', 'true');
    }

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
        DOM.searchInput.value = '';
        DOM.materiaFilter.value = 'all';
        DOM.yearFilter.value = 'all';
        DOM.statusFilter.value = 'all';
        
        renderCategories();
        applyFilters();
    });

    DOM.btnCards.addEventListener('click', () => {
        DOM.cardsContainer.classList.toggle('expanded');
        AppState.isExpandedCards = DOM.cardsContainer.classList.contains('expanded');
        DOM.btnCards.textContent = AppState.isExpandedCards ? "Ver menos" : "Ver todo";
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

    // Menú Header
    DOM.menuToggleBtn.addEventListener('click', () => {
        DOM.dropdownMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!DOM.menuToggleBtn.contains(e.target) && !DOM.dropdownMenu.contains(e.target)) {
            DOM.dropdownMenu.classList.remove('show');
        }
    });

    DOM.btnFullInventory.addEventListener('click', () => {
        alert(`Inventario cargado exitosamente. Total: ${AppState.ordinances.length} ordenanzas registradas.`);
    });

    // Inicializar aplicación
    loadData();
});