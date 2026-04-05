import { state, fullData } from './Store.js';
import { showLoader } from './Utils.js';

class CoreMapManager {
    constructor() {
        this.map = null;
        this.geojsonLayer = null;
        this.boundaryLayer = null;
        this.ecosLayer = null;
        this.pasLayer = null;
        this.highlightLayer = null;
        this.maskLayer = null;
        this.vectorTileLayer = null;
        this.admin1Layer = null;
        this.paLayer = null;
        this.paLegend = null;
        this.teowLayer = null;
        
        // Chart instances
        this.ecoChartInstance = null;
        this.paCategoryChart = null;
        this.paTopChart = null;
        this.paDeptChartInstance = null;
        this.paMuniChartInstance = null;
        this.lossTrendChart = null;
        this.lossEcoChart = null;
        this.heatLayer = null;
    }

    init() {
        this.map = L.map('map', { zoomControl: false, attributionControl: false }).setView([15, -86], 6);
        
        this.map.createPane('maskPane');
        this.map.getPane('maskPane').style.zIndex = 600;

        this.map.createPane('ecosystemPane');
        this.map.getPane('ecosystemPane').style.zIndex = 400; 
        
        this.map.createPane('adminBoundaryPane');
        this.map.getPane('adminBoundaryPane').style.zIndex = 500; 
        
        this.map.createPane('teowPane');
        this.map.getPane('teowPane').style.zIndex = 475;
        this.map.getPane('teowPane').style.pointerEvents = 'none';

        this.map.createPane('paBoundaryPane');
        this.map.getPane('paBoundaryPane').style.zIndex = 550;
        
        this.map.createPane('selectionPane');
        this.map.getPane('selectionPane').style.zIndex = 700;
        this.map.getPane('selectionPane').style.pointerEvents = 'none';

        this.map.createPane('heatmapPane');
        this.map.getPane('heatmapPane').style.zIndex = 800;
        this.map.getPane('heatmapPane').style.pointerEvents = 'none';

        // ELEVAR PANELES DE INFORMACIÓN SOBRE EL HEATMAP (Z-Index > 800)
        this.map.getPane('popupPane').style.zIndex = 1000;
        this.map.getPane('tooltipPane').style.zIndex = 1010;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(this.map);

        // Option 4: Stable Layer Group for Protected Areas
        this.paGroup = L.layerGroup({ pane: 'paBoundaryPane' }).addTo(this.map);
    }

    setLayerPriority(priorityApp) {
        if (!this.map) return;
        const ecoPane = this.map.getPane('ecosystemPane');
        const adminPane = this.map.getPane('adminBoundaryPane');
        const paPane = this.map.getPane('paBoundaryPane');
        const maskPane = this.map.getPane('maskPane');
        const selectPane = this.map.getPane('selectionPane');
        const heatPane = this.map.getPane('heatmapPane');
        
        if (priorityApp === 'ecosistemas') {
            ecoPane.style.zIndex = 450;
            adminPane.style.zIndex = 500;
            paPane.style.zIndex = 300;
            maskPane.style.zIndex = 600;
            selectPane.style.zIndex = 700;
        } else if (priorityApp === 'areas') {
            ecoPane.style.zIndex = 300;
            adminPane.style.zIndex = 400;
            paPane.style.zIndex = 550;
            maskPane.style.zIndex = 600;
            selectPane.style.zIndex = 700; 
        } else if (priorityApp === 'test') {
            heatPane.style.zIndex = 800; // Mapa de calor sobre todo
            maskPane.style.zIndex = 600; // Máscara administrativa
            ecoPane.style.zIndex = 400;  
            adminPane.style.zIndex = 500; 
            selectPane.style.zIndex = 750; // Selección: sobre máscara pero BAJO calor
        } else if (priorityApp === 'integrated') {
            ecoPane.style.zIndex = 400;
            adminPane.style.zIndex = 500; 
            paPane.style.zIndex = 550;
            maskPane.style.zIndex = 600;
            selectPane.style.zIndex = 700;
        } else {
            // Default
            heatPane.style.zIndex = 100;
            maskPane.style.zIndex = 600; 
            ecoPane.style.zIndex = 400;
            adminPane.style.zIndex = 500;
            paPane.style.zIndex = 550;
            selectPane.style.zIndex = 700;
        }
    }


