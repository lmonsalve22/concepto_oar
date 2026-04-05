// JS Module: Global Store and State Management
export const fullData = { 
    areas: {}, 
    areasPartitioned: {}, 
    ecosistemas: null, 
    ecosSplit: {}, 
    admin: { depts: {}, munis: {} }, 
    ecosGranularMapping: null, 
    paStats: null,
    forestLossData: null
};

export const state = {
    currentApp: 'admin',
    activeTab: 'info', // Global tracking of the dashboard tab
    currentLevel: 1,
    currentIso: 'ALL',
    forestLossStats: null,
    currentEcosMetadata: { depts: [], munis: [], pas: [], ecoName: '', iso: '' },
    lastEcoFeatures: null,
    lastEcoIso: '',
    lastEcoNameRaw: '',
    ecoSubTab: 'info',
    adminHierarchy: {},
    adminStats: {},
    ecosTeowStats: {},
    legendsConfig: { areas: {}, ecosistemas: {}, admin: {} },
    mapPadding: {
        paddingTopLeft: [360, 40],
        paddingBottomRight: [360, 40]
    }
};

export const mapsState = {
    activeAdminFeature: null,
    activeAdminGeom: null
};

// Colors
export const countryColors = {
    'BLZ': '#10b981', 'CRI': '#3b82f6', 'DOM': '#ef4444', 'GTM': '#f59e0b',
    'HND': '#8b5cf6', 'NIC': '#06b6d4', 'PAN': '#ec4899', 'SLV': '#84cc16'
};

export const vibrantPalette = [
    '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
    '#059669', '#2563eb', '#fbbf24', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d',
    '#34d399', '#60a5fa', '#fcd34d', '#f87171', '#a78bfa', '#22d3ee', '#f472b6', '#a3e635'
];
