import type { Coordinate } from '../types/ride';

export type OfflineLocation = {
  id: string;
  label: string;
  labelKey?: 'busStand' | 'railway' | 'medical';
  coordinate?: Coordinate;
};

// These are deliberately small, reviewed landmarks. Selecting one always opens
// the pin map so the customer can confirm the exact pickup or destination.
export const offlineLocationCatalogue: readonly OfflineLocation[] = [
  { id: 'bus-stand', label: 'Nandyal Bus Stand', labelKey: 'busStand', coordinate: { latitude: 15.4871, longitude: 78.4814 } },
  { id: 'railway-station', label: 'Nandyal Railway Station', labelKey: 'railway', coordinate: { latitude: 15.48, longitude: 78.48 } },
  { id: 'government-general-hospital', label: 'Government General Hospital, Nandyal', labelKey: 'medical', coordinate: { latitude: 15.4921, longitude: 78.4862 } },
  { id: 'santhiram-medical', label: 'Santhiram Medical College & General Hospital', coordinate: { latitude: 15.49237, longitude: 78.41744 } },
  { id: 'rgmcet', label: 'R.G.M. College of Engineering and Technology', coordinate: { latitude: 15.50397, longitude: 78.37828 } },
  { id: 'government-medical-college', label: 'Government Medical College, Nandyala', coordinate: { latitude: 15.46079, longitude: 78.48036 } },
  { id: 'vegetable-market', label: 'Nandyal Vegetable Market / Gandhi Chowk' },
  { id: 'main-bazaar', label: 'Main Bazaar' },
  { id: 'gold-market', label: 'One Town Gold Market' },
  { id: 'municipal-park', label: 'Municipal Park' },
  { id: 'ayyappa-temple', label: 'Sri Ayyappa Swamy Temple, Telugu Peta' },
  { id: 'jamia-masjid', label: 'Jamia Masjid (Markaz), Fort Street' },
  { id: 'spg-high-school', label: 'SPG High School, Nandyal' },
  { id: 'kaderbad-school', label: 'Kaderbad Narasinga Rao Memorial Municipal High School' },
  { id: 'bishop-bunyan-college', label: 'Bishop Bunyan J.S.P.G. Junior College, R.S. Road' },
  { id: 'raos-junior-college', label: "Rao's Junior College, Bommalasatram" },
  { id: 'raos-girls-college', label: "Rao's Junior College for Girls, Balaji Complex" },
  { id: 'sri-sri-venkateswara-college', label: 'Sri Sri Venkateswara Junior College, N.K. Road' },
  { id: 'santhiram-engineering', label: 'Santhiram Engineering College, Nerawada X Roads' },
  { id: 'santhiram-pharmacy', label: 'Santhiram College of Pharmacy, NH-40' },
  { id: 'santhiram-nursing', label: 'Santhiram College of Nursing, NH-40' },
  { id: 'i-town-police', label: 'Nandyal I Town Police Station' },
  { id: 'ii-town-police', label: 'Nandyal II Town Police Station' },
  { id: 'iii-town-police', label: 'Nandyal III Town Police Station' },
  { id: 'traffic-police', label: 'Nandyal Traffic Police Station' },
  { id: 'taluka-police', label: 'Nandyal Taluka Police Station' },
  { id: 'fire-station', label: 'Nandyal Fire Station' },
];
