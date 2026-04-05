import { state, fullData } from './Store.js';
import { showLoader, getFeatureColor, cleanEncoding, createPopupTable, getEcoColor, normalizeStr, createPremiumPopupHTML, formatNumber } from './Utils.js';
import { coreMap } from './CoreMap.js';

export class AdminApp {
    constructor() {
        this.appKey = 'admin';
        this._isUpdating = false;
        this.selectionBounds = null; // ATOMIC SYNC: Explicit boundaries for heatmap
        this.currentIso = 'ALL';
        this.currentDeptId = null;
        this.currentMuniId = null;
    }

    mount() {
        console.log('Mounting Admin App');
        window.adminAppInstance = this; // Global link for accordion clicks
        document.getElementById('admin-controls').style.display = 'block';
        document.getElementById('level-container').style.display = 'none';
        coreMap.setLayerPriority('admin');
        this.paNormalizedMap = null;
        this.currentIntegratedSubTab = 'relative';
        this.conservationTarget = 30;
        
        // Register map click listener (handleMapClick) only once
        if (coreMap.map && !coreMap.map._adminClickRegistered) {
            coreMap.map.on('click', (e) => this.handleMapClick(e));
            coreMap.map._adminClickRegistered = true;
        }

        this.initAdminSelectors();
        const cFilter = document.getElementById('admin-country');
        if (cFilter) this.updateSelectorLabels(cFilter.value);
        
        this.updateAdminView();
    }

    initAdminSelectors() {
        const cFilter = document.getElementById('admin-country');
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');
        
        if (!cFilter || cFilter.dataset.initialized) return;

        cFilter.innerHTML = '<option value="">Todos los Países</option>' +
            Object.entries(state.adminHierarchy || {})
                .filter(([iso]) => iso !== 'MEX')
                .map(([iso, data]) => `<option value="${iso}">${data.name}</option>`).join('');

        cFilter.addEventListener('change', () => { 
            this.updateSelectorLabels(cFilter.value);
            this.updateDepts(); 
            this.updateAdminView(); 
        });

        dFilter.addEventListener('change', () => {
            this.updateMunis();
            if (dFilter.value) {
                this.highlightAdminUnit(cFilter.value, 1, dFilter.value);
            } else {
                this.updateAdminView();
            }
        });

        mFilter.addEventListener('change', () => {
            if (mFilter.value) {
                this.highlightAdminUnit(cFilter.value, 2, mFilter.value);
            } else if (dFilter.value) {
                this.highlightAdminUnit(cFilter.value, 1, dFilter.value);
            }
        });

        cFilter.dataset.initialized = 'true';
    }

    updateSelectorLabels(iso) {
        const hierarchy = state.adminHierarchy[iso];
        const n1Type = hierarchy ? hierarchy.admin1_type : 'Nivel 1 (Deptos, Provincias, Distritos)';
        let n2Type = hierarchy ? hierarchy.admin2_type : 'Nivel 2 (Munis, Cantones, Distritos)';
        
        // Local override for CRI
        if (iso === 'CRI' && n2Type === 'Municipio') n2Type = 'Cantón';

        const lbl1 = document.getElementById('label-admin1');
        const lbl2 = document.getElementById('label-admin2');
        if (lbl1) lbl1.innerText = `${cleanEncoding(n1Type)} (N1)`;
        if (lbl2) lbl2.innerText = `${cleanEncoding(n2Type)} (N2)`;
        
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');
        if (dFilter && dFilter.options[0]) dFilter.options[0].text = `Seleccione ${cleanEncoding(n1Type)}`;
        if (mFilter && mFilter.options[0]) mFilter.options[0].text = `Seleccione ${cleanEncoding(n2Type)}`;
    }

    updateDepts() {
        const cFilter = document.getElementById('admin-country');
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');
        if (!cFilter || !dFilter) return;

        const iso = cFilter.value;
        const hierarchy = state.adminHierarchy[iso];
        const n1Type = hierarchy?.admin1_type || 'Unidad (N1)';
        const n2Type = hierarchy?.admin2_type || 'Unidad (N2)';

        dFilter.innerHTML = `<option value="">Seleccione ${cleanEncoding(n1Type)}</option>`;
        mFilter.innerHTML = `<option value="">Seleccione ${cleanEncoding(n2Type)}</option>`;
        mFilter.disabled = true;

        if (!iso) {
            dFilter.disabled = true;
            return;
        }

        const depts = state.adminHierarchy[iso]?.admin1 || {};
        Object.entries(depts).sort((a,b) => a[1].name.localeCompare(b[1].name)).forEach(([id, data]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.innerText = cleanEncoding(data.name);
            dFilter.appendChild(opt);
        });
        dFilter.disabled = false;
    }

    updateMunis() {
        const cFilter = document.getElementById('admin-country');
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');
        if (!cFilter || !dFilter || !mFilter) return;

        const iso = cFilter.value;
        const deptId = dFilter.value;
        const hierarchy = state.adminHierarchy[iso];
        const n2Type = hierarchy?.admin2_type || 'Unidad (N2)';

        mFilter.innerHTML = `<option value="">Seleccione ${cleanEncoding(n2Type)}</option>`;

        if (!deptId) {
            mFilter.disabled = true;
            return;
        }

        const munis = state.adminHierarchy[iso]?.admin1[deptId]?.admin2 || {};
        Object.entries(munis).sort((a,b) => a[1].localeCompare(b[1])).forEach(([id, name]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.innerText = cleanEncoding(name);
            mFilter.appendChild(opt);
        });
        mFilter.disabled = false;
    }

    unmount() {
        console.log('Unmounting Admin App');
        document.getElementById('admin-controls').style.display = 'none';
        coreMap.clearMap();
        coreMap.map.closePopup();
    }

    async updateAdminView() {
        if (this._isUpdating) return;
        this._isUpdating = true;
        showLoader(true);
        try {
            const countryFilter = document.getElementById('admin-country');
            const iso = countryFilter ? countryFilter.value : '';
            
            this.updateSelectorLabels(iso);
            this.updateDepts(); // sync depts with current iso
            
            // Clear Dashboard and set instruction state immediately
            const content = document.getElementById('info-content');
            if (content) {
                content.innerHTML = `
                <div style="padding:15px; background:rgba(16,185,129,0.05); border-radius:12px; border:1px solid rgba(16,185,129,0.1); margin-bottom:20px;">
                    <h3 style="margin:0 0 10px 0; font-size:1rem; color:#10b981; font-weight:700;">Guía de Análisis Geoespacial</h3>
                    <p style="margin:0; font-size:0.8rem; color:var(--gray); line-height:1.4;">
                        Bienvenido a la plataforma de monitoreo de Centroamérica. Siga estos pasos para realizar su análisis:
                    </p>
                </div>
                
                <div class="stats-list" style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <span style="background:var(--primary); color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.75rem; font-weight:bold;">1</span>
                        <div>
                            <strong style="display:block; font-size:0.85rem; color:var(--text); margin-bottom:2px;">Selección de Ámbito</strong>
                            <span style="font-size:0.75rem; color:var(--gray);">Use el panel izquierdo para seleccionar un <b>País</b> y activar el zoom automático.</span>
                        </div>
                    </div>
                    
                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <span style="background:rgba(255,255,255,0.1); color:var(--gray); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.75rem; font-weight:bold;">2</span>
                        <div>
                            <strong style="display:block; font-size:0.85rem; color:var(--text); margin-bottom:2px;">Niveles Administrativos</strong>
                            <span style="font-size:0.75rem; color:var(--gray);">Puede profundizar filtrando por <b>Departamento</b> o <b>Municipio</b> para obtener datos localizados.</span>
                        </div>
                    </div>

                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <span style="background:rgba(255,255,255,0.1); color:var(--gray); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.75rem; font-weight:bold;">3</span>
                        <div>
                            <strong style="display:block; font-size:0.85rem; color:var(--text); margin-bottom:2px;">Exploración Temática</strong>
                            <span style="font-size:0.75rem; color:var(--gray);">Cambie entre las pestañas superiores para analizar <b>Ecosistemas</b> o el estatus de <b>Áreas Protegidas</b>.</span>
                        </div>
                    </div>

                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <span style="background:rgba(255,255,255,0.1); color:var(--gray); width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.75rem; font-weight:bold;">4</span>
                        <div>
                            <strong style="display:block; font-size:0.85rem; color:var(--text); margin-bottom:2px;">Interactúe con el Mapa</strong>
                            <span style="font-size:0.75rem; color:var(--gray);">Haga clic en cualquier polígono del mapa para ver detalles específicos y reportes instantáneos.</span>
                        </div>
                    </div>
                </div>
                `;
            }
            document.getElementById('detail-panel').classList.add('visible');

            // TOTAL PURGE: Physically remove all layers in admin panes from the map object
            this.purgeAdminLayers();
            coreMap.map.closePopup();
            
            if (!iso) {
                this.currentIso = 'ALL';
                this.currentDeptId = null;
                this.currentMuniId = null;

                const titleEl = document.getElementById('dash-title');
                const subtitleEl = document.getElementById('dash-subtitle');
                if (titleEl) {
                    titleEl.innerText = "Centroamérica y República Dominicana";
                    this._lastAdminName = titleEl.innerText;
                }
                if (subtitleEl) subtitleEl.innerText = "Análisis Regional";

                if (!fullData.admin.paises) {
                    const res = await fetch(`../web_data/sica_paises.json`);
                    if (res.ok) fullData.admin.paises = await res.json();
                }

                if (fullData.admin.paises) {
                    this.renderAllCountries(fullData.admin.paises);
                    if (fullData.regionalMaskGeom) coreMap.applyMapMask(fullData.regionalMaskGeom);
                }
                coreMap.map.setView([15, -86], 6.4);
                
                this._lastAdminName = "Centroamérica y República Dominicana";
                state.activeAdminGeom = null; // Regional: Show all
                
                // Show Regional PA Stats and process tabs
                const activeTabBtn = document.querySelector('.dash-tab.active');
                const activeTab = activeTabBtn ? activeTabBtn.id.replace('tab-', '') : 'info';
                
                // Keep the current selection - don't force reset
                if (activeTab === 'loss') {
                    this.updateLossView();
                } else {
                    await this.switchDashTab(activeTab);
                }
                
                // Ensure ecosystems are loaded/re-filtered in regional view
                if (activeTab === 'ecos' || activeTab === 'integrated' || activeTab === 'test') {
                    await this.renderEcosMap(null);
                }
            } else {
                if (!fullData.admin.paises) {
                    const res = await fetch(`../web_data/sica_paises.json`);
                    if (res.ok) fullData.admin.paises = await res.json();
                }

                const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                    if (countryFeat) {
                        this.currentIso = iso;
                        this.currentDeptId = null;
                        this.currentMuniId = null;
    
                        state.activeAdminFeature = countryFeat.properties;
                        state.activeAdminGeom = countryFeat.geometry;
                        
                        coreMap.applyMapMask(countryFeat);
                        
                        if (coreMap.geojsonLayer) {
                        coreMap.map.removeLayer(coreMap.geojsonLayer);
                        coreMap.geojsonLayer = null;
                    }
                    const isTest = (state.activeTab === 'test');
                    const isPA = (state.activeTab === 'pas');

                    const hierarchy = state.adminHierarchy[iso] || {};
                    const a1Type = hierarchy.admin1_type || 'Nivel 1';
                    const a2Type = hierarchy.admin2_type || 'Nivel 2';

                    if (coreMap.boundaryLayer) coreMap.map.removeLayer(coreMap.boundaryLayer);
                    coreMap.boundaryLayer = L.geoJSON(countryFeat, {
                        pane: 'adminBoundaryPane',
                        interactive: !isPA, 
                        style: isTest ? { color: '#ffffff', weight: 2, fillOpacity: 0, fillColor: 'transparent', dashArray: '5, 5' } : { 
                            color: '#ffffff', 
                            weight: 2, 
                            fillOpacity: isPA ? 0 : 0.1, 
                            fillColor: '#ffffff', 
                            dashArray: '5, 5' 
                        },
                        onEachFeature: (f, l) => {
                            if (!isPA) {
                                l.bindPopup(createPremiumPopupHTML({
                                    title: cleanEncoding(f.properties.Pais_es),
                                    subtitle: 'Análisis Nacional',
                                    themeColor: '#10b981',
                                    bodyHTML: createPopupTable(f.properties, a1Type, a2Type)
                                }), { className: 'premium-popup-wrap' });
                            }
                        }
                    }).addTo(coreMap.map);
                    
                    try {
                        const bounds = coreMap.boundaryLayer.getBounds();
                        this.selectionBounds = bounds; // ATOMIC SYNC: Explicit Country Bounds
                        coreMap.map.fitBounds(bounds, state.mapPadding);
                    } catch(err) {
                        console.warn("fitBounds failed, using setView", err);
                        coreMap.map.setView([15, -86], 6.4);
                    }

                    if (!fullData.admin.dept) {
                        const res = await fetch(`../web_data/sica_admin1.json`);
                        if (res.ok) fullData.admin.dept = await res.json();
                    }

                    if (fullData.admin.dept) {
                        const countryDepts = {
                            type: 'FeatureCollection',
                            features: fullData.admin.dept.features.filter(f => f.properties.Pais_cod3 === iso)
                        };
                        
                        const isTest = (state.activeTab === 'test');
                        const isPA = (state.activeTab === 'pas');

                        coreMap.admin1Layer = L.geoJSON(countryDepts, {
                            pane: 'adminBoundaryPane',
                            interactive: !isPA, 
                            style: isTest ? { color: 'rgba(255,255,255,0.3)', weight: 1, fillOpacity: 0, fillColor: 'transparent' } : { 
                                color: 'rgba(255,255,255,0.3)', 
                                weight: 1, 
                                fillOpacity: isPA ? 0 : 0.05, 
                                fillColor: '#ffffff' 
                            },
                            onEachFeature: (f, l) => {
                                if (!isPA) {
                                    const name = f.properties.Admin1name || f.properties.Admin1_nom;
                                    l.bindPopup(createPremiumPopupHTML({
                                        title: cleanEncoding(name),
                                        subtitle: a2Type,
                                        themeColor: '#3b82f6',
                                        bodyHTML: createPopupTable(f.properties, a1Type, a2Type)
                                    }), { className: 'premium-popup-wrap' });
                                    l.on({
                                        mouseover: (e) => e.target.setStyle({ fillOpacity: isTest ? 0.0 : 0.2, weight: 2 }), // Absolute zero in Test
                                        mouseout: (e) => e.target.setStyle({ fillOpacity: (isPA || isTest) ? 0 : 0.05, weight: 1 }),
                                        click: (e) => {
                                            const deptId = f.properties.Admin1_id;
                                            const selector = document.getElementById('admin-dept');
                                            if(selector) {
                                                selector.value = deptId;
                                                selector.dispatchEvent(new Event('change'));
                                            }
                                            this.syncPanelWithMap(iso, 1, deptId);
                                        }
                                    });
                                }
                            }
                        }).addTo(coreMap.map);
                        
                        // Centralized style sync: ensure transparency if in PA mode
                        this.syncAdminLayersStyle();
                    }
                }
            }
            await this.updateDashboard(iso);
            
            // Final Step: If we are in PA tab, re-trigger the PA render for the new selection
            const currentTab = state.activeTab || 'info';
            if (currentTab === 'pas') {
                // PA Debug Log silenced

                await this.switchDashTab('pas');
            } else if (currentTab === 'integrated') {
                this.updateIntegratedView();
            }
        } catch(e) {
            // PA Debug Log silenced

        } finally {
            this._isUpdating = false;
            showLoader(false);
            this.syncAdminLayersStyle();
        }
    }

    purgeAdminLayers() {
        if (!coreMap || !coreMap.map) return;
        // EXCLUSIÓN: ecosystemPane ahora se mantiene vivo como fondo
        const targetPanes = ['adminBoundaryPane', 'selectionPane', 'geojsonLayer', 'paBoundaryPane', 'maskPane'];
        let count = 0;
        coreMap.map.eachLayer(layer => {
            if (layer.options && layer.options.pane) {
                const pane = layer.options.pane;
                // BLINDAJE TOTAL: Si está en ecosystemPane, NO TOCAR NUNCA
                if (pane === 'ecosystemPane') return;
                
                if (targetPanes.includes(pane) || targetPanes.some(p => pane.includes(p))) {
                    coreMap.map.removeLayer(layer);
                    count++;
                }
            } else if (typeof layer.setStyle === 'function' && layer !== coreMap.ecosLayer) {
                // Si tiene setStyle pero no es la referencia oficial, verificamos su pane antes de borrar
                const pane = layer.options?.pane;
                if (pane === 'ecosystemPane') return;
                
                coreMap.map.removeLayer(layer);
                count++;
            }
        });
        console.log(`[PURGE] Eliminadas ${count} capas administrativas para evitar duplicados.`);
        
        // Reset reference pointers
        coreMap.admin1Layer = null;
        coreMap.highlightLayer = null;
        coreMap.boundaryLayer = null;
        coreMap.geojsonLayer = null;
        coreMap.maskLayer = null;
        if (coreMap.paGroup) coreMap.paGroup.clearLayers();
    }

    syncAdminLayersStyle() {
        const activeTab = state.activeTab || 'info';
        const isPA = (activeTab === 'pas');
        const isTest = (activeTab === 'test');
        
        // Static overrides for test/PA
        const staticStyle = (isPA || isTest) ? { fillOpacity: 0 } : null;

        // 1. Limpieza por referencia directa
        if (coreMap.geojsonLayer) coreMap.geojsonLayer.setStyle(staticStyle || { fillOpacity: 0.4 });
        if (coreMap.boundaryLayer) coreMap.boundaryLayer.setStyle(staticStyle || { fillOpacity: 0.1 });
        if (coreMap.admin1Layer) coreMap.admin1Layer.setStyle(staticStyle || { fillOpacity: 0.05 });
        if (coreMap.highlightLayer) coreMap.highlightLayer.setStyle(staticStyle || { fillOpacity: 0.2 });
        
        // 2. RED DE SEGURIDAD: Barrido global de todas las capas del mapa
        if (coreMap.map) {
            coreMap.map.eachLayer(layer => {
                if (layer.options && layer.options.pane) {
                    const p = layer.options.pane;
                    if ((p === 'adminBoundaryPane' || p === 'selectionPane' || p === 'paBoundaryPane') && (isPA || isTest)) {
                        if (layer.setStyle) layer.setStyle({ fillOpacity: 0 });
                    }
                }
            });
        }
        
        console.log(`[STYLE SYNC ATOMIC] Estado: ${activeTab} | Forzado Transparencia: ${isTest}`);
    }

    async updateDashboard(iso) {
        const countryName = state.adminHierarchy[iso]?.name || iso;
        const panel = document.getElementById('detail-panel');
        const content = document.getElementById('info-content');
        const deptId = document.getElementById('admin-dept')?.value;
        const muniId = document.getElementById('admin-muni')?.value;
        
        state.currentEcosMetadata = { iso: iso, deptId, muniId };
        
        // Determinar título y subtítulo dinámico
        let subtitle = iso ? 'ANÁLISIS DE PAÍS' : 'Análisis Regional';
        let title = iso ? cleanEncoding(countryName) : 'Centroamérica y República Dominicana';
        
        const titleEl = document.getElementById('dash-title');
        const subtitleEl = document.getElementById('dash-subtitle');

        const hierarchy = state.adminHierarchy[iso];

        if (muniId && hierarchy?.admin1[deptId]?.admin2[muniId]) {
            const muniName = hierarchy.admin1[deptId].admin2[muniId];
            const muniType = hierarchy.admin2_type || 'Municipio';
            subtitle = `ANÁLISIS DE ${muniType.toUpperCase()}`;
            title = cleanEncoding(muniName);
        } else if (deptId && hierarchy?.admin1[deptId]) {
            const deptName = hierarchy.admin1[deptId].name;
            const deptType = hierarchy.admin1_type || 'Departamento';
            subtitle = `ANÁLISIS DE ${deptType.toUpperCase()}`;
            title = cleanEncoding(deptName);
        }

        if (titleEl) {
            titleEl.innerText = title;
            this._lastAdminName = title;
        }
        this._lastSubtitle = subtitle;
        if (subtitleEl) subtitleEl.innerText = subtitle;

        panel.classList.add('visible');

        content.innerHTML = `
            <div id="admin-summary" style="margin-top:5px;">
                ${this.buildAdminAccordion(iso)}
            </div>`;
            
        panel.classList.add('visible');
        
        // Tab Configuration for AdminApp
        const tabEcos = document.getElementById('tab-ecos');
        const tabPas = document.getElementById('tab-pas');
        const tabIntegrated = document.getElementById('tab-integrated');
        const tabInfo = document.getElementById('tab-info');
        
        if (tabEcos) {
            tabEcos.style.display = 'block';
            tabEcos.onclick = (e) => this.switchDashTab('ecos', tabEcos);
        }
        if (tabPas) {
            tabPas.style.display = 'block';
            tabPas.onclick = (e) => this.switchDashTab('pas', tabPas);
        }
        if (tabIntegrated) {
            tabIntegrated.style.display = 'block';
            tabIntegrated.onclick = (e) => this.switchDashTab('integrated', tabIntegrated);
        }
        if (tabInfo) {
            tabInfo.onclick = (e) => this.switchDashTab('info', tabInfo);
        }

        // Persist current tab or default to info
        const activeTabBtn = document.querySelector('.dash-tab.active');
        const activeTab = activeTabBtn ? activeTabBtn.id.replace('tab-', '') : 'info';
        await this.switchDashTab(activeTab);

        // Sincronización con el Motor de Deforestación v2.0 (PRUEBA)
        const testApp = window.appControllerInstance?.apps['test'];
        if (testApp) {
            if (activeTab === 'test') {
                testApp.log("Sincronizando motor de ecosistemas...");
                this.renderEcosMap(iso || document.getElementById('admin-country')?.value);
                testApp.toggleHeat(true);
                // Aseguramos que los gráficos se actualicen con el contexto correcto
                testApp.updateCharts();
            }
        }
    }

