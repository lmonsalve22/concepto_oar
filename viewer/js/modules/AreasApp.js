import { state, fullData } from './Store.js';
const { adminHierarchy } = state;
import { showLoader, getEcoColor, normalizeStr, cleanEncoding, createPremiumPopupHTML } from './Utils.js';
import { coreMap } from './CoreMap.js';

export class AreasApp {
    constructor() {
        this.appKey = 'areas';
    }

    mount() {
        console.log('Mounting Areas App');
        document.getElementById('pa-controls').style.display = 'block';
        document.getElementById('level-container').style.display = 'none';
        
        coreMap.setLayerPriority('areas');
        
        this.initPASelectors();
        this.updatePAView();
    }

    unmount() {
        console.log('Unmounting Areas App');
        document.getElementById('pa-controls').style.display = 'none';
        coreMap.clearMap(); // Isolation: completely wipes map layers
        document.getElementById('detail-panel').classList.remove('visible');
    }

    resetFilters() {
        showLoader(true);
        const cFilter = document.getElementById('pa-country');
        const kFilter = document.getElementById('pa-category');
        const nFilter = document.getElementById('pa-name');
        
        if (cFilter) cFilter.value = '';
        if (kFilter) { kFilter.innerHTML = '<option value="">Categoría</option>'; kFilter.disabled = true; }
        if (nFilter) { nFilter.innerHTML = '<option value="">Área Protegida</option>'; nFilter.disabled = true; }

        state.activePAFeature = null;
        state.activePAStats = null;
        document.getElementById('detail-panel').classList.remove('visible');
        
        this.updatePAView();
        
        if (coreMap.highlightLayer) {
            coreMap.map.removeLayer(coreMap.highlightLayer);
            coreMap.highlightLayer = null;
        }
        coreMap.map.setView([15, -86], 6);
        showLoader(false);
    }

    initPASelectors() {
        const countryFilter = document.getElementById('pa-country');
        const catFilter = document.getElementById('pa-category');
        const paName = document.getElementById('pa-name');
        
        if (!countryFilter || countryFilter.dataset.initialized) return;

        countryFilter.innerHTML = '<option value="">Regional (Centroamérica)</option>' +
            Object.entries(adminHierarchy).map(([iso, data]) => `<option value="${iso}">${data.name}</option>`).join('');
        
        countryFilter.addEventListener('change', async () => {
            const iso = countryFilter.value;
            catFilter.innerHTML = '<option value="">Categoría</option>';
            paName.innerHTML = '<option value="">Área Protegida</option>';
            catFilter.disabled = true;
            paName.disabled = true;

            if (!iso) {
                this.updatePAView();
                return;
            }
            
            showLoader(true);
            if (!fullData.paStats) {
                const res = await fetch(`../web_data/pa_granular_stats.json`);
                if (res.ok) fullData.paStats = await res.json();
            }

            const countryPAs = Object.values(fullData.paStats.pas).filter(pa => pa.iso3 === iso);
            const categories = [...new Set(countryPAs.map(pa => pa.category))].sort();
            
            if (categories.length > 0) {
                catFilter.innerHTML = '<option value="">Todas las Categorías</option>' +
                    categories.map(c => `<option value="${c}">${c}</option>`).join('');
                catFilter.disabled = false;
            }
            
            this.updatePAPopulation(iso, ''); 
            showLoader(false);
            this.updatePAView();
        });

        catFilter.addEventListener('change', () => {
            this.updatePAPopulation(countryFilter.value, catFilter.value);
            this.updatePAView();
        });

        paName.addEventListener('change', () => {
            if (paName.value) {
                this.highlightPA(countryFilter.value, paName.value);
                this.updatePAView();
            }
        });

        countryFilter.dataset.initialized = 'true';
    }

    updatePAPopulation(iso, category) {
        const paName = document.getElementById('pa-name');
        const pas = fullData.paStats.pas || {};
        const filtered = Object.entries(pas)
            .filter(([n, d]) => d.iso3 === iso && (!category || d.category === category))
            .sort((a, b) => a[0].localeCompare(b[0]));

        paName.innerHTML = '<option value="">Seleccione Área</option>' +
            filtered.map(([n, d]) => `<option value="${n}">${n}</option>`).join('');
        paName.disabled = filtered.length === 0;
    }

    async updatePAView() {
        showLoader(true);
        try {
            const iso = document.getElementById('pa-country').value;
            const category = document.getElementById('pa-category').value;
            const paName = document.getElementById('pa-name').value;

            if (paName && fullData.paStats.pas[paName]) {
                const stats = fullData.paStats.pas[paName];
                this.updateDashboard(paName, stats, iso);
                return;
            }

            if (iso) {
                if (!fullData.paStats) {
                    const res = await fetch(`../web_data/pa_granular_stats.json`);
                    if (res.ok) fullData.paStats = await res.json();
                }
                
                const country = adminHierarchy[iso]?.name || iso;
                const filteredStats = {
                    total_areas: Object.values(fullData.paStats.pas).filter(d => d.iso3 === iso && (!category || d.category === category)).length,
                    paList: Object.entries(fullData.paStats.pas)
                        .filter(([n, d]) => d.iso3 === iso && (!category || d.category === category))
                        .map(([n, d]) => ({ name: n, ...d })),
                    iso: iso
                };
                
                if (iso && fullData.admin.paises) {
                    const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                    if (countryFeat) {
                        coreMap.map.fitBounds(L.geoJSON(countryFeat).getBounds(), state.mapPadding);
                        coreMap.applyMapMask(countryFeat);
                    }
                } else if (!iso && fullData.regionalMaskGeom) {
                    coreMap.applyMapMask(fullData.regionalMaskGeom);
                }
            } else {
                coreMap.map.setView([15, -86], 6);
                if (fullData.regionalMaskGeom) coreMap.applyMapMask(fullData.regionalMaskGeom);
                document.getElementById('detail-panel').classList.remove('visible');
            }
        } catch(e) {
            console.error("Error in updatePAView:", e);
        } finally {
            showLoader(false);
        }
    }

