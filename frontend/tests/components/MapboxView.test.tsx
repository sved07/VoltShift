import { act, fireEvent, render, screen } from '@testing-library/react';
import { MAP_STYLE, MapboxView, SITE_LAYER, SITE_SOURCE, ZONE_SOURCE } from '../../src/components/MapboxView';
import { makePacket, makeWorkload } from '../fixtures';

const mapbox = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeMap {
    static instances: FakeMap[] = [];
    options: Record<string, unknown>;
    handlers: { event: string; layer?: string; cb: Handler }[] = [];
    sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {};
    layers: Record<string, Record<string, unknown>> = {};
    flyTo = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeMap.instances.push(this);
    }
    on(event: string, layerOrCb: string | Handler, cb?: Handler) {
      if (typeof layerOrCb === 'string') this.handlers.push({ event, layer: layerOrCb, cb: cb! });
      else this.handlers.push({ event, cb: layerOrCb });
      return this;
    }
    fire(event: string, layer?: string, payload?: unknown) {
      this.handlers.filter((h) => h.event === event && h.layer === layer).forEach((h) => h.cb(payload));
    }
    addSource(id: string, _src: unknown) {
      this.sources[id] = { setData: vi.fn() };
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addLayer(layer: Record<string, unknown>) {
      this.layers[layer.id as string] = layer;
    }
    getCanvas() {
      return { style: {} as Record<string, string> };
    }
  }

  class FakeMarker {
    static instances: FakeMarker[] = [];
    el: HTMLElement;
    lngLat: unknown;
    constructor(opts: { element: HTMLElement }) {
      this.el = opts.element;
      FakeMarker.instances.push(this);
    }
    setLngLat(ll: unknown) {
      this.lngLat = ll;
      return this;
    }
    addTo() {
      this.el.classList.add('mapboxgl-marker'); // like the real Marker; must survive re-renders
      document.body.appendChild(this.el);
      return this;
    }
    remove() {
      this.el.remove();
    }
    getElement() {
      return this.el;
    }
  }

  return { FakeMap, FakeMarker, module: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, accessToken: '' } };
});

vi.mock('mapbox-gl', () => ({ default: mapbox.module }));
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

const lastMap = () => mapbox.FakeMap.instances[mapbox.FakeMap.instances.length - 1];

function renderMap(overrides: Partial<React.ComponentProps<typeof MapboxView>> = {}) {
  const packet = makePacket();
  const onSelect = vi.fn();
  const props = { zones: packet.zones, workloads: packet.workloads, selectedId: null, onSelect, accessToken: 'pk.test', ...overrides };
  const view = render(<MapboxView {...props} />);
  return { ...view, props, onSelect };
}

function loadMap() {
  act(() => lastMap().fire('load'));
}

beforeEach(() => {
  mapbox.FakeMap.instances = [];
  mapbox.FakeMarker.instances = [];
  document.body.innerHTML = '';
});

describe('MapboxView', () => {
  it('mounts a dark-v11 map with the access token', () => {
    renderMap();
    expect(mapbox.FakeMap.instances).toHaveLength(1);
    expect(lastMap().options.style).toBe(MAP_STYLE);
    expect(MAP_STYLE).toBe('mapbox://styles/mapbox/dark-v11');
    expect(mapbox.module.accessToken).toBe('pk.test');
    expect(lastMap().options.pitch).toBeGreaterThan(0);
  });

  it('keeps one map instance across telemetry updates (ref-persisted)', () => {
    const { rerender, props } = renderMap();
    loadMap();
    rerender(<MapboxView {...props} zones={[...props.zones]} workloads={[...props.workloads]} />);
    rerender(<MapboxView {...props} zones={[...props.zones]} />);
    expect(mapbox.FakeMap.instances).toHaveLength(1);
  });

  it('adds carbon-coloured zone polygons and a 3D fill-extrusion site layer on load', () => {
    renderMap();
    loadMap();
    const map = lastMap();
    const fill = map.layers['grid-zones-fill'] as { type: string; paint: Record<string, unknown> };
    expect(fill.type).toBe('fill');
    const color = fill.paint['fill-color'] as unknown[];
    expect(color[0]).toBe('interpolate');
    expect(color[2]).toEqual(['get', 'carbon_intensity']);

    const sites = map.layers[SITE_LAYER] as { type: string; paint: Record<string, unknown> };
    expect(sites.type).toBe('fill-extrusion');
    expect(sites.paint['fill-extrusion-height']).toEqual(['get', 'height']);
  });

  it('pushes zone and site GeoJSON into the sources', () => {
    const { rerender, props } = renderMap();
    loadMap();
    const map = lastMap();
    const zoneData = map.sources[ZONE_SOURCE].setData.mock.lastCall![0];
    expect(zoneData.features.map((f: { properties: { zone_id: string } }) => f.properties.zone_id)).toEqual(['CAISO', 'MISO']);
    const siteData = map.sources[SITE_SOURCE].setData.mock.lastCall![0];
    expect(siteData.features).toHaveLength(2);

    rerender(<MapboxView {...props} zones={[props.zones[0]]} />);
    expect(map.sources[ZONE_SOURCE].setData.mock.lastCall![0].features).toHaveLength(1);
  });

  it('renders glowing status markers with delta labels', () => {
    renderMap();
    loadMap();
    expect(screen.getByText('+15 MW [BOOST]')).toHaveClass('vs-marker', 'vs-marker--boost', 'mapboxgl-marker');
    expect(screen.getByText('-2.9 MW [THROTTLED]')).toHaveClass('vs-marker--throttle');
  });

  it('updates markers in place and removes stale ones', () => {
    const { rerender, props } = renderMap();
    loadMap();
    const updated = [makeWorkload({ status: 'MAINTAIN', current_kw: 30000 })];
    rerender(<MapboxView {...props} workloads={updated} />);
    expect(mapbox.FakeMarker.instances).toHaveLength(2); // no new marker for the existing site
    const maintained = screen.getByText('±0 kW [MAINTAIN]');
    expect(maintained).toHaveClass('vs-marker--maintain');
    expect(maintained).not.toHaveClass('vs-marker--boost');
    expect(screen.queryByText(/THROTTLED/)).not.toBeInTheDocument();
  });

  it('selects a site from its marker or its 3D building', () => {
    const { onSelect } = renderMap();
    loadMap();
    fireEvent.click(screen.getByText('+15 MW [BOOST]'));
    expect(onSelect).toHaveBeenCalledWith('dc-santaclara');
    act(() => lastMap().fire('click', SITE_LAYER, { features: [{ properties: { id: 'ev-chicago' } }] }));
    expect(onSelect).toHaveBeenCalledWith('ev-chicago');
  });

  it('flies the camera to the selected facility', () => {
    const { rerender, props } = renderMap();
    loadMap();
    rerender(<MapboxView {...props} selectedId="ev-chicago" />);
    expect(lastMap().flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-87.63, 41.88] }));
  });

  it('removes the map on unmount', () => {
    const { unmount } = renderMap();
    const map = lastMap();
    unmount();
    expect(map.remove).toHaveBeenCalled();
  });

  it('falls back to a schematic grid without a token', () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');
    const { onSelect } = renderMap({ accessToken: undefined });
    expect(mapbox.FakeMap.instances).toHaveLength(0);
    expect(screen.getByTestId('schematic-grid')).toHaveTextContent(/VITE_MAPBOX_TOKEN/);
    expect(screen.getByText('CAISO (California)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('-2.9 MW [THROTTLED]'));
    expect(onSelect).toHaveBeenCalledWith('ev-chicago');
    vi.unstubAllEnvs();
  });
});
