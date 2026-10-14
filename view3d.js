// 3D 檢視（可轉、可縮放）：牙齒實色、骨頭半透明可開關、上下顎分開、側面只畫靠近那一側、牙號引線不重疊。
// 滑鼠（全系統統一，照 Slicer）：右鍵拖曳＝旋轉（自由、不鎖方向、放開不滑動）、中鍵拖曳＝平移、滾輪＝縮放。
// 筆電觸控板：左鍵拖曳也可旋轉，Shift＋左鍵拖曳＝平移。手機：單指旋轉、雙指縮放。
// 需要 three.js r128（全域 THREE）。資料：case.mesh = {unit, objs:[{k:'t'|'b'|'c', fdi, jaw, v:b64 int16, f:b64 uint16}]}
(function () {
  const PAL = [0xf0a050, 0x55c8e6], BONE = 0xe8dcc0, CANAL = 0xe04848, OPEN_MM = 9;
  let R = null; // 單一 renderer，重複使用
  function b64(s, T) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); }
  function make() {
    const el = document.createElement("div"); el.className = "v3d";
    el.innerHTML = `<div class="v3bar">
      <span class="grp"><button data-jaw="1">上顎</button><button data-jaw="2">下顎</button><button data-jaw="0">上下都看</button></span>
      <span class="grp"><button data-view="front">正面</button><button data-view="right">右側</button><button data-view="left">左側</button><button data-view="occ">咬合面</button></span>
      <label class="chk"><input type="checkbox" data-bone checked> 骨頭（半透明）</label>
      <label class="chk"><input type="checkbox" data-lab checked> 牙號</label>
      <span class="hint">右鍵拖曳旋轉・中鍵拖曳平移・滾輪縮放</span></div>
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
      }
      R.model.add(m); R.objs.push({ o, m, c, anchor });
    }
    // 牙弓中心（畫引線往外推的方向用）
    const t = R.objs.filter(x => x.o.k === "t"); const ac = new THREE.Vector3(); t.forEach(x => ac.add(x.c)); if (t.length) ac.divideScalar(t.length); R.arch = ac;
    R.objs.forEach(x => { x.base = x.m.position.clone(); });
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
    R.center = c; R.dist = Math.max(60, Math.max(s.x, s.y, s.z) * 2.4);
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
    const L = [];
    const ac = R.arch.clone(); const acs = R.model.localToWorld(ac.clone()).project(R.cam); const ax = (acs.x + 1) / 2 * w, ay = (1 - acs.y) / 2 * h;
    for (const x of R.objs) {
      if (x.o.k !== "t" || !x.m.visible) continue;
      const a = x.anchor.clone(); a.y += x.off || 0; const s = R.model.localToWorld(a).project(R.cam);
      if (s.z > 1) continue; const px = (s.x + 1) / 2 * w, py = (1 - s.y) / 2 * h;
      let dx = px - ax, dy = py - ay; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      if (R.jaw === 0) { dy = x.o.jaw === 1 ? -Math.abs(dy) - 0.6 : Math.abs(dy) + 0.6; const m = Math.hypot(dx, dy); dx /= m; dy /= m; }
      L.push({ f: x.o.fdi, px, py, dx, dy, lx: px + dx * 34, ly: py + dy * 34 });
    }
    // 不重疊：反覆把重疊的標籤沿各自外推方向推開
    const W = 26, H = 18;
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j]; const ox = W - Math.abs(a.lx - b.lx), oy = H - Math.abs(a.ly - b.ly);
        if (ox > 0 && oy > 0) { moved = true; const k = 0.5 + Math.min(ox, oy) * 0.15; a.lx += a.dx * k * 2; a.ly += a.dy * k * 2; b.lx += b.dx * k * 2; b.ly += b.dy * k * 2;
          const sx = Math.sign(a.lx - b.lx) || 1; a.lx += sx * 1.2; b.lx -= sx * 1.2; }
      }
      if (!moved) break;
    }
    L.forEach(l => { l.lx = Math.max(W / 2, Math.min(w - W / 2, l.lx)); l.ly = Math.max(H / 2, Math.min(h - H / 2, l.ly)); });
    svg.innerHTML = L.map(l => `<line x1="${l.px.toFixed(1)}" y1="${l.py.toFixed(1)}" x2="${l.lx.toFixed(1)}" y2="${l.ly.toFixed(1)}"/><circle cx="${l.px.toFixed(1)}" cy="${l.py.toFixed(1)}" r="2"/>`).join("");
    box.innerHTML = L.map(l => `<span style="left:${(l.lx - W / 2).toFixed(1)}px;top:${(l.ly - H / 2).toFixed(1)}px">${l.f}</span>`).join("");
  }
  function bindUI() {
    const el = R.el;
    el.querySelectorAll("[data-jaw]").forEach(b => b.onclick = () => { R.jaw = +b.dataset.jaw; mark(); layout(); fit(); setView(R.view === "occ" ? "occ" : R.view); });
    el.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { setView(b.dataset.view); mark(); });
    el.querySelector("[data-bone]").onchange = e => { R.bone = e.target.checked; draw(); };
    el.querySelector("[data-lab]").onchange = e => { R.lab = e.target.checked; draw(); };
  }
  function mark() { R.el.querySelectorAll("[data-jaw]").forEach(b => b.classList.toggle("on", +b.dataset.jaw === R.jaw)); R.el.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === R.view)); }
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
    st.addEventListener("wheel", e => { e.preventDefault(); R.dist *= Math.exp(Math.sign(e.deltaY) * 0.12); R.dist = Math.max(25, Math.min(900, R.dist)); draw(); }, { passive: false });
    st.addEventListener("touchmove", e => { if (e.touches.length === 2) { e.preventDefault(); const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (pinch) { R.dist *= pinch / d; R.dist = Math.max(25, Math.min(900, R.dist)); draw(); } pinch = d; mode = null; } }, { passive: false });
    st.addEventListener("touchend", () => { pinch = 0; });
  }
  window.V3 = {
    mount(holder, caseId, mesh) {
      if (!window.THREE || !mesh) { holder.innerHTML = '<div class="mu">這一例沒有 3D 資料。</div>'; return; }
      if (!R) make();
      holder.appendChild(R.el);
      if (R.caseId !== caseId) { R.caseId = caseId; load(mesh); R.jaw = 1; R.bone = true; R.el.querySelector("[data-bone]").checked = true; layout(); fit(); setView("front"); mark(); }
      else draw();
    }
  };
})();