    async highlightPA(iso, name) {
        try {
            const isoKey = iso.toUpperCase();
            if (!fullData.areasPartitioned[isoKey]) {
                const res = await fetch(`../web_data/pa_split/pa_${isoKey}.json`);
                if (res.ok) fullData.areasPartitioned[isoKey] = await res.json();
            }
            
            const paDoc = fullData.areasPartitioned[isoKey];
            if (!paDoc) return;

            const features = paDoc.features.filter(f => f.properties.nombre === name);
            if (features.length > 0) {
                if (coreMap.highlightLayer) coreMap.map.removeLayer(coreMap.highlightLayer);
                coreMap.highlightLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
                    pane: 'selectionPane',
                    style: { color: '#ffffff', weight: 2.5, fillOpacity: 0.1, fillColor: '#ffffff' }
                }).addTo(coreMap.map);
                
                coreMap.applyMapMask({ type: 'FeatureCollection', features: features });
                coreMap.map.fitBounds(coreMap.highlightLayer.getBounds(), { ...state.mapPadding, maxZoom: 12 });
                coreMap.highlightLayer.bindPopup(createPremiumPopupHTML({
                    title: cleanEncoding(name),
                    subtitle: 'Área Protegida',
                    themeColor: '#10b981'
                }), { className: 'premium-popup-wrap' });
            }
        } catch(e) {
            console.error("Failed to highlight PA", e);
        }
    }

    updateDashboard(name, stats, iso) {
        const panel = document.getElementById('detail-panel');
        const content = document.getElementById('info-content');
        
        const countryName = adminHierarchy[iso]?.name || iso;
        document.getElementById('app-subtitle').innerText = `Área Protegida: ${name}`;

        content.innerHTML = `
            <div class="detail-header">
                <p class="detail-label">Análisis de Área Protegida</p>
                <h2 class="detail-title">${cleanEncoding(name)}</h2>
                <div class="detail-badge">${countryName} (${iso})</div>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-value">${(stats.area_ha || 0).toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                    <span class="stat-label">Hectáreas Totales</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value">${Object.keys(stats.ecos || {}).length}</span>
                    <span class="stat-label">Ecosistemas</span>
                </div>
            </div>
            
            <div class="chart-section" style="margin-top:20px;">
                <p class="chart-title">Composición por Ecosistema</p>
                <div class="chart-container" style="height:250px;"><canvas id="paEcoChart"></canvas></div>
            </div>

            <div class="admin-section-header">
                <p class="detail-label">Intersección Administrativa</p>
            </div>
            <div id="admin-summary" style="margin-top:10px;">
                ${this.buildAdminAccordionForPA(stats, iso)}
            </div>`;

        panel.classList.add('visible');
        setTimeout(() => this.renderPACharts(stats), 100);
    }

    buildAdminAccordionForPA(paData, iso) {
        // Since PA data might not have administrative links, we derive them from adminHierarchy mapping
        // or from the granular stats if available.
        const depts = {};
        
        // PA data includes muni_ids if we processed it correctly
        if (paData.muni_ids) {
            paData.muni_ids.forEach(mId => {
                // Find which dept this muni belongs to in adminHierarchy
                for (const [deptId, deptData] of Object.entries(adminHierarchy[iso]?.admin1 || {})) {
                    if (deptData.admin2 && deptData.admin2[mId]) {
                        if (!depts[deptId]) depts[deptId] = { name: deptData.name, munis: [] };
                        depts[deptId].munis.push({ id: mId, name: deptData.admin2[mId] });
                    }
                }
            });
        }

        if (Object.keys(depts).length === 0) return '<div style="padding:15px; color:var(--gray);">Sin datos de intersección.</div>';

        let html = '<div style="margin-top:10px;">';
        Object.entries(depts).forEach(([deptId, data]) => {
            html += `
                <div class="accordion-item" style="border:1px solid var(--border); border-radius:8px; margin-bottom:6px; overflow:hidden;">
                    <div class="accordion-header" style="background:rgba(255,255,255,0.04); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85rem; font-weight:600;">${cleanEncoding(data.name)}</span>
                        <span class="acc-arrow" style="color:var(--primary); transition:transform 0.2s; cursor:pointer;" 
                              onclick="const content=this.closest('.accordion-header').nextElementSibling; content.classList.toggle('visible'); this.style.transform = content.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)'">▶</span>
                    </div>
                    <div class="accordion-content dash-content" style="padding:0; max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.15);">
                        <div style="padding:8px;">
                            ${data.munis.map(m => `<div class="dash-row" style="padding:4px 0;"><div class="dash-name">${cleanEncoding(m.name)}</div></div>`).join('')}
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
        return html;
    }

    renderPACharts(stats) {
        coreMap.destroyCharts();
        const ctx = document.getElementById('paEcoChart')?.getContext('2d');
        if (!ctx || !stats.ecos) return;

        const ecoData = Object.entries(stats.ecos).sort((a,b) => b[1] - a[1]).slice(0, 8);
        
        coreMap.ecoChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ecoData.map(e => e[0]),
                datasets: [{
                    data: ecoData.map(e => e[1]),
                    backgroundColor: ecoData.map(e => `hsl(${Math.random()*360}, 60%, 50%)`),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 9 } } } }
            }
        });
    }

    onDashTabSwitch(tabId) {
        // Placeholder
    }
}
