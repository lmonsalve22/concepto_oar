let map;
        let geojsonLayer;
        let currentApp = 'admin'; // 'areas', 'ecosistemas', 'admin'
        let currentLevel = 1;
        let currentIso = 'ALL';
        
        let fullData = { areas: {}, areasPartitioned: {}, ecosistemas: null, ecosSplit: {}, admin: {}, ecosGranularMapping: null, paStats: null };
        let vectorTileLayer = null;
        let currentEcosMetadata = { depts: [], munis: [], pas: [], ecoName: '', iso: '' };
        let lastEcoFeatures = null;
        let lastEcoIso = '';
        let lastEcoNameRaw = '';
        let ecoSubTab = 'info';
        let legendsConfig = { areas: {}, ecosistemas: {}, admin: {} };
        let adminHierarchy = {};
        let adminStats = null;
        let maskLayer = null;
        let ecoChartInstance = null;
        let paDeptChartInstance = null;
        let paMuniChartInstance = null;
        let boundaryLayer = null;
        let ecosLayer = null;
        let pasLayer = null;
        let highlightLayer = null;
        let activeAdminFeature = null;
        let activeAdminGeom = null;

        const countryColors = {
            'BLZ': '#10b981', 'CRI': '#3b82f6', 'DOM': '#ef4444', 'GTM': '#f59e0b',
            'HND': '#8b5cf6', 'NIC': '#06b6d4', 'PAN': '#ec4899', 'SLV': '#84cc16'
        };

        const vibrantPalette = [
            '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
            '#059669', '#2563eb', '#fbbf24', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d',
            '#34d399', '#60a5fa', '#fcd34d', '#f87171', '#a78bfa', '#22d3ee', '#f472b6', '#a3e635'
        ];

        function initMap() {
            map = L.map('map', { zoomControl: false, attributionControl: false }).setView([15, -86], 6);
            
            map.createPane('ecosystemPane');
            map.getPane('ecosystemPane').style.zIndex = 500; // Ecosistemas arriba por defecto
            
            map.createPane('adminBoundaryPane');
            map.getPane('adminBoundaryPane').style.zIndex = 400; // Límites abajo por defecto
            
            map.createPane('paBoundaryPane');
            map.getPane('paBoundaryPane').style.zIndex = 400; // APs abajo por defecto
            
            map.createPane('selectionPane');
            map.getPane('selectionPane').style.zIndex = 600;
            map.getPane('selectionPane').style.pointerEvents = 'none';

            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

            // Safety net: always hide spinner after 10s to prevent eternal loading
            setTimeout(() => showLoader(false), 10000);

            // Load configs
            const base = window.location.origin;
            Promise.all([
                fetch(`${base}/web_data/legends_config.json`).then(r => { if(!r.ok) throw new Error(r.url); return r.json(); }),
                fetch(`${base}/web_data/ecosistemas_2002_legend.json`).then(r => { if(!r.ok) throw new Error(r.url); return r.json(); }),
                fetch(`${base}/web_data/admin_hierarchy.json`).then(r => { if(!r.ok) throw new Error(r.url); return r.json(); }),
                fetch(`${base}/web_data/admin_stats.json`).then(r => { if(!r.ok) throw new Error(r.url); return r.json(); }),
                fetch(`${base}/web_data/ecos_granular_mapping.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
                fetch(`${base}/web_data/pa_granular_stats.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
            ]).then(([paLegend, ecoLegend, hierarchy, stats, granularMapping, paStats]) => {
                legendsConfig.areas = paLegend;
                legendsConfig.ecosistemas = ecoLegend;
                adminHierarchy = hierarchy;
                adminStats = stats;
                fullData.ecosGranularMapping = granularMapping;
                fullData.paStats = paStats;
                
                initAdminSelectors();
                initEcosSelectors();
                initPASelectors();
                switchApp('ecosistemas');
            }).catch(err => {
                console.error('Error inicializando datos:', err);
                showLoader(false);
                alert('Error al cargar datos: ' + err.message + '\n\nAsegúrate de acceder por http://127.0.0.1:8000/viewer/index.html');
            });

            map.on('moveend', () => updateAccordionLegend(true));
        }

        function resetMapAndDashboard() {
            closeDetail();
            if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
            if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
            if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
            if (ecosLayer) { map.removeLayer(ecosLayer); ecosLayer = null; }
            if (vectorTileLayer) { map.removeLayer(vectorTileLayer); vectorTileLayer = null; }
            
            activeAdminFeature = null;
            activeAdminGeom = null;
            currentEcosMetadata = {};
            lastEcoFeatures = null;
            
            document.getElementById('detail-panel').classList.remove('visible');
        }

        async function loadAndRenderRegionalEcos() {
            if (fullData.ecosistemas && fullData.ecosistemas.features && fullData.ecosistemas.features.length > 0) {
                renderData(fullData.ecosistemas, false);
                updateAccordionLegend(true);
                return;
            }
            
            const origin = window.location.origin;
            const mapping = fullData.ecosGranularMapping || {};
            const regionalPaths = mapping.regional ? Object.values(mapping.regional) : [];

            if (regionalPaths.length > 0) {
                const BATCH = 10;
                let allFeatures = [];
                
                for (let i = 0; i < Math.min(regionalPaths.length, 206); i += BATCH) {
                    const batch = regionalPaths.slice(i, i + BATCH);
                    const results = await Promise.all(batch.map(async (path) => {
                        try {
                            const res = await fetch(`${origin}/web_data/${path}`);
                            if (!res.ok) return [];
                            const g = await res.json();
                            return g.features || [];
                        } catch(e) { return []; }
                    }));
                    
                    results.forEach(feats => allFeatures.push(...feats));
                    
                    if (i === 0 && allFeatures.length > 0) {
                        renderData({ type: 'FeatureCollection', features: allFeatures }, false);
                    }
                }
                
                if (allFeatures.length > 0) {
                    fullData.ecosistemas = { type: 'FeatureCollection', features: allFeatures };
                    renderData(fullData.ecosistemas, false);
                }
            } else {
                console.warn('Sin micro-archivos regionales en el mapeo');
            }
            updateAccordionLegend(true);
        }

        async function switchApp(app) {
            currentApp = app;
            
            // UI Update Tabs - Reliable highlighting using data attributes
            document.querySelectorAll('.tab-btn').forEach(btn => {
                const appKey = btn.getAttribute('data-app');
                btn.classList.toggle('active', appKey === app);
            });

            // Toggle side controls
            document.getElementById('level-container').style.display = app==='areas' ? 'grid' : 'none';
            document.getElementById('filter-container').style.display = (app !== 'areas' && app !== 'admin' && app !== 'ecosistemas') ? 'block' : 'none';
            document.getElementById('admin-controls').style.display = app==='admin' ? 'block' : 'none';
            document.getElementById('ecos-controls').style.display = app==='ecosistemas' ? 'block' : 'none';
            document.getElementById('pa-controls').style.display = app==='areas' ? 'block' : 'none';
            
            // Only hide completely if leaving a dashboard-capable view.
            if (app !== 'admin' && app !== 'ecosistemas' && app !== 'areas') {
                document.getElementById('detail-panel').classList.remove('visible');
            }
            
            document.getElementById('app-title').innerText = 
                app==='areas' ? 'Visor de Áreas' : 
                app==='ecosistemas' ? 'Ecosistemas 2002' : 'Límites Administrativos';
            
            document.getElementById('app-subtitle').innerText = 
                app==='areas' ? 'Gestión Jerárquica Regional' : 
                app==='ecosistemas' ? 'Mapa Regional de Mesoamérica' : 'Países y Divisiones Territoriales';

            showLoader(true);
            resetMapAndDashboard(); // ALWAYS reset when switching geovisors
            
            const tabInfo = document.getElementById('tab-info');
            const tabEcos = document.getElementById('tab-ecos');
            const tabPas = document.getElementById('tab-pas');

            if (app === 'areas') {
                tabInfo.innerText = 'Info';
                tabEcos.innerText = 'Ecosistemas';
                tabEcos.style.display = 'block';
                tabPas.style.display = 'none';
                
                setEcosLayerPriority('pas');
                await updatePAView(); // Dedicated logic for Protected Areas
            } else if (app === 'ecosistemas') {
                tabInfo.innerText = 'Info';
                tabEcos.innerText = 'Ecosistemas';
                tabEcos.style.display = 'block';
                tabPas.innerText = 'Áreas Protegidas';
                tabPas.style.display = 'block';
                
                setEcosLayerPriority('ecos');
                map.setView([15, -86], 6);
                await updateEcosView();
            } else {
                tabInfo.innerText = 'Info';
                tabEcos.innerText = 'Ecosistemas';
                tabEcos.style.display = 'block';
                tabPas.innerText = 'Áreas Protegidas';
                tabPas.style.display = 'block';
                await updateAdminView();
            }
            showLoader(false);
        }

        async function switchLevel(level) {
            currentLevel = level;
            
            // UI Update
            document.querySelectorAll('.level-btn').forEach((btn, i) => btn.classList.toggle('active', (i+1)===level));
            
            showLoader(true);
            const type = level===1?'areas':level===2?'zonas':'subzonas';
            const filename = `sica_l${level}_${type}.json`;
            
            if (!fullData.areas[level]) {
                const res = await fetch(`../web_data/${filename}`);
                fullData.areas[level] = await res.json();
            }
            
            applyFilters(false);
            showLoader(false);
        }

        function applyFilters(shouldFit = true) {
            currentIso = document.getElementById('country-filter').value;
            const data = fullData.areas[currentLevel];
            if (!data) return;

            let filtered;
            if (currentIso === 'ALL') {
                filtered = data;
            } else {
                filtered = {
                    type: 'FeatureCollection',
                    features: data.features.filter(f => f.properties.iso3 === currentIso)
                };
            }

            renderData(filtered, shouldFit);
            updateAccordionLegend(true); // Always update legend, filtering by visibility
        }

        const placeholders = ['No disponible', 'No definido', 'Not Reported', 'NULL', 'None', 'nan', 'nan ', ' ', ''];

        function isPlaceholder(val) {
            if (!val) return true;
            const s = String(val).trim();
            return placeholders.includes(s);
        }

        function getStableColor(text, iso) {
            if (isPlaceholder(text)) return '#64748b';
            let hash = 0;
            const seed = text + (iso || '');
            for (let i = 0; i < seed.length; i++) {
                hash = seed.charCodeAt(i) + ((hash << 5) - hash);
            }
            return vibrantPalette[Math.abs(hash) % vibrantPalette.length];
        }

        function getFeatureColor(props) {
            if (props.LEYENDA) return getEcoColor(props.LEYENDA);
            if (props.categoria) {
                if (currentLevel === 1 || !props.zona) return getStableColor(props.categoria, props.iso3);
                if (currentLevel === 2 || !props.sub_zona) return getStableColor(props.zona, props.iso3);
                const sub = isPlaceholder(props.sub_zona) ? props.zona : props.sub_zona;
                return getStableColor(sub, props.iso3);
            }
            return countryColors[props.iso3] || '#3388ff';
        }

        // Normaliza para comparación tolerante a tildes, doble-espacio y caracteres corruptos
        const normalizeStr = s => {
            if (!s) return '';
            return s.toString()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Estándar para quitar acentos
                .replace(/\s+/g, ' ')   // colapsar espacios múltiples
                .trim()
                .toLowerCase()
                // Normalizar caracteres especiales restantes o variantes específicas
                .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
                .replace(/[íìïî]/g, 'i').replace(/[óòöô¢]/g, 'o')
                .replace(/[úùüû]/g, 'u').replace(/[ñ]/g, 'n')
                // Eliminar cualquier otro carácter no-ASCII restante
                .replace(/[^\x00-\x7F]/g, '');
        };

        function getEcoColor(label) {
            if (!label) return '#64748b';
            const search = normalizeStr(label);
            
            // Prioritize official legend config if available (normalized matching)
            if (legendsConfig.ecosistemas) {
                for (const [k, v] of Object.entries(legendsConfig.ecosistemas)) {
                    if (normalizeStr(k) === search) return v.color;
                }
            }

            let hash = 0;
            for (let i = 0; i < search.length; i++) {
                hash = search.charCodeAt(i) + ((hash << 5) - hash);
            }

            let h, s, l;
            
            if (search.includes('bosque')) {
                // Green Tones (80-160)
                h = 80 + (Math.abs(hash) % 80);
                s = 50 + (Math.abs(hash >> 8) % 30);
                l = 35 + (Math.abs(hash >> 16) % 20);
            } else if (search.includes('herbácea') || search.includes('pasto') || search.includes('agrícola') || search.includes('suelo desnudo') || search.includes('no bosque')) {
                // Yellow/Brown Tones (40-70)
                h = 40 + (Math.abs(hash) % 30);
                s = 50 + (Math.abs(hash >> 8) % 30);
                l = 50 + (Math.abs(hash >> 16) % 20);
            } else {
                // Mixed Tones (Avoid 40-160 range to keep contrast)
                h = (Math.abs(hash) % 280); 
                if (h > 40) h += 120; // Skip the 40-160 range
                h = h % 360;
                s = 40 + (Math.abs(hash >> 8) % 40);
                l = 45 + (Math.abs(hash >> 16) % 25);
            }

            return `hsl(${h}, ${s}%, ${l}%)`;
        }

        function renderData(data, shouldFit = false) {
            if (geojsonLayer) map.removeLayer(geojsonLayer);
            
            // Ensure interactive elements show a pointer cursor
            const styleElement = document.getElementById('map-cursor-fix') || document.createElement('style');
            styleElement.id = 'map-cursor-fix';
            styleElement.innerHTML = '.leaflet-interactive { cursor: pointer !important; }';
            if (!styleElement.parentNode) document.head.appendChild(styleElement);

            const isEcoLayer = data.features && data.features.length > 0 && !!data.features[0].properties.LEYENDA;
            
            geojsonLayer = L.geoJSON(data, {
                pane: isEcoLayer ? 'ecosystemPane' : 'adminBoundaryPane',
                style: (f) => {
                    const color = getFeatureColor(f.properties);
                    const isEco = !!f.properties.LEYENDA;
                    const fillOp = isEco ? (currentApp === 'admin' ? 0.3 : 0.7) : 0.4;
                    const border = isEco ? 'transparent' : '#ffffff';
                    const weight = isEco ? 0 : 1;
                    return {
                        fillColor: color, weight: weight, opacity: 1, color: border, fillOpacity: fillOp
                    };
                },
                onEachFeature: (f, l) => {
                    l.on({
                        click: (e) => {
                            if (currentApp === 'admin') {
                                const isDashboardSubTab = !document.querySelector('.dash-tab[onclick*="info"]').classList.contains('active');
                                if (!isDashboardSubTab) {
                                    showDetail(f, e);
                                    L.DomEvent.stopPropagation(e);
                                }
                            }
                        },
                        mouseover: (e) => {
                            e.target.setStyle({ fillOpacity: currentApp==='admin'?0.5:0.9, weight: 3 });
                            map.getContainer().style.cursor = 'pointer';
                        },
                        mouseout: (e) => {
                            geojsonLayer.resetStyle(e.target);
                            map.getContainer().style.cursor = '';
                        }
                    });
                    
                    let popupContent = '';
                    const p = f.properties;
                    if (p.nombre && p.categoria) {
                        // Protected Area
                        popupContent = `
                            <div style="font-family:'Inter',sans-serif; min-width:200px;">
                                <div style="border-bottom:1px solid #eee; margin-bottom:8px; padding-bottom:5px;">
                                    <strong style="color:var(--primary); font-size:0.9rem;">${p.nombre}</strong><br>
                                    <span style="font-size:0.75rem; color:#666;">${p.categoria}</span>
                                </div>
                                <table style="width:100%; font-size:0.75rem; border-collapse:collapse;">
                                    <tr><td style="color:#888; padding:2px 0;">Zona:</td><td style="font-weight:600;">${p.zona || 'N/A'}</td></tr>
                                    <tr><td style="color:#888; padding:2px 0;">País:</td><td style="font-weight:600;">${p.pais || p.iso3}</td></tr>
                                    <tr><td style="color:#888; padding:2px 0;">Superficie:</td><td style="font-weight:600;">${parseFloat(p.area_ha || 0).toLocaleString()} Ha</td></tr>
                                </table>
                            </div>`;
                    } else if (p.LEYENDA) {
                        // Ecosystem
                        popupContent = `
                            <div style="font-family:'Inter',sans-serif; min-width:220px;">
                                <div style="border-bottom:1px solid #eee; margin-bottom:8px; padding-bottom:5px;">
                                    <strong style="color:var(--primary); font-size:0.9rem;">Ecosistema</strong><br>
                                    <span style="font-size:0.75rem; font-weight:600;">${p.LEYENDA}</span>
                                </div>
                                <table style="width:100%; font-size:0.75rem; border-collapse:collapse;">
                                    <tr><td style="color:#888; padding:2px 0;">Cod. UNESCO:</td><td style="font-weight:600;">${p.UNESCO || 'N/A'}</td></tr>
                                    <tr><td style="color:#888; padding:2px 0;">Cod. Interno:</td><td style="font-weight:600;">${p.COD14 || 'N/A'}</td></tr>
                                </table>
                            </div>`;
                    } else {
                        // Admin
                        const name = p.Admin2name || p.Admin1name || p.Pais_es;
                        popupContent = `
                            <div style="font-family:'Inter',sans-serif; min-width:180px;">
                                <div style="border-bottom:1px solid #eee; margin-bottom:8px; padding-bottom:5px;">
                                    <strong style="color:var(--primary); font-size:0.9rem;">Unidad Administrativa</strong><br>
                                    <span style="font-size:0.75rem; font-weight:600;">${name}</span>
                                </div>
                                <table style="width:100%; font-size:0.75rem; border-collapse:collapse;">
                                    <tr><td style="color:#888; padding:2px 0;">Nivel:</td><td style="font-weight:600;">${p.Admin2name?'Municipio':p.Admin1name?'Departamento':'País'}</td></tr>
                                    <tr><td style="color:#888; padding:2px 0;">País:</td><td style="font-weight:600;">${p.Pais_es || 'N/A'}</td></tr>
                                    <tr><td style="color:#888; padding:2px 0;">ID:</td><td style="font-weight:600;">${p.IDRegMunic || p.Admin1_id || p.Pais_cod3}</td></tr>
                                </table>
                            </div>`;
                    }
                    l.bindPopup(popupContent);
                }
            }).addTo(map);

            if (maskLayer && map.hasLayer(maskLayer)) {
                maskLayer.bringToFront();
            }
            if (boundaryLayer && map.hasLayer(boundaryLayer)) {
                boundaryLayer.bringToFront();
            }

            if (shouldFit && data.features.length > 0) {
                // Determine if we show regional view or specific unit
                if (currentApp === 'admin' && !data.features[0].properties.LEYENDA && !data.features[0].properties.categoria) {
                    const isoSel = document.getElementById('admin-country')?.value;
                    if (isoSel || data.features.length === 1) map.fitBounds(geojsonLayer.getBounds(), { padding: [40, 40] });
                    else map.setView([15, -86], 6);
                } else {
                    map.fitBounds(geojsonLayer.getBounds(), { padding: [40, 40] });
                }
            }
            updateAccordionLegend(true);
        }

        function updateAccordionLegend(onlyVisible = true) {
            const container = document.getElementById('accordion-legend');
            if (currentApp === 'admin' && (!geojsonLayer || (!geojsonLayer.getLayers()[0]?.feature.properties.LEYENDA && !geojsonLayer.getLayers()[0]?.feature.properties.categoria))) {
                container.innerHTML = ''; return;
            }
            container.innerHTML = '';

            if (!geojsonLayer || geojsonLayer.getLayers().length === 0) return;
            const mapBounds = map.getBounds();
            const firstFeat = geojsonLayer.getLayers()[0].feature.properties;

            if (firstFeat.categoria || currentApp === 'areas') {
                // PA Legend logic
                const visibleProps = new Set();
                const visibleIsos = new Set();

                geojsonLayer.eachLayer(layer => {
                    const layerBounds = layer.getBounds ? layer.getBounds() : null;
                    if (!onlyVisible || (layerBounds && layerBounds.isValid() && mapBounds.intersects(layerBounds))) {
                        const p = layer.feature.properties;
                        visibleIsos.add(p.iso3);
                        if (currentLevel === 1) visibleProps.add(`${p.iso3}|${p.categoria}`);
                        else if (currentLevel === 2) visibleProps.add(`${p.iso3}|${p.zona}`);
                        else visibleProps.add(`${p.iso3}|${p.sub_zona || p.zona}`);
                    }
                });

                if (visibleIsos.size === 0 && onlyVisible) {
                    container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--gray); font-size:0.8rem;">No hay áreas visibles.</div>';
                    return;
                }

                const isos = Array.from(visibleIsos).sort();
                isos.forEach(iso => {
                    const country = legendsConfig.areas[iso];
                    if (!country) return;
                    const item = document.createElement('div');
                    item.className = 'accordion-item active';
                    const header = document.createElement('div');
                    header.className = 'accordion-header';
                    header.innerHTML = `<div class="country-title"><div class="country-dot" style="background: ${countryColors[iso]}"></div>${country.name}</div>`;
                    const content = document.createElement('div');
                    content.className = 'accordion-content';
                    let rows = '';
                    if (currentLevel === 1) {
                        country.categories.forEach(c => { if(visibleProps.has(`${iso}|${c}`)) rows += createLegendRow(getStableColor(c, iso), c); });
                    } else {
                        Object.keys(country.zones).forEach(z => {
                            if (currentLevel === 2) { if(visibleProps.has(`${iso}|${z}`)) rows += createLegendRow(getStableColor(z, iso), z); }
                            else {
                                country.zones[z].sub_zones.forEach(sz => { 
                                    if(visibleProps.has(`${iso}|${sz}`)) {
                                        const label = (sz === z) ? z : `${z}: ${sz}`;
                                        rows += createLegendRow(getStableColor(sz, iso), label); 
                                    }
                                });
                            }
                        });
                    }
                    content.innerHTML = rows;
                    item.appendChild(header); item.appendChild(content); container.appendChild(item);
                });

            } else {
                // Ecosystems Flat Legend
                const visibleEcos = new Set();
                geojsonLayer.eachLayer(layer => {
                    const layerBounds = layer.getBounds ? layer.getBounds() : null;
                    if (!onlyVisible || (layerBounds && layerBounds.isValid() && mapBounds.intersects(layerBounds))) {
                        visibleEcos.add(layer.feature.properties.LEYENDA);
                    }
                });

                if (visibleEcos.size === 0 && onlyVisible) {
                    container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--gray); font-size:0.8rem;">No hay ecosistemas visibles.</div>';
                    return;
                }

                Array.from(visibleEcos).sort().forEach(eco => {
                    const color = getEcoColor(eco);
                    container.innerHTML += createLegendRow(color, eco);
                });
            }
        }

        function createLegendRow(color, label) {
            return `
                <div class="legend-row">
                    <div class="legend-color" style="background: ${color}"></div>
                    <div class="legend-label">${label}</div>
                </div>
            `;
        }

        function showDetail(featureOrProps, e, skipTabReset = false) {
            const panel = document.getElementById('detail-panel');
            const content = document.getElementById('info-content');
            
            // Handle both full feature or just properties
            const props = featureOrProps.properties || featureOrProps;
            const feature = featureOrProps.geometry ? featureOrProps : null;

            // Store active admin feature and geom
            if (currentApp === 'admin' && !props.LEYENDA && !props.categoria) {
                activeAdminFeature = props;
                activeAdminGeom = null;
                
                const targetId = props.IDRegMunic || props.Admin1_id || props.Pais_cod3;
                
                // If we passed the full feature, use its geometry directly
                if (feature && feature.geometry) {
                    activeAdminGeom = feature.geometry;
                    if (boundaryLayer) map.removeLayer(boundaryLayer);
                    boundaryLayer = L.geoJson(feature, {
                        style: { color: '#ffffff', weight: 1.5, fillOpacity: 0, interactive: false, dashArray: '5, 5' }
                    }).addTo(map);
                } else {
                    // Fallback to searching the layer (for map clicks where we only have properties or something changed)
                    geojsonLayer.eachLayer(l => {
                        const lProps = l.feature.properties;
                        const lId = lProps.IDRegMunic || lProps.Admin1_id || lProps.Pais_cod3;
                        if (lId === targetId) {
                            activeAdminGeom = l.feature.geometry;
                            if (boundaryLayer) map.removeLayer(boundaryLayer);
                            boundaryLayer = L.geoJson(l.feature, {
                                style: { color: '#ffffff', weight: 1.5, fillOpacity: 0, interactive: false, dashArray: '5, 5' }
                            }).addTo(map);
                        }
                    });
                }
            }

            if (!skipTabReset) {
                document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.dash-content').forEach(c => c.classList.remove('visible'));
                const infoTab = document.querySelector('.dash-tab[onclick*="info"]');
                if (infoTab) infoTab.classList.add('active');
                if (content) content.classList.add('visible');
            }
            
            if (props.nombre && props.categoria) {
                const label = props.pais || 'Área Protegida';
                content.innerHTML = `
                    <div class="detail-header">
                        <p class="detail-label">${label} (${props.iso3 || ''})</p>
                        <h2 class="detail-title">${props.nombre}</h2>
                    </div>
                    <div class="detail-row"><div class="detail-label">Categoría</div><div class="detail-value">${props.categoria}</div></div>
                    <div class="detail-row"><div class="detail-label">Zona Principal</div><div class="detail-value" style="color:var(--primary)">${props.zona || 'N/A'}</div></div>
                    <div class="detail-row"><div class="detail-label">Subzona</div><div class="detail-value" style="color:var(--accent)">${props.sub_zona || 'N/A'}</div></div>
                    <div class="detail-row"><div class="detail-label">Superficie</div><div class="detail-value">${parseFloat(props.area_ha || 0).toLocaleString()} Ha</div></div>
                    <div class="detail-row"><div class="detail-label">Base Legal</div><div class="detail-value">${props.base_legal || 'N/A'}</div></div>
                    <div class="detail-row"><div class="detail-label">Año / Autoridad</div><div class="detail-value">${props.anio_crea || 'N/A'} | ${props.autoridad || 'N/A'}</div></div>
                `;
            } else if (props.LEYENDA) {
                const unesco = (!props.UNESCO || String(props.UNESCO).toLowerCase() === 'undefined') ? 'N/A' : props.UNESCO;
                const cod14 = (!props.COD14 || String(props.COD14).toLowerCase() === 'undefined') ? 'N/A' : props.COD14;
                content.innerHTML = `
                    <div class="detail-header">
                        <p class="detail-label">Ecosistema Mesoamericano (2002)</p>
                        <h2 class="detail-title">${props.LEYENDA}</h2>
                    </div>
                    <div class="detail-row"><div class="detail-label">Código UNESCO</div><div class="detail-value">${unesco}</div></div>
                    <div class="detail-row"><div class="detail-label">Código Interno</div><div class="detail-value">${cod14}</div></div>
                    <div class="detail-row"><div class="detail-label">Descripción Técnica</div><div class="detail-value">${props.DESCRIP || 'Sin descripción detallada'}</div></div>
                `;
            } else {
                // Admin detail
                const name = props.Admin2name || props.Admin1name || props.Pais_es;
                const levelType = props.Admin2name ? 'Municipio' : props.Admin1name ? 'Departamento' : 'País';
                content.innerHTML = `
                    <div class="detail-header">
                        <p class="detail-label">Unidad Administrativa: ${levelType}</p>
                        <h2 class="detail-title">${name}</h2>
                    </div>
                    ${props.Admin1name ? `<div class="detail-row"><div class="detail-label">Departamento</div><div class="detail-value">${props.Admin1name}</div></div>` : ''}
                    <div class="detail-row"><div class="detail-label">País</div><div class="detail-value">${props.Pais_es || 'N/A'}</div></div>
                    <div class="detail-row"><div class="detail-label">ISO Código</div><div class="detail-value">${props.Pais_cod3 || props.iso3 || 'N/A'}</div></div>
                    <div class="detail-row"><div class="detail-label">ID Registro</div><div class="detail-value">${props.IDRegMunic || props.Admin1_id || 'N/A'}</div></div>
                `;
            }
            panel.classList.add('visible');
            if (currentApp === 'admin') {
                updateDashboard(props);
                switchDashTab('info');
            }
            if (e) L.DomEvent.stopPropagation(e);
        }

        function setEcosLayerPriority(mode) {
            if (!map) return;
            const ecosPane = map.getPane('ecosystemPane');
            const adminPane = map.getPane('adminBoundaryPane');
            const paPane = map.getPane('paBoundaryPane');
            
            if (!ecosPane || !adminPane || !paPane) return;

            if (mode === 'ecos') {
                ecosPane.style.zIndex = 500;
                adminPane.style.zIndex = 400;
                paPane.style.zIndex = 400;
            } else if (mode === 'info') {
                ecosPane.style.zIndex = 400;
                adminPane.style.zIndex = 500;
                paPane.style.zIndex = 400;
            } else if (mode === 'pas') {
                ecosPane.style.zIndex = 400;
                adminPane.style.zIndex = 400;
                paPane.style.zIndex = 500;
            }
        }

        async function switchDashTab(tabId, btn) {
            ecoSubTab = tabId;
            try {
                document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.dash-content').forEach(c => c.classList.remove('visible'));
                
                if (btn) btn.classList.add('active');
                else document.querySelector(`.dash-tab[onclick*="${tabId}"]`)?.classList.add('active');
                
                const target = document.getElementById(`${tabId}-content`);
                if (target) target.classList.add('visible');
                
                // Clear any point/polygon selections when switching inner tabs
                if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
                
                // Map Sync Logic based on App Mode
                if (currentApp === 'admin' && activeAdminFeature) {
                    if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }

                    if (tabId === 'ecos') {
                        showLoader(true);
                        const iso = activeAdminFeature.Pais_cod3 || activeAdminFeature.iso3;
                        if (iso && !fullData.ecosSplit[iso]) {
                            try {
                                const res = await fetch(`${window.location.origin}/web_data/ecos_split/ecos_${iso}.json`);
                                if (res.ok) fullData.ecosSplit[iso] = await res.json();
                            } catch(e){}
                        }
                        if (!fullData.ecosSplit[iso] && !fullData.ecosistemas) {
                            const res = await fetch(`${window.location.origin}/web_data/sica_ecosistemas_light.json`);
                            if (res.ok) fullData.ecosistemas = await res.json();
                        }
                        const currentDoc = fullData.ecosSplit[iso] || fullData.ecosistemas;
                        if (geojsonLayer) map.removeLayer(geojsonLayer);
                        if (currentDoc) {
                            const level = activeAdminFeature.IDRegMunic ? 'muni' : (activeAdminFeature.Admin1_id ? 'dept' : 'pais');
                            const id = activeAdminFeature.IDRegMunic || activeAdminFeature.Admin1_id || activeAdminFeature.Pais_cod3;
                            const validEcoNames = (adminStats[level].ecos[id] || []).map(e => normalizeStr(e.label));
                            const boundary = activeAdminGeom.geometry || activeAdminGeom;
                            const localEcos = currentDoc.features.filter(f => {
                                try {
                                    const name = normalizeStr(f.properties.LEYENDA);
                                    if (validEcoNames.length > 0 && !validEcoNames.includes(name)) return false;
                                    return true;
                                } catch(err) { return false; }
                            });
                            ecosLayer = L.geoJSON({ type: 'FeatureCollection', features: localEcos }, {
                                pane: 'ecosystemPane',
                                style: (f) => ({ 
                                   fillColor: getEcoColor(f.properties.LEYENDA), weight: 1, 
                                   color: 'rgba(255,255,255,0.15)', fillOpacity: 0.65 
                                }),
                                onEachFeature: (f,l) => l.bindPopup(`<strong>${f.properties.LEYENDA}</strong>`)
                            }).addTo(map);
                            geojsonLayer = ecosLayer;
                            applyMapMask(activeAdminFeature);
                        }
                    } else if (tabId === 'pas') {
                        showLoader(true);
                        const isAdmin2 = !!activeAdminFeature.IDRegMunic;
                        const isAdmin1 = !!activeAdminFeature.Admin1_id && !isAdmin2;
                        const level = isAdmin2 ? 'muni' : (isAdmin1 ? 'dept' : 'pais');
                        const id = activeAdminFeature.IDRegMunic || activeAdminFeature.Admin1_id || activeAdminFeature.Pais_cod3;
                        const paNames = adminStats[level].pas[id] || [];
                        if (!fullData.areas[1]) {
                            const res = await fetch(`${window.location.origin}/web_data/sica_l1_areas.json`);
                            if (res.ok) fullData.areas[1] = await res.json();
                        }
                        const filteredFeatures = fullData.areas[1].features.filter(f => 
                            paNames.includes(f.properties.nombre) && f.properties.iso3 === (activeAdminFeature.Pais_cod3 || activeAdminFeature.iso3)
                        );
                        if (geojsonLayer) map.removeLayer(geojsonLayer);
                        pasLayer = L.geoJSON({ type: 'FeatureCollection', features: filteredFeatures }, {
                            pane: 'paBoundaryPane',
                            style: (f) => ({
                                fillColor: 'transparent',
                                weight: 1.5, color: '#ffffff', fillOpacity: 0, dashArray: '3, 3'
                            }),
                            onEachFeature: (f,l) => {
                                l.bindPopup(`<strong>${f.properties.nombre}</strong>`);
                                l.on({
                                    mouseover: (e) => e.target.setStyle({ weight: 3 }),
                                    mouseout: (e) => e.target.setStyle({ weight: 1.5 })
                                });
                            }
                        }).addTo(map);
                        geojsonLayer = pasLayer;
                        applyMapMask(activeAdminFeature);
                    } else {
                        await updateAdminView();
                    }
                } else if (currentApp === 'areas') {
                    if (tabId === 'info') {
                        await updatePAView();
                    } else if (tabId === 'ecos') {
                        // Clear any administrative boundaries/selections
                        if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
                        
                        const ecosList = document.getElementById('ecos-list');
                        const ecosData = currentEcosMetadata.ecos || {};
                        const totalPaHa = currentEcosMetadata.areaHa || 0;
                        const sortedEcos = Object.entries(ecosData).sort((a,b) => b[1] - a[1]);
                        
                        ecosList.innerHTML = sortedEcos.map(([label, ha]) => {
                            const pct = totalPaHa > 0 ? ((ha / totalPaHa) * 100).toFixed(1) : 0;
                            const color = getEcoColor(label);
                            return `
                            <div class="dash-row" onclick="highlightEcoInPA('${label.replace(/'/g, "\\'")}')" style="cursor:pointer;">
                                <div class="legend-color" style="background:${color}; width:12px; height:12px; border-radius:2px; flex-shrink:0; margin-right:8px;"></div>
                                <div class="dash-name" style="font-size:0.8rem;">${label}</div>
                                <div class="dash-value" style="font-size:0.75rem; color:var(--primary);">${Math.round(ha).toLocaleString()} Ha <span style="color:var(--gray); font-size:0.65rem;">(${pct}%)</span></div>
                            </div>
                        `;}).join('') || '<div style="padding:10px; color:var(--gray)">No hay datos de ecosistemas.</div>';

                        if (ecoChartInstance) ecoChartInstance.destroy();
                        const ctx = document.getElementById('ecoChart')?.getContext('2d');
                        if (ctx) {
                            const top = sortedEcos.slice(0, 10);
                            ecoChartInstance = new Chart(ctx, {
                                type: 'doughnut',
                                data: {
                                    labels: top.map(e => e[0].length > 30 ? e[0].substring(0,27)+'...' : e[0]),
                                    datasets: [{ 
                                        data: top.map(e => e[1]), 
                                        backgroundColor: top.map(e => getEcoColor(e[0])),
                                        borderWidth: 0
                                    }]
                                },
                                options: { 
                                    responsive: true, maintainAspectRatio: false, 
                                    plugins: { legend: { display: false } } 
                                }
                            });
                        }
                        
                        // ENSURE PA BOUNDARY + ECOS LAYER
                        if (boundaryLayer) boundaryLayer.addTo(map).bringToBack();
                        if (highlightLayer) highlightLayer.addTo(map);

                    } else if (tabId === 'pas') {
                        switchDashTab('info');
                    }
                } else if (currentApp === 'ecosistemas') {
                    if (boundaryLayer && map.hasLayer(boundaryLayer)) map.removeLayer(boundaryLayer);

                    if (tabId === 'info') {
                        const isDetailOpen = document.getElementById('detail-panel').classList.contains('visible');
                        setEcosLayerPriority(isDetailOpen ? 'info' : 'ecos');
                        // Show administrative boundaries
                        const iso = currentEcosMetadata.iso;
                        const depts = currentEcosMetadata.depts || [];
                        const deptIds = depts.map(d => String(d.id));
                        
                        if (iso && deptIds.length > 0) {
                            // Case: Ecosystem filtered by country + Ecosystem selected (show intersecting depts)
                            if (!fullData.admin.dept) {
                                try {
                                    const res = await fetch(`${window.location.origin}/web_data/sica_admin1.json`);
                                    if (res.ok) fullData.admin.dept = await res.json();
                                } catch(e) {}
                            }
                            
                            if (fullData.admin.dept) {
                                const filteredDepts = {
                                    type: 'FeatureCollection',
                                    features: fullData.admin.dept.features.filter(f => deptIds.includes(String(f.properties.Admin1_id)) && f.properties.Pais_cod3 === iso)
                                };
                                boundaryLayer = L.geoJSON(filteredDepts, {
                                    pane: 'adminBoundaryPane',
                                    style: { color: 'rgba(255,255,255,0.9)', weight: 2, fillOpacity: 0.1, dashArray: '2, 4' },
                                    onEachFeature: (f,l) => {
                                        l.bindPopup(`<strong>${f.properties.Admin1name}</strong>`);
                                        l.on({
                                            mouseover: (e) => e.target.setStyle({ weight: 4 }),
                                            mouseout: (e) => e.target.setStyle({ weight: 2 })
                                        });
                                    }
                                }).addTo(map);
                            }
                        } else if (iso) {
                            // Case: Country selected, but no specific ecosystem/info filtered (show country depts)
                            if (!fullData.admin.dept) {
                                try {
                                    const res = await fetch(`${window.location.origin}/web_data/sica_admin1.json`);
                                    if (res.ok) fullData.admin.dept = await res.json();
                                } catch(e) {}
                            }
                            if (fullData.admin.dept) {
                                const countryDepts = {
                                    type: 'FeatureCollection',
                                    features: fullData.admin.dept.features.filter(f => f.properties.Pais_cod3 === iso)
                                };
                                boundaryLayer = L.geoJSON(countryDepts, {
                                    pane: 'adminBoundaryPane',
                                    style: { color: 'rgba(255,255,255,0.7)', weight: 1.5, fillOpacity: 0.05, dashArray: '1, 3' },
                                    onEachFeature: (f,l) => {
                                        l.bindPopup(`<strong>${f.properties.Admin1name}</strong>`);
                                        l.on({
                                            mouseover: (e) => e.target.setStyle({ weight: 3 }),
                                            mouseout: (e) => e.target.setStyle({ weight: 1.5 })
                                        });
                                    }
                                }).addTo(map);
                            }
                        } else {
                            // Case: Regional view (show countries)
                            if (!fullData.admin.paises) {
                                try {
                                    const res = await fetch(`${window.location.origin}/web_data/sica_paises.json`);
                                    if (res.ok) fullData.admin.paises = await res.json();
                                } catch(e) {}
                            }
                            if (fullData.admin.paises) {
                                boundaryLayer = L.geoJSON(fullData.admin.paises, {
                                    pane: 'adminBoundaryPane',
                                    style: { color: 'rgba(255,255,255,0.6)', weight: 1.5, fillOpacity: 0.05, dashArray: '3, 6' },
                                    onEachFeature: (f,l) => {
                                        l.bindPopup(`<strong>${f.properties.Pais_es}</strong>`);
                                        l.on({
                                            mouseover: (e) => e.target.setStyle({ weight: 3 }),
                                            mouseout: (e) => e.target.setStyle({ weight: 1.5 })
                                        });
                                    }
                                }).addTo(map);
                            }
                        }
                    } else if (tabId === 'pas') {
                        const isDetailOpen = document.getElementById('detail-panel').classList.contains('visible');
                        setEcosLayerPriority(isDetailOpen ? 'pas' : 'ecos');
                        const paStats = currentEcosMetadata.paStats;
                        const iso = currentEcosMetadata.iso;
                        if (paStats && paStats.paList.length > 0) {
                            if (!fullData.areas[1]) {
                                fetch(`../web_data/sica_l1_areas.json`).then(r => r.json()).then(data => {
                                    fullData.areas[1] = data;
                                    syncPAMap(paStats, iso);
                                });
                            } else {
                                syncPAMap(paStats, iso);
                            }
                        }
                        setTimeout(() => renderPACharts(paStats), 100);
                    }
                }
            } catch (err) {
                console.error('Dashboard error:', err);
            } finally {
                showLoader(false);
            }
        }

        function buildAdminAccordion(iso, filteredDeptIds = null, filteredMuniIds = null, stats = null) {
            if (!adminHierarchy[iso]?.admin1) return '';
            const depts = adminHierarchy[iso].admin1;
            let html = '<div style="margin-top:10px;">';
            
            Object.entries(depts).forEach(([deptId, deptData]) => {
                if (filteredDeptIds && !filteredDeptIds.includes(deptId)) return;
                let munis = deptData.admin2 || {};
                if (filteredMuniIds) {
                    const filteredMunis = {};
                    Object.entries(munis).forEach(([mId, mName]) => {
                        if (filteredMuniIds.includes(mId)) filteredMunis[mId] = mName;
                    });
                    munis = filteredMunis;
                }
                const muniCount = Object.keys(munis).length;
                if (muniCount === 0 && (filteredDeptIds || filteredMuniIds)) return;

                let deptStatsLabel = '';
                if (stats && stats.deptMap && stats.deptMap[deptData.name]) {
                    const ha = stats.deptMap[deptData.name];
                    const pct = ((ha / stats.totalHa) * 100).toFixed(1);
                    deptStatsLabel = `<span style="color:var(--gray); font-weight:normal; font-size:0.7rem; margin-left:5px;">(${ha.toLocaleString()} Ha - ${pct}%)</span>`;
                }

                html += `
                    <div class="accordion-item" style="border:1px solid var(--border); border-radius:8px; margin-bottom:6px; overflow:hidden;">
                        <div class="accordion-header" style="background:rgba(255,255,255,0.04); display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.85rem; font-weight:600; cursor:pointer; flex-grow:1;" onclick="highlightAdminUnit('${iso}', 1, '${deptId}')">
                                ${deptData.name} ${deptStatsLabel}
                            </span>
                            <span style="display:flex; gap:8px; align-items:center;">
                                <span style="font-size:0.75rem; color:var(--gray);">${muniCount} munis</span>
                                <span class="acc-arrow" style="color:var(--primary); transition:transform 0.2s; cursor:pointer;" 
                                      onclick="const content=this.closest('.accordion-header').nextElementSibling; content.classList.toggle('visible'); this.style.transform = content.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)'">▶</span>
                            </span>
                        </div>
                        <div class="accordion-content dash-content" style="padding:0; max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.15);">
                            <div style="padding:8px;">
                                ${Object.entries(munis).map(([muniId, muniName]) => {
                                    let muniStatsLabel = '';
                                    if (stats && stats.muniList) {
                                        const mMatch = stats.muniList.find(m => m.id === muniId);
                                        if (mMatch) {
                                            const mPct = ((mMatch.ha / stats.totalHa) * 100).toFixed(1);
                                            muniStatsLabel = `<span style="color:var(--primary); opacity:0.8; font-size:0.65rem; margin-left:5px;">(${mMatch.ha.toLocaleString()} Ha - ${mPct}%)</span>`;
                                        }
                                    }
                                    return `
                                    <div class="dash-row" style="padding:6px 8px; font-size:0.8rem; border:none; cursor:pointer; border-radius:4px; transition:background 0.2s;" 
                                         onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"
                                         onclick="highlightAdminUnit('${iso}', 2, '${muniId}')">
                                        <div class="dash-name">${muniName} ${muniStatsLabel}</div>
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

        async function zoomToAdminUnit(id, iso) {
            if (!fullData.admin.dept) {
                fullData.admin.dept = await fetch('../web_data/sica_admin1.json').then(r => r.json());
            }
            const feature = fullData.admin.dept.features.find(f => f.properties.Admin1_id == id && f.properties.Pais_cod3 == iso);
            if (feature) {
                const layer = L.geoJSON(feature);
                map.fitBounds(layer.getBounds(), { padding: [50, 50] });
            }
        }

        function applyMapMask(props) {
            if (maskLayer) map.removeLayer(maskLayer);
            if (!activeAdminGeom) return;

            const worldBounds = [[-90, -180], [90, -180], [90, 180], [-90, 180]];
            const tempLayer = L.GeoJSON.geometryToLayer(activeAdminGeom);
            const latLngs = tempLayer.getLatLngs();
            let allRings = [worldBounds];

            const extractRings = (arr) => {
                if (!arr || arr.length === 0) return;
                if (arr[0].lat !== undefined || (Array.isArray(arr[0]) && typeof arr[0][0] === 'number')) {
                    allRings.push(arr);
                } else {
                    arr.forEach(sub => extractRings(sub));
                }
            };
            extractRings(latLngs);

            maskLayer = L.polygon(allRings, {
                color: '#000', weight: 0, fillColor: '#050a0f', fillOpacity: 0.85, interactive: false 
            }).addTo(map);
        }

        async function updatePAView() {
            showLoader(true);
            try {
                const countryName = document.getElementById('pa-country').value;
                const cat = document.getElementById('pa-category').value;
                const name = document.getElementById('pa-name').value;
                const stats = fullData.paStats;
                
                let iso = null;
                if (countryName) {
                    const countryEntry = Object.entries(adminHierarchy).find(([k,v]) => v.name === countryName);
                    if (countryEntry) iso = countryEntry[0];
                }

                if (iso && !fullData.areasPartitioned[iso]) {
                    const res = await fetch(`../web_data/pa_split/pa_${iso}.json`);
                    if (res.ok) fullData.areasPartitioned[iso] = await res.json();
                }

                const currentData = (iso && fullData.areasPartitioned[iso]) ? fullData.areasPartitioned[iso] : {features:[]};

                const filterFn = (f) => {
                    const p = f.properties;
                    let match = true;
                    if (countryName && p.pais !== countryName) match = false;
                    if (cat && p.categoria !== cat) match = false;
                    if (name && p.nombre !== name) match = false;
                    return match;
                };

                const filtered = {
                    type: 'FeatureCollection',
                    features: currentData.features.filter(filterFn)
                };

                renderData(filtered, !!(countryName || cat || name));

                if (iso && !name) {
                    if (!fullData.admin.paises) {
                        const res = await fetch(`${window.location.origin}/web_data/sica_paises.json`);
                        if (res.ok) fullData.admin.paises = await res.json();
                    }
                    if (fullData.admin.paises) {
                        const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                        if (countryFeat) map.fitBounds(L.geoJSON(countryFeat).getBounds(), { padding: [20, 20] });
                    }
                }

                if (name && stats.pas[name]) {
                    const paData = stats.pas[name];
                    const panel = document.getElementById('detail-panel');
                    const content = document.getElementById('info-content');
                    
                    currentEcosMetadata = { 
                        iso: paData.iso3, 
                        munis: paData.munis,
                        ecos: paData.ecos,
                        paName: name,
                        areaHa: paData.area_ha
                    };

                    const muniCodes = paData.munis || [];
                    const deptIds = new Set();
                    const deptMap = {};
                    const muniList = [];

                    muniCodes.forEach(code => {
                        if (adminHierarchy[paData.iso3]) {
                            Object.entries(adminHierarchy[paData.iso3].admin1).forEach(([dId, dData]) => {
                                if (dData.admin2 && dData.admin2[code]) {
                                    deptIds.add(dId);
                                    muniList.push({ id: code, name: dData.admin2[code], ha: 0 }); 
                                    if (!deptMap[dData.name]) deptMap[dData.name] = 0;
                                    deptMap[dData.name]++;
                                }
                            });
                        }
                    });

                    const paAdminStats = {
                        deptLabels: Object.keys(deptMap),
                        deptValues: Object.values(deptMap)
                    };

                    content.innerHTML = `
                        <div class="detail-header">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div style="flex-grow:1;">
                                    <p class="detail-label">${paData.category}</p>
                                    <h2 class="detail-title">${name}</h2>
                                    <p style="font-size:0.8rem; color:var(--gray); margin-top:5px;">${paData.country}</p>
                                </div>
                                <button class="btn-clear" onclick="resetPASelection()" style="padding:6px 10px; font-size:0.65rem; white-space:nowrap;">
                                    <span>🧹</span> Limpiar Selección
                                </button>
                            </div>
                        </div>
                        
                        <div class="stats-grid">
                            <div class="stat-card">
                                <span class="stat-value">${Math.round(paData.area_ha).toLocaleString()}</span>
                                <span class="stat-label">Hectáreas (GIS)</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-value">${muniCodes.length}</span>
                                <span class="stat-label">Municipios</span>
                            </div>
                        </div>

                        <div class="chart-section" style="display:flex; flex-direction:column; gap:20px;">
                            <div class="pa-chart-block">
                                <p class="chart-title">Distribución por Departamento</p>
                                <div style="height:140px;"><canvas id="paDeptChart"></canvas></div>
                            </div>
                            <div class="pa-chart-block">
                                <p class="chart-title">Top Municipios (Hectáreas)</p>
                                <div style="height:180px;"><canvas id="paMuniChart"></canvas></div>
                            </div>
                        </div>

                        <div id="pa-ecos-summary" style="margin-top:25px;">
                            <p class="detail-label"><i class="fas fa-tree"></i> Ecosistemas en el Área</p>
                            <div class="stats-list" style="max-height: 250px;">
                                ${Object.keys(paData.ecos || {}).sort().map(eco => `
                                    <div class="dash-row" onclick="highlightEcoInPA('${eco.replace(/'/g, "\\'")}')" style="cursor:pointer;">
                                        <div class="legend-color" style="background: ${getEcoColor(eco)}; margin-right:8px; width:12px; height:12px; border-radius:3px;"></div>
                                        <div class="dash-name" style="font-size:0.75rem;">${eco}</div>
                                        <div class="dash-value" style="font-size:0.7rem; color:var(--primary);">${Math.round(paData.ecos[eco]).toLocaleString()} Ha</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div id="pa-admin-summary" style="margin-top:25px;">
                            <p class="detail-label"><i class="fas fa-map-pin"></i> Jerarquía de Departamentos</p>
                            <div style="margin-bottom:15px; font-size:0.85rem; color:var(--text); padding-bottom:5px; display:flex; flex-wrap:wrap; gap:5px;">
                                ${paAdminStats.deptLabels.sort().map(d => `<span style="background:rgba(59,130,246,0.1); padding:4px 10px; border-radius:15px; border:1px solid rgba(59,130,246,0.2); color:var(--primary); font-size:0.75rem;">${d}</span>`).join('')}
                            </div>
                            
                            <p class="detail-label">Jerarquía Administrativa Cruzada</p>
                            ${buildPaAdminAccordion(paData)}
                        </div>
                    `;
                    
                    panel.classList.add('visible');
                    document.getElementById('tab-ecos').style.display = 'block';
                    
                    highlightPA(paData.iso3, name, true);

                    if (ecoSubTab === 'info' || !ecoSubTab) {
                        switchDashTab('info', document.querySelector('.dash-tab[onclick*="info"]'));
                    } else {
                        switchDashTab(ecoSubTab, document.querySelector(`.dash-tab[onclick*="${ecoSubTab}"]`));
                    }

                    setTimeout(() => {
                        const ctxDept = document.getElementById('paDeptChart')?.getContext('2d');
                        if (ctxDept) {
                            new Chart(ctxDept, {
                                type: 'bar',
                                data: {
                                    labels: paAdminStats.deptLabels,
                                    datasets: [{
                                        label: 'Munis',
                                        data: paAdminStats.deptValues,
                                        backgroundColor: 'rgba(59,130,246, 0.5)',
                                        borderColor: '#3b82f6',
                                        borderWidth: 1
                                    }]
                                },
                                options: {
                                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                                    plugins: { legend: { display: false } },
                                    scales: {
                                        x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } },
                                        y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }
                                    }
                                }
                            });
                        }
                        const ctxMuni = document.getElementById('paMuniChart')?.getContext('2d');
                        if (ctxMuni) {
                            const topMunis = muniList.slice(0, 10);
                            new Chart(ctxMuni, {
                                type: 'bar',
                                data: {
                                    labels: topMunis.map(m => m.name),
                                    datasets: [{
                                        label: 'Top',
                                        data: topMunis.map((_, i) => topMunis.length - i),
                                        backgroundColor: 'rgba(16, 185, 129, 0.5)',
                                        borderColor: '#10b981',
                                        borderWidth: 1
                                    }]
                                },
                                options: {
                                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                                    plugins: { legend: { display: false } },
                                    scales: {
                                        x: { display: false },
                                        y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }
                                    }
                                }
                            });
                        }
                    }, 100);

                } else {
                    document.getElementById('detail-panel').classList.remove('visible');
                    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
                }
            } catch (err) {
                console.error('Error updating PA view:', err);
            } finally {
                showLoader(false);
            }
        }

        async function updateEcosView() {
            showLoader(true);
            try {
                const iso = document.getElementById('ecos-country').value;
                const ecoNameRaw = document.getElementById('ecos-name').value;
                const origin = window.location.origin;
                const mapping = fullData.ecosGranularMapping || {};

                if (!iso) {
                    await loadAndRenderRegionalEcos();
                    if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
                    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
                    if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
                    activeAdminGeom = null;
                    return;
                }

                if (iso && !ecoNameRaw) {
                    const countryMapping = mapping.countries && mapping.countries[iso] ? mapping.countries[iso] : {};
                    const paths = Object.values(countryMapping);
                    
                    const allFeatures = [];
                    if (paths.length > 0) {
                        await Promise.all(paths.map(async (path) => {
                            try {
                                const res = await fetch(`${origin}/web_data/${path}`);
                                if (res.ok) {
                                    const g = await res.json();
                                    if (g.features) allFeatures.push(...g.features);
                                }
                            } catch(e) {}
                        }));
                    }

                    if (!fullData.admin.paises) {
                        const r = await fetch(`${origin}/web_data/sica_paises.json`);
                        if (r.ok) fullData.admin.paises = await r.json();
                    }
                    const countryFeat = fullData.admin.paises?.features?.find(f => f.properties.Pais_cod3 === iso);
                    if (countryFeat) {
                        activeAdminGeom = countryFeat.geometry;
                        applyMapMask(countryFeat);
                        if (boundaryLayer) map.removeLayer(boundaryLayer);
                        boundaryLayer = L.geoJSON(countryFeat, {
                            style: { color: '#ffffff', weight: 1.5, fillOpacity: 0, interactive: false, dashArray: '5, 5' }
                        }).addTo(map);
                    }

                    if (allFeatures.length > 0) {
                        renderData({ type: 'FeatureCollection', features: allFeatures }, true);
                    }

                    if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
                    if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }

                    const countryName = adminHierarchy[iso]?.name || iso;
                    const panel = document.getElementById('detail-panel');
                    const infoContent = document.getElementById('info-content');
                    const pasContent = document.getElementById('pas-content');
                    
                    currentEcosMetadata = { depts: [], munis: [], pas: [], ecoName: '', iso: iso };
                    
                    infoContent.innerHTML = `
                        <div class="detail-header">
                            <p class="detail-label">Divisiones Administrativas</p>
                            <h2 class="detail-title">${countryName}</h2>
                        </div>
                        <div id="country-admin-summary" style="margin-top:15px;">
                            ${buildAdminAccordion(iso)}
                        </div>`;

                    const countryPAStats = {
                        totalHa: 0,
                        categoryMap: {},
                        paList: [],
                        iso: iso
                    };
                    if (fullData.paStats && fullData.paStats.pas) {
                        Object.entries(fullData.paStats.pas).forEach(([paName, paData]) => {
                            if (paData.iso3 === iso) {
                                countryPAStats.totalHa += paData.area_ha;
                                countryPAStats.paList.push({ name: paName, ha: paData.area_ha, category: paData.category });
                                if (!countryPAStats.categoryMap[paData.category]) countryPAStats.categoryMap[paData.category] = 0;
                                countryPAStats.categoryMap[paData.category] += paData.area_ha;
                            }
                        });
                    }
                    countryPAStats.categoryLabels = Object.keys(countryPAStats.categoryMap);
                    countryPAStats.categoryValues = Object.values(countryPAStats.categoryMap);
                    currentEcosMetadata.paStats = countryPAStats;

                    pasContent.innerHTML = `
                        <div class="detail-header">
                            <p class="detail-label">Áreas Protegidas Nacionales</p>
                            <h2 class="detail-title">${countryName}</h2>
                        </div>
                        <div id="country-pa-summary" style="margin-top:15px;">
                            ${buildPAAccordion(iso, countryPAStats)}
                        </div>`;

                    document.getElementById('tab-ecos').style.display = 'none'; 
                    document.getElementById('tab-pas').style.display = 'block';
                    
                    panel.classList.add('visible');
                    
                    if (ecoSubTab === 'pas') {
                        switchDashTab('pas', document.querySelector('.dash-tab[onclick*="pas"]'));
                    } else {
                        switchDashTab('info', document.querySelector('.dash-tab[onclick*="info"]'));
                    }

                    updateAccordionLegend(true);
                    return;
                }

                if (iso && ecoNameRaw) {
                    const countryMapping = mapping.countries && mapping.countries[iso] ? mapping.countries[iso] : {};
                    let microPath = countryMapping[ecoNameRaw] || null;

                    if (!microPath) {
                        const norm = normalizeStr(ecoNameRaw);
                        for (const [key, path] of Object.entries(countryMapping)) {
                            if (normalizeStr(key) === norm) { microPath = path; break; }
                        }
                    }

                    if (!microPath && mapping.regional) {
                        microPath = mapping.regional[ecoNameRaw] || null;
                        if (!microPath) {
                            const norm = normalizeStr(ecoNameRaw);
                            for (const [key, path] of Object.entries(mapping.regional)) {
                                if (normalizeStr(key) === norm) { microPath = path; break; }
                            }
                        }
                    }

                    if (microPath) {
                        const res = await fetch(`${origin}/web_data/${microPath}`);
                        if (!res.ok) throw new Error(`HTTP ${res.status} para ${microPath}`);
                        const filteredEcos = await res.json();

                        if (!fullData.admin.paises) {
                            const r = await fetch(`${origin}/web_data/sica_paises.json`);
                            if (r.ok) fullData.admin.paises = await r.json();
                        }
                        const countryFeat = fullData.admin.paises?.features?.find(f => f.properties.Pais_cod3 === iso);
                        if (countryFeat) {
                            activeAdminGeom = countryFeat.geometry;
                            applyMapMask(countryFeat);
                            if (boundaryLayer) map.removeLayer(boundaryLayer);
                            boundaryLayer = L.geoJSON(countryFeat, {
                                style: { color: '#ffffff', weight: 1.5, fillOpacity: 0, interactive: false, dashArray: '5, 5' }
                            }).addTo(map);
                        }
                        if (vectorTileLayer) { map.removeLayer(vectorTileLayer); vectorTileLayer = null; }
                        renderData(filteredEcos, true);

                        if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
                        if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }

                        const ecoName = normalizeStr(ecoNameRaw);
                        const panel = document.getElementById('detail-panel');
                        
                        lastEcoFeatures = filteredEcos;
                        lastEcoIso = iso;
                        lastEcoNameRaw = ecoNameRaw;

                        currentEcosMetadata = { depts: [], munis: [], pas: [], ecoName: ecoNameRaw, iso: iso };
                        
                        document.getElementById('tab-ecos').style.display = 'none';
                        document.getElementById('tab-pas').style.display = 'block';

                        const stats = {
                            totalHa: 0,
                            deptMap: {},
                            deptIdsMap: {},
                            muniList: [],
                            iso: iso,
                            deptLabels: [], deptValues: [], muniLabels: [], muniValues: []
                        };

                        if (adminHierarchy[iso]?.admin1) {
                            const depts = adminHierarchy[iso].admin1;
                            Object.entries(depts).forEach(([deptId, deptData]) => {
                                let deptArea = 0;
                                if (deptData.admin2) {
                                    Object.entries(deptData.admin2).forEach(([muniId, muniName]) => {
                                        const muniEcos = adminStats?.muni?.ecos?.[muniId] || [];
                                        const match = muniEcos.find(e => normalizeStr(e.label) === ecoName);
                                        if (match) {
                                            stats.totalHa += match.ha;
                                            deptArea += match.ha;
                                            stats.muniList.push({ name: muniName, ha: match.ha, id: muniId });
                                            if (!currentEcosMetadata.munis.includes(muniId)) currentEcosMetadata.munis.push(muniId);
                                        }
                                    });
                                }
                                if (deptArea > 0) {
                                    stats.deptMap[deptData.name] = deptArea;
                                    stats.deptIdsMap[deptData.name] = deptId;
                                    currentEcosMetadata.depts.push({ id: deptId, name: deptData.name });
                                }
                            });
                        }

                        const paStats = {
                            totalHa: 0,
                            categoryMap: {},
                            paList: [],
                            iso: iso,
                            categoryLabels: [], categoryValues: []
                        };

                        if (fullData.paStats && fullData.paStats.pas) {
                            Object.entries(fullData.paStats.pas).forEach(([paName, paData]) => {
                                if (paData.iso3 === iso) {
                                    let ecoMatchHa = 0;
                                    for (const [paEcoLabel, ha] of Object.entries(paData.ecos)) {
                                        if (normalizeStr(paEcoLabel) === ecoName) {
                                            ecoMatchHa = ha;
                                            break;
                                        }
                                    }

                                    if (ecoMatchHa > 0) {
                                        paStats.totalHa += ecoMatchHa;
                                        paStats.paList.push({ name: paName, ha: ecoMatchHa, category: paData.category });
                                        
                                        if (!paStats.categoryMap[paData.category]) paStats.categoryMap[paData.category] = 0;
                                        paStats.categoryMap[paData.category] += ecoMatchHa;
                                    }
                                }
                            });
                        }
                        
                        paStats.categoryLabels = Object.keys(paStats.categoryMap);
                        paStats.categoryValues = Object.values(paStats.categoryMap);
                        currentEcosMetadata.paStats = paStats;
                        currentEcosMetadata.adminStats = stats;

                        stats.deptLabels = Object.keys(stats.deptMap);
                        stats.deptValues = Object.values(stats.deptMap);
                        
                        const sortedMunis = [...stats.muniList].sort((a,b) => b.ha - a.ha).slice(0, 5);
                        stats.muniLabels = sortedMunis.map(m => {
                            let parentName = '';
                            if (adminHierarchy[iso]?.admin1) {
                                Object.values(adminHierarchy[iso].admin1).forEach(d => {
                                    if (d.admin2 && d.admin2[m.id]) parentName = d.name;
                                });
                            }
                            return parentName ? `${m.name} (${parentName})` : m.name;
                        });
                        stats.muniValues = sortedMunis.map(m => m.ha);

                        const unescoCode = filteredEcos.features?.[0]?.properties?.UNESCO || 'N/A';
                        const commonHeader = `
                            <div class="detail-header" style="position:relative;">
                                <p class="detail-label">CÓDIGO: ${unescoCode}</p>
                                <h2 class="detail-title" style="font-size:1.1rem;">${ecoNameRaw}</h2>
                            </div>`;

                        const infoContent = document.getElementById('info-content');
                        infoContent.innerHTML = `
                            ${commonHeader}
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <span class="stat-value">${stats.totalHa.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                                    <span class="stat-label">Hectáreas Totales</span>
                                </div>
                                <div class="stat-card">
                                    <span class="stat-value">${stats.muniList.length}</span>
                                    <span class="stat-label">Municipios</span>
                                </div>
                            </div>

                            <div class="chart-section">
                                <p class="chart-title">Distribución por Departamento</p>
                                <div class="chart-container">
                                    <canvas id="deptChart"></canvas>
                                </div>
                            </div>

                            <div class="chart-section">
                                <p class="chart-title">Top Municipios (Ha)</p>
                                <div class="chart-container">
                                    <canvas id="muniChart"></canvas>
                                </div>
                            </div>

                            <div id="ecosystem-admin-summary">
                                <div class="admin-section-header">
                                    <p class="detail-label" style="margin:0;">Jerarquía Administrativa Detallada</p>
                                    <button class="btn-clear" onclick="resetEcosSelection()" style="margin:0;">
                                        <span>🧹</span> Limpiar Mapa
                                    </button>
                                </div>
                                ${buildAdminAccordion(iso, stats.deptLabels.map(n => stats.deptIdsMap[n]), null, stats)}
                            </div>
                        `;

                        const pasContent = document.getElementById('pas-content');
                        pasContent.innerHTML = `
                            ${commonHeader}
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <span class="stat-value">${(paStats?.totalHa || 0).toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                                    <span class="stat-label">Hectáreas en APs</span>
                                </div>
                                <div class="stat-card">
                                    <span class="stat-value">${paStats?.paList.length || 0}</span>
                                    <span class="stat-label">Áreas Protegidas</span>
                                </div>
                            </div>

                            <div class="chart-section">
                                <p class="chart-title">Distribución por Categoría</p>
                                <div class="chart-container">
                                    <canvas id="paCategoryChart"></canvas>
                                </div>
                            </div>

                            <div class="chart-section">
                                <p class="chart-title">Top Áreas Protegidas (Ha)</p>
                                <div class="chart-container">
                                    <canvas id="paNameChart"></canvas>
                                </div>
                            </div>

                            <div id="ecosystem-pa-summary">
                                <div class="admin-section-header">
                                    <p class="detail-label" style="margin:0;">Jerarquía de Categorías y Áreas</p>
                                    <button class="btn-clear" onclick="resetEcosSelection()" style="margin:0;">
                                        <span>🧹</span> Limpiar Mapa
                                    </button>
                                </div>
                                ${buildPAAccordion(iso, paStats)}
                            </div>
                        `;

                        panel.classList.add('visible');
                        
                        if (ecoSubTab === 'pas') {
                            switchDashTab('pas', document.querySelector('.dash-tab[onclick*="pas"]'));
                        } else {
                            switchDashTab('info', document.querySelector('.dash-tab[onclick*="info"]'));
                        }
                        
                        setTimeout(() => {
                            renderEcosCharts(stats);
                            if (ecoSubTab === 'pas') renderPACharts(paStats);
                        }, 100);

                    } else {
                        console.warn(`No se encontró micro-archivo para: ${ecoNameRaw} en ${iso}`);
                    }
                    updateAccordionLegend(true);
                    return;
                }

                updateAccordionLegend(true);

            } catch (err) {
                console.error('Error en updateEcosView:', err);
            } finally {
                showLoader(false);
            }
        }

        function buildPAAccordion(iso, paStats) {
            if (!paStats || paStats.paList.length === 0) {
                return '<div style="padding:20px; text-align:center; color:var(--gray); font-size:0.8rem;">No hay áreas protegidas detectadas en este ecosistema.</div>';
            }

            const categories = {};
            paStats.paList.forEach(pa => {
                if (!categories[pa.category]) categories[pa.category] = [];
                categories[pa.category].push(pa);
            });

            let html = '<div style="margin-top:10px;">';
            Object.entries(categories).sort().forEach(([catName, pas]) => {
                const catHa = paStats.categoryMap[catName];
                const catPct = ((catHa / paStats.totalHa) * 100).toFixed(1);
                const catStatsLabel = `<span style="color:var(--gray); font-weight:normal; font-size:0.75rem; margin-left:8px;">(${catHa.toLocaleString(undefined, {maximumFractionDigits:0})} Ha - ${catPct}%)</span>`;

                html += `
                    <div class="accordion-item" style="border:1px solid var(--border); border-radius:10px; margin-bottom:8px; overflow:hidden; background:rgba(255,255,255,0.02);">
                        <div class="accordion-header" style="padding:12px 15px; cursor:pointer; display:flex; align-items:center; justify-content:space-between;" onclick="this.parentElement.classList.toggle('active'); highlightPACategory('${iso}', '${catName.replace(/'/g, "\\'")}')">
                            <div class="country-title" style="font-size:0.85rem; font-weight:600;">
                                ${catName} ${catStatsLabel}
                            </div>
                            <span class="toggle-symbol">▶</span>
                        </div>
                        <div class="accordion-content" style="background:rgba(0,0,0,0.2);">
                            <div style="padding:5px 0;">
                                ${pas.sort((a,b) => b.ha - a.ha).map(pa => {
                                    const paPct = ((pa.ha / paStats.totalHa) * 100).toFixed(1);
                                    const paStatsLabel = `<span style="color:var(--primary); opacity:0.8; font-size:0.7rem; margin-left:5px;">(${pa.ha.toLocaleString(undefined, {maximumFractionDigits:0})} Ha - ${paPct}%)</span>`;
                                    return `
                                        <div class="dash-row" style="padding:10px 15px; cursor:pointer;" onclick="highlightPA('${iso}', '${pa.name.replace(/'/g, "\\'")}')">
                                            <div class="dash-name" style="font-size:0.8rem;">${pa.name} ${paStatsLabel}</div>
                                            <div style="color:var(--primary); font-size:0.8rem;">📍</div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            return html;
        }

        async function highlightPA(iso, paName) {
            showLoader(true);
            try {
                const isoKey = iso.toUpperCase();
                if (!fullData.areasPartitioned[isoKey]) {
                    const res = await fetch(`../web_data/pa_split/pa_${isoKey}.json`);
                    if (res.ok) fullData.areasPartitioned[isoKey] = await res.json();
                    else throw new Error("Could not load country PAs");
                }
                
                const paDoc = fullData.areasPartitioned[isoKey];
                const cleanName = normalizeStr(paName);
                
                const paFeat = paDoc.features.find(f => {
                    const props = f.properties;
                    const possibleNames = [props.nombre, props.NOMBRE, props.Name, props.NAME, props.pa_name];
                    return possibleNames.some(n => n && normalizeStr(n) === cleanName);
                });
                
                if (paFeat) {
                    if (highlightLayer) map.removeLayer(highlightLayer);
                    highlightLayer = L.geoJSON(paFeat, {
                        pane: 'selectionPane',
                        style: { color: '#ffffff', weight: 4, fillOpacity: 0.1, fillColor: '#ffffff' },
                        onEachFeature: (f, l) => {
                            l.bindPopup(`<strong>${f.properties.nombre}</strong><br>${f.properties.categoria}`);
                        }
                    }).addTo(map);

                    activeAdminGeom = paFeat.geometry;
                    applyMapMask(); // Match Ecosystems 2002 mask/fit behavior
                    map.fitBounds(highlightLayer.getBounds(), { padding: [50, 50], maxZoom: 14 });
                } else {
                    console.warn("PA Feature not found for robust matching:", paName, "in country", isoKey);
                }
            } catch(e) {
                console.error("Error highlighting PA:", e);
            } finally {
                showLoader(false);
            }
        }

        function syncPAMap(paStats, iso) {
            if (!fullData.areas[1] || !paStats) return;
            const paNames = paStats.paList.map(pa => pa.name);
            const features = fullData.areas[1].features.filter(f => paNames.includes(f.properties.nombre) && f.properties.iso3 === iso);
            
            if (boundaryLayer && map.hasLayer(boundaryLayer)) map.removeLayer(boundaryLayer);
            boundaryLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
                pane: 'paBoundaryPane',
                style: (f) => ({
                    fillColor: 'transparent',
                    weight: 1.5, color: '#ffffff', fillOpacity: 0, dashArray: '3, 3'
                }),
                onEachFeature: (f, l) => {
                    const p = f.properties;
                    l.bindPopup(`<strong>${p.nombre}</strong><br>${p.categoria}`);
                    l.on({
                        mouseover: (e) => e.target.setStyle({ weight: 3 }),
                        mouseout: (e) => e.target.setStyle({ weight: 1.5 })
                    });
                }
            }).addTo(map);
        }

        function renderPACharts(stats) {
            if (!stats) return;
            
            const catCtx = document.getElementById('paCategoryChart')?.getContext('2d');
            if (catCtx) {
                new Chart(catCtx, {
                    type: 'doughnut',
                    data: {
                        labels: stats.categoryLabels,
                        datasets: [{
                            data: stats.categoryValues,
                            backgroundColor: stats.categoryLabels.map(cat => getStableColor(cat, stats.iso)),
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, font: { size: 10 } } }
                        }
                    }
                });
            }

            const nameCtx = document.getElementById('paNameChart')?.getContext('2d');
            if (nameCtx) {
                const sortedPAs = [...stats.paList].sort((a,b) => b.ha - a.ha).slice(0, 5);
                new Chart(nameCtx, {
                    type: 'bar',
                    data: {
                        labels: sortedPAs.map(pa => {
                            const shortName = pa.name.length > 20 ? pa.name.substring(0, 18) + '..' : pa.name;
                            return `${shortName} (${pa.category})`;
                        }),
                        datasets: [{
                            label: 'Ha',
                            data: sortedPAs.map(pa => pa.ha),
                            backgroundColor: 'rgba(16, 185, 129, 0.5)',
                            borderColor: '#10b981',
                            borderWidth: 1,
                            borderRadius: 4
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 9 } } },
                            y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 8 } } }
                        }
                    }
                });
            }
        }

        function showLoader(visible) {
            const loader = document.getElementById('loader');
            if (loader) loader.style.display = visible ? 'flex' : 'none';
        }

        function initAdminSelectors() {
            const countryFilter = document.getElementById('admin-country');
            if (!countryFilter) return;
            countryFilter.innerHTML = '<option value="">Todos los Países</option>' +
                Object.entries(adminHierarchy).map(([iso, data]) => `<option value="${iso}">${data.name}</option>`).join('');
            countryFilter.addEventListener('change', updateAdminView);
        }

        function initEcosSelectors() {
            const countryFilter = document.getElementById('ecos-country');
            const ecoName = document.getElementById('ecos-name');
            if (!countryFilter || !ecoName) return;
            
            countryFilter.innerHTML = '<option value="">Ver Regional (Mesoamérica)</option>' +
                Object.entries(adminHierarchy).map(([iso, data]) => `<option value="${iso}">${data.name}</option>`).join('');
            
            countryFilter.addEventListener('change', async () => {
                const iso = countryFilter.value;
                ecoName.innerHTML = '<option value="">Seleccione Ecosistema</option>';
                if (!iso) {
                    ecoName.disabled = true;
                    updateEcosView();
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
                updateEcosView();
            });
            
            ecoName.addEventListener('change', updateEcosView);
        }

        async function updatePAView() {
            showLoader(true);
            try {
                const country = document.getElementById('pa-country').value;
                const category = document.getElementById('pa-category').value;
                const name = document.getElementById('pa-name').value;
                
                const catSelect = document.getElementById('pa-category');
                const nameSelect = document.getElementById('pa-name');
                
                // Enable/disable based on country selection
                catSelect.disabled = !country;
                nameSelect.disabled = !country;

                if (!fullData.paStats) {
                    console.error("pa_granular_stats.json not loaded yet");
                    return;
                }

                // If a specific PA name is selected, highlight it
                if (name) {
                    const paData = fullData.paStats.pas[name];
                    if (paData) {
                        const iso = Object.keys(adminHierarchy).find(k => adminHierarchy[k].name === country);
                        await highlightPA(iso, name);
                        
                        // Update detail panel for the selected PA
                        const content = document.getElementById('info-content');
                        const panel = document.getElementById('detail-panel');
                        
                        content.innerHTML = `
                            <div class="detail-header">
                                <p class="detail-label">${paData.category}</p>
                                <h2 class="detail-title">${name}</h2>
                                <div class="detail-badge">${country}</div>
                            </div>
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <span class="stat-value">${paData.ha.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                                    <span class="stat-label">Hectáreas Totales</span>
                                </div>
                            </div>
                            <div class="chart-section pa-detail-vertical">
                                <div class="pa-chart-block">
                                    <p class="chart-title">Distribución por Departamento</p>
                                    <div class="chart-container"><canvas id="paDeptChart"></canvas></div>
                                </div>
                                <div class="pa-chart-block">
                                    <p class="chart-title">Top de Municipios</p>
                                    <div class="chart-container"><canvas id="paMuniChart"></canvas></div>
                                </div>
                            </div>
                            <div class="admin-section-header">
                                <p class="detail-label" style="margin:0;">Unidades Administrativas</p>
                            </div>
                            ${buildPaAdminAccordion(paData)}
                            
                            <div class="admin-section-header" style="margin-top:20px;">
                                <p class="detail-label" style="margin:0;">Ecosistemas Presentes</p>
                            </div>
                            <div id="pa-ecos-list" class="stats-list" style="max-height:none;">
                                ${paData.ecos.sort((a,b) => b.ha - a.ha).map(eco => {
                                    const color = getEcoColor(eco.name);
                                    return `
                                        <div class="legend-row" style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                                            <div class="legend-color" style="background:${color}; width:12px; height:12px;"></div>
                                            <div class="legend-label" style="font-size:0.8rem; display:flex; justify-content:space-between; width:100%;">
                                                <span>${eco.name}</span>
                                                <span style="color:var(--primary); font-weight:600;">${eco.ha.toLocaleString(undefined, {maximumFractionDigits:0})} Ha</span>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                        
                        panel.classList.add('visible');
                        switchDashTab('info', document.querySelector('.dash-tab'));
                        
                        // Render Charts with specific PA stats
                        setTimeout(() => {
                            const deptData = {
                                deptLabels: paData.depts.map(d => d.name),
                                deptValues: paData.depts.map(d => d.ha),
                                iso: paData.iso3
                            };
                            const muniData = {
                                muniLabels: paData.munis_names.slice(0, 10), // Limit top 10
                                muniValues: paData.munis_ha.slice(0, 10),
                                iso: paData.iso3
                            };
                            renderEcosCharts({ ...deptData, ...muniData });
                        }, 150);
                    }
                } else if (country) {
                    // Just a country (or country + category)
                    // Reset single selection highlight
                    if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
                    if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
                    
                    const iso = Object.keys(adminHierarchy).find(k => adminHierarchy[k].name === country);
                    
                    // Show all PAs for this country in the baseline layer
                    const filteredStats = {
                        paList: Object.entries(fullData.paStats.pas)
                            .filter(([n, d]) => d.country === country && (!category || d.category === category))
                            .map(([n, d]) => ({ name: n, ...d })),
                        iso: iso
                    };
                    
                    syncPAMap(filteredStats, iso);
                    
                    // Fit map to the country
                    if (iso && fullData.admin.paises) {
                        const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                        if (countryFeat) map.fitBounds(L.geoJSON(countryFeat).getBounds(), { padding: [50,50] });
                    }
                } else {
                    // No country selected, show all? Or just reset.
                    resetMapAndDashboard();
                    map.setView([15, -86], 6);
                }
            } catch(e) {
                console.error("Error in updatePAView:", e);
            } finally {
                showLoader(false);
            }
        }

        function initPASelectors() {
            const cFilter = document.getElementById('pa-country');
            const catFilter = document.getElementById('pa-category');
            const nameFilter = document.getElementById('pa-name');
            if (!cFilter) return;

            cFilter.innerHTML = '<option value="">Todos los Países</option>' +
                Object.entries(adminHierarchy).map(([iso, data]) => `<option value="${data.name}">${data.name}</option>`).join('');

            const updateSubFilters = async () => {
                const cName = cFilter.value;
                const cat = catFilter.value;
                
                catFilter.innerHTML = '<option value="">Todas las Categorías</option>';
                nameFilter.innerHTML = '<option value="">Todas las Áreas</option>';

                if (!fullData.paStats || !fullData.paStats.pas) return;

                const cats = new Set();
                const pas = [];
                Object.entries(fullData.paStats.pas).forEach(([name, data]) => {
                    if ((!cName || data.country === cName) && (!cat || data.category === cat)) {
                        cats.add(data.category);
                        pas.push(name);
                    }
                });

                if (!cat) {
                    Array.from(cats).sort().forEach(c => {
                        catFilter.innerHTML += `<option value="${c}">${c}</option>`;
                    });
                } else {
                    // Mantiene la categoría seleccionada
                    Array.from(new Set(Object.values(fullData.paStats.pas).map(p=>p.category))).sort().forEach(c => {
                         const opt = document.createElement('option');
                         opt.value = c; opt.innerText = c;
                         if (c === cat) opt.selected = true;
                         catFilter.appendChild(opt);
                    });
                }
                
                pas.sort().forEach(p => {
                    nameFilter.innerHTML += `<option value="${p}">${p}</option>`;
                });
            };

            cFilter.addEventListener('change', () => { updateSubFilters(); updatePAView(); });
            catFilter.addEventListener('change', () => { updateSubFilters(); updatePAView(); });
            nameFilter.addEventListener('change', updatePAView);
        }

        let ecosPulseInterval = null;
        function renderData(geojson, fitBounds) {
            if (ecosLayer) map.removeLayer(ecosLayer);
            if (vectorTileLayer) map.removeLayer(vectorTileLayer);
            
            ecosLayer = L.geoJSON(geojson, {
                pane: 'ecosystemPane',
                style: (f) => ({
                    color: getFeatureColor(f.properties),
                    weight: 1,
                    fillOpacity: 0.8,
                    fillColor: getFeatureColor(f.properties)
                }),
                onEachFeature: (f, l) => {
                    const p = f.properties;
                    const label = p.nombre || p.LEYENDA || p.categoria || 'Unidad';
                    l.bindPopup(`<strong>${label}</strong><br>${p.pais || p.iso3 || ''}`);
                    l.on({
                        mouseover: (e) => {
                            const layer = e.target;
                            layer.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 0.9 });
                            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) layer.bringToFront();
                        },
                        mouseout: (e) => ecosLayer.resetStyle(e.target),
                        click: (e) => {
                            if (currentApp === 'areas') {
                                // En visor de Áreas, al hacer clic mostramos info detallada
                                // highlightPA(p.iso3, p.nombre); // Opcional
                            }
                        }
                    });
                }
            }).addTo(map);

            if (fitBounds && geojson.features && geojson.features.length > 0) {
                map.fitBounds(ecosLayer.getBounds(), { padding: [50, 50] });
            }
        }

        async function updateAdminView() {
            showLoader(true);
            try {
                const iso = document.getElementById('admin-country').value;
                if (!iso) {
                    resetMapAndDashboard();
                    map.setView([15, -86], 6);
                    return;
                }

                if (!fullData.admin.paises) {
                    fullData.admin.paises = await fetch(`${window.location.origin}/web_data/sica_paises.json`).then(r => r.json());
                }

                const countryFeat = fullData.admin.paises.features.find(f => f.properties.Pais_cod3 === iso);
                if (countryFeat) {
                    activeAdminGeom = countryFeat.geometry;
                    applyMapMask(countryFeat);
                    if (boundaryLayer) map.removeLayer(boundaryLayer);
                    boundaryLayer = L.geoJSON(countryFeat, {
                        style: { color: '#ffffff', weight: 2, fillOpacity: 0, interactive: false, dashArray: '5, 5' }
                    }).addTo(map);
                    map.fitBounds(boundaryLayer.getBounds(), { padding: [30, 30] });
                }

                updateDashboard(iso);
            } catch(e) { console.error(e); }
            finally { showLoader(false); }
        }

        function updateDashboard(iso) {
            const countryName = adminHierarchy[iso]?.name || iso;
            const panel = document.getElementById('detail-panel');
            const content = document.getElementById('info-content');
            
            currentEcosMetadata = { iso: iso };
            
            content.innerHTML = `
                <div class="detail-header">
                    <p class="detail-label">Divisiones Administrativas</p>
                    <h2 class="detail-title">${countryName}</h2>
                </div>
                <div id="admin-summary" style="margin-top:15px;">
                    ${buildAdminAccordion(iso)}
                </div>`;
                
            panel.classList.add('visible');
            document.getElementById('tab-ecos').style.display = 'none';
            document.getElementById('tab-pas').style.display = 'none';
            switchDashTab('info', document.querySelector('.dash-tab'));
        }

        async function highlightAdminUnit(iso, level, id) {
            showLoader(true);
            try {
                const type = level === 1 ? 'admin1' : 'admin2';
                const filename = level === 1 ? 'sica_admin1.json' : 'sica_admin2.json';
                const cacheKey = level === 1 ? 'dept' : 'muni';

                if (!fullData.admin[cacheKey]) {
                    fullData.admin[cacheKey] = await fetch(`../web_data/${filename}`).then(r => r.json());
                }

                const feat = fullData.admin[cacheKey].features.find(f => {
                    const p = f.properties;
                    return p.Pais_cod3 === iso && (p.Admin1_id == id || p.Admin2_id == id);
                });

                if (feat) {
                    if (highlightLayer) map.removeLayer(highlightLayer);
                    highlightLayer = L.geoJSON(feat, {
                        pane: 'selectionPane',
                        style: { color: '#ffffff', weight: 4, fillOpacity: 0.1, fillColor: '#ffffff' }
                    }).addTo(map);
                    
                    activeAdminGeom = feat.geometry;
                    applyMapMask();
                    map.fitBounds(highlightLayer.getBounds(), { padding: [50, 50], maxZoom: 12 });
                    
                    // Mostrar popup con nombre
                    const p = feat.properties;
                    const name = level === 1 ? p.Admin1_nom : p.Admin2_nom;
                    highlightLayer.bindPopup(`<strong>${name}</strong>`).openPopup();
                }
            } finally { showLoader(false); }
        }

        function switchDashTab(tabId, btn) {
            if (!btn) return;
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');

            document.getElementById('info-content').style.display = tabId === 'info' ? 'block' : 'none';
            document.getElementById('ecos-content').style.display = tabId === 'ecos' ? 'block' : 'none';
            document.getElementById('pas-content').style.display = tabId === 'pas' ? 'block' : 'none';
            
            ecoSubTab = tabId;
            if (tabId === 'pas' && currentEcosMetadata.paStats) {
                setTimeout(() => renderPACharts(currentEcosMetadata.paStats), 100);
            }
        }

        function syncPAMap(paStats, iso) {
            if (!fullData.areas[1] || !paStats) return;
            const paNames = paStats.paList.map(pa => pa.name);
            const features = fullData.areas[1].features.filter(f => paNames.includes(f.properties.nombre) && f.properties.iso3 === iso);
            
            if (boundaryLayer && map.hasLayer(boundaryLayer)) map.removeLayer(boundaryLayer);
            boundaryLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
                pane: 'paBoundaryPane',
                style: (f) => ({
                    fillColor: 'transparent',
                    weight: 1.5, color: '#ffffff', fillOpacity: 0, dashArray: '3, 3'
                }),
                onEachFeature: (f, l) => {
                    const p = f.properties;
                    l.bindPopup(`<strong>${p.nombre}</strong><br>${p.categoria}`);
                    l.on({
                        mouseover: (e) => e.target.setStyle({ weight: 3 }),
                        mouseout: (e) => e.target.setStyle({ weight: 1.5 })
                    });
                }
            }).addTo(map);
        }

        function resetPAViewer() {
            document.getElementById('pa-country').value = '';
            document.getElementById('pa-category').innerHTML = '<option value="">Seleccione Categoría (Opcional)</option>';
            document.getElementById('pa-category').disabled = true;
            document.getElementById('pa-name').innerHTML = '<option value="">Seleccione Área</option>';
            document.getElementById('pa-name').disabled = true;
            
            resetMapAndDashboard();
            map.setView([15, -86], 6);
            updatePAView();
        }

        function renderEcosCharts(stats) {
            if (!stats) return;
            const ctxDept = document.getElementById('deptChart')?.getContext('2d');
            if (ctxDept) {
                new Chart(ctxDept, {
                    type: 'doughnut',
                    data: {
                        labels: stats.deptLabels,
                        datasets: [{
                            data: stats.deptValues,
                            backgroundColor: stats.deptLabels.map(d => getStableColor(d, stats.iso)),
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
            if (ctxMuni) {
                new Chart(ctxMuni, {
                    type: 'bar',
                    data: {
                        labels: stats.muniLabels,
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

        function buildPaAdminAccordion(paData) {
            const iso = paData.iso3;
            const muniCodes = paData.munis || [];
            const depts = {};
            
            muniCodes.forEach(code => {
                if (adminHierarchy[iso]) {
                    Object.entries(adminHierarchy[iso].admin1).forEach(([dId, dData]) => {
                        if (dData.admin2 && dData.admin2[code]) {
                            if (!depts[dId]) depts[dId] = { name: dData.name, munis: {} };
                            depts[dId].munis[code] = dData.admin2[code];
                        }
                    });
                }
            });

            let html = '<div class="pa-admin-accordion">';
            Object.entries(depts).sort((a,b) => a[1].name.localeCompare(b[1].name)).forEach(([dId, dData]) => {
                html += `
                    <div class="accordion-item" style="border:1px solid rgba(255,255,255,0.05); border-radius:6px; margin-bottom:5px;">
                        <div class="accordion-header" style="background:rgba(255,255,255,0.03); padding:8px 12px; cursor:pointer; font-size:0.8rem; display:flex; justify-content:space-between;"
                             onclick="this.nextElementSibling.classList.toggle('visible'); this.querySelector('.acc-arrow').style.transform = this.nextElementSibling.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)'">
                            <span>${dData.name}</span>
                            <span class="acc-arrow" style="transition:0.2s">▶</span>
                        </div>
                        <div class="accordion-content" style="max-height:0; overflow:hidden; transition:0.3s; background:rgba(0,0,0,0.1);">
                            <div style="padding:5px 10px;">
                                ${Object.entries(dData.munis).map(([mId, mName]) => `
                                    <div class="dash-row" style="padding:5px; font-size:0.75rem;">${mName}</div>
                                `).join('')}
                            </div>
                        </div>
                    </div>`;
            });
            html += '</div>';
            return html;
        }

        function highlightEcoInPA(label) {
            if (!ecosLayer) return;
            const norm = normalizeStr(label);
            ecosLayer.eachLayer(l => {
                const p = l.feature.properties;
                const match = normalizeStr(p.NOMBRE || p.LEYENDA) === norm;
                l.setStyle({
                    fillOpacity: match ? 0.9 : 0.1,
                    weight: match ? 3 : 1,
                    color: match ? '#ffffff' : getFeatureColor(p)
                });
            });
        }

        async function highlightPACategory(iso, categoryName) {
            showLoader(true);
            try {
                const isoKey = iso.toUpperCase();
                if (!fullData.areasPartitioned[isoKey]) {
                    const res = await fetch(`../web_data/pa_split/pa_${isoKey}.json`);
                    if (res.ok) fullData.areasPartitioned[isoKey] = await res.json();
                }
                
                const paDoc = fullData.areasPartitioned[isoKey];
                const features = paDoc.features.filter(f => f.properties.categoria === categoryName);
                
                if (features.length > 0) {
                    if (highlightLayer) map.removeLayer(highlightLayer);
                    highlightLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
                        pane: 'selectionPane',
                        style: { color: '#ffffff', weight: 4, fillOpacity: 0.1, fillColor: '#ffffff' }
                    }).addTo(map);
                    
                    map.fitBounds(highlightLayer.getBounds(), { padding: [50, 50] });
                }
            } finally { showLoader(false); }
        }

        function resetPASelection() {
            document.getElementById('pa-name').value = '';
            document.getElementById('detail-panel').classList.remove('visible');
            if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
            if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
            updatePAView();
        }

        function resetEcosSelection() {
            if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
            if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
            if (ecosLayer) ecosLayer.resetStyle();
        }

        function closeDetail() {
            document.getElementById('detail-panel').classList.remove('visible');
            if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
            if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
        }

        function setEcosLayerPriority(priority) {
            const ecoPane = map.getPane('ecosystemPane');
            const adminPane = map.getPane('adminBoundaryPane');
            const paPane = map.getPane('paBoundaryPane');
            
            if (priority === 'ecos') {
                ecoPane.style.zIndex = 500;
                adminPane.style.zIndex = 400;
                paPane.style.zIndex = 400;
            } else {
                ecoPane.style.zIndex = 400;
                adminPane.style.zIndex = 500;
                paPane.style.zIndex = 500;
            }
        }

        function buildAdminAccordion(iso, deptIds = null, muniIds = null, stats = null) {
            const hierarchy = adminHierarchy[iso];
            if (!hierarchy || !hierarchy.admin1) return '<div style="padding:15px; text-align:center; color:var(--gray); font-size:0.8rem;">No hay datos administrativos disponibles.</div>';

            let html = '<div style="margin-top:10px;">';
            Object.entries(hierarchy.admin1).forEach(([deptId, deptData]) => {
                const munis = deptData.admin2 || {};
                const muniCount = Object.keys(munis).length;
                
                if (deptIds && !deptIds.includes(deptId)) return;

                let deptStatsLabel = '';
                if (stats && stats.deptMap) {
                    const ha = stats.deptMap[deptData.name] || 0;
                    if (ha > 0) {
                        const pct = ((ha / stats.totalHa) * 100).toFixed(1);
                        deptStatsLabel = `<span style="color:var(--gray); font-weight:normal; font-size:0.75rem; margin-left:8px;">(${ha.toLocaleString(undefined, {maximumFractionDigits:0})} Ha - ${pct}%)</span>`;
                    }
                }

                html += `
                    <div class="accordion-item" style="border:1px solid var(--border); border-radius:8px; margin-bottom:6px; overflow:hidden;">
                        <div class="accordion-header" style="background:rgba(255,255,255,0.04); display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.85rem; font-weight:600; cursor:pointer; flex-grow:1;" onclick="highlightAdminUnit('${iso}', 1, '${deptId}')">
                                ${deptData.name} ${deptStatsLabel}
                            </span>
                            <span style="display:flex; gap:8px; align-items:center;">
                                <span style="font-size:0.75rem; color:var(--gray);">${muniCount} munis</span>
                                <span class="acc-arrow" style="color:var(--primary); transition:transform 0.2s; cursor:pointer;" 
                                      onclick="const content=this.closest('.accordion-header').nextElementSibling; content.classList.toggle('visible'); this.style.transform = content.classList.contains('visible') ? 'rotate(90deg)' : 'rotate(0deg)'">▶</span>
                            </span>
                        </div>
                        <div class="accordion-content dash-content" style="padding:0; max-height:0; overflow:hidden; transition: max-height 0.3s ease-out; background:rgba(0,0,0,0.15);">
                            <div style="padding:8px;">
                                ${Object.entries(munis).map(([muniId, muniName]) => {
                                    if (muniIds && !muniIds.includes(muniId)) return '';
                                    let muniStatsLabel = '';
                                    if (stats && stats.muniList) {
                                        const mMatch = stats.muniList.find(m => m.id === muniId);
                                        if (mMatch) {
                                            const mPct = ((mMatch.ha / stats.totalHa) * 100).toFixed(1);
                                            muniStatsLabel = `<span style="color:var(--primary); opacity:0.8; font-size:0.65rem; margin-left:5px;">(${mMatch.ha.toLocaleString(undefined, {maximumFractionDigits:0})} Ha - ${mPct}%)</span>`;
                                        }
                                    }
                                    return `
                                    <div class="dash-row" style="padding:6px 8px; font-size:0.8rem; border:none; cursor:pointer; border-radius:4px; transition:background 0.2s;" 
                                         onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"
                                         onclick="highlightAdminUnit('${iso}', 2, '${muniId}')">
                                        <div class="dash-name">${muniName} ${muniStatsLabel}</div>
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

        function updateAccordionLegend(visibleOnly = true) {
            const legendBody = document.getElementById('legend-body');
            if (!legendBody) return;
            
            const bounds = map.getBounds();
            const counts = {};
            let totalFeatures = 0;
            
            const layers = ecosLayer ? ecosLayer.getLayers() : [];
            layers.forEach(layer => {
                if (visibleOnly && !bounds.intersects(layer.getBounds())) return;
                const p = layer.feature.properties;
                const label = p.NOMBRE || p.LEYENDA || 'Sin clasificar';
                counts[label] = (counts[label] || 0) + 1;
                totalFeatures++;
            });
            
            if (Object.keys(counts).length === 0) {
                legendBody.innerHTML = '<div style="padding:10px; color:var(--gray); text-align:center; font-size:0.8rem;">No hay elementos visibles en esta área</div>';
                return;
            }
            
            legendBody.innerHTML = Object.entries(counts).sort((a,b) => b[1] - a[1]).map(([label, count]) => {
                const color = getEcoColor(label);
                return `
                    <div class="legend-row" style="cursor:default;" onmouseover="highlightEcoInPA('${label.replace(/'/g, "\\'")}')" onmouseout="if(currentApp==='ecosistemas') ecosLayer.resetStyle()">
                        <div class="legend-color" style="background:${color};"></div>
                        <div class="legend-label" style="font-size:0.75rem;">${label}</div>
                    </div>`;
            }).join('');
        }

        function resetEcosViewer() {
            document.getElementById('ecos-country').value = '';
            const ecoName = document.getElementById('ecos-name');
            ecoName.innerHTML = '<option value="">Seleccione Ecosistema</option>';
            ecoName.disabled = true;
            
            resetMapAndDashboard();
            map.setView([15, -86], 6);
            updateEcosView();
        }

        document.getElementById('country-filter').addEventListener('change', () => applyFilters(true));
        initMap();
    