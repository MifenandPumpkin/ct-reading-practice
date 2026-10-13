// 呼叫後端：不帶 Google 登入資訊（credentials:'omit'），所以瀏覽器登入幾個 Google 帳號都沒關係。
window.api = async function (fn, ...args) {
  let r;
  for (let i = 0; i < 3; i++) {
    try {
      r = await fetch(window.CT_API, { method: "POST", credentials: "omit", redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ fn, args }) });
      break;
    } catch (e) { if (i === 2) throw new Error("連不上雲端，請檢查網路後再試"); await new Promise(s => setTimeout(s, 800 * (i + 1))); }
  }
  let j; try { j = await r.json(); } catch (e) { throw new Error("雲端回應格式不對（" + r.status + "）"); }
  if (!j.ok) throw new Error(j.error || "雲端錯誤");
  return j.data;
};
