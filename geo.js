// geo.js — Minimal map projection library (no dependencies)
const Geo = (function () {
  const PI = Math.PI, TAU = 2 * PI, HP = PI / 2;
  const D2R = PI / 180, R2D = 180 / PI;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ==================== Rotation ====================
  // 3-axis spherical rotation: Rz(λ) · Ry(φ) · Rz(γ)
  function createRotation(lambdaDeg, phiDeg, gammaDeg) {
    const l = (lambdaDeg || 0) * D2R, p = (phiDeg || 0) * D2R, g = (gammaDeg || 0) * D2R;
    const cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
    const cg = Math.cos(g), sg = Math.sin(g);

    function apply(lon, lat, cl_, sl_, cp_, sp_, cg_, sg_) {
      const lr = lon * D2R, pr = lat * D2R;
      const cx = Math.cos(pr), sx = Math.sin(pr);
      let x = cx * Math.cos(lr), y = cx * Math.sin(lr), z = sx;
      let x1 = x * cl_ - y * sl_, y1 = x * sl_ + y * cl_;
      let x2 = x1 * cp_ + z * sp_, z2 = -x1 * sp_ + z * cp_;
      let x3 = x2 * cg_ - y1 * sg_, y3 = x2 * sg_ + y1 * cg_;
      return [Math.atan2(y3, x3) * R2D, Math.asin(clamp(z2, -1, 1)) * R2D];
    }

    function forward(lonlat) { return apply(lonlat[0], lonlat[1], cl, sl, cp, sp, cg, sg); }
    function inverse(lonlat) { return apply(lonlat[0], lonlat[1], cg, -sg, cp, -sp, cl, -sl); }
    // Inverse is: Rz(-γ) · Ry(-φ) · Rz(-λ)
    // which is the same structure with negated sin terms and reversed order

    forward.invert = inverse;
    return forward;
  }

  // Rotation inverse fix: the order is reversed, so we need separate logic
  // Actually, let me redo this properly. The inverse of Rz(λ)·Ry(φ)·Rz(γ) is Rz(-γ)·Ry(-φ)·Rz(-λ)
  // In the apply function, the first rotation uses (cl_, sl_), second (cp_, sp_), third (cg_, sg_)
  // For forward: Rz(λ) then Ry(φ) then Rz(γ) → (cl,sl), (cp,sp), (cg,sg)
  // For inverse: Rz(-γ) then Ry(-φ) then Rz(-λ) → (cg,-sg), (cp,-sp), (cl,-sl)
  // This is exactly what I have above. ✓

  // ==================== Raw Projections ====================

  const MERC_CLIP = 85.05 * D2R;
  function mercatorRaw(lam, phi) {
    phi = clamp(phi, -MERC_CLIP, MERC_CLIP);
    return [lam, Math.log(Math.tan(PI / 4 + phi / 2))];
  }
  function mercatorInv(x, y) {
    return [x, 2 * Math.atan(Math.exp(y)) - HP];
  }

  // Robinson lookup tables (every 5° from 0 to 90)
  const RB_X = [1, .9986, .9954, .99, .9822, .973, .96, .9427, .9216, .8962, .8679, .835, .7986, .7597, .7186, .6732, .6213, .5722, .5322];
  const RB_Y = [0, .062, .124, .186, .248, .31, .372, .434, .4958, .5571, .6176, .6769, .7346, .7903, .8435, .8936, .9394, .9761, 1];

  function robinsonRaw(lam, phi) {
    const d = Math.abs(phi * R2D), i = Math.min(Math.floor(d / 5), 17), t = (d - i * 5) / 5;
    return [0.8487 * lam * lerp(RB_X[i], RB_X[i + 1], t),
      (phi >= 0 ? 1 : -1) * 1.3523 * lerp(RB_Y[i], RB_Y[i + 1], t)];
  }
  function robinsonInv(x, y) {
    const ay = Math.abs(y) / 1.3523;
    let i = 0;
    for (; i < 17; i++) if (RB_Y[i + 1] >= ay) break;
    const t = (ay - RB_Y[i]) / (RB_Y[i + 1] - RB_Y[i] || 1);
    const phi = (i * 5 + t * 5) * D2R * (y >= 0 ? 1 : -1);
    const plen = lerp(RB_X[i], RB_X[i + 1], t);
    return [x / (0.8487 * (plen || 1)), phi];
  }

  function orthoRaw(lam, phi) {
    return [Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  }
  function orthoVis(lam, phi) { return Math.cos(phi) * Math.cos(lam) > -0.01; }
  function orthoInv(x, y) {
    const rho = Math.sqrt(x * x + y * y);
    if (rho > 1) return null;
    if (rho < 1e-10) return [0, 0];
    const c = Math.asin(rho), sc = Math.sin(c);
    return [Math.atan2(x * sc, rho * Math.cos(c)), Math.asin(y * sc / rho)];
  }

  // Sphere bounds (raw coordinate extents)
  const BOUNDS = {
    mercator: [TAU, TAU],            // x: [-π,π], y: [-π,π]
    robinson: [2 * 0.8487 * PI, 2 * 1.3523],
    orthographic: [2, 2]
  };

  // ==================== Projection Factory ====================

  function createProjection(type, cfg) {
    const rot = cfg.rotate || [0, 0, 0];
    const rotation = createRotation(rot[0], rot[1], rot[2]);
    const ctr = cfg.center || [0, 0];
    const zoom = cfg.zoom || 1;
    const clip = cfg.clipExtent;
    const [bw, bh] = BOUNDS[type];

    let rawFwd, rawInv;
    if (type === 'robinson') { rawFwd = robinsonRaw; rawInv = robinsonInv; }
    else if (type === 'orthographic') { rawFwd = orthoRaw; rawInv = orthoInv; }
    else { rawFwd = mercatorRaw; rawInv = mercatorInv; }

    let scale, tx, ty;
    if (cfg.manualScale) {
      scale = cfg.manualScale;
      tx = cfg.translate[0];
      ty = cfg.translate[1];
    } else {
      scale = Math.min(cfg.width / bw, cfg.height / bh) * zoom;
      tx = cfg.width / 2;
      ty = cfg.height / 2;
      if (ctr[0] !== 0 || ctr[1] !== 0) {
        const [cx, cy] = rawFwd(ctr[0] * D2R, ctr[1] * D2R);
        tx -= scale * cx;
        ty += scale * cy;
      }
    }

    function forward(lonlat) {
      if (!lonlat) return null;
      const r = rotation(lonlat);
      const rl = r[0] * D2R, rp = r[1] * D2R;
      if (type === 'orthographic' && !orthoVis(rl, rp)) return null;
      const [x, y] = rawFwd(rl, rp);
      const sx = tx + scale * x, sy = ty - scale * y;
      if (clip && (sx < clip[0][0] || sx > clip[1][0] || sy < clip[0][1] || sy > clip[1][1])) return null;
      return [sx, sy];
    }

    function inverse(xy) {
      if (!xy) return null;
      const x = (xy[0] - tx) / scale, y = -(xy[1] - ty) / scale;
      const raw = rawInv(x, y);
      if (!raw) return null;
      return rotation.invert([raw[0] * R2D, raw[1] * R2D]);
    }

    forward.invert = inverse;
    forward._p = { rotation, rawFwd, scale, tx, ty, type };
    return forward;
  }

  // ==================== Canvas Path Renderer ====================

  function createPath(projection, ctx) {
    const P = projection._p;
    const isOrtho = P.type === 'orthographic';

    function toCart(coord) {
      const r = P.rotation(coord);
      const lr = r[0] * D2R, pr = r[1] * D2R;
      const cp = Math.cos(pr);
      return { x: cp * Math.cos(lr), y: cp * Math.sin(lr), z: Math.sin(pr), vis: cp * Math.cos(lr) > -0.01 };
    }
    function cartScreen(c) { return [P.tx + P.scale * c.y, P.ty - P.scale * c.z]; }

    function horizonPt(vis, hid) {
      const t = vis.x / (vis.x - hid.x);
      if (t < 0 || t > 1) return null;
      const y = vis.y + t * (hid.y - vis.y), z = vis.z + t * (hid.z - vis.z);
      const len = Math.sqrt(y * y + z * z);
      return len < 1e-10 ? null : { x: 0, y: y / len, z: z / len };
    }

    function drawRingFlat(coords) {
      let started = false, px = 0;
      for (const c of coords) {
        const pt = projection(c);
        if (!pt) { started = false; continue; }
        if (started && Math.abs(pt[0] - px) > P.scale * PI) started = false;
        if (!started) { ctx.moveTo(pt[0], pt[1]); started = true; }
        else ctx.lineTo(pt[0], pt[1]);
        px = pt[0];
      }
    }

    function drawRingOrtho(coords) {
      let prev = null, started = false;
      for (const c of coords) {
        const curr = toCart(c);
        if (prev) {
          if (curr.vis && prev.vis) {
            const pt = cartScreen(curr);
            if (!started) { ctx.moveTo(pt[0], pt[1]); started = true; }
            else ctx.lineTo(pt[0], pt[1]);
          } else if (prev.vis && !curr.vis) {
            const hp = horizonPt(prev, curr);
            if (hp) { const pt = cartScreen(hp); started ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]); }
            started = false;
          } else if (!prev.vis && curr.vis) {
            const hp = horizonPt(curr, prev);
            if (hp) { const pt = cartScreen(hp); ctx.moveTo(pt[0], pt[1]); started = true; }
            const pt = cartScreen(curr);
            if (!started) { ctx.moveTo(pt[0], pt[1]); started = true; }
            else ctx.lineTo(pt[0], pt[1]);
          }
        } else if (curr.vis) {
          const pt = cartScreen(curr);
          ctx.moveTo(pt[0], pt[1]);
          started = true;
        }
        prev = curr;
      }
    }

    const drawRing = isOrtho ? drawRingOrtho : drawRingFlat;

    function renderSphere() {
      if (isOrtho) {
        ctx.arc(P.tx, P.ty, P.scale, 0, TAU);
      } else if (P.type === 'robinson') {
        let first = true;
        for (let lat = 90; lat >= -90; lat -= 2) {
          const [x, y] = robinsonRaw(PI, lat * D2R);
          const sx = P.tx + P.scale * x, sy = P.ty - P.scale * y;
          first ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy); first = false;
        }
        for (let lat = -90; lat <= 90; lat += 2) {
          const [x, y] = robinsonRaw(-PI, lat * D2R);
          ctx.lineTo(P.tx + P.scale * x, P.ty - P.scale * y);
        }
        ctx.closePath();
      } else {
        const s = P.scale * PI;
        ctx.rect(P.tx - s, P.ty - s, 2 * s, 2 * s);
      }
    }

    function render(geom) {
      if (!geom) return;
      switch (geom.type) {
        case 'Sphere': renderSphere(); break;
        case 'Feature': render(geom.geometry); break;
        case 'FeatureCollection': geom.features.forEach(render); break;
        case 'GeometryCollection': geom.geometries.forEach(render); break;
        case 'Polygon': geom.coordinates.forEach(drawRing); break;
        case 'MultiPolygon': geom.coordinates.forEach(p => p.forEach(drawRing)); break;
        case 'LineString': drawRing(geom.coordinates); break;
        case 'MultiLineString': geom.coordinates.forEach(drawRing); break;
      }
    }

    function visitCoords(geom, fn) {
      if (!geom) return;
      switch (geom.type) {
        case 'Feature': visitCoords(geom.geometry, fn); break;
        case 'FeatureCollection': geom.features.forEach(f => visitCoords(f, fn)); break;
        case 'GeometryCollection': geom.geometries.forEach(g => visitCoords(g, fn)); break;
        case 'Polygon': geom.coordinates.forEach(fn); break;
        case 'MultiPolygon': geom.coordinates.forEach(p => p.forEach(fn)); break;
        case 'LineString': fn(geom.coordinates); break;
        case 'MultiLineString': geom.coordinates.forEach(fn); break;
      }
    }

    render.bounds = function (geom) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      visitCoords(geom, coords => {
        for (const c of coords) {
          const pt = projection(c);
          if (!pt) continue;
          if (pt[0] < x0) x0 = pt[0]; if (pt[0] > x1) x1 = pt[0];
          if (pt[1] < y0) y0 = pt[1]; if (pt[1] > y1) y1 = pt[1];
        }
      });
      return [[x0, y0], [x1, y1]];
    };

    render.centroid = function (geom) {
      let sx = 0, sy = 0, n = 0;
      visitCoords(geom, coords => {
        for (const c of coords) {
          const pt = projection(c);
          if (!pt) continue;
          sx += pt[0]; sy += pt[1]; n++;
        }
      });
      return n > 0 ? [sx / n, sy / n] : [NaN, NaN];
    };

    return render;
  }

  // ==================== TopoJSON Decoder ====================

  function decodeArc(topo, idx) {
    const arc = topo.arcs[idx < 0 ? ~idx : idx];
    const s = topo.transform.scale, t = topo.transform.translate;
    const coords = [];
    let x = 0, y = 0;
    for (const [dx, dy] of arc) {
      x += dx; y += dy;
      coords.push([x * s[0] + t[0], y * s[1] + t[1]]);
    }
    if (idx < 0) coords.reverse();
    return coords;
  }

  function buildRing(topo, refs) {
    let out = [];
    for (const r of refs) {
      const a = decodeArc(topo, r);
      out = out.concat(out.length ? a.slice(1) : a);
    }
    return out;
  }

  function buildGeom(topo, obj) {
    switch (obj.type) {
      case 'Point': case 'MultiPoint': return obj;
      case 'LineString': return { type: 'LineString', coordinates: buildRing(topo, obj.arcs) };
      case 'MultiLineString': return { type: 'MultiLineString', coordinates: obj.arcs.map(a => buildRing(topo, a)) };
      case 'Polygon': return { type: 'Polygon', coordinates: obj.arcs.map(a => buildRing(topo, a)) };
      case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: obj.arcs.map(p => p.map(a => buildRing(topo, a))) };
      case 'GeometryCollection': return { type: 'GeometryCollection', geometries: obj.geometries.map(g => buildGeom(topo, g)) };
    }
  }

  function topoFeature(topo, obj) {
    if (obj.type === 'GeometryCollection') {
      return {
        type: 'FeatureCollection',
        features: obj.geometries.map(g => ({ type: 'Feature', id: g.id, properties: g.properties || {}, geometry: buildGeom(topo, g) }))
      };
    }
    return { type: 'Feature', id: obj.id, properties: obj.properties || {}, geometry: buildGeom(topo, obj) };
  }

  function topoMesh(topo, obj, filter) {
    const arcOwners = new Map();
    function track(geom, idx) {
      function add(refs) { for (const r of refs) { const k = r < 0 ? ~r : r; if (!arcOwners.has(k)) arcOwners.set(k, new Set()); arcOwners.get(k).add(idx); } }
      if (geom.type === 'Polygon') geom.arcs.forEach(add);
      else if (geom.type === 'MultiPolygon') geom.arcs.forEach(p => p.forEach(add));
    }
    const geoms = obj.geometries;
    geoms.forEach((g, i) => track(g, i));

    const lines = [];
    for (const [ai, owners] of arcOwners) {
      const ids = [...owners];
      if (filter) {
        if (ids.length >= 2) {
          let ok = false;
          for (let i = 0; i < ids.length && !ok; i++)
            for (let j = i + 1; j < ids.length && !ok; j++)
              if (filter(geoms[ids[i]], geoms[ids[j]])) ok = true;
          if (ok) lines.push(decodeArc(topo, ai));
        }
      } else {
        lines.push(decodeArc(topo, ai));
      }
    }
    return { type: 'MultiLineString', coordinates: lines };
  }

  // ==================== Geo Utilities ====================

  function geoCentroid(feature) {
    let x = 0, y = 0, z = 0, n = 0;
    function visit(geom) {
      if (!geom) return;
      switch (geom.type) {
        case 'Feature': visit(geom.geometry); break;
        case 'FeatureCollection': geom.features.forEach(visit); break;
        case 'Polygon': geom.coordinates.forEach(ring => { for (const c of ring) { add(c); } }); break;
        case 'MultiPolygon': geom.coordinates.forEach(p => p.forEach(ring => { for (const c of ring) add(c); })); break;
      }
    }
    function add(c) {
      const lr = c[0] * D2R, pr = c[1] * D2R, cp = Math.cos(pr);
      x += cp * Math.cos(lr); y += cp * Math.sin(lr); z += Math.sin(pr); n++;
    }
    visit(feature);
    if (!n) return [0, 0];
    const len = Math.sqrt(x * x + y * y + z * z);
    return len < 1e-10 ? [0, 0] : [Math.atan2(y, x) * R2D, Math.asin(clamp(z / len, -1, 1)) * R2D];
  }

  function geoGraticule10() {
    const lines = [];
    for (let lon = -180; lon <= 180; lon += 10) {
      const l = []; for (let lat = -90; lat <= 90; lat += 2) l.push([lon, lat]); lines.push(l);
    }
    for (let lat = -80; lat <= 80; lat += 10) {
      const l = []; for (let lon = -180; lon <= 180; lon += 2) l.push([lon, lat]); lines.push(l);
    }
    return { type: 'MultiLineString', coordinates: lines };
  }

  function geoCircle(center, radiusDeg, precisionDeg) {
    const prec = precisionDeg || 2;
    const [clon, clat] = center;
    const r = radiusDeg * D2R;
    const rp = (90 - clat) * D2R, rl = clon * D2R;
    const crp = Math.cos(rp), srp = Math.sin(rp), crl = Math.cos(rl), srl = Math.sin(rl);
    const pLat = HP - r, cpLat = Math.cos(pLat), spLat = Math.sin(pLat);
    const pts = [];
    for (let a = 0; a <= 360; a += prec) {
      const ar = a * D2R;
      let x = cpLat * Math.cos(ar), y = cpLat * Math.sin(ar), z = spLat;
      // Ry(rp)
      let x2 = x * crp + z * srp, y2 = y, z2 = -x * srp + z * crp;
      // Rz(rl)
      let x3 = x2 * crl - y2 * srl, y3 = x2 * srl + y2 * crl;
      pts.push([Math.atan2(y3, x3) * R2D, Math.asin(clamp(z2, -1, 1)) * R2D]);
    }
    return { type: 'Polygon', coordinates: [pts] };
  }

  // ==================== Data Loading ====================

  async function loadJson(url) { return (await fetch(url)).json(); }

  async function loadTsv(url) {
    const text = await (await fetch(url)).text();
    const lines = text.trim().split('\n');
    const hdr = lines[0].split('\t');
    return lines.slice(1).map(l => {
      const v = l.split('\t'), o = {};
      hdr.forEach((h, i) => o[h] = v[i]);
      return o;
    });
  }

  // ==================== Color ====================

  function parseHex(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }

  function createColorScale(hexes, domain) {
    const cols = hexes.map(parseHex), [lo, hi] = domain, n = cols.length - 1;
    return function (v) {
      const t = clamp((v - lo) / (hi - lo), 0, 1) * n;
      const i = Math.min(Math.floor(t), n - 1), f = t - i;
      return { r: Math.round(lerp(cols[i][0], cols[i + 1][0], f)), g: Math.round(lerp(cols[i][1], cols[i + 1][1], f)), b: Math.round(lerp(cols[i][2], cols[i + 1][2], f)) };
    };
  }

  // ==================== Public API ====================
  return {
    createRotation, createProjection, createPath,
    topoFeature, topoMesh,
    geoCentroid, geoGraticule10, geoCircle,
    loadJson, loadTsv, createColorScale
  };
})();