    buildAdminAccordion(iso) {
        const hierarchy = state.adminHierarchy[iso];
        if (!hierarchy || !hierarchy.admin1) {
            return `
                <div style="padding:20px; color:var(--text); font-size:0.85rem; line-height:1.6;">
                    <h3 style="color:var(--primary); font-size:0.95rem; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Guía</h3>
                    
                    <div style="display:flex; flex-direction:column; gap:20px;">
                        <div style="display:flex; gap:12px; align-items:flex-start;">
                            <span style="background:var(--primary); color:#fff; width:22px; height:22px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.7rem; font-weight:900;">1</span>
                            <div>
                                <strong style="display:block; color:#fff; margin-bottom:3px;">Filtro Territorial</strong>
                                <span style="color:var(--gray); font-size:0.75rem;">Utilice el panel izquierdo para seleccionar un <b>País, Departamento o Municipio</b>. El mapa se ajustará automáticamente a su selección.</span>
                            </div>
                        </div>

                        <div style="display:flex; gap:12px; align-items:flex-start;">
                            <span style="background:#3b82f6; color:#fff; width:22px; height:22px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.7rem; font-weight:900;">2</span>
                            <div>
                                <strong style="display:block; color:#fff; margin-bottom:3px;">Pestañas de Análisis</strong>
                                <span style="color:var(--gray); font-size:0.75rem;">Explore el estatus de <b>Áreas Protegidas</b>, la distribución de <b>Ecosistemas</b> o los focos de <b>Deforestación</b> histórica mediante las pestañas de este panel.</span>
                            </div>
                        </div>

                        <div style="display:flex; gap:12px; align-items:flex-start;">
                            <span style="background:#f97316; color:#fff; width:22px; height:22px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.7rem; font-weight:900;">3</span>
                            <div>
                                <strong style="display:block; color:#fff; margin-bottom:3px;">Análisis Integrado</strong>
                                <span style="color:var(--gray); font-size:0.75rem;">Utilice la pestaña <b>Análisis Integrado</b> para identificar intersecciones críticas entre protección, ecosistemas y riesgo de colapso biológico.</span>
                            </div>
                        </div>

                        <div style="display:flex; gap:12px; align-items:flex-start;">
                            <span style="background:rgba(255,255,255,0.2); color:#fff; width:22px; height:22px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.75rem; font-weight:900;"><i class="fas fa-mouse-pointer" style="font-size:0.6rem;"></i></span>
                            <div>
                                <strong style="display:block; color:#fff; margin-bottom:3px;">Mapa Interactivo</strong>
                                <span style="color:var(--gray); font-size:0.75rem;">Haga clic directamente sobre cualquier elemento del mapa para obtener <b>fichas técnicas</b> y reportes detallados en ventanas emergentes.</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        const admin2Type = hierarchy.admin2_type || 'Municipio';
        let pluralLabel = admin2Type.toLowerCase() + 's';
        
        if (iso === 'CRI') pluralLabel = 'cantones';
        if (iso === 'PAN') pluralLabel = 'distritos';
        if (iso === 'BLZ') pluralLabel = 'districts';

        let html = '<div style="margin-top:10px;">';
        Object.entries(hierarchy.admin1).forEach(([deptId, deptData]) => {
            const munis = deptData.admin2 || {};
            const muniCount = Object.keys(munis).length;

            html += `
                <div class="accordion-item" id="acc-dept-${deptId}" style="border:1px solid var(--border); border-radius:8px; margin-bottom:6px; overflow:hidden;">
                    <div class="accordion-header" style="background:rgba(255,255,255,0.04); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85rem; font-weight:600; cursor:pointer;" onclick="window.adminAppInstance.highlightAdminUnit('${iso}', 1, '${deptId}')">
                            ${cleanEncoding(deptData.name)}
                        </span>
                        <span style="display:flex; gap:8px; align-items:center;">
                            <span style="font-size:0.75rem; color:var(--gray);">${muniCount} ${pluralLabel}</span>
                            <span class="acc-arrow" style="color:var(--primary); transition:transform 0.2s; cursor:pointer;" 
                                  onclick="const content=this.closest('.accordion-header').nextElementSibling; content.classList.toggle('visible'); this.style.transform = content.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)'">▶</span>
                        </span>
                    </div>
                    <div class="accordion-content dash-content" style="padding:0; max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.15);">
                        <div style="padding:8px;">
                            ${Object.entries(munis).map(([muniId, muniName]) => {
                                return `
                                <div class="dash-row" id="acc-row-muni-${muniId}" style="padding:6px 8px; font-size:0.8rem; cursor:pointer; border-radius:4px;" 
                                     onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"
                                     onclick="window.adminAppInstance.highlightAdminUnit('${iso}', 2, '${muniId}')">
                                    <div class="dash-name">${cleanEncoding(muniName)}</div>
                                    <div style="color:var(--primary); font-size:0.7rem;">📍</div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
        return html;
    }

    renderAllCountries(data) {
        const activeTab = state.activeTab || 'info';
        const isPA = (activeTab === 'pas');
        const isTest = (activeTab === 'test');

        if (coreMap.geojsonLayer) coreMap.map.removeLayer(coreMap.geojsonLayer);
        coreMap.geojsonLayer = L.geoJSON(data, {
            pane: 'adminBoundaryPane',
            interactive: !isPA, 
            style: isTest ? { fillColor: 'transparent', fillOpacity: 0, color: '#ffffff', weight: 1 } : (f) => ({
                fillColor: getFeatureColor(f.properties),
                weight: 1, color: '#ffffff', fillOpacity: isPA ? 0 : 0.4
            }),
            onEachFeature: (f, l) => {
                if (!isPA) {
                    const p = f.properties;
                    const iso = p.Pais_cod3;
                    const hierarchy = state.adminHierarchy[iso] || {};
                    const name = p.Pais_es || p.Admin1name || p.Admin1_nom;
                    l.bindPopup(createPremiumPopupHTML({
                        title: cleanEncoding(name),
                        subtitle: 'Análisis Nacional',
                        themeColor: '#10b981',
                        bodyHTML: createPopupTable(p, hierarchy.admin1_type, hierarchy.admin2_type)
                    }), { className: 'premium-popup-wrap' });
                    l.on({
                        click: (e) => {
                            const iso = f.properties.Pais_cod3;
                            const selector = document.getElementById('admin-country');
                            if(selector) {
                                selector.value = iso;
                                selector.dispatchEvent(new Event('change'));
                            }
                        },
                        mouseover: (e) => e.target.setStyle({ fillOpacity: isTest ? 0.0 : 0.6, weight: 2 }), // Pure zero
                        mouseout: (e) => e.target.setStyle({ fillOpacity: (isPA || isTest) ? 0 : 0.4, weight: 1 })
                    });
                }
            }
        }).addTo(coreMap.map);
    }

    resetFilters() {
        this.log("Reseteando filtros administrativos...");
        const cFilter = document.getElementById('admin-country');
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');

        if (cFilter) cFilter.value = "";
        if (dFilter) { dFilter.value = ""; dFilter.disabled = true; }
        if (mFilter) { mFilter.value = ""; mFilter.disabled = true; }

        this.currentIso = 'ALL';
        this.currentDeptId = null;
        this.currentMuniId = null;
        this.selectionBounds = null;

        // Limpiar capas de resaltado si existen
        if (coreMap.highlightLayer) {
            coreMap.map.removeLayer(coreMap.highlightLayer);
            coreMap.highlightLayer = null;
        }

        this.updateAdminView();
    }

    log(msg) {
        console.log(`[AdminApp] ${msg}`);
    }

    updateContextHeaders(unitName) {
        const unitIds = ['ecos-unit-name', 'pas-unit-name', 'integrated-unit-name', 'loss-unit-name', 'test-unit-name'];
        unitIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = unitName;
        });
    }

    async highlightAdminUnit(iso, level, adminId) {
        let unitName = '...';
        if (level === 0) unitName = state.adminHierarchy[iso]?.name || iso;
        if (level === 1) unitName = state.adminHierarchy[iso]?.admin1[adminId]?.name || adminId;
        if (level === 2) {
             // Find dept for this muni
             for (const deptId in state.adminHierarchy[iso]?.admin1) {
                 const munis = state.adminHierarchy[iso].admin1[deptId].admin2;
                 if (munis && munis[adminId]) {
                     unitName = munis[adminId];
                     break;
                 }
             }
        }
        this.updateContextHeaders(cleanEncoding(unitName));
        if (this._isUpdating) return;
        this._isUpdating = true;
        showLoader(true);
        try {
            const cacheKey = level === 1 ? 'dept' : 'muni';
            const filename = level === 1 ? 'sica_admin1.json' : 'sica_admin2.json';

            if (!fullData.admin[cacheKey]) {
                const res = await fetch(`../web_data/${filename}`);
                if (res.ok) fullData.admin[cacheKey] = await res.json();
            }

            const feat = fullData.admin[cacheKey].features.find(f => {
                const p = f.properties;
                return p.Pais_cod3 === iso && (p.Admin1_id == adminId || p.Admin2_id == adminId || p.IDRegMunic == adminId);
            });

            if (feat) {
                const activeTab = state.activeTab || 'info';
                const isPA = (activeTab === 'pas');
                const isTest = (activeTab === 'test');

                if (coreMap.highlightLayer) coreMap.map.removeLayer(coreMap.highlightLayer);
                coreMap.highlightLayer = L.geoJSON(feat, {
                    pane: 'selectionPane',
                    interactive: !isPA, 
                    style: isTest ? { color: '#ffffff', weight: 3.5, fillOpacity: 0, fillColor: 'transparent' } : { 
                        color: '#ffffff', 
                        weight: 3.5, 
                        fillOpacity: isPA ? 0 : 0.2, 
                        fillColor: '#ffffff' 
                    }
                }).addTo(coreMap.map);
                
                const p = feat.properties;
                const dSelect = document.getElementById('admin-dept');
                const mSelect = document.getElementById('admin-muni');
                
                this.currentIso = iso;
                if (level === 1) {
                    this.currentDeptId = adminId;
                    this.currentMuniId = null;
                    if (dSelect) dSelect.value = adminId;
                    this.updateMunis(); // Repoblar selector de municipios
                } else if (level === 2) {
                    const parentId = p.Admin1_id || p.Admin1_ID;
                    this.currentDeptId = parentId;
                    this.currentMuniId = adminId;
                    if (dSelect) {
                        dSelect.value = parentId;
                        this.updateMunis(); // Asegurar que el selector N2 tenga las opciones correctas
                    }
                    if (mSelect) mSelect.value = adminId;
                }

                state.activeAdminGeom = feat.geometry;
                coreMap.applyMapMask(feat);
                
                const bounds = coreMap.highlightLayer.getBounds();
                this.selectionBounds = bounds;

                coreMap.map.fitBounds(bounds, { 
                    ...state.mapPadding,
                    maxZoom: 12 
                });
                
                if (!isPA) {
                    const p = feat.properties;
                    const hierarchy = state.adminHierarchy[iso] || {};
                    const name = level === 1 ? (p.Admin1name || p.Admin1_nom) : (p.Admin2name || p.Admin2_nom);
                    this._lastAdminName = cleanEncoding(name);
                    coreMap.highlightLayer.bindPopup(createPremiumPopupHTML({
                        title: cleanEncoding(name),
                        subtitle: level === 1 ? hierarchy.admin1_type : hierarchy.admin2_type,
                        themeColor: level === 1 ? '#10b981' : '#3b82f6',
                        bodyHTML: createPopupTable(p, hierarchy.admin1_type, hierarchy.admin2_type)
                    }), { className: 'premium-popup-wrap' });
                } else {
                    const p = feat.properties;
                    const name = level === 1 ? (p.Admin1name || p.Admin1_nom) : (p.Admin2name || p.Admin2_nom);
                    this._lastAdminName = cleanEncoding(name);
                }

                await this.updateDashboard(iso);
                
                // NOTA: renderEcosMap ya es llamado dentro de updateDashboard -> switchDashTab.
                // Eliminar la llamada redundante aquí previene parpadeos y fallos de carga en niveles 1 y 2.

                // Ensure all administrative layers remain transparent in interactive modes (PA/Ecos/Test)
                if (isTest || isPA || activeTab === 'integrated' || activeTab === 'ecos') {
                    this.syncAdminLayersStyle();
                }
            }
        } finally { 
            this._isUpdating = false;
            showLoader(false);
        }
    }

    onDashTabSwitch(tabId) {
        this.switchDashTab(tabId);
    }

    async switchDashTab(tabId, btn) {
        state.activeTab = tabId;
        
        // Update subtitle with unit name ONLY in info tab (Unidades Territoriales)
        const subtitleEl = document.getElementById('dash-subtitle');
        if (subtitleEl && this._lastSubtitle) {
            subtitleEl.innerText = (tabId === 'info') 
                ? `${this._lastSubtitle}: ${this._lastAdminName || ''}` 
                : this._lastSubtitle;
        }
        console.log(`[STATE SYNC] Tab activa: ${tabId}`);
        state.currentDashTab = tabId;
        const tabs = document.querySelectorAll('.dash-tab');
        const contents = document.querySelectorAll('.dash-content');
        const legendContainer = document.getElementById('accordion-legend');
        
        if (btn || !document.getElementById(`${tabId}-content`)?.classList.contains('visible')) {
            tabs.forEach(t => t.classList.remove('active'));
            if (!btn) btn = document.getElementById(`tab-${tabId}`);
            if (btn) btn.classList.add('active');
            
            // Toggle Report Button Visibility (Only show in Integrated Analysis)
            const reportBtn = document.getElementById('btn-narrative-report');
            if (reportBtn) {
                reportBtn.style.display = (tabId === 'integrated') ? 'block' : 'none';
            }
            
            if (tabId === 'test' || tabId === 'integrated') {
                try {
                    const testApp = window.appControllerInstance?.apps['test'];
                    if (coreMap.setLayerPriority) coreMap.setLayerPriority('test');
                    
                    if (tabId === 'test') {
                        // 1. Sync UI Console (solo modo test)
                        if (testApp) {
                           testApp.log(":::CLEAR:::");
                           testApp.log("Iniciando Motor Deforestación v2.5 (Seguro)...");
                        }
                    }

                    // 2. Sync Admin Boundaries and Transparency
                    const currentIso = document.getElementById('admin-country')?.value || '';
                    this.syncAdminLayersStyle();
                    
                    if (state.activeAdminGeom) {
                        coreMap.applyMapMask(state.activeAdminGeom);
                    } else if (fullData.regionalMaskGeom) {
                        coreMap.applyMapMask(fullData.regionalMaskGeom);
                    }
                    
                    // 3. Render EcosMap for background
                    await this.renderEcosMap(currentIso);

                    // 4. Sincronizar Mapa de Calor (Visible por defecto en Integrated)
                    const prefix = (tabId === 'integrated') ? 'int' : 'test';
                    let heatToggle = document.getElementById(`${prefix}-heat-toggle`);
                    
                    if (testApp) {
                        // REQUISITO CRÍTICO: Asegurar que los datos pesados estén cargados en memoria
                        // antes de intentar renderizar, en caso de que sea la primera pestaña visitada.
                        await testApp.ensureData();

                        // Forzamos recalibración de radio/saturación según el nivel actual
                        testApp.resetHeatSettings(); 
                        
                        // Si es Integrado, forzamos true a menos que el toggle exista y esté apagado
                        const isHeatActive = (tabId === 'integrated') ? (heatToggle ? heatToggle.checked : true) : (heatToggle?.checked || false);
                        testApp.toggleHeat(isHeatActive);
                    }

                    if (tabId === 'test' && testApp) testApp.log("[SISTEMA] Recursos sincronizados con éxito.");
                } catch (err) {
                    console.error(`Fallo crítico en switchDashTab(${tabId}):`, err);
                }
            } else {
                // AUTO-CLEAN: Apagar calor al salir a pestañas que no lo soportan (Info, PA, Ecos)
                const testApp = window.appControllerInstance?.apps['test'];
                if (testApp) testApp.toggleHeat(false);

                // Clear Isolation Mask if active
                if (coreMap.ecosLayer) this.clearIsolation(coreMap.ecosLayer);
                
                if (coreMap.setLayerPriority) coreMap.setLayerPriority('admin');
                this.syncAdminLayersStyle();
            }

            contents.forEach(c => c.classList.remove('visible'));
            const content = document.getElementById(`${tabId}-content`);
            if (content) content.classList.add('visible');
            
            // Reset scroll position on tab change
            const scrollContainer = document.getElementById('dash-scroll-container');
            if (scrollContainer) scrollContainer.scrollTop = 0;
        }

        // Logic per tab
        if (tabId === 'info' && legendContainer) {
            legendContainer.style.display = 'none';
            legendContainer.innerHTML = '';
        }
        
        if (tabId === 'ecos') {
            this.showEcosLegend();
        }
        if (tabId === 'pas' || tabId === 'ecos' || tabId === 'integrated') {
            const country = document.getElementById('admin-country')?.value || '';
            const dept = document.getElementById('admin-dept')?.value || '';
            const muni = document.getElementById('admin-muni')?.value || '';
            
            // Priority to interactive layer pane
            if (tabId === 'integrated') {
                if (coreMap.setLayerPriority) coreMap.setLayerPriority('integrated');
                // Disable direct popups on VectorGrid to allow map-level click to take priority
                if (coreMap.admin1Layer) coreMap.admin1Layer.options.interactive = false;
                if (coreMap.ecosLayer) coreMap.ecosLayer.options.interactive = false;
            } else {
                if (coreMap.setLayerPriority) coreMap.setLayerPriority(tabId === 'pas' ? 'areas' : 'ecosistemas');
                if (coreMap.admin1Layer) coreMap.admin1Layer.options.interactive = true;
                if (coreMap.ecosLayer) coreMap.ecosLayer.options.interactive = true;
            }
            // Sync Styles for Admin Layers (White Borders)
            this.syncAdminLayersStyle();
            
            if (tabId === 'pas') {
                // ... (existing code for pas)
                if (coreMap.ecosLayer) { coreMap.map.removeLayer(coreMap.ecosLayer); coreMap.ecosLayer = null; }
                if (coreMap.setLayerPriority) coreMap.setLayerPriority('areas');
                
                const legendContainer = document.getElementById('accordion-legend');
                if (legendContainer) legendContainer.innerHTML = '';

                await new Promise(r => setTimeout(r, 300));
                
                const nameDisplay = document.getElementById('pas-unit-name');
                if (nameDisplay) {
                    nameDisplay.innerText = this._lastAdminName || 'Región SICA';
                }

                await this.renderPACharts(country, dept, muni);
            } else if (tabId === 'ecos') {
                if (coreMap.paGroup) coreMap.paGroup.clearLayers();
                if (coreMap.paLegend) { coreMap.map.removeControl(coreMap.paLegend); coreMap.paLegend = null; }
                
                if (coreMap.setLayerPriority) coreMap.setLayerPriority('ecosistemas');

                const nameDisplay = document.getElementById('ecos-unit-name');
                if (nameDisplay) {
                    let dName = this._lastAdminName || 'Región SICA';
                    if (country === 'DOM') {
                        dName = "Sin datos de ecosistema para la unidad administrativa seleccionada";
                    } else if (dName === "Centroamérica y República Dominicana" || dName === "SICA Región (Centroamérica y R.D.)") {
                        dName = "Centroamérica";
                    }
                    nameDisplay.innerText = dName;
                }

                await this.renderEcosMap(country);
                this.showEcosLegend();

                // ECO Tab Analytics
                const ecoStats = this.aggregateEcoStats(country, dept, muni);
                if (ecoStats) {
                    this.renderEcoCharts(ecoStats, 'Ecos');
                    const accContainer = document.getElementById('eco-accordion-list-ecos');
                    if (accContainer) {
                        accContainer.innerHTML = this.buildEcoAccordion(ecoStats.groups);
                    }
                    const titleEl = document.getElementById('eco-list-title-ecos');
                    if (titleEl) titleEl.innerHTML = `Listado por Grupo <small style="color:var(--gray); font-weight:normal;">(${ecoStats.totalArea.toLocaleString('de-DE')} ha)</small>`;
                }
            } else if (tabId === 'integrated') {
                const nameDisplay = document.getElementById('integrated-unit-name');
                if (nameDisplay) {
                    let dName = this._lastAdminName || 'Región SICA';
                    if (country === 'DOM') {
                        dName = "Sin datos de ecosistema para la unidad administrativa seleccionada";
                    } else if (dName === "Centroamérica y República Dominicana" || dName === "SICA Región (Centroamérica y R.D.)") {
                        dName = "Centroamérica";
                    }
                    nameDisplay.innerText = dName;
                }

                // Integrated Analysis triggers BOTH visual spatial maps overlaying each other
                await this.renderEcosMap(country);
                this.showEcosLegend();
                
                await this.renderPACharts(country, dept, muni);
                
                // CRITICAL FIX: Trigger the integrated analytics engine
                await this.updateIntegratedView();
                
                const ecoStats = this.aggregateEcoStats(country, dept, muni);
                if (ecoStats) {
                    this.renderEcoCharts(ecoStats, 'Int');
                    const accContainer = document.getElementById('eco-accordion-list-int');
                    if (accContainer) {
                        accContainer.innerHTML = this.buildEcoAccordion(ecoStats.groups);
                    }
                    const titleEl = document.getElementById('eco-list-title-int');
                    if (titleEl) titleEl.innerHTML = `Inventario de Ecosistemas <small style="color:var(--gray); font-weight:normal;">(${ecoStats.totalArea.toLocaleString('de-DE')} ha)</small>`;
                }
            } else if (tabId === 'loss' || tabId === 'test') {
                if (coreMap.paGroup) coreMap.paGroup.clearLayers();
                if (coreMap.paLegend) { coreMap.map.removeControl(coreMap.paLegend); coreMap.paLegend = null; }
                
                // MANTENER ECOSISTEMAS EN MODO TEST: El usuario los requiere como fondo del heatmap
                if (tabId === 'test') {
                    await this.renderEcosMap(country);
                } else if (coreMap.ecosLayer) { 
                    coreMap.map.removeLayer(coreMap.ecosLayer); 
                    coreMap.ecosLayer = null; 
                }
                
                if (coreMap.teowLayer) { coreMap.map.removeLayer(coreMap.teowLayer); coreMap.teowLayer = null; }
                
                if (coreMap.setLayerPriority) {
                    coreMap.setLayerPriority(tabId === 'test' ? 'test' : 'admin');
                }

                const nameDisplay = document.getElementById(tabId === 'test' ? 'test-unit-name' : 'loss-unit-name');
                if (nameDisplay) {
                    const currentTitle = document.getElementById('dash-title')?.innerText || '...';
                    nameDisplay.innerText = this._lastAdminName || currentTitle;
                    console.log(`[LOG] Cambiando nombre (${tabId}) a:`, nameDisplay.innerText);
                }

                // Explicitly call the update for loss, or let TestApp handle itself for test
                if (tabId === 'loss') this.updateLossView();
            }

            // RECALIBRACIÓN DE MAPA DE CALOR (Si está activo en Integrated)
            if (tabId === 'integrated' || tabId === 'test') {
                const testApp = window.appControllerInstance?.apps['test'];
                const prefix = (tabId === 'integrated') ? 'int' : 'test';
                const heatToggle = document.getElementById(`${prefix}-heat-toggle`);
                if (testApp && heatToggle && heatToggle.checked) {
                    testApp.resetHeatSettings();
                }
            }
        } else {
            // INFO Tab - Normal Admin Priority
            if (coreMap.setLayerPriority) coreMap.setLayerPriority('admin');
            this.syncAdminLayersStyle();

            // Clear spatial layers
            if (coreMap.paGroup) coreMap.paGroup.clearLayers();
            if (coreMap.paLegend) { coreMap.map.removeControl(coreMap.paLegend); coreMap.paLegend = null; }
            if (coreMap.ecosLayer) { coreMap.map.removeLayer(coreMap.ecosLayer); coreMap.ecosLayer = null; }

            const iso = document.getElementById('admin-country')?.value;
            const deptId = document.getElementById('admin-dept')?.value;
            const muniId = document.getElementById('admin-muni')?.value;
            if (iso && (muniId || deptId)) {
                this.syncPanelWithMap(iso, muniId ? 2 : 1, muniId || deptId);
            }
        }

        // --- FINAL REINFORCEMENT: Ecosystem Legend Sync ---
        const activeTab = tabId || state.activeTab;
        if (activeTab === 'ecos' || activeTab === 'integrated' || activeTab === 'test') {
            const container = document.getElementById('accordion-legend');
            if (container) {
                this.showEcosLegend();
                container.style.display = 'block';
                container.style.visibility = 'visible';
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }
        }
    }

    async renderPACharts(iso, deptId, muniId) {
        const stats = this.aggregatePAStats(iso, deptId, muniId);
        const resultsContainer = document.getElementById('pas-results-container');
        if (!stats || stats.totalArea === 0) {
            if (resultsContainer) resultsContainer.innerHTML = '<div style="padding:40px; text-align:center; color:var(--gray);">No se encontraron áreas protegidas intersectionando esta unidad.</div>';
            return;
        }

        const totalEl = document.getElementById('pas-total-area');
        if (totalEl) totalEl.innerText = formatNumber(stats.totalArea) + " ha";

        let unitName = 'Centroamérica y República Dominicana';
        if (muniId) {
            const muniName = state.adminHierarchy[iso]?.admin1[deptId]?.admin2[muniId] || muniId;
            unitName = cleanEncoding(muniName);
        } else if (deptId) {
            const deptName = state.adminHierarchy[iso]?.admin1[deptId]?.name || deptId;
            unitName = cleanEncoding(deptName);
        } else if (iso) {
            const countryName = state.adminHierarchy[iso]?.name || iso;
            unitName = cleanEncoding(countryName);
        }

        let integratedPctHtml = '';
        try {
            const intData = this.calculateIntegratedStats();
            if (intData && intData.totalAreaUnit > 0) {
                const totalUnit = intData.totalAreaUnit;
                const totalProt = intData.bosque.protected + intData.agro.protected + intData.otros.protected;
                const pctProt = (totalProt / totalUnit) * 100;
                integratedPctHtml = `
                    <div class="stat-card-integrated" style="text-align:center; margin-bottom:20px;">
                        <p style="font-size:0.7rem; color:var(--gray); margin-bottom:5px;">Superficie Territorial Protegida Terrestre</p>
                        <div style="font-size:1.8rem; font-weight:800; color:#10b981;">${pctProt.toFixed(1)}%</div>
                        <p style="font-size:0.6rem; color:var(--gray);">${formatNumber(totalProt)} ha de ${formatNumber(totalUnit)} ha totales</p>
                    </div>`;
            }
        } catch (e) {
        }

        // Re-inject HTML and clear old charts
        coreMap.destroyCharts();
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                ${integratedPctHtml}
                <h3 class="dash-title">Categorías de Áreas Protegidas</h3>
                <div style="position:relative; height:220px; margin-bottom: 20px;"><canvas id="paCategoryChart"></canvas></div>
                <h3 class="dash-title">Top Áreas Protegidas en ${unitName}</h3>
                <div style="position:relative; height:300px;"><canvas id="paTopChart"></canvas></div>
                <div class="dash-section" style="border-left: 4px solid var(--accent); margin-top:20px;">
                    <h3 class="dash-title">Listado por Categoría</h3>
                    <div id="pa-accordion-list" style="margin-top:10px;"></div>
                </div>
                <div id="pas-list" class="stats-list" style="display:none;"></div>`;
        }


        // Prepare Category Data
        const catLabels = Object.keys(stats.categories);
        const catData = Object.values(stats.categories);
        const PA_COLORS = {
            'National Park': '#059669', 'Parque Nacional': '#059669',
            'Wildlife Sanctuary': '#10b981', 'Refugio de Vida Silvestre': '#10b981',
            'Natural Monument': '#f59e0b', 'Monumento Natural': '#f59e0b',
            'Nature Reserve': '#3b82f6', 'Reserva Biológica': '#3b82f6',
            'Private Reserve': '#8b5cf6', 'Reserva Natural Privada': '#8b5cf6',
            'Forest Reserve': '#047857', 'Reserva Forestal': '#047857',
            'Marine Reserve': '#0ea5e9'
        };

        const getCol = (cat) => PA_COLORS[cat] || `hsl(${Math.abs(cat.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 360)}, 60%, 45%)`;
        const catColors = catLabels.map(getCol);

        coreMap.destroyCharts();
        const ctxPie = document.getElementById('paCategoryChart')?.getContext('2d');
        if (ctxPie) {
            coreMap.paCategoryChart = new Chart(ctxPie, {
                type: 'pie',
                devicePixelRatio: 2, // HiDPI support for sharper text/lines
                data: {
                    labels: catLabels,
                    datasets: [{
                        data: catData,
                        backgroundColor: catColors,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { 
                        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } },
                        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw.toLocaleString()} ha (${((c.raw/stats.totalArea)*100).toFixed(1)}%)` } }
                    }
                }
            });
        }

        // Prepare Top PAs Data
        const topPAs = Object.entries(stats.pas)
            .sort((a,b) => b[1].ha - a[1].ha)
            .slice(0, 10);
        
        const ctxBar = document.getElementById('paTopChart')?.getContext('2d');
        if (ctxBar) {
            coreMap.paTopChart = new Chart(ctxBar, {
                type: 'bar',
                devicePixelRatio: 2, // HiDPI support for sharper text/lines
                data: {
                    labels: topPAs.map(p => cleanEncoding(p[0])),
                    datasets: [{
                        label: 'Hectáreas',
                        data: topPAs.map(p => p[1].ha),
                        backgroundColor: topPAs.map(p => getCol(p[1].category || 'Sin Categoría')),
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true, maintainAspectRatio: false,
                    onClick: (evt, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const paName = topPAs[index][0];
                            this.zoomToPA(paName);
                        }
                    },
                    plugins: { 
                        legend: { display: false },
                        tooltip: { callbacks: { label: (c) => ` ${formatNumber(c.raw)} ha (${((c.raw/stats.totalArea)*100).toFixed(1)}% del total en unidad)` } }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
                        y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 9 }, cursor: 'pointer' } }
                    }
                }
            });
        }

        await this.renderPAMapIntersections(iso, stats.pas, PA_COLORS);

        // Build and display Categorical Accordion with DOM self-healing
            let accContainer = document.getElementById('pa-accordion-list');
            
            // SELF-HEALING: Re-create structure if it was wiped by tab switching race conditions
            if (!accContainer) {
                const pasContent = document.getElementById('pas-content');
                if (pasContent) {
                    pasContent.insertAdjacentHTML('beforeend', `
                        <div class="dash-section" style="border-left: 4px solid var(--accent); margin-top:20px;">
                            <h3 class="dash-title">Listado por Categoría</h3>
                            <div id="pa-accordion-list" style="margin-top:10px;"></div>
                        </div>
                    `);
                    accContainer = document.getElementById('pa-accordion-list');
                }
            }

            if (accContainer) {
                const count = Object.keys(stats.pas || {}).length;
                if (count > 0) accContainer.innerHTML = this.buildPAAccordion(stats.pas);
                else accContainer.innerHTML = '<div class="empty-state-small">No se encontraron áreas.</div>';
            }
    }

    aggregatePAStats(iso, deptId, muniId) {
        if (!state.adminStats) return null;
        
        // Inicializar mapa de normalización si no existe
        if (!this.paNormalizedMap && fullData.paStats?.pas) {
            this.paNormalizedMap = {};
            Object.keys(fullData.paStats.pas).forEach(k => {
                this.paNormalizedMap[this.normalizePAName(k)] = fullData.paStats.pas[k];
            });
        }

        const pas = {};
        const categories = {};
        let totalArea = 0;

        const processPA = (name, area) => {
            const normName = this.normalizePAName(name);
            const meta = this.paNormalizedMap ? this.paNormalizedMap[normName] : (fullData.paStats?.pas?.[name] || fullData.paStats?.[name]);
            
            if (!meta) return;
            
            // ROOT FIX: Lenient Country Validation
            // Only skip if metadata explicitly specifies a DIFFERENT country.
            // If iso3 is missing, keep it (as it belongs to the admin_stats hierarchy).
            const pIso = (meta.iso3 || '').toUpperCase();
            const targetIso = (iso || '').toUpperCase();
            
            if (targetIso && pIso && pIso !== targetIso) {
                return; 
            }
            
            const paArea = area !== null ? area : (meta.area_ha || 0);
            const cat = meta.category || 'Sin Categoría';
            
            if (!pas[name]) pas[name] = { ha: 0, category: cat };
            pas[name].ha += paArea; 
            categories[cat] = (categories[cat] || 0) + paArea;
            totalArea += paArea;
        };

        const processLevelStats = (statsObj) => {
            if (!statsObj) return;
            if (Array.isArray(statsObj)) {
                statsObj.forEach(name => processPA(name, null));
            } else {
                Object.entries(statsObj).forEach(([k, v]) => {
                    // Check if k is an index and v is the name (e.g. CRI and DOM)
                    if (!isNaN(k) && typeof v === 'string') {
                        processPA(v, null);
                    } else {
                        // k is name, v is area
                        processPA(k, v);
                    }
                });
            }
        };

        const processMuni = (mId) => {
            let mData = state.adminStats?.muni?.pas?.[mId];
            if (!mData && iso) {
                // Try HND-0601 or HND-601 style
                const paddedId = mId.toString().length < 4 ? mId.toString().padStart(4, '0') : mId;
                mData = state.adminStats?.muni?.pas?.[iso + '-' + paddedId] || state.adminStats?.muni?.pas?.[iso + '-' + mId];
            }
            processLevelStats(mData);
        };

        if (muniId) {
            processMuni(muniId);
        } else if (deptId) {
            // Priority: direct stats for the department
            const dStats = state.adminStats?.dept?.pas?.[deptId];
            if (dStats && Object.keys(dStats).length > 0) {
                processLevelStats(dStats);
            } else {
                // Fallback: aggregate all municipalities of this department
                // Use hierarchy from Store.js
                const hierarchy = state.adminHierarchy[iso] || {};
                const deptData = hierarchy.admin1 ? hierarchy.admin1[deptId] : null;
                if (deptData && deptData.admin2) {
                    Object.keys(deptData.admin2).forEach(mId => processMuni(mId));
                }
            }
        } else if (iso) {
            processLevelStats(state.adminStats?.pais?.pas?.[iso]);
        } else {
            // Agregación regional (todos los países del SICA)
            if (fullData.paStats?.pas) {
                Object.entries(fullData.paStats.pas).forEach(([name, meta]) => {
                    processPA(name, null);
                });
            }
        }

        return { pas, categories, totalArea };
    }

    getEcoCategory(label) {
        if (!label) return 'Otros Ecosistemas';
        const low = label.toLowerCase();
        if (low.includes('urbana') || low.includes('urbano') || low.includes('ciudad') || low.includes('asentamiento')) {
            return 'Zonas Urbanas';
        }
        if (low.includes('agropecuario') || low.includes('agricultura') || low.includes('pasto') || low.includes('cultivo')) {
            return 'Sistema Agropecuario';
        }
        if (low.includes('bosque')) {
            return 'Ecosistemas de Bosques';
        }
        return 'Otros Ecosistemas';
    }

    wrapText(text, maxLen = 22) {
        if (!text || text.length <= maxLen) return [text];
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            if ((currentLine + word).length > maxLen) {
                if (currentLine) lines.push(currentLine.trim());
                currentLine = word + ' ';
            } else {
                currentLine += word + ' ';
            }
        });
        if (currentLine) lines.push(currentLine.trim());
        return lines;
    }

    aggregateEcoStats(iso, deptId, muniId) {
        if (!state.adminStats) return null;

        let rawEcos = [];
        let totalProt = 0;
        const by_eco = {};

        // 1. Resolve raw data based on administrative level
        if (muniId) {
            let mid = muniId.toString();
            if (iso === 'HND' && mid.length < 4) mid = mid.padStart(4, '0');
            const key = mid.includes('-') ? mid : `${iso}-${mid}`;
            rawEcos = state.adminStats.muni?.ecos?.[key] || state.adminStats.muni?.ecos?.[`${iso}-${mid}`] || [];
        } else if (deptId) {
            const dKey = deptId.toString().includes('-') ? deptId : `${iso}-${deptId}`;
            rawEcos = state.adminStats.dept?.ecos?.[dKey] || state.adminStats.dept?.ecos?.[deptId] || [];
            
            // Fallback: aggregate muni ecos if dept has none
            if (rawEcos.length === 0 && iso) {
                const hierarchy = state.adminHierarchy[iso] || {};
                const deptData = hierarchy.admin1 ? hierarchy.admin1[deptId] : null;
                if (deptData && deptData.admin2) {
                    Object.keys(deptData.admin2).forEach(mId => {
                        let mid = mId.toString();
                        if (iso === 'HND' && mid.length < 4) mid = mid.padStart(4, '0');
                        const key = mid.includes('-') ? mid : `${iso}-${mid}`;
                        const mEcos = state.adminStats.muni?.ecos?.[key] || state.adminStats.muni?.ecos?.[`${iso}-${mid}`] || [];
                        rawEcos = rawEcos.concat(mEcos);
                    });
                    // Consolidate duplicates
                    const consolidated = {};
                    rawEcos.forEach(e => {
                        if (!consolidated[e.label]) consolidated[e.label] = 0;
                        consolidated[e.label] += e.ha;
                    });
                    rawEcos = Object.entries(consolidated).map(([label, ha]) => ({ label, ha }));
                }
            }
        } else if (iso && iso !== 'ALL') {
            rawEcos = state.adminStats.pais?.ecos?.[iso] || [];
        } else {
            // REGIONAL CASE (ALL): Aggregate all countries
            const regionalConsolidated = {};
            if (state.adminStats?.pais?.ecos) {
                Object.values(state.adminStats.pais.ecos).forEach(countryEcos => {
                    countryEcos.forEach(e => {
                        if (!regionalConsolidated[e.label]) regionalConsolidated[e.label] = 0;
                        regionalConsolidated[e.label] += e.ha;
                    });
                });
            }
            rawEcos = Object.entries(regionalConsolidated).map(([label, ha]) => ({ label, ha }));
        }

        // 2. Aggregate by Category and include Protection
        const groups = {
            'Sistema Agropecuario': { ha: 0, protected: 0, items: [] },
            'Ecosistemas de Bosques': { ha: 0, protected: 0, items: [] },
            'Otros Ecosistemas': { ha: 0, protected: 0, items: [] },
            'Zonas Urbanas': { ha: 0, protected: 0, items: [] }
        };
        let totalArea = 0;

        rawEcos.forEach(item => {
            let cat = this.getEcoCategory(item.label);
            if (!groups[cat]) cat = 'Otros Ecosistemas';
            groups[cat].ha += item.ha;
            
            // Resolve individual protection percentage
            // Try to find in state.adminStats.pais.protection[iso][item.label]
            let pPct = 0;
            if (iso && iso !== 'ALL') {
                pPct = state.adminStats.pais?.protection?.[iso]?.[item.label] || 0;
            } else {
                // Regional proxy or pre-calculated in Store.js
                pPct = state.adminStats.regional?.protection?.[item.label] || 0;
            }
            
            const protectedHa = (item.ha * pPct) / 100;
            groups[cat].protected += protectedHa;
            
            const ecoData = { 
                label: item.label, // Unified property name to label
                ha: item.ha,       // Used 'ha' to match buildEcoAccordion access
                percent: pPct, 
                protectedHa 
            };
            
            groups[cat].items.push(ecoData);
            by_eco[item.label] = ecoData;
            
            totalArea += item.ha;
            totalProt += protectedHa;
        });

        // 3. Top 10 individual ecosystems (Natural only)
        const top10 = rawEcos
            .filter(item => this.getEcoCategory(item.label) !== 'Sistema Agropecuario' && this.getEcoCategory(item.label) !== 'Zonas Urbanas')
            .sort((a,b) => b.ha - a.ha)
            .slice(0, 10);

        // 4. Calculate strictly Natural Area (Forest + Others)
        const totalNatural = (groups['Ecosistemas de Bosques']?.ha || 0) + (groups['Otros Ecosistemas']?.ha || 0);

        return { groups, top10, totalArea, totalNatural, totalProtected: totalProt, by_eco };
    }

    renderEcoCharts(stats, suffix = 'Ecos') {
        if (!stats) return;

        if (suffix === 'Ecos') {
            const totalEl = document.getElementById('ecos-total-area');
            if (totalEl) totalEl.innerText = formatNumber(stats.totalNatural) + " ha";
        }

        // 1. Composition Pie Chart
        const catCtx = document.getElementById(`ecoCategoryChart${suffix}`);
        if (catCtx) {
            const chartId = `ecoCategoryChart${suffix}`;
            if (coreMap[chartId]) coreMap[chartId].destroy();
            
            // Filter labels to exclude Urban Areas
            const labels = Object.keys(stats.groups).filter(l => l !== 'Zonas Urbanas');
            const data = labels.map(l => stats.groups[l].ha);
            const totalOnChart = data.reduce((a, b) => a + b, 0); // Basis for chart percentages
            const colors = labels.map(l => {
                if (l === 'Ecosistemas de Bosques') return '#10b981';
                if (l === 'Sistema Agropecuario') return '#f59e0b';
                return '#94a3b8'; // Light gray for "Otros"
            });

            coreMap[chartId] = new Chart(catCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors,
                        borderWidth: 0,
                        hoverOffset: 15
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, position: 'bottom', labels: { color: '#e2e8f0', usePointStyle: true, font: { size: 10 } } },
                        tooltip: { 
                            callbacks: { 
                                label: (ctx) => {
                                    const rawLabel = ctx.label;
                                    const lines = this.wrapText(rawLabel, 25);
                                    lines.push(`${formatNumber(ctx.raw)} ha (${((ctx.raw/totalOnChart)*100).toFixed(1)}%)`);
                                    return lines;
                                } 
                            } 
                        }
                    }
                }
            });
        }

        // 2. TOP Ecos Bar Chart
        const topCtx = document.getElementById(`ecoTopChart${suffix}`);
        if (topCtx) {
            const chartId = `ecoTopChart${suffix}`;
            if (coreMap[chartId]) coreMap[chartId].destroy();
            
            coreMap[chartId] = new Chart(topCtx, {
                type: 'bar',
                data: {
                    labels: stats.top10.map(e => e.label.length > 25 ? e.label.substring(0, 22) + '...' : e.label),
                    datasets: [{
                        label: 'Hectáreas',
                        data: stats.top10.map(e => e.ha),
                        backgroundColor: stats.top10.map(e => getEcoColor(e.label)),
                        borderRadius: 4,
                        fullLabels: stats.top10.map(e => e.label) // Store full labels for tooltips
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (evt, elements, chart) => {
                        if (elements && elements.length > 0) {
                            const index = elements[0].index;
                            const fullLabel = stats.top10[index].label;
                            this.isolateEcosystem(fullLabel);
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                        y: { grid: { display: false }, ticks: { color: '#f1f5f9', font: { size: 10 } } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { 
                            callbacks: { 
                                title: (items) => {
                                    const idx = items[0].dataIndex;
                                    return this.wrapText(stats.top10[idx].label, 25); 
                                },
                                label: (ctx) => `${formatNumber(ctx.raw)} ha` 
                            } 
                        }
                    }
                }
            });
        }
    }

    buildEcoAccordion(groups) {
        const sortedCats = Object.keys(groups).sort();
        
        return `
            <div class="dash-accordion">
                ${sortedCats.map((cat, idx) => `
                    <div class="accordion-item" id="eco-cat-${idx}" style="border: 1px solid rgba(255,255,255,0.1); border-radius:10px; margin-bottom:8px; background: rgba(0,0,0,0.15);">
                        <div class="accordion-header" onclick="this.nextElementSibling.classList.toggle('visible'); this.querySelector('.acc-arrow').style.transform = this.nextElementSibling.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)';" style="padding:10px 12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:600; font-size:0.85rem; color:var(--text);">${cat}</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:0.7rem; color:var(--gray);">${formatNumber(groups[cat].ha)} ha</span>
                                <span class="acc-arrow" style="transition: transform 0.3s; font-size:0.6rem; color:var(--gray);">▶</span>
                            </div>
                        </div>
                        <div class="accordion-content" style="max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.1);">
                            <div style="padding:8px 0;">
                                ${groups[cat].items.sort((a,b) => b.ha - a.ha).map(eco => {
                                    const safeLabel = eco.label || eco.name || 'Ecosistema Desconocido';
                                    return `
                                    <div class="dash-row tooltip-trigger" 
                                         onclick="window.adminAppInstance.isolateEcosystem('${cleanEncoding(safeLabel).replace(/'/g, "\\'")}')"
                                         data-tooltip="${cleanEncoding(safeLabel)}" 
                                         style="padding:6px 12px; display:flex; justify-content:space-between; align-items:center; border-radius:4px; margin:2px 5px; cursor: pointer;">
                                        <div style="display:flex; align-items:center; gap:8px; max-width: 70%;">
                                            <div style="width:8px; height:8px; border-radius:2px; background:${getEcoColor(safeLabel)};"></div>
                                            <span style="font-size:0.75rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cleanEncoding(safeLabel)}</span>
                                        </div>
                                        <span style="font-size:0.7rem; color: #10b981; font-weight:600;">${formatNumber(eco.ha)} ha</span>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    async renderPAMapIntersections(iso, activePAs, colorPalette) {
        const renderId = Symbol('pa-render');
        this._currentPARenderId = renderId;

        const countryId = iso || document.getElementById('admin-country')?.value || '';
        const deptId = document.getElementById('admin-dept')?.value || '';
        const muniId = document.getElementById('admin-muni')?.value || '';

        if (coreMap.paLegend) {
            try {
                // Safer control removal to avoid 'parentNode' errors in Leaflet
                if (coreMap.paLegend._container && coreMap.paLegend._container.parentNode) {
                    coreMap.map.removeControl(coreMap.paLegend);
                }
            } catch(e) {
 }
            coreMap.paLegend = null;
        }

        const isosToLoad = countryId ? [countryId.toUpperCase()] : Object.keys(state.adminHierarchy).filter(k => k !== 'MEX');
        
        showLoader(true);
        try {
            await Promise.all(isosToLoad.map(async code => {
                if (!fullData.areasPartitioned[code]) {
                    const res = await fetch(`../web_data/pa_split/pa_${code}.json`);
                    if (res.ok) fullData.areasPartitioned[code] = await res.json();
                }
            }));
        } catch(err) {
        } finally { showLoader(false); }

        if (this._currentPARenderId !== renderId) {
            return;
        }

        const allFeatures = [];
        const activeNames = new Set(Object.keys(activePAs).map(n => this.normalizePAName(n)));
        
        isosToLoad.forEach(code => {
            const paData = fullData.areasPartitioned[code];
            if (!paData || !paData.features) return;

            // OPTION 6: Get Bounds of current unit for strict geometric clipping
            let unitBounds = null;
            if (state.activeAdminGeom) {
                try {
                    unitBounds = L.geoJSON(state.activeAdminGeom).getBounds();
                } catch(e) { }
            }

            paData.features.forEach(f => {
                const name = f.properties.nombre || f.properties.Nombre_AP || f.properties.NAME || '';
                const normName = this.normalizePAName(name);
                
                // Geometric Pre-filter (Option 6)
                if (unitBounds && f.geometry) {
                    try {
                        const featBounds = L.geoJSON(f).getBounds();
                        if (!unitBounds.intersects(featBounds)) return; // Skip if no spatial overlap
                    } catch(e) { /* ignore malformed geom */ }
                }

                // If deep level, we MUST filter by stats too
                if (activeNames.has(normName)) {
                    allFeatures.push(f);
                } else if (countryId && deptId && !muniId) {
                    // Precise fallback for Dept (only if name matching fails but ID confirms)
                    const meta = this.paNormalizedMap ? this.paNormalizedMap[normName] : (fullData.paStats?.pas?.[name] || fullData.paStats?.[name]);
                    if (meta && meta.munis) {
                        const deptMunis = Object.keys(state.adminHierarchy[countryId]?.admin1[deptId]?.admin2 || {});
                        if (deptMunis.some(mId => meta.munis.includes(mId))) {
                            allFeatures.push(f);
                        }
                    }
                } else if (countryId && muniId) {
                    // Precise fallback for Muni
                    const meta = this.paNormalizedMap ? this.paNormalizedMap[normName] : (fullData.paStats?.pas?.[name] || fullData.paStats?.[name]);
                    if (meta && meta.munis && meta.munis.includes(muniId)) {
                        allFeatures.push(f);
                    }
                }
            });
        });

        if (allFeatures.length === 0) {
            return;
        }

        if (coreMap.paGroup) {
            coreMap.paGroup.clearLayers();
        }

        const getCol = (cat) => {
            if (!cat) return '#94a3b8';
            if (colorPalette[cat]) return colorPalette[cat];
            const str = cat.toString();
            return `hsl(${Math.abs(str.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 360)}, 60%, 45%)`;
        };

        if (!document.getElementById('pa-hatch-defs')) {
            const svgContainer = document.createElement('div');
            svgContainer.id = 'pa-hatch-defs';
            svgContainer.style.width = '0';
            svgContainer.style.height = '0';
            svgContainer.style.position = 'absolute';
            svgContainer.innerHTML = `
                <svg>
                    <defs>
                        <pattern id="pa-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="8" stroke="#ffffff" stroke-width="2" stroke-opacity="0.85"/>
                        </pattern>
                    </defs>
                </svg>
            `;
            document.body.appendChild(svgContainer);
        }

        const isIntegrated = state.currentDashTab === 'integrated';

        const newPaLayer = L.geoJSON({ type: 'FeatureCollection', features: allFeatures }, {
            pane: 'paBoundaryPane',
            interactive: !isIntegrated,
            renderer: L.svg(), // Use SVG instead of Canvas for better polygon rendering without artifacts
            style: (f) => ({
                color: '#ffffff',
                weight: isIntegrated ? 1.5 : 1.5,
                fillColor: isIntegrated ? 'url(#pa-hatch)' : getCol(f.properties.categoria || f.properties.category || f.properties.Descripcio || ''),
                fillOpacity: isIntegrated ? 1 : 0.5
            }),
            onEachFeature: (f, layer) => {
                if (isIntegrated) return; // Allow raw click pass-through to Turf handling

                const name = f.properties.nombre || f.properties.Nombre_AP || '';
                const stats = activePAs[name];
                const popupHtml = createPremiumPopupHTML({
                    title: cleanEncoding(name),
                    subtitle: cleanEncoding(f.properties.categoria || f.properties.category || f.properties.Descripcio || 'Área Protegida'),
                    themeColor: '#10b981',
                    bodyHTML: `
                        <div style="padding-top:8px;">
                            <div style="display:flex; justify-content:space-between; gap:15px; font-size:0.75rem; margin-bottom:4px;">
                                <span style="color:var(--gray); font-weight:600;">Área:</span>
                                <span style="color:var(--text); white-space:nowrap;">${stats?.ha.toLocaleString() || 'N/A'} ha</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; gap:15px; font-size:0.75rem;">
                                <span style="color:var(--gray); font-weight:600;">País:</span>
                                <span style="color:var(--text);">${f.properties.pais || f.properties.Pais_es || iso}</span>
                            </div>
                        </div>
                    `
                });
                layer.bindPopup(popupHtml, { className: 'premium-popup-wrap' });

                layer.on({
                    mouseover: (e) => {
                        const l = e.target;
                        l.setStyle({ weight: 2.5, color: '#ffffff', fillOpacity: 0.9, dashArray: '' });
                    },
                    mouseout: (e) => {
                        const l = e.target;
                        if (!l.isPopupOpen()) {
                            newPaLayer.resetStyle(l);
                        }
                    },
                    popupopen: (e) => {
                        const l = e.target;
                        l.setStyle({ weight: 3.5, color: '#10b981', fillOpacity: 0.95, dashArray: '' });
                    },
                    popupclose: (e) => {
                        const l = e.target;
                        newPaLayer.resetStyle(l);
                    }
                });
            }
        });

        if (coreMap.paGroup) {
            coreMap.paGroup.addLayer(newPaLayer);
        }

        // Add Legend
        this.addPAMapLegend(allFeatures, colorPalette);

        // SYNC: If Integrated Analysis is active, refresh his results too!
        if (state.currentDashTab === 'integrated') {
            this.updateIntegratedView();
        }
    }

    addPAMapLegend(features, colorPalette) {
        const container = document.getElementById('accordion-legend');
        if (!container) return;

        // Group by country then categories
        const countryGroups = {};
        features.forEach(f => {
            const p = f.properties;
            const paisRaw = p.pais || p.Pais_es || p.ISO3 || 'Región';
            const pais = cleanEncoding(paisRaw);
            const cat = p.categoria || p.category || 'Sin Categoría';
            if (!countryGroups[pais]) countryGroups[pais] = new Set();
            countryGroups[pais].add(cat);
        });

        const sortedCountries = Object.keys(countryGroups).sort();
        const getCol = (cat) => {
            if (!cat) return '#94a3b8';
            if (colorPalette[cat]) return colorPalette[cat];
            const str = cat.toString();
            return `hsl(${Math.abs(str.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 360)}, 60%, 45%)`;
        };

        let html = `
            <div style="padding:12px; background:rgba(15, 23, 42, 0.9); border-radius:12px; border:1px solid rgba(255,255,255,0.1); max-height:450px; overflow-y:auto; font-family:'Inter', sans-serif;">
                <h4 style="margin:0 0 12px 0; font-size:0.85rem; color:var(--accent); border-bottom:2px solid rgba(255,255,255,0.05); padding-bottom:8px;">Leyenda de Áreas Protegidas</h4>
        `;

        sortedCountries.forEach(pais => {
            html += `
                <div style="margin-bottom:15px;">
                    <div style="font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; letter-spacing:0.5px; opacity:0.9; margin-bottom:6px; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px;">${pais}</div>
                    <div style="display:grid; grid-template-columns: 1fr; gap:6px; padding-left:4px;">
            `;

            const sortedCats = Array.from(countryGroups[pais]).sort();
            sortedCats.forEach(c => {
                html += `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:10px; height:10px; border-radius:3px; background:${getCol(c)}; flex-shrink:0; border:1px solid rgba(255,255,255,0.1);"></div>
                        <span style="font-size:0.65rem; color:#cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height:1.2;" title="${cleanEncoding(c)}">${cleanEncoding(c)}</span>
                    </div>
                `;
            });

            html += `</div></div>`;
        });

        html += `</div>`;
        container.innerHTML = html;
        container.style.display = 'block';
    }

    resetFilters() {
        showLoader(true);
        const cFilter = document.getElementById('admin-country');
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');
        
        if (cFilter) {
            cFilter.value = '';
            this.updateSelectorLabels('');
        }
        if (dFilter) { dFilter.innerHTML = '<option value="">Seleccione Unidad (N1)</option>'; dFilter.disabled = true; }
        if (mFilter) { mFilter.innerHTML = '<option value="">Seleccione Unidad (N2)</option>'; mFilter.disabled = true; }

        state.activeAdminFeature = null;
        state.activeAdminGeom = null;
        document.getElementById('detail-panel').classList.remove('visible');
        
        const legendContainer = document.getElementById('accordion-legend');
        if (legendContainer) {
            legendContainer.style.display = 'none';
            legendContainer.innerHTML = '';
        }
        
        this.updateAdminView();
        
        if (coreMap.highlightLayer) {
            coreMap.map.removeLayer(coreMap.highlightLayer);
            coreMap.highlightLayer = null;
        }
        if (coreMap.admin1Layer) {
            coreMap.map.removeLayer(coreMap.admin1Layer);
            coreMap.admin1Layer = null;
        }
        if (coreMap.boundaryLayer) {
            coreMap.map.removeLayer(coreMap.boundaryLayer);
            coreMap.boundaryLayer = null;
        }
        coreMap.map.closePopup();
        coreMap.map.setView([15, -86], 6);
        showLoader(false);
    }

    clearSelection() {
        if (coreMap.highlightLayer) coreMap.map.removeLayer(coreMap.highlightLayer);
        coreMap.map.closePopup();
        
        const legendContainer = document.getElementById('accordion-legend');
        if (legendContainer) {
            legendContainer.style.display = 'none';
            legendContainer.innerHTML = '';
        }

        document.querySelectorAll('.selected-admin-row').forEach(el => el.classList.remove('selected-admin-row'));
        document.querySelectorAll('.accordion-content.visible').forEach(el => {
            el.classList.remove('visible');
            const arrow = el.previousElementSibling.querySelector('.acc-arrow');
            if (arrow) arrow.style.transform = 'rotate(0deg)';
        });
        const cFilter = document.getElementById('admin-country');
        if (cFilter && cFilter.value) {
            this.updateAdminView();
        } else {
            this.resetFilters();
        }
    }

    onDashTabSwitch(tabId) {
        this.switchDashTab(tabId);
        if (tabId === 'integrated') {
            coreMap.setLayerPriority('integrated');
            this.updateIntegratedView();
        } else if (tabId === 'info') {
            coreMap.setLayerPriority('admin');
        } else if (tabId === 'ecos') {
            coreMap.setLayerPriority('ecosistemas');
        } else if (tabId === 'pas') {
            coreMap.setLayerPriority('areas');
        }
    }

    syncPanelWithMap(iso, level, id) {
        document.querySelectorAll('.selected-admin-row').forEach(el => el.classList.remove('selected-admin-row'));
        const countryFilter = document.getElementById('admin-country');
        const deptFilter = document.getElementById('admin-dept');
        const muniFilter = document.getElementById('admin-muni');

        if (countryFilter && countryFilter.value !== iso) {
            countryFilter.value = iso;
            this.updateSelectorLabels(iso);
            this.updateDepts();
        }
        if (level === 1 && deptFilter) {
            deptFilter.value = id;
            this.updateMunis();
        } else if (level === 2 && muniFilter) {
            // Finding parent dept for muni
            const hierarchy = state.adminHierarchy[iso];
            if (hierarchy && hierarchy.admin1) {
                for (const [deptId, dData] of Object.entries(hierarchy.admin1)) {
                    if (dData.admin2 && dData.admin2[id]) {
                        if (deptFilter) {
                            deptFilter.value = deptId;
                            this.updateMunis();
                        }
                        break;
                    }
                }
            }
            if (muniFilter) muniFilter.value = id;
        }

        // Trigger dashboard update if PA tab is active
        const activeTabBtn = document.querySelector('.dash-tab.active');
        const activeTabId = activeTabBtn ? activeTabBtn.id : '';

        if (activeTabId === 'tab-pas' || activeTabId === 'pas') {
            const country = iso;
            const dept = deptFilter?.value || '';
            const muni = muniFilter?.value || '';
            this.renderPACharts(country, dept, muni);
        }

        // Accordion highlight and scroll logic
        setTimeout(() => {
            const currentIso = document.getElementById('admin-country')?.value;
            if (currentIso !== iso) return; // Ignore if country changed in the meantime

            let targetEl = null;
            document.querySelectorAll('.accordion-content.visible').forEach(acc => {
                const parent = acc.closest('.accordion-item');
                if (parent && parent.id !== `acc-dept-${id}`) {
                    acc.classList.remove('visible');
                    const arrow = parent.querySelector('.acc-arrow');
                    if (arrow) arrow.style.transform = 'rotate(0deg)';
                }
            });

            if (level === 1) {
                targetEl = document.getElementById(`acc-dept-${id}`);
                if (targetEl) {
                    const content = targetEl.querySelector('.accordion-content');
                    const arrow = targetEl.querySelector('.acc-arrow');
                    if (content && !content.classList.contains('visible')) {
                        content.classList.add('visible');
                        if (arrow) arrow.style.transform = 'rotate(90deg)';
                    }
                }
            } else if (level === 2) {
                const hierarchy = state.adminHierarchy[iso];
                let parentDept = null;
                if (hierarchy && hierarchy.admin1) {
                    for (const [deptId, dData] of Object.entries(hierarchy.admin1)) {
                        if (dData.admin2 && dData.admin2[id]) {
                            parentDept = deptId;
                            break;
                        }
                    }
                }

                if (parentDept) {
                    const deptItem = document.getElementById(`acc-dept-${parentDept}`);
                    if (deptItem) {
                        const content = deptItem.querySelector('.accordion-content');
                        const arrow = deptItem.querySelector('.acc-arrow');
                        if (content && !content.classList.contains('visible')) {
                            content.classList.add('visible');
                            if (arrow) arrow.style.transform = 'rotate(90deg)';
                        }
                    }
                }
                targetEl = document.getElementById(`acc-row-muni-${id}`);
            }

            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetEl.classList.add('selected-admin-row');
            }
        }, 150);
    }

    zoomToPA(name, retryCount = 0) {
        if (!coreMap.paGroup) return;
        let targetLayer = null;
        const normTarget = this.normalizePAName(name);

        const findLayer = (container, fuzzy = false) => {
            if (targetLayer) return;
            container.eachLayer(layer => {
                if (targetLayer) return;
                if (layer.feature && layer.feature.properties) {
                    const props = layer.feature.properties;
                    // Strategy 1: Check known name keys with perfect normalized match
                    const keys = ['nombre', 'Nombre_AP', 'NAME', 'Nombre_Pro', 'PA_NAME'];
                    for (const k of keys) {
                        if (props[k] && this.normalizePAName(props[k]) === normTarget) {
                            targetLayer = layer; break;
                        }
                    }
                    // Strategy 2: Property-blind substring match (If name contains Guanacaure)
                    if (!targetLayer && fuzzy && normTarget.length > 5) {
                        for (const key in props) {
                            if (typeof props[key] === 'string') {
                                const val = this.normalizePAName(props[key]);
                                if (val.includes(normTarget) || normTarget.includes(val)) {
                                    targetLayer = layer; break;
                                }
                            }
                        }
                    }
                } else if (layer.eachLayer) findLayer(layer, fuzzy);
            });
        };

        // Attempt 1: Standard search in PA group
        findLayer(coreMap.paGroup, true);

        // Attempt 2: Global map search (if PA group missed it or it's outside)
        if (!targetLayer) findLayer(coreMap.map, true);

        if (targetLayer) {
            if (targetLayer.getBounds) {
                coreMap.map.fitBounds(targetLayer.getBounds(), { padding: [50, 50], maxZoom: 14 });
            } else if (targetLayer.getLatLng) {
                coreMap.map.setView(targetLayer.getLatLng(), 14);
            }
            setTimeout(() => targetLayer.openPopup(), 600);
        } else if (retryCount < 3) {
            setTimeout(() => this.zoomToPA(name, retryCount + 1), 1000);
        }
    }

    buildPAAccordion(pas) {
        if (!pas || Object.keys(pas).length === 0) {
            return '<div style="padding:10px; color:var(--gray); font-size:0.8rem;">Sin áreas para mostrar.</div>';
        }

        try {
            // Group by category
            const groups = {};
            Object.entries(pas).forEach(([name, data]) => {
                const cat = data.category || 'Sin Categoría';
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push({ name, ha: data.ha });
            });

        const sortedCats = Object.keys(groups).sort();
        
        return `
            <div class="dash-accordion">
                ${sortedCats.map((cat, idx) => `
                    <div class="accordion-item" id="pa-cat-${idx}" style="border: 1px solid rgba(255,255,255,0.1); border-radius:10px; margin-bottom:8px; background: rgba(0,0,0,0.15);">
                        <div class="accordion-header" onclick="this.nextElementSibling.classList.toggle('visible'); this.querySelector('.acc-arrow').style.transform = this.nextElementSibling.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)';" style="padding:10px 12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:600; font-size:0.85rem; color:var(--text);">${cleanEncoding(cat)}</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:0.7rem; color:var(--gray);">${groups[cat].length} áreas</span>
                                <span class="acc-arrow" style="transition: transform 0.3s; font-size:0.6rem; color:var(--gray);">▶</span>
                            </div>
                        </div>
                        <div class="accordion-content" style="max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.1);">
                            <div style="padding:8px 0;">
                                ${groups[cat].sort((a,b) => b.ha - a.ha).map(pa => {
                                    const safeName = pa.name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                                    return `
                                    <div class="dash-row" onclick="window.adminAppInstance.zoomToPA('${safeName}')" style="padding:6px 12px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; border-radius:4px; margin:2px 5px;">
                                        <span style="font-size:0.75rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${cleanEncoding(pa.name)}</span>
                                        <span style="font-size:0.7rem; color: #10b981; font-weight:600;">${pa.ha.toLocaleString('de-DE')} ha</span>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        } catch (err) {
            return `<div style="color:red; padding:10px;">Error: ${err.message}</div>`;
        }
    }

    downloadDiagnostics() {
        const country = document.getElementById('admin-country')?.value || 'NONE';
        const dept = document.getElementById('admin-dept')?.value || 'NONE';
        const muni = document.getElementById('admin-muni')?.value || 'NONE';
        const activeTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'UNKNOWN';
        
        let report = `=== DASHBOARD DIAGNOSTIC REPORT ===\n`;
        report += `Generated: ${new Date().toISOString()}\n`;
        report += `Selection: Country=${country}, Dept=${dept}, Muni=${muni}\n`;
        report += `Active Tab: ${activeTab}\n`;
        report += `Display: DPR=${window.devicePixelRatio}, Res=${window.innerWidth}x${window.innerHeight}\n\n`;

        report += `--- METHOD HEALTH CHECK (EXISTENCE) ---\n`;
        report += `AdminApp.aggregatePAStats: ${typeof this.aggregatePAStats}\n`;
        report += `AdminApp.renderPACharts: ${typeof this.renderPACharts}\n`;
        report += `AdminApp.renderPAMapIntersections: ${typeof this.renderPAMapIntersections}\n`;
        report += `AdminApp.aggregateEcoStats: ${typeof this.aggregateEcoStats}\n`;
        report += `AdminApp.renderEcoCharts: ${typeof this.renderEcoCharts}\n`;
        report += `AdminApp.renderEcosMap: ${typeof this.renderEcosMap}\n\n`;

        report += `--- DATA STATE CHECK ---\n`;
        report += `state.adminHierarchy[${country}]: ${state.adminHierarchy[country] ? 'OK' : 'MISSING'}\n`;
        report += `state.adminStats: ${state.adminStats ? 'OK' : 'MISSING'}\n`;
        report += `fullData.paStats: ${fullData.paStats ? 'OK' : 'MISSING'}\n`;
        report += `fullData.ecosistemas: ${fullData.ecosistemas ? 'OK' : 'MISSING'}\n`;
        report += `fullData.integradora: ${fullData.integradora ? 'OK' : 'MISSING'}\n\n`;

        report += `--- CHART HEALTH CHECK ---\n`;
        const charts = [
            { id: 'paCategoryChart', name: 'Áreas Protegidas - Categorías' },
            { id: 'paTopChart', name: 'Áreas Protegidas - Top listado' },
            { id: 'ecoCategoryChart', name: 'Ecosistemas/Ecorregiones - Composición' },
            { id: 'ecoTopChart', name: 'Ecosistemas/Ecorregiones - Top listado' }
        ];

        charts.forEach(c => {
            const canvas = document.getElementById(c.id);
            if (canvas) {
                const isVisible = canvas.offsetParent !== null;
                const hasSize = canvas.clientWidth > 0 && canvas.clientHeight > 0;
                report += `[${isVisible && hasSize ? 'OK' : 'WARN'}] ${c.name} (${c.id}):\n`;
                report += `  - Visible in DOM: ${isVisible}\n`;
                report += `  - Rendered Size: ${canvas.clientWidth}x${canvas.clientHeight}\n`;
                report += `  - Canvas Internal: ${canvas.width}x${canvas.height}\n`;
                report += `  - ChartJS Instance: ${!!coreMap[c.id] ? 'Active' : 'Missing/Destroyed'}\n`;
            } else {
                report += `[FAIL] ${c.name} (${c.id}): ELEMENT NOT FOUND IN DOM\n`;
            }
        });
        report += `\n`;

        report += `--- TAB VISIBILITY ---\n`;
        ['info', 'pas', 'ecos', 'integrated'].forEach(tid => {
            const el = document.getElementById(`${tid}-content`);
            if (el) {
                const style = getComputedStyle(el);
                report += `Tab ${tid.toUpperCase()}: display=${style.display}, opacity=${style.opacity}, classList=[${Array.from(el.classList).join(', ')}]\n`;
            } else {
                report += `Tab ${tid.toUpperCase()}: NOT FOUND\n`;
            }
        });
        report += `\n`;

        report += `--- PAS EXECUTION TRACE ---\n`;
        try {
            if (typeof this.aggregatePAStats === 'function') {
                const stats = this.aggregatePAStats(country, dept, muni);
                report += `aggregatePAStats(ROOT) Trace: SUCCESS\n`;
                report += `  - Total Area Sum: ${stats?.totalArea?.toFixed(2)} ha\n`;
                report += `  - Unique PAs identified: ${Object.keys(stats?.pas || {}).length}\n`;
                report += `  - Unique Categories: ${Object.keys(stats?.categories || {}).length}\n`;
            } else {
                report += `aggregatePAStats(ROOT) Trace: FAILED - Function missing in AdminApp\n`;
            }
        } catch (e) {
            report += `aggregatePAStats(ROOT) Trace: CRASHED - "${e.message}"\n`;
        }

        report += `\n--- MAP LAYER STATUS ---\n`;
        report += `PAS Group Exists: ${!!coreMap.paGroup}\n`;
        if (coreMap.paGroup) {
            const layers = coreMap.paGroup.getLayers();
            report += `Features in PA Layer: ${layers.length}\n`;
        }
        report += `Ecos Layer Exists: ${!!coreMap.ecosLayer}\n`;
        
        const blob = new Blob([report], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sica-critical-debug-${country}-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    normalizePAName(name) {
        if (name === null || name === undefined) return "";
        return name.toString().toLowerCase()
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
            .replace(/['"“”‘’]/g, '') // Remove ALL types of quotes (straight, curly, single, double)
            .replace(/[^\w\s]/gi, '') // Remove everything else except letters/nums/spaces
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }

    clearPASel() {
        if (coreMap.highlightLayer) {
            coreMap.map.removeLayer(coreMap.highlightLayer);
            coreMap.highlightLayer = null;
        }
        coreMap.map.closePopup();
    }

    async isolateEcosystem(selectedEcoName) {
        if (!selectedEcoName) return;

        // Esperar a que el mapa termine de cargar si está en progreso
        if (this.ecosLoadingPromise) {
            await this.ecosLoadingPromise;
        }

        if (!coreMap.ecosLayer) return;
        
        // Toggle off if it's the same ecosystem
        if (this._currentIsolatedEco === selectedEcoName) {
            this.clearEcoIsolation();
            return;
        }

        // Clear existing interval
        if (this._ecoFlashInterval) {
            clearInterval(this._ecoFlashInterval);
            this._ecoFlashInterval = null;
        }

        this._currentIsolatedEco = selectedEcoName;
        // Limpiamos de forma estricta para asegurar que el string llegue impecable
        const cleanSelected = String(selectedEcoName).replace(/\\'/g, "'").trim();
        const targetSearch = normalizeStr(cleanSelected);
        const flashLayers = [];

        const activeTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'info';
        const isTest = (activeTab === 'test');

        // ELEVACIÓN SUPREMA DE CAPA: Hacemos que el ecosistema salte por encima de ABSOLUTAMENTE TODO (Z:999)
        const ecoPane = coreMap.map.getPane('ecosystemPane');
        if (ecoPane) {
            ecoPane.style.zIndex = 999;
            ecoPane.style.pointerEvents = 'none'; // Desactivamos hover para que no interfiera el mouseout
        }

        // Iterate through all Leaflet internal layers
        coreMap.ecosLayer.eachLayer(layer => {
            const props = layer.feature.properties || {};
            const possibleFields = ['NOMBRE', 'LEYENDA', 'nombre', 'DESCRIP', 'ECOSISTEMA', 'ecosistema', 'UNESCO', 'COD14'];
            let isMatch = false;
            
            for (const field of possibleFields) {
                if (props[field]) {
                    const rawPropStr = String(props[field]).trim();
                    const normProp = normalizeStr(rawPropStr);
                    
                    if (normProp === targetSearch || normProp.includes(targetSearch) || targetSearch.includes(normProp) || rawPropStr === cleanSelected) {
                        isMatch = true;
                        break;
                    }
                }
            }

            if (isMatch) {
                if (layer.bringToFront) layer.bringToFront();
                layer.setStyle({ 
                    fillOpacity: 1, 
                    opacity: 1, 
                    weight: isTest ? 3 : 2, 
                    color: isTest ? '#fbbf24' : '#00ffcc' // Neon cyan for general isolation to make it highly visible!
                });
                flashLayers.push(layer);
            } else {
                // Mask non-matched by reducing completely to a darker void
                layer.setStyle({ 
                    fillOpacity: 0.01, 
                    opacity: 0.05, 
                    weight: 0.1, 
                    color: '#0f172a' 
                });
            }
        });

        // Add a pulsing effect to the highlighted layers (THE RADAR EFFECT)
        if (flashLayers.length > 0) {
            let isFlashing = false;
            this._ecoFlashInterval = setInterval(() => {
                isFlashing = !isFlashing;
                const newStyles = isFlashing 
                    ? { weight: isTest ? 4 : 3, color: '#fbbf24', fillOpacity: isTest ? 0.8 : 1 } 
                    : { weight: isTest ? 2.5 : 1.5, color: '#ffffff', fillOpacity: isTest ? 0.45 : 0.9 };
                
                flashLayers.forEach(layer => {
                    if (layer.setStyle) layer.setStyle(newStyles);
                });
            }, 750);
        }
    }

    clearEcoIsolation() {
        this._currentIsolatedEco = null;
        
        if (this._ecoFlashInterval) {
            clearInterval(this._ecoFlashInterval);
            this._ecoFlashInterval = null;
        }

        if (!coreMap.ecosLayer) return;
        
        const activeTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'info';
        const isIntegrated = activeTab === 'integrated';
        const isTest = activeTab === 'test';
        const Opac = isIntegrated ? 0.6 : (isTest ? 0.7 : 0.7);

        coreMap.ecosLayer.eachLayer(layer => {
            layer.setStyle({ fillOpacity: Opac, opacity: 1, color: '#ffffff', weight: 0.3 });
        });

        // Restaurar z-index del pane de ecosistemas si fue elevado durante el aislamiento
        const ecoPane = coreMap.map.getPane('ecosystemPane');
        if (ecoPane) {
            const activeTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'info';
            ecoPane.style.zIndex = (activeTab === 'test') ? 400 : 450;
        }
    }

    normalizeForMatch(str) {
        if (!str) return '';
        return str.toLowerCase()
                  .trim()
                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                  .replace(/[^a-z0-9]/g, ''); // alphanumeric only
    }

    _resolveLossStatsUnit(stats, iso, level, code) {
        if (!stats) return null;
        
        // 1. Regional Case - Aggregate ecosystems if missing or simplified
        if (!iso || iso === 'ALL' || iso === '') {
            const reg = stats.regional || { total: 0, periods: {}, ecosystems: {} };
            
            // If regional ecosystems are just numbers or missing periods, we aggregate from countries
            const firstEco = Object.values(reg.ecosystems || {})[0];
            const needsAggregation = !reg.ecosystems || (typeof firstEco !== 'object') || !firstEco.periods;

            if (needsAggregation && stats.by_country) {
                const aggregatedEcos = {};
                Object.keys(stats.by_country).forEach(cIso => {
                    const countryData = stats.by_country[cIso];
                    if (countryData && countryData.ecosystems) {
                        Object.keys(countryData.ecosystems).forEach(ecoKey => {
                            const eData = countryData.ecosystems[ecoKey];
                            const eTotal = (typeof eData === 'object') ? (eData.total || eData) : eData;
                            const ePeriods = (typeof eData === 'object') ? (eData.periods || {}) : {};
                            
                            if (!aggregatedEcos[ecoKey]) {
                                aggregatedEcos[ecoKey] = { total: 0, periods: {} };
                            }
                            aggregatedEcos[ecoKey].total += (typeof eTotal === 'number' ? eTotal : 0);
                            Object.entries(ePeriods).forEach(([p, val]) => {
                                aggregatedEcos[ecoKey].periods[p] = (aggregatedEcos[ecoKey].periods[p] || 0) + (typeof val === 'number' ? val : 0);
                            });
                        });
                    }
                });
                reg.ecosystems = aggregatedEcos;
            }
            return reg;
        }

        let unit = null;
        const lookupCode = code ? (code.includes('-') ? code : `${iso}-${code}`) : null;

        if (level === 2 && lookupCode) {
            unit = stats.by_admin2?.[lookupCode] || 
                   stats.by_admin2?.[`${iso}-${lookupCode}`] || // ISO-ISO-CODE format found in forest_loss_stats.json
                   stats.by_admin2?.[parseFloat(code).toFixed(1)];
        } else if (level === 1 && lookupCode) {
            unit = stats.by_admin1?.[lookupCode] || stats.by_admin1?.[parseFloat(code).toFixed(1)];
        } else {
            unit = stats.by_country?.[iso] || stats.by_country?.[iso.toLowerCase()] || stats.by_country?.[iso.toUpperCase()];
        }
        
        return unit;
    }

    async renderEcosMap(iso = null) {
        // ROBUSTEZ: Si iso es nulo o "ALL", verificamos si hay un país seleccionado en el UI.
        // Pero si el usuario ha limpiado los filtros (selector vacío), forzamos iso a null para cargar el mapa regional.
        const countryVal = document.getElementById('admin-country')?.value || '';
        
        if ((!iso || iso === 'ALL' || iso === '') && countryVal !== '') {
            iso = countryVal;
        }

        const isRegional = !iso || iso === 'ALL' || iso === '';

        const testApp = window.appControllerInstance?.apps['test'];
        
        if (coreMap.ecosLayer) coreMap.map.removeLayer(coreMap.ecosLayer);
        coreMap.ecosLayer = null;

        showLoader(true);
        
        this.ecosLoadingPromise = (async () => {
            let data;
            const pathBase = '../web_data/';

            if (isRegional) {
                const url = `${pathBase}sica_ecosistemas_2002.json`;
                if (testApp) testApp.log("[ECOS] Descargando mapa regional (Alta definición)...");
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status} en regional`);
                data = await res.json();
            } else {
                const url = `${pathBase}ecos_split/ecos_${iso}.json`;

                if (testApp) testApp.log(`[ECOS] Cargando ecosistemas de: ${iso}`);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status} en split ${iso}`);
                data = await res.json();
            }

            if (!data || !data.features || data.features.length === 0) {
                if (testApp) testApp.log("[ERR] El servidor no devolvió polígonos.");
                return;
            }

            if (testApp) testApp.log(`[OK] ${data.features.length.toLocaleString()} polígonos sincronizados.`);

            // IMPORTANT: Clear previous layer immediately to force visual "clipping"
            if (coreMap.ecosLayer) {
                coreMap.map.removeLayer(coreMap.ecosLayer);
                coreMap.ecosLayer = null;
            }

            const activeTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'info';
            const isIntegrated = activeTab === 'integrated';
            const isTest = activeTab === 'test';

            coreMap.ecosLayer = L.geoJSON(data, {
                pane: 'ecosystemPane',
                interactive: !isIntegrated,
                style: (f) => {
                    const props = f.properties || {};
                    const ecoName = props.LEYENDA || props.DESCRIP || props.ECOSISTEMA || props.ecosistema || props.NOMBRE || props.Descripcio || props.UNESCO || 'Unidad';
                    const fillColor = getEcoColor(ecoName) || '#64748b';
                    const Opac = isIntegrated ? 0.6 : (isTest ? 0.7 : 0.7);

                    return {
                        fillColor: fillColor,
                        fillOpacity: Opac,
                        color: '#ffffff',
                        weight: 0.3
                    };
                },
                onEachFeature: (f, l) => {
                    if (activeTab === 'integrated') return;
                    const props = f.properties;
                    const name = props.LEYENDA || props.DESCRIP || props.ECOSISTEMA || props.ecosistema || props.NOMBRE || 'Ecosistema';
                    const color = getEcoColor(name);

                    const popupHtml = createPremiumPopupHTML({
                        title: cleanEncoding(name),
                        subtitle: 'Ecosistema',
                        themeColor: color,
                        bodyHTML: `
                            <div style="padding-top:8px; display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; justify-content:space-between; gap:15px; font-size:0.7rem;">
                                    <span style="color:var(--gray); font-weight:600;">Unidad:</span>
                                    <span style="color:#fff; font-weight:600;">${props.Pais_es || props.Pais_cod3 || 'Centroamérica'}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; gap:15px; font-size:0.7rem;">
                                    <span style="color:var(--gray); font-weight:600;">Código UNESCO:</span>
                                    <span style="color:#fff;">${props.UNESCO || props.unesco || 'N/A'}</span>
                                </div>
                            </div>
                        `
                    });
                    
                    l.bindPopup(popupHtml, { maxWidth: 300, closeButton: true, className: 'premium-popup-wrap' });
                    
                    l.on('mouseover', (e) => e.target.setStyle({ fillOpacity: 0.9, weight: 1.0 }));
                    l.on('mouseout', (e) => {
                        const currentTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'info';
                        const baseOpac = (currentTab === 'integrated') ? 0.6 : 0.7;
                        e.target.setStyle({ fillOpacity: baseOpac, weight: 0.3 });
                    });
                }
            }).addTo(coreMap.map);

            if (typeof coreMap.setLayerPriority === 'function') {
                if (isTest) {
                    coreMap.setLayerPriority('test');
                } else if (isIntegrated) {
                    coreMap.setLayerPriority('integrated');
                } else {
                    coreMap.setLayerPriority('ecos');
                }
            }
        })();

        try {
            await this.ecosLoadingPromise;
        } catch (err) {
            if (testApp) testApp.log(`[ERROR] Mapa: ${err.message}`);
        } finally {
            showLoader(false);
            this.ecosLoadingPromise = null;
        }
    }

    showEcosLegend() {
        const container = document.getElementById('accordion-legend');
        if (!container) return;

        // Force explicit access to state to avoid any reference issues
        const ecoNames = state.legendsConfig?.ecosistemas || [];

        if (!Array.isArray(ecoNames) || ecoNames.length === 0) {
            container.innerHTML = `
                <div style="padding:10px; color:var(--gray); font-size:0.75rem; text-align:center;">
                    Cargando leyenda de ecosistemas...
                </div>
            `;
            return;
        }

        // Sort unique names
        const sortedNames = [...new Set(ecoNames)].sort();

        let html = `
            <div style="padding:10px; background:rgba(15, 23, 42, 0.9); border-radius:12px; border:1px solid rgba(255,255,255,0.1); max-height:400px; overflow-y:auto; font-family:'Inter', sans-serif;">
                <h4 style="margin:0 0 10px 0; font-size:0.8rem; color:#10b981; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">Ecosistemas 2002 (Imágenes de 1997-2000)</h4>
                <div style="display:grid; grid-template-columns: 1fr; gap:8px;">
        `;

        sortedNames.forEach(name => {
            const color = getEcoColor(name);
            const cleanName = cleanEncoding(name);
            html += `
                <div style="display:flex; align-items:start; gap:10px; cursor:pointer;" 
                     class="ecos-legend-item" 
                     onclick="if(window.adminAppInstance) window.adminAppInstance.isolateEcosystem('${cleanName.replace(/'/g, "\\'")}');">
                    <div style="width:12px; height:12px; border-radius:3px; background:${color}; flex-shrink:0; border:1px solid rgba(255,255,255,0.2); margin-top:2px;"></div>
                    <span style="font-size:0.7rem; color:#e2e8f0; line-height:1.2;" title="${cleanName}">${cleanName}</span>
                </div>
            `;
        });

        html += `</div></div>`;
        container.innerHTML = html;
        container.style.display = 'block';
    }

    syncAdminLayersStyle() {
        const activeTab = document.querySelector('.dash-tab.active')?.id.replace('tab-', '') || 'info';
        const isInteractiveMode = (activeTab === 'pas' || activeTab === 'ecos' || activeTab === 'integrated' || activeTab === 'test');
        
        const admStyle = isInteractiveMode 
            ? { fill: false, fillOpacity: 0, color: '#ffffff', weight: 3, dashArray: '' }
            : { fill: true, fillOpacity: 0.1, color: '#ffffff', weight: 2, dashArray: '5, 5' };

        // Sync main administrative layers
        [coreMap.admin1Layer, coreMap.boundaryLayer, coreMap.highlightLayer, coreMap.geojsonLayer].forEach(layer => {
            if (layer && layer.setStyle) layer.setStyle(admStyle);
        });

        // Click-through: Enforce that administrative panes do NOT block clicks in interactive modes
        const selectPane = coreMap.map.getPane('selectionPane');
        const adminPane = coreMap.map.getPane('adminBoundaryPane');
        const maskPane = coreMap.map.getPane('maskPane');
        const ecosPane = coreMap.map.getPane('ecosystemPane');
        
        if (selectPane) {
            selectPane.style.pointerEvents = isInteractiveMode ? 'none' : 'auto';
            // Selection siempre el punto más alto de la jerarquía administrativa
            selectPane.style.zIndex = 700; 
        }
        
        if (adminPane) {
            adminPane.style.pointerEvents = isInteractiveMode ? 'none' : 'auto';
            // Bordes blancos por debajo de la selección pero por encima del recorte
            adminPane.style.zIndex = 650;
        }

        if (maskPane) {
            // El recorte (oscuro) debe estar por encima de los ecosistemas para que funcione el 'limpiado' visual
            maskPane.style.zIndex = 600;
        }

        if (ecosPane) {
            // Los ecosistemas son el fondo base, siempre en el nivel más bajo (400-450)
            ecosPane.style.zIndex = (activeTab === 'test' || activeTab === 'ecos') ? 450 : 400;
        }

        // Ensure theme layers are on top
        const paPane = coreMap.map.getPane('paBoundaryPane');
        if (paPane) {
            paPane.style.pointerEvents = isInteractiveMode ? 'auto' : 'none';
            paPane.style.zIndex = isInteractiveMode ? 550 : 400;
        }
    }

    // === INTEGRATED ANALYSIS ENGINE ===

    isForest(ecoName) {
        if (!ecoName) return false;
        const name = ecoName.toLowerCase();
        return name.includes('bosque') || name.includes('manglar') || name.includes('selva') || name.includes('forest');
    }

    onTargetChange() {
        const input = document.getElementById('integrated-target-val');
        if (input) {
            this.conservationTarget = parseFloat(input.value) || 0;
            this.updateIntegratedView();
        }
    }

    resetAnalysisParameters() {
        const targetInput = document.getElementById('integrated-target-val');
        const lossInput = document.getElementById('integrated-loss-threshold');
        const collapseInput = document.getElementById('integrated-collapse-threshold');
        
        if (targetInput) targetInput.value = 30;
        if (lossInput) lossInput.value = 5;
        if (collapseInput) collapseInput.value = 20;

        this.conservationTarget = 30;
        this.onTargetChange();
    }

    toggleAnalysisExplanation() {
        const helpPanel = document.getElementById('integrated-analysis-help');
        if (helpPanel) {
            const isVisible = helpPanel.style.display !== 'none';
            helpPanel.style.display = isVisible ? 'none' : 'block';
            
            // Auto-open details if help is requested and it was closed
            const details = document.getElementById('integrated-params-details');
            if (details && !isVisible) {
                details.open = true;
            }
        }
    }

    switchIntegratedSubTab(tabId, btn) {
        this.currentIntegratedSubTab = tabId;
        document.querySelectorAll('#integrated-content .admin-sub-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        this.updateIntegratedView();
    }

    resolveUnitId(iso, level, value) {
        if (!iso || !value) return value;
        const hierarchy = state.adminHierarchy[iso];
        if (!hierarchy) return value;
        
        if (level === 1) { // Department ID resolution
            const entries = Object.entries(hierarchy.admin1 || {});
            const found = entries.find(([id, data]) => id === value || data.name === value);
            return found ? found[0] : value;
        } else if (level === 2) { // Municipality ID resolution
            if (value.includes('-')) return value; // Already a code e.g. HND-0101
            // Try formatting like HND-0101
            const padded = value.toString().padStart(4, '0');
            return `${iso}-${padded}`;
        }
        return value;
    }

    calculateIntegratedStats(fIso = null, fLevel = null, fCode = null) {
        const cFilter = document.getElementById('admin-country');
        const dFilter = document.getElementById('admin-dept');
        const mFilter = document.getElementById('admin-muni');
        
        // Context resolution: prioritize passed parameters over DOM
        let iso = (fIso !== null) ? fIso : (document.getElementById('admin-country')?.value || '');
        if (iso === 'ALL') iso = ''; // Standardize 'ALL' to empty for regional aggregation
        
        const dVal = document.getElementById('admin-dept')?.value;
        const mVal = document.getElementById('admin-muni')?.value;
        const level = (fLevel !== null) ? fLevel : (dVal ? (mVal ? 2 : 1) : 0);
        const rawValue = (fCode !== null) ? fCode : (mVal || dVal || (iso || 'ALL'));
        const code = this.resolveUnitId(iso, level, rawValue);

        console.log(`[OAR STATS ENGINE] Resolving for: ISO=${iso || 'Regional'} | Level=${level} | Code=${code}`);
        
        // 1. Total areas and Protected Area overlaps from admin_stats.json (High-Fidelity Nested Structure)
        let ecosSourceList = [];
        let pasInUnitList = [];

        if (!iso) {
            // REGIONAL LEVEL AGGREGATION (All Countries)
            const ecoAggregates = {};
            const paSet = new Set();
            
            if (state.adminStats && state.adminStats.pais) {
                if (state.adminStats.pais.ecos) {
                    Object.values(state.adminStats.pais.ecos).forEach(countryEcos => {
                        countryEcos.forEach(e => {
                            if (!ecoAggregates[e.label]) ecoAggregates[e.label] = 0;
                            ecoAggregates[e.label] += (e.ha || 0);
                        });
                    });
                }
                if (state.adminStats.pais.pas) {
                    Object.values(state.adminStats.pais.pas).forEach(countryPas => {
                        countryPas.forEach(p => paSet.add(p));
                    });
                }
            }
            ecosSourceList = Object.entries(ecoAggregates).map(([label, ha]) => ({ label, ha }));
            pasInUnitList = Array.from(paSet);
        } else if (level === 2) {
            // Municipal level: reliable direct lookup
            let muniCode = code.includes('-') ? code : `${iso}-${code}`;
            ecosSourceList = state.adminStats.muni?.ecos[muniCode] || [];
            pasInUnitList = state.adminStats.muni?.pas[muniCode] || [];
        } else if (level === 1) {
            // Department level: DYNAMIC AGGREGATION to fix JSON branch corruption
            // We traverse the hierarchy and sum all muni data for this department
            const hierarchy = state.adminHierarchy[iso] || {};
            const deptData = hierarchy.admin1 ? hierarchy.admin1[code] : null;
            
            if (deptData && deptData.admin2) {
                const ecoAggregates = {};
                const paSet = new Set();
                
                Object.keys(deptData.admin2).forEach(mId => {
                    // Muni ecos
                    const mEcos = state.adminStats.muni?.ecos[mId] || [];
                    mEcos.forEach(e => {
                        if (!ecoAggregates[e.label]) ecoAggregates[e.label] = 0;
                        ecoAggregates[e.label] += (e.ha || 0);
                    });
                    
                    // Muni PAs
                    const mPas = state.adminStats.muni?.pas[mId] || [];
                    mPas.forEach(p => paSet.add(p));
                });
                
                ecosSourceList = Object.entries(ecoAggregates).map(([label, ha]) => ({ label, ha }));
                pasInUnitList = Array.from(paSet);
            }
        } else {
            // Country level: direct lookup (Robust Case-Insensitive)
            const targetIso = iso.toUpperCase();
            ecosSourceList = state.adminStats.pais?.ecos[targetIso] || [];
            pasInUnitList = state.adminStats.pais?.pas[targetIso] || [];
        }

        // 1.1 ROBUST FALLBACK (Only for Municipal/Country if direct fails)
        if (ecosSourceList.length === 0 && level !== 1 && !forcedCode) {
            const fallbackName = (level === 2) ? mFilter?.options[mFilter.selectedIndex]?.text : dFilter?.options[dFilter.selectedIndex]?.text;
            if (fallbackName) {
                const normName = this.normalizeForMatch(fallbackName);
                const targetPool = (level === 2) ? state.adminStats.muni?.ecos : state.adminStats.dept?.ecos;
                const foundKey = Object.keys(targetPool || {}).find(k => this.normalizeForMatch(k) === normName);
                if (foundKey) {
                    return this.calculateIntegratedStats(foundKey);
                }
            }
        }
        
        if (ecosSourceList.length === 0) {
            return null;
        }

        // 2. Protected areas distribution data from pa_granular_stats.json
        const pAs = fullData.paStats || {};
        const pasRoot = pAs.pas || pAs; 
        
        // 2.1 PRE-NORMALIZE PA KEYS FOR ROBUST LOOKUP
        const normalizedPasRoot = {};
        Object.keys(pasRoot).forEach(k => normalizedPasRoot[this.normalizeForMatch(k)] = pasRoot[k]);

        // 2.2 NEW: Calculate Total Gross Protected Area (Including Marine)
        let totalPaArea = 0;
        const processedUniquePas = new Set();
        pasInUnitList.forEach(paName => {
            const normPaName = this.normalizeForMatch(paName);
            if (processedUniquePas.has(normPaName)) return;
            processedUniquePas.add(normPaName);
            
            const paGlobalStats = normalizedPasRoot[normPaName];
            if (paGlobalStats) {
                totalPaArea += (paGlobalStats.area_ha || 0);
            }
        });

        const results = {
            totalPaArea,
            bosque: { total: 0, protected: 0, ecosystems: [] },
            agro: { total: 0, protected: 0, ecosystems: [] },
            otros: { total: 0, protected: 0, ecosystems: [] }
        };

        // 3. Process each ecosystem in the unit (Total Area)
        ecosSourceList.forEach(item => {
            const ha = item.ha || 0;
            const label = item.label || 'Unknown';
            
            // EXCLUSIÓN CRÍTICA: Zonas Urbanas no se consideran para el balance de conservación natural
            const ecoCat = this.getEcoCategory(label);
            if (ecoCat === 'Zonas Urbanas') return;

            let cat = 'otros';
            if (this.isForest(label)) cat = 'bosque';
            else if (ecoCat === 'Sistema Agropecuario') cat = 'agro';
            
            results[cat].total += ha;
            results[cat].ecosystems.push({
                name: label,
                totalHa: ha,
                protectedHa: 0,
                percent: 0
            });
        });

        // 4. Calculate Protected Habitat (High-Fidelity Cross-Reference)
        pasInUnitList.forEach(paName => {
            const normPaName = this.normalizeForMatch(paName);
            const paGlobalStats = normalizedPasRoot[normPaName];
            
            if (paGlobalStats) {
                const targetEcos = paGlobalStats.ecos || paGlobalStats;
                const paArea = paGlobalStats.area_ha || 0;
                
                // PREVENT INFLATION: Calculate internal scaling factor to restrict corrupted unbounded ecosystem sizes to true PA bounds
                let sumRawEcos = 0;
                Object.keys(targetEcos).forEach(k => {
                    if (typeof targetEcos[k] === 'number') sumRawEcos += targetEcos[k];
                });
                const scaleFactor = (sumRawEcos > 0 && paArea > 0) ? (paArea / sumRawEcos) : 1;
                
                // Pre-calculate normalized keys for this PA's ecosystems
                const paEcosMap = {};
                Object.keys(targetEcos).forEach(k => {
                    if (typeof targetEcos[k] === 'number') {
                        paEcosMap[this.normalizeForMatch(k)] = targetEcos[k] * scaleFactor;
                    }
                });

                const allEcos = results.bosque.ecosystems.concat(results.agro.ecosystems, results.otros.ecosystems);
                allEcos.forEach(eco => {
                    const normEcoName = this.normalizeForMatch(eco.name);
                    const ecoContribution = paEcosMap[normEcoName] || 0;
                    if (ecoContribution > 0) {
                        eco.protectedHa += ecoContribution;
                    }
                });
            }
        });

        // Reset global protected counters to be derived solely from bounded ecosystem values
        results.bosque.protected = 0;
        results.agro.protected = 0;
        results.otros.protected = 0;

        results.bosque.ecosystems.concat(results.agro.ecosystems, results.otros.ecosystems).forEach(eco => {
            if (eco.protectedHa > eco.totalHa) eco.protectedHa = eco.totalHa;
            eco.percent = eco.totalHa > 0 ? (eco.protectedHa / eco.totalHa) * 100 : 0;
            
            // Add precisely bounded values to global aggregates
            if (this.isForest(eco.name)) {
                results.bosque.protected += eco.protectedHa;
            } else if (this.getEcoCategory(eco.name) === 'Sistema Agropecuario') {
                results.agro.protected += eco.protectedHa;
            } else {
                results.otros.protected += eco.protectedHa;
            }
        });

        // 5. Add Deforestation Pressure & Priority Logic
        let totalLoss = 0;
        const lossStats = state.forestLossStats;
        if (lossStats) {
            let lossEntry = null;
            const isRegional = !iso || iso === 'ALL';
            
            if (isRegional) lossEntry = lossStats.regional;
            else if (level === 2) {
                const mid = code.includes('-') ? code : `${iso}-${code}`;
                lossEntry = lossStats.by_admin2?.[mid];
            } else if (level === 1) {
                const aid = code.includes('-') ? code : `${iso}-${code}`;
                lossEntry = lossStats.by_admin1?.[aid];
            } else {
                lossEntry = lossStats.by_country?.[iso];
            }

            if (lossEntry) {
                const pData = lossEntry.periods || lossEntry; // Handle different nesting
                totalLoss = Object.values(pData).reduce((a, b) => typeof b === 'number' ? a + b : a, 0);
            }
        }

        // Priority Logic (Semaphore)
        const target = this.conservationTarget;
        const currentProtPct = (results.bosque.protected + results.agro.protected + results.otros.protected) / results.totalAreaUnit * 100;
        const gap = target - currentProtPct;
        
        // Define "High Pressure" threshold contextually
        let isHighPressure = false;
        if (!iso) isHighPressure = totalLoss > 50000; // Regional
        else if (level === 0) isHighPressure = totalLoss > 5000; // Pais
        else isHighPressure = totalLoss > 500; // Dept/Muni

        let priority = { label: 'Estable / Cumplido', color: '#22c55e', desc: 'La unidad cumple sus metas y el entorno es estable.' };
        if (gap > 10 && isHighPressure) {
            priority = { label: 'Crítico', color: '#ef4444', desc: 'Urgencia Máxima: déficit de protección y pérdida forestal activa.' };
        } else if (gap <= 10 && isHighPressure) {
            priority = { label: 'Alerta de Retroceso', color: '#f97316', desc: 'Riesgo: se está perdiendo bosque en una zona ya casi protegida.' };
        } else if (gap > 10 && !isHighPressure) {
            priority = { label: 'Atención Preventiva', color: '#facc15', desc: 'Oportunidad: bajo déficit de presión pero falta protección formal.' };
        }

        results.priority = priority;
        results.totalLossHa = totalLoss;

        // 6. Add metadata for UI
        results.totalAreaUnit = results.bosque.total + results.agro.total + results.otros.total;
        
        // Dynamic name resolution
        let unitName = 'SICA Región (Centroamérica y R.D.)';
        if (iso && iso !== 'ALL') {
            const hierarchy = state.adminHierarchy[iso] || {};
            if (level === 2 && code) {
                // Find muni name in hierarchy
                Object.values(hierarchy.admin1 || {}).forEach(dept => {
                    if (dept.admin2 && dept.admin2[code]) unitName = dept.admin2[code];
                });
            } else if (level === 1 && code) {
                unitName = hierarchy.admin1?.[code]?.name || code;
            } else {
                unitName = hierarchy.name || iso;
            }
        }
        results.unitName = unitName;

        return results;
    }

    _initializeRegionalRanking() {
        if (this.regionalRankingMap) return;
        
        const ecoAggregates = {};
        const lossStats = state.forestLossStats?.regional?.ecosystems || {};
        
        // 1. Aggregate area and protection status at regional level
        if (state.adminStats && state.adminStats.pais && state.adminStats.pais.ecos) {
            Object.values(state.adminStats.pais.ecos).forEach(countryEcos => {
                countryEcos.forEach(e => {
                    if (!ecoAggregates[e.label]) {
                        ecoAggregates[e.label] = { name: e.label, totalHa: 0, protectedHa: 0 };
                    }
                    ecoAggregates[e.label].totalHa += (e.ha || 0);
                });
            });

            // 2. Aggregate actual protection across countries to get real regional percentages
            // (Using the same aggregation logic as AdminApp.calculateIntegratedStats for level 0)
            const sortedList = Object.values(ecoAggregates).map(e => {
                const normName = this.normalizeForMatch(e.name);
                const eLossData = lossStats[Object.keys(lossStats).find(k => this.normalizeForMatch(k) === normName)] || 0;
                const eLoss = (typeof eLossData === 'object') ? (eLossData.total || 0) : eLossData;
                
                // For ranking purposes, we use a synthesized risk profile based on regional loss and area
                // Since protectedHa isn't pre-aggregated per eco at this stage, we rely on the Loss Pressure 
                // and the resulting StatusLabel to define the Ranking.
                const risk = this.calculateEcosystemRisk(e.name, 15, eLoss, e.totalHa);
                
                // Severity Score for sorting
                const priorityRank = risk.id === 'critico' ? 0 : (risk.id === 'alerta' ? 1 : (risk.id === 'atencion' ? 2 : 3));
                const collapseRank = risk.statusLabel === 'Colapsado' ? 0 : 
                                    (risk.statusLabel === 'Inminente' ? 1 : 
                                    (risk.statusLabel === 'Proyectado' ? 2 : 
                                    (risk.statusLabel === 'Vulnerable' ? 3 : 4)));
                
                return {
                    name: e.name,
                    normName,
                    priorityRank,
                    collapseRank,
                    lossPct: risk.estimatedLossPct || 0
                };
            }).sort((a, b) => 
                a.priorityRank - b.priorityRank || 
                a.collapseRank - b.collapseRank || 
                b.lossPct - a.lossPct
            );

            this.regionalRankingMap = {};
            sortedList.forEach((e, idx) => {
                this.regionalRankingMap[e.normName] = idx + 1;
            });
        }
    }

    updateIntegratedView() {
        const results = this.calculateIntegratedStats();
        // Update sticky header
        const totalPctEl = document.getElementById('integrated-total-pct');
        if (totalPctEl && results && results.totalAreaUnit > 0) {
             const totalProt = results.bosque.protected + results.agro.protected + results.otros.protected;
             const pctProt = (totalProt / results.totalAreaUnit) * 100;
             totalPctEl.innerText = pctProt.toFixed(1) + "%";
        }

        const container = document.getElementById('integrated-sub-render');
        if (!container) return;

        // Update name in UI respecting DOM exception rule
        const nameEl = document.getElementById('integrated-unit-name');
        if (nameEl) {
            const country = document.getElementById('admin-country')?.value;
            let dName = results ? cleanEncoding(results.unitName) : '...';
            if (country === 'DOM') {
                dName = "Sin datos de ecosistema para la unidad administrativa seleccionada";
            } else if (dName === "Centroamérica y República Dominicana" || dName === "SICA Región (Centroamérica y R.D.)") {
                dName = "Centroamérica";
            }
            nameEl.innerText = dName;
        }

        if (!results) {
            container.innerHTML = '<div class="empty-state" style="padding:40px; text-align:center; opacity:0.3;"><i class="fas fa-search-location" style="font-size:2rem; margin-bottom:10px;"></i><p>Seleccione una unidad administrativa.</p></div>';
            return;
        }

        switch(this.currentIntegratedSubTab) {
            case 'gaps': this.renderIntegratedBrechas(results, container); break;
            case 'relative': this.renderIntegratedRelative(results, container); break;
        }
    }

    renderIntegratedBrechas(data, container) {
        const target = this.conservationTarget;
        const lossThreshold = parseFloat(document.getElementById('integrated-loss-threshold')?.value) || 5;
        const collapseThreshold = parseFloat(document.getElementById('integrated-collapse-threshold')?.value) || 20;
        const currentYear = new Date().getFullYear();

        // Process all ecosystems and calculate individual risk
        const allEcos = [...data.bosque.ecosystems, ...data.agro.ecosystems, ...data.otros.ecosystems]
            .map(e => {
                let eLoss = 0;
                let ePeriods = {};
                const iso = document.getElementById('admin-country')?.value;
                const level = state.currentLevel;
                const code = (level === 2) ? document.getElementById('admin-muni')?.value : 
                             (level === 1) ? document.getElementById('admin-dept')?.value : null;
                
                const lossStats = state.forestLossStats;
                if (lossStats) {
                    const unitLoss = this._resolveLossStatsUnit(lossStats, iso, level, code);
                    
                    if (unitLoss && unitLoss.ecosystems) {
                        const normE = this.normalizeForMatch(e.name);
                        const statsKey = Object.keys(unitLoss.ecosystems).find(k => this.normalizeForMatch(k) === normE);
                        
                        if (statsKey) {
                            const eData = unitLoss.ecosystems[statsKey];
                            eLoss = (typeof eData === 'object') ? (eData.total || 0) : eData;
                            ePeriods = (typeof eData === 'object') ? (eData.periods || {}) : {};
                        }
                    }
                }

                // 1 & 2. RISK ANALYSIS & COLLAPSE PROJECTION (Centralized Logic)
                const risk = this.calculateEcosystemRisk(e.name, e.percent, eLoss, e.totalHa);
                const ePriority = { label: risk.label, color: risk.color, rank: risk.id === 'critico' ? 0 : (risk.id === 'alerta' ? 1 : 2) };
                
                const estimatedLossPct = risk.estimatedLossPct || 0;
                const eGap = risk.gap || 0;

                let collapseYear = risk.statusLabel === 'Colapsado' ? 'Colapsado' : 
                                  (risk.yearsToLimit !== null && risk.yearsToLimit < 50 ? `Inminente (${currentYear + risk.yearsToLimit})` : 
                                   risk.yearsToLimit !== null && risk.yearsToLimit < 200 ? `Proyectado (${currentYear + risk.yearsToLimit})` :
                                   risk.statusLabel === 'Vulnerable' ? 'Vulnerabilidad por Desprotección' : 'Sin riesgo de colapso');
                
                let collapseStatus = (risk.yearsToLimit !== null && risk.yearsToLimit < 50) || risk.statusLabel === 'Colapsado' ? 'critical' : 
                                     (risk.yearsToLimit !== null && risk.yearsToLimit < 200) || risk.statusLabel === 'Vulnerable' ? 'warning' : 'stable';


                const ecoId = `eco-${this.normalizeForMatch(e.name).substring(0,10)}-${Math.random().toString(36).substr(2, 5)}`;

                // Group for counting summary mapping exactly to statusLabel
                let collapseCat = "sin_riesgo";
                if (risk.statusLabel === "Colapsado") collapseCat = "colapsado";
                else if (risk.statusLabel === "Inminente") collapseCat = "inminente";
                else if (risk.statusLabel === "Proyectado") collapseCat = "proyectado";
                else if (risk.statusLabel === "Vulnerable") collapseCat = "vulnerable";

                return { ...e, eLoss, ePeriods, estimatedLossPct, ePriority, eGap, collapseYear, collapseStatus, collapseCat, ecoId };
            })
            .sort((a, b) => a.ePriority.rank - b.ePriority.rank || b.estimatedLossPct - a.estimatedLossPct);

        // --- NEW: Risk level diagnostics summary ---
        const totalEcos = allEcos.length;
        const count = (label) => allEcos.filter(e => e.ePriority.label === label).length;
        const crit = count('Crítico');
        const alert = count('Alerta');
        const attend = count('Atención');
        const stable = count('Estable');

        // Risk Category Counts
        const countRisk = (cat) => allEcos.filter(e => e.collapseCat === cat).length;
        const rCol = countRisk('colapsado');
        const rInm = countRisk('inminente');
        const rPro = countRisk('proyectado');
        const rVul = countRisk('vulnerable');
        const rSRi = countRisk('sin_riesgo');

        const getPct = (c) => totalEcos > 0 ? (c / totalEcos) * 100 : 0;

        const html = `
            <!-- Integrated Diagnostic Card (Dual System v3.2) -->
            <div class="stat-card-integrated" style="margin-bottom:20px; border-left:4px solid ${crit > 0 ? '#ef4444' : (attend > 0 ? '#f97316' : '#22c55e')}; position:relative; padding:15px; border-radius:12px; background:rgba(15, 23, 42, 0.6);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <p style="font-size:0.65rem; color:#fff; margin:0; text-transform:uppercase; font-weight:800; letter-spacing:0.8px;">Diagnóstico de Ecosistemas</p>
                    
                    <details style="display:inline-block;">
                        <summary style="font-size:0.55rem; color:#3b82f6; cursor:pointer; font-weight:600; outline:none; user-select:none; list-style:none;">
                            <i class="fas fa-info-circle" style="margin-right:2px;"></i>Ver explicación
                        </summary>
                        <div style="margin-top:10px; background:#1e293b; padding:12px; border-radius:10px; font-size:0.65rem; color:var(--gray); line-height:1.4; border:1px solid #3b82f6; width:340px; position:absolute; right:12px; z-index:100; box-shadow:0 15px 40px rgba(0,0,0,0.8);">
                            <p style="margin:0 0 10px 0; color:#fff; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;"><i class="fas fa-microscope" style="margin-right:5px; color:#3b82f6;"></i>Metodología de Análisis v3.2</p>
                            <p style="margin:8px 0 3px 0; color:#3b82f6; font-weight:700; text-transform:uppercase; font-size:0.55rem;">1. Prioridad de Gestión (Estado Actual)</p>
                            Cruza déficit de protección hoy con presión forestal:
                            <ul style="margin:5px 0 10px 15px; padding:0; list-style:square;">
                                <li><b>Crítico/Alerta:</b> Déficit alto y/o presión activa.</li>
                                <li><b>Atención:</b> Desprotegido pero estable hoy.</li>
                                <li><b>Estable:</b> Bajo déficit y sin pérdida reciente.</li>
                            </ul>
                            <p style="margin:10px 0 3px 0; color:#f97316; font-weight:700; text-transform:uppercase; font-size:0.55rem;">2. Riesgo de Colapso (Proyección a 200 años)</p>
                            Calcula cuándo se superará el umbral crítico:
                            <ul style="margin:5px 0 0 15px; padding:0; list-style:square;">
                                <li><b>Colapsado/Inminente:</b> Umbral superado o <50 años para el fin.</li>
                                <li><b>Proyectado:</b> Entre 50 y 200 años para el colapso.</li>
                                <li><b>Vulnerable:</b> Sin protección legal (0%) o desbalanceado.</li>
                            </ul>
                        </div>
                    </details>
                </div>

                <!-- SYSTEM 1: MANAGEMENT PRIORITY -->
                <div style="margin-bottom:20px;">
                    <p style="font-size:0.55rem; color:var(--gray); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.8;">1. Nivel de Prioridad (Urgencia Estructural)</p>
                    <div style="display:flex; height:8px; border-radius:10px; overflow:hidden; background:rgba(255,255,255,0.05); margin-bottom:8px;">
                        <div style="width:${getPct(crit)}%; background:#ef4444;" title="Crítico: ${crit}"></div>
                        <div style="width:${getPct(alert)}%; background:#f87171;" title="Alerta: ${alert}"></div>
                        <div style="width:${getPct(attend)}%; background:#f97316;" title="Atención: ${attend}"></div>
                        <div style="width:${getPct(stable)}%; background:#22c55e;" title="Estable: ${stable}"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <span style="font-size:0.5rem; color:#ef4444; font-weight:700;">${crit} CRÍTICO</span>
                        <span style="font-size:0.5rem; color:#f87171; font-weight:700;">${alert} ALERTA</span>
                        <span style="font-size:0.5rem; color:#f97316; font-weight:700;">${attend} ATENCIÓN</span>
                        <span style="font-size:0.5rem; color:#22c55e; font-weight:700;">${stable} ESTABLE</span>
                    </div>
                </div>

                <div style="border-top:1px solid rgba(255,255,255,0.05); margin-bottom:15px;"></div>

                <!-- SYSTEM 2: COLLAPSE RISK -->
                <div>
                    <p style="font-size:0.55rem; color:var(--gray); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.8;">2. Riesgo de Colapso (Proyección Temporal)</p>
                    <div style="display:flex; height:8px; border-radius:10px; overflow:hidden; background:rgba(255,255,255,0.05); margin-bottom:8px;">
                        <div style="width:${getPct(rCol)}%; background:#7f1d1d;" title="Colapsado: ${rCol}"></div>
                        <div style="width:${getPct(rInm)}%; background:#ef4444;" title="Inminente: ${rInm}"></div>
                        <div style="width:${getPct(rPro)}%; background:#f87171;" title="Proyectado: ${rPro}"></div>
                        <div style="width:${getPct(rVul)}%; background:#fbbf24;" title="Vulnerable: ${rVul}"></div>
                        <div style="width:${getPct(rSRi)}%; background:#10b981;" title="Sin Riesgo: ${rSRi}"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <span style="font-size:0.5rem; color:#7f1d1d; font-weight:700;">${rCol} COLAPSADO</span>
                        <span style="font-size:0.5rem; color:#ef4444; font-weight:700;">${rInm} INMINENTE</span>
                        <span style="font-size:0.5rem; color:#f87171; font-weight:700;">${rPro} PROYECTADO</span>
                        <span style="font-size:0.5rem; color:#f59e0b; font-weight:700;">${rVul} VULNERABLE</span>
                        <span style="font-size:0.5rem; color:#10b981; font-weight:700;">${rSRi} ESTABLE</span>
                    </div>
                </div>
            </div>
            
            <div style="padding-right:5px; margin-top:20px;">
                ${allEcos.length > 0 ? allEcos.map(e => `
                    <div class="stat-card-integrated" style="padding:10px; border-left:4px solid ${e.ePriority.color}; cursor:pointer; transition: background 0.2s; margin-bottom:8px; position:relative;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'" onclick="window.adminAppInstance.toggleEcoCollapseChart('${e.ecoId}', ${JSON.stringify(e).replace(/"/g, '&quot;')})">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px;">
                            <span style="font-size:0.75rem; font-weight:700; max-width:70%; line-height:1.2;">${cleanEncoding(e.name)}</span>
                            <span class="detail-badge" style="background:${e.ePriority.color}; color:#fff; font-size:0.55rem; padding:2px 6px; border-radius:4px; font-weight:800; text-transform:uppercase; box-shadow:0 0 8px ${e.ePriority.color}44;">
                                ${e.ePriority.label}
                            </span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--gray);">
                            <span>Pérdida: <b style="color:#ef4444;">${formatNumber(e.eLoss)} ha (${e.estimatedLossPct.toFixed(1)}%)</b></span>
                            <b style="color:${e.collapseStatus === 'critical' ? '#ef4444' : (e.collapseStatus === 'warning' ? '#f97316' : (e.collapseStatus === 'stable' ? '#22c55e' : '#3b82f6'))}; font-weight:800; border-bottom:1px dotted;">${e.collapseYear}</b>
                        </div>

                        <div style="height:4px; background:rgba(255,255,255,0.05); border-radius:3px; display:flex; margin-top:8px;">
                            <div style="height:100%; width:${Math.min(100, (e.percent/target)*100)}%; background:#10b981; border-radius:3px 0 0 3px;"></div>
                            <div style="height:100%; width:${Math.max(0, ((target - e.percent)/target)*100)}%; background:#ef4444; border-radius:0 3px 3px 0;"></div>
                        </div>
                        <div style="font-size:0.55rem; margin-top:5px; font-weight:600; display:flex; justify-content:space-between;">
                            <span style="color:#10b981;">${e.percent.toFixed(1)}% Protegido</span>
                            <span style="color:${e.eGap <= 0 ? '#10b981' : e.ePriority.color}; text-align:right;">
                                ${e.eGap <= 0 ? 'Meta Cumplida' : 'Déficit: ' + e.eGap.toFixed(1) + '%'}
                            </span>
                        </div>

                        <!-- Panel de Gráfico Expansible -->
                        <div id="chart-container-${e.ecoId}" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.05); height:180px;">
                            <canvas id="chart-${e.ecoId}"></canvas>
                        </div>
                    </div>
                `).join('') : '<div style="padding:20px; text-align:center; color:var(--gray);">No hay ecosistemas para analizar.</div>'}
            </div>
        `;
        container.innerHTML = html;
    }

    renderIntegratedRelative(data, container) {
        const totalUnit = data.totalAreaUnit;
        const totalProt = data.bosque.protected + data.agro.protected + data.otros.protected;
        const pctProt = totalUnit > 0 ? (totalProt / totalUnit) * 100 : 0;
        
        const nativeForestPct = totalUnit > 0 ? (data.bosque.total / totalUnit) * 100 : 0;
        const nativeAgroPct = totalUnit > 0 ? (data.agro.total / totalUnit) * 100 : 0;
        const nativeOtherPct = totalUnit > 0 ? (data.otros.total / totalUnit) * 100 : 0;

        const forestRepPct = data.bosque.total > 0 ? (data.bosque.protected / data.bosque.total) * 100 : 0;
        const agroRepPct = data.agro.total > 0 ? (data.agro.protected / data.agro.total) * 100 : 0;
        const otherRepPct = data.otros.total > 0 ? (data.otros.protected / data.otros.total) * 100 : 0;

        const target = this.conservationTarget;
        
        const fIsMet = forestRepPct >= target;
        const fColor = fIsMet ? '#10b981' : '#ef4444'; 

        const aIsMet = agroRepPct >= target;
        const aColor = aIsMet ? '#10b981' : '#ef4444'; 

        const oIsMet = otherRepPct >= target;
        const oColor = oIsMet ? '#10b981' : '#ef4444'; 

        const renderAccordion = (ecosList) => {
            if (!ecosList || ecosList.length === 0) return '';
            const validEcos = ecosList.filter(e => e.totalHa > 0).sort((a,b) => b.totalHa - a.totalHa);
            if (validEcos.length === 0) return '';

            const listHtml = validEcos.map(e => `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding:4px 0; cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'" onclick="window.adminAppInstance.isolateEcosystem('${cleanEncoding(e.name).replace(/'/g, "\\'")}')">
                    <span style="font-size:0.65rem; color:#d1d5db; flex:1; padding-left:4px;">${e.name}</span>
                    <span style="font-size:0.6rem; color:var(--gray); width:65px; text-align:right;">${formatNumber(e.totalHa)} ha</span>
                    <span style="font-size:0.65rem; font-weight:700; color:${e.percent >= target ? '#10b981' : '#ef4444'}; width:45px; text-align:right;">${e.percent.toFixed(1)}%</span>
                </div>
            `).join('');

            return `
                <details style="margin-top:12px;">
                    <summary style="font-size:0.65rem; color:#3b82f6; cursor:pointer; font-weight:600; outline:none; user-select:none;">
                        <i class="fas fa-search-plus" style="margin-right:4px; font-size:0.55rem;"></i>Ver ecosistemas incluidos
                    </summary>
                    <div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.15); border-radius:6px; border:1px solid rgba(255,255,255,0.05); max-height:150px; overflow-y:auto;">
                        <div style="display:flex; justify-content:space-between; font-size:0.55rem; color:#9ca3af; text-transform:uppercase; margin-bottom:5px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1);">
                            <span style="flex:1">Nombre del Ecosistema</span>
                            <span style="width:65px; text-align:right;">Territorio</span>
                            <span style="width:45px; text-align:right;">Protegido</span>
                        </div>
                        ${listHtml}
                    </div>
                </details>
            `;
        };

        const html = `
            <!-- Pregunta 1 -->
            <div class="question-header" style="margin-top:15px;">1. ¿Cómo se distribuye la superficie protegida de la unidad territorial analizada?</div>
            <div class="question-description">Proporción física de áreas protegidas frente a la extensión territorial total.</div>
            
            <div class="stat-card-integrated" style="text-align:center; padding:15px; margin-bottom:20px;">
                <p style="font-size:0.6rem; color:var(--gray); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px; opacity:0.6;">Superficie Protegida Terrestre</p>
                <div style="font-size:1.8rem; font-weight:800; color:var(--primary); letter-spacing:-0.5px;">${pctProt.toFixed(1)}%</div>
                <p style="font-size:0.55rem; color:var(--gray); text-transform:uppercase; letter-spacing:0.5px; opacity:0.5; margin-top:5px;">${formatNumber(totalProt)} ha de ${formatNumber(totalUnit)} ha totales</p>
            </div>

            <!-- Pregunta 2 -->
            <div class="question-header" style="border-left-color:#3b82f6;">2. ¿Cómo se distribuyen los ecosistemas dentro de la unidad territorial analizada?</div>
            <div class="question-description">Cobertura original de grupos de ecosistemas (con y sin área protegida) cruzando toda la unidad geográfica.</div>

            <div style="display:flex; height:12px; border-radius:10px; overflow:hidden; background:rgba(255,255,255,0.05); margin-bottom:15px;">
                <div style="width:${nativeForestPct}%; background:#22c55e;" title="Bosque: ${nativeForestPct.toFixed(1)}%"></div>
                <div style="width:${nativeAgroPct}%; background:#eab308;" title="Agro: ${nativeAgroPct.toFixed(1)}%"></div>
                <div style="width:${nativeOtherPct}%; background:#9ca3af;" title="Otros: ${nativeOtherPct.toFixed(1)}%"></div>
            </div>

            <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
                <div style="display:flex; align-items:center;">
                    <div style="width:8px; height:8px; border-radius:2px; background:#22c55e; margin-right:8px;"></div>
                    <span style="font-size:0.55rem; color:#fff; flex:1; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Ecosistemas de Bosque (${nativeForestPct.toFixed(1)}%)</span>
                    <span style="font-size:0.6rem; font-weight:800; color:var(--gray); letter-spacing:0.5px;">${formatNumber(data.bosque.total)} HA</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <div style="width:8px; height:8px; border-radius:2px; background:#eab308; margin-right:8px;"></div>
                    <span style="font-size:0.55rem; color:#fff; flex:1; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Sistemas Agropecuarios (${nativeAgroPct.toFixed(1)}%)</span>
                    <span style="font-size:0.6rem; font-weight:800; color:var(--gray); letter-spacing:0.5px;">${formatNumber(data.agro.total)} HA</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <div style="width:8px; height:8px; border-radius:2px; background:#9ca3af; margin-right:8px;"></div>
                    <span style="font-size:0.55rem; color:#fff; flex:1; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Otros Ecosistemas (${nativeOtherPct.toFixed(1)}%)</span>
                    <span style="font-size:0.6rem; font-weight:800; color:var(--gray); letter-spacing:0.5px;">${formatNumber(data.otros.total)} HA</span>
                </div>
            </div>

            <!-- Pregunta 3 -->
            <div class="question-header" style="margin-top:25px; border-left-color:#10b981;">3. ¿Qué porcentaje de los ecosistemas naturales está dentro de áreas protegidas?</div>
            <div class="question-description">Representatividad Ecológica: del 100% que existe en territorio, cuánto está resguardado legalmente frente a la meta objetivo de conservación definida.</div>

            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:15px;">
                <div class="stat-card-integrated">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <span style="font-size:0.7rem; color:#fff; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Ecosistemas de Bosque</span>
                        <span style="font-size:0.85rem; font-weight:900; color:${fColor};">${forestRepPct.toFixed(1)}%</span>
                    </div>
                    <div class="integrated-bar-container">
                        <div class="integrated-bar-wrapper">
                             <div class="integrated-bar-fill" style="width:${Math.min(100, forestRepPct)}%; background:${fColor}; box-shadow:0 0 12px ${fColor}88;"></div>
                        </div>
                        <div class="integrated-target-line" style="left:${target}%;"></div>
                    </div>
                    ${fIsMet 
                        ? `<p style="font-size:0.55rem; color:#10b981; margin-top:8px; margin-bottom:0; text-transform:uppercase; font-weight:700;"><i class="fas fa-check-circle" style="margin-right:4px;"></i> Meta superada por ${(forestRepPct - target).toFixed(1)}%</p>`
                        : `<p style="font-size:0.55rem; color:#ef4444; margin-top:8px; margin-bottom:0; text-transform:uppercase; font-weight:700;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i> Brecha: Faltan ${(target - forestRepPct).toFixed(1)}%</p>`
                    }
                    ${renderAccordion(data.bosque.ecosystems)}
                </div>
                
                <div class="stat-card-integrated">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <span style="font-size:0.7rem; color:#fff; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Otros Ecosistemas</span>
                        <span style="font-size:0.85rem; font-weight:900; color:${oColor};">${otherRepPct.toFixed(1)}%</span>
                    </div>
                    <div class="integrated-bar-container">
                        <div class="integrated-bar-wrapper">
                             <div class="integrated-bar-fill" style="width:${Math.min(100, otherRepPct)}%; background:${oColor}; box-shadow:0 0 12px ${oColor}88;"></div>
                        </div>
                        <div class="integrated-target-line" style="left:${target}%;"></div>
                    </div>
                    ${oIsMet 
                        ? `<p style="font-size:0.55rem; color:#10b981; margin-top:8px; margin-bottom:0; text-transform:uppercase; font-weight:700;"><i class="fas fa-check-circle" style="margin-right:4px;"></i> Meta superada por ${(otherRepPct - target).toFixed(1)}%</p>`
                        : `<p style="font-size:0.55rem; color:#ef4444; margin-top:8px; margin-bottom:0; text-transform:uppercase; font-weight:700;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i> Brecha: Faltan ${(target - otherRepPct).toFixed(1)}%</p>`
                    }
                    ${renderAccordion(data.otros.ecosystems)}
                </div>
            </div>
        `;
        container.innerHTML = html;
    }

    // High-Fidelity Integrated Popup Handler
    handleMapClick(e) {
        if (state.currentDashTab !== 'integrated') return;
        
        const latlng = e.latlng;
        // Turf expects [lng, lat]
        const point = turf.point([latlng.lng, latlng.lat]);
        
        let ecoFeature = null;
        let paFeature = null;
        
        // 1. Find Ecosystem at point
        if (coreMap.ecosLayer) {
            coreMap.ecosLayer.eachLayer(l => {
                if (l.feature && turf.booleanPointInPolygon(point, l.feature)) {
                    ecoFeature = l.feature;
                }
            });
        }
        
        // 2. Find Protected Area at point
        if (coreMap.paGroup) {
            coreMap.paGroup.eachLayer(geoJsonLayer => {
                if (geoJsonLayer.eachLayer) {
                    geoJsonLayer.eachLayer(l => {
                        if (l.feature && turf.booleanPointInPolygon(point, l.feature)) {
                            paFeature = l.feature;
                        }
                    });
                }
            });
        }
        
        if (!ecoFeature && !paFeature) return;
        
        const ecoProps = ecoFeature?.properties || {};
        const paProps = paFeature?.properties || {};

        // 3. Risk Calculation for this specific point
        let ecoRisk = { label: 'Sin datos', color: '#94a3b8' };
        if (ecoFeature) {
            const ecoName = ecoProps.LEYENDA || ecoProps.DESCRIP || ecoProps.ecosistema || '';
            const integratedStats = this.calculateIntegratedStats();
            const target = parseFloat(document.getElementById('integrated-target-val')?.value) || 30;
            const lossThreshold = parseFloat(document.getElementById('integrated-loss-threshold')?.value) || 5;
            const collapseThreshold = parseFloat(document.getElementById('integrated-collapse-threshold')?.value) || 20;

            // Busca el ecosistema usando normalización para evitar fallos por IDs o caracteres
            const allEcos = integratedStats ? [...integratedStats.bosque.ecosystems, ...integratedStats.agro.ecosystems, ...integratedStats.otros.ecosystems] : [];
            const normEcoName = this.normalizeForMatch(ecoName);
            const e = allEcos.find(item => this.normalizeForMatch(item.name) === normEcoName);

            if (e) {
                let eLoss = 0;
                const iso = document.getElementById('admin-country')?.value;
                const level = state.currentLevel;
                const code = (level === 2) ? document.getElementById('admin-muni')?.value : (level === 1) ? document.getElementById('admin-dept')?.value : null;
                const lossStats = state.forestLossStats;
                
                if (lossStats) {
                    const unitLoss = this._resolveLossStatsUnit(lossStats, iso, level, code);
                    
                    if (unitLoss && unitLoss.ecosystems) {
                        const statsKey = Object.keys(unitLoss.ecosystems).find(k => this.normalizeForMatch(k) === normEcoName);
                        if (statsKey) {
                            const eData = unitLoss.ecosystems[statsKey];
                            eLoss = (typeof eData === 'object') ? (eData.total || 0) : eData;
                        }
                    }
                }

                const eGap = target - e.percent;
                const estimatedLossPct = (e.totalHa + eLoss) > 0 ? (eLoss / (e.totalHa + eLoss)) * 100 : 0;
                const eIsHighPressure = estimatedLossPct >= lossThreshold;

                if (eGap > 10 && eIsHighPressure) ecoRisk = { label: 'CRÍTICO', color: '#ef4444' };
                else if (eGap <= 10 && eIsHighPressure) ecoRisk = { label: 'ALERTA', color: '#ef4444' };
                else if (eGap > 10 && !eIsHighPressure) ecoRisk = { label: 'ATENCIÓN', color: '#f97316' };
                else ecoRisk = { label: 'ESTABLE', color: '#22c55e' };

                // --- COLLAPSE LOGIC v3.0 REPLICATION ---
                const annualLossRate = eLoss / 20; 
                const criticalSurface = (e.totalHa + eLoss) * (collapseThreshold / 100);
                const currentYear = new Date().getFullYear();
                
                if (e.totalHa <= criticalSurface) {
                    ecoRisk.collapseYear = "Colapsado";
                    ecoRisk.collapseColor = "#ef4444";
                } else if (annualLossRate <= 0) {
                    if (e.percent === 0) {
                        ecoRisk.collapseYear = "Vulnerable (Sin Protec.)";
                        ecoRisk.collapseColor = "#f97316";
                    } else {
                        ecoRisk.collapseYear = "Conservación Estable";
                        ecoRisk.collapseColor = "#22c55e";
                    }
                } else {
                    const yearsToCollapse = (e.totalHa - criticalSurface) / annualLossRate;
                    const projYear = Math.floor(currentYear + yearsToCollapse);
                    
                    if (yearsToCollapse < 50) {
                        ecoRisk.collapseYear = `Riesgo Crítico (${projYear})`;
                        ecoRisk.collapseColor = "#ef4444";
                    } else if (yearsToCollapse < 200) {
                        ecoRisk.collapseYear = `Riesgo Proyectado (${projYear})`;
                        ecoRisk.collapseColor = "#f97316";
                    } else {
                        ecoRisk.collapseYear = "Estable (200+ años)";
                        ecoRisk.collapseColor = "#22c55e";
                    }
                }

                // Exclusión de áreas antropizadas
                const isAntropic = normEcoName.includes('agropecuario') || 
                                  normEcoName.includes('urbana') || 
                                  normEcoName.includes('poblado') ||
                                  normEcoName.includes('asfalt') ||
                                  normEcoName.includes('infraestructura');
                
                if (isAntropic) {
                    ecoRisk = { label: 'USO HUMANO / ANTROPIZADO', color: '#64748b', collapseYear: 'N/A', collapseColor: '#64748b' };
                }
            }
        }

        // 4. Build Unified Ultra-Compact Popup
        const popupContent = createPremiumPopupHTML({
            title: ecoProps.LEYENDA || ecoProps.DESCRIP || ecoProps.ecosistema || 'N/A',
            subtitle: '',
            badge: ecoRisk.label,
            badgeColor: ecoRisk.color,
            themeColor: 'linear-gradient(90deg, #10b981, #3b82f6)',
            bodyHTML: `
                <div style="display:flex; gap:8px; align-items:flex-start; opacity: ${paFeature ? 1 : 0.5}; padding-top:4px;">
                    <i class="fas fa-shield-alt" style="font-size:0.6rem; color:#10b981; margin-top:2px;"></i>
                    <div style="font-size:0.65rem; font-weight:600; color:#cbd5e1; line-height:1.2;">
                        <span style="color:var(--gray); font-weight:700;">Área protegida:</span> 
                        ${paFeature ? cleanEncoding(paProps.NOMBRE || paProps.Nombre_AP || paProps.nombre || paProps.ORIG_NAME || 'Área Protegida') : 'Sin Protección'}
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:2px; margin-top:4px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.05);">
                    <div style="text-align:center; font-size:0.6rem;">
                        <span style="color:${ecoRisk.collapseColor || '#3b82f6'}; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">
                            ${ecoRisk.collapseYear || 'Sin datos'}
                        </span>
                    </div>
                </div>
            `
        });

        const p = L.popup({ maxWidth: 220, className: 'premium-popup-wrap', closeButton: true })
            .setLatLng(latlng)
            .setContent(popupContent);
        
        p.openOn(coreMap.map);
    }

    downloadDiagnostics() {
        const report = {
            timestamp: new Date().toISOString(),
            app: 'AdminApp',
            state: {
                currentApp: state.currentApp,
                currentDashTab: state.currentDashTab,
                adminHierarchyKeys: Object.keys(state.adminHierarchy || {}),
                adminStatsStatus: !!state.adminStats,
                paStatsCount: Object.keys(fullData.paStats?.pas || {}).length
            },
            currentSelection: {
                country: document.getElementById('admin-country')?.value,
                dept: document.getElementById('admin-dept')?.value,
                muni: document.getElementById('admin-muni')?.value
            },
            dataSummary: {
                hnd_dept_keys_sample: Object.keys(state.adminStats?.dept?.pas || {}).slice(0, 10),
                hnd_muni_keys_sample: Object.keys(state.adminStats?.muni?.pas || {}).filter(k => k.startsWith('HND')).slice(0, 10),
                ecos_keys_dept: Object.keys(state.adminStats?.dept?.ecos || {}).slice(0, 10),
                ecos_search_result: !!(this.calculateIntegratedStats())
            },
            domStatus: {
                detailPanel: !!document.getElementById('detail-panel'),
                accordionList: !!document.getElementById('pa-accordion-list'),
                integratedRender: !!document.getElementById('integrated-sub-render')
            }
        };

        const json = JSON.stringify(report, null, 2);
        try {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `diagnostico_sica_2002_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch(err) {
            const win = window.open("", "_blank");
            win.document.write("<pre>" + json + "</pre>");
        }
    }

    // --- FOREST LOSS ANALYTICS ---

    async updateLossView() {
        const country = document.getElementById('admin-country')?.value || '';
        const dept = document.getElementById('admin-dept')?.value || '';
        const muni = document.getElementById('admin-muni')?.value || '';

        const statusEl = document.getElementById('loss-loading-status');
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-sync fa-spin"></i> Sincronizando datos forestales...';
            statusEl.style.display = 'block';
        }

        showLoader(true);

        try {
            // Bypass cache to ensure fresh data
            const v = Date.now();
            if (!fullData.forestLossData) {
                const statsRes = await fetch(`../web_data/forest_loss_stats.json?v=${v}`);
                if (!statsRes.ok) throw new Error("Error HTTP " + statsRes.status + " en forest_loss_stats.json");
                fullData.forestLossData = await statsRes.json();
            }

            if (!state.forestLossHeatmapPoints) {
                const heatmapRes = await fetch(`../web_data/forest_loss_heatmap.json?v=${v}`);
                if (!heatmapRes.ok) throw new Error("Error HTTP " + heatmapRes.status + " en forest_loss_heatmap.json");
                state.forestLossHeatmapPoints = await heatmapRes.json();
            }

            // FAULT ISOLATION: Render charts first, they are lightweight and safe
            this.renderLossCharts(country, dept, muni);

            // Render heatmap with a slight delay and a strict memory limit
            setTimeout(() => {
                try {
                    this.toggleLossHeatmap(true);
                } catch (heatErr) {
                    console.error("[ERROR] Fallo en Heatmap (GPU/Memoria):", heatErr);
                }
                if (statusEl) statusEl.style.display = 'none';
                showLoader(false);
            }, 500);

        } catch (e) {
            if (statusEl) statusEl.style.display = 'none';
            showLoader(false);
        }
    }

    renderLossCharts(iso, deptId, muniId) {
        if (!fullData.forestLossData) return;
        const stats = fullData.forestLossData;
        let data = stats.regional;
        let ecData = {};
        let unitName = "Centroamérica";

        if (muniId && stats.by_admin2 && stats.by_admin2[muniId]) {
            data = stats.by_admin2[muniId].periods || stats.by_admin2[muniId];
            ecData = stats.by_admin2[muniId].ecosystems || {};
            unitName = this._lastAdminName;
        } else if (deptId && stats.by_admin1 && stats.by_admin1[deptId]) {
            data = stats.by_admin1[deptId].periods || stats.by_admin1[deptId];
            ecData = stats.by_admin1[deptId].ecosystems || {};
            unitName = this._lastAdminName;
        } else if (iso && stats.by_country && stats.by_country[iso]) {
            data = stats.by_country[iso].periods || {};
            ecData = stats.by_country[iso].ecosystems || {};
            unitName = state.adminHierarchy[iso]?.name || iso;
        } else {
            // Regional fallback
            data = stats.regional.periods || {};
            ecData = stats.regional.ecosystems || {};
            unitName = "Centroamérica";
        }

        coreMap.destroyCharts();
        
        // Trend Chart (Line)
        const trendCtx = document.getElementById('lossTrendChart')?.getContext('2d');
        if (trendCtx) {
            const labels = Object.keys(data).sort();
            const values = labels.map(l => data[l]);

            coreMap.lossTrendChart = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Hectáreas Perdidas',
                        data: values,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 3,
                        pointBackgroundColor: '#ef4444'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `Pérdida: ${formatNumber(ctx.raw)} ha`
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
                    }
                }
            });
        }

        // Ecosystem Chart (Bar)
        const ecoCtx = document.getElementById('lossEcoChart')?.getContext('2d');
        if (ecoCtx && Object.keys(ecData).length > 0) {
            const labels = Object.keys(ecData).slice(0, 8);
            const values = labels.map(l => ecData[l]);

            coreMap.lossEcoChart = new Chart(ecoCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: '#ef4444',
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `Pérdida: ${formatNumber(ctx.raw)} ha`
                            }
                        }
                    },
                    scales: {
                        x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 9 } } },
                        y: { ticks: { color: '#f8fafc', font: { size: 9 }, callback: function(val, index) {
                            const label = this.getLabelForValue(val);
                            return label.length > 20 ? label.substr(0, 18) + '...' : label;
                        } } }
                    }
                }
            });
        }
    }

    toggleLossHeatmap(visible) {
        if (coreMap.heatLayer) {
            if (coreMap.map.hasLayer(coreMap.heatLayer)) {
                coreMap.map.removeLayer(coreMap.heatLayer);
            }
            coreMap.heatLayer = null;
        }

        if (!visible || !state.forestLossHeatmapPoints) return;

        const weightType = document.getElementById('loss-heatmap-weight')?.value || 'has';
        
        // Performance & Stability: Subsample if we have too many points (Leaflet.heat limit)
        // STRICT LIMIT: 40k points for maximum compatibility across all browsers
        let rawPoints = state.forestLossHeatmapPoints;
        const totalPoints = rawPoints.length;
        let step = 1;
        if (totalPoints > 40000) step = Math.ceil(totalPoints / 40000);

        const points = [];
        let maxWeight = 5; // Fixed max for better contrast

        for (let i = 0; i < totalPoints; i += step) {
            const p = rawPoints[i];
            const weight = (weightType === 'has') ? p[2] : 1;
            // Calibración de intensidad: Multiplicamos por 2 para que sea más visible
            points.push([p[0], p[1], weight * 2.0]);
        }

        coreMap.heatLayer = L.heatLayer(points, {
            radius: 12,
            blur: 15,
            maxZoom: 10,
            max: 5,
            gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1: 'red' }
        }).addTo(coreMap.map);

        // EXTRA STEP: Physically move the heatmap canvas to the 'heatmapPane' (Z:800)
        // Since L.heatLayer doesn't support 'pane' option natively.
        setTimeout(() => {
            const heatCanvas = document.querySelector('.leaflet-heatmap-layer');
            const targetPane = coreMap.map.getPane('heatmapPane');
            if (heatCanvas && targetPane) {
                targetPane.appendChild(heatCanvas);
                // Silenced log

            }
        }, 100);
    }

    onLossWeightChange() {
        this.toggleLossHeatmap(true);
    }

    // --- ISOLATION MASK SKILL (v1.0) ---
    isolateFeature(selectedValue, layerCollection) {
        if (!layerCollection) return;
        
        if (this._currentIsolatedFeature === selectedValue) {
            this.clearIsolation(layerCollection);
            return;
        }

        if (this._radarFlashInterval) {
            clearInterval(this._radarFlashInterval);
            this._radarFlashInterval = null;
        }

        this._currentIsolatedFeature = selectedValue;
        const targetSearch = (selectedValue || '').toLowerCase().trim();
        const flashLayers = [];

        layerCollection.eachLayer(layer => {
            const props = layer.feature.properties || {};
            const rawName = props.NOMBRE || props.LEYENDA || props.nombre || props.LEYENDA_20 || ''; 
            const cleanName = rawName.toLowerCase().trim();
            
            if (cleanName === targetSearch) {
                if (layer.bringToFront) layer.bringToFront();
                layer.setStyle({ fillOpacity: 0.9, opacity: 1, weight: 1.5, color: '#ffffff' });
                flashLayers.push(layer); 
            } else {
                layer.setStyle({ fillOpacity: 0.03, opacity: 0.05, weight: 0.1, color: '#0f172a' });
            }
        });

        if (flashLayers.length > 0) {
            let isFlashing = false;
            const isTest = false;
            this._ecoFlashInterval = setInterval(() => {
                isFlashing = !isFlashing;
                const newStyles = isFlashing 
                    ? { weight: 3, color: '#fbbf24', fillOpacity: isTest ? 0.6 : 1 }   
                    : { weight: 1.5, color: '#ffffff', fillOpacity: isTest ? 0.45 : 0.9 }; 
                
                flashLayers.forEach(layer => {
                    if (layer.setStyle) layer.setStyle(newStyles);
                });
            }, 750); 
            // Silenced log

        } else {
            // Silenced log

        }
    }

    clearIsolation(layerCollection) {
        this._currentIsolatedFeature = null;
        if (this._radarFlashInterval) {
            clearInterval(this._radarFlashInterval);
            this._radarFlashInterval = null;
        }
        if (!layerCollection) return;
        
        layerCollection.eachLayer(layer => {
            const p = layer.feature.properties;
            const label = p.NOMBRE || p.LEYENDA || p.LEYENDA_20 || '';
            layer.setStyle({ 
                fillOpacity: 0.8, 
                opacity: 1, 
                color: 'rgba(255,255,255,0.2)', // Border
                fillColor: getEcoColor(label),
                weight: 1 
            });
        });
    }

    toggleEcoCollapseChart(id, ecoData) {
        const container = document.getElementById(`chart-container-${id}`);
        if (!container) return;

        const isVisible = container.style.display !== 'none';
        
        // Cierre de otros gráficos abiertos para enfoque
        document.querySelectorAll('[id^="chart-container-"]').forEach(el => {
            if (el.id !== `chart-container-${id}`) el.style.display = 'none';
        });

        if (isVisible) {
            container.style.display = 'none';
            this.clearEcoIsolation();
        } else {
            container.style.display = 'block';
            this.renderEcosystemCollapseChart(id, ecoData);
            this.isolateEcosystem(ecoData.name);
        }
    }

    renderEcosystemCollapseChart(id, eco) {
        const canvas = document.getElementById(`chart-${id}`);
        if (!canvas) return;

        const existingChart = Chart.getChart(canvas);
        if (existingChart) existingChart.destroy();

        const periods = eco.ePeriods || {};
        const labels = Object.keys(periods).sort();
        
        // Calculate dynamic surface decline
        let surfaceFlow = eco.totalHa + eco.eLoss;
        const historySurfaces = [surfaceFlow];
        const historyLabels = ['2001'];

        labels.forEach(p => {
            const loss = periods[p] || 0;
            surfaceFlow -= loss;
            historySurfaces.push(surfaceFlow);
            historyLabels.push(p.split('-')[1]); // End of period
        });

        // Projection
        const annualLoss = eco.eLoss / 20; 
        const currentYear = new Date().getFullYear();
        const projectionYears = [];
        const projectionValues = [];
        
        let remSurface = eco.totalHa;
        const thresholdPct = parseFloat(document.getElementById('integrated-collapse-threshold')?.value) || 20;
        const originalTotal = (eco.totalHa + eco.eLoss);
        const criticalSurface = originalTotal * (thresholdPct / 100);

        projectionYears.push(currentYear.toString());
        projectionValues.push(remSurface);

        if (annualLoss > 0) {
            let pYear = currentYear + 10;
            while (remSurface > criticalSurface && pYear <= 2100) {
                remSurface -= (annualLoss * 10);
                projectionYears.push(pYear.toString());
                projectionValues.push(Math.max(criticalSurface, remSurface));
                pYear += 10;
            }
        }

        new Chart(canvas, {
            type: 'line',
            data: {
                labels: [...historyLabels, ...projectionYears],
                datasets: [
                    {
                        label: 'Pérdida histórica',
                        data: historySurfaces,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Pérdida proyectada',
                        data: Array(historySurfaces.length).fill(null).concat(projectionValues),
                        borderColor: '#f59e0b',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.3
                    },
                    {
                        label: 'Superficie protegida',
                        data: Array(historyLabels.length + projectionYears.length).fill(originalTotal * (eco.percent/100)),
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        fill: false,
                        borderDash: [3, 3]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    legend: { 
                        display: true, 
                        position: 'bottom',
                        align: 'center',
                        labels: {
                            color: '#e2e8f0',
                            usePointStyle: true,
                            pointStyle: 'line',
                            font: { size: 9, weight: 'bold' },
                            padding: 8
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.raw).toLocaleString()} ha`
                        }
                    }
                },
                scales: {
                    y: { 
                        beginAtZero: false, 
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8', font: { size: 9 } }
                    },
                    x: { 
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 8 } }
                    }
                }
            }
        });
    }

    generateNarrativeReport() {
        const modal = document.getElementById('report-modal');
        const content = document.getElementById('report-content');
        if (!modal || !content) return;

        // 1. CONTEXT RESOLUTION
        const iso = document.getElementById('admin-country')?.value || 'ALL';
        const dVal = document.getElementById('admin-dept')?.value;
        const mVal = document.getElementById('admin-muni')?.value;
        const level = (iso === 'ALL') ? 0 : (dVal ? (mVal ? 2 : 1) : 0);
        const rawCode = (level === 2) ? mVal : (level === 1) ? dVal : null;
        const code = (iso === 'ALL') ? null : this.resolveUnitId(iso, level, rawCode);

        let unitName = (iso === 'ALL') ? "Centroamérica" : "Selección";
        let locText = "Región SICA";

        if (iso !== 'ALL') {
            const countryMeta = state.adminHierarchy[iso];
            const countryName = countryMeta?.name || iso;
            if (level === 2 && code) {
                // Seek name in hierarchy recursively
                for (const dId in countryMeta.admin1) {
                    const dept = countryMeta.admin1[dId];
                    if (dept.admin2 && dept.admin2[code]) {
                        unitName = dept.admin2[code];
                        locText = `${dept.name}, ${countryName}`;
                        break;
                    }
                }
                // Fallback for names if not found in hierarchy as code
                if (unitName === "Selección" || unitName === code) {
                    const mSelect = document.getElementById('admin-muni');
                    if (mSelect && mSelect.selectedIndex > 0) {
                        unitName = mSelect.options[mSelect.selectedIndex].text;
                        const dSelect = document.getElementById('admin-dept');
                        locText = `${dSelect?.options[dSelect.selectedIndex]?.text || ''}, ${countryName}`;
                    }
                }
            } else if (level === 1 && code) {
                unitName = countryMeta.admin1[code]?.name || code;
                locText = countryName;
            } else {
                unitName = countryName;
                locText = "Centroamérica";
            }
        }
        unitName = typeof cleanEncoding === 'function' ? cleanEncoding(unitName) : unitName;
        locText = typeof cleanEncoding === 'function' ? cleanEncoding(locText) : locText;

        // 2. DATA AGGREGATION & CROSS-REFERENCE (High-Fidelity Engine)
        const intStats = this.calculateIntegratedStats(iso, level, code);
        if (!intStats || !intStats.totalAreaUnit) {
            content.innerHTML = `<div style="text-align:center; padding:100px; color:#64748b;">DATOS NO DISPONIBLES</div>`;
            modal.style.display = 'flex';
            return;
        }

        const stats = {
            totalAreaUnit: intStats.totalAreaUnit,
            totalPaArea: intStats.totalPaArea,
            bosque: { total: intStats.bosque.total, ha: intStats.bosque.total, protected: intStats.bosque.protected, items: intStats.bosque.ecosystems },
            agro: { total: intStats.agro.total, ha: intStats.agro.total, protected: intStats.agro.protected, items: intStats.agro.ecosystems },
            otros: { total: intStats.otros.total, ha: intStats.otros.total, protected: intStats.otros.protected, items: intStats.otros.ecosystems }
        };

        const totalProtLand = stats.bosque.protected + stats.agro.protected + stats.otros.protected;
        const totalProtTotal = stats.totalPaArea;
        const protPctLand = (totalProtLand / (stats.totalAreaUnit || 1)) * 100;
        const protPctBosque = (stats.bosque.protected / (stats.bosque.total || 1)) * 100;
        const protPctOtros = (stats.otros.protected / (stats.otros.total || 1)) * 100;
        
        // --- DYNAMIC PARAMETER RESOLUTION ---
        const target = this.conservationTarget || 30;
        const lossThreshold = parseFloat(document.getElementById('integrated-loss-threshold')?.value) || 5;
        const collapseThreshold = parseFloat(document.getElementById('integrated-collapse-threshold')?.value) || 20;

        // Visual Scale Adjustment (Representing 0-Target range in 100% of the bar width)
        const vPctLand = Math.min(100, (protPctLand / target) * 100);
        const vGapLand = Math.max(0, 100 - vPctLand);
        const vPctBosque = Math.min(100, (protPctBosque / target) * 100);
        const vGapBosque = Math.max(0, 100 - vPctBosque);
        const vPctOtros = Math.min(100, (protPctOtros / target) * 100);
        const vGapOtros = Math.max(0, 100 - vPctOtros);

        const lossStats = state.forestLossStats;
        const unitLoss = this._resolveLossStatsUnit(lossStats, iso, level, code);
        let totalLossHa = 0;
        
        // Ensure Regional Ranking is initialized once
        if (!this.regionalRankingMap) {
            this._initializeRegionalRanking();
        }

        if (unitLoss) {
            const pData = unitLoss.periods || unitLoss;
            totalLossHa = Object.values(pData).reduce((a, b) => typeof b === 'number' ? a + b : a, 0);
        }

        // Global unit pressure (for categorization)
        const unitTotalArea = stats.totalAreaUnit || 1;
        const unitLossPct = (totalLossHa / unitTotalArea) * 100;
        const unitProtGap = target - protPctLand;

        const priorityCounts = { critico: 0, alerta: 0, atencion: 0, estable: 0 };
        const collapseCounts = { Colapsado: 0, Inminente: 0, Proyectado: 0, Vulnerable: 0, Estable: 0 };
        const currentYear = new Date().getFullYear();
        let totalYearsLimit = 0;
        let countWithProjection = 0;

        // 3. ECOSYSTEM PROCESSING (High-Fidelity Source)
        const allEcosRaw = [...stats.bosque.items, ...stats.agro.items, ...stats.otros.items];
        const allEcos = allEcosRaw.map(e => {
            const name = e.name;
            let eLoss = 0;
            let ePeriods = {};
            if (unitLoss?.ecosystems) {
                const normE = this.normalizeForMatch(name);
                let eData = unitLoss.ecosystems[name] || unitLoss.ecosystems[normE];
                if (!eData) {
                    const statsKey = Object.keys(unitLoss.ecosystems).find(k => this.normalizeForMatch(k) === normE);
                    if (statsKey) eData = unitLoss.ecosystems[statsKey];
                }
                if (eData) {
                    eLoss = (typeof eData === 'object') ? (eData.total || 0) : eData;
                    ePeriods = (typeof eData === 'object') ? (eData.periods || {}) : {};
                }
            }

            const risk = this.calculateEcosystemRisk(name, e.percent, eLoss, e.totalHa);
            
            // Replicating dashboard sub-tab counting logic (lines 3035-3053)
            let statusLabel = risk.statusLabel;
            let displayLabel = statusLabel;
            
            if (risk.yearsToLimit !== null) {
                if (risk.yearsToLimit < 50) displayLabel = `Inminente (${currentYear + risk.yearsToLimit})`;
                else if (risk.yearsToLimit < 200) displayLabel = `Proyectado (${currentYear + risk.yearsToLimit})`;
            } else if (statusLabel === 'Vulnerable') {
                displayLabel = 'Vulnerabilidad por Desprotección';
            }

            if (risk.id !== 'humano') {
                if (priorityCounts[risk.id] !== undefined) priorityCounts[risk.id]++;
                // Dashboard consistency: priority is Time-based, then Vulnerability if no projection
                if (collapseCounts[statusLabel] !== undefined) collapseCounts[statusLabel]++;
                if (risk.yearsToLimit !== null) { totalYearsLimit += risk.yearsToLimit; countWithProjection++; }
            } else {
                collapseCounts['Estable']++;
            }

            // Get regional ranking position
            const regionalRank = this.regionalRankingMap?.[this.normalizeForMatch(name)] || '-';

            return {
                ecoId: `eco-${this.normalizeForMatch(name).substring(0,8)}-${Math.random().toString(36).substr(2,4)}`,
                name, percent: e.percent, totalHa: e.totalHa, eLoss, ePeriods,
                lossPct: risk.estimatedLossPct || 0, priorityId: risk.id, priorityLabel: risk.label,
                rank: risk.id === 'critico' ? 0 : (risk.id === 'alerta' ? 1 : (risk.id === 'atencion' ? 2 : 3)),
                eGap: risk.gap || 0, collapse: statusLabel, collapseFull: displayLabel, annualRate: risk.annualRate || (eLoss / 20),
                regionalRank
            };
        });

        // 4. SORTING AND SUMMARY
        const priorityAnnexList = allEcos.filter(e => e.priorityId !== 'humano').sort((a,b) => {
            const rA = parseInt(a.regionalRank) || 999;
            const rB = parseInt(b.regionalRank) || 999;
            return rA - rB;
        });
        const mostAffectedEcos = [...allEcos].sort((a,b) => b.eLoss - a.eLoss).slice(0, 3);
        const avgResilience = countWithProjection > 0 ? (totalYearsLimit / countWithProjection).toFixed(1) : "N/D";

        // --- Cálculo de métricas grupales (Consolidado Bosques vs Otros) ---
        let forestLossTotal = 0, forestInitialTotal = 0;
        let otherLossTotal = 0, otherInitialTotal = 0;

        if (unitLoss && unitLoss.ecosystems) {
            Object.entries(unitLoss.ecosystems).forEach(([ecoName, data]) => {
                const loss = (typeof data === 'object') ? (data.total || 0) : data;
                const cat = this.getEcoCategory(ecoName);
                if (cat === 'Ecosistemas de Bosques') forestLossTotal += loss;
                else otherLossTotal += loss;
            });
        }
        const diffEcosTotal = totalLossHa - (forestLossTotal + otherLossTotal);
        if (diffEcosTotal > 0.01) otherLossTotal += diffEcosTotal;

        allEcos.forEach(e => {
            const cat = this.getEcoCategory(e.name);
            if (cat === 'Ecosistemas de Bosques') {
                forestInitialTotal += e.totalHa;
            } else if (cat !== 'Zonas Urbanas' && cat !== 'Sistema Agropecuario') {
                // Solo incluimos otros ecosistemas NATURALES (no agro, no urbano)
                otherInitialTotal += e.totalHa;
            }
        });

        const forestLossGroupPct = forestInitialTotal > 0 ? (forestLossTotal / forestInitialTotal) * 100 : 0;
        const otherLossGroupPct = otherInitialTotal > 0 ? (otherLossTotal / otherInitialTotal) * 100 : 0;

        let globalStatus = 'stable';
        let statusLabel = 'Conservación Estable';
        let statusDesc = 'La unidad presenta indicadores de resiliencia aceptables.';
        
        // Critical: Presence of critical ecos OR very low protection (less than half the target)
        if (priorityCounts.critico > 0 || protPctLand < (target / 2)) {
            globalStatus = 'critical'; statusLabel = 'ESTADO CRÍTICO';
            statusDesc = `${priorityCounts.critico > 0 ? `${priorityCounts.critico} ecosistemas en riesgo de colapso` : 'Brecha extrema de protección territorial'} identificada (ver anexo).`;
        } else if (priorityCounts.alerta > 0 || unitLossPct > lossThreshold) {
            globalStatus = 'warning'; statusLabel = 'ALERTA PREVENTIVA';
            statusDesc = `${priorityCounts.alerta > 0 ? `${priorityCounts.alerta} ecosistemas con tendencias de pérdida` : 'Presión forestal regional'} por encima del umbral de seguridad (${lossThreshold}%).`;
        }

        // 5. RECOMMENDATIONS ENGINE (New Section)
        let recommendations = [];
        if (priorityCounts.critico > 0) {
            recommendations.push({ title: "Acción Prioritaria Inmediata", text: "Establecer perímetros de vigilancia en los ecosistemas con riesgo de colapso inminente para detener la degradación." });
            recommendations.push({ title: "Refuerzo Legal", text: "Evaluar la declaratoria de veda o protección especial para las unidades críticas identificadas en el anexo." });
        }
        if (protPctLand < target) {
            recommendations.push({ title: "Aumento de Cobertura", text: `La brecha de protección terrestre es del ${(target - protPctLand).toFixed(1)}%. Se recomienda identificar áreas de conectividad biológica fuera de los límites de las AP actuales.` });
        }
        if (totalLossHa > 1000) {
            recommendations.push({ title: "Restauración Ecológica", text: "Promover programas de restauración activa en los núcleos de mayor pérdida histórica (2001-2020)." });
        }
        if (recommendations.length === 0) {
            recommendations.push({ title: "Monitoreo Preventivo", text: "Continuar con el seguimiento satelital anual para asegurar que los ecosistemas estables mantengan su resiliencia." });
        }

        // 6. MAIN HTML GENERATION
        let html = `
            <div class="report-page">
                <div style="text-align:center; margin-bottom:25px; border-bottom:3px solid var(--primary); padding-bottom:15px;">
                    <img src="img/logo_ccad.png" style="height:50px; margin-bottom:10px;" alt="Logo CCAD" onerror="this.style.display='none'">
                    <h1 style="margin:0; font-size:0.85rem; color:#64748b; font-weight:900; text-transform:uppercase; letter-spacing:1px;">OBSERVATORIO AMBIENTAL REGIONAL (OAR)</h1>
                    <p style="margin:5px 0 0 0; color:#1e40af; font-weight:700; text-transform:uppercase; font-size:1.2rem;">ANÁLISIS DEL ESTADO DE PROTECCIÓN Y NIVEL DE RIESGO DE LOS ECOSISTEMAS</p>
                    <div style="margin-top:20px; padding-top:15px; border-top:1px solid #e2e8f0;">
                         <p style="margin:0; color:#0f172a; font-weight:900; font-size:1.9rem; line-height:1;">REPORTE ${unitName.toUpperCase()}</p>
                         <p style="margin:8px 0 0 0; color:#475569; font-weight:600; font-size:1rem;">${locText}</p>
                    </div>
                </div>

                <div class="urgency-banner ${globalStatus}">
                    <div class="urgency-badge bg-${globalStatus}">${statusLabel}</div>
                    <p style="margin:0; font-weight:800; color:#0f172a;">${statusDesc}</p>
                </div>

                <section class="report-section">
                    <h3>1. RESUMEN DE LA UNIDAD TERRITORIAL</h3>
                    <div style="display:flex; gap:25px; align-items:flex-start;">
                        <div style="flex: 1.4;">
                            <p style="font-size:0.8rem; color:#475569; margin-bottom:15px; line-height:1.5;">
                                La unidad territorial <strong>${unitName}</strong> posee una extensión total de <strong>${formatNumber(stats.totalAreaUnit)} ha</strong>. 
                                A continuación se desglosa su composición según grandes grupos de ecosistemas:
                            </p>
                            <p style="font-size:0.75rem; color:#475569; margin-bottom:12px; line-height:1.5;">
                                • <strong>Ecosistemas de Bosques:</strong> Cubren <strong>${formatNumber(stats.bosque.total)} ha</strong> (${((stats.bosque.total / stats.totalAreaUnit) * 100).toFixed(1)}%). 
                                Esta categoría agrupa ecosistemas con estructura boscosa (como <em>Manglares, Bosques Latifoliados y Bosques de Coníferas</em>) y se refiere a su clasificación ecológica funcional.
                            </p>
                            <p style="font-size:0.75rem; color:#475569; margin-bottom:12px; line-height:1.5;">
                                • <strong>Otros Ecosistemas Naturales:</strong> Representan <strong>${formatNumber(stats.otros.total)} ha</strong> (${((stats.otros.total / stats.totalAreaUnit) * 100).toFixed(1)}%). 
                                Incluye formaciones como <em>Sabanas, Humedales, Matorrales y Herbazales</em>.
                            </p>
                            <p style="font-size:0.75rem; color:#475569; margin-bottom:0; line-height:1.5;">
                                • <strong>Sistemas Agropecuarios:</strong> Abarcan <strong>${formatNumber(stats.agro.total)} ha</strong> (${((stats.agro.total / stats.totalAreaUnit) * 100).toFixed(1)}%). 
                                Comprende áreas transformadas para actividades de agricultura, ganadería y asentamientos humanos.
                            </p>
                        </div>
                        <div style="flex: 0.6; min-width: 210px; text-align: center; background: #f8fafc; border-radius: 12px; padding: 15px; border: 1px solid #e2e8f0;">
                            <h4 style="margin: 0 0 10px 0; font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Distribución de Ecosistemas</h4>
                            <div style="height: 240px; position: relative;">
                                <canvas id="ecosystem-composition-chart"></canvas>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="report-section">
                    <h3>2. ESTADO DE PROTECCIÓN</h3>
                    <div class="report-grid" style="grid-template-columns: repeat(3, 1fr);">
                        <div class="report-card">
                            <span class="label">Superficie Total Protegida (Terrestre y Marina)</span>
                            <span class="value">${formatNumber(totalProtTotal)} ha</span>
                        </div>
                        <div class="report-card">
                            <span class="label">Superficie Protegida Terrestre</span>
                            <span class="value">${formatNumber(totalProtLand)} ha</span>
                        </div>
                        <div class="report-card">
                            <span class="label">Nivel de Protección Terrestre Global</span>
                            <span class="value" style="color:${protPctLand < 15 ? '#ef4444' : (protPctLand < 30 ? '#f59e0b' : '#10b981')};">${protPctLand.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div style="margin-top:30px; background:#f8fafc; padding:25px; border-radius:15px; border:1px solid #e2e8f0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #e2e8f0; padding-bottom:12px; margin-bottom:25px;">
                            <h4 style="margin:0; font-size:0.85rem; color:#1e293b; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; display:flex; align-items:center; gap:10px;">
                                <span style="background:#10b981; width:12px; height:12px; border-radius:3px;"></span>
                                ANÁLISIS DE BRECHA DE CONSERVACIÓN
                            </h4>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:0.65rem; color:#0f172a; font-weight:900; background:#fff; padding:4px 12px; border-radius:6px; border:1px solid #cbd5e1; display:flex; align-items:center; gap:6px;">
                                    <div style="width:2px; height:12px; background:#0f172a;"></div>
                                    Meta de Protección Regional (${target}%)
                                </span>
                            </div>
                        </div>

                        <div style="display:flex; gap:40px; align-items: stretch;">
                            <!-- COLUMN LEFT: BARS -->
                            <div style="flex:1;">
                                <!-- 1. TOTAL TERRESTRE -->
                                <div style="margin-bottom:30px;">
                                    <span style="font-size:0.7rem; color:#475569; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">1. Protección Terrestre Total</span>
                                    <div style="display:flex; margin-bottom:6px;">
                                        <div style="width:${vPctLand}%; color:#10b981; font-size:0.6rem; font-weight:800; text-align:left;">
                                            ${protPctLand.toFixed(1)}% PROTEGIDO
                                        </div>
                                        ${protPctLand < target ? `
                                        <div style="width:${vGapLand}%; color:#ef4444; font-size:0.6rem; font-weight:800; text-align:right;">
                                            BRECHA ${(target - protPctLand).toFixed(1)}%
                                        </div>
                                        ` : ''}
                                    </div>
                                    <div style="position:relative; width:100%; height:12px; background:#e2e8f0; border-radius:6px; overflow:visible;">
                                        <div style="width:${vPctLand}%; height:100%; background:#10b981; border-radius:6px 0 0 6px;"></div>
                                        ${protPctLand < target ? `
                                        <div style="position:absolute; left:${vPctLand}%; width:${vGapLand}%; height:100%; background:#ef4444; opacity:0.6;"></div>
                                        ` : ''}
                                        <div style="position:absolute; right:0; top:-3px; width:2px; height:18px; background:#0f172a; z-index:10;" title="Meta ${target}%"></div>
                                    </div>
                                </div>

                                <!-- 2. BOSQUES -->
                                <div style="margin-bottom:30px;">
                                    <span style="font-size:0.7rem; color:#475569; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">2. Ecosistemas de Bosques</span>
                                    <div style="display:flex; margin-bottom:6px;">
                                        <div style="width:${vPctBosque}%; color:#10b981; font-size:0.6rem; font-weight:800; text-align:left;">
                                            ${protPctBosque.toFixed(1)}% PROTEGIDO
                                        </div>
                                        ${protPctBosque < target ? `
                                        <div style="width:${vGapBosque}%; color:#ef4444; font-size:0.6rem; font-weight:800; text-align:right;">
                                            BRECHA ${(target - protPctBosque).toFixed(1)}%
                                        </div>
                                        ` : ''}
                                    </div>
                                    <div style="position:relative; width:100%; height:12px; background:#e2e8f0; border-radius:6px; overflow:visible;">
                                        <div style="width:${vPctBosque}%; height:100%; background:#10b981; border-radius:6px 0 0 6px;"></div>
                                        ${protPctBosque < target ? `
                                        <div style="position:absolute; left:${vPctBosque}%; width:${vGapBosque}%; height:100%; background:#ef4444; opacity:0.6;"></div>
                                        ` : ''}
                                        <div style="position:absolute; right:0; top:-3px; width:2px; height:18px; background:#0f172a; z-index:10;" title="Meta ${target}%"></div>
                                    </div>
                                </div>

                                <!-- 3. OTROS NATURALES -->
                                <div style="margin-bottom:10px;">
                                    <span style="font-size:0.7rem; color:#475569; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">3. Otros Ecosistemas Naturales</span>
                                    <div style="display:flex; margin-bottom:6px;">
                                        <div style="width:${vPctOtros}%; color:#10b981; font-size:0.6rem; font-weight:800; text-align:left;">
                                            ${protPctOtros.toFixed(1)}% PROTEGIDO
                                        </div>
                                        ${protPctOtros < target ? `
                                        <div style="width:${vGapOtros}%; color:#ef4444; font-size:0.6rem; font-weight:800; text-align:right;">
                                            BRECHA ${(target - protPctOtros).toFixed(1)}%
                                        </div>
                                        ` : ''}
                                    </div>
                                    <div style="position:relative; width:100%; height:12px; background:#e2e8f0; border-radius:6px; overflow:visible;">
                                        <div style="width:${vPctOtros}%; height:100%; background:#10b981; border-radius:6px 0 0 6px;"></div>
                                        ${protPctOtros < 30 ? `
                                        <div style="position:absolute; left:${vPctOtros}%; width:${vGapOtros}%; height:100%; background:#ef4444; opacity:0.6;"></div>
                                        ` : ''}
                                        <div style="position:absolute; right:0; top:-3px; width:2px; height:18px; background:#0f172a; z-index:10;" title="Meta 30%"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- COLUMN RIGHT: DESCRIPTION -->
                            <div style="flex:1; border-left:1px solid #e2e8f0; padding-left:40px; display:flex; flex-direction:column; justify-content:center;">
                                <h5 style="margin:0 0 12px 0; font-size: 0.7rem; color:#64748b; text-transform:uppercase;">Evaluación Diagnóstica</h5>
                                <p style="font-size:0.75rem; color:#334155; line-height:1.7; margin:0;">
                                    El análisis de brecha para <strong>${unitName}</strong> revela un nivel de protección terrestre consolidado del <strong>${protPctLand.toFixed(1)}%</strong>. 
                                    ${protPctLand >= target ? `La unidad ya ha superado el umbral regional del ${target}% en su superficie total.` : `Aún restan <strong>${(target - protPctLand).toFixed(1)} puntos porcentuales</strong> para alcanzar la meta establecida en el Marco Mundial de Biodiversidad.`}
                                    <br><br>
                                    En cuanto a la representatividad ecosistémica: 
                                    ${(protPctBosque >= target && protPctOtros >= target) ? 
                                        `tanto los ecosistemas de <strong>Bosques</strong> (${protPctBosque.toFixed(1)}%) como las <strong>Otras Formaciones Naturales</strong> (${protPctOtros.toFixed(1)}%) cumplen con el umbral de protección trazado, garantizando la conservación de su biodiversidad típica.` :
                                      (protPctBosque >= target) ?
                                        `los <strong>Bosques</strong> están adecuadamente protegidos (${protPctBosque.toFixed(1)}%), pero se observa una brecha importante en <strong>Otras Formaciones Naturales</strong> (${(target - protPctOtros).toFixed(1)}%), lo que sugiere la necesidad de priorizar la protección de sabanas o humedales.` :
                                      (protPctOtros >= target) ?
                                        `las <strong>Otras Formaciones Naturales</strong> cumplen la meta (${protPctOtros.toFixed(1)}%), pero los <strong>Bosques</strong> presentan una brecha del <strong>${(target - protPctBosque).toFixed(1)}%</strong>, indicando una urgencia de crear corredores biológicos forestales.` :
                                        `ambos grupos (Bosques y Otros Naturales) presentan brechas significativas (${(target - protPctBosque).toFixed(1)}% y ${(target - protPctOtros).toFixed(1)}% respectivamente), señalando una necesidad prioritaria de expansión de la red de áreas protegidas.`}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <div class="report-page">
                <section class="report-section">
                    <h3>3. DINÁMICA DE PÉRDIDA (2001-2020) DE ECOSISTEMAS</h3>
                    <div style="display:grid; grid-template-columns: 0.85fr 1.15fr 1.3fr; gap:15px; align-items: stretch;">
                        <div class="report-card" style="background:#fffcfc; border-color:#fecaca; margin-bottom:0; display:flex; flex-direction:column; justify-content:center;">
                            <span class="label" style="font-size:0.5rem;">Pérdida Acumulada</span>
                            <span class="value" style="color:#ef4444; font-size:1.6rem;">${formatNumber(totalLossHa)} ha</span>
                        </div>

                        <div class="report-card" style="background:#fffcfc; border-color:#fecaca; margin-bottom:0; padding:15px; display:flex; flex-direction:column; justify-content:center;">
                            <h4 style="margin:0 0 12px 0; font-size:0.55rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Impacto en Superficie Inicial</h4>
                            
                            <!-- Barra Bosques -->
                            <div style="margin-bottom:15px;">
                                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                                    <span style="font-size:0.5rem; color:#1e293b; font-weight:800; text-transform:uppercase;">Ecosistemas de Bosques</span>
                                    <span style="font-size:0.5rem; color:#64748b; font-weight:700;">Total 2000: ${formatNumber(forestInitialTotal)} ha</span>
                                </div>
                                <div style="height:10px; background:#f1f5f9; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">
                                    <div style="width:${forestLossGroupPct.toFixed(2)}%; height:100%; background:#ef4444;"></div>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-weight:800; font-size:0.75rem; margin-top:4px;">
                                    <span style="color:#ef4444;">${formatNumber(forestLossTotal)} ha perdidas</span>
                                    <span style="color:#475569;">${forestLossGroupPct.toFixed(1)}% de impacto</span>
                                </div>
                            </div>

                            <!-- Barra Otros -->
                            <div>
                                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                                    <span style="font-size:0.5rem; color:#1e293b; font-weight:800; text-transform:uppercase;">Otros Ecosistemas</span>
                                    <span style="font-size:0.5rem; color:#64748b; font-weight:700;">Total 2000: ${formatNumber(otherInitialTotal)} ha</span>
                                </div>
                                <div style="height:10px; background:#f1f5f9; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">
                                    <div style="width:${otherLossGroupPct.toFixed(2)}%; height:100%; background:#94a3b8;"></div>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-weight:800; font-size:0.75rem; margin-top:4px;">
                                    <span style="color:#475569;">${formatNumber(otherLossTotal)} ha perdidas</span>
                                    <span style="color:#475569;">${otherLossGroupPct.toFixed(1)}% de impacto</span>
                                </div>
                            </div>
                        </div>

                        <div class="report-card" style="background:#f8fafc; border-color:#e2e8f0; margin-bottom:0; padding:12px;">
                            <h4 style="margin:0 0 8px 0; font-size:0.65rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Tendencia de Deforestación por Período (ha)</h4>
                            <div style="height:110px; position:relative;">
                                <canvas id="total-loss-trend"></canvas>
                            </div>
                        </div>
                    </div>

                    <h4 style="font-size:0.75rem; color:#64748b; margin-top:45px; text-transform:uppercase; border-top:1px solid #e2e8f0; padding-top:20px;">ECOSISTEMAS CON MAYORES PÉRDIDAS</h4>
                    <table class="report-table">
                        <thead><tr><th>Ecosistema</th><th style="text-align:right;">Pérdida (ha)</th><th style="text-align:center;">Tendencia Historica</th></tr></thead>
                        <tbody>
                            ${mostAffectedEcos.map((e, i) => `
                                <tr>
                                    <td style="font-size:0.75rem; font-weight:700;">${e.name}</td>
                                    <td style="text-align:right; color:#ef4444; font-weight:900;">${formatNumber(e.eLoss)}</td>
                                    <td style="width:260px; padding:12px 10px;">
                                        <div style="height:65px;"><canvas id="eco-spark-${i}"></canvas></div>
                                        <div id="eco-vals-bot-${i}" style="display:flex; justify-content:space-around; font-size:7.5px; color:#475569; margin-top:5px; font-weight:800; text-align:center;"></div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </section>

                <section class="report-section" style="margin-top:-20px;">
                    <h3>4. DIAGNÓSTICO INTEGRADO DE RIESGO DE ECOSISTEMAS</h3>
                    <div style="display:grid; grid-template-columns: 1.2fr 0.8fr; gap:20px;">
                        <div class="risk-stats-box">
                            <h4 style="margin:0 0 10px 0; font-size:0.75rem; color:#475569;">DISTRIBUCIÓN DE PRIORIDAD</h4>
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:5px; font-size:0.55rem; color:#64748b; font-weight:800; text-transform:uppercase;">
                                <span>Categoría</span>
                                <span>Cantidad de Ecosistemas</span>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#ef4444; font-weight:700;">Crítico (Déficit + Presión)</span>
                                    <span>${priorityCounts.critico}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#f97316; font-weight:700;">Alerta (Protegido + Presión)</span>
                                    <span>${priorityCounts.alerta}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#3b82f6; font-weight:700;">Atención (Déficit sin presión)</span>
                                    <span>${priorityCounts.atencion}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#10b981; font-weight:700;">Estable (Protegido y Seguro)</span>
                                    <span>${priorityCounts.estable}</span>
                                </div>
                            </div>
                        </div>
                        <div class="risk-stats-box">
                            <h4 style="margin:0 0 10px 0; font-size:0.75rem; color:#475569;">RIESGO DE COLAPSO</h4>
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:5px; font-size:0.55rem; color:#64748b; font-weight:800; text-transform:uppercase;">
                                <span>Riesgo</span>
                                <span>Cantidad de Ecosistemas</span>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#ef4444; font-weight:700;">Colapsado / Inminente (< 50 años)</span>
                                    <span>${collapseCounts.Colapsado + collapseCounts.Inminente}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#f97316; font-weight:700;">Proyectado (50 - 200 años)</span>
                                    <span>${collapseCounts.Proyectado}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#f59e0b; font-weight:700;">Vulnerable (Déficit de gestión)</span>
                                    <span>${collapseCounts.Vulnerable}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
                                    <span style="color:#10b981; font-weight:700;">Estable</span>
                                    <span>${collapseCounts.Estable}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="report-section">
                    <h3>5. RECOMENDACIONES ESTRATÉGICAS</h3>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        ${recommendations.map(r => `
                            <div class="recommendation-item">
                                <strong style="color:#0f172a; font-size:0.8rem; display:block; margin-bottom:2px;">${r.title}</strong>
                                <p style="margin:0; font-size:0.75rem; color:#475569; line-height:1.4;">${r.text}</p>
                            </div>
                        `).join('')}
                    </div>
                </section>
            </div>
        `;

        if (priorityAnnexList.length > 0) {
            const lossThreshold = parseFloat(document.getElementById('integrated-loss-threshold')?.value) || 5;
            html += `
                <div class="report-page" style="page-break-before:always;">
                    <div style="margin-bottom:20px; padding-bottom:10px; border-bottom:2px solid var(--primary);">
                        <h3 style="margin:0; font-size:1.2rem;">ANEXO: ESTADO DETALLADO DE ECOSISTEMAS ${(level === 0 ? 'DE ' : 'DEL ') + ((level === 1 ? (state.adminHierarchy[iso]?.admin1_type || 'Departamento') + ' DE ' : level === 2 ? (state.adminHierarchy[iso]?.admin2_type || 'Municipio') + ' DE ' : '') + unitName).toUpperCase()}</h3>
                    </div>
                    
                    <p style="font-size:0.7rem; color:#475569; margin-bottom:15px; font-style:italic; line-height:1.4;">
                        Este anexo detalla los indicadores de riesgo técnico para los ecosistemas naturales. 
                        La <strong>Prioridad de Conservación</strong> se asigna cruzando el déficit de cobertura legal con la presión de deforestación actual. 
                        El <strong>Estado y Nivel de Riesgo</strong> proyecta los años estimados hasta el colapso funcional (umbral crítico del ${collapseThreshold}%) mediante la extrapolación de tendencias históricas, integrando la vulnerabilidad por brechas estructurales de protección como un factor de alerta prioritaria.
                    </p>

                    <table class="report-table" style="font-size:0.6rem;">
                        <thead style="background:#f1f5f9;">
                            <tr>
                                <th style="border-radius:10px 0 0 0; text-align:center; width:50px;">Rank Reg.</th>
                                <th style="width:28%;">Ecosistema Natural</th>
                                <th style="text-align:center;">Prioridad de Conservación</th>
                                <th style="text-align:center;">Estado y Nivel de Riesgo</th>
                                <th style="text-align:right;">Porcentaje de Protección</th>
                                <th style="text-align:right;">Déficit de Protección</th>
                                <th style="text-align:right;">Pérdida 2001-2020 (ha)</th>
                                <th style="text-align:center; border-radius:0 10px 0 0; width:95px;">Tendencia deforestación</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${priorityAnnexList.map((e, idx) => `
                                <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                                    <td style="text-align:center; font-weight:700; color:#475569; font-size:0.75rem; border-right:1px solid #e2e8f0;">${e.regionalRank}</td>
                                    <td style="font-weight:700; color:#1e293b; font-size:0.7rem;">
                                        ${e.name}
                                        <div style="font-weight:400; color:#64748b; font-size:0.55rem; margin-top:2px;">
                                            Area 2000: ${formatNumber(e.totalHa)} ha | Afectado: ${e.lossPct.toFixed(1)}%
                                        </div>
                                    </td>
                                    <td style="text-align:center;">
                                        <span class="risk-pill ${e.priorityId === 'critico' ? 'critical' : (e.priorityId === 'alerta' ? 'warning' : 'attention')}">
                                            ${e.priorityLabel}
                                        </span>
                                    </td>
                                    <td style="text-align:center; font-weight:800; font-size:0.6rem; color:${e.collapse === 'Inminente' || e.collapse === 'Colapsado' ? '#ef4444' : (e.collapse === 'Proyectado' ? '#f59e0b' : (e.collapse === 'Vulnerable' ? '#d97706' : (e.collapse === 'Estable' ? '#10b981' : '#1e293b')))};">
                                        ${e.collapseFull}
                                    </td>
                                    <td style="text-align:right; font-weight:800; color:#10b981; font-size:0.8rem;">${e.percent.toFixed(1)}%</td>
                                    <td style="text-align:right; font-weight:800; color:#ef4444; font-size:0.8rem;">${e.eGap > 0 ? e.eGap.toFixed(1) + '%' : ''}</td>
                                    <td style="text-align:right; font-weight:800; color:#1e293b; font-size:0.8rem;">${formatNumber(e.eLoss)}</td>
                                    <td style="padding:8px; vertical-align:middle;">
                                        <div style="height:32px; width:85px; margin:0 auto;"><canvas id="annex-spark-${e.ecoId}"></canvas></div>
                                        <div id="annex-vals-${e.ecoId}" style="display:flex; justify-content:space-between; font-size:7px; color:#475569; margin-top:3px; font-weight:700; line-height:1.2; text-align:center;"></div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>

                    <section style="margin-top:30px; padding:15px; background:#f1f5f9; border-radius:12px; border:1px solid #e2e8f0;">
                        <h4 style="margin:0 0 10px 0; font-size:0.75rem; text-transform:uppercase; color:#1e293b;">6. NOTA METODOLÓGICA Y PARÁMETROS DE EVALUACIÓN</h4>
                        <div style="font-size:0.65rem; color:#475569; display:grid; grid-template-columns: 1fr 1fr; gap:20px; line-height:1.4;">
                            <div>
                                <strong>Riesgo de Colapso Ambiental:</strong> Se proyecta según la tasa de pérdida histórica sobre el umbral crítico del <strong>${this.collapseThreshold || 20}%</strong> de superficie remanente ecosistémica.
                                <br><strong>Déficit de Protección:</strong> Determinado por la brecha negativa respecto a la meta regional de Biodiversidad (<strong>30%</strong>).
                            </div>
                            <div>
                                <strong>Umbral de Deforestación Crítica:</strong> Se ha utilizado un parámetro de pérdida anual superior al <strong>${lossThreshold}%</strong> para la activación de prioridades "Crítica" y "Alerta".
                                <br><strong>Fuente:</strong> Datos integrados del Observatorio Ambiental Regional (OAR).
                            </div>
                        </div>
                    </section>
                </div>
            `;
        }

        content.innerHTML = html;
        modal.style.display = 'flex';
        this.renderReportCharts(stats, unitLoss, mostAffectedEcos, priorityAnnexList);
    }

    renderReportCharts(stats, unitLoss, mostAffectedEcos = [], priorityAnnexList = []) {
        // --- 0. NEW: Ecosystem Composition Doughnut Chart ---
        const compositionCanvas = document.getElementById('ecosystem-composition-chart');
        if (compositionCanvas) {
            const ctx = compositionCanvas.getContext('2d');
            const dataValues = [stats.bosque.total, stats.otros.total, stats.agro.total];
            const labels = ['Bosques', 'Otros Naturales', 'Sistemas Agropecuarios'];
            const colors = ['#10b981', '#6366f1', '#f59e0b'];

            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: dataValues,
                        backgroundColor: colors,
                        borderWidth: 2,
                        borderColor: '#ffffff',
                        hoverOffset: 15
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '40%',
                    rotation: -110, // Rotate to shift "Otros Naturales" to a side position
                    layout: { padding: { left: 45, right: 45, top: 15, bottom: 10 } },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                boxWidth: 10,
                                padding: 12,
                                font: { size: 9, weight: 'bold' },
                                color: '#475569'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (item) => {
                                    const val = item.raw;
                                    const pct = ((val / stats.totalAreaUnit) * 100).toFixed(1);
                                    return ` ${item.label}: ${formatNumber(val)} ha (${pct}%)`;
                                }
                            }
                        }
                    }
                },
                plugins: [{
                    id: 'advancedLabels',
                    afterDraw(chart) {
                        const { ctx, data } = chart;
                        ctx.save();
                        ctx.font = 'bold 11px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';

                        const datasetMeta = chart.getDatasetMeta(0).data;
                        datasetMeta.forEach((datapoint, index) => {
                            const { x, y, startAngle, endAngle, innerRadius, outerRadius } = datapoint;
                            const midAngle = (startAngle + endAngle) / 2;
                            const midRadius = (innerRadius + outerRadius) / 2;
                            
                            const val = data.datasets[0].data[index];
                            const ratio = val / stats.totalAreaUnit;
                            const pct = (ratio * 100).toFixed(1) + '%';
                            
                            if (ratio >= 0.15) {
                                // Internal Label
                                const posX = x + Math.cos(midAngle) * midRadius;
                                const posY = y + Math.sin(midAngle) * midRadius;
                                ctx.fillStyle = '#fff';
                                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                                ctx.shadowBlur = 4;
                                ctx.fillText(pct, posX, posY);
                            } else if (ratio > 0.001) {
                                // External Label with Lead Line
                                const lineStartRadius = outerRadius - 2;
                                const lineEndRadius = outerRadius + 28;
                                const xStart = x + Math.cos(midAngle) * lineStartRadius;
                                const yStart = y + Math.sin(midAngle) * lineStartRadius;
                                const xEnd = x + Math.cos(midAngle) * lineEndRadius;
                                const yEnd = y + Math.sin(midAngle) * lineEndRadius;

                                // Draw Lead Line
                                ctx.beginPath();
                                ctx.moveTo(xStart, yStart);
                                ctx.lineTo(xEnd, yEnd);
                                ctx.lineWidth = 1.5;
                                ctx.strokeStyle = colors[index];
                                ctx.stroke();

                                // Draw Percentage Outside
                                ctx.shadowBlur = 0;
                                ctx.fillStyle = colors[index];
                                const isRight = Math.cos(midAngle) >= 0;
                                ctx.textAlign = isRight ? 'left' : 'right';
                                const textX = xEnd + (isRight ? 6 : -6);
                                ctx.fillText(pct, textX, yEnd);
                            }
                        });
                        ctx.restore();
                    }
                }]
            });
        }

        const renderMainTrend = (canvasId, periods) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const labels = ['2001-2005', '2006-2010', '2011-2015', '2016-2020'];
            const data = labels.map(l => periods[l] || periods['p' + l.split('-')[1]] || 0);

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        borderWidth: 2.5,
                        pointBackgroundColor: '#ef4444',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    plugins: { legend: { display: false }, tooltip: { enabled: true } },
                    maintainAspectRatio: false,
                    layout: { padding: { top: 20 } },
                    scales: {
                        x: { 
                            grid: { display: false },
                            ticks: { font: { size: 8, weight: 'bold' }, color: '#64748b' }
                        },
                        y: { 
                            beginAtZero: true,
                            grid: { borderDash: [3, 3], color: '#e2e8f0' },
                            ticks: { 
                                font: { size: 8 }, 
                                color: '#94a3b8',
                                callback: (v) => v >= 1000 ? (v/1000).toFixed(0) + 'k' : v
                            }
                        }
                    }
                },
                plugins: [{
                    id: 'valueLabel',
                    afterDatasetsDraw(chart) {
                        const {ctx, data, scales: {x, y}} = chart;
                        ctx.save();
                        ctx.font = 'bold 9px Arial';
                        ctx.fillStyle = '#ef4444';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        data.datasets[0].data.forEach((value, index) => {
                            const xPos = x.getPixelForValue(labels[index]);
                            const yPos = y.getPixelForValue(value);
                            ctx.fillText(Math.round(value).toLocaleString() + ' ha', xPos, yPos - 8);
                        });
                        ctx.restore();
                    }
                }]
            });
        };

        if (unitLoss) {
            renderMainTrend('total-loss-trend', unitLoss.periods || unitLoss);
        }

        const renderSpark = (canvasId, periods, type = 'bar') => {
            const canvas = document.getElementById(canvasId);
            const idx = canvasId.split('eco-spark-')[1];
            const valsBotEl = document.getElementById(`eco-vals-bot-${idx}`);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const keys = ['2001-2005', '2006-2010', '2011-2015', '2016-2020'];
            const labels = ['2001-2005', '2006-2010', '2011-2015', '2016-2020'];
            const data = keys.map(k => periods[k] || periods['p' + k.split('-')[1]] || 0);

            if (valsBotEl) {
                valsBotEl.innerHTML = labels.map(l => `<span style="width:25%; font-size:8px;">${l}</span>`).join('');
            }

            new Chart(ctx, {
                type: type,
                data: { 
                    labels: labels, 
                    datasets: [{ 
                        data: data, 
                        borderColor: '#ef4444', 
                        backgroundColor: 'rgba(239, 68, 68, 0.5)', 
                        borderWidth: 1, 
                        barPercentage: 0.85,
                        categoryPercentage: 0.85
                    }] 
                },
                options: { 
                    plugins: { 
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }, 
                    layout: {
                        padding: { top: 15, left: 5, right: 5, bottom: 0 }
                    },
                    scales: { 
                        x: { display: false }, 
                        y: { display: false, beginAtZero: true, suggestedMax: Math.max(...data) * 1.3 } 
                    }, 
                    maintainAspectRatio: false, 
                    animation: false 
                },
                plugins: [{
                    id: 'valueLabel',
                    afterDatasetsDraw(chart) {
                        const {ctx, data, scales: {x, y}} = chart;
                        ctx.save();
                        ctx.font = 'bold 8.5px Arial';
                        ctx.fillStyle = '#ef4444';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        data.datasets[0].data.forEach((value, index) => {
                            const xPos = x.getPixelForValue(labels[index]);
                            const yPos = y.getPixelForValue(value);
                            ctx.fillText(formatNumber(value) + ' ha', xPos, yPos - 4);
                        });
                        ctx.restore();
                    }
                }]
            });
        };

        const renderAnnexLine = (canvasId, periods, annualRate, historicalLoss) => {
            const canvas = document.getElementById(canvasId);
            const valsEl = document.getElementById(`annex-vals-${canvasId.split('annex-spark-')[1]}`);
            if (!canvas) return;
            
            // Baseline 2001 is the first period loss (2001-2005) annualized (divided by 5)
            const v2001 = (periods['2001-2005'] || periods['p2001'] || 0) / 5;
            // Historical loss 2020 is the total provided 'eLoss'
            const v2020 = historicalLoss || 0;
            const extraProj = annualRate * 10;
            const v2030 = v2020 + extraProj;

            if (valsEl) {
                valsEl.innerHTML = `
                    <span>2001<br>${formatNumber(v2001)}</span>
                    <span style="color:#ef4444;">2020<br>${formatNumber(v2020)}</span>
                    <span style="color:#f59e0b;">2030p<br>${formatNumber(v2030)}</span>
                `;
            }
            
            new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { 
                    labels: ['01','20','30p'], 
                    datasets: [{ 
                        data: [v2001, v2020, v2030], 
                        borderColor: '#ef4444', 
                        borderWidth: 1.5, 
                        pointRadius: 0, 
                        tension: 0.4 
                    }] 
                },
                options: { 
                    plugins: { legend: { display: false } }, 
                    scales: { x: { display: false }, y: { display: false } }, 
                    maintainAspectRatio: false, 
                    animation: false 
                }
            });
        };

        setTimeout(() => {
            mostAffectedEcos.forEach((e, i) => renderSpark(`eco-spark-${i}`, e.ePeriods));
            priorityAnnexList.forEach(e => renderAnnexLine(`annex-spark-${e.ecoId}`, e.ePeriods, e.annualRate, e.eLoss));
        }, 500);
    }

    calculateEcosystemRisk(name, protectedPct, lossHa, totalHa) {
        const target = this.conservationTarget || 30;
        const lossThreshold = parseFloat(document.getElementById('integrated-loss-threshold')?.value) || 5;
        const collapseThreshold = parseFloat(document.getElementById('integrated-collapse-threshold')?.value) || 20;
        const normName = this.normalizeForMatch(name);
        const isHumano = normName.includes('agropecuario') || normName.includes('urbano');
        
        if (isHumano) return { id: 'humano', label: 'Uso Humano', color: '#94a3b8', yearsToLimit: null, statusLabel: 'Estable' };

        const totalAreaOriginal = totalHa;
        const estimatedLossPct = totalAreaOriginal > 0 ? (lossHa / totalAreaOriginal) * 100 : 0;
        const gap = target - protectedPct;
        const isHighPressure = estimatedLossPct >= lossThreshold;
        
        let priority = { id: 'estable', label: 'Estable', color: '#22c55e' };
        if (gap > 10 && isHighPressure) priority = { id: 'critico', label: 'Crítico', color: '#ef4444' };
        else if (gap <= 10 && isHighPressure) priority = { id: 'alerta', label: 'Alerta', color: '#ef4444' };
        else if (gap > 10 && !isHighPressure) priority = { id: 'atencion', label: 'Atención', color: '#f97316' };

        const annualLossRate = lossHa / 20;
        const criticalSurface = totalAreaOriginal * (collapseThreshold / 100);
        let yearsToLimit = null;
        let statusLabel = "Estable";

        if (totalHa <= criticalSurface) { 
            statusLabel = "Colapsado"; 
            yearsToLimit = 0; 
        } else if (annualLossRate > 0) {
            yearsToLimit = Math.floor((totalHa - criticalSurface) / annualLossRate);
            if (yearsToLimit < 50) statusLabel = "Inminente";
            else if (yearsToLimit < 200) statusLabel = "Proyectado";
            else if (protectedPct === 0 || gap > 20) statusLabel = "Vulnerable"; // Prioritize protection gap over long-term projection
            else statusLabel = "Estable";
        } else if (protectedPct === 0 || gap > 20) {
            statusLabel = "Vulnerable";
        } else {
            statusLabel = "Estable";
        }
        return { ...priority, yearsToLimit, statusLabel, estimatedLossPct, gap, annualRate: annualLossRate };
    }

    /**
     * Generates and downloads a high-quality PDF of the current report.
     * Uses html2pdf.js (jspdf + html2canvas) for high fidelity.
     */
    exportReportToPDF() {
        const element = document.querySelector('.report-container');
        const loader = document.getElementById('pdf-loading');
        if (!element) return;

        // Show loading indicator
        if (loader) loader.style.display = 'flex';

        const iso = document.getElementById('admin-country')?.value || 'ALL';
        const mSelect = document.getElementById('admin-muni');
        let unitName = (iso === 'ALL') ? "Centroamerica" : iso;
        if (mSelect && mSelect.selectedIndex > 0) {
            unitName = mSelect.options[mSelect.selectedIndex].text;
        }
        
        const filename = `Reporte_${unitName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

        // Temporarily hide the UI header for a clean PDF
        const header = element.querySelector('.report-header');
        if (header) header.style.display = 'none';

        const opt = {
            margin: [10, 10],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
                scale: 2, 
                useCORS: true, 
                letterRendering: true,
                backgroundColor: '#ffffff', // Force white background
                scrollY: 0,
                scrollX: 0
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        // Run conversion with a small delay to let the UI show the loader
        setTimeout(() => {
            html2pdf().set(opt).from(element).save().finally(() => {
                // Restore header and hide loader
                if (header) header.style.display = 'flex';
                if (loader) loader.style.display = 'none';
            });
        }, 150);
    }
}




