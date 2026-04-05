import math
import os
import json
import uvicorn
import geopandas as gpd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from shapely.geometry import box

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Relative Paths for Cloud Deployment
BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "web_data")
REGIONAL_FILE = os.path.join(DATA_DIR, "sica_ecosistemas_2002_dissolved.json")

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
            # Build spatial index
            _ = gdf_regional.sindex
            print(f"OK: {len(gdf_regional)} ecosistemas cargados con exito.")
        except Exception as e:
            print(f"ERROR al cargar datos: {e}")
    else:
        print(f"ADVERTENCIA: No se encontro {REGIONAL_FILE}. El endpoint de teselas estara inactivo.")

def tile_to_bbox(z, x, y):
    n = 2.0 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max

@app.get("/v1/tiles/{z}/{x}/{y}")
async def get_tile(z: int, x: int, y: int):
    if gdf_regional is None:
        raise HTTPException(status_code=500, detail="Datos no cargados")
    
    west, south, east, north = tile_to_bbox(z, x, y)
    tile_geom = box(west, south, east, north)
    
    candidate_idx = list(gdf_regional.sindex.query(tile_geom, predicate="intersects"))
    if not candidate_idx:
        return JSONResponse({"type": "FeatureCollection", "features": []})
    
    subset = gdf_regional.iloc[candidate_idx].copy()
    try:
        subset.geometry = subset.geometry.intersection(tile_geom)
        subset = subset[~subset.geometry.is_empty]
    except:
        subset = gdf_regional.iloc[candidate_idx].copy()
    
    if subset.empty:
        return JSONResponse({"type": "FeatureCollection", "features": []})
    
    features = []
    for _, row in subset.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty: continue
        feat = {
            "type": "Feature",
            "geometry": geom.__geo_interface__,
            "properties": { "LEYENDA": str(row.get("LEYENDA", "")) }
        }
        features.append(feat)
    
    return JSONResponse({ "type": "FeatureCollection", "features": features })

@app.get("/v1/health")
async def health():
    return {"status": "ok", "data_loaded": gdf_regional is not None}

# Serve static files from relative paths
app.mount("/viewer", StaticFiles(directory=os.path.join(BASE, "viewer"), html=True), name="viewer")
app.mount("/web_data", StaticFiles(directory=DATA_DIR), name="web_data")

from fastapi.responses import RedirectResponse

@app.get("/")
async def root():
    return RedirectResponse(url="/viewer/")

if __name__ == "__main__":
    # In cloud, uvicorn usually listens on 0.0.0.0
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
