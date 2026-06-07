# Gold Scout Global V6

Version 6 adds:
- Live satellite map with viewport-based theoretical hotspot engine
- Hotspots refresh as you pan/zoom the visible map area
- Street/topographic layer toggles
- GPS and walking tracking
- Spot analyzer with global placer scoring
- Photo intelligence
- Saved success/failure journal
- Local calibration from real pan results
- JSON/CSV exports
- Voice hint option
- iPhone install/PWA support

Important: V6 is a static web app. It uses live satellite tiles, but true USGS/LiDAR/claim/geology API automation requires a future backend/API-key version.


## V6.1 River-Locked Hotspot Fix

This update fixes sporadic/off-river hotspots.

Changes:
- Uses OpenStreetMap Overpass API to fetch visible rivers/streams/creeks.
- Anchors hotspot candidates to mapped waterways instead of random viewport points.
- Adds offset bend-margin targets to test likely gravel-bar/pay-streak edges.
- Uses deterministic scoring so refresh results stay consistent.
- Adds a label-friendly default Street layer with river/town names.
- Keeps Satellite and Topo map layer toggles.
- Adds optional town/river label overlay for satellite view.

Note: live satellite tiles and river-locked waterway fetching require internet.


## V6.2 Stable River Heat Map

This version fixes jumpy/sporadic hotspot pins by replacing random-looking pins with a stable green/yellow/red river heat overlay.

Changes:
- Heat-map cells are anchored to mapped OpenStreetMap waterways.
- Refresh is throttled so panning/zooming does not constantly reshuffle points.
- Scoring uses deterministic coordinate-based variation, not random refresh noise.
- Town/river names are visible using the default labeled street map, with satellite/topo toggles.
- Satellite remains available, and an optional labels overlay can be turned on.
- Green/yellow/red circles show potential areas instead of many scattered pins.

Internet is required for satellite tiles and OpenStreetMap river data.
