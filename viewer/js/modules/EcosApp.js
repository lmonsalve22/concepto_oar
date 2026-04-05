import { state, fullData } from './Store.js';
const { adminHierarchy } = state;
import { showLoader, getFeatureColor, getEcoColor, normalizeStr, cleanEncoding, createPremiumPopupHTML, formatNumber } from './Utils.js';
import { coreMap } from './CoreMap.js';

export class EcosApp {
    constructor() {
        this.appKey = 'ecosistemas';
        this.ecosPulseInterval = null;
    }

    mount() {
        console.log('Mounting Ecos App');
        document.getElementById('ecos-controls').style.display = 'block';
        document.getElementById('level-container').style.display = 'none';
        
        // Setup Priority and Camera
        coreMap.setLayerPriority('ecosistemas');
        
        // Ensure map resets to regional view if coming from a local admin level without an applied filter
        const ecoName = document.getElementById('ecos-name');
        if (ecoName && ecoName.value === "") {
            coreMap.map.setView([15, -86], 6);
        }

        // Initialize selectors
        this.initEcosSelectors();
        
        // Load heavy data and display
        this.loadAndRenderRegionalEcos();
    }

    unmount() {
        console.log('Unmounting Ecos App');
        document.getElementById('ecos-controls').style.display = 'none';
        if (this.ecosPulseInterval) clearInterval(this.ecosPulseInterval);
        
        // Reset Ecos Control UI strictly
        document.getElementById('ecos-country').value = '';
        const ecoName = document.getElementById('ecos-name');
        if(ecoName) {
            ecoName.innerHTML = '<option value="">Seleccione Ecosistema</option>';
            ecoName.disabled = true;
        }

        coreMap.clearMap();
        document.getElementById('detail-panel').classList.remove('visible');
    }

    resetFilters() {
        showLoader(true);
        const cFilter = document.getElementById('ecos-country');
        const nFilter = document.getElementById('ecos-name');
        
        if (cFilter) cFilter.value = '';
        if (nFilter) {
            nFilter.innerHTML = '<option value="">Todos los Ecosistemas</option>';
            nFilter.disabled = true;
        }

        state.currentEcosMetadata = null;
        state.lastEcoFeatures = null;
        
        document.getElementById('detail-panel').classList.remove('visible');
        
        this.updateEcosView();
        
        if (coreMap.highlightLayer) {
            coreMap.map.removeLayer(coreMap.highlightLayer);
            coreMap.highlightLayer = null;
        }
        
        if (!cFilter?.value && fullData.regionalMaskGeom) coreMap.applyMapMask(fullData.regionalMaskGeom);

        coreMap.map.setView([15, -86], 6);
        showLoader(false);
    }

    initEcosSelectors() {
        const countryFilter = document.getElementById('ecos-country');
        const ecoName = document.getElementById('ecos-name');
        
        // Avoid adding duplicate event listeners if they already exist
        if (!countryFilter || countryFilter.dataset.initialized) return;

        countryFilter.innerHTML = '<option value="">Ver Regional (Mesoamérica)</option>' +
            Object.entries(adminHierarchy).map(([iso, data]) => `<option value="${iso}">${data.name}</option>`).join('');
        
        countryFilter.addEventListener('change', async () => {
            const iso = countryFilter.value;
            ecoName.innerHTML = '<option value="">Seleccione Ecosistema</option>';
            if (!iso) {
                ecoName.disabled = true;
                this.updateEcosView();
                return;
            }
            
            showLoader(true);
            const mapping = fullData.ecosGranularMapping || {};
            const countryMapping = mapping.countries?.[iso] || {};
            const names = Object.keys(countryMapping).sort();
            
            if (names.length > 0) {
                ecoName.innerHTML = '<option value="">Seleccione Ecosistema</option>' + 
                    names.map(n => `<option value="${n}">${n}</option>`).join('');
                ecoName.disabled = false;
            } else {
                ecoName.innerHTML = '<option value="">Sin datos detallados</option>';
                ecoName.disabled = true;
            }
            showLoader(false);
            this.updateEcosView();
        });
        
        ecoName.addEventListener('change', () => this.updateEcosView());
        countryFilter.dataset.initialized = 'true';
    }

