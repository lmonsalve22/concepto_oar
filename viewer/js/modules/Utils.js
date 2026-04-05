import { vibrantPalette, countryColors, state } from './Store.js';
const { legendsConfig } = state;

const placeholders = ['No disponible', 'No definido', 'Not Reported', 'NULL', 'None', 'nan', 'nan ', ' ', ''];

export function isPlaceholder(val) {
    if (!val) return true;
    const s = String(val).trim();
    return placeholders.includes(s);
}

export function getStableColor(text, iso) {
    if (isPlaceholder(text)) return '#64748b';
    let hash = 0;
    const seed = text + (iso || '');
    for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    return vibrantPalette[Math.abs(hash) % vibrantPalette.length];
}

export const normalizeStr = s => {
    if (!s) return '';
    return s.toString()
        .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // ALL types of whitespace -> standard space
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove non-printable
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Distill accents
        .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
        .replace(/[íìïî]/g, 'i').replace(/[óòöô¢]/g, 'o')
        .replace(/[úùüû]/g, 'u').replace(/[ñ]/g, 'n')
        .replace(/[^\x20-\x7E]/g, '') // Remove any weird characters
        .replace(/\s+/g, ' ') // MULTIPLE SPACES -> ONE SPACE
        .trim().toLowerCase();
};

// MEMOIZACIÓN PARA OPTIMIZACIÓN: Evita recalcular miles de normalizaciones de texto pesadas
const ecoColorCache = new Map();

export function getEcoColor(label) {
    if (!label) return '#64748b';
    if (ecoColorCache.has(label)) return ecoColorCache.get(label);
    
    let search = '';
    try {
        search = label.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    } catch (e) {
        search = String(label).toLowerCase();
    }

    // Hash for internal variations
    let hash = 0;
    const str = String(label);
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    let color;
    // 1. BOSQUES: Tonalidades Verdes
    if (search.includes('bosque')) {
        const greens = ['#065f46', '#047857', '#059669', '#10b981', '#34d399', '#228b22', '#006400', '#2d6a4f'];
        color = greens[Math.abs(hash) % greens.length];
    }
    // 2. SISTEMA AGROPECUARIO / ANTROPOGÉNICO: Amarillo
    else if (search.includes('agropecuario') || search.includes('agricultura') || search.includes('pasto') || search.includes('cultivo') || search.includes('urbana') || search.includes('urbano') || search.includes('ciudad')) {
        color = '#ffd700';
    }
    // 3. AGUA: Azules
    else if (search.includes('agua') || search.includes('rio') || search.includes('lago') || search.includes('embalse') || search.includes('laguna')) {
        color = '#1e90ff';
    }
    // 4. OTROS: Colores vibrantes (evitando verdes puros)
    else {
        const VIBRANT_OTHERS = ['#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f43f5e', '#a855f7', '#7c3aed'];
        color = VIBRANT_OTHERS[Math.abs(hash) % VIBRANT_OTHERS.length];
    }
    
    ecoColorCache.set(label, color);
    return color;
}

export function getFeatureColor(props) {
    if (props.LEYENDA) return getEcoColor(props.LEYENDA);
    if (props.categoria) {
        if (state.currentLevel === 1 || !props.zona) return getStableColor(props.categoria, props.iso3);
        if (state.currentLevel === 2 || !props.sub_zona) return getStableColor(props.zona, props.iso3);
        const sub = isPlaceholder(props.sub_zona) ? props.zona : props.sub_zona;
        return getStableColor(sub, props.iso3);
    }
    return countryColors[props.iso3] || '#3388ff';
}

export function showLoader(visible) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = visible ? 'flex' : 'none';
}

export function cleanEncoding(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/¢/g, 'ó')
              .replace(/¡/g, 'í')
              .replace(/¤/g, 'ñ')
              .replace(/£/g, 'ú')
              .replace(/§/g, 'á')
              .replace(/ /g, ' ') // Espacio insecable
              .replace(/¨/g, 'í')
              .replace(/´/g, 'ó')
              .replace(/Ã³/g, 'ó')
              .replace(/Ã¡/g, 'á')
              .replace(/Ã©/g, 'é')
              .replace(/Ã­/g, 'í')
              .replace(/Ãº/g, 'ú')
              .replace(/Ã±/g, 'ñ')
              .replace(/Ã/g, 'í')
              .replace(/Â/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/Lim1n/g, 'Limón')
              .replace(/San Jos0/g, 'San José')
              .replace(/Jinoteg/g, 'Jinotega')
              .replace(/Totonicapn/g, 'Totonicapán')
              .replace(/Coln/g, 'Colón');
}

