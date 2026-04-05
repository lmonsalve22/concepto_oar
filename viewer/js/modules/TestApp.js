import { state, fullData } from './Store.js';
import { showLoader, cleanEncoding, getEcoColor, formatNumber } from './Utils.js';
import { coreMap } from './CoreMap.js';

/**
 * TestApp v2.0 (Stable Deforestation Engine)
 * Replaces the original buggy module with a robust diagnostic-aware dashboard.
 */
export class TestApp {
    constructor() {
        this.appKey = 'test';
        this.charts = { trend: null, eco: null };
        this._isMounted = false;
        this._dataCache = { stats: null, heatmap: null };
    }

    async mount() {
        this._isMounted = true;
        // REQUISITO: Siempre iniciar con valores por defecto
        this.resetHeatSettings();

        this.log("[SISTEMA] Sincronizando capas de análisis regional...");
        // Ya no cargamos Ecosistemas aquí. AdminApp se encarga de esto en switchDashTab.
        // Esto evita el doble renderizado y el bloqueo del navegador.
        // const adminApp = window.appControllerInstance?.apps['admin'];
        // if (adminApp) adminApp.renderEcosMap('ALL');

        // Listener for dynamic auto-adjustment on move
        coreMap.map.on('moveend', () => {
             const isAuto = document.getElementById('test-heat-auto')?.checked;
             const isTest = (state.activeTab === 'test');
             const heatActive = document.getElementById('test-heat-toggle')?.checked;
             if (isAuto && isTest && heatActive) {
                 this.toggleHeat(true);
             }
        });

        // Atomic State Sync
        state.activeTab = 'test';
        console.log(`[ATOMIC SYNC] Motor iniciado en modo: ${state.activeTab}`);

        // 1. Mejorar Visibilidad del Mapa (Solo bordes)
        this.setMapTransparency(true);

        // 2. Asegurar carga de datos (Patrón Singleton)
        await this.ensureData();

        // 3. Sincronizar UI y Gráficas
        this.updateCharts();

        // 4. Activar Mapa de Calor por defecto (según preferencia del usuario)
        const toggle = document.getElementById('test-heat-toggle');
        if (toggle && toggle.checked) {
            this.toggleHeat(true);
        }

        // 5. Autorefresh para garantizar que la capa de ecosistema regional subyacente
        // respete las z-indexes luego de la carga masiva del heatmap local.
        setTimeout(() => {
            this.refreshMapLayers();
        }, 800);

        // Diagnóstico automático para verificar la purga y transparencia
        setTimeout(() => this.runDiagnostic(), 1500);
    }

    async ensureData() {
        const v = '2.2.0_isolated_fixed';
        
        // Cargar Estadísticas si no existen
        if (!this._dataCache.stats) {
            this.log("Consultando repositorio de estadísticas...");
            try {
                const res = await fetch(`../web_data/forest_loss_stats.json?v=${v}`);
                this._dataCache.stats = await res.json();
                this.log("[OK] Estadísticas sincronizadas.");
            } catch (e) {
                this.log("[ERROR] No se pudieron cargar las estadísticas.");
            }
        }

        // Cargar Heatmap si no existe
        if (!this._dataCache.heatmap) {
            this.log("Descargando dataset geoespacial (17MB)...");
            showLoader(true);
            try {
                const res = await fetch(`../web_data/forest_loss_heatmap.json?v=${v}`);
                this._dataCache.heatmap = await res.json();
                this.log(`[OK] ${formatNumber(this._dataCache.heatmap.length)} puntos en memoria.`);
            } catch (e) {
                this.log("[ERROR] Fallo en descarga de dataset pesado.");
            } finally {
                showLoader(false);
            }
        }
    }

    _resolveDataEntry(statsMap, id, iso) {
        if (!statsMap || !id) return null;
        
        // 1. Coincidencia Directa
        if (statsMap[id]) return statsMap[id];
        
        // 2. Coincidencia de punto flotante (e.g. '3' -> '3.0' en admin1)
        const floatKey = parseFloat(id).toFixed(1);
        if (statsMap[floatKey]) return statsMap[floatKey];
        
        // 3. Coincidencia con Prefijo ISO (e.g. '101' -> 'HND-0101' o 'HND-101')
        if (iso) {
            // Variante simple: HND-101
            const isoKey = `${iso}-${id}`;
            if (statsMap[isoKey]) return statsMap[isoKey];
            
            // Variante con Padding (4 dígitos): HND-0101
            const paddedId = id.toString().padStart(4, '0');
            const paddedIsoKey = `${iso}-${paddedId}`;
            if (statsMap[paddedIsoKey]) return statsMap[paddedIsoKey];
        }

        return null;
    }

