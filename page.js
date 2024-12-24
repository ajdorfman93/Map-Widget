"use strict";

/* global grist, window */

let amap;
let popups = {};
let selectedTableId = null;
let selectedRowId = null;
let selectedRecords = null;
let mode = 'multi';
let mapSource = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
let mapCopyright = 'Map data © OpenStreetMap contributors';
const Name = "Name";
const Longitude = "Longitude";
const Latitude = "Latitude";
const Geocode = 'Geocode';
const Address = 'Address';
const GeocodedAddress = 'GeocodedAddress';
let lastRecord;
let lastRecords;

const apiKey = 'AIzaSyBOtVjKr3D0vZmwg1QlxCy6SR4rVQenaPU';

const selectedIcon = new L.Icon({
  iconUrl: 'marker-icon-green.png',
  iconRetinaUrl: 'marker-icon-green-2x.png',
  shadowUrl: 'marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});
const defaultIcon = new L.Icon.Default();

const selectedRowClusterIconFactory = function (selectedMarkerGetter) {
  return function (cluster) {
    const childCount = cluster.getChildCount();
    const isSelected = cluster.getAllChildMarkers().some((m) => m === selectedMarkerGetter());

    const sizeClass = childCount < 10 ? 'small' : childCount < 100 ? 'medium' : 'large';

    return new L.DivIcon({
      html: `<div><span>${childCount} <span aria-label="markers"></span></span></div>`,
      className: `marker-cluster marker-cluster-${sizeClass} ${isSelected ? 'marker-cluster-selected' : ''}`,
      iconSize: new L.Point(40, 40)
    });
  };
};

async function geocode(address) {
  const encodedAddress = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

  return new Promise((resolve, reject) => {
    fetch(url)
      .then(response => response.json())
      .then(data => {
        if (data.status === 'OK' && data.results.length > 0) {
          const location = data.results[0].geometry.location;
          resolve({ lat: location.lat, lng: location.lng });
        } else {
          reject(new Error(`Geocoding failed: ${data.status}`));
        }
      })
      .catch(error => reject(error));
  });
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let writeAccess = true;
let scanning = null;

async function scan(tableId, records, mappings) {
  if (!writeAccess) return;
  for (const record of records) {
    if (!record[Geocode]) continue;

    const address = record[Address];
    if (record[GeocodedAddress] && record[GeocodedAddress] !== record[Address]) {
      record[Longitude] = null;
      record[Latitude] = null;
    }

    if (address && !record[Longitude]) {
      try {
        const result = await geocode(address);
        if (result) {
          await grist.docApi.applyUserActions([
            [
              'UpdateRecord',
              tableId,
              record.id,
              {
                [mappings[Longitude]]: result.lng,
                [mappings[Latitude]]: result.lat,
                ...(GeocodedAddress in mappings ? { [mappings[GeocodedAddress]]: address } : {})
              }
            ]
          ]);
          await delay(1000);
        }
      } catch (error) {
        console.error(`Geocoding error for record ${record.id}:`, error);
      }
    }
  }
}

function scanOnNeed(mappings) {
  if (!scanning && selectedTableId && selectedRecords) {
    scanning = scan(selectedTableId, selectedRecords, mappings)
      .then(() => (scanning = null))
      .catch(() => (scanning = null));
  }
}

function showProblem(message) {
  document.getElementById('map').innerHTML = `<div class="error">${message}</div>`;
}

function getInfo(record) {
  return {
    id: record.id,
    name: record[Name],
    lng: record[Longitude],
    lat: record[Latitude]
  };
}

let clearMarkers = () => {};
let markers = [];

function updateMap(data) {
  data = data || selectedRecords;
  selectedRecords = data;
  if (!data || !data.length) {
    showProblem("No data found yet");
    return;
  }

  if (!(Longitude in data[0] && Latitude in data[0] && Name in data[0])) {
    showProblem("Table does not have all expected columns: Name, Longitude, Latitude.");
    return;
  }

  const tiles = L.tileLayer(mapSource, { attribution: mapCopyright });

  if (amap) {
    amap.off();
    amap.remove();
  }

  const map = L.map('map', {
    layers: [tiles],
    wheelPxPerZoomLevel: 90
  });

  map.createPane('selectedMarker').style.zIndex = 620;
  map.createPane('clusters').style.zIndex = 610;
  map.createPane('otherMarkers').style.zIndex = 600;

  const points = [];
  popups = {};

  markers = L.markerClusterGroup({
    disableClusteringAtZoom: 18,
    maxClusterRadius: 30,
    showCoverageOnHover: true,
    clusterPane: 'clusters',
    iconCreateFunction: selectedRowClusterIconFactory(() => popups[selectedRowId])
  });

  markers.on('click', (e) => {
    const id = e.layer.options.id;
    selectMarker(id);
  });

  for (const rec of data) {
    const { id, name, lng, lat } = getInfo(rec);
    if (!lng || !lat) continue;

    const pt = new L.LatLng(lat, lng);
    points.push(pt);

    const marker = L.marker(pt, {
      title: name,
      id: id,
      icon: id === selectedRowId ? selectedIcon : defaultIcon,
      pane: id === selectedRowId ? 'selectedMarker' : 'otherMarkers'
    });

    marker.bindPopup(name);
    markers.addLayer(marker);

    popups[id] = marker;
  }

  map.addLayer(markers);
  clearMarkers = () => map.removeLayer(markers);

  try {
    map.fitBounds(new L.LatLngBounds(points), { maxZoom: 15, padding: [0, 0] });
  } catch (err) {
    console.warn("Cannot fit bounds", err);
  }

  amap = map;
}

function selectMarker(id) {
  const prev = popups[selectedRowId];
  if (prev) {
    prev.setIcon(defaultIcon);
    prev.options.pane = 'otherMarkers';
  }

  const marker = popups[id];
  if (!marker) return;

  selectedRowId = id;
  marker.setIcon(selectedIcon);
  marker.options.pane = 'selectedMarker';
  markers.refreshClusters();

  grist.setCursorPos?.({ rowId: id }).catch(() => {});
}

grist.on('message', (e) => {
  if (e.tableId) selectedTableId = e.tableId;
});

grist.onRecord((record, mappings) => {
  if (mode === 'single') {
    lastRecord = grist.mapColumnNames(record) || record;
    updateMap([lastRecord]);
    scanOnNeed(defaultMapping(record, mappings));
  } else {
    selectMarker(record.id);
  }
});

grist.onRecords((data, mappings) => {
  lastRecords = grist.mapColumnNames(data) || data;
  if (mode !== 'single') {
    updateMap(lastRecords);
    scanOnNeed(defaultMapping(data[0], mappings));
  }
});

grist.onNewRecord(() => {
  clearMarkers();
  clearMarkers = () => {};
});

grist.ready({
  columns: [
    "Name",
    { name: "Longitude", type: 'Numeric' },
    { name: "Latitude", type: 'Numeric' },
    { name: "Geocode", type: 'Bool', optional: true },
    { name: "Address", type: 'Text', optional: true },
    { name: "GeocodedAddress", type: 'Text', optional: true }
  ],
  allowSelectBy: true
});