    clearMap() {
        if (this.maskLayer) { this.map.removeLayer(this.maskLayer); this.maskLayer = null; }
        if (this.highlightLayer) { this.map.removeLayer(this.highlightLayer); this.highlightLayer = null; }
        if (this.boundaryLayer) { this.map.removeLayer(this.boundaryLayer); this.boundaryLayer = null; }
        if (this.ecosLayer) { this.map.removeLayer(this.ecosLayer); this.ecosLayer = null; }
        if (this.pasLayer) { this.map.removeLayer(this.pasLayer); this.pasLayer = null; }
        if (this.geojsonLayer) { this.map.removeLayer(this.geojsonLayer); this.geojsonLayer = null; }
        if (this.vectorTileLayer) { this.map.removeLayer(this.vectorTileLayer); this.vectorTileLayer = null; }
        if (this.admin1Layer) { this.map.removeLayer(this.admin1Layer); this.admin1Layer = null; }
        if (this.teowLayer) { this.map.removeLayer(this.teowLayer); this.teowLayer = null; }
        if (this.heatLayer) { this.map.removeLayer(this.heatLayer); this.heatLayer = null; }
    }

    destroyCharts() {
        if (this.ecoChartInstance) { this.ecoChartInstance.destroy(); this.ecoChartInstance = null; }
        if (this.paCategoryChart) { this.paCategoryChart.destroy(); this.paCategoryChart = null; }
        if (this.paTopChart) { this.paTopChart.destroy(); this.paTopChart = null; }
        if (this.paDeptChartInstance) { this.paDeptChartInstance.destroy(); this.paDeptChartInstance = null; }
        if (this.paMuniChartInstance) { this.paMuniChartInstance.destroy(); this.paMuniChartInstance = null; }
        if (this.lossTrendChart) { this.lossTrendChart.destroy(); this.lossTrendChart = null; }
        if (this.lossEcoChart) { this.lossEcoChart.destroy(); this.lossEcoChart = null; }
    }

    resetGlobalState() {
        this.clearMap();
        this.destroyCharts();
        document.getElementById('detail-panel').classList.remove('visible');
    }

    applyMapMask(geom) {
        if (this.maskLayer) { this.map.removeLayer(this.maskLayer); this.maskLayer = null; }
        if (!geom) return;

        const worldPoly = [
            [-90, -180], [90, -180], [90, 180], [-90, 180], [-90, -180]
        ];
        
        try {
            const countryGeom = geom.geometry || geom;
            const maskCoords = [worldPoly];
            
            if (countryGeom.type === 'Polygon' && countryGeom.coordinates[0]) {
                const ring = L.GeoJSON.coordsToLatLngs(countryGeom.coordinates[0]);
                if (ring.length) maskCoords.push(ring);
            } else if (countryGeom.type === 'MultiPolygon') {
                countryGeom.coordinates.forEach(poly => {
                    if (poly && poly[0]) {
                        const ring = L.GeoJSON.coordsToLatLngs(poly[0]);
                        if (ring.length) maskCoords.push(ring);
                    }
                });
            }
            
            if (maskCoords.length > 1) {
                // Harmonized mask for all dashboards: 0.8 opacity, dark gray
                const opac = 0.8;
                const color = '#050505';

                this.maskLayer = L.polygon(maskCoords, {
                    pane: 'maskPane',
                    color: 'transparent', fillColor: color, fillOpacity: opac, weight: 0, interactive: false
                }).addTo(this.map);
            }
        } catch(e) {
            console.error("Mask error", e);
        }
    }
}

export const coreMap = new CoreMapManager();