    async loadAndRenderRegionalEcos() {
        if (fullData.ecosistemas && fullData.ecosistemas.features && fullData.ecosistemas.features.length > 0) {
            this.renderData(fullData.ecosistemas, false);
            this.updateAccordionLegend(true);
            return;
        }
        
        const mapping = fullData.ecosGranularMapping || {};
        const regionalMap = (mapping.regional && typeof mapping.regional === 'object') ? mapping.regional : {};
        const regionalPaths = Object.values(regionalMap);

        if (regionalPaths.length > 0) {
            showLoader(true);
            const BATCH = 10;
            let allFeatures = [];
            
            for (let i = 0; i < Math.min(regionalPaths.length, 206); i += BATCH) {
                const batch = regionalPaths.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async (path) => {
                    if (typeof path !== 'string' || path.length < 5) return [];
                    try {
                        const res = await fetch(`../web_data/${path}`);
                        if (!res.ok) return [];
                        const g = await res.json();
                        return g.features || [];
                    } catch(e) { return []; }
                }));
                
                results.forEach(feats => allFeatures.push(...feats));
                
                if (i === 0 && allFeatures.length > 0) {
                    this.renderData({ type: 'FeatureCollection', features: allFeatures }, false);
                }
            }
            
            if (allFeatures.length > 0) {
                fullData.ecosistemas = { type: 'FeatureCollection', features: allFeatures };
                this.renderData(fullData.ecosistemas, false);
            }
            showLoader(false);
        } else {
            console.warn('Sin micro-archivos regionales en el mapeo');
        }
        this.updateAccordionLegend(true);
    }

    async updateEcosView() {
        showLoader(true);
        try {
            const iso = document.getElementById('ecos-country').value;
            const ecoName = document.getElementById('ecos-name').value;
            
            if (!iso) {
                await this.loadAndRenderRegionalEcos();
                coreMap.map.setView([15, -86], 6);
                document.getElementById('detail-panel').classList.remove('visible');
                return;
            }

            const mapping = fullData.ecosGranularMapping || {};
            const countryMapping = mapping.countries?.[iso] || {};
            
            // Ensure necessary data is loaded
            if (!fullData.admin.depts || !fullData.admin.depts.features) {
                const res = await fetch(`../web_data/sica_admin1.json`);
                if (res.ok) fullData.admin.depts = await res.json();
            }
            if (!state.adminStats || Object.keys(state.adminStats).length === 0) {
                const res = await fetch(`../web_data/admin_stats.json`);
                if (res.ok) {
                    const stats = await res.json();
                    Object.assign(state.adminStats, stats);
                }
            }

            if (ecoName && countryMapping[ecoName]) {
                // SPECIFIC ECOSYSTEM MODE
                const pathsRaw = countryMapping[ecoName];
                const paths = Array.isArray(pathsRaw) ? pathsRaw : [pathsRaw];
                let allFeatures = [];
                for (const path of paths) {
                    try {
                        const res = await fetch(`../web_data/${path}`);
                        if (res.ok) {
                            const data = await res.json();
                            allFeatures.push(...(data.features || []));
                        }
                    } catch(e) { console.error(`Failed to load granular path: ${path}`, e); }
                }

                if (allFeatures.length > 0) {
                    const featCollection = { type: 'FeatureCollection', features: allFeatures };
                    state.lastEcoFeatures = allFeatures;
                    state.lastEcoIso = iso;
                    state.lastEcoNameRaw = ecoName;

                    this.renderData(featCollection, true);

                    if (fullData.admin.paises) {
                        const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                        if (countryFeat) coreMap.applyMapMask(countryFeat);
                    }

                    // Calculate stats
                    let totalHa = 0;
                    const deptMap = {};
                    const adminFeats = fullData.admin.depts?.features || [];
                    const countryAdminFeats = adminFeats.filter(f => f.properties.Pais_cod3 === iso);
                    
                    if (state.adminStats?.admin1?.ecos) {
                        const ecoDepts = state.adminStats.admin1.ecos;
                        countryAdminFeats.forEach(f => {
                            const id = String(f.properties.Admin1_id);
                            const ecos = ecoDepts[id];
                            if (ecos) {
                                const match = ecos.find(e => e.label === ecoName);
                                if (match) {
                                    deptMap[id] = match.ha;
                                }
                            }
                        });
                    }

                    // Fallback to spatial calculation if stats not found
                    if (Object.keys(deptMap).length === 0) {
                        allFeatures.forEach(f => {
                            const p = f.properties;
                            const ha = p.area_ha || (p.ha_calculada) || (turf.area(f) / 10000);
                            const dId = p.Admin1_id || p.IDRegDepto;
                            if (dId) deptMap[dId] = (deptMap[dId] || 0) + ha;
                        });
                    }

                    const muniList = [];
                    allFeatures.forEach(f => {
                        const p = f.properties;
                        let ha = p.area_ha || p.ha_calculada;
                        if (ha === undefined || ha === null) {
                            try { ha = turf.area(f) / 10000; } catch(e) { ha = 0; }
                        }
                        totalHa += ha;
                        if ((p.IDRegMunic || p.admin2_id) && (p.Admin2name || p.admin2_nom)) {
                            const mId = p.IDRegMunic || p.admin2_id;
                            const mName = p.Admin2name || p.admin2_nom;
                            const existing = muniList.find(m => String(m.id) === String(mId));
                            if (existing) existing.ha += ha;
                            else muniList.push({ id: mId, name: mName, ha: ha });
                        }
                    });

                    // Resolve names for deptMap
                    const resolvedDeptMap = {};
                    Object.entries(deptMap).forEach(([id, ha]) => {
                        const feat = countryAdminFeats.find(f => String(f.properties.Admin1_id) === String(id) || f.properties.Admin1name === id);
                        const name = feat ? (feat.properties.Admin1name || feat.properties.Admin1_nom) : id;
                        resolvedDeptMap[name] = ha;
                    });

                    state.currentEcosMetadata = {
                        iso: iso, ecoName: ecoName, areaHa: totalHa,
                        deptLabels: Object.keys(resolvedDeptMap).sort((a,b)=>resolvedDeptMap[b]-resolvedDeptMap[a]).slice(0,8),
                        deptValues: Object.keys(resolvedDeptMap).sort((a,b)=>resolvedDeptMap[b]-resolvedDeptMap[a]).slice(0,8).map(k=>resolvedDeptMap[k]),
                        muniLabels: muniList.sort((a,b)=>b.ha-a.ha).slice(0,10).map(m=>m.name),
                        muniValues: muniList.sort((a,b)=>b.ha-a.ha).slice(0,10).map(m=>m.ha),
                        deptMap: deptMap
                    };

                    this.updateDetailPanel(iso, ecoName, totalHa, resolvedDeptMap);
                    this.updatePAsInEcos(iso, ecoName);
                    this.updateAdminLimitsList(deptMap, iso, totalHa);

                    setTimeout(() => {
                        this.renderEcosCharts(state.currentEcosMetadata);
                        if (window.switchDashTab) window.switchDashTab('info');
                    }, 100);
                }
                // Clear Dashboard and set loading state
                const content = document.getElementById('info-content');
                if (content) content.innerHTML = '<div style="padding:20px; color:var(--gray);">Sincronizando información de país...</div>';
                document.getElementById('detail-panel').classList.add('visible');

                // FOCUS COUNTRY MODE
                if (iso && fullData.admin.paises) {
                    const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                    if (countryFeat) {
                        try {
                            coreMap.map.fitBounds(L.geoJSON(countryFeat).getBounds(), state.mapPadding);
                        } catch(err) {
                            console.warn("fitBounds failed", err);
                            coreMap.map.setView([15, -86], 6);
                        }
                        coreMap.applyMapMask(countryFeat);
                    }
                }

                let totalHa = 0;
                const ecoStats = {};
                const deptMap = {};

                if (state.adminStats?.paises?.[iso]) {
                    state.adminStats.paises[iso].forEach(d => {
                        const ha = d.ha || 0;
                        totalHa += ha;
                        deptMap[d.label] = (deptMap[d.label] || 0) + ha;
                    });
                }

                if (state.adminStats?.admin1?.ecos) {
                   const admin1Feats = fullData.admin.depts?.features?.filter(f => f.properties.Pais_cod3 === iso) || [];
                   admin1Feats.forEach(f => {
                       const id = String(f.properties.Admin1_id);
                       const ecos = state.adminStats.admin1.ecos[id];
                       if (ecos) {
                           ecos.forEach(e => {
                               ecoStats[e.label] = (ecoStats[e.label] || 0) + e.ha;
                           });
                       }
                   });
                }

                const countryName = adminHierarchy[iso]?.name || iso;
                this.updateDetailPanel(iso, `Resumen Nacional: ${countryName}`, totalHa, deptMap, true);
                this.updatePAsInEcos(iso);
                this.updateAdminLimitsList(deptMap, iso, totalHa);

                state.currentEcosMetadata = {
                    iso: iso, ecoName: `Resumen: ${countryName}`, areaHa: totalHa,
                    deptLabels: Object.keys(ecoStats).sort((a,b)=>ecoStats[b]-ecoStats[a]).slice(0,8),
                    deptValues: Object.keys(ecoStats).sort((a,b)=>ecoStats[b]-ecoStats[a]).slice(0,8).map(k=>ecoStats[k]),
                    deptMap: deptMap
                };

                setTimeout(() => {
                    this.renderEcosCharts(state.currentEcosMetadata);
                    if (window.switchDashTab) window.switchDashTab('info');
                }, 150);
            }
        } catch (error) {
            console.error("Error in updateEcosView:", error);
        } finally {
            showLoader(false);
            this.updateAccordionLegend(true);
        }
    }

    renderData(geojson, fitBounds) {
        if (coreMap.ecosLayer) coreMap.map.removeLayer(coreMap.ecosLayer);
        
        coreMap.ecosLayer = L.geoJSON(geojson, {
            pane: 'ecosystemPane',
            style: (f) => ({
                color: getFeatureColor(f.properties),
                weight: 1,
                fillOpacity: 0.8,
                fillColor: getFeatureColor(f.properties)
            }),
            onEachFeature: (f, l) => {
                const p = f.properties;
                const label = p.nombre || p.LEYENDA || p.NOMBRE || 'Unidad';
                const popupHtml = createPremiumPopupHTML({
                    title: cleanEncoding(label),
                    subtitle: 'Ecosistema',
                    badge: p.Pais_cod3 || p.pais_cod3 || p.iso3 || p.Pais || '',
                    themeColor: '#10b981',
                    bodyHTML: `
                        <div style="padding-top:8px; display:flex; flex-direction:column; gap:8px;">
                            <div style="display:flex; justify-content:space-between; gap:15px; font-size:0.7rem;">
                                <span style="color:var(--gray); font-weight:600;">Unidad:</span>
                                <span style="color:#fff; font-weight:600;">${p.pais || p.Pais_es || 'Centroamérica'}</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; gap:15px; font-size:0.7rem;">
                                <span style="color:var(--gray); font-weight:600;">Código UNESCO:</span>
                                <span style="color:#fff;">${p.UNESCO || p.unesco || 'N/A'}</span>
                            </div>
                        </div>
                    `
                });
                l.bindPopup(popupHtml, { className: 'premium-popup-wrap' });
                l.on({
                    mouseover: (e) => {
                        const layer = e.target;
                        layer.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 0.9 });
                        coreMap.map.getContainer().style.cursor = 'pointer';
                    },
                    mouseout: (e) => {
                        if (coreMap.ecosLayer) coreMap.ecosLayer.resetStyle(e.target);
                        coreMap.map.getContainer().style.cursor = '';
                    },
                    click: (e) => {
                        const iso = (p.PAIS_COD3 || p.pais_cod3 || p.iso3 || p.Pais_cod3 || p.pais || '').toUpperCase();
                        const name = p.nombre || p.LEYENDA || p.NOMBRE || p.nombre_eco;
                        
                        if (iso && name) {
                            const countrySelect = document.getElementById('ecos-country');
                            if (countrySelect) {
                                countrySelect.value = iso;
                                countrySelect.dispatchEvent(new Event('change'));
                                
                                setTimeout(() => {
                                    const ecoNameSelect = document.getElementById('ecos-name');
                                    if (ecoNameSelect) {
                                        ecoNameSelect.value = name;
                                        if (ecoNameSelect.value !== name) {
                                            const normTarget = normalizeStr(name);
                                            for (let opt of ecoNameSelect.options) {
                                                if (normalizeStr(opt.value) === normTarget || normalizeStr(opt.text) === normTarget) {
                                                    ecoNameSelect.value = opt.value;
                                                    break;
                                                }
                                            }
                                        }
                                        this.updateEcosView();
                                    }
                                }, 300);
                            }
                        }
                    }
                });
            }
        }).addTo(coreMap.map);

        if (fitBounds && geojson.features && geojson.features.length > 0) {
            coreMap.map.fitBounds(coreMap.ecosLayer.getBounds(), state.mapPadding);
        }
    }

    updateAccordionLegend(visibleOnly = true) {
        const legendBody = document.getElementById('legend-body');
        if (!legendBody) return;
        
        const bounds = coreMap.map.getBounds();
        const counts = {};
        
        const layers = coreMap.ecosLayer ? coreMap.ecosLayer.getLayers() : [];
        layers.forEach(layer => {
            if (visibleOnly && layer.getBounds && !bounds.intersects(layer.getBounds())) return;
            const p = layer.feature.properties;
            const label = p.NOMBRE || p.LEYENDA || 'Sin clasificar';
            counts[label] = (counts[label] || 0) + 1;
        });
        
        if (Object.keys(counts).length === 0) {
            legendBody.innerHTML = '<div style="padding:10px; color:var(--gray); text-align:center; font-size:0.8rem;">No hay elementos visibles.</div>';
            return;
        }
        
        legendBody.innerHTML = Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([label, count]) => {
            const color = getEcoColor(label);
            return `
                <div class="legend-row" style="cursor:default;" onmouseover="window.ecosAppInstance.highlightEcoInPA('${label.replace(/'/g, "\\'")}')" onmouseout="if(coreMap.ecosLayer) coreMap.ecosLayer.resetStyle()">
                    <div class="legend-color" style="background:${color};"></div>
                    <div class="legend-label" style="font-size:0.75rem;">${cleanEncoding(label)}</div>
                </div>`;
        }).join('');
    }

    updateDetailPanel(iso, ecoName, totalHa, deptMap, isCountryMode = false) {
        const panel = document.getElementById('detail-panel');
        const content = document.getElementById('info-content');
        
        let subTitle = isCountryMode ? 'Evaluación Nacional' : 'Análisis de Ecosistema';
        const countryName = adminHierarchy[iso]?.name || iso;

        document.getElementById('app-subtitle').innerText = isCountryMode ? `Mapa de ${countryName}` : `Ecosistema: ${ecoName}`;

        let extraStat = '';
        if (isCountryMode && state.adminStats?.paises?.[iso]) {
            const countryTotalHa = state.adminStats.paises[iso].reduce((acc, d) => acc + d.ha, 0);
            const pct = ((totalHa / (countryTotalHa || 1)) * 100).toFixed(1);
            extraStat = `
                <div class="stat-card">
                    <span class="stat-value">${pct}%</span>
                    <span class="stat-label">Cobertura País</span>
                </div>`;
        } else if (!isCountryMode && totalHa > 0) {
           const countryData = state.adminStats?.paises?.[iso];
           if (countryData) {
               const countryTotalHa = countryData.reduce((acc, d) => acc + d.ha, 0);
               const pct = ((totalHa / (countryTotalHa || 1)) * 100).toFixed(2);
               extraStat = `
                <div class="stat-card">
                    <span class="stat-value">${pct}%</span>
                    <span class="stat-label">Área del País</span>
                </div>`;
           }
        }

        content.innerHTML = `
            <div class="detail-header">
                <p class="detail-label">${subTitle}</p>
                <h2 class="detail-title">${cleanEncoding(ecoName)}</h2>
                <div class="detail-badge">${countryName} (${iso})</div>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-value">${formatNumber(totalHa)}</span>
                    <span class="stat-label">Hectáreas Totales</span>
                </div>
                ${extraStat}
            </div>
            
            <div class="chart-section pa-detail-vertical">
                <div class="pa-chart-block">
                    <p class="chart-title">${isCountryMode ? 'Ecosistemas Predominantes' : 'Distribución por Departamento'}</p>
                    <div class="chart-container"><canvas id="deptChart"></canvas></div>
                </div>
                ${!isCountryMode ? `
                <div class="pa-chart-block">
                    <p class="chart-title">Top Municipios (Ha)</p>
                    <div class="chart-container"><canvas id="muniChart"></canvas></div>
                </div>` : ''}
            </div>

            <div class="admin-section-header">
                <p class="detail-label" style="margin:0;">Distribución Administrativa</p>
            </div>
            <div id="admin-summary" style="margin-top:10px;">
                ${this.buildAdminAccordion(iso, deptMap, totalHa)}
            </div>`;

        panel.classList.add('visible');
    }

    buildAdminAccordion(iso, deptMap, totalHa) {
        const hierarchy = adminHierarchy[iso];
        if (!hierarchy || !hierarchy.admin1) return '<div style="padding:15px; color:var(--gray); font-size:0.8rem;">Sin datos administrativos.</div>';

        const relevantDepts = Object.entries(deptMap)
            .map(([id, ha]) => {
                const deptData = hierarchy.admin1[id] || Object.values(hierarchy.admin1).find(d => d.name === id);
                return { id, ha, name: deptData ? deptData.name : id, data: deptData };
            })
            .sort((a, b) => b.ha - a.ha);

        if (relevantDepts.length === 0) return '<div style="padding:15px; color:var(--gray); font-size:0.8rem;">No hay registros espaciales.</div>';

        let html = '<div style="margin-top:10px;">';
        relevantDepts.forEach(dept => {
            const safeTotal = totalHa || 1;
            const deptPct = ((dept.ha / safeTotal) * 100).toFixed(1);
            
            const munis = state.lastEcoFeatures?.filter(f => {
                 const p = f.properties;
                 const dId = p.Admin1_id || p.IDRegDepto || p.Admin1name || p.Admin1_nom;
                 return String(dId) === String(dept.id);
            }) || [];

            const muniGroups = {};
            munis.forEach(m => {
                const p = m.properties;
                const mName = p.Admin2name || p.Admin2_nom || p.IDRegMunic || p.admin2_id;
                const mId = p.IDRegMunic || p.admin2_id;
                let ha = p.area_ha || p.ha_calculada || (turf.area(m) / 10000);
                if (!muniGroups[mName]) muniGroups[mName] = { ha: 0, id: mId };
                muniGroups[mName].ha += ha;
            });

            const sortedMunis = Object.entries(muniGroups).sort((a,b) => b[1].ha - a[1].ha);

            html += `
                <div class="accordion-item" style="border:1px solid var(--border); border-radius:10px; margin-bottom:8px; overflow:hidden; background:rgba(255,255,255,0.02);">
                    <div class="accordion-header" style="padding:12px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column; gap:2px; cursor:pointer;" onclick="window.ecosAppInstance.zoomToAdminUnit('${dept.id}', '${iso}')">
                            <span style="font-size:0.85rem; font-weight:600; color:var(--text);">${cleanEncoding(dept.name)} <span style="color:var(--primary); font-size:0.75rem;">(${deptPct}%)</span></span>
                            <span style="font-size:0.7rem; color:var(--gray);">${formatNumber(dept.ha)} Ha</span>
                        </div>
                        <span class="acc-arrow" style="color:var(--primary); transition:transform 0.2s; cursor:pointer;" 
                               onclick="const content=this.closest('.accordion-header').nextElementSibling; content.classList.toggle('visible'); this.style.transform = content.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)'">▶</span>
                    </div>
                    <div class="accordion-content dash-content" style="padding:0; max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.15);">
                        <div style="padding:8px 12px;">
                            ${sortedMunis.map(([mName, mData]) => {
                                const mPct = ((mData.ha / dept.ha) * 100).toFixed(1);
                                return `
                                <div class="dash-row" style="padding:6px 0; font-size:0.75rem; border-bottom:1px solid rgba(255,255,255,0.03);" 
                                     onclick="window.ecosAppInstance.zoomToAdminUnit('${mData.id}', '${iso}', 2)">
                                    <div class="dash-name">${cleanEncoding(mName)} <span style="color:var(--secondary); font-size:0.65rem;">(${mPct}%)</span></div>
                                    <div class="dash-value" style="color:var(--gray);">${formatNumber(mData.ha || 0)} Ha</div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
        return html;
    }

    async updatePAsInEcos(iso, ecoName = null) {
        const listContainer = document.getElementById('pas-list');
        if (!listContainer) return;

        if (!fullData.paStats) {
            try {
                const res = await fetch(`../web_data/pa_granular_stats.json`);
                if (res.ok) fullData.paStats = await res.json();
            } catch(e) {}
        }

        const pas = fullData.paStats?.pas || {};
        const filteredPAs = Object.entries(pas).filter(([name, data]) => {
            if (data.iso3 !== iso) return false;
            return !ecoName || (data.ecos && data.ecos[ecoName]);
        }).sort((a, b) => b[1].area_ha - a[1].area_ha);

        if (filteredPAs.length === 0) {
            listContainer.innerHTML = '<p style="padding:10px; color:var(--gray);">No se encontraron áreas protegidas.</p>';
            return;
        }

        listContainer.innerHTML = filteredPAs.slice(0, 30).map(([name, data]) => {
            const ha = ecoName ? (data.ecos[ecoName] || 0) : data.area_ha;
            return `
                <div class="stat-row" style="border-left: 3px solid var(--accent);">
                    <div class="stat-info">
                        <span class="stat-name">${cleanEncoding(name)}</span>
                        <span class="stat-category">${data.category || 'Área Protegida'}</span>
                    </div>
                    <div class="stat-data">
                        <span class="stat-count">${ha.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                        <span class="stat-unit">Ha</span>
                    </div>
                </div>`;
        }).join('');
    }

    renderEcosCharts(stats) {
        if (!stats) return;
        coreMap.destroyCharts();
        
        const ctxDept = document.getElementById('deptChart')?.getContext('2d');
        if (ctxDept && stats.deptLabels && stats.deptLabels.length) {
            coreMap.ecoChartInstance = new Chart(ctxDept, {
                type: 'doughnut',
                data: {
                    labels: stats.deptLabels.map(l => cleanEncoding(l)),
                    datasets: [{
                        data: stats.deptValues,
                        backgroundColor: stats.deptLabels.map((d, i) => `hsl(${i*40}, 70%, 50%)`),
                        borderWidth: 0
                    }]
                },
                options: { 
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 9 } } } }
                }
            });
        }

        const ctxMuni = document.getElementById('muniChart')?.getContext('2d');
        if (ctxMuni && stats.muniLabels && stats.muniLabels.length) {
            coreMap.paMuniChartInstance = new Chart(ctxMuni, {
                type: 'bar',
                data: {
                    labels: stats.muniLabels.map(l => cleanEncoding(l)),
                    datasets: [{
                        label: 'Ha',
                        data: stats.muniValues,
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        borderColor: '#3b82f6',
                        borderWidth: 1
                    }]
                },
                options: { 
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 8 } } },
                        y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 8 } } }
                    }
                }
            });
        }
    }

    highlightEcoInPA(label) {
        if (!coreMap.ecosLayer) return;
        const norm = normalizeStr(label);
        coreMap.ecosLayer.eachLayer(l => {
            const p = l.feature.properties;
            const match = normalizeStr(p.NOMBRE || p.LEYENDA) === norm;
            l.setStyle({
                fillOpacity: match ? 0.9 : 0.1,
                weight: match ? 2.5 : 1,
                color: match ? '#ffffff' : getFeatureColor(p)
            });
        });
    }

    async updateAdminLimitsList(deptMap, iso, totalHa) {
        const listContainer = document.getElementById('ecos-list');
        if (!listContainer) return;
        
        const resolvedDepts = [];
        const adminFeats = (fullData.admin.depts?.features || []).filter(f => f.properties.Pais_cod3 === iso);
        
        for (const [key, ha] of Object.entries(deptMap || {})) {
            const feat = adminFeats.find(f => 
                String(f.properties.Admin1_id) === String(key) || 
                f.properties.Admin1name === key || 
                f.properties.Admin1_nom === key
            );
            
            if (feat) {
                const name = cleanEncoding(feat.properties.Admin1name || feat.properties.Admin1_nom);
                resolvedDepts.push({ name, ha, id: key });
            }
        }

        const sortedDepts = resolvedDepts.sort((a,b)=>b.ha-a.ha);
        if (sortedDepts.length === 0) {
            listContainer.innerHTML = '<p style="padding:10px; color:var(--gray);">No hay unidades administrativas detectadas.</p>';
            return;
        }

        listContainer.innerHTML = sortedDepts.map(d => {
            const pct = (((d.ha || 0) / (totalHa || 1)) * 100).toFixed(1);
            return `
                <div class="stat-row" onclick="window.ecosAppInstance.zoomToAdminUnit('${d.id}', '${iso}')" style="cursor:pointer; border-left: 3px solid #64748b;">
                    <div class="stat-info">
                        <span class="stat-name">${d.name}</span>
                        <span class="stat-category">Departamento</span>
                    </div>
                    <div class="stat-data">
                        <div class="stat-count">
                            ${(d.ha || 0).toLocaleString(undefined, {maximumFractionDigits:0})} 
                            <span class="stat-percentage" style="color:var(--primary); font-weight:600; font-size:0.8rem; margin-left: 5px;">(${pct}%)</span>
                        </div>
                        <span class="stat-unit">Ha</span>
                    </div>
                </div>`;
        }).join('');
    }

    async zoomToAdminUnit(target, iso, level = 1) {
        const cacheKey = level === 1 ? 'depts' : 'muni';
        const filename = level === 1 ? 'sica_admin1.json' : 'sica_admin2.json';

        if (!fullData.admin[cacheKey] || !fullData.admin[cacheKey].features) {
            const res = await fetch(`../web_data/${filename}`);
            if (res.ok) fullData.admin[cacheKey] = await res.json();
            else return;
        }

        const feat = fullData.admin[cacheKey].features.find(f => {
            const p = f.properties;
            const matchId = level === 1 ? 
                (String(p.Admin1_id) === String(target) || p.Admin1name === target || p.Admin1_nom === target) :
                (String(p.Admin2_id) === String(target) || String(p.IDRegMunic) === String(target) || p.Admin2name === target || p.Admin2_nom === target);
            return matchId && p.Pais_cod3 === iso;
        });

        if (feat) {
            if (coreMap.highlightLayer) coreMap.map.removeLayer(coreMap.highlightLayer);
            coreMap.highlightLayer = L.geoJSON(feat, {
                pane: 'selectionPane',
                style: { color: '#ffffff', weight: 2.5, dashArray: '8, 8', fillOpacity: 0.1, fillColor: '#ffffff' }
            }).addTo(coreMap.map);
            coreMap.map.fitBounds(coreMap.highlightLayer.getBounds(), { ...state.mapPadding, maxZoom: level === 1 ? 10 : 12 });
            const name = level === 1 ? (feat.properties.Admin1name || feat.properties.Admin1_nom) : (feat.properties.Admin2name || feat.properties.Admin2_nom);
            coreMap.highlightLayer.bindPopup(createPremiumPopupHTML({
                title: cleanEncoding(name),
                subtitle: level === 1 ? 'Departamento' : 'Municipio',
                themeColor: '#3b82f6'
            }), { className: 'premium-popup-wrap' });
        }
    }

    onDashTabSwitch(tabId) {
        document.getElementById('tab-ecos').innerText = 'Límites Admin';
        document.getElementById('tab-pas').innerText = 'Áreas Protegidas';
    }
}
