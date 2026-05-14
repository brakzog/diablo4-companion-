// ============================================================
// D4 Companion – Bookmarklet
// 
// COMMENT L'UTILISER :
// 1. Crée un nouveau favori dans ton navigateur
// 2. Comme URL du favori, colle tout le contenu de la ligne "BOOKMARKLET:" ci-dessous
// 3. Va sur une page de build Mobalytics (ex: mobalytics.gg/diablo-4/builds/warlock-dread-claws)
// 4. Clique le favori → les données sont envoyées à ton serveur local
// ============================================================

// ── VERSION LISIBLE (pour comprendre le code) ──────────────────────────────

javascript: (function () {
  var SERVER = "http://localhost:4734";

  // 1. Cherche le Apollo Client dans les internals React du DOM
  function findApolloCache() {
    // Apollo Client v3 stocke son cache dans l'instance client
    // React l'attache souvent via __reactFiber ou __reactInternalInstance sur le root
    var root = document.getElementById("root") || document.getElementById("__next") || document.body;

    // Méthode 1 : window.__APOLLO_CLIENT__
    if (window.__APOLLO_CLIENT__) {
      try {
        var cache = window.__APOLLO_CLIENT__.cache.extract();
        return cache;
      } catch (e) {}
    }

    // Méthode 2 : window.__APOLLO_STATE__
    if (window.__APOLLO_STATE__) return window.__APOLLO_STATE__;

    // Méthode 3 : cherche dans les fibers React
    var fiberKey = Object.keys(root).find(function (k) {
      return k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance");
    });
    if (!fiberKey) return null;

    function walk(fiber, depth) {
      if (!fiber || depth > 30) return null;
      try {
        var state = fiber.memoizedState;
        while (state) {
          if (state.memoizedState && state.memoizedState.cache && state.memoizedState.cache.data) {
            return state.memoizedState.cache.data;
          }
          if (state.queue && state.queue.lastRenderedState) {
            var s = state.queue.lastRenderedState;
            if (s && s.ROOT_QUERY) return s;
          }
          state = state.next;
        }
        return walk(fiber.child, depth + 1) || walk(fiber.sibling, depth + 1);
      } catch (e) {
        return null;
      }
    }

    return walk(root[fiberKey], 0);
  }

  // 2. Méthode principale : intercepte les réponses XHR/fetch en live
  //    Si la page vient d'être chargée, les données sont dans le network
  //    On cherche dans les scripts <script> de la page (SSR data)
  function findFromScripts() {
    var scripts = document.querySelectorAll("script[type='application/json'], script:not([src])");
    for (var i = 0; i < scripts.length; i++) {
      var txt = scripts[i].textContent || "";
      if (txt.includes("userGeneratedDocumentBySlug") && txt.includes("buildVariants")) {
        try {
          var parsed = JSON.parse(txt);
          if (parsed && (parsed.data || parsed.game)) return parsed;
        } catch (e) {}
        // Parfois c'est enveloppé différemment
        var match = txt.match(/\{[\s\S]*"game"[\s\S]*"buildVariants"[\s\S]*\}/);
        if (match) {
          try { return JSON.parse(match[0]); } catch (e) {}
        }
      }
    }
    return null;
  }

  // 3. Cherche dans window pour des noms communs de stores
  function findFromWindow() {
    var candidates = [
      "__NEXT_DATA__",
      "__NUXT__",
      "__INITIAL_STATE__",
      "__APP_STATE__",
      "__DATA__",
    ];
    for (var i = 0; i < candidates.length; i++) {
      var obj = window[candidates[i]];
      if (obj) {
        var str = JSON.stringify(obj);
        if (str.includes("userGeneratedDocumentBySlug") && str.includes("buildVariants")) {
          return obj;
        }
      }
    }
    return null;
  }

  // 4. Parse l'activeVariantId depuis l'URL
  //    ex: ?ws-ngf5-1=activeVariantId%2C6 → "6"
  function getActiveVariantId() {
    try {
      var url = window.location.href;
      var match = url.match(/activeVariantId[%2C,]+(\d+)/i);
      return match ? match[1] : null;
    } catch (e) { return null; }
  }

  // 5. Cherche dans Apollo cache extrait (format plat avec ROOT_QUERY)
  function findFromApolloFlat(cache) {
    if (!cache) return null;
    // Apollo v3 flat cache : les clés sont comme "UserGeneratedDocument:uuid"
    // ROOT_QUERY contient les références
    var str = JSON.stringify(cache);
    if (str.includes("userGeneratedDocumentBySlug") && str.includes("buildVariants")) {
      // Reconstruit la structure attendue
      return { _apolloCache: cache };
    }
    return null;
  }

  // ── Main ────────────────────────────────────────────────────────────────────
  var status = document.createElement("div");
  status.style.cssText = "position:fixed;top:20px;right:20px;z-index:999999;background:#1a1e28;color:#e85d3a;border:2px solid #e85d3a;border-radius:8px;padding:12px 18px;font-family:monospace;font-size:13px;max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.5)";
  status.textContent = "D4 Companion — Recherche des données…";
  document.body.appendChild(status);

  function setStatus(msg, color) {
    status.textContent = msg;
    status.style.borderColor = color || "#e85d3a";
    status.style.color = color || "#e85d3a";
  }

  function dismiss() { setTimeout(function () { status.remove(); }, 4000); }

  var data = findFromScripts() || findFromWindow();
  var variantId = getActiveVariantId();

  if (!data) {
    var cache = findApolloCache();
    data = findFromApolloFlat(cache);
  }

  if (!data) {
    setStatus("❌ Données introuvables. Recharge la page et réessaie.", "#ff4455");
    dismiss();
    return;
  }

  setStatus("📡 Envoi vers D4 Companion…");

  fetch(SERVER + "/api/push-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: data,
      activeVariantId: variantId,
      sourceUrl: window.location.href,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.ok) {
        setStatus("✅ " + res.buildName + "\n" + res.skillPoints + " skill pts · " + res.boards + " boards", "#5dd48f");
      } else {
        setStatus("⚠️ Erreur serveur : " + (res.error || "inconnue"), "#ffaa00");
      }
      dismiss();
    })
    .catch(function (e) {
      setStatus("❌ Serveur local inaccessible (port " + SERVER + ")\nLance npm start d'abord.", "#ff4455");
      dismiss();
    });
})();


