# Day & Night Simulator

Three.js simulation of Earth's day/night cycle and seasons for students.
The Sun is fixed on the left; Earth spins and tilts according to the real
solar position for the chosen place, date and time.

## Run

Textures can't load from `file://`, so serve the folder:

```
node _serve.cjs      # http://localhost:8792
```

## Files

- `index.html` — the whole sim (three.js 0.160 from jsDelivr via importmap)
- `assets/` — Earth day, night-lights and specular textures (from the three.js examples)
- `tests/browser.test.js` — headless Chrome checks: sunrise/sunset vs published times,
  polar day/night, 3D orientation vs the maths, UI, screenshots.
  Run `node tests/browser.test.js` (set `SHOT_DIR` to keep the screenshots somewhere specific).

## How the model works

- Solar position: NOAA/Meeus low-precision formulas (about 0.01° accuracy), giving
  the Sun's ecliptic longitude λ, the axial tilt ε, the declination and the longitude
  where the Sun is straight overhead.
- The Sun is along world −X and ecliptic north is +Y. Earth's axis is
  `(−sin λ·sin ε, cos ε, cos λ·sin ε)`, so it leans toward the Sun at the June solstice
  and sideways at the equinoxes.
- Earth's rotation is the unique rotation that sends the local north pole to that axis
  and the point with the Sun overhead to −X.
- Times are entered in the city's local time using the browser's time-zone data
  (daylight saving included). Custom spots use a time zone rounded from their longitude.
- Sunrise/sunset: first time the Sun's centre is 0.833° below the horizon
  (allows for air bending the light and for the Sun's size), scanned over the local day.
