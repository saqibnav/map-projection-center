(async function () {
  // --- State ---
  let centerLon = 0;
  let centerLat = 0;
  let equatorLat = 0;
  let zoomLevel = 1;
  let projType = "mercator"; // "mercator" or "robinson"
  let land, borders, countries;

  // --- Country name lookup (ISO 3166-1 numeric → name) ---
  let countryNames = {};

  // --- DOM refs ---
  const canvas = document.getElementById("map-canvas");
  const ctx = canvas.getContext("2d");
  const equatorVal = document.getElementById("equator-val");
  const centerVal = document.getElementById("center-val");
  const cursorInfo = document.getElementById("cursor-info");
  const showGraticule = document.getElementById("show-graticule");
  const showEquator = document.getElementById("show-equator");
  const showTissot = document.getElementById("show-tissot");
  const showHeatmap = document.getElementById("show-heatmap");
  const resetBtn = document.getElementById("reset-btn");
  const projRadios = document.querySelectorAll('input[name="proj"]');

  // --- Sizing (full viewport) ---
  const dpr = window.devicePixelRatio || 1;
  let width, height;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- Projection ---
  function createProjection() {
    let base;
    if (projType === "robinson") {
      base = d3.geoRobinson()
        .rotate([-centerLon, -equatorLat, 0])
        .center([0, centerLat - equatorLat])
        .fitSize([width, height], { type: "Sphere" })
        .precision(0.1);
    } else {
      base = d3.geoMercator()
        .rotate([-centerLon, -equatorLat, 0])
        .center([0, centerLat - equatorLat])
        .fitSize([width, height], { type: "Sphere" })
        .precision(0.1);
    }

    base.scale(base.scale() * zoomLevel);
    return base.clipExtent([[0, 0], [width, height]]);
  }

  function getRotation() {
    return d3.geoRotation([-centerLon, -equatorLat, 0]);
  }

  // --- Distortion color scale ---
  const distortionColor = d3.scaleSequential(d3.interpolateRgbBasis([
    "#2196f3", "#4caf50", "#ffeb3b", "#ff9800", "#f44336"
  ])).domain([1, 3]);

  // --- Rendering ---
  let renderQueued = false;

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    if (!land) return;
    const projection = createProjection();
    const path = d3.geoPath(projection, ctx);

    // Dark background for non-map area
    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(0, 0, width, height);

    // 1. Ocean
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = "#4da8c4";
    ctx.fill();

    // 1b. Main map heatmap
    if (showHeatmap.checked) {
      drawMainHeatmap(projection);
    }

    // 2. Land
    ctx.beginPath();
    path(land);
    ctx.fillStyle = showHeatmap.checked ? "rgba(212, 223, 194, 0.45)" : "#d4dfc2";
    ctx.fill();

    // 3. Borders
    ctx.beginPath();
    path(borders);
    ctx.strokeStyle = "#7a8a6a";
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 4. Graticule
    if (showGraticule.checked) {
      ctx.beginPath();
      path(d3.geoGraticule10());
      ctx.strokeStyle = "rgba(0, 0, 0, 0.07)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // 5. Great circle equator (Mercator only)
    if (showEquator.checked && projType === "mercator") {
      drawGreatCircle(projection, path);
    }

    // 6. Tissot indicatrices
    if (showTissot.checked) {
      drawTissot(projection, path);
    }

    // 7. Country labels
    drawCountryLabels(projection, path);

    // 8. Mini globe (with heatmap always shown)
    drawGlobe();
  }

  // --- Mini globe ---
  function drawGlobe() {
    const size = Math.min(width, height) * 0.30;
    const radius = size / 2;
    const padding = 16;
    const cx = width - padding - radius;
    const cy = height - padding - radius;

    const globeProj = d3.geoOrthographic()
      .rotate([-centerLon, -centerLat, 0])
      .translate([cx, cy])
      .scale(radius - 2)
      .clipAngle(90)
      .precision(0.5);
    const globePath = d3.geoPath(globeProj, ctx);

    // Shadow + white backing
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.2)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();

    // Ocean
    ctx.beginPath();
    globePath({ type: "Sphere" });
    ctx.fillStyle = "#b8dee6";
    ctx.fill();

    // Heatmap on globe
    drawGlobeHeatmap(globeProj, cx, cy, radius);

    // Land (semi-transparent over heatmap)
    ctx.beginPath();
    globePath(land);
    ctx.fillStyle = "rgba(212, 223, 194, 0.5)";
    ctx.fill();
    ctx.strokeStyle = "#7a8a6a";
    ctx.lineWidth = 0.3;
    ctx.stroke();

    // Great circle
    const rotate = getRotation();
    const points = [];
    for (let lon = -180; lon <= 180; lon += 1) {
      points.push(rotate.invert([lon, 0]));
    }
    points.push(points[0]);
    ctx.beginPath();
    globePath({ type: "LineString", coordinates: points });
    ctx.strokeStyle = "#c0392b";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Border
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, 2 * Math.PI);
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Heatmap legend above globe
    const legendW = radius * 1.6;
    const legendH = 10;
    const legendX = cx - legendW / 2;
    const legendY = cy - radius - 30;

    // Gradient bar
    const grad = ctx.createLinearGradient(legendX, 0, legendX + legendW, 0);
    grad.addColorStop(0, "#2196f3");
    grad.addColorStop(0.25, "#4caf50");
    grad.addColorStop(0.5, "#ffeb3b");
    grad.addColorStop(0.75, "#ff9800");
    grad.addColorStop(1, "#f44336");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(legendX, legendY, legendW, legendH, 3);
    ctx.fill();

    // Labels
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("1\u00d7", legendX, legendY - 3);
    ctx.textAlign = "right";
    ctx.fillText("3\u00d7+", legendX + legendW, legendY - 3);
    ctx.textAlign = "center";
    ctx.fillText("Scale factor", cx, legendY - 14);
  }

  // --- Globe heatmap (always shown) ---
  const offscreen = document.createElement("canvas");
  const offCtx = offscreen.getContext("2d");

  function drawGlobeHeatmap(globeProj, cx, cy, radius) {
    const step = 2;
    const r = Math.ceil(radius);
    const size = r * 2;
    offscreen.width = size;
    offscreen.height = size;

    const imageData = offCtx.createImageData(size, size);
    const data = imageData.data;
    const rotate = getRotation();
    const r2 = r * r;

    for (let py = 0; py < size; py += step) {
      for (let px = 0; px < size; px += step) {
        const sx = px - r;
        const sy = py - r;
        if (sx * sx + sy * sy > r2) continue;

        const lonlat = globeProj.invert([cx - r + px, cy - r + py]);
        if (!lonlat || isNaN(lonlat[0])) continue;

        const rotated = rotate(lonlat);
        const latRad = rotated[1] * Math.PI / 180;
        const cosLat = Math.cos(latRad);
        if (Math.abs(cosLat) < 0.01) continue;
        const k = 1 / Math.abs(cosLat);

        const color = d3.rgb(distortionColor(Math.min(k, 3)));

        for (let dy = 0; dy < step && (py + dy) < size; dy++) {
          for (let dx = 0; dx < step && (px + dx) < size; dx++) {
            const i = ((py + dy) * size + (px + dx)) * 4;
            data[i] = color.r;
            data[i + 1] = color.g;
            data[i + 2] = color.b;
            data[i + 3] = 140;
          }
        }
      }
    }
    offCtx.putImageData(imageData, 0, 0);

    // Draw the offscreen heatmap onto the main canvas clipped to globe
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(offscreen, cx - r, cy - r);
    ctx.restore();
  }

  // --- Main map heatmap ---
  const mainOffscreen = document.createElement("canvas");
  const mainOffCtx = mainOffscreen.getContext("2d");

  function drawMainHeatmap(projection) {
    const step = 3;
    mainOffscreen.width = width;
    mainOffscreen.height = height;

    const imageData = mainOffCtx.createImageData(width, height);
    const data = imageData.data;
    const rotate = getRotation();

    for (let py = 0; py < height; py += step) {
      for (let px = 0; px < width; px += step) {
        const lonlat = projection.invert([px, py]);
        if (!lonlat || isNaN(lonlat[0])) continue;

        const rotated = rotate(lonlat);
        const latRad = rotated[1] * Math.PI / 180;
        const cosLat = Math.cos(latRad);
        if (Math.abs(cosLat) < 0.01) continue;
        const k = 1 / Math.abs(cosLat);

        const color = d3.rgb(distortionColor(Math.min(k, 3)));

        for (let dy = 0; dy < step && (py + dy) < height; dy++) {
          for (let dx = 0; dx < step && (px + dx) < width; dx++) {
            const i = ((py + dy) * width + (px + dx)) * 4;
            data[i] = color.r;
            data[i + 1] = color.g;
            data[i + 2] = color.b;
            data[i + 3] = 140;
          }
        }
      }
    }
    mainOffCtx.putImageData(imageData, 0, 0);

    ctx.save();
    ctx.beginPath();
    d3.geoPath(projection, ctx)({ type: "Sphere" });
    ctx.clip();
    ctx.drawImage(mainOffscreen, 0, 0);
    ctx.restore();
  }

  // --- Great circle ---
  function drawGreatCircle(projection, path) {
    const rotate = getRotation();
    const points = [];
    for (let lon = -180; lon <= 180; lon += 0.5) {
      points.push(rotate.invert([lon, 0]));
    }
    points.push(points[0]);

    ctx.beginPath();
    path({ type: "LineString", coordinates: points });
    ctx.strokeStyle = "#c0392b";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // --- Tissot indicatrices ---
  function drawTissot(projection, path) {
    const circle = d3.geoCircle().precision(1).radius(2.5);
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -80; lat <= 80; lat += 20) {
        circle.center([lon, lat]);
        ctx.beginPath();
        path(circle());
        ctx.fillStyle = "rgba(192, 57, 43, 0.2)";
        ctx.fill();
        ctx.strokeStyle = "rgba(192, 57, 43, 0.5)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  // --- Country labels ---
  function drawCountryLabels(projection, path) {
    if (!countries) return;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const margin = 10;

    for (const country of countries.features) {
      const name = countryNames[country.id] || "";
      if (!name) continue;

      const geoCentroid = d3.geoCentroid(country);
      const projected = projection(geoCentroid);
      if (!projected || isNaN(projected[0])) continue;

      const [px, py] = projected;

      if (px < margin || px > width - margin || py < margin || py > height - margin) continue;

      // Check that the path centroid agrees with the geographic centroid
      const pathCentroid = path.centroid(country);
      if (!pathCentroid || isNaN(pathCentroid[0])) continue;
      const dist = Math.hypot(px - pathCentroid[0], py - pathCentroid[1]);
      if (dist > 50) continue;

      const bounds = path.bounds(country);
      if (!bounds || !isFinite(bounds[0][0])) continue;
      const bw = bounds[1][0] - bounds[0][0];
      const bh = bounds[1][1] - bounds[0][1];
      if (bw <= 0 || bh <= 0) continue;

      const minDim = Math.min(bw, bh);
      const maxDim = Math.max(bw, bh);
      let fontSize = Math.min(minDim * 0.35, maxDim * 0.12);

      if (fontSize < 8) continue;
      fontSize = Math.min(fontSize, 11);

      ctx.font = `400 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      const metrics = ctx.measureText(name);

      if (metrics.width > bw * 0.95) continue;

      ctx.fillStyle = "rgba(50, 50, 50, 0.7)";
      ctx.fillText(name, px, py);
    }
  }

  // --- Format coordinates ---
  function formatCoord(lon, lat) {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(1)}\u00b0${ns}, ${Math.abs(lon).toFixed(1)}\u00b0${ew}`;
  }

  // --- Event handlers ---
  function updateLabels() {
    equatorVal.textContent = equatorLat.toFixed(1);
    centerVal.textContent = centerLon.toFixed(1);
  }

  // --- Drag: left = pan longitude, right = tilt equator latitude ---
  let dragMode = null;
  let dragStartX, dragStartY;
  let dragStartLon, dragStartEquatorLat;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) dragMode = "pan";
    else if (e.button === 2) dragMode = "tilt";
    else return;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLon = centerLon;
    dragStartEquatorLat = equatorLat;
    canvas.style.cursor = dragMode === "pan" ? "ew-resize" : "ns-resize";
    e.preventDefault();
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("mousemove", (e) => {
    const x = e.clientX;
    const y = e.clientY;

    if (dragMode) {
      const dx = x - dragStartX;
      const dy = y - dragStartY;

      if (dragMode === "pan") {
        const degPerPixelX = 360 / (width * zoomLevel);
        centerLon = dragStartLon - dx * degPerPixelX;
      } else {
        const degPerPixelY = 170 / (height * zoomLevel);
        equatorLat = Math.max(-85, Math.min(85, dragStartEquatorLat + dy * degPerPixelY));
        centerLat = equatorLat;
      }

      updateLabels();
      queueRender();
      return;
    }

    // Hover info
    const projection = createProjection();
    const lonlat = projection.invert([x, y]);
    if (!lonlat || isNaN(lonlat[0])) {
      cursorInfo.textContent = "\u2014";
      return;
    }
    let info = formatCoord(lonlat[0], lonlat[1]);
    if (projType === "mercator") {
      const rotate = getRotation();
      const rotated = rotate(lonlat);
      const latRad = rotated[1] * Math.PI / 180;
      const cosLat = Math.cos(latRad);
      const k = Math.abs(cosLat) < 0.01 ? Infinity : (1 / Math.abs(cosLat));
      const kStr = k === Infinity ? "\u221e" : k.toFixed(2) + "\u00d7";
      info += `  k=${kStr}`;
    }
    cursorInfo.textContent = info;
  });

  window.addEventListener("mouseup", () => {
    if (dragMode) {
      dragMode = null;
      canvas.style.cursor = "default";
    }
  });

  // --- Scroll wheel zoom (min 1x) ---
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevel = Math.max(1, Math.min(50, zoomLevel * zoomFactor));
    queueRender();
  }, { passive: false });

  // --- Reset ---
  resetBtn.addEventListener("click", () => {
    centerLon = 0;
    centerLat = 0;
    equatorLat = 0;
    zoomLevel = 1;
    updateLabels();
    queueRender();
  });

  // --- Projection toggle ---
  projRadios.forEach((r) => {
    r.addEventListener("change", (e) => {
      projType = e.target.value;
      updateLabels();
      queueRender();
    });
  });

  [showGraticule, showEquator, showTissot, showHeatmap].forEach((cb) => {
    cb.addEventListener("change", () => {
      queueRender();
    });
  });

  window.addEventListener("resize", () => {
    resize();
    queueRender();
  });

  // --- Init ---
  resize();

  const world = await d3.json(
    "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
  );

  land = topojson.feature(world, world.objects.land);
  borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  countries = topojson.feature(world, world.objects.countries);

  // Load country names (non-blocking — labels just won't show if this fails)
  try {
    const namesResp = await d3.tsv(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.tsv"
    );
    for (const row of namesResp) {
      countryNames[row.id] = row.name;
    }
  } catch (e) {
    for (const f of countries.features) {
      if (f.properties && f.properties.name) {
        countryNames[f.id] = f.properties.name;
      }
    }
  }

  render();
})();
