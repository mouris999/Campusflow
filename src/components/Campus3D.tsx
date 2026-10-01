import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// `Map` is aliased because this file also uses the JavaScript `Map` for lookups.
import {
  Map as MapIcon,
  List,
  RotateCcw,
  Layers,
  Maximize2,
  LocateFixed,
  Route,
  Info,
  X
} from 'lucide-react';
import type { TrafficState } from '../types/traffic.js';
import { useApp } from '../context/AppContext.js';
import { useTraffic } from '../context/TrafficContext.js';
import { createCampusScene, type CampusSceneHandle } from '../three/CampusScene.js';
import { markersFromData, STATE_COLOUR, STATE_GLYPH, type ServiceMarker } from '../three/TrafficLayer.js';
import { CampusPositioner, type CampusLink } from '../lib/campusPosition.js';
import { CAMPUS_GEOMETRY, OSM_ATTRIBUTION, SATELLITE_ATTRIBUTION, geometryProvenance } from '../lib/campusGeo.js';
import { formatDistance, formatDuration, ROUTE_SPEED_IS_ASSUMED } from '../lib/campusRoute.js';
import type { CampusBuilding } from '../lib/campusGeo.js';
import type { Service } from '../types/index.js';

interface Campus3DProps {
  links: CampusLink[];
  onSelectService: (service: Service) => void;
  onJoinQueue: (service: Service) => void;
}

interface GroundStatus {
  satelliteLoaded: boolean;
  tilesLoaded: number;
  tilesRequested: number;
  resolution_m_per_px: number;
}

const STATE_WORD: Record<TrafficState, string> = {
  low: 'Quiet',
  moderate: 'Normal',
  high: 'Busy',
  peak: 'Very busy',
  closed: 'Closed'
};

/**
 * The interactive 3D campus.
 *
 * A visualisation layer over real CampusFlow data, on real OpenStreetMap
 * geometry. The satellite ground and the building footprints are real; the
 * queue, wait and peak figures come from the live API. Where a service's
 * position is only a projection of the 2D layout rather than an admin-confirmed
 * link, the panel says so rather than implying it is surveyed.
 */
