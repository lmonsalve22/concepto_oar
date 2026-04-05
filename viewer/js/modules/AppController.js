import { state, fullData } from './Store.js';
const { legendsConfig, adminHierarchy, adminStats } = state;
import { coreMap } from './CoreMap.js';
import { showLoader } from './Utils.js';
import { AdminApp } from './AdminApp.js';
import { TestApp } from './TestApp.js';

class AppController {
    constructor() {
        this.apps = {
            'admin': new AdminApp(),
            'test': new TestApp()
        };
        this.currentAppKey = null;
        
        // Expose to window for diagnostics
        window.fullData = fullData;
        window.state = state;
        window.appControllerInstance = this;
    }

    async init() {
        coreMap.init();

        window.adminAppInstance = this.apps['admin'];
        window.switchApp = (app) => this.switchApp(app);

        const base = window.location.origin;
        try {
            const [paLegend, ecoLegend, hierarchy, stats, granularMapping, paStats, sicaPaises, ecosTeow, ecosTeowMapping, forestLoss] = await Promise.all([
                fetch(`../web_data/legends_config.json`).then(r => r.json()),
                fetch(`../web_data/ecosistemas_2002_legend.json`).then(r => r.json()),
                fetch(`../web_data/admin_hierarchy.json`).then(r => r.json()),
                fetch(`../web_data/admin_stats.json`).then(r => r.json()),
                fetch(`../web_data/ecos_granular_mapping.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
                fetch(`../web_data/pa_granular_stats.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
                fetch(`../web_data/sica_paises.json`).then(r => r.json()),
                fetch(`../web_data/ecos_teow_stats.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
                fetch(`../web_data/ecos_teow_mapping_spatial.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
                fetch(`../web_data/forest_loss_stats.json`).then(r => r.ok ? r.json() : null).catch(() => null)
            ]);

            legendsConfig.areas = paLegend;
            legendsConfig.ecosistemas = ecoLegend;
            state.forestLossStats = forestLoss;
            fullData.forestLossStats = forestLoss;

            if (hierarchy.MEX) delete hierarchy.MEX;
            Object.assign(adminHierarchy, hierarchy);
            Object.assign(adminStats, stats);
            Object.assign(state.ecosTeowStats, ecosTeow);
            fullData.paStats = paStats;
            fullData.ecosGranularMapping = granularMapping;
            fullData.ecosTeowMappingSpatial = ecosTeowMapping;
            
            // Process country data and regional mask
            sicaPaises.features = sicaPaises.features.filter(f => f.properties.Pais_cod3 !== 'MEX');
            fullData.admin.paises = sicaPaises;
            
            // Pre-calculate regional mask geom
            const regionalRings = [];
            sicaPaises.features.forEach(f => {
                const geom = f.geometry;
                if (geom.type === 'Polygon') {
                    regionalRings.push(geom.coordinates[0]);
                } else if (geom.type === 'MultiPolygon') {
                    geom.coordinates.forEach(poly => regionalRings.push(poly[0]));
                }
            });
            fullData.regionalMaskGeom = {
                type: 'MultiPolygon',
                coordinates: regionalRings.map(r => [r])
            };

            this.switchApp('admin');
        } catch(err) {
            console.error('Core init error', err);
            showLoader(false);
            alert('Error al cargar datos. Asegúrate de ejecutar el servidor local en el puerto 8000.');
        } finally {
            // Final home screen enforcement - ensure loader is off
            showLoader(false);
        }
    }


    async switchApp(appKey) {
        // Now we only have one main App (Admin Dashboard)
        if (appKey !== 'admin') {
            console.warn(`App ${appKey} ha sido integrada en el Tablero Principal.`);
            appKey = 'admin';
        }
        if (this.currentAppKey === appKey) return;

        showLoader(true);
        coreMap.resetGlobalState();

        if (this.currentAppKey && this.apps[this.currentAppKey]) {
            this.apps[this.currentAppKey].unmount();
        }

        this.currentAppKey = appKey;
        state.currentApp = appKey;

        // Simplify UI State
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const key = btn.getAttribute('data-app');
            btn.classList.toggle('active', key === appKey);
        });

        document.getElementById('app-title').innerText = 'Prueba de Concepto OAR';
        document.getElementById('app-subtitle').innerText = 'ANÁLISIS DEL ESTADO DE PROTECCIÓN Y NIVEL DE RIESGO DE LOS ECOSISTEMAS';

        if (this.apps[appKey]) {
            window.adminAppInstance = this.apps[appKey];
            await this.apps[appKey].mount();
        }

        showLoader(false);
    }
}

