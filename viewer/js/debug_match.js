const fs = require('fs');
const stats = JSON.parse(fs.readFileSync('d:/web_D_anctigravity/analisis_geoespacial/capas_SICA_finales/web_data/forest_loss_stats.json', 'utf8'));
const hnd = stats.by_country?.['HND'];

const target = "10-HCW Bosque tropical siempreverde mixto montano inferior, HCW";
const normTarget = target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');

console.log("Normalized Target:", normTarget);

if (hnd && hnd.ecosystems) {
    const keys = Object.keys(hnd.ecosystems);
    const match = keys.find(k => {
        const normK = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
        return normK === normTarget;
    });
    
    if (match) {
        console.log("COINCIDENCIA ENCONTRADA:", match);
        console.log("DATOS:", hnd.ecosystems[match]);
    } else {
        console.log("No se encontró coincidencia exacta. Sugerencias similares:");
        keys.filter(k => k.toLowerCase().includes('10-hcw') || k.toLowerCase().includes('10 hcw')).forEach(k => {
             console.log(`- "${k}" (Norm: ${k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '')})`);
        });
    }
}