    updateCharts() {
        if (!this._dataCache.stats) return;

        const stats = this._dataCache.stats;
        const country = document.getElementById('admin-country')?.value || '';
        const dept = document.getElementById('admin-dept')?.value || '';
        const muni = document.getElementById('admin-muni')?.value || '';
        
        let targetData = stats.regional || {};
        let ecoData = {};
        let unitName = "Centroamérica";

        // 1. RESOLUCIÓN DE NOMBRE DE UNIDAD (Prioridad Jerárquica)
        if (muni) {
            let mName = muni;
            if (state.adminHierarchy[country]?.admin1) {
                const depts = state.adminHierarchy[country].admin1;
                for (const dId in depts) {
                    if (depts[dId].admin2 && depts[dId].admin2[muni]) {
                        mName = depts[dId].admin2[muni];
                        break;
                    }
                }
            }
            unitName = typeof cleanEncoding === 'function' ? cleanEncoding(mName) : mName;
        } else if (dept) {
            const dName = state.adminHierarchy[country]?.admin1?.[dept]?.name || dept;
            unitName = typeof cleanEncoding === 'function' ? cleanEncoding(dName) : dName;
        } else if (country) {
            const cName = state.adminHierarchy[country]?.name || country;
            unitName = typeof cleanEncoding === 'function' ? cleanEncoding(cName) : cName;
        }

        // 2. MAPEO DE DATOS (Resolución robusta de claves por nivel)
        const mData = muni ? this._resolveDataEntry(stats.by_admin2, muni, country) : null;
        const dData = dept ? this._resolveDataEntry(stats.by_admin1, dept, country) : null;
        const cData = country ? stats.by_country?.[country] : null;

        if (muni && mData) {
            targetData = mData.periods || mData; 
            ecoData = mData.ecosystems || {};
        } else if (dept && dData) {
            targetData = dData.periods || dData;
            ecoData = dData.ecosystems || {};
        } else if (country && cData) {
            targetData = cData.periods || cData;
            ecoData = cData.ecosystems || {};
        } else if (!country && !dept && !muni) {
            // CASO REGIONAL: Usar el objeto regional pre-calculado para consistencia (Reporte vs Dashboard)
            targetData = stats.regional || {};
            
            // Agregación de Ecosistemas para el Listado y Gráfico de Barras
            ecoData = {};
            Object.values(stats.by_country || {}).forEach(cData => {
                const cEcos = cData.ecosystems || {};
                Object.entries(cEcos).forEach(([ecoName, data]) => {
                    const totalLoss = typeof data === 'object' ? (data.total || 0) : data;
                    const periods = typeof data === 'object' ? (data.periods || {}) : {};
                    
                    if (!ecoData[ecoName]) {
                        ecoData[ecoName] = { total: 0, periods: {} };
                    }
                    
                    ecoData[ecoName].total += totalLoss;
                    Object.entries(periods).forEach(([year, val]) => {
                        ecoData[ecoName].periods[year] = (ecoData[ecoName].periods[year] || 0) + val;
                    });
                });
            });
            
            this.log("[SINC] Usando totales regionales pre-calculados (SICA).");
        }

        console.log(`[TEST] Data extraction for ${unitName}: Periods=${Object.keys(targetData).length}, Ecos=${Object.keys(ecoData).length}`);
        
        const totalValue = Object.values(targetData).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0);
        
        // 3. NUEVA SECCIÓN: Impacto Estructural (Pérdida vs Superficie Inicial)
        this.renderStructuralImpact(ecoData, country, dept, muni, totalValue);

        // Actualizar UI Texto
        const unitNameEl = document.getElementById('test-unit-name');
        if (unitNameEl) unitNameEl.innerText = unitName;
        
        if (window.adminAppInstance && typeof window.adminAppInstance.updateContextHeaders === 'function') {
            window.adminAppInstance.updateContextHeaders(unitName);
        }

        const totalEl = document.getElementById('test-total-loss');
        if (totalEl) {
            totalEl.innerText = formatNumber(totalValue) + " ha";
            totalEl.style.color = '#ef4444'; // Rojo para resaltar la importancia
        }
        
        // Sincronizar con el cabezal de "Antiguo" si existe
        const oldTotalEl = document.getElementById('loss-total-ha');
        if (oldTotalEl) oldTotalEl.innerText = formatNumber(totalValue) + " ha";

