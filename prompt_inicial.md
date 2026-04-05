# Prompt: Geovisor de Ecosistemas — Servidor de Teselas Vectoriales

Eres un desarrollador full-stack con experiencia en geomática, sistemas de
información geográfica (SIG) y despliegue en la nube. Debes diseñar e
implementar una aplicación web completa, robusta y lista para producción
que sirva como visor cartográfico de ecosistemas regionales.

La aplicación consiste en:
- Un **servidor de teselas vectoriales dinámicas** en Python (FastAPI) que
  lee datos geoespaciales y los entrega por demanda en formato GeoJSON
  recortado por tesela (tile slippy map).
- Un **visor web** estático (HTML + JavaScript puro, sin frameworks)
  que consume esas teselas y las renderiza en un mapa interactivo.
- Despliegue como **servicio único en Railway** (o Heroku) que sirve
  tanto la API como los archivos estáticos del visor.

---

## ÍNDICE

1. [Contexto del Negocio](#contexto-del-negocio)
2. [Arquitectura General](#arquitectura-general)
3. [Estructura del Repositorio](#estructura-del-repositorio)
4. [Backend — Servidor de Teselas](#backend--servidor-de-teselas)
5. [Frontend — Visor Cartográfico](#frontend--visor-cartográfico)
6. [Datos Geoespaciales](#datos-geoespaciales)
7. [Despliegue](#despliegue)
8. [Entregables y Orden de Generación](#entregables-y-orden-de-generación)

---

## CONTEXTO DEL NEGOCIO

Un organismo regional (SICA — Sistema de la Integración Centroamericana)
necesita un visor web para mostrar públicamente la cobertura de ecosistemas
de Centroamérica. Los datos originales son polígonos georreferenciados en
formato GeoJSON (proyección EPSG:4326) derivados de cartografía de
ecosistemas del año 2002, con atributos de leyenda por tipo de ecosistema.

El volumen de datos es grande (miles de polígonos complejos), por lo que
no es viable cargar el GeoJSON completo en el frontend. La solución es un
**servidor de teselas dinámico**: el servidor divide el mapa en teselas
según el esquema estándar de slippy map (z/x/y), y por cada solicitud
devuelve únicamente los features que intersectan esa tesela, recortados
a su bbox. Esto reduce drásticamente el volumen de datos transferido al
navegador y permite navegar fluidamente a cualquier nivel de zoom.

### Restricciones de diseño

- No hay base de datos. Los datos se cargan en memoria al inicio del
  servidor desde archivos `.json` o `.parquet` en disco.
- No hay autenticación. El visor es público.
- El frontend es HTML/CSS/JS puro. No usar frameworks de JavaScript
  (sin React, sin Vue, sin Angular). Sí se permite usar librerías CDN
  para el mapa (Leaflet.js o MapLibre GL JS).
- El código debe ser simple, portable y fácil de mantener por un equipo
  de geógrafos sin experiencia avanzada en desarrollo web.

---

## ARQUITECTURA GENERAL

```
[Navegador]
    │
    ├── GET /viewer/                   → index.html (visor estático)
    ├── GET /web_data/...              → archivos de datos estáticos (GeoJSON de apoyo)
    └── GET /v1/tiles/{z}/{x}/{y}     → API de teselas (FastAPI)
                                              │
                                         [GeoDataFrame en RAM]
                                         [Spatial Index (sindex)]
                                              │
                                         [Intersección + Clip]
                                              │
                                         [GeoJSON recortado]
```

### Flujo de datos en la carga de una tesela

1. El visor (Leaflet/MapLibre) calcula la tesela necesaria según la vista
   actual (zoom + posición del mapa).
2. Solicita `GET /v1/tiles/{z}/{x}/{y}`.
3. El backend convierte (z, x, y) a coordenadas geográficas (bbox lon/lat)
   usando la fórmula estándar del Web Mercator slippy map.
4. Consulta el índice espacial (`sindex`) del GeoDataFrame para obtener
   candidatos que puedan intersectar el bbox.
5. Para los candidatos, calcula la intersección real geometry-bbox.
6. Filtra geometrías vacías o nulas resultantes del clip.
7. Construye un FeatureCollection GeoJSON con las geometrías recortadas y
   los atributos relevantes (mínimo: `LEYENDA`).
8. Responde con `JSONResponse` (content-type: application/json).

### Comportamiento en caso de tesela vacía

- Si no hay features en esa tesela, responder igualmente con HTTP 200 y
  body `{"type": "FeatureCollection", "features": []}`.
- **No** responder 404 en teselas vacías; el cliente de mapas lo
  interpretaría como error.

---

## ESTRUCTURA DEL REPOSITORIO

```
concepto_oar/
├── vgtiler.py              ← Aplicación FastAPI principal (ÚNICO archivo Python)
├── requirements.txt        ← Dependencias Python
├── Procfile                ← Comando de inicio para Railway/Heroku
├── .gitignore
├── README.md
├── viewer/                 ← Frontend estático (servido en /viewer/)
│   ├── index.html          ← Página principal del visor
│   ├── style.css           ← Estilos del visor
│   └── app.js              ← Lógica del mapa (Leaflet/MapLibre)
└── web_data/               ← Archivos de datos geoespaciales
    └── sica_ecosistemas_2002_dissolved.json   ← GeoJSON principal
```

**Regla crítica:** El backend es un único archivo `vgtiler.py` en la
raíz del repositorio. No hay carpetas `src/`, `app/`, ni módulos
separados. Esto simplifica el despliegue y mantenimiento.

---

## BACKEND — SERVIDOR DE TESELAS

### vgtiler.py — Especificación completa

#### Dependencias (requirements.txt)

```
fastapi
uvicorn
geopandas
shapely
pyarrow
```

**Nota:** `pyarrow` se incluye para optimizar operaciones de GeoPandas con
datasets grandes. No es estrictamente necesario para la funcionalidad core,
pero mejora el rendimiento en memoria.

#### Inicialización de la aplicación

```python
import math, os, json
import uvicorn
import geopandas as gpd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from shapely.geometry import box

app = FastAPI()
```

#### Configuración de CORS

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

CORS completamente abierto (`*`) porque el visor es público y puede ser
embebido en otros portales institucionales.

#### Rutas de archivos — Paths relativos obligatorios

**REGLA CRÍTICA:** Todos los paths deben ser **relativos al directorio del
archivo** `vgtiler.py`, no al directorio de trabajo (`cwd`). Esto garantiza
que la aplicación funcione correctamente tanto en desarrollo local como en
Railway (donde el `cwd` puede variar).

```python
BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "web_data")
REGIONAL_FILE = os.path.join(DATA_DIR, "sica_ecosistemas_2002_dissolved.json")
```

#### Carga de datos en startup

- Los datos se cargan **una sola vez** al iniciar el servidor con el
  evento `@app.on_event("startup")`.
- Se almacenan en una variable global `gdf_regional` de tipo
  `geopandas.GeoDataFrame`.
- Al cargar, si el CRS no es EPSG:4326, se reprojecta automáticamente.
- Se construye el índice espacial (`gdf_regional.sindex`) inmediatamente
  después de la carga para que todas las consultas posteriores sean O(log n).
- **Si el archivo no existe:** No lanzar excepción. Mostrar advertencia en
  consola y dejar `gdf_regional = None`. El endpoint de teselas responderá
  con HTTP 500 indicando que los datos no están disponibles.

```python
gdf_regional = None

@app.on_event("startup")
async def startup_event():
    global gdf_regional
    print(f"\n{'='*50}")
    print("SICA GEOVISOR - SERVIDOR DE TESELAS (Cloud Mode)")
    print(f"{'='*50}")
    print(f"Cargando datos regionales desde: {REGIONAL_FILE}")

    if os.path.exists(REGIONAL_FILE):
        try:
            gdf_regional = gpd.read_file(REGIONAL_FILE, encoding='utf-8')
            if gdf_regional.crs and str(gdf_regional.crs) != "EPSG:4326":
                gdf_regional = gdf_regional.to_crs("EPSG:4326")
            _ = gdf_regional.sindex  # Forzar construcción del índice
            print(f"OK: {len(gdf_regional)} ecosistemas cargados con exito.")
        except Exception as e:
            print(f"ERROR al cargar datos: {e}")
    else:
        print(f"ADVERTENCIA: No se encontro {REGIONAL_FILE}.")
        print("El endpoint de teselas estara inactivo.")
```

#### Conversión z/x/y → bbox geográfico

Implementar la función estándar `tile_to_bbox(z, x, y)` que convierte
coordenadas de tesela del esquema slippy map a un bounding box en
longitud/latitud (EPSG:4326):

```python
def tile_to_bbox(z, x, y):
    n = 2.0 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max
```

**Por qué esta fórmula:** El esquema slippy map usa proyección Web Mercator
(EPSG:3857) para las coordenadas de tesela, pero los datos están en
EPSG:4326. La fórmula `atan(sinh(...))` convierte coordenadas Mercator
a latitud geodésica correctamente para cualquier nivel de zoom.

#### Endpoint de teselas

```
GET /v1/tiles/{z}/{x}/{y}
```

Parámetros de path: `z` (zoom, entero), `x` (columna de tesela, entero),
`y` (fila de tesela, entero).

**Algoritmo de procesamiento:**

1. Si `gdf_regional is None`, raise `HTTPException(500, "Datos no cargados")`.
2. Calcular bbox: `west, south, east, north = tile_to_bbox(z, x, y)`.
3. Crear geometría del bbox: `tile_geom = box(west, south, east, north)`.
4. Consultar índice espacial:
   `candidate_idx = list(gdf_regional.sindex.query(tile_geom, predicate="intersects"))`.
5. Si `candidate_idx` está vacío, retornar FeatureCollection vacía
   inmediatamente (evitar procesamiento innecesario).
6. Extraer subset: `subset = gdf_regional.iloc[candidate_idx].copy()`.
7. Intentar clip:

```python
try:
    subset.geometry = subset.geometry.intersection(tile_geom)
    subset = subset[~subset.geometry.is_empty]
except:
    # Fallback: si el clip falla (geometrías inválidas), usar features sin recortar
    subset = gdf_regional.iloc[candidate_idx].copy()
```

8. Si `subset` queda vacío tras el clip, retornar FeatureCollection vacía.
9. Construir lista de features:

```python
features = []
for _, row in subset.iterrows():
    geom = row.geometry
    if geom is None or geom.is_empty:
        continue
    feat = {
        "type": "Feature",
        "geometry": geom.__geo_interface__,
        "properties": {"LEYENDA": str(row.get("LEYENDA", ""))}
    }
    features.append(feat)
```

10. Retornar: `JSONResponse({"type": "FeatureCollection", "features": features})`.

**Nota sobre el atributo `LEYENDA`:** Es el único atributo que el visor
frontend necesita para colorear los polígonos. Si el dataset tiene otros
atributos relevantes (ej. `ID`, `AREA_HA`, `PAIS`), incluirlos también
en `properties` para que el visor pueda mostrarlos en tooltips.

#### Endpoint de healthcheck

```
GET /v1/health
```

No requiere autenticación. Devuelve:

```json
{"status": "ok", "data_loaded": true}
```

Si los datos no están cargados: `{"status": "ok", "data_loaded": false}`.
No devolver error 5xx en healthcheck aunque los datos no estén; Railway
usa este endpoint para saber si el proceso está vivo (no si los datos
están disponibles).

#### Montaje de archivos estáticos

```python
# Servir el visor frontend en /viewer/
app.mount(
    "/viewer",
    StaticFiles(directory=os.path.join(BASE, "viewer"), html=True),
    name="viewer"
)

# Servir los datos estáticos en /web_data/
app.mount(
    "/web_data",
    StaticFiles(directory=DATA_DIR),
    name="web_data"
)
```

**Importante:** `html=True` en el StaticFiles del viewer hace que
`/viewer/` sirva automáticamente `index.html`.

#### Redirect raíz

```python
from fastapi.responses import RedirectResponse

@app.get("/")
async def root():
    return RedirectResponse(url="/viewer/")
```

Cualquier visita a la raíz (`/`) redirige al visor.

#### Punto de entrada para desarrollo local

```python
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

---

## FRONTEND — VISOR CARTOGRÁFICO

### Stack técnico

| Componente | Tecnología |
|---|---|
| Estructura | HTML5 semántico |
| Estilos | CSS3 puro (sin frameworks) |
| Mapa | **Leaflet.js** vía CDN (versión 1.9.x) |
| Lógica | JavaScript ES2020 puro (sin bundler) |
| Fuente de teselas | API local `/v1/tiles/{z}/{x}/{y}` |
| Mapa base | CartoDB Positron (fondo neutro gris claro) |

**Por qué Leaflet y no MapLibre:** Leaflet soporta nativamente fuentes de
teselas que devuelven GeoJSON por URL template, con implementación custom
de `L.GridLayer`. Es más liviano (~140KB) y tiene mayor compatibilidad
con navegadores de entornos institucionales.

### viewer/index.html

Estructura completa del HTML:

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SICA — Ecosistemas de Centroamérica 2002</title>

    <!-- Leaflet CSS -->
    <link rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

    <!-- Estilos propios -->
    <link rel="stylesheet" href="style.css" />
</head>
<body>

    <!-- Panel de control / leyenda -->
    <div id="panel">
        <div id="panel-header">
            <h1>Ecosistemas SICA 2002</h1>
            <p>Cobertura regional de ecosistemas — Centroamérica</p>
        </div>
        <div id="legend-container">
            <h3>Leyenda</h3>
            <div id="legend-items">
                <!-- Generada dinámicamente por app.js -->
            </div>
        </div>
        <div id="info-box">
            <p id="info-text">Pase el cursor sobre un ecosistema</p>
        </div>
    </div>

    <!-- Contenedor del mapa -->
    <div id="map"></div>

    <!-- Leaflet JS -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <!-- Lógica de la aplicación -->
    <script src="app.js"></script>
</body>
</html>
```

### viewer/style.css

**Reglas de diseño:**

- Layout: mapa ocupa `100vw × 100vh` (pantalla completa).
- Panel de control: posición `absolute`, top-left, fondo blanco con
  opacidad 90%, bordes redondeados, sombra sutil, ancho fijo 280px,
  max-height 80vh con scroll interno.
- Paleta institucional: verde SICA (`#2E7D32`) como acento principal,
  grises neutros para textos y fondos.
- La leyenda es un listado de items con un cuadrado de color y etiqueta
  de texto. Los colores se asignan dinámicamente.
- Responsive: en pantallas < 768px, el panel colapsa a un botón flotante
  con icono de información que al presionar despliega la leyenda sobre
  el mapa.
- Tipografía: `system-ui, -apple-system, sans-serif` (sin Google Fonts
  para evitar dependencias externas).
- Cursores: `cursor: pointer` en polígonos interactivos.

**Especificación de colores de ecosistemas:** El color de cada tipo de
ecosistema se genera como un hash determinístico del string `LEYENDA`
para que siempre sea consistente entre sesiones. Implementar una función
`stringToColor(str)` en `app.js` que convierta el string a un color HSL.
El color debe tener buena legibilidad (saturación entre 40–80%,
luminosidad entre 35–65%).

### viewer/app.js

#### Configuración inicial del mapa

```javascript
const TILE_URL = '/v1/tiles/{z}/{x}/{y}';
const ZOOM_MIN = 5;
const ZOOM_MAX = 14;
const CENTER_LATLON = [10.5, -84.0]; // Centro de Centroamérica
const ZOOM_INICIAL = 6;
```

#### Inicialización de Leaflet

```javascript
const map = L.map('map', {
    center: CENTER_LATLON,
    zoom: ZOOM_INICIAL,
    minZoom: ZOOM_MIN,
    maxZoom: ZOOM_MAX,
    zoomControl: true
});
```

**Mapa base:** Usar CartoDB Positron para que los ecosistemas coloridos
resalten visualmente:

```javascript
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);
```

#### Sistema de carga de teselas GeoJSON dinámico

Leaflet no soporta nativo tiles GeoJSON por URL template. Implementar
una clase `GeoJSONTileLayer` que extiende `L.GridLayer`:

```javascript
const GeoJSONTileLayer = L.GridLayer.extend({
    createTile(coords, done) {
        const tile = document.createElement('div');
        const url = TILE_URL
            .replace('{z}', coords.z)
            .replace('{x}', coords.x)
            .replace('{y}', coords.y);

        fetch(url)
            .then(r => r.json())
            .then(geojson => {
                if (geojson.features && geojson.features.length > 0) {
                    // Crear capa GeoJSON y agregarla al mapa
                    // Guardar referencia para poder removerla al destruir el tile
                }
                done(null, tile);
            })
            .catch(err => done(err));

        return tile;
    }
});
```

**Importante:** Las capas GeoJSON creadas por cada tile deben eliminarse
del mapa cuando el tile se descarga (evento `tileunload`), para evitar
acumulación de capas y degradación del rendimiento en navegación extendida.

#### Colorización de polígonos

```javascript
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 50%)`;
}

function getStyle(feature) {
    const leyenda = feature.properties?.LEYENDA || 'Sin clasificar';
    return {
        fillColor: stringToColor(leyenda),
        fillOpacity: 0.65,
        color: '#333',
        weight: 0.5,
        opacity: 0.8
    };
}
```

#### Interactividad de features

Para cada feature cargado, agregar event listeners:

- **`mouseover`:** Resaltar polígono (aumentar `weight` a 2, opacidad 0.85),
  mostrar el valor de `LEYENDA` en el `#info-box` del panel.
- **`mouseout`:** Restaurar estilo original, limpiar el `#info-box`.
- **`click`:** En móvil (sin hover), click muestra la información del
  ecosistema en el info-box y hace zoom al feature si es pequeño.

#### Construcción dinámica de la leyenda

La leyenda se construye acumulando los valores únicos de `LEYENDA`
encontrados en los features cargados. Se actualiza al cargar cada tile.

```javascript
const leyendaItems = new Set();

function actualizarLeyenda(features) {
    features.forEach(f => {
        const leyenda = f.properties?.LEYENDA;
        if (leyenda && !leyendaItems.has(leyenda)) {
            leyendaItems.add(leyenda);
            agregarItemLeyenda(leyenda);
        }
    });
}

function agregarItemLeyenda(leyenda) {
    const container = document.getElementById('legend-items');
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
        <span class="legend-color"
              style="background:${stringToColor(leyenda)}"></span>
        <span class="legend-label">${leyenda}</span>
    `;
    container.appendChild(item);
}
```

#### Manejo de errores de red

Si una solicitud de tile falla (error de red o 5xx), no mostrar error
al usuario. Simplemente no renderizar esa tesela y registrar en consola:

```javascript
.catch(err => {
    console.warn(`Error al cargar tile ${z}/${x}/${y}:`, err.message);
    done(null, tile); // Tile vacío, sin error visible
});
```

#### Indicador de carga

Mostrar un spinner sutil en la esquina superior derecha del mapa mientras
hay tiles en proceso de carga. Ocultar cuando todos los tiles del viewport
actual estén cargados. Implementar con contador de requests pendientes.

---

## DATOS GEOESPACIALES

### web_data/sica_ecosistemas_2002_dissolved.json

Este archivo NO se genera en el código; es un dato de entrada que debe
existir en el repositorio o ser provisto por el usuario. Sin embargo,
el sistema debe funcionar sin él (mostrando advertencia en consola y
endpoint de teselas retornando HTTP 500).

**Formato esperado:** GeoJSON estándar (RFC 7946) con:

- `type: "FeatureCollection"`
- Features de tipo `Polygon` o `MultiPolygon`
- CRS: preferentemente EPSG:4326. Si es otro, el backend lo reprojecta.
- Atributo obligatorio: `LEYENDA` (string con la clasificación del ecosistema)
- Atributos opcionales recomendados: `AREA_HA` (área en hectáreas),
  `PAIS` (país o países que cubre el polígono), `ID` (identificador único)

**Preparación de datos (instrucciones para el operador):**

1. Si el GeoJSON original tiene CRS != EPSG:4326, convertir con QGIS o
   GeoPandas antes de colocar en `web_data/`.
2. Si los polígonos son muy detallados (> 1M vértices), considerar
   simplificarlos con tolerancia 0.001 grados para mejorar performance.
3. El archivo puede ser grande (> 50 MB). Git LFS es recomendable para
   archivos > 100 MB. Documentar esto en el README.

### Datos de apoyo adicionales (opcionales)

La carpeta `web_data/` puede contener archivos adicionales que el visor
puede cargar como capas de referencia:

- `paises_centroamerica.json` — Límites políticos de los países SICA
  (Belice, Guatemala, Honduras, El Salvador, Nicaragua, Costa Rica, Panamá)
- `cuencas_hidrograficas.json` — Red hidrográfica principal

El visor puede incluir controles de visibilidad para estas capas opcionales.

---

## DESPLIEGUE

### Procfile (Railway / Heroku)

```
web: uvicorn vgtiler:app --host 0.0.0.0 --port $PORT
```

- `$PORT` es inyectado automáticamente por Railway/Heroku.
- No hardcodear el puerto. El fallback en `vgtiler.py` es 8000 para
  desarrollo local.

### Variables de entorno

No se requieren variables de entorno para el funcionamiento básico.
El sistema es autocontenido. Variables opcionales:

```env
# Puerto (Railway/Heroku lo inyectan automáticamente)
# PORT=8000

# Ruta personalizada al archivo de datos (si no está en ./web_data/)
# DATA_FILE=/ruta/personalizada/ecosistemas.json
```

### .gitignore

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
dist/
build/
.env
venv/
.venv/

# Datos grandes (usar Git LFS para archivos GeoJSON > 100MB)
# web_data/*.parquet

# OS
.DS_Store
Thumbs.db
```

### Optimización de rendimiento en Railway

**Tiempo de startup:** GeoPandas con datasets grandes puede tardar 5–30
segundos en cargar. Railway tiene un timeout de healthcheck de 30s por
defecto. Si el dataset es muy grande, considerar:

1. Pre-convertir el GeoJSON a formato Parquet con GeoPandas para carga
   más rápida (10x más rápido que JSON para datasets grandes).
2. Aumentar el healthcheck timeout en la configuración de Railway si
   es necesario.

**Uso de memoria:** Un GeoJSON de 50MB puede ocupar 200–500MB en RAM
cuando está cargado como GeoDataFrame. Verificar que el plan de Railway
tenga suficiente memoria (mínimo 512MB recomendado, 1GB para datasets grandes).

---

## ENTREGABLES Y ORDEN DE GENERACIÓN

Genera el proyecto completo con código **implementado y funcional**.
Cada archivo debe tener su implementación real y completa, sin `TODO`
pendientes ni funciones vacías.

Genera **un archivo a la vez**, mostrando la ruta completa como
encabezado antes del contenido:

### Fase 1 — Configuración y backend

1. `requirements.txt`
2. `Procfile`
3. `.gitignore`
4. `vgtiler.py` ← El archivo más importante. Implementación completa.

### Fase 2 — Frontend

5. `viewer/index.html`
6. `viewer/style.css`
7. `viewer/app.js` ← Implementación completa con GeoJSONTileLayer,
   colorización, leyenda dinámica, interactividad e indicador de carga.

### Fase 3 — Documentación

8. `README.md`

### README.md debe incluir

1. **Descripción** del proyecto y su propósito.
2. **Demo live** (URL de Railway si está desplegado).
3. **Requisitos** para desarrollo local: Python 3.11+.
4. **Instalación local:**
   ```bash
   pip install -r requirements.txt
   python vgtiler.py
   # Abrir http://localhost:8000
   ```
5. **Preparación de datos:** Cómo agregar o reemplazar el GeoJSON
   de ecosistemas. Formato esperado, atributos requeridos, instrucciones
   de conversión de CRS con GeoPandas/QGIS.
6. **Despliegue en Railway:**
   - Crear nuevo servicio desde repositorio Git.
   - Railway detecta automáticamente el `Procfile`.
   - No se requieren variables de entorno.
   - Opcional: agregar volumen si los datos no están en el repo.
7. **Arquitectura técnica:** Por qué teselas dinámicas en lugar de
   GeoJSON completo. Beneficios para datasets grandes.
8. **Personalización:** Cómo agregar nuevas capas de datos, cambiar
   el mapa base, modificar la paleta de colores.
9. **Estructura del repositorio** (árbol de carpetas con descripción
   de cada archivo).

---

## CHECKLIST DE VALIDACIÓN

Antes de entregar el código, verificar:

- [ ] `vgtiler.py` usa paths relativos (`os.path.dirname(__file__)`)
      y no paths absolutos ni `os.getcwd()`.
- [ ] El endpoint `/v1/tiles/{z}/{x}/{y}` responde HTTP 200 con
      FeatureCollection vacía cuando no hay features (no 404).
- [ ] El endpoint `/v1/health` siempre responde HTTP 200 (nunca 5xx).
- [ ] El redirect `/` → `/viewer/` funciona.
- [ ] `viewer/app.js` elimina las capas GeoJSON cuando los tiles se
      desmontan (sin memory leaks).
- [ ] La leyenda se construye dinámicamente a partir de los datos reales,
      no está hardcodeada.
- [ ] El visor es usable en móvil (responsive, touch events en mapa).
- [ ] CORS está configurado con `allow_origins=["*"]` para permitir
      embeber el visor en otros portales.
- [ ] El README incluye instrucciones de cómo reemplazar el dataset
      de ecosistemas con datos propios.