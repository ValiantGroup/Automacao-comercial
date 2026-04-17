import { useState, useCallback, useRef, CSSProperties } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
  Circle,
} from "@react-google-maps/api";

// ─── Configuração ─────────────────────────────────────────────────────────────
const GOOGLE_MAPS_API_KEY = "AIzaSyBaoltxC6f4q9ejZUpfKEmB6DUAzmIv9rc";

const MAP_CONTAINER_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
};

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true,
  styles: [
    { elementType: "geometry", stylers: [{ color: "#f5f0eb" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#3d3522" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5f0eb" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#e8ddd0" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d4c4b0" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e2f1" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#d4e8c2" }] },
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  ],
};

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface MapMarker {
  id: number;
  lat: number;
  lng: number;
  title: string;
  vicinity?: string;
  rating?: number;
  placeId?: string;
}

interface LatLng {
  lat: number;
  lng: number;
}

interface CampaignForm {
  nome: string;
  nichos: string;
  cidade: string;
  raio: number;
}

const DEFAULT_CENTER: LatLng = { lat: -23.5505, lng: -46.6333 };
const DEFAULT_ZOOM = 12;

// ─── Componente principal ─────────────────────────────────────────────────────
export default function GoogleMapComponent() {
  const [form, setForm] = useState<CampaignForm>({
    nome: "",
    nichos: "",
    cidade: "",
    raio: 2000,
  });

  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [searchCenter, setSearchCenter] = useState<LatLng | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [totalResults, setTotalResults] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const mapRef = useRef<google.maps.Map | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: ["places"],
  });

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    placesServiceRef.current = new google.maps.places.PlacesService(map);
    geocoderRef.current = new google.maps.Geocoder();
  }, []);

  const onMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    setSearchCenter({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  }, []);

  const geocodeCity = (city: string): Promise<LatLng> => {
    return new Promise((resolve, reject) => {
      if (!geocoderRef.current) return reject("Geocoder indisponível");
      geocoderRef.current.geocode({ address: city }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
        } else {
          reject("Cidade não encontrada");
        }
      });
    });
  };

  const performSearch = (center: LatLng) => {
  if (!placesServiceRef.current || !form.nichos.trim()) return;

  setIsSearching(true);
  setSearchError("");
  setMarkers([]);
  setSelectedMarker(null);
  setHasSearched(true);

  const allResults: google.maps.places.PlaceResult[] = [];

  const request: google.maps.places.PlaceSearchRequest = {
    location: new google.maps.LatLng(center.lat, center.lng),
    radius: form.raio,
    keyword: form.nichos,
  };

  const processResults = (
    results: google.maps.places.PlaceResult[],
    pagination: google.maps.places.PlaceSearchPagination | null
  ) => {
    if (results) {
      allResults.push(...results);
    }

    if (pagination && pagination.hasNextPage) {
      // ⚠️ necessário delay
      setTimeout(() => {
        pagination.nextPage();
      }, 2000);
    } else {
      // acabou paginação
      const newMarkers: MapMarker[] = allResults.map((place, idx) => ({
        id: idx + 1,
        lat: place.geometry?.location?.lat() ?? center.lat,
        lng: place.geometry?.location?.lng() ?? center.lng,
        title: place.name ?? "Local",
        vicinity: place.vicinity,
        rating: place.rating,
        placeId: place.place_id,
      }));

      setMarkers(newMarkers);
      setTotalResults(newMarkers.length);
      setIsSearching(false);

      if (mapRef.current) {
        const bounds = new google.maps.LatLngBounds();
        newMarkers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
        mapRef.current.fitBounds(bounds, 80);
      }
    }
  };

  placesServiceRef.current.nearbySearch(request, (results, status, pagination) => {
    if (
      status === google.maps.places.PlacesServiceStatus.OK &&
      results
    ) {
      processResults(results, pagination);
    } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
      setSearchError("Nenhum resultado encontrado nesta área.");
      setIsSearching(false);
      setTotalResults(0);
    } else {
      setSearchError("Erro na busca.");
      setIsSearching(false);
      setTotalResults(0);
    }
  });
};

  const handleSubmit = async () => {
    if (!form.nichos.trim()) {
      setSearchError("Informe ao menos um nicho para buscar.");
      return;
    }

    setSearchError("");

    try {
      let center = searchCenter;

      if (form.cidade.trim()) {
        const geocoded = await geocodeCity(form.cidade);
        center = geocoded;
        setSearchCenter(geocoded);
        setMapCenter(geocoded);
        mapRef.current?.panTo(geocoded);
      } else if (!center) {
        center = mapCenter;
        setSearchCenter(mapCenter);
      }

      performSearch(center!);
    } catch (err) {
      setSearchError(String(err));
    }
  };

  const pct = ((form.raio - 200) / (20000 - 200)) * 100;

  if (loadError) {
    return (
      <div style={styles.fullCenter}>
        <span style={{ fontSize: 32 }}>⚠</span>
        <p style={{ fontWeight: 600, color: "#1a1612", margin: 0 }}>Erro ao carregar o mapa</p>
        <p style={{ color: "#7a6e5f", fontSize: 14, margin: 0 }}>Verifique se sua API key é válida.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={styles.fullCenter}>
        <div style={styles.spinner} />
        <p style={{ color: "#7a6e5f", fontSize: 14 }}>Carregando mapa...</p>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* ─── Map ─────────────────────────────────────────── */}
      <div style={styles.mapArea}>
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={mapCenter}
          zoom={DEFAULT_ZOOM}
          options={MAP_OPTIONS}
          onLoad={onMapLoad}
          onClick={onMapClick}
        >
          {searchCenter && (
            <Marker
              position={searchCenter}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#1a1612",
                fillOpacity: 0.9,
                strokeColor: "#fff",
                strokeWeight: 2.5,
              }}
              zIndex={999}
            />
          )}

          {searchCenter && (
            <Circle
              center={searchCenter}
              radius={form.raio}
              options={{
                fillColor: "#e05c2a",
                fillOpacity: 0.07,
                strokeColor: "#e05c2a",
                strokeOpacity: 0.45,
                strokeWeight: 1.5,
              }}
            />
          )}

          {markers.map((m) => (
            <Marker
              key={m.id}
              position={{ lat: m.lat, lng: m.lng }}
              onClick={() => setSelectedMarker(m)}
              animation={google.maps.Animation.DROP}
            />
          ))}

          {selectedMarker && (
            <InfoWindow
              position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
              onCloseClick={() => setSelectedMarker(null)}
            >
              <div style={styles.infoWindow}>
                <strong style={styles.infoTitle}>{selectedMarker.title}</strong>
                {selectedMarker.vicinity && (
                  <p style={styles.infoDesc}>📍 {selectedMarker.vicinity}</p>
                )}
                {selectedMarker.rating !== undefined && (
                  <p style={styles.infoRating}>
                    {"★".repeat(Math.round(selectedMarker.rating))}
                    {"☆".repeat(5 - Math.round(selectedMarker.rating))}
                    <span style={{ marginLeft: 5, color: "#5a5040", fontWeight: 400 }}>
                      {selectedMarker.rating.toFixed(1)}
                    </span>
                  </p>
                )}
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>

      {/* ─── Floating Panel — top left ─────────────────── */}
      <div style={styles.floatingPanel}>
        {/* Header */}
        <div style={styles.panelHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={styles.panelTitle}>Nova Campanha</span>
          </div>
          <button
            style={styles.collapseBtn}
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expandir" : "Recolher"}
          >
            {collapsed ? "▾" : "▴"}
          </button>
        </div>

        {/* Collapsed summary */}
        {collapsed && hasSearched && totalResults > 0 && (
          <div style={styles.collapsedSummary}>
            <span style={{ color: "#3a7d44", fontWeight: 600 }}>{totalResults} resultados</span>
            {form.nome && <span style={{ color: "#7a6e5f" }}> · {form.nome}</span>}
          </div>
        )}

        {/* Form body */}
        {!collapsed && (
          <div style={styles.panelBody}>

            {/* Nome da campanha */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Nome da campanha</label>
              <input
                type="text"
                placeholder="Ex: Campanha Q2 SP"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                style={styles.input}
              />
            </div>

            {/* Nichos */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Nichos</label>
              <input
                type="text"
                placeholder="Ex: restaurante, academia, clínica"
                value={form.nichos}
                onChange={(e) => setForm((f) => ({ ...f, nichos: e.target.value }))}
                style={styles.input}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>

            {/* Cidade */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Cidade</label>
              <input
                type="text"
                placeholder="Ex: São Paulo, SP"
                value={form.cidade}
                onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))}
                style={styles.input}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>

            {/* Raio */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Raio
                <span style={styles.radioBadge}>
                  {form.raio >= 1000
                    ? `${(form.raio / 1000).toFixed(1).replace(".0", "")}km`
                    : `${form.raio}m`}
                </span>
              </label>
              <div style={{ paddingTop: 4 }}>
                <input
                  type="range"
                  min={200}
                  max={20000}
                  step={200}
                  value={form.raio}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, raio: parseInt(e.target.value, 10) }))
                  }
                  style={{ width: "100%", accentColor: "#172554" }}
                />
                <div style={styles.rangeTicks}>
                  <span>200m</span>
                  <span>5km</span>
                  <span>10km</span>
                  <span>20km</span>
                </div>
              </div>
              <input
                type="number"
                min={200}
                max={50000}
                value={form.raio}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) setForm((f) => ({ ...f, raio: v }));
                }}
                style={{ ...styles.input, marginTop: 6 }}
              />
            </div>

            {/* Hints / status */}
            {!searchCenter && (
              <p style={styles.hint}>
                💡 Clique no mapa para definir o centro, ou informe uma cidade.
              </p>
            )}
            {searchCenter && !searchError && !hasSearched && (
              <p style={{ ...styles.hint, color: "#3a7d44" }}>
                ✓ Centro definido no mapa
              </p>
            )}
            {searchError && <p style={styles.errorMsg}>⚠ {searchError}</p>}
            {!isSearching && !searchError && hasSearched && totalResults > 0 && (
              <p style={styles.successMsg}>
                ✓ {totalResults} resultado{totalResults !== 1 ? "s" : ""} encontrado{totalResults !== 1 ? "s" : ""}
              </p>
            )}
            {!isSearching && !searchError && hasSearched && totalResults === 0 && (
              <p style={styles.hint}>Nenhum resultado para este raio.</p>
            )}

            {/* CTA */}
            <button
              style={{
                ...styles.submitBtn,
                opacity: isSearching ? 0.7 : 1,
                cursor: isSearching ? "not-allowed" : "pointer",
              }}
              onClick={handleSubmit}
              disabled={isSearching}
            >
              {isSearching ? "Buscando…" : "Buscar no mapa"}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input[type=range] { accent-color: #020617; }
        input:focus { border-color: #020617!important; }
      `}</style>
    </div>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const styles: Record<string, CSSProperties> = {
  root: {
    position: "relative",
    height: "100vh",
    width: "100%",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
  },
  mapArea: {
    position: "absolute",
    inset: 0,
  },
  floatingPanel: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 20,
    width: 280,
    background: "rgba(255,255,255,0.97)",
    backdropFilter: "blur(14px)",
    borderRadius: 14,
    boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.08)",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "13px 15px 12px",
    background: "#020617",
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#f5f0eb",
    letterSpacing: "-0.1px",
  },
  collapseBtn: {
    background: "none",
    border: "none",
    color: "#9a8878",
    cursor: "pointer",
    fontSize: 15,
    lineHeight: 1,
    padding: 0,
  },
  panelBody: {
    padding: "14px 15px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 11,
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    color: "#9a8e7f",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  radioBadge: {
    background: "#020617",
    color: "#fff",
    borderRadius: 10,
    padding: "1px 7px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0",
    textTransform: "none" as const,
  },
  input: {
    padding: "7px 10px",
    borderRadius: 7,
    border: "1.5px solid #e8ddd0",
    background: "#faf8f5",
    color: "#1a1612",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color 0.15s",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  rangeTicks: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 10,
    color: "#b8ae9f",
    marginTop: 3,
  },
  hint: {
    margin: 0,
    fontSize: 11,
    color: "#9a8e7f",
    lineHeight: 1.5,
  },
  errorMsg: {
    margin: 0,
    fontSize: 11,
    color: "#020617",
    fontWeight: 500,
  },
  successMsg: {
    margin: 0,
    fontSize: 11,
    color: "#3a7d44",
    fontWeight: 600,
  },
  submitBtn: {
    width: "100%",
    padding: "10px",
    background: "#020617",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    marginTop: 2,
    transition: "opacity 0.15s",
  },
  collapsedSummary: {
    padding: "8px 15px 10px",
    fontSize: 12,
  },
  infoWindow: {
    minWidth: 180,
    fontFamily: "'DM Sans', sans-serif",
  },
  infoTitle: {
    display: "block",
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 4,
    color: "#1a1612",
  },
  infoDesc: {
    margin: "0 0 4px",
    fontSize: 12,
    color: "#5a5040",
  },
  infoRating: {
    margin: 0,
    fontSize: 13,
    color: "#020617",
    fontWeight: 600,
  },
  fullCenter: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    gap: 12,
    background: "#f5f0eb",
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid #e8ddd0",
    borderTopColor: "#020617",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};