// ============================================================
// D4 Companion � Bookmarklet v2
// ============================================================
// UTILISATION : copie la derni�re ligne (javascript:...) comme URL d'un favori
// ============================================================

// BOOKMARKLET (copie tout depuis javascript: jusqu'� la fin de la ligne) :
// javascript:(function(){var S="http://localhost:4734";var div=document.createElement("div");div.style.cssText="position:fixed;top:16px;right:16px;z-index:2147483647;background:#0d0f13;color:#e85d3a;border:2px solid #e85d3a;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:12px;max-width:340px;box-shadow:0 4px 24px rgba(0,0,0,.7);white-space:pre-wrap";div.textContent="D4 Companion � Scan�";document.body.appendChild(div);function ss(m,c){div.textContent=m;div.style.borderColor=c||"#e85d3a";div.style.color=c||"#e85d3a"}function done(){setTimeout(function(){div.remove()},5000)}function dF(o,d,s){if(!o||d>6||typeof o!=="object")return null;if(s.has(o))return null;s.add(o);try{if(o.buildVariants||(o.data&&o.data.buildVariants))return o;var k=Object.keys(o);for(var i=0;i<k.length;i++){if(k[i]==="children"||k[i]==="sibling"||k[i]==="return")continue;var r=dF(o[k[i]],d+1,s);if(r)return r}}catch(e){}return null}function sF(f){if(!f)return null;var q=[f],v=new Set(),n=0;while(q.length&&n<50000){n++;var node=q.shift();if(!node||v.has(node))continue;v.add(node);try{if(node.memoizedProps){var s=new Set();var r=dF(node.memoizedProps,0,s);if(r)return r}}catch(e){}try{var st=node.memoizedState;while(st){if(st.memoizedState){var s2=new Set();var r2=dF(st.memoizedState,0,s2);if(r2)return r2}if(st.queue&&st.queue.lastRenderedState){var s3=new Set();var r3=dF(st.queue.lastRenderedState,0,s3);if(r3)return r3}st=st.next}}catch(e){}if(node.child)q.push(node.child);if(node.sibling)q.push(node.sibling)}return null}function gRF(){var c=[document.getElementById("root"),document.getElementById("__next"),document.getElementById("app"),document.querySelector("[data-reactroot]"),document.body];for(var i=0;i<c.length;i++){var el=c[i];if(!el)continue;var ks=Object.keys(el);for(var j=0;j<ks.length;j++){if(ks[j].startsWith("__reactFiber")||ks[j].startsWith("__reactInternalInstance"))return el[ks[j]]}}var all=document.querySelectorAll("*");for(var k=0;k<Math.min(all.length,200);k++){var el2=all[k];var eks=Object.keys(el2);for(var m=0;m<eks.length;m++){if(eks[m].startsWith("__reactFiber"))return el2[eks[m]]}}return null}function tND(){try{if(window.__NEXT_DATA__&&window.__NEXT_DATA__.props){var s=new Set();return dF(window.__NEXT_DATA__.props,0,s)}}catch(e){}return null}function tIS(){var sc=document.querySelectorAll("script");for(var i=0;i<sc.length;i++){var t=(sc[i].textContent||"").trim();if(!t.startsWith("{")&&!t.startsWith("["))continue;if(!t.includes("buildVariants"))continue;try{var p=JSON.parse(t);var s=new Set();var f=dF(p,0,s);if(f)return f}catch(e){}}return null}function tWS(){var wk=Object.keys(window);for(var i=0;i<wk.length;i++){var k=wk[i];if(k.startsWith("_")||k.length<3)continue;try{var v=window[k];if(typeof v!=="object"||!v)continue;var str=JSON.stringify(v).substring(0,200);if(str.includes("buildVariants")){var s=new Set();return dF(v,0,s)}}catch(e){}}return null}setTimeout(function(){var res=tND()||tIS()||tWS();if(!res){var fib=gRF();if(fib)res=sF(fib)}if(!res){ss("? Donn�es introuvables.\n\nSolution manuelle :\n1. F12 ? Network\n2. Recharge la page (F5)\n3. Filtre : buildVariants\n4. Copie la r�ponse JSON\n5. Colle dans data/current.json","#ff4455");done();return}var pl=res;var vm=window.location.href.match(/activeVariantId[%2C,]+(\d+)/i);var vid=vm?vm[1]:null;fetch(S+"/api/push-build",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:pl,activeVariantId:vid,sourceUrl:window.location.href})}).then(function(r){return r.json()}).then(function(r){if(r.ok){ss("? "+r.buildName+"\n"+r.skillPoints+" pts � "+r.boards+" boards\n\n? localhost:4734","#5dd48f")}else{ss("?? "+(r.error||"erreur"),"#ffaa00")}done()}).catch(function(){ss("? Serveur inaccessible\nLance npm start !","#ff4455");done()})},100)})();