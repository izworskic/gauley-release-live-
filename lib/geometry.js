export const WAYPOINTS = [
  { id:'dam', name:'Summersville Dam', type:'dam', class:'', riverMile:0.0, lat:38.2151103, lon:-80.8881536, source:'USGS 03189600 / USACE' },
  { id:'initiation', name:'Initiation', type:'rapid', class:'IV', riverMile:0.7, lat:38.20793, lon:-80.88801, source:'American Whitewater' },
  { id:'insignificant', name:'Insignificant', type:'rapid', class:'V', riverMile:3.5, lat:38.20308, lon:-80.91870, source:'American Whitewater' },
  { id:'pillow', name:'Pillow Rock', type:'rapid', class:'IV+', riverMile:5.0, lat:38.20707, lon:-80.93482, source:'American Whitewater' },
  { id:'meadow-confluence', name:'Meadow River Confluence', type:'confluence', class:'', riverMile:5.58, lat:38.19333, lon:-80.94444, source:'USGS/GNIS + OpenStreetMap corroboration' },
  { id:'lost-paddle', name:'Lost Paddle', type:'rapid', class:'V', riverMile:5.62, lat:38.19497, lon:-80.94536, source:'American Whitewater' },
  { id:'iron-ring', name:'Iron Ring', type:'rapid', class:'IV+', riverMile:6.9, lat:38.20196, lon:-80.96595, source:'OpenStreetMap/GeoNames corroboration' },
  { id:'sweets', name:"Sweet's Falls", type:'rapid', class:'IV', riverMile:8.2, lat:38.21617, lon:-80.97053, source:'American Whitewater' },
  { id:'mason', name:"Mason's Branch", type:'access', class:'', riverMile:9.8, lat:38.22303, lon:-80.99001, source:'American Whitewater / NPS' },
  { id:'woods', name:"Woods Ferry", type:'access', class:'', riverMile:12.0, lat:38.20404, lon:-81.01527, source:'American Whitewater / NPS' },
  { id:'belva', name:'Belva Gauge', type:'gauge', class:'', riverMile:19.4, lat:38.2334395, lon:-81.1809415, source:'USGS 03192000' }
];

export const MEADOW_CONFLUENCE_MILE = 5.58;

// A verified control-point corridor. The OSM basemap supplies the detailed channel shape;
// this line is intentionally not presented as a surveyed centerline.
export const RIVER_CORRIDOR = WAYPOINTS.map(p => [p.lat, p.lon]);