// Global UI handlers
window.switchDashTab = (tabId, btn) => {
    const appKey = state.currentApp;
    
    // UI state: only if called from interactive click (btn provided)
    if (btn) {
        document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.dash-content').forEach(c => c.classList.remove('visible'));
        const target = document.getElementById(`${tabId}-content`);
        if (target) target.classList.add('visible');
    }

    // Rename tabs contextually
    const tabEcos = document.getElementById('tab-ecos');
    const tabPas = document.getElementById('tab-pas');

    if (appKey === 'ecosistemas') {
        if (tabEcos) tabEcos.innerText = 'Límites Admin';
        if (tabPas) tabPas.innerText = 'Áreas Protegidas';
        if (window.ecosAppInstance) window.ecosAppInstance.onDashTabSwitch(tabId);
    } else {
        if (tabEcos) tabEcos.innerText = 'Ecosistemas';
        if (tabPas) tabPas.innerText = 'Áreas Protegidas';
        if (appKey === 'areas' && window.areasAppInstance) window.areasAppInstance.onDashTabSwitch(tabId);
        if (appKey === 'admin' && window.adminAppInstance) window.adminAppInstance.onDashTabSwitch(tabId);
        
        // Pestaña de Prueba Independiente
        if (tabId === 'test') {
            const controller = window.appControllerInstance;
            if (controller && controller.apps && controller.apps['test']) {
                controller.apps['test'].onDashTabSwitch(tabId);
            }
        }
    }
}

// Global reset aliases for legacy/index compatibility
window.resetEcosViewer = () => { if(window.ecosAppInstance) window.ecosAppInstance.resetFilters(); };
window.resetPAViewer = () => { if(window.areasAppInstance) window.areasAppInstance.resetFilters(); };


// Global Mobile UI handlers (Clean & Master)
window.toggleMobilePanel = (side) => {
    const left = document.getElementById('ui-overlay');
    const right = document.getElementById('detail-panel');
    const isMobile = window.innerWidth <= 1100;

    if (!isMobile) {
        // Desktop minimization logic
        if (side === 'left') left.classList.toggle('minimized');
        else right.classList.toggle('minimized');
        return;
    }

    // MOBILE Logic: Mutual Exclusion
    if (side === 'left') {
        const willOpen = !left.classList.contains('mobile-open');
        left.classList.toggle('mobile-open', willOpen);
        if (willOpen) right.classList.remove('mobile-open');
    } else {
        const willOpen = !right.classList.contains('mobile-open');
        right.classList.toggle('mobile-open', willOpen);
        if (willOpen) left.classList.remove('mobile-open');
    }
    
    // Final sync handled by MutationObserver
};

// Central HUD State Controller
function syncUIStates() {
    const isMobile = window.innerWidth <= 1100;
    const left = document.getElementById('ui-overlay');
    const right = document.getElementById('detail-panel');
    const btnLeft = document.getElementById('toggle-filters');
    const btnRight = document.getElementById('toggle-stats');

    if (!left || !right) return;

    const isLeftOpen = left.classList.contains('mobile-open');
    const isRightOpen = right.classList.contains('mobile-open');
    const isRightVisible = right.classList.contains('visible'); // Unit selected

    if (isMobile) {
        // Update Body Classes (for Map Lock & HUD Hide)
        document.body.classList.toggle('panel-left-open', isLeftOpen);
        document.body.classList.toggle('panel-right-open', isRightOpen);

        // Update Toggle Buttons
        if (btnLeft) {
            btnLeft.style.display = isLeftOpen ? 'none' : 'flex';
        }
        if (btnRight) {
            btnRight.classList.toggle('active-unit', isRightVisible);
            btnRight.style.display = (isRightVisible && !isRightOpen) ? 'flex' : 'none';
        }
    } else {
        // Desktop Clean Up
        document.body.classList.remove('panel-left-open', 'panel-right-open');
        if (btnLeft) btnLeft.style.display = '';
        if (btnRight) btnRight.style.display = '';
    }

    // Map Reflow (Only if needed)
    if (window.coreMap && window.coreMap.map) {
        window.coreMap.map.invalidateSize();
    }
}

// Observe attribute changes on panels
const observer = new MutationObserver(() => syncUIStates());

export const appController = new AppController();

window.addEventListener('DOMContentLoaded', () => {
    appController.init();
    
    const dashPanel = document.getElementById('detail-panel');
    const leftPanel = document.getElementById('ui-overlay');
    
    if (dashPanel) observer.observe(dashPanel, { attributes: true, attributeFilter: ['class'] });
    if (leftPanel) observer.observe(leftPanel, { attributes: true, attributeFilter: ['class'] });
    
    // Also sync on resize
    window.addEventListener('resize', () => syncUIStates());
    
    // Initial Sync
    setTimeout(syncUIStates, 500);
});
