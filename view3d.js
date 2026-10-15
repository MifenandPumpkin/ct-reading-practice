// 3D 檢視（可轉、可縮放）：牙齒實色、骨頭半透明可開關、上下顎分開、側面只畫靠近那一側、牙號引線不重疊。
// 滑鼠（全系統統一，照 Slicer）：右鍵拖曳＝旋轉（自由、不鎖方向、放開不滑動）、中鍵拖曳＝平移、滾輪＝往游標位置縮放。
// 筆電觸控板：左鍵拖曳也可旋轉，Shift＋左鍵拖曳＝平移。手機：單指旋轉、雙指縮放。
// 骨頭閾值滑桿：case.mesh.vol（每顎一份降採樣 CT，uint8＝(HU-lo)/sc，0＝範圍外）存在時出現；在瀏覽器裡用表面網重建骨面，預設＝原本的骨面。
// 需要 three.js r128（全域 THREE）。資料：case.mesh = {unit, objs:[{k:'t'|'b'|'c', fdi, jaw, v:b64 int16, f:b64 uint16}], vol?:[{jaw,o,sv,n,lo,sc,d,rle,q}]}
(function () {
  const PAL = [0xf0a050, 0x55c8e6], BONE = 0xe8dcc0, CANAL = 0xe04848, OPEN_MM = 9, THR_MIN_HU = 150; // 低於這個 HU 會把軟組織一起長成方盒（10-15 自評）
  let R = null; // 單一 renderer，重複使用
  // 表面網（surface nets）：在 uint8 體積上找 iso 等值面，每個跨越的格子放一個頂點（12 條邊交點平均），每條跨越的邊出一個四邊形。
  // q：x 最快、再 y、再 z；回傳格點座標（體素單位）的頂點與三角形索引。
  function snets(q, nx, ny, nz, iso) {
    const cx = nx - 1, cy = ny - 1, cz = nz - 1, cid = new Int32Array(cx * cy * cz).fill(-1);
    const P = [], sxy = nx * ny;
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const g = new Float32Array(8);
    let nv = 0;
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) {
      const row = k * sxy + j * nx;
      for (let i = 0; i < cx; i++) {
        const b = row + i;
        g[0] = q[b]; g[1] = q[b + 1]; g[2] = q[b + nx]; g[3] = q[b + nx + 1];
        g[4] = q[b + sxy]; g[5] = q[b + sxy + 1]; g[6] = q[b + sxy + nx]; g[7] = q[b + sxy + nx + 1];
        let m = 0; for (let c = 0; c < 8; c++) if (g[c] >= iso) m |= 1 << c;
        if (m === 0 || m === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = E[e][0], c = E[e][1], ia = (m >> a) & 1, ic = (m >> c) & 1; if (ia === ic) continue;
          const t = (iso - g[a]) / (g[c] - g[a]), A = CO[a], C = CO[c];
          sx += A[0] + t * (C[0] - A[0]); sy += A[1] + t * (C[1] - A[1]); sz += A[2] + t * (C[2] - A[2]); n++;
        }
        cid[(k * cy + j) * cx + i] = nv++; P.push(i + sx / n, j + sy / n, k + sz / n);
      }
    }
    const F = [], C = (i, j, k) => cid[(k * cy + j) * cx + i];
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) F.push(a, c, b, a, d, c); else F.push(a, b, c, a, c, d); };
    for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) {
      const row = k * sxy + j * nx;
      for (let i = 1; i < cx; i++) {
        const v0 = q[row + i] >= iso;
        if (v0 !== (q[row + i + 1] >= iso)) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), !v0);
        if (v0 !== (q[row + i + nx] >= iso)) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1), !v0);
        if (v0 !== (q[row + i + sxy] >= iso)) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), !v0);
      }
    }
    return { p: new Float32Array(P), f: new Uint32Array(F) };
  }
  function smooth(p, f, it) { // 鄰點平均（每條邊雙向），讓表面網的階梯變平順
    const n = p.length / 3, s = new Float32Array(p.length), c = new Uint16Array(n);
    for (let t = 0; t < it; t++) {
      s.fill(0); c.fill(0);
      for (let i = 0; i < f.length; i += 3) for (let e = 0; e < 3; e++) { const a = f[i + e], b = f[i + (e + 1) % 3];
        s[a * 3] += p[b * 3]; s[a * 3 + 1] += p[b * 3 + 1]; s[a * 3 + 2] += p[b * 3 + 2]; c[a]++;
        s[b * 3] += p[a * 3]; s[b * 3 + 1] += p[a * 3 + 1]; s[b * 3 + 2] += p[a * 3 + 2]; c[b]++; }
      for (let i = 0; i < n; i++) if (c[i]) { const k = 0.5 / c[i]; p[i * 3] = p[i * 3] * 0.5 + s[i * 3] * k; p[i * 3 + 1] = p[i * 3 + 1] * 0.5 + s[i * 3 + 1] * k; p[i * 3 + 2] = p[i * 3 + 2] * 0.5 + s[i * 3 + 2] * k; }
    }
  }
  function unrle(b) { // 0, n = n 個 0
    let n = 0; for (let i = 0; i < b.length; i++) { if (b[i] === 0) { n += b[i + 1]; i++; } else n++; }
    const o = new Uint8Array(n); let p = 0;
    for (let i = 0; i < b.length; i++) { if (b[i] === 0) { p += b[i + 1]; i++; } else o[p++] = b[i]; }
    return o;
  }
  function b64(s, T) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); }
  function make() {
    const el = document.createElement("div"); el.className = "v3d";
    el.innerHTML = `<div class="v3bar">
      <span class="grp"><button data-jaw="1">上顎</button><button data-jaw="2">下顎</button><button data-jaw="0">上下都看</button></span>
      <span class="grp"><button data-view="front">正面</button><button data-view="right">右側</button><button data-view="left">左側</button><button data-view="occ">咬合面</button></span>
      <label class="chk"><input type="checkbox" data-bone checked> 骨頭（半透明）</label>
      <span class="thr" hidden>骨頭閾值 <input type="range" data-thr min="-400" max="900" step="10" value="0"><b data-thrv></b><button data-thr0>還原</button></span>
      <label class="chk"><input type="checkbox" data-lab checked> 牙號</label>
      <span class="hint">右鍵拖曳旋轉・中鍵拖曳平移・滾輪往游標縮放</span></div>
      <div class="v3stage"><canvas></canvas><svg class="v3lines"></svg><div class="v3labs"></div></div>`;
    const cv = el.querySelector("canvas"), renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setClearColor(0x0d1117);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 1, 3000), model = new THREE.Group(); scene.add(model);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.75); cam.add(key); key.position.set(0.4, 0.6, 1); scene.add(cam);
    R = { el, renderer, scene, cam, model, cv, objs: [], jaw: 1, view: "front", bone: true, lab: true, dist: 220, pan: new THREE.Vector3(), caseId: null };
    bindUI(); bindMouse(); new ResizeObserver(() => draw()).observe(el.querySelector(".v3stage"));
    return R;
  }
  function load(mesh) {
    R.model.clear(); R.objs = [];
    const u = mesh.unit || 0.05;
    for (const o of mesh.objs) {
      const v = b64(o.v, Int16Array), f = b64(o.f, Uint16Array), g = new THREE.BufferGeometry(), p = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 3) { p[i] = v[i] * u; p[i + 1] = v[i + 2] * u; p[i + 2] = -v[i + 1] * u; } // LPS -> 畫面 X=x, Y=z(上), Z=-y(前)：正面看時病人右邊在畫面左邊
      g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setIndex(new THREE.BufferAttribute(f, 1)); g.computeVertexNormals();
      let mat;
      if (o.k === "t") mat = new THREE.MeshPhongMaterial({ color: PAL[(o.fdi % 10) % 2], shininess: 40, specular: 0x333333 });
      else if (o.k === "b") mat = new THREE.MeshPhongMaterial({ color: BONE, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, shininess: 10 });
      else mat = new THREE.MeshPhongMaterial({ color: CANAL, shininess: 20 });
      const m = new THREE.Mesh(g, mat); if (o.k === "b") m.renderOrder = 2;
      g.computeBoundingBox(); const c = new THREE.Vector3(); g.boundingBox.getCenter(c);
      let anchor = c.clone();
      if (o.k === "t") { // 牙冠尖端：上顎取最下方 15%，下顎取最上方 15%
        const ys = []; for (let i = 1; i < p.length; i += 3) ys.push(p[i]); ys.sort((a, b) => a - b);
        const thr = o.jaw === 1 ? ys[Math.floor(ys.length * 0.15)] : ys[Math.floor(ys.length * 0.85)];
        let sx = 0, sy = 0, sz = 0, n = 0; for (let i = 0; i < p.length; i += 3) { const y = p[i + 1]; if (o.jaw === 1 ? y <= thr : y >= thr) { sx += p[i]; sy += y; sz += p[i + 2]; n++; } }
        if (n) anchor.set(sx / n, sy / n, sz / n);
        const thr2 = o.jaw === 1 ? ys[Math.floor(ys.length * 0.95)] : ys[Math.floor(ys.length * 0.05)]; let ax = 0, ay = 0, az = 0, m2 = 0;
        for (let i = 0; i < p.length; i += 3) { const y = p[i + 1]; if (o.jaw === 1 ? y >= thr2 : y <= thr2) { ax += p[i]; ay += y; az += p[i + 2]; m2++; } }
        var apex = m2 ? new THREE.Vector3(ax / m2, ay / m2, az / m2) : c.clone();
      }
      R.model.add(m); R.objs.push({ o, m, c, anchor, apex: (o.k === "t" ? apex : c) });
    }
    // 牙弓中心（畫引線往外推的方向用）
    const t = R.objs.filter(x => x.o.k === "t"); const ac = new THREE.Vector3(); t.forEach(x => ac.add(x.c)); if (t.length) ac.divideScalar(t.length); R.arch = ac;
    R.objs.forEach(x => { x.base = x.m.position.clone(); x.g0 = x.m.geometry; });
    R.vol = {}; R.delta = { 1: 0, 2: 0 };
    for (const v of mesh.vol || []) { const raw = b64(v.q, Uint8Array); R.vol[v.jaw] = Object.assign({}, v, { q: v.rle ? unrle(raw) : raw }); }
    thrUI();
  }
  function rebuildBone(jaw) { // 依閾值重建這一顎的骨面；差值 0 用原本的平滑骨面
    const x = R.objs.find(y => y.o.k === "b" && y.o.jaw === jaw), v = R.vol[jaw]; if (!x || !v) return;
    if (x.m.geometry !== x.g0) x.m.geometry.dispose();
    if (!R.delta[jaw]) { x.m.geometry = x.g0; return; }
    const iso = Math.max(1.5, (v.d + R.delta[jaw] - v.lo) / v.sc), r = snets(v.q, v.n[0], v.n[1], v.n[2], iso), p = r.p;
    smooth(p, r.f, 2);
    for (let i = 0; i < p.length; i += 3) { const X = v.o[0] + p[i] * v.sv[0], Y = v.o[1] + p[i + 1] * v.sv[1], Z = v.o[2] + p[i + 2] * v.sv[2]; p[i] = X; p[i + 1] = Z; p[i + 2] = -Y; } // LPS -> 畫面（同 load）
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setIndex(new THREE.BufferAttribute(r.f, 1));
    g.computeVertexNormals(); g.computeBoundingBox(); x.m.geometry = g;
  }
  function thrJaws() { return R.jaw === 0 ? [1, 2] : [R.jaw]; }
  function thrUI() { // 滑桿顯示目前看的那一顎（上下都看時兩顎一起動）
    const box = R.el.querySelector(".thr"), has = Object.keys(R.vol).length > 0; box.hidden = !(has && R.bone); if (!has) return;
    const js = thrJaws().filter(j => R.vol[j]); if (!js.length) { box.hidden = true; return; }
    const sl = R.el.querySelector("[data-thr]"), dmin = Math.min(...js.map(j => R.vol[j].d));
    sl.min = Math.max(-400, Math.ceil((THR_MIN_HU - dmin) / 10) * 10);   // 絕對值不低於 THR_MIN_HU
    sl.value = R.delta[js[0]];
    R.el.querySelector("[data-thrv]").textContent = js.map(j => (js.length > 1 ? (j === 1 ? "上 " : "下 ") : "") + (R.vol[j].d + R.delta[j]) + " HU").join("／");
  }
  function layout() {
    for (const x of R.objs) {
      const j = x.o.jaw; let vis = R.jaw === 0 || R.jaw === j;
      if (x.o.k === "b") vis = vis && R.bone;
      x.m.visible = vis;
      const dy = R.jaw === 0 ? (j === 1 ? OPEN_MM : -OPEN_MM) : 0; x.m.position.set(0, dy, 0); x.off = dy;
    }
  }
  function camDirModel() { // 相機看的方向，轉到模型座標
    const d = new THREE.Vector3(); R.cam.getWorldDirection(d); const q = R.model.quaternion.clone().invert(); return d.applyQuaternion(q);
  }
  function nearSide() { // 側面時只畫靠近相機那一側的牙
    const d = camDirModel(); const side = (R.view === "right" || R.view === "left") && Math.abs(d.x) > 0.62 ? Math.sign(d.x) : 0; // 只在按「右側／左側」時 // d.x>0：相機往 +X 看 → 相機在 -X 那側
    for (const x of R.objs) if (x.o.k === "t") { const onCamSide = side === 0 || (side > 0 ? x.c.x < R.arch.x + 1 : x.c.x > R.arch.x - 1); x.m.visible = x.m.visible && onCamSide; x.hiddenSide = !onCamSide; }
  }
  const VIEWS = { front: [0, 0, 1], right: [1, 0, 0], left: [-1, 0, 0], occ: null };
  function setView(v) {
    R.view = v; R.pan.set(0, 0, 0); R.model.quaternion.identity();
    const q = new THREE.Quaternion();
    if (v === "right") q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);   // 病人右側（-X）轉向相機
    if (v === "left") q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    if (v === "occ") q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), R.jaw === 2 ? Math.PI / 2 : -Math.PI / 2);
    R.model.quaternion.copy(q); fit(); draw();
  }
  function fit() { // 以模型自身座標算（旋轉中心＝看得到的牙齒中心）
    layout(); const box = new THREE.Box3(), add = x => { const b = x.m.geometry.boundingBox.clone(); b.translate(x.m.position); box.union(b); };
    R.objs.forEach(x => { if (x.m.visible && x.o.k === "t") add(x); }); if (box.isEmpty()) R.objs.forEach(x => { if (x.m.visible) add(x); });
    const s = new THREE.Vector3(); box.getSize(s); const c = new THREE.Vector3(); box.getCenter(c);
    R.center = c; R.dist = Math.max(60, Math.max(s.x, s.y, s.z) * (R.jaw === 0 ? 2.8 : 2.5));
  }
  function draw() {
    if (!R) return; const st = R.el.querySelector(".v3stage"), w = st.clientWidth, h = st.clientHeight; if (!w || !h) return;
    R.renderer.setSize(w, h, false); R.cam.aspect = w / h; R.cam.updateProjectionMatrix();
    layout(); nearSide();
    const c = (R.center || new THREE.Vector3()).clone().add(R.pan);
    R.model.position.set(0, 0, 0); R.model.updateMatrixWorld();
    R.cam.position.set(c.x, c.y, c.z + R.dist); R.cam.up.set(0, 1, 0); R.cam.lookAt(c);
    // 以中心旋轉：把模型繞 center 轉
    R.model.position.copy(R.center ? R.center.clone().sub(R.center.clone().applyQuaternion(R.model.quaternion)) : new THREE.Vector3());
    R.renderer.render(R.scene, R.cam); labels(w, h);
  }
  function labels(w, h) {
    const box = R.el.querySelector(".v3labs"), svg = R.el.querySelector(".v3lines"); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    if (!R.lab) { box.innerHTML = ""; svg.innerHTML = ""; return; }
    const W = 26, H = 18, G = 3, L = [];
    const proj = v => { const s = R.model.localToWorld(v).project(R.cam); return { x: (s.x + 1) / 2 * w, y: (1 - s.y) / 2 * h, z: s.z }; };
    if (R.view === "occ" || Math.abs(camDirModel().y) > 0.55) { // 咬合面（或從上下方斜看）：沿牙弓往外推（放射狀）
      const ac = proj(R.arch.clone());
      for (const x of R.objs) { if (x.o.k !== "t" || !x.m.visible) continue; const a = x.anchor.clone(); a.y += x.off || 0; const s = proj(a); if (s.z > 1) continue;
        let dx = s.x - ac.x, dy = s.y - ac.y; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n; L.push({ f: x.o.fdi, px: s.x, py: s.y, dx, dy, lx: s.x + dx * 30, ly: s.y + dy * 30 }); }
      for (let it = 0; it < 80; it++) { let moved = false;
        for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j], ox = W + G - Math.abs(a.lx - b.lx), oy = H + G - Math.abs(a.ly - b.ly);
          if (ox > 0 && oy > 0) { moved = true; a.lx += a.dx * 2; a.ly += a.dy * 2; b.lx += b.dx * 2; b.ly += b.dy * 2; } }
        if (!moved) break; }
    } else { // 正面／側面／自由角度：上顎一排標在牙根上方、下顎一排在牙根下方，左右排開不重疊、引線不交錯
      for (const jaw of [1, 2]) {
        const T = [];
        for (const x of R.objs) { if (x.o.k !== "t" || !x.m.visible || x.o.jaw !== jaw) continue;
          const a = x.apex.clone(); a.y += x.off || 0; const s = proj(a); if (s.z > 1) continue; T.push({ f: x.o.fdi, px: s.x, py: s.y }); }
        if (!T.length) continue;
        const rowY = jaw === 1 ? Math.min(...T.map(t => t.py)) - 22 : Math.max(...T.map(t => t.py)) + 22;
        // 照牙弓順序排（18→11→21→28／48→41→31→38），畫面方向由實際位置決定；排在牙齒範圍的正上／下方
        const key = f => { const q = Math.floor(f / 10), n = f % 10; return (q === 1 || q === 4) ? -n : n; };
        T.sort((a, b) => key(a.f) - key(b.f));
        const half = Math.floor(T.length / 2), m1 = T.slice(0, Math.max(1, half)).reduce((s, t) => s + t.px, 0) / Math.max(1, half), m2 = T.slice(half).reduce((s, t) => s + t.px, 0) / Math.max(1, T.length - half);
        if (m1 > m2) T.reverse();
        const lo = Math.min(...T.map(t => t.px)), hi = Math.max(...T.map(t => t.px)), need = T.length * (W + G) - G;
        const span = Math.max(need, hi - lo), start = (lo + hi) / 2 - span / 2 + W / 2, stp = T.length > 1 ? (span - W) / (T.length - 1) : 0;
        T.forEach((t, i) => t.lx = start + i * Math.max(W + G, stp));
        const over = T[T.length - 1].lx - (w - W / 2); if (over > 0) T.forEach(t => t.lx -= over);  // 超出右邊整排左移
        const lack = W / 2 - T[0].lx; if (lack > 0) T.forEach(t => t.lx += lack);
        T.forEach(t => L.push({ f: t.f, px: t.px, py: t.py, lx: t.lx, ly: Math.max(H / 2, Math.min(h - H / 2, rowY)) }));
      }
    }
    L.forEach(l => { l.lx = Math.max(W / 2, Math.min(w - W / 2, l.lx)); l.ly = Math.max(H / 2, Math.min(h - H / 2, l.ly)); });
    svg.innerHTML = L.map(l => `<line x1="${l.px.toFixed(1)}" y1="${l.py.toFixed(1)}" x2="${l.lx.toFixed(1)}" y2="${l.ly.toFixed(1)}"/><circle cx="${l.px.toFixed(1)}" cy="${l.py.toFixed(1)}" r="2"/>`).join("");
    box.innerHTML = L.map(l => `<span style="left:${(l.lx - W / 2).toFixed(1)}px;top:${(l.ly - H / 2).toFixed(1)}px">${l.f}</span>`).join("");
  }
  function bindUI() {
    const el = R.el;
    el.querySelectorAll("[data-jaw]").forEach(b => b.onclick = () => { R.jaw = +b.dataset.jaw; mark(); thrUI(); layout(); fit(); setView(R.view === "occ" ? "occ" : R.view); });
    el.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { setView(b.dataset.view); mark(); });
    el.querySelector("[data-bone]").onchange = e => { R.bone = e.target.checked; thrUI(); draw(); };
    let pend = false;
    const setThr = d => { for (const j of thrJaws()) if (R.vol[j] && R.delta[j] !== d) { R.delta[j] = d; rebuildBone(j); } thrUI(); draw(); };
    el.querySelector("[data-thr]").oninput = e => { const d = +e.target.value; if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; setThr(+el.querySelector("[data-thr]").value); }); };
    el.querySelector("[data-thr0]").onclick = () => setThr(0);
    el.querySelector("[data-lab]").onchange = e => { R.lab = e.target.checked; draw(); };
  }
  function mark() { R.el.querySelectorAll("[data-jaw]").forEach(b => { b.classList.toggle("on", +b.dataset.jaw === R.jaw); const j = +b.dataset.jaw; b.disabled = j > 0 && !R.objs.some(x => x.o.k === "t" && x.o.jaw === j); b.title = b.disabled ? "這一例的影像沒有拍到這一顎的牙" : ""; }); R.el.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === R.view)); }
  function rotate(dx, dy) { // 自由旋轉（trackball）：拖曳方向的垂直軸，以畫面座標
    const ang = Math.hypot(dx, dy) * 0.008; if (!ang) return;
    const axis = new THREE.Vector3(dy, dx, 0).normalize(); const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    R.model.quaternion.premultiply(q); R.view = "free"; mark(); draw();
  }
  function bindMouse() {
    const st = R.el.querySelector(".v3stage"); let mode = null, lx = 0, ly = 0, pinch = 0;
    st.addEventListener("contextmenu", e => e.preventDefault());
    st.addEventListener("pointerdown", e => { st.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY;
      mode = e.button === 2 ? "rot" : e.button === 1 ? "pan" : (e.shiftKey ? "pan" : "rot"); if (e.button === 1) e.preventDefault(); });
    st.addEventListener("pointermove", e => { if (!mode) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (mode === "rot") rotate(dx, dy); else { const k = R.dist / st.clientHeight * 0.55; R.pan.x -= dx * k; R.pan.y += dy * k; draw(); } });
    const up = () => { mode = null; }; st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
    st.addEventListener("wheel", e => { e.preventDefault(); // 往游標位置縮放（全系統統一，Jethro 10-14 決定，同 3Shape）
      const r = st.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2;
      const old = R.dist; R.dist = Math.max(25, Math.min(900, R.dist * Math.exp(Math.sign(e.deltaY) * 0.12))); const k = R.dist / old;
      const t = Math.tan(R.cam.fov * Math.PI / 360) * old; R.pan.x += (1 - k) * nx * t * R.cam.aspect; R.pan.y += (1 - k) * ny * t; draw(); }, { passive: false });
    st.addEventListener("touchmove", e => { if (e.touches.length === 2) { e.preventDefault(); const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (pinch) { R.dist *= pinch / d; R.dist = Math.max(25, Math.min(900, R.dist)); draw(); } pinch = d; mode = null; } }, { passive: false });
    st.addEventListener("touchend", () => { pinch = 0; });
  }
  window.V3 = {
    mount(holder, caseId, mesh) {
      if (!window.THREE || !mesh) { holder.innerHTML = '<div class="mu">這一例沒有 3D 資料。</div>'; return; }
      if (!R) make();
      holder.appendChild(R.el);
      if (R.caseId !== caseId) { R.caseId = caseId; load(mesh); R.jaw = 1; R.bone = true; R.el.querySelector("[data-bone]").checked = true; thrUI(); layout(); fit(); setView("front"); mark(); }
      else draw();
    }
  };
})();