        // Calcular superficie total de la unidad para porcentajes de impacto
        let totalUnitArea = 0;
        const adminApp = window.adminAppInstance;
        if (adminApp && typeof adminApp.aggregateEcoStats === 'function') {
            const unitStats = adminApp.aggregateEcoStats(country, dept, muni);
            totalUnitArea = unitStats ? unitStats.totalArea : 0;
        }

        this.renderLineChart(targetData);
        this.renderEcoChart(ecoData, totalUnitArea);
        this.renderEcoLossAccordion(ecoData, totalUnitArea);

        // AUTO-CALIBRACIÓN DINÁMICA
        const level = muni ? 2 : (dept ? 1 : (country ? 0.5 : 0));
        this.autoAdjustHeatParams(level);
    }

    renderStructuralImpact(ecoLossData = {}, iso, dept, muni, totalGrandLoss = 0) {
        const container = document.getElementById('test-impact-container');
        if (!container) return;

        const adminApp = window.adminAppInstance;
        if (!adminApp) return;

        // 1. Obtener Superficie Inicial (Baseline 2000)
        let forestInitial = 0, otherInitial = 0;
        const ecoStats = adminApp.aggregateEcoStats(iso, dept, muni);
        
        if (ecoStats && ecoStats.by_eco) {
            Object.values(ecoStats.by_eco).forEach(e => {
                const cat = adminApp.getEcoCategory(e.label);
                if (cat === 'Ecosistemas de Bosques') {
                    forestInitial += e.ha;
                } else if (cat !== 'Zonas Urbanas' && cat !== 'Sistema Agropecuario') {
                    // Solo incluimos otros ecosistemas NATURALES (no agro, no urbano)
                    otherInitial += e.ha;
                }
            });
        }

        // 2. Obtener Pérdida Acumulada por Grupo (ALINEADA CON TOTAL ACUMULADO)
        let forestLoss = 0, otherLoss = 0;
        Object.entries(ecoLossData).forEach(([name, data]) => {
            const loss = typeof data === 'object' ? (data.total || 0) : data;
            const cat = adminApp.getEcoCategory(name);
            if (cat === 'Ecosistemas de Bosques') forestLoss += loss;
            else otherLoss += loss;
        });

        // ALINEACIÓN TÉCNICA: Si la suma de grupos no alcanza el total reportado del cabezal,
        // absorbemos la diferencia en "Otros Ecosistemas" (discrepancia espacial/residual).
        const currentSum = forestLoss + otherLoss;
        if (totalGrandLoss > currentSum) {
            otherLoss += (totalGrandLoss - currentSum);
        }

        const forestPct = forestInitial > 0 ? (forestLoss / forestInitial) * 100 : 0;
        const otherPct = otherInitial > 0 ? (otherLoss / otherInitial) * 100 : 0;

        container.innerHTML = `
            <div class="dash-card" style="padding:15px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.1); border-radius:12px; margin-bottom:15px;">
                <h4 style="margin:0 0 12px 0; font-size:0.65rem; color:#ef4444; text-transform:uppercase; font-weight:800; letter-spacing:0.5px;">Impacto Estructural (Pérdida vs Superficie Inicial)</h4>
                
                <!-- Bosques -->
                <div style="margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                        <span style="font-size:0.55rem; color:#e2e8f0; font-weight:700;">BOSQUES</span>
                        <span style="font-size:0.55rem; color:#94a3b8; font-weight:600;">Total 2000: ${formatNumber(forestInitial)} ha</span>
                    </div>
                    <div style="height:10px; background:rgba(255,255,255,0.05); border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.05);">
                        <div style="width:${forestPct.toFixed(2)}%; height:100%; background:#ef4444; border-radius:10px;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:5px;">
                        <span style="font-size:0.75rem; color:#ef4444; font-weight:800;">${formatNumber(forestLoss)} ha perdidas</span>
                        <span style="font-size:0.75rem; color:#ffffff; font-weight:800;">${forestPct.toFixed(1)}% impacto</span>
                    </div>
                </div>

                <!-- Otros -->
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                        <span style="font-size:0.55rem; color:#e2e8f0; font-weight:700;">OTROS ECOSISTEMAS</span>
                        <span style="font-size:0.55rem; color:#94a3b8; font-weight:600;">Total 2000: ${formatNumber(otherInitial)} ha</span>
                    </div>
                    <div style="height:10px; background:rgba(255,255,255,0.05); border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.05);">
                        <div style="width:${otherPct.toFixed(2)}%; height:100%; background:#94a3b8; border-radius:10px;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:5px;">
                        <span style="font-size:0.75rem; color:#cbd5e1; font-weight:800;">${formatNumber(otherLoss)} ha perdidas</span>
                        <span style="font-size:0.75rem; color:#ffffff; font-weight:800;">${otherPct.toFixed(1)}% impacto</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Genera un listado tipo acordeón con la pérdida histórica por cada ecosistema
     * Incluye mini-gráficas de barras para cada uno.
     */
    renderEcoLossAccordion(ecoData, totalUnitArea = 0) {
        const container = document.getElementById('test-eco-loss-accordion');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!ecoData || Object.keys(ecoData).length === 0) {
            container.innerHTML = '<p style="color:var(--gray); font-size:0.75rem; text-align:center; padding:20px;">No hay datos de pérdida por ecosistema para esta unidad.</p>';
            return;
        }

        // Destroy previous accordion charts to avoid memory leaks and "Canvas in use" errors
        if (!this.accordionCharts) this.accordionCharts = {};
        Object.values(this.accordionCharts).forEach(chart => {
            if (chart) chart.destroy();
        });
        this.accordionCharts = {};

        const sortedEcoNames = Object.keys(ecoData).sort((a, b) => {
            const valA = typeof ecoData[a] === 'object' ? (ecoData[a].total || 0) : ecoData[a];
            const valB = typeof ecoData[b] === 'object' ? (ecoData[b].total || 0) : ecoData[b];
            return valB - valA;
        });

        sortedEcoNames.forEach((ecoName, i) => {
            const dataObj = ecoData[ecoName];
            const totalLoss = typeof dataObj === 'object' ? (dataObj.total || 0) : dataObj;
            const periods = typeof dataObj === 'object' ? (dataObj.periods || {}) : {};
            
            const item = document.createElement('div');
            item.className = 'eco-loss-item';
            item.style.border = '1px solid rgba(255,255,255,0.05)';
            item.style.borderRadius = '8px';
            item.style.marginBottom = '10px';
            item.style.background = 'rgba(0,0,0,0.2)';
            
            const canvasId = `eco-chart-${i}`;
            const percentage = totalUnitArea > 0 ? ((totalLoss / totalUnitArea) * 100).toFixed(2) : 0;
            const safeEcoName = ecoName.replace(/'/g, "\\'");

            // Optimization: Just-in-time chart rendering closure
            const periodsCopy = JSON.parse(JSON.stringify(periods));
            const periodKeys = Object.keys(periodsCopy).sort();

            const renderChartFn = () => {
                if (this.accordionCharts[canvasId]) return;
                const ctx = document.getElementById(canvasId);
                if (!ctx) return;
                
                this.accordionCharts[canvasId] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: periodKeys,
                        datasets: [{
                            label: 'Pérdida (ha)',
                            data: periodKeys.map(k => periodsCopy[k]),
                            backgroundColor: 'rgba(239, 68, 68, 0.8)',
                            borderRadius: 3
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { display: true, beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 8 } } },
                            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 8 } } }
                        }
                    }
                });
            };

            // Attach function to window so the onclick can call it
            window[`render_${canvasId}`] = renderChartFn;

            item.innerHTML = `
                <div class="eco-loss-header" style="padding:10px 12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" 
                     onclick="const detail = this.nextElementSibling; const isOpening = detail.style.display === 'none'; detail.style.display = isOpening ? 'block' : 'none'; if(isOpening) window['render_${canvasId}'](); if(window.adminAppInstance) window.adminAppInstance.isolateEcosystem('${safeEcoName}');">
                    <div style="flex:1;">
                        <p style="margin:0; font-size:0.75rem; font-weight:600; color:#e2e8f0;">${ecoName}</p>
                        <p style="margin:2px 0 0 0; font-size:0.6rem; color:#94a3b8;">Impacto Total: <span style="color:#ef4444; font-weight:bold;">${formatNumber(totalLoss)} ha</span> <span style="color:var(--primary); margin-left:5px; font-weight:600;">(${percentage}%)</span></p>
                    </div>
                    <span style="color:#64748b; font-size:0.8rem;">▾</span>
                </div>
                <div class="eco-loss-detail" style="display:none; padding:10px 12px; border-top:1px solid rgba(255,255,255,0.05);">
                    <div style="height:120px; margin-bottom:10px;">
                        <canvas id="${canvasId}"></canvas>
                    </div>
                    <table style="width:100%; font-size:0.65rem; color:#94a3b8; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                                <th style="text-align:left; padding:4px;">Periodo</th>
                                <th style="text-align:right; padding:4px;">Pérdida (ha)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(periodsCopy).sort().map(([year, val]) => `
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:4px;">${year}</td>
                                     <td style="padding:4px; text-align:right; color:#ef4444; font-weight:600;">${formatNumber(val)} ha</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            container.appendChild(item);
        });
    }

    autoAdjustHeatParams(level) {
        const radInput = document.getElementById('test-heat-radius');
        const maxInput = document.getElementById('test-heat-max');
        const radVal = document.getElementById('test-val-radius');
        const maxVal = document.getElementById('test-val-max');

        let rad, max, label;

        if (level === 2) {
            // NIVEL MUNICIPAL: Micro-difusión y máxima sensibilidad (13px / 0.5)
            rad = 13; max = 0.5; label = "Municipal";
        } else if (level === 1) {
            // NIVEL DEPARTAMENTAL: Difusión equilibrada (15px / 1.0)
            rad = 15; max = 1.0; label = "Departamental";
        } else if (level === 0.5) {
            // NIVEL PAÍS: Difusión amplia y saturación estándar (20px / 2.5)
            rad = 20; max = 2.5; label = "País";
        } else {
            // NIVEL REGIONAL (SICA): Visión macro (10px / 3.5)
            rad = 10; max = 3.5; label = "Regional";
        }

        if (radInput) radInput.value = rad;
        if (maxInput) maxInput.value = max;
        if (radVal) radVal.innerText = `${rad}px`;
        if (maxVal) maxVal.innerText = max.toFixed(1) + ' ha';
        
        this.log(`[AUTO] Calibración ${label}: Radio ${rad}px | Sat ${max}`);

        // Aplicamos los cambios al mapa si la capa existe
        if (coreMap && coreMap.map && window._testHeatLayer) {
            this.toggleHeat(true);
        }
    }


    renderLineChart(data) {
        const ctx = document.getElementById('test-line-chart');
        if (!ctx) return;

        const labels = Object.keys(data).sort();
        const values = labels.map(l => data[l]);

        if (this.charts.trend) this.charts.trend.destroy();

        this.charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Hectáreas',
                    data: values,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: '#ef4444'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: {size: 10} } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: {size: 10} } }
                }
            }
        });
    }

    renderEcoChart(ecoData, totalUnitArea = 0) {
        const ctx = document.getElementById('test-eco-chart');
        if (!ctx) return;

        const sortedKeys = Object.keys(ecoData).sort((a,b) => {
            const valA = typeof ecoData[a] === 'object' ? ecoData[a].total : ecoData[a];
            const valB = typeof ecoData[b] === 'object' ? ecoData[b].total : ecoData[b];
            return valB - valA;
        }).slice(0, 8);
        
        const labels = sortedKeys.map(k => k.length > 30 ? k.substring(0,27) + "..." : k);
        const values = sortedKeys.map(k => typeof ecoData[k] === 'object' ? ecoData[k].total : ecoData[k]);

        if (this.charts.eco) this.charts.eco.destroy();

        if (sortedKeys.length === 0) {
            // No hay datos de ecosistemas para esta unidad
            return;
        }

        this.charts.eco = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: sortedKeys.map(k => getEcoColor(k)),
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                onClick: (evt, elements) => {
                    if (elements && elements.length > 0) {
                        const index = elements[0].index;
                        const fullLabel = sortedKeys[index];
                        if (window.adminAppInstance) {
                            window.adminAppInstance.isolateEcosystem(fullLabel);
                        }
                    }
                },
                plugins: { 
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#10b981',
                        titleFont: { size: 11, weight: 'bold' },
                        bodyColor: '#cbd5e1',
                        bodyFont: { size: 10 },
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            title: (items) => {
                                const idx = items[0].dataIndex;
                                const label = sortedKeys[idx];
                                return window.adminAppInstance?.wrapText(label, 35) || label;
                            },
                            label: (ctx) => {
                                const val = ctx.raw;
                                const pct = totalUnitArea > 0 ? ((val / totalUnitArea) * 100).toFixed(2) : 0;
                                 return [
                                    `Superficie Afectada: ${formatNumber(val)} ha`,
                                    `Impacto: ${pct}% del área total`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: {size: 9} } },
                    y: { ticks: { color: '#f8fafc', font: {size: 9} } }
                }
            }
        });
    }

    toggleHeat(visible) {
        if (!coreMap || !coreMap.map) {
            this.log("[DEBUG] No se encontró el objeto coreMap para el mapa de calor.");
            return;
        }

        // LIMPIEZA ATÓMICA: Antes de remover la capa, intentamos devolver el canvas a su sitio 
        // original si Leaflet va a intentar removerlo por su cuenta.
        if (window._testHeatLayer) {
            try {
                if (window._testHeatLayer._canvas && window._testHeatLayer._canvas.parentNode) {
                    const canvas = window._testHeatLayer._canvas;
                    if (canvas.parentNode && canvas.parentNode.contains(canvas)) {
                        canvas.parentNode.removeChild(canvas);
                    }
                }
                if (coreMap.map.hasLayer(window._testHeatLayer)) {
                    coreMap.map.removeLayer(window._testHeatLayer);
                }
            } catch (e) {
                // Silenced technical error during cleanup
            }
            window._testHeatLayer = null;
        }

        if (visible && this._dataCache.heatmap) {
            const points = this._dataCache.heatmap;
            
            // DETERMINACIÓN DINÁMICA DE CONTROLES (Contexto: Test vs Integrated)
            const prefix = (state.activeTab === 'integrated') ? 'int' : 'test';
            
            const weightType = document.getElementById(`${prefix}-heat-weight`)?.value || 'has';
            
            // CALIBRACIÓN ESTÁNDAR (Lineal Absoluta v3.5)
            const rad = parseInt(document.getElementById(`${prefix}-heat-radius`)?.value || 12);
            const saturationVal = parseFloat(document.getElementById(`${prefix}-heat-max`)?.value || 5.0);
            
            // FILTRO RELACIONAL POR UNIDAD ADMINISTRATIVA
            const adminApp = window.appControllerInstance?.apps['admin'];
            const currentIso = adminApp?.currentIso || 'ALL';
            const currentDept = adminApp?.currentDeptId;
            const currentMuni = adminApp?.currentMuniId;

            const isoFilter = currentIso.trim();
            const maxVisiblePoints = 400000; 
            const density = Math.max(1, Math.floor(points.length / maxVisiblePoints));
            const sample = [];

            for (let i = 0; i < points.length; i += density) {
                const p = points[i];
                if (isoFilter !== 'ALL' && p[3] !== isoFilter) continue;

                // Blindaje de Nomenclatura para Departamentos (Ej: "3" vs "HND-3")
                if (currentDept) {
                    const deptValue = p[4];
                    const compositeKey = `${isoFilter}-${currentDept}`;
                    if (deptValue != currentDept && deptValue !== compositeKey) continue;
                }

                if (currentMuni && p[5] != currentMuni) continue;

                // Usamos el peso bruto (hectáreas) sin ajustes logarítmicos ni locales
                const weight = (weightType === 'has') ? (p[2] || 1) : 1;
                sample.push([p[0], p[1], weight]);
            }

            const unitSample = sample;

            if (unitSample.length > 0) {
                // PRIORIDAD DE CAPA
                if (coreMap && typeof coreMap.setLayerPriority === 'function') {
                    coreMap.setLayerPriority('test');
                }

                window._testHeatLayer = L.heatLayer(unitSample, {
                    radius: rad, 
                    blur: rad * 0.75, // Blur proporcional al radio para suavidad
                    max: saturationVal, 
                    pane: 'heatmapPane',
                    gradient: { 
                        0.2: '#fde047', 
                        0.4: '#fb923c', 
                        0.6: '#f97316', 
                        0.8: '#dc2626', 
                        1.0: '#7f1d1d'  
                    }
                }).addTo(coreMap.map);

                // FORCE PANE: Leaflet.heat ignora la opción 'pane' en su constructor en versiones antiguas.
                if (window._testHeatLayer && window._testHeatLayer._canvas) {
                    const hPane = coreMap.map.getPane('heatmapPane');
                    if (hPane) {
                        hPane.appendChild(window._testHeatLayer._canvas);
                        this.log(`[CORE] Mapa de calor sincronizado en panel Z:${hPane.style.zIndex}`);
                    }
                }
            }
            
            this.log(`[MAPA] Calibración Exclusiva: ${unitSample.length.toLocaleString()} puntos dentro de la unidad.`);
        } else {
            this.log("[MAPA] Calor desactivado.");
        }
    }


    // El histograma ha sido desactivado según requerimiento del usuario

    resetHeatSettings() {
        const adminApp = window.appControllerInstance?.apps['admin'];
        const currentIso = adminApp?.currentIso || 'ALL';
        const currentDept = adminApp?.currentDeptId;
        const currentMuni = adminApp?.currentMuniId;
        
        const prefix = (state.activeTab === 'integrated') ? 'int' : 'test';

        let rad = 12, max = 5.0;

        // Determinación de valores óptimos por nivel
        if (currentIso === 'ALL') {
            rad = 12; max = 5.0; 
            this.log(`[SISTEMA] Restableciendo parámetros (${prefix}) Nivel Regional (12px / 5.0ha)`);
        } else if (currentMuni) {
            rad = 10; max = 0.5;
            this.log(`[SISTEMA] Restableciendo parámetros (${prefix}) Nivel Municipio (10px / 0.5ha)`);
        } else if (currentDept) {
            rad = 15; max = 1.0;
            this.log(`[SISTEMA] Restableciendo parámetros (${prefix}) Nivel Departamento (15px / 1.0ha)`);
        } else {
            rad = 20; max = 2.5; 
            this.log(`[SISTEMA] Restableciendo parámetros (${prefix}) Nivel País (20px / 2.5ha)`);
        }

        const radInput = document.getElementById(`${prefix}-heat-radius`);
        const maxInput = document.getElementById(`${prefix}-heat-max`);
        const radVal = document.getElementById(`${prefix}-val-radius`);
        const maxVal = document.getElementById(`${prefix}-val-max`);

        const unitSuffix = (prefix === 'int') ? '' : ' ha';

        if (radInput) {
            radInput.value = rad;
            if (radVal) radVal.innerText = `${rad}px`;
        }
        if (maxInput) {
            maxInput.value = max.toFixed(1);
            if (maxVal) maxVal.innerText = max.toFixed(1) + unitSuffix;
        }
        
        // Si el mapa de calor está activo, refrescarlo con los nuevos valores
        const toggle = document.getElementById(`${prefix}-heat-toggle`);
        if (toggle && toggle.checked) {
            this.toggleHeat(true);
        }
    }

    refreshMapLayers() {
        this.log("[SISTEMA] Solicitud manual de refresco de capas...");
        const adminApp = window.appControllerInstance?.apps['admin'];
        if (adminApp && typeof adminApp.renderEcosMap === 'function') {
            const currentIso = document.getElementById('admin-country')?.value || '';
            adminApp.renderEcosMap(currentIso).then(() => {
                this.log("[OK] Mapas base regenerados.");
                const heatActive = document.getElementById('test-heat-toggle')?.checked;
                if (heatActive) this.toggleHeat(true);
            });
        }
    }

    log(msg) {
        const area = document.getElementById('test-log');
        if (!area) return;
        
        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.style.marginBottom = '2px';
        entry.textContent = `[${time}] ${msg}`;
        
        area.appendChild(entry);
        
        // Mantener solo los últimos 50 mensajes para no saturar memoria
        if (area.childNodes.length > 50) {
            area.removeChild(area.firstChild);
        }
        
        area.scrollTop = area.scrollHeight;
    }

    // Auditoría UNIVERSAL de todas las capas del mapa Leaflet
    runDeepAudit() {
        if (!coreMap || !coreMap.map) {
            this.log("[ERROR] Mapa no disponible para auditoría.");
            return;
        }
        this.log(">>> [AUDITORÍA FORENSE] ESCANEANDO EL MAPA COMPLETO <<<");
        
        const isTestMode = (state.activeTab === 'test');
        let total = 0;
        let adminFound = 0;

        coreMap.map.eachLayer(layer => {
            total++;
            const id = L.stamp(layer);
            const type = layer.constructor.name;
            const pane = layer.options?.pane || 'default';
            
            // Detect opacity effectively even in minified
            let opacity = 'N/A';
            if (layer.options?.fillOpacity !== undefined) opacity = layer.options.fillOpacity;
            else if (layer.options?.style?.fillOpacity !== undefined) opacity = layer.options.style.fillOpacity;
            
            this.log(`[CAPA ${total}] ID:${id} | Pane:${pane} | Opac:${opacity}`);

            // ACCIÓN RADICAL: If it has setStyle, it's a vector layer. Kill the background.
            // EXCEPCIÓN: No matar la capa de ecosistemas que ahora es el fondo del mapa de calor.
            if (isTestMode && typeof layer.setStyle === 'function' && 
                pane !== 'maskPane' && pane !== 'heatmapPane' && pane !== 'ecosystemPane') {
                adminFound++;
                layer.setStyle({ fillOpacity: 0, opacity: 1 }); 
                this.log(`   -> [AUDIT] Ocultando capa admin ID:${id} (Pane:${pane})`);
            }
        });
        
        this.log(`>>> RESUMEN: ${total} capas en el mapa | ${adminFound} GeoJSON corregidos.`);
        this.log(">>> FIN DE AUDITORÍA <<<");
    }

    runDiagnostic() {
        this.log(":::CLEAR:::");
        this.log("=== INICIANDO ESCANEO DE SISTEMA v2.5 ===");
        
        try {
            const activeTab = state.activeTab;
            this.log(`[STATE] Pestaña: ${activeTab} | ISO: ${state.currentIso}`);
            
            if (!coreMap || !coreMap.map) {
                this.log("[FATAL] CoreMap no disponible.");
                return;
            }

            // 1. Verificar Panes y Z-Index
            const ecosPane = coreMap.map.getPane('ecosystemPane');
            const heatPane = coreMap.map.getPane('heatmapPane');
            const adminPane = coreMap.map.getPane('adminBoundaryPane');

            this.log(`[PANES] Ecos: ${ecosPane ? '✅' : '❌'} | Heat: ${heatPane ? '✅' : '❌'} | Admin: ${adminPane ? '✅' : '❌'}`);
            if (ecosPane && heatPane) {
                this.log(`[Z-INDEX] Ecos: ${ecosPane.style.zIndex} | Heat: ${heatPane.style.zIndex}`);
            }

            // 2. Auditoría de Capas
            let ecosFound = 0;
            let ecosFeatures = 0;
            coreMap.map.eachLayer(layer => {
                if (layer.options?.pane === 'ecosystemPane') {
                    ecosFound++;
                    if (layer.getLayers) ecosFeatures = layer.getLayers().length;
                }
            });

            this.log(`[MAPA] Capas Ecos: ${ecosFound} | Polígonos: ${ecosFeatures}`);
            
            // 3. Auditoría de Propiedades de Ecosistemas (Isolation Sync Check)
            if (coreMap.ecosLayer) {
                let sampleProps = {};
                let count = 0;
                coreMap.ecosLayer.eachLayer(l => {
                    count++;
                    if (Object.keys(sampleProps).length === 0 && l.feature?.properties) {
                        sampleProps = l.feature.properties;
                    }
                });

                this.log(`[SYNC] Polígonos en mapa: ${count}`);
                this.log(`[SYNC] Keys encontradas en mapa: ${Object.keys(sampleProps).join(', ')}`);
                
                const ecoNameKey = sampleProps.NOMBRE || sampleProps.nombre || sampleProps.LEYENDA || sampleProps.ECOSISTEMA || 'DESCONOCIDO';
                const sampleValue = sampleProps[ecoNameKey] || 'N/A';
                this.log(`   -> Ejemplo de valor (${ecoNameKey}): "${sampleValue}"`);
                
                const adminApp = window.appControllerInstance?.apps['admin'];
                if (adminApp && typeof adminApp.normalizeForMatch === 'function') {
                    this.log(`   -> Normalización v2.1: "${adminApp.normalizeForMatch(sampleValue)}"`);
                    this.log(`   -> Target actual: "${adminApp.normalizeForMatch(this._currentIsolatedEco || 'NINGUNO')}"`);
                }
            } else {
                this.log("[SYNC] ❌ Capa ecosLayer NO detectada.");
            }

            // 4. Prueba de Almacenamiento (Tracking Prevention Check)
            try {
                localStorage.setItem('diag_test', 'ok');
                localStorage.removeItem('diag_test');
                this.log("[STORAGE] Acceso a LocalStorage: ✅ OK");
            } catch (e) {
                this.log("[ERROR] Storage bloqueado (Tracking Prevention): ❌");
                this.log("   -> El navegador está restringiendo el acceso a datos locales.");
            }

            this.log("=== ESCANEO FINALIZADO ===");
        } catch (err) {
            this.log(`[CRASH] Error en diagnóstico: ${err.message}`);
        }
    }

    setMapTransparency(isTransparent) {
        const controller = window.appControllerInstance;
        const adminApp = controller?.apps['admin'];
        if (adminApp && typeof adminApp.syncAdminLayersStyle === 'function') {
            adminApp.syncAdminLayersStyle(); 
            this.log(`[MAPA] Ejecutando sincronización de transparencia multinivel...`);
            
            // Re-ejecutar auditoría en 1.5s para confirmar limpieza
            setTimeout(() => this.runDeepAudit(), 1500);
        }
    }

    unmount() {
        this._isMounted = false;
        this.toggleHeat(false);
        this.setMapTransparency(false); // Restaurar colores originales
    }

    onDashTabSwitch(tabId) {
        if (tabId === 'test') {
            this.mount();
        } else {
            if (this._isMounted) this.unmount();
        }
    }
}