export const Campus3D: React.FC<Campus3DProps> = ({ links, onSelectService, onJoinQueue }) => {
  const { services, buildings } = useApp();
  const { overview } = useTraffic();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<CampusSceneHandle | null>(null);

  const [markers, setMarkers] = useState<ServiceMarker[]>([]);
  const [ground, setGround] = useState<GroundStatus | null>(null);
  const [pickedBuilding, setPickedBuilding] = useState<CampusBuilding | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [view, setView] = useState<'3d' | 'list'>('3d');
  const [webglOk, setWebglOk] = useState(true);
  const [routeInfo, setRouteInfo] = useState<{ distance_m: number; duration_s: number; why: string } | null>(
    null
  );
  const [routeError, setRouteError] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(false);
  const [showNames, setShowNames] = useState(true);

  const positioner = useMemo(() => new CampusPositioner(links), [links]);
  const provenance = useMemo(() => geometryProvenance(), []);

  const buildingById = useMemo(
    () => new Map(buildings.map(b => [b.id, b])),
    [buildings]
  );

  const selectedMarker = markers.find(m => m.serviceId === selectedServiceId) ?? null;
  const selectedService = services.find(s => s.id === selectedServiceId) ?? null;
  const selectedBuilding = pickedBuilding;
  const servicesInPicked = useMemo(
    () => (pickedBuilding ? services.filter(s => s.building_id === buildingFor(pickedBuilding)) : []),
    [pickedBuilding, services]
  );

  // --- scene lifecycle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: CampusSceneHandle;
    try {
      scene = createCampusScene(canvas, {
        onBuildingPicked: building => setPickedBuilding(building),
        onServicePicked: id => setSelectedServiceId(id),
        onGroundStatus: status => setGround(status)
      });
    } catch {
      // No WebGL, or the context could not be created: fall back to the list.
      setWebglOk(false);
      return;
    }

    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // --- live data into the scene
  useEffect(() => {
    const next = markersFromData({
      services,
      positionFor: buildingId => {
        const building = buildingById.get(buildingId);
        if (!building) return null;
        const at = positioner.positionFor(building);
        if (!at) return null;
        return { position: at.position, verified: at.verified };
      }
    });
    setMarkers(next);
    sceneRef.current?.setMarkers(next);
  }, [services, positioner, buildingById]);

  const focusService = useCallback((id: string) => {
    setSelectedServiceId(id);
    setPickedBuilding(null);
    sceneRef.current?.selectService(id);
    sceneRef.current?.focusMarker(id);
  }, []);

  const resetView = useCallback(() => {
    sceneRef.current?.resetView();
    setSelectedServiceId(null);
    setPickedBuilding(null);
    setRouteInfo(null);
    setRouteError(null);
  }, []);

  const topDown = useCallback(() => sceneRef.current?.topDownView(), []);

  // --- walking route between the current service and a chosen alternative
  const drawRoute = useCallback(
    (fromBuildingId: string, toBuildingId: string) => {
      const a = buildingById.get(fromBuildingId);
      const b = buildingById.get(toBuildingId);
      if (!a || !b) return;
      const pa = positioner.positionFor(a);
      const pb = positioner.positionFor(b);
      if (!pa || !pb) return;

      const result = sceneRef.current!.showRoute(pa.position, pb.position);
      if (result.ok) {
        setRouteInfo({
          distance_m: result.distance_m,
          duration_s: result.duration_s,
          why: result.used_highways.join(', ') || 'mapped campus path'
        });
        setRouteError(null);
      } else {
        setRouteError(result.reason ?? 'No mapped walking route between these locations.');
        setRouteInfo(null);
      }
    },
    [buildingById, positioner]
  );

  if (!webglOk) {
    return (
      <CampusListFallback
        services={services}
        markers={markers}
        onSelect={focusService}
        reason="This device or browser could not start WebGL, so the 3D campus is unavailable. Everything the 3D view shows is listed here."
      />
    );
  }

  return (
    <section className="cf3d" aria-label="Interactive 3D campus">
      <div className="cf3d-stage">
        <canvas
          ref={canvasRef}
          className="cf3d-canvas"
          role="img"
          aria-label={
            `3D map of the campus showing ${CAMPUS_GEOMETRY.buildings.length} real buildings, ` +
            `${CAMPUS_GEOMETRY.roads.length} real roads and ${markers.length} live CampusFlow ` +
            `service beacons. Use the accessible list view for the same information as text.`
          }
        />

        {/* Service list for screen readers, kept in the DOM as the text equivalent. */}
        <ul className="sr-only">
          {markers.map(m => (
            <li key={m.serviceId}>
              {m.serviceName}: {STATE_WORD[m.traffic]}, {m.waitMins} minute wait, {m.queueLength} in queue
              {m.isOpen ? '' : ', closed'}
            </li>
          ))}
        </ul>

        {/* Controls */}
        <div className="cf3d-controls" role="toolbar" aria-label="3D campus controls">
          <button type="button" onClick={resetView} title="Reset to whole campus">
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button type="button" onClick={topDown} title="Top-down plan view">
            <MapIcon className="w-4 h-4" aria-hidden="true" />
            <span>Plan</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLayers(v => !v)}
            aria-expanded={showLayers}
            title="Layers and labels"
          >
            <Layers className="w-4 h-4" aria-hidden="true" />
            <span>Layers</span>
          </button>
          <button
            type="button"
            onClick={() => setView(v => (v === '3d' ? 'list' : '3d'))}
            title={view === '3d' ? 'Switch to accessible list view' : 'Switch to 3D view'}
          >
            {view === '3d' ? (
              <><List className="w-4 h-4" aria-hidden="true" /><span>List</span></>
            ) : (
              <><Maximize2 className="w-4 h-4" aria-hidden="true" /><span>3D</span></>
            )}
          </button>
        </div>

        {showLayers && (
          <div className="cf3d-panel">
            <h3>View options</h3>
            <label className="cf3d-check">
              <input
                type="checkbox"
                checked={showNames}
                onChange={e => setShowNames(e.target.checked)}
              />
              Show campus place names
            </label>
            <dl className="cf3d-facts">
              <div><dt>Real buildings</dt><dd>{CAMPUS_GEOMETRY.buildings.length}</dd></div>
              <div><dt>Real roads and paths</dt><dd>{CAMPUS_GEOMETRY.roads.length}</dd></div>
              <div><dt>Sports pitches</dt><dd>{CAMPUS_GEOMETRY.sports.length}</dd></div>
              <div>
                <dt>Imagery</dt>
                <dd>
                  {ground?.satelliteLoaded
                    ? `Satellite (${ground.resolution_m_per_px.toFixed(2)} m/px)`
                    : ground
                      ? `Loading ${ground.tilesLoaded}/${ground.tilesRequested} tiles`
                      : 'Loading satellite imagery…'}
                </dd>
              </div>
            </dl>
            <p className="cf3d-attr">
              Geometry {OSM_ATTRIBUTION} · Imagery {SATELLITE_ATTRIBUTION}
            </p>
          </div>
        )}

        {/* Live beacon list: also the fastest way to reach a service without a pointer. */}
        <div className="cf3d-beacons" aria-label="Live services on the campus">
          {markers.map(m => (
            <button
              key={m.serviceId}
              type="button"
              className={`cf3d-beacon${m.serviceId === selectedServiceId ? ' is-active' : ''}`}
              onClick={() => focusService(m.serviceId)}
              aria-pressed={m.serviceId === selectedServiceId}
            >
              <span
                className="cf3d-dot"
                style={{ background: `#${STATE_COLOUR[m.traffic].toString(16).padStart(6, '0')}` }}
                aria-hidden="true"
              />
              <span className="cf3d-beacon-text">
                <strong>{m.serviceName}</strong>
                <span>
                  {STATE_GLYPH[m.traffic]} {STATE_WORD[m.traffic]} · {m.waitMins} min
                  {m.isOpen ? '' : ' · closed'}
                </span>
              </span>
            </button>
          ))}
          {markers.length === 0 && (
            <p className="cf3d-empty">No CampusFlow services are placed on the campus yet.</p>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {view === '3d' && (selectedMarker || selectedBuilding) && (
        <aside className="cf3d-detail" aria-live="polite">
          <button
            type="button"
            className="cf3d-close"
            onClick={() => {
              setSelectedServiceId(null);
              setPickedBuilding(null);
            }}
            aria-label="Close details"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>

          {selectedMarker && (
            <>
              <h3>{selectedMarker.serviceName}</h3>
              <p className="cf3d-state">
                <span
                  className="cf3d-dot"
                  style={{ background: `#${STATE_COLOUR[selectedMarker.traffic].toString(16).padStart(6, '0')}` }}
                  aria-hidden="true"
                />
                {STATE_GLYPH[selectedMarker.traffic]} {STATE_WORD[selectedMarker.traffic]}
              </p>
              <dl className="cf3d-facts">
                <div><dt>Current wait</dt><dd>{selectedMarker.waitMins} min</dd></div>
                <div><dt>In queue</dt><dd>{selectedMarker.queueLength}</dd></div>
                {selectedMarker.peakLabel && (
                  <div><dt>Usual peak</dt><dd>{selectedMarker.peakLabel}</dd></div>
                )}
                {selectedMarker.availableSeats != null && (
                  <div><dt>Seats available</dt><dd>{selectedMarker.availableSeats}</dd></div>
                )}
                <div>
                  <dt>Position</dt>
                  <dd>
                    {selectedMarker.positionIsVerified
                      ? 'Linked to a surveyed building'
                      : 'Projected from the 2D campus layout — not a surveyed location'}
                  </dd>
                </div>
              </dl>

              {selectedService && (
                <div className="cf3d-actions">
                  <button type="button" onClick={() => onSelectService(selectedService)}>
                    <Info className="w-4 h-4" aria-hidden="true" /> View services
                  </button>
                  <button type="button" onClick={() => onJoinQueue(selectedService)}>
                    Join virtual queue
                  </button>
                </div>
              )}

              {/* Alternatives, with a real measured route between them. */}
              {markers
                .filter(m => m.serviceId !== selectedMarker.serviceId && m.traffic !== 'closed')
                .sort(
                  (a, b) =>
                    a.waitMins - selectedMarker.waitMins - (b.waitMins - selectedMarker.waitMins)
                )
                .slice(0, 2)
                .map(alt => (
                  <div key={alt.serviceId} className="cf3d-alt">
                    <p>
                      <strong>{alt.serviceName}</strong> — {alt.waitMins} min wait
                      {alt.waitMins < selectedMarker.waitMins &&
                        ` (${selectedMarker.waitMins - alt.waitMins} min less)`}
                    </p>
                    <button
                      type="button"
                      onClick={() => drawRoute(selectedMarker.buildingId, alt.buildingId)}
                    >
                      <Route className="w-3.5 h-3.5" aria-hidden="true" /> Show walking route
                    </button>
                  </div>
                ))}

              {routeInfo && (
                <p className="cf3d-route" role="status">
                  {formatDistance(routeInfo.distance_m)} · {formatDuration(routeInfo.duration_s)} walk
                  <br />
                  <small>
                    Measured along {routeInfo.why}.
                    {ROUTE_SPEED_IS_ASSUMED && ' Walking time assumes 1.35 m/s — an estimate, not campus data.'}
                  </small>
                </p>
              )}
              {routeError && (
                <p className="cf3d-route-error" role="status">
                  {routeError}
                </p>
              )}
            </>
          )}

          {!selectedMarker && selectedBuilding && (
            <>
              <h3>{selectedBuilding.name ?? 'Unnamed building'}</h3>
              <dl className="cf3d-facts">
                <div><dt>Footprint</dt><dd>{selectedBuilding.area_m2.toLocaleString()} m²</dd></div>
                <div>
                  <dt>Height</dt>
                  <dd>
                    {selectedBuilding.height_m != null
                      ? `${selectedBuilding.height_m} m (surveyed)`
                      : 'Not recorded — shown at a default height'}
                  </dd>
                </div>
                <div>
                  <dt>CampusFlow services here</dt>
                  <dd>{servicesInPicked.length === 0 ? 'None linked yet' : servicesInPicked.length}</dd>
                </div>
              </dl>
              {servicesInPicked.length === 0 && (
                <p className="cf3d-note">
                  This building has no CampusFlow service linked to it, so no live figures are shown.
                  A campus administrator can link one from the admin tools.
                </p>
              )}
              {servicesInPicked.map(s => (
                <div key={s.id} className="cf3d-alt">
                  <p><strong>{s.name}</strong> — {s.estimated_wait_mins} min wait</p>
                  <button type="button" onClick={() => focusService(s.id)}>
                    <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" /> Show on campus
                  </button>
                </div>
              ))}
            </>
          )}
        </aside>
      )}

      {view === 'list' && (
        <CampusListFallback
          services={services}
          markers={markers}
          onSelect={focusService}
          reason="Accessible list view. Identical information to the 3D map, as text."
        />
      )}

      {showNames && (
        <ul className="cf3d-place-names" aria-hidden="true">
          {[...CAMPUS_GEOMETRY.sports, ...CAMPUS_GEOMETRY.green]
            .filter(a => a.name)
            .slice(0, 8)
            .map(a => (
              <li key={a.id}>{a.name}</li>
            ))}
        </ul>
      )}

      <p className="cf3d-footnote">
        3D campus geometry is real survey data from OpenStreetMap; every queue, wait and
        traffic figure is live CampusFlow data. Nothing on this map is simulated. Buildings
        with no linked service show no figures.
      </p>

      {/* Provenance: what is real, what is measured, what is assumed. */}
      <details className="cf3d-provenance">
        <summary>What this 3D campus is made of</summary>
        <dl className="cf3d-facts">
          <div>
            <dt>Geometry source</dt>
            <dd>{OSM_ATTRIBUTION}, captured {CAMPUS_GEOMETRY.captured_at}</dd>
          </div>
          <div><dt>Imagery</dt><dd>{SATELLITE_ATTRIBUTION}</dd></div>
          <div>
            <dt>Real buildings</dt>
            <dd>
              {provenance.total} footprints · {provenance.surveyed} with a surveyed height ·{' '}
              {provenance.assumed} at a documented default height
            </dd>
          </div>
          <div><dt>Real roads and paths</dt><dd>{provenance.roads} used for walking routes</dd></div>
          <div>
            <dt>Named in the source</dt>
            <dd>
              {provenance.namedBuildings.length > 0
                ? provenance.namedBuildings.join(', ')
                : 'none recorded at this zoom'}
            </dd>
          </div>
          <div>
            <dt>Verified service positions</dt>
            <dd>
              {links.length} confirmed against a real building;{' '}
              {markers.length - links.length} projected from the 2D layout
            </dd>
          </div>
        </dl>
        <p className="cf3d-provenance-note">
          Queue lengths, wait estimates and traffic states come from the live CampusFlow API.
          Buildings with no linked service show no figures at all, rather than invented ones.
          Walking distances are measured along the mapped path network; walking times assume
          1.35 m/s and are labelled as estimates.
        </p>
      </details>
    </section>
  );
};

/** Finds the CampusFlow building a real OSM building was linked to, if any. */
function buildingFor(campusBuilding: CampusBuilding): string | null {
  const links = (window as any).__cfCampusLinks as CampusLink[] | undefined;
  if (!links) return null;
  return links.find(l => l.osm_element_id === campusBuilding.id)?.campusflow_building_id ?? null;
}

/**
 * The text equivalent of the 3D campus.
 *
 * Required, not optional: a student must not lose function because they cannot
 * use WebGL or a pointer. Carries the same real values as the scene.
 */
const CampusListFallback: React.FC<{
  services: Service[];
  markers: ServiceMarker[];
  onSelect: (id: string) => void;
  reason: string;
}> = ({ services, markers, onSelect, reason }) => (
  <div className="cf3d-list">
    <p className="cf3d-note">{reason}</p>
    <table className="cf3d-table">
      <caption>Live services on the campus</caption>
      <thead>
        <tr>
          <th scope="col">Service</th>
          <th scope="col">Status</th>
          <th scope="col">Wait</th>
          <th scope="col">In queue</th>
          <th scope="col">Position basis</th>
          <th scope="col"><span className="sr-only">Action</span></th>
        </tr>
      </thead>
      <tbody>
        {markers.map(m => (
          <tr key={m.serviceId}>
            <th scope="row">{m.serviceName}</th>
            <td>{STATE_GLYPH[m.traffic]} {STATE_WORD[m.traffic]}</td>
            <td>{m.waitMins} min</td>
            <td>{m.queueLength}</td>
            <td>{m.positionIsVerified ? 'Surveyed link' : 'Projected from 2D layout'}</td>
            <td>
              <button type="button" onClick={() => onSelect(m.serviceId)}>
                Locate
              </button>
            </td>
          </tr>
        ))}
        {markers.length === 0 && (
          <tr>
            <td colSpan={6}>No services are placed on the campus yet.</td>
          </tr>
        )}
      </tbody>
    </table>
    <p className="cf3d-footnote">
      {services.length} service{services.length === 1 ? '' : 's'} exist in the system;
      {' '}{markers.length} could be placed on the 3D campus.
    </p>
  </div>
);
