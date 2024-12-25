grist.ready({ requiredAccess: 'full', columns: ['Address', 'Latitude', 'Longitude'], allowSelectBy: true });

let addressColumn = null;
let latitudeColumn = null;
let longitudeColumn = null;
const previousAddresses = new Map();

const geocodeApiKey = 'AIzaSyBOtVjKr3D0vZmwg1QlxCy6SR4rVQenaPU';
const geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json';

grist.onRecord((record, mapping) => {
  if (!record) {
    return;
  }
  addressColumn = mapping['Address'];
  latitudeColumn = mapping['Latitude'];
  longitudeColumn = mapping['Longitude'];

  // Store the initial address for comparison if not already tracked
  if (!previousAddresses.has(record.id)) {
    previousAddresses.set(record.id, record[addressColumn]);
  }

  // Automatically update coordinates if the address has changed
  const currentAddress = record[addressColumn];
  if (currentAddress && previousAddresses.get(record.id) !== currentAddress) {
    updateCoordinates(record);
  }
});

async function fetchCoordinates(address) {
  const url = `${geocodeUrl}?address=${encodeURIComponent(address)}&key=${geocodeApiKey}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    } else {
      console.error('Geocoding error:', data.status, data.error_message);
      return null;
    }
  } catch (error) {
    console.error('Network or API error:', error);
    return null;
  }
}

async function updateCoordinates(record) {
  const address = record[addressColumn];
  if (!address) {
    console.warn('Address is empty for record:', record.id);
    return;
  }

  const coordinates = await fetchCoordinates(address);
  if (coordinates) {
    const delta = {
      id: record.id,
      fields: {
        [latitudeColumn]: coordinates.lat,
        [longitudeColumn]: coordinates.lng
      }
    };
    await grist.selectedTable.update(delta);

    // Update the stored address after successful update
    previousAddresses.set(record.id, address);
  }
}
