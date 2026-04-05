# Resumen Ejecutivo: SICA Geovisor - Servidor de Teselas

Este proyecto es una aplicación web de sistemas de información geográfica (SIG) optimizada para la nube, diseñada para servir y visualizar datos de ecosistemas de manera eficiente.

## 🚀 Arquitectura del Sistema

El sistema utiliza una arquitectura desacoplada con un backend en Python y un frontend estático.

### 1. Backend: Servidor de Teselas GeoJSON (`vgtiler.py`)
- **Framework**: Basado en **FastAPI**, lo que garantiza un alto rendimiento y asincronía.
- **Procesamiento Espacial**: Utiliza **GeoPandas** y **Shapely** para manejar geometrías complejas de manera eficiente.
- **Funcionalidad Principal**: 
  - Actúa como un servidor de teselas dinámico mediante el endpoint `/v1/tiles/{z}/{x}/{y}`.
  - Al recibir una solicitud de teselas, el servidor calcula el área geográfica (Bounding Box), realiza una búsqueda espacial optimizada mediante índices y recorta las geometrías para que se ajusten perfectamente a la región solicitada.
  - Esto permite enviar solo los datos necesarios al navegador, mejorando drásticamente el tiempo de carga en el mapa.
- **Gestión de Datos**: Carga un dataset regional de ecosistemas (`sica_ecosistemas_2002_dissolved.json`) en memoria durante el arranque para respuestas instantáneas.

### 2. Frontend: Geovisor Interactivo (`viewer/`)
- **Interfaz**: Una aplicación web de una sola página (SPA) que consume el servicio de teselas.
- **Visualización**: Renderiza capas vectoriales en tiempo real usando un motor cartográfico (Mapbox o similar).
- **Punto de Entrada**: Ubicado en `/viewer/`, accesible automáticamente al entrar a la raíz del sitio.

### 3. Infraestructura y Despliegue
- **Preparado para la Nube**: Incluye un `Procfile` y configuración de variables de entorno para despliegue inmediato en plataformas como Railway, Heroku o Google Cloud Run.
- **Dependencias Clave**: 
  - `fastapi`, `uvicorn`: Motor del servidor web.
  - `geopandas`, `pyarrow`: Manejo eficiente de grandes volúmenes de datos geográficos.

## 🛠️ Tecnologías Utilizadas
- **Lenguaje**: Python 3.
- **Bibliotecas Espaciales**: GeoPandas, Shapely.
- **Servidor Web**: FastAPI, Uvicorn, Gunicorn (vía Procfile).

---
> [!NOTE]
> El sistema está configurado en "Cloud Mode", lo que significa que utiliza rutas relativas y configuraciones dinámicas de puerto para asegurar que funcione sin modificaciones tras el despliegue.
