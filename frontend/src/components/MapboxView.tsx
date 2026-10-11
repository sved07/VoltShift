import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPinOff } from 'lucide-react';
import type { GridZone, IndustrialWorkload } from '../types';
import { STATUS_META, carbonColor, carbonFillColorExpression, markerLabel } from '../utils/carbon';
import { buildSiteFeatureCollection, buildZoneFeatureCollection } from '../utils/geo';

export const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';
export const ZONE_SOURCE = 'grid-zones';
export const SITE_SOURCE = 'industrial-sites';
export const SITE_LAYER = 'industrial-sites-extrusion';

interface MapboxViewProps {
  zones: GridZone[];
  workloads: IndustrialWorkload[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  accessToken?: string;
}

function renderMarker(el: HTMLElement, w: IndustrialWorkload) {
  const meta = STATUS_META[w.status];
  // Toggle our classes only — Mapbox positions the element via its own `mapboxgl-marker` class.
  el.classList.add('vs-marker');
  for (const status of Object.keys(STATUS_META)) {
    el.classList.toggle(`vs-marker--${status.toLowerCase()}`, status === w.status);
  }
  el.style.setProperty('--vs-marker-color', meta.color);
  el.textContent = markerLabel(w);
  el.title = `${w.site_name} — ${meta.label}`;
  el.setAttribute('data-site-id', w.id);
}

export function MapboxView({ zones, workloads, selectedId, onSelect, accessToken }: MapboxViewProps) {
  const token = (accessToken ?? import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();
  if (!token) return <SchematicGrid zones={zones} workloads={workloads} onSelect={onSelect} />;
  return <MapCanvas token={token} zones={zones} workloads={workloads} selectedId={selectedId} onSelect={onSelect} />;
}

function MapCanvas({ token, zones, workloads, selectedId, onSelect }: Omit<MapboxViewProps, 'accessToken'> & { token: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef(new Map<string, mapboxgl.Marker>());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [loaded, setLoaded] = useState(false);

  // Mount the map exactly once; data updates go through setData below.
  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-94, 37.5],
      zoom: 3.5,
      pitch: 50,
      bearing: -12,
      antialias: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

    map.on('load', () => {
      map.addSource(ZONE_SOURCE, { type: 'geojson', data: buildZoneFeatureCollection([]) });
      map.addLayer({
        id: 'grid-zones-fill',
        type: 'fill',
        source: ZONE_SOURCE,
        paint: {
          'fill-color': carbonFillColorExpression as unknown as mapboxgl.ExpressionSpecification,
          'fill-opacity': 0.32,
        },
      });
      map.addLayer({
        id: 'grid-zones-outline',
        type: 'line',
        source: ZONE_SOURCE,
        paint: {
          'line-color': carbonFillColorExpression as unknown as mapboxgl.ExpressionSpecification,
          'line-width': 2,
          'line-blur': 1.5,
        },
      });
      map.addLayer({
        id: 'grid-zones-label',
        type: 'symbol',
        source: ZONE_SOURCE,
        layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
        paint: { 'text-color': '#e4e4e7', 'text-halo-color': '#020617', 'text-halo-width': 1.5 },
      });

      map.addSource(SITE_SOURCE, { type: 'geojson', data: buildSiteFeatureCollection([]) });
      map.addLayer({
        id: SITE_LAYER,
        type: 'fill-extrusion',
        source: SITE_SOURCE,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-emissive-strength': 0.8,
        },
      });
      map.on('click', SITE_LAYER, (e) => {
        const feature = e.features?.[0] as { properties?: Record<string, unknown> | null } | undefined;
        const id = feature?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      map.on('mouseenter', SITE_LAYER, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', SITE_LAYER, () => (map.getCanvas().style.cursor = ''));
      setLoaded(true);
    });

    const markers = markersRef.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const source = loaded ? (mapRef.current?.getSource(ZONE_SOURCE) as mapboxgl.GeoJSONSource | undefined) : undefined;
    source?.setData(buildZoneFeatureCollection(zones));
  }, [zones, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(SITE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(buildSiteFeatureCollection(workloads));

    const markers = markersRef.current;
    const live = new Set<string>();
    for (const w of workloads) {
      if (!w.coordinates) continue;
      live.add(w.id);
      let marker = markers.get(w.id);
      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.addEventListener('click', () => onSelectRef.current(w.id));
        marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, -24] }).setLngLat(w.coordinates).addTo(map);
        markers.set(w.id, marker);
      }
      renderMarker(marker.getElement(), w);
    }
    for (const [id, marker] of markers) {
      if (!live.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [workloads, loaded]);

  useEffect(() => {
    const target = workloads.find((w) => w.id === selectedId)?.coordinates;
    if (!selectedId || !target || !mapRef.current) return;
    mapRef.current.flyTo({ center: target, zoom: 9.6, pitch: 62, bearing: 20, speed: 1.4 }); // non-essential: Mapbox skips the flight under reduced motion
    // Fly only when the selection changes, not on every telemetry tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={containerRef} data-testid="mapbox-container" className="h-full w-full overflow-hidden rounded-2xl" />;
}

/** Shown when no Mapbox token is configured, so the demo still works offline. */
function SchematicGrid({ zones, workloads, onSelect }: Pick<MapboxViewProps, 'zones' | 'workloads' | 'onSelect'>) {
  return (
    <div className="flex h-full flex-col gap-3 glass p-4" data-testid="schematic-grid">
      <div className="flex items-center gap-2 text-xs text-amber-300">
        <MapPinOff size={14} /> Set VITE_MAPBOX_TOKEN in frontend/.env to enable the 3D Mapbox view.
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3">
        {zones.map((z) => (
          <div
            key={z.zone_id}
            className="flex flex-col rounded-xl p-3 ring-1"
            style={{ backgroundColor: `${carbonColor(z.carbon_intensity)}1f`, borderColor: carbonColor(z.carbon_intensity) }}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-fg">{z.name}</span>
              <span className="font-mono text-lg" style={{ color: carbonColor(z.carbon_intensity) }}>
                {Math.round(z.carbon_intensity)} g
              </span>
            </div>
            <div className="text-[11px] text-muted-fg">{Math.round(z.renewable_pct)}% renewable</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {workloads
                .filter((w) => w.zone_id === z.zone_id)
                .map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onSelect(w.id)}
                    className="vs-marker"
                    style={{ ['--vs-marker-color' as string]: STATUS_META[w.status].color }}
                  >
                    {markerLabel(w)}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