const fieldLabels = {
    'pais_cod3': 'Código País',
    'pais_es': 'Nombre País',
    'admin1name': 'Nombre',
    'admin1_nom': 'Nombre',
    'admin1_id': 'Código ID',
    'adm1tipo': 'Nivel Administrativo',
    'admin2name': 'Nombre',
    'admin2_nom': 'Nombre',
    'idregmunic': 'ID Municipal',
    'nombre': 'Nombre',
    'area_km2': 'Superficie (km²)',
    'area_ha': 'Superficie (ha)',
    'nombre_pa': 'Área Protegida',
    'categoria': 'Categoría',
    'cat_sica': 'Categoría SICA',
    'leyenda': 'Ecosistema'
};

export function createPopupTable(props, admin1Type = 'Nivel 1', admin2Type = 'Nivel 2') {
    const kprops = Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
    
    // Explicit nomenclature fix for Costa Rica
    if ((kprops.pais_cod3 === 'CRI' || props.pais_cod3 === 'CRI') && admin2Type === 'Municipio') {
        admin2Type = 'Cantón';
    }
    // Defined order as requested
    const orderedFields = [
        { key: 'pais_cod3', label: 'Código País' },
        { key: 'pais_es', label: 'Nombre País' },
        { key: 'admin1_id', label: `Código ${admin1Type}` },
        { key: ['admin1name', 'admin1_nom'], label: admin1Type },
        { key: ['idregmunic', 'admin2_id'], label: `Código ${admin2Type}` },
        { key: ['admin2name', 'admin2_nom'], label: admin2Type }
    ];

    let html = '<div class="popup-table-container" style="max-height:250px; overflow-y:auto; min-width:240px; margin-top:8px; border-top:1px solid var(--border);">';
    html += '<table style="width:100%; border-collapse:collapse; font-size:0.75rem; color: #fff; line-height:1.4;">';
    
    const shown = new Set();

    orderedFields.forEach(conf => {
        let val = null;
        let finalKey = '';
        if (Array.isArray(conf.key)) {
            for (const k of conf.key) {
                if (kprops[k] !== undefined) {
                    val = kprops[k];
                    finalKey = k;
                    break;
                }
            }
        } else {
            if (kprops[conf.key] !== undefined) {
                val = kprops[conf.key];
                finalKey = conf.key;
            }
        }

        if (val !== null && !isPlaceholder(val)) {
            html += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                    <td style="padding:6px 0; font-weight:600; color:var(--gray); vertical-align:top; width:45%;">${conf.label}</td>
                    <td style="padding:6px 0 6px 12px; text-align:right; word-break:break-word; color: #fff;">${cleanEncoding(val)}</td>
                </tr>`;
            shown.add(finalKey);
        }
    });

    // Add remaining props
    for (const [key, val] of Object.entries(props)) {
        const k = key.toLowerCase();
        if (shown.has(k)) continue;
        if (k.includes('shape') || k === 'objectid' || k === 'fid' || k.includes('length') || k.includes('count') || isPlaceholder(val)) continue;
        
        const label = fieldLabels[k] || key;
        html += `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                <td style="padding:6px 0; font-weight:600; color:var(--gray); vertical-align:top;">${label}</td>
                <td style="padding:6px 0 6px 12px; text-align:right; word-break:break-word; color: #fff;">${cleanEncoding(val)}</td>
            </tr>`;
    }

    html += '</table></div>';
    return html;
}

/**
 * Genera la estructura HTML estandarizada para pop-ups premium (Glassmorphism)
 * @param {Object} options - { title, subtitle, badge, badgeColor, themeColor, bodyHTML }
 */
export function createPremiumPopupHTML({ title, subtitle, badge, badgeColor, themeColor = '#10b981', bodyHTML }) {
    return `
        <div class="premium-popup-content" style="font-family:'Inter', sans-serif;">
            <!-- Barra de Color Temática -->
            <div style="background:${themeColor}; height:4px; width:100%;"></div>
            
            <div class="popup-premium-header">
                <div style="display:flex; justify-content:${subtitle ? 'space-between' : 'flex-start'}; align-items:flex-start; gap:10px;">
                    <p class="popup-premium-subtitle">${subtitle || ''}</p>
                    ${badge ? `<span style="background:${badgeColor || '#3b82f6'}; color:#fff; font-size:0.55rem; padding:2px 6px; border-radius:4px; font-weight:800; text-transform:uppercase;">${badge}</span>` : ''}
                </div>
                <h3 class="popup-premium-title">${cleanEncoding(title)}</h3>
            </div>
            
            <div class="popup-premium-divider"></div>
            
            <div class="popup-premium-body">
                ${bodyHTML || ''}
            </div>
        </div>
    `;
}

/**
 * Global number formatting for the entire dashboard.
 * Uses "," for thousands and "." for decimals (en-US locale).
 */
export function formatNumber(num, decimals = 0) {
    if (num === null || num === undefined || isNaN(num)) return '---';
    return Number(num).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}



