const fs = require('fs');
const stats = JSON.parse(fs.readFileSync('d:/web_D_anctigravity/analisis_geoespacial/capas_SICA_finales/web_data/forest_loss_stats.json', 'utf8'));

console.log("Keys in by_country:", Object.keys(stats.by_country || {}));
const hnd = stats.by_country?.['HND'] || stats.by_country?.['hnd'];
console.log("HND found:", !!hnd);
if (hnd) {
    console.log("Ecosystems in HND (sample):", Object.keys(hnd.ecosystems || {}).slice(0, 5));
    const target = Object.keys(hnd.ecosystems || {}).find(k => k.toLowerCase().includes('10-hcw') || k.toLowerCase().includes('10 hcw'));
    console.log("Target '10-HCW' found:", target);
} else {
    // If not HND, maybe it's using full names?
    console.log("Sample keys in by_country:", Object.keys(stats.by_country || {}).slice(0, 5));
}
