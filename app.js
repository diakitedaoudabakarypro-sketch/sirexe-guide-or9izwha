/* SIREXE 2026 · guide des exposants et carnet de contacts.
   - Les contacts sont écrits d'abord dans IndexedDB (le téléphone), puis envoyés à un dépôt GitHub PRIVÉ.
   - Le jeton GitHub n'est JAMAIS dans ce code : il est saisi dans Réglages et reste dans le téléphone.
   - Un fichier par contact, nommé par son identifiant unique : renvoyer un contact ne crée jamais de doublon.
   - Tout texte affiché passe par textContent (aucun innerHTML avec des données). */
(function () {
  "use strict";
  var APP_VERSION = "1.7";   // à changer avec VERSION dans sw.js à chaque publication

  /* ---------- utilitaires ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function h(tag, a) {
    var e = document.createElement(tag), k, v, kids = Array.prototype.slice.call(arguments, 2);
    for (k in (a || {})) {
      v = a[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, v);
    }
    (function add(list) {   // compteur local : la récursion ne doit pas écraser celui de l'appelant
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c); else e.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    })(kids);
    return e;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function ic(nom, cl) {   // icône du jeu intégré à index.html ; nom = constante du code, jamais une donnée
    var s = document.createElement("span"), svg = document.createElementNS(SVGNS, "svg"), u = document.createElementNS(SVGNS, "use");
    s.className = "ic" + (cl ? " " + cl : ""); s.setAttribute("aria-hidden", "true"); svg.setAttribute("viewBox", "0 0 24 24"); u.setAttribute("href", "#i-" + nom); svg.append(u); s.append(svg); return s;
  }
  function vib() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }
  function initiales(t) { var m = String(t || "?").replace(/[^A-Za-zÀ-ÿ0-9 ]/g, " ").trim().split(/\s+/); return ((m[0] || "?").charAt(0) + (m[1] ? m[1].charAt(0) : (m[0] || "").charAt(1))).toUpperCase(); }
  function classeSecteur(e) { return e && ["mines", "petrole", "energies"].indexOf(e.secteur) >= 0 ? "s-" + e.secteur : ""; }
  function rangInfo(p) { var r = String(p && p.rang || ""), a = r.match(/^\s*(\d+)/), b = r.match(/impression\s*(\d+)/); return { prio: a ? a[1] : "", cv: b ? b[1] : "" }; }
  function cvTexte(p) { var o = p && p.cv_ordres && p.cv_ordres.length ? p.cv_ordres : [rangInfo(p).cv]; return "CV n°" + o.join(" et n°"); }
  function plusJours(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function maintenant() { return new Date().toISOString(); }
  function fmt(iso) { try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch (e) { return iso || ""; } }
  function fmtJour(j) { if (!j) return ""; var p = String(j).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : j; }
  function aujourdhui() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function localInput(d) {   // date ET heure de d (et non du jour) : modifier un ancien contact ne doit pas changer sa date
    d = d && !isNaN(d) ? d : new Date(); var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function nouvelId() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    var r = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    return "c-" + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "-" + r;
  }
  function versBase64(texte) {
    var b = new TextEncoder().encode(texte), s = "", i;
    for (i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function depuisBase64(b64) {
    var s = atob(String(b64).replace(/\s/g, "")), b = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return new TextDecoder().decode(b);
  }
  function urlSure(u) { return /^https?:\/\//i.test(u || "") ? u : null; }

  /* ---------- stockage local (IndexedDB) ---------- */
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("IndexedDB absent"));
      var r = indexedDB.open("sirexe", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("contacts", { keyPath: "id" }); r.result.createObjectStore("meta", { keyPath: "key" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error("base bloquée")); };
    });
    return dbp;
  }
  function ecrire(nom, val) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(nom, "readwrite"); t.objectStore(nom).put(val);
        t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function lireTout(nom) {
    return db().then(function (d) { return new Promise(function (res, rej) { var r = d.transaction(nom).objectStore(nom).getAll(); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); });
  }
  function lireMeta(cle) {
    return db().then(function (d) { return new Promise(function (res, rej) { var r = d.transaction("meta").objectStore("meta").get(cle); r.onsuccess = function () { res(r.result ? r.result.valeur : null); }; r.onerror = function () { rej(r.error); }; }); });
  }
  function ecrireMeta(cle, valeur) { return ecrire("meta", { key: cle, valeur: valeur }); }
  function lireContact(id) {
    return db().then(function (d) { return new Promise(function (res, rej) { var r = d.transaction("contacts").objectStore("contacts").get(id); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { rej(r.error); }; }); });
  }
  /* Après un envoi, n'enregistre le statut que si le contact n'a pas été modifié pendant l'envoi.
     Sinon la version la plus récente reste « en attente » et repart au prochain passage (aucune perte). */
  function marquerSync(c, statut) {
    return lireContact(c.id).then(function (actuel) {
      if (actuel && actuel.modifie_le !== c.modifie_le) { if (statut.sha) { actuel.sync = Object.assign({}, actuel.sync, { sha: statut.sha }); return ecrire("contacts", actuel).then(function () { return false; }); } return false; }
      c.sync = statut; return ecrire("contacts", c).then(function () { return true; });
    });
  }

  /* ---------- état ---------- */
  var S = { exposants: [], selection: {}, selectionNote: "", contacts: [], cfg: null, journal: [], filtre: { q: "", secteur: "tous", hall: "", page: 1 }, filtreC: { q: "", mode: "tous" }, enSync: false };
  var SECTEURS = [["prio", "Ma sélection"], ["tous", "Tous"],["mines", "Mines"], ["petrole", "Pétrole"], ["energies", "Énergie"], ["partenaires", "Partenaires"], ["autres", "Autres"]];
  var STATUTS = ["Nouveau", "À relancer", "En attente de réponse", "Rendez-vous prévu", "Candidature envoyée", "Clos"];
  var INTERETS = ["Non précisé", "Faible", "Moyen", "Fort"];
  var PAGE = 60;

  function exposant(id) { for (var i = 0; i < S.exposants.length; i++) if (S.exposants[i].id === id) return S.exposants[i]; return null; }
  function secteurFiche(e) { return e.secteur === "mines" ? "Mines" : e.secteur === "petrole" ? "Pétrole et gaz" : e.secteur === "energies" ? "Énergie" : "Autre"; }
  function estRelance(c) { return c.statut_suivi !== "Clos" && (c.statut_suivi === "À relancer" || (c.date_relance && c.date_relance <= aujourdhui())); }

  /* ---------- interface commune ---------- */
  var vue = $("#vue");
  function rendre() {   // aplatit tableaux et valeurs nulles avant affichage (replaceChildren les convertirait en texte)
    var d = h.apply(null, ["div", null].concat(Array.prototype.slice.call(arguments)));
    vue.replaceChildren.apply(vue, Array.prototype.slice.call(d.childNodes));
  }
  function toast(msg, erreur) {
    var t = h("div", { class: "toast" + (erreur ? " err" : ""), role: "status", "aria-live": "polite" }, ic(erreur ? "question" : "ok"), h("span", null, msg));
    document.body.append(t); vib();
    setTimeout(function () { t.style.transition = "opacity .25s"; t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 260); }, erreur ? 6000 : 2600);
  }
  function bloquant(msg) { rendre(h("div", { class: "note" }, h("b", null, "Stockage indisponible. "), msg)); }
  function majPastille() {
    var p = $("#etat-sync"), att = S.contacts.filter(function (c) { return !c.sync || c.sync.statut !== "synced"; }).length, txt, etat = "ok";
    var err = S.contacts.some(function (c) { return c.sync && c.sync.statut === "error"; });
    if (S.enSync) { txt = "Envoi en cours…"; etat = "run"; }
    else if (!navigator.onLine) { txt = "Hors connexion" + (att ? " · " + att + " en attente" : ""); etat = "off"; }
    else if (!S.cfg || !S.cfg.token) { txt = att ? att + " en attente · jeton manquant" : "Connecter GitHub"; etat = "att"; }
    else if (att) { txt = att + " en attente"; etat = err ? "err" : "att"; }
    else txt = S.contacts.length ? "Tout est synchronisé" : "Prêt";
    p.textContent = txt; p.dataset.etat = etat;
  }

  /* ---------- synchronisation GitHub ---------- */
  function erreurGh(code, statut, msg) { return { code: code, statut: statut || 0, message: msg }; }
  function erreurHttp(r) {
    var s = r.status;
    if (s === 401) return erreurGh("cle", s, "Jeton refusé par GitHub (expiré, retiré ou mal copié).");
    if (s === 403 || s === 429) return r.headers.get("x-ratelimit-remaining") === "0" ? erreurGh("limite", s, "Trop de demandes à GitHub : réessayer dans quelques minutes.") : erreurGh("cle", s, "Ce jeton n'a pas le droit d'écrire dans le dépôt (permission « Contents : Read and write »).");
    if (s === 404) return erreurGh("depot", s, "Dépôt introuvable avec ce jeton : vérifier le nom du dépôt et son accès.");
    if (s === 409 || s === 422) return erreurGh("conflit", s, "Le fichier a changé entre-temps.");
    return erreurGh("autre", s, "GitHub a répondu une erreur " + s + ".");
  }
  function gh(cfg, methode, chemin, corps) {
    var arret = window.AbortController ? new AbortController() : null, min = arret ? setTimeout(function () { arret.abort(); }, 15000) : null;
    var base = "https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo);
    return fetch(base + chemin, {
      method: methode, cache: "no-store", signal: arret ? arret.signal : undefined, keepalive: methode === "PUT",
      headers: Object.assign({ "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, corps ? { "Content-Type": "application/json" } : {}),
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) { clearTimeout(min); return r; }, function () { clearTimeout(min); throw erreurGh("reseau", 0, "Pas de connexion internet (ou réseau trop lent)."); });
  }
  function cheminContact(cfg, c) { return "/contents/" + (cfg.dossier || "contacts").split("/").concat([c.id + ".json"]).map(encodeURIComponent).join("/"); }
  function chargeUtile(c) { var o = Object.assign({}, c); delete o.sync; return JSON.stringify(o, null, 2) + "\n"; }
  function envoyer(cfg, c) {
    var texte = chargeUtile(c), chemin = cheminContact(cfg, c), branche = cfg.branch || "main", sha = c.sync && c.sync.sha || null;
    function tenter(essai) {
      var corps = { message: "contact " + c.id, content: versBase64(texte), branch: branche };
      if (sha) corps.sha = sha;
      return gh(cfg, "PUT", chemin, corps).then(function (r) {
        if (r.ok) return r.json().then(function (j) { return j.content.sha; });
        if ((r.status === 409 || r.status === 422) && essai < 2) {   // le fichier existe déjà : récupérer son empreinte
          return gh(cfg, "GET", chemin + "?ref=" + encodeURIComponent(branche)).then(function (g) {
            if (!g.ok) throw erreurHttp(g);
            return g.json().then(function (j) {
              if (depuisBase64(j.content) === texte) return j.sha;   // identique : déjà envoyé, rien à refaire
              sha = j.sha; return tenter(essai + 1);
            });
          });
        }
        throw erreurHttp(r);
      });
    }
    return tenter(1);
  }
  function noterJournal(entree) {   // sans donnée personnelle : horodatage, identifiant technique, résultat
    S.journal.unshift(entree); S.journal = S.journal.slice(0, 40); return ecrireMeta("journal", S.journal);
  }
  function synchroniser(manuel) {
    if (S.enSync) return Promise.resolve();
    var cfg = S.cfg;
    if (!cfg || !cfg.token || !cfg.owner || !cfg.repo) { if (manuel) toast("Renseigner d'abord le jeton et le dépôt dans Réglages.", true); majPastille(); return Promise.resolve(); }
    if (!navigator.onLine) { if (manuel) toast("Hors connexion : les contacts restent sur le téléphone.", true); majPastille(); return Promise.resolve(); }
    var file = S.contacts.filter(function (c) { return !c.sync || c.sync.statut !== "synced"; }).map(function (c) { return JSON.parse(JSON.stringify(c)); }), ok = 0, stop = null, relancer = false;
    if (!file.length) { if (manuel) toast("Rien à envoyer."); majPastille(); return Promise.resolve(); }
    S.enSync = true; majPastille();
    return file.reduce(function (p, c) {
      return p.then(function () {
        if (stop) return;
        return envoyer(cfg, c).then(function (sha) {
          return marquerSync(c, { statut: "synced", sha: sha, le: maintenant() }).then(function (aJour) { if (aJour) ok++; else relancer = true; return noterJournal({ le: maintenant(), id: c.id, resultat: aJour ? "ok" : "ok-modifie-pendant-envoi" }); });
        }, function (e) {
          if (e.code === "cle" || e.code === "reseau" || e.code === "limite" || e.code === "depot") stop = e;
          return marquerSync(c, { statut: "error", sha: c.sync && c.sync.sha || null, code: e.code || "autre", message: e.message || String(e), le: maintenant() }).then(function () { return noterJournal({ le: maintenant(), id: c.id, resultat: e.code || "autre" }); });
        });
      });
    }, Promise.resolve()).then(chargerContacts).then(function () {
      S.enSync = false; majPastille();
      if (relancer) setTimeout(function () { synchroniser(false); }, 500);
      if (manuel || stop) toast(stop ? stop.message : ok + " contact(s) synchronisé(s).", !!stop);
      rafraichir();
    }, function () { S.enSync = false; majPastille(); });
  }

  /* ---------- données ---------- */
  function chargerContacts() { return lireTout("contacts").then(function (l) { S.contacts = l.sort(function (a, b) { return (b.rencontre_le || "").localeCompare(a.rencontre_le || ""); }); }); }
  function enregistrer(c) {
    c.modifie_le = maintenant();
    c.sync = { statut: "pending", sha: c.sync && c.sync.sha || null };
    return ecrire("contacts", c).then(chargerContacts).then(function () {
      majPastille();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      synchroniser(false);
    });
  }

  /* Mes invitations : images stockées dans le dépôt PRIVÉ (dossier invitations/), téléchargées avec le jeton puis gardées
     dans le téléphone (localStorage) pour s'afficher sans internet. Elles ne sont jamais publiées sur le site public. */
  /* Badges d'accès : intégrés à l'application (choix de Daouda du 2026-11-17), disponibles hors connexion dès la première ouverture. */
  var BADGES = [["badges/badge_sirexe.png", "Invitation SIREXE 2026 · QR code d'accès"], ["badges/badge_conference.png", "Conférence inaugurale de haut niveau"]];
  var verrouEcran = null;
  function badgePleinEcran(el) {               // plein écran + écran maintenu allumé (si le téléphone le permet)
    var ouvrir = !el.classList.contains("plein");
    el.classList.toggle("plein", ouvrir);
    try {
      if (ouvrir && el.requestFullscreen) el.requestFullscreen().catch(function () {});
      if (!ouvrir && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      if (ouvrir && navigator.wakeLock) navigator.wakeLock.request("screen").then(function (v) { verrouEcran = v; }).catch(function () {});
      if (!ouvrir && verrouEcran) { verrouEcran.release().catch(function () {}); verrouEcran = null; }
    } catch (e) {}
  }
  function vueInvitations() {
    var piste, points;
    function rang() { return Math.round(piste.scrollLeft / Math.max(1, piste.clientWidth)); }
    function aller(i) { piste.scrollTo({ left: i * piste.clientWidth, behavior: "smooth" }); }
    function basculer() { var i = rang(); vib(); badgePleinEcran(piste); requestAnimationFrame(function () { piste.scrollLeft = i * piste.clientWidth; }); }   // garde le badge affiché
    piste = h("div", { class: "carrousel", role: "region", "aria-label": "Mes badges : balayer pour passer de l'un à l'autre" }, BADGES.map(function (b) {
      return h("figure", { class: "diapo" }, h("img", { src: b[0], alt: b[1], onclick: basculer }), h("figcaption", null, h("span", null, b[1]), ic("plein")));
    }));
    points = h("div", { class: "points" }, BADGES.map(function (b, i) { return h("button", { type: "button", class: "point", "aria-label": "Afficher : " + b[1], "aria-current": i === 0 ? "true" : "false", onclick: function () { aller(i); } }); }));
    piste.addEventListener("scroll", function () { var i = rang(); points.querySelectorAll(".point").forEach(function (p, k) { p.setAttribute("aria-current", k === i ? "true" : "false"); }); }, { passive: true });
    document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && piste.classList.contains("plein")) { var i = rang(); piste.classList.remove("plein"); requestAnimationFrame(function () { piste.scrollLeft = i * piste.clientWidth; }); } });
    rendre(h("p", { class: "surtitre" }, "Accès au salon"), h("h2", null, "Mes badges d'accès"),
      h("div", { class: "conseil" }, ic("soleil"), h("span", null, "Balayer pour passer d'un badge à l'autre. Toucher un badge : plein écran, écran maintenu allumé (balayage possible). Toucher de nouveau pour revenir.")),
      piste, points);
  }

  /* ---------- vues ---------- */
  var routes = { entreprises: vueListe, e: vueFiche, ajout: vueFormulaire, contacts: vueContacts, contact: vueContact, bord: vueBord, plans: vuePlans, invitations: vueInvitations, reglages: vueReglages };
  function rafraichir() { var m = (location.hash || "#/").slice(2).split("/"), nom = m[0] || "entreprises"; if (nom === "ajout" || nom === "contact") return; vueCourante(); }
  var dernierHash = location.hash || "#/", positions = {};
  function vueCourante() {
    var m = (location.hash || "#/").slice(2).split("/"), nom = m[0] || "entreprises", f = routes[nom] || vueListe, nav = { entreprises: "entreprises", e: "entreprises", ajout: "entreprises", contacts: "contacts", contact: "contacts", bord: "bord", plans: "plans", invitations: "invitations", reglages: "reglages" }[nom] || "entreprises";
    var ici = location.hash || "#/", nouveau = ici !== dernierHash;
    if (nouveau) { positions[dernierHash] = window.scrollY; dernierHash = ici; }
    function dessiner() {
      document.querySelectorAll(".bas a").forEach(function (a) { if (a.dataset.nav === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      var fab = $(".fab"); if (fab) fab.remove();
      f(decodeURIComponent(m[1] || ""));
      majPastille();
      if (nouveau) window.scrollTo(0, (nom === "entreprises" || nom === "contacts") ? (positions[ici] || 0) : 0);   // retour : on retrouve sa place dans la liste
    }
    dessiner();   // rendu immédiat (pas d'API de transition différée : aucun écran intermédiaire, aucune transition interrompue)
    if (nouveau && S.pret) { vue.classList.remove("entre"); void vue.offsetWidth; vue.classList.add("entre"); }   // animation d'entrée en CSS
  }
  function aller(h2) { if (location.hash === h2) vueCourante(); else location.hash = h2; }

  function badgeSync(c) {
    var st = c.sync && c.sync.statut;
    return st === "synced" ? h("span", { class: "badge b-ok" }, ic("nuage"), "Synchronisé") : st === "error" ? h("span", { class: "badge b-err", title: c.sync.message }, "Erreur de synchro") : h("span", { class: "badge b-att" }, "En attente de synchronisation");
  }
  function nbContacts(id) { return S.contacts.filter(function (c) { return c.entreprise_id === id; }).length; }

  /* Liste des entreprises */
  function vueListe() {
    var f = S.filtre, nbSel = Object.keys(S.selection).length, liste = S.exposants.filter(function (e) {
      if (f.q) return norm(e.nom).indexOf(norm(f.q)) >= 0 && (!f.hall || e.hall === f.hall);   // une recherche porte sur tout l'annuaire
      if (f.hall && e.hall !== f.hall) return false;
      if (f.secteur === "prio") return !!S.selection[e.id];
      if (f.secteur === "autres") return ["institutions", "esplanade", "startups"].indexOf(e.secteur) >= 0;
      if (f.secteur !== "tous") return e.secteur === f.secteur;
      return true;
    });
    liste.sort(function (a, b) {
      var pa = S.selection[a.id], pb = S.selection[b.id];
      if (pa && pb) { var ra = rangInfo(pa), rb = rangInfo(pb); return ((+ra.prio || 99) - (+rb.prio || 99)) || ((+ra.cv || 99) - (+rb.cv || 99)); }   // priorité, puis n° du CV papier
      if (pa) return -1; if (pb) return 1;
      return a.nom.localeCompare(b.nom, "fr");
    });
    var q = h("input", { type: "search", id: "q", placeholder: "Rechercher", "aria-label": "Rechercher une entreprise", value: f.q, autocomplete: "off" });
    q.addEventListener("input", function () { f.q = q.value; f.page = 1; var pos = q.selectionStart; vueListe(); var n = $("#q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} });
    var compte = { prio: nbSel, tous: S.exposants.length };
    var puces = h("div", { class: "puces", role: "group", "aria-label": "Filtrer par secteur" }, SECTEURS.filter(function (s) { return s[0] !== "prio" || nbSel; }).map(function (s) {
      return h("button", { class: "puce", "aria-pressed": f.secteur === s[0] && !f.q ? "true" : "false", onclick: function () { f.secteur = s[0]; f.page = 1; f.q = ""; vueListe(); } }, s[1], compte[s[0]] != null ? h("i", null, compte[s[0]]) : null);
    }));
    var hall = h("select", { "aria-label": "Hall", onchange: function (ev) { f.hall = ev.target.value; f.page = 1; vueListe(); } }, [["", "Tous halls"], ["Hall 1", "Hall 1"], ["Hall 2", "Hall 2"]].map(function (o) { return h("option", { value: o[0], selected: f.hall === o[0] }, o[1]); }));
    var cartes = liste.slice(0, f.page * PAGE).map(function (e, i) {
      var p = S.selection[e.id], n = nbContacts(e.id), r = rangInfo(p);
      return h("a", { class: "carte", href: "#/e/" + encodeURIComponent(e.id), style: "--i:" + i },
        h("span", { class: "avatar " + (p ? classeSecteur(e) : "") }, initiales(e.nom)),
        h("span", { class: "corps" }, h("b", null, e.nom), h("span", { class: "meta" }, e.pavillon + " · " + e.hall + (e.stand ? " · stand " + e.stand : ""))),
        ic("fleche", "fleche"),
        (p || n) ? h("span", { class: "etiquettes" },
          p ? h("span", { class: "badge b-prio" }, ic("etoile"), "Priorité " + r.prio) : null,
          p && r.cv ? h("span", { class: "badge" }, ic("cv"), cvTexte(p)) : null,
          n ? h("span", { class: "badge b-ok" }, ic("ok"), "Rencontrée · " + n + " contact" + (n > 1 ? "s" : "")) : null) : null);
    });
    var hero = null;
    if (nbSel && f.secteur === "prio" && !f.q) {
      var vus = Object.keys(S.selection).filter(function (id) { return nbContacts(id) > 0; }).length, relances = S.contacts.filter(estRelance).length;
      hero = h("section", { class: "hero" }, h("p", { class: "surtitre" }, "Ma sélection · salon SIREXE 2026"),
        h("b", { class: "grand" }, vus + " / " + nbSel + " entreprises rencontrées"),
        h("p", null, "Classées par priorité. Toucher une entreprise : débrief, pitch, questions et ajout d'un contact."),
        h("div", { class: "jauge", role: "progressbar", "aria-label": "Entreprises rencontrées", "aria-valuemin": "0", "aria-valuemax": String(nbSel), "aria-valuenow": String(vus) }, h("span", { style: "width:" + Math.round(100 * vus / nbSel) + "%" })),
        h("div", { class: "stats" }, h("a", { href: "#/contacts" }, ic("contacts"), S.contacts.length + " contact" + (S.contacts.length > 1 ? "s" : "")), h("a", { href: "#/bord" }, ic("relance"), relances + " à relancer"), h("a", { href: "#/invitations" }, ic("qr"), "Mon badge")));
    }
    rendre(hero, hero ? null : h("h2", null, "Exposants (" + liste.length + ")"),
      h("div", { class: "outils" }, q, hall), puces,
      S.selectionNote && !nbSel ? h("p", { class: "note" }, "Fiches de préparation : pas encore disponibles. Les exposants ci-dessous viennent de l'annuaire officiel (présence en Côte d'Ivoire non vérifiée).") : null,
      cartes.length ? cartes : h("div", { class: "vide" }, ic("entreprise"), "Aucun exposant ne correspond. Essayer un autre mot ou « Tous »."),
      liste.length > f.page * PAGE ? h("button", { class: "second gros", onclick: function () { f.page++; vueListe(); } }, "Afficher plus (" + (liste.length - f.page * PAGE) + ")") : null,
      h("p", { class: "aide" }, "Source : annuaire officiel sirexe.ci, extrait le " + fmtJour((S.extrait || "").slice(0, 10)) + ". Les numéros de stand sont rarement publiés : voir l'onglet Plans."));
  }

  /* Fiche d'une entreprise */
  function bloc(titre, contenu, o) {   // o.ouvert : lisible sans toucher ; o.type : "pitch", "num" (liste numérotée), "qr" (question + réponse), "vocab" (terme : définition)
    o = o || {};
    if (!contenu || (Array.isArray(contenu) && !contenu.length)) return null;
    var corps;
    if (Array.isArray(contenu)) {
      corps = h(o.type === "num" || o.type === "qr" ? "ol" : "ul", { class: "liste" }, contenu.map(function (x) {
        x = String(x);
        var k = o.type === "qr" ? x.indexOf(" Savoir : ") : o.type === "vocab" ? x.indexOf(" : ") : -1;
        if (k > 0 && o.type === "qr") return h("li", null, h("b", null, x.slice(0, k)), h("span", { class: "rep" }, "À savoir : " + x.slice(k + 10)));
        if (k > 0) return h("li", null, h("span", { class: "terme" }, x.slice(0, k)), " : " + x.slice(k + 3));
        return h("li", null, x);
      }));
    } else corps = String(contenu).split(" | ").map(function (t) { return h("p", null, t); });
    if (o.ouvert) return h("div", { class: "bloc" + (o.type === "pitch" ? " pitch" : "") }, h("p", { class: "surtitre" }, titre), corps);
    return h("details", null, h("summary", null, titre), h("div", { class: o.type === "pitch" ? "pitch" : null }, corps));
  }
  function sauter(id) { return function (ev) { ev.preventDefault(); vib(); var c = document.getElementById(id); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); }; }
  function vueFiche(id) {
    var e = exposant(id); if (!e) { rendre(h("p", { class: "vide" }, "Entreprise introuvable."), h("a", { class: "btn", href: "#/" }, "Retour à la liste")); return; }
    var p = S.selection[id], mes = S.contacts.filter(function (c) { return c.entreprise_id === id; }), r = rangInfo(p), ajout = "#/ajout/" + encodeURIComponent(id);
    var sources = p && Array.isArray(p.sources) ? p.sources.filter(function (s) { return urlSure(s.url); }).map(function (s) { return h("li", null, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.titre || s.url)); }) : [];
    var sections = p ? [
      ["essentiel", "L'essentiel", "cible", [bloc("En bref", p.resume, { ouvert: true }), bloc("Pourquoi mon profil l'intéresse", p.pourquoi, { ouvert: true }), bloc("Qui aborder et comment", p.strategie_contact, { ouvert: true }), bloc("Compétences à mettre en avant", p.competences, { ouvert: true })]],
      ["pitch", "Pitch", "parole", [bloc("Pitch 30 secondes", p.pitch30, { ouvert: true, type: "pitch" }), bloc("Pitch 1 minute", p.pitch60, { type: "pitch" })]],
      ["questions", "Questions", "question", [bloc("Questions à poser", p.questions, { ouvert: true, type: "num" }), bloc("Questions techniques, avec les réponses", p.questions_techniques, { type: "qr" })]],
      ["entreprise", "L'entreprise", "livre", [bloc("Activités", p.activites), bloc("Procédés et opérations", p.procedes), bloc("Installations en Côte d'Ivoire", p.installations_ci), bloc("Vocabulaire technique", p.vocabulaire, { type: "vocab" })]],
      ["stage", "Stage", "stage", [bloc("Stage de 2e année (2 à 3 mois, dès juin 2027)", p.stage2), bloc("Stage de 3e année (6 mois)", p.stage3), sources.length ? h("details", null, h("summary", null, "Sources (" + sources.length + ")"), h("div", null, h("ul", { class: "liste" }, sources))) : null]]
    ] : [];
    rendre(
      h("a", { class: "retour", href: "#/" }, "← Entreprises"),
      h("section", { class: "fiche-hero " + classeSecteur(e) },
        h("div", { class: "tete" }, h("span", { class: "avatar" }, initiales(e.nom)),
          h("div", null, h("h2", null, e.nom), h("span", { class: "meta" }, secteurFiche(e) + " · " + e.hall + (e.stand ? " · stand " + e.stand : " · stand non publié")))),
        p ? h("div", { class: "etiquettes" }, h("span", { class: "badge" }, ic("etoile"), "Priorité " + r.prio), p.score ? h("span", { class: "badge" }, "Adéquation " + p.score + "/100") : null,
          p.presence_ci ? h("span", { class: "badge" }, ic("ok"), "Présence en Côte d'Ivoire vérifiée") : null, mes.length ? h("span", { class: "badge" }, ic("contacts"), mes.length + " contact" + (mes.length > 1 ? "s" : "")) : null) : null),
      h("div", { class: "actions" }, h("a", { class: "btn orange", href: ajout }, ic("plus"), "Ajouter un contact"),
        p && p.cv ? h("div", { class: "cv-num", title: p.cv }, h("small", null, "CV papier à remettre"), h("b", null, cvTexte(p).replace("CV ", ""))) : h("a", { class: "btn second", href: "#/plans" }, ic("plan"), "Plans")),
      p ? null : h("p", { class: "note" }, "Pas de fiche de préparation pour cette entreprise : présence en Côte d'Ivoire non vérifiée dans ce projet."),
      p ? h("nav", { class: "sommaire", "aria-label": "Rubriques de la fiche" }, sections.map(function (s) { return h("a", { href: "#s-" + s[0], onclick: sauter("s-" + s[0]) }, s[1]); }), h("a", { href: "#s-contacts", onclick: sauter("s-contacts") }, "Contacts")) : null,
      sections.map(function (s) { var c = s[3].filter(Boolean); return c.length ? h("section", { class: "section", id: "s-" + s[0] }, h("h3", null, ic(s[2]), s[1]), c) : null; }),
      h("section", { class: "section", id: "s-contacts" }, h("h3", null, ic("contacts"), "Contacts enregistrés (" + mes.length + ")"),
        mes.length ? mes.map(carteContact) : h("p", { class: "aide" }, "Aucun contact pour le moment. Le bouton orange en bas à droite en ajoute un en un toucher.")));
    document.body.append(h("a", { class: "fab", href: ajout, "aria-label": "Ajouter un contact" }, ic("plus"), "Contact"));
  }
  function carteContact(c, i) {
    var e = exposant(c.entreprise_id), nom = [c.prenoms, c.nom].filter(Boolean).join(" ") || "(sans nom)";
    return h("a", { class: "carte", href: "#/contact/" + encodeURIComponent(c.id), style: "--i:" + (i || 0) },
      h("span", { class: "avatar s-personne" }, initiales(nom)),
      h("span", { class: "corps" }, h("b", null, nom), h("span", { class: "meta" }, [c.fonction, e ? e.nom : c.entreprise_nom].filter(Boolean).join(" · "))),
      ic("fleche", "fleche"),
      h("span", { class: "etiquettes" }, h("span", { class: "badge" }, c.statut_suivi || "Nouveau"), c.interet === "Fort" ? h("span", { class: "badge b-prio" }, "Intérêt fort") : null,
        c.cv_remis ? h("span", { class: "badge b-ok" }, ic("cv"), "CV remis") : null, estRelance(c) ? h("span", { class: "badge b-att" }, ic("relance"), "À relancer" + (c.date_relance ? " " + fmtJour(c.date_relance) : "")) : null, badgeSync(c),
        h("span", { class: "meta" }, fmt(c.rencontre_le))));
  }

  /* Formulaire de contact (création et modification) */
  function champ(id, lib, type, val, opt) {
    opt = opt || {};
    var el = type === "textarea" ? h("textarea", { id: id, name: id, rows: opt.rows || 3, autocomplete: "off" }) : h("input", { id: id, name: id, type: type, autocomplete: opt.auto || "off", inputmode: opt.mode, placeholder: opt.ph });
    el.value = val == null ? "" : val;
    return [h("label", { for: id }, lib), el, opt.aide ? h("p", { class: "aide" }, opt.aide) : null, h("p", { class: "erreur", id: "err-" + id, hidden: true })];
  }
  function liste(id, lib, options, val) {
    return [h("label", { for: id }, lib), h("select", { id: id, name: id }, options.map(function (o) { return h("option", { value: o, selected: o === val }, o); }))];
  }
  function segment(id, lib, options, val, cl) {   // un seul toucher au lieu d'une liste déroulante
    var cache = h("input", { type: "hidden", id: id, name: id, value: val || options[0] }), boutons;
    boutons = options.map(function (o) {
      return h("button", { type: "button", id: id + "-" + norm(o).replace(/[^a-z0-9]+/g, "-"), "data-v": o, "aria-pressed": o === (val || options[0]) ? "true" : "false",
        onclick: function (ev) { cache.value = o; boutons.forEach(function (b) { b.setAttribute("aria-pressed", b === ev.currentTarget ? "true" : "false"); }); } }, o);
    });
    return [h("label", null, lib), cache, h("div", { class: "segment " + (cl || ""), role: "group", "aria-label": lib }, boutons)];
  }
  function vueFormulaire(idE, existant) {
    var c = existant || null, e = exposant(c ? c.entreprise_id : idE);
    if (!e && !c) { rendre(h("p", { class: "vide" }, "Entreprise introuvable."), h("a", { class: "btn", href: "#/" }, "Retour")); return; }
    var v = c || { entreprise_id: e.id, entreprise_nom: e.nom, secteur: secteurFiche(e), hall: e.hall, stand: e.stand || "", rencontre_le: new Date().toISOString(), statut_suivi: "Nouveau", interet: "Non précisé", types_stage: ["Stage de 2e année"] };
    var types = ["Stage de 2e année", "Stage de 3e année"];
    var form = h("form", { novalidate: true, id: "form-contact", autocomplete: "off" },
      h("p", { class: "aide" }, "Tout est facultatif, sauf un nom, un sujet ou une note. Seules les coordonnées professionnelles données volontairement."),
      champ("nom", "Nom", "text", v.nom, { auto: "off" }), champ("prenoms", "Prénoms", "text", v.prenoms),
      champ("fonction", "Fonction", "text", v.fonction),
      segment("interet", "Intérêt pour ma candidature", INTERETS, v.interet, "chaud"),
      h("label", { class: "interrupteur", for: "cv_remis" }, h("span", null, "CV remis à cette personne"), h("input", { type: "checkbox", id: "cv_remis", role: "switch", checked: !!v.cv_remis })),
      champ("sujet", "Notes de l'échange", "textarea", v.sujet),
      champ("date_relance", "Relance", "date", v.date_relance),
      h("div", { class: "rapides" }, [["Demain", 1], ["Dans 3 jours", 3], ["Dans 1 semaine", 7], ["Aucune", 0]].map(function (x) {
        return h("button", { type: "button", onclick: function () { form.elements.date_relance.value = x[1] ? plusJours(x[1]) : ""; vib(); } }, x[0]);
      })),
      segment("statut_suivi", "Statut du suivi", STATUTS, v.statut_suivi),
      h("details", null, h("summary", null, "Plus de détails (entreprise, coordonnées, échange)"), h("div", null,
        champ("entreprise_nom", "Entreprise", "text", v.entreprise_nom), liste("secteur", "Secteur", ["Mines", "Pétrole et gaz", "Énergie", "Autre"], v.secteur),
        champ("hall", "Hall", "text", v.hall), champ("stand", "Numéro de stand", "text", v.stand),
        champ("rencontre_le", "Date et heure de la rencontre", "datetime-local", localInput(new Date(v.rencontre_le))),
        champ("service", "Service", "text", v.service),
        champ("email", "Adresse e-mail professionnelle", "email", v.email, { mode: "email", auto: "off" }), champ("telephone", "Téléphone professionnel", "tel", v.telephone, { mode: "tel" }),
        champ("profil_pro", "Profil LinkedIn ou autre contact professionnel", "text", v.profil_pro), champ("autres_coordonnees", "Autres coordonnées communiquées volontairement", "textarea", v.autres_coordonnees, { rows: 2 }),
        h("p", { class: "aide" }, "Types de stages discutés"), h("div", { class: "cases" }, types.map(function (t) { return h("label", null, h("input", { type: "checkbox", name: "types_stage", value: t, checked: (v.types_stage || []).indexOf(t) >= 0 }), t); })),
        champ("documents_demandes", "Documents demandés", "textarea", v.documents_demandes, { rows: 2 }), champ("conseils", "Conseils reçus", "textarea", v.conseils), champ("infos", "Informations importantes", "textarea", v.infos),
        champ("prochaine_action", "Prochaine action", "text", v.prochaine_action))),
      h("p", { class: "erreur", id: "err-form", hidden: true }),
      h("div", { class: "barre-action" }, h("button", { type: "submit", class: "gros orange" }, ic("ok"), c ? "Enregistrer les modifications" : "Enregistrer le contact")));
    function val(id) { var n = form.elements[id]; return n ? String(n.value || "").trim() : ""; }
    function erreur(id, msg) { var n = $("#err-" + id, form); if (n) { n.textContent = msg; n.hidden = !msg; } }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      ["email", "date_relance", "form"].forEach(function (k) { erreur(k, ""); });
      var ok = true;
      if (!val("nom") && !val("sujet") && !val("infos")) { erreur("form", "Saisir au moins un nom, un sujet ou une information."); ok = false; }
      if (val("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email"))) { erreur("email", "Adresse e-mail invalide (exemple : prenom.nom@entreprise.ci)."); ok = false; }
      if (val("date_relance") && !/^\d{4}-\d{2}-\d{2}$/.test(val("date_relance"))) { erreur("date_relance", "Date invalide."); ok = false; }
      if (!ok) return;   // le formulaire n'est jamais vidé après une erreur
      var rec = c || { id: nouvelId(), cree_le: maintenant(), entreprise_id: e.id, appareil: "SIREXE-PWA-" + APP_VERSION };
      ["nom", "prenoms", "fonction", "service", "email", "telephone", "profil_pro", "autres_coordonnees", "sujet", "documents_demandes", "conseils", "infos", "prochaine_action", "entreprise_nom", "secteur", "hall", "stand", "interet", "statut_suivi", "date_relance"].forEach(function (k) { rec[k] = val(k); });
      var d = new Date(val("rencontre_le")); rec.rencontre_le = isNaN(d) ? (c ? c.rencontre_le : maintenant()) : d.toISOString();
      rec.cv_remis = form.elements.cv_remis.checked;
      rec.types_stage = Array.prototype.slice.call(form.querySelectorAll("input[name=types_stage]:checked")).map(function (x) { return x.value; });
      enregistrer(rec).then(function () { toast("Contact enregistré sur le téléphone."); aller("#/e/" + encodeURIComponent(rec.entreprise_id)); }, function () { erreur("form", "Échec de l'enregistrement local. Ne pas fermer la page, exporter depuis Réglages puis réessayer."); });
    });
    rendre(h("a", { class: "retour", href: c ? "#/contacts" : "#/e/" + encodeURIComponent(v.entreprise_id) }, "← Retour"), h("p", { class: "surtitre" }, c ? "Carnet du salon" : "Nouveau contact"), h("h2", null, c ? "Modifier le contact" : "Nouveau contact · " + v.entreprise_nom), form);
    var n = $("#nom"); if (n && !c) n.focus();
  }
  function vueContact(id) { var c = S.contacts.filter(function (x) { return x.id === id; })[0]; if (!c) { rendre(h("p", { class: "vide" }, "Contact introuvable."), h("a", { class: "btn", href: "#/contacts" }, "Retour")); return; } vueFormulaire(null, c); }

  /* Liste des contacts */
  function vueContacts() {
    var f = S.filtreC, l = S.contacts.filter(function (c) {
      if (f.q && norm([c.nom, c.prenoms, c.entreprise_nom, c.fonction, c.sujet].join(" ")).indexOf(norm(f.q)) < 0) return false;
      if (f.mode === "relance") return estRelance(c);
      if (f.mode === "attente") return !c.sync || c.sync.statut !== "synced";
      if (f.mode === "cv") return !!c.cv_remis;
      return true;
    });
    var q = h("input", { type: "search", id: "qc", placeholder: "Rechercher un contact", "aria-label": "Rechercher un contact", value: f.q });
    q.addEventListener("input", function () { f.q = q.value; var pos = q.selectionStart; vueContacts(); var n = $("#qc"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} });
    rendre(h("p", { class: "surtitre" }, "Carnet du salon"), h("h2", null, "Contacts (" + l.length + ")"), q,
      h("div", { class: "puces" }, [["tous", "Tous"], ["relance", "À relancer"], ["attente", "Non synchronisés"], ["cv", "CV remis"]].map(function (m) { return h("button", { class: "puce", "aria-pressed": f.mode === m[0] ? "true" : "false", onclick: function () { f.mode = m[0]; vueContacts(); } }, m[1]); })),
      l.length ? l.map(carteContact) : h("div", { class: "vide" }, ic("contacts"), S.contacts.length ? "Aucun contact ne correspond." : "Aucun contact pour l'instant. Ouvrir une entreprise, puis toucher le bouton orange « Contact »."),
      S.contacts.length ? h("button", { class: "second gros", onclick: exporterCsv }, ic("telecharger"), "Exporter en tableau (CSV)") : null);
  }

  /* Tableau de bord */
  function vueBord() {
    var C = S.contacts, ents = {}, inter = {}; C.forEach(function (c) { ents[c.entreprise_id] = 1; if (c.interet === "Fort" || c.interet === "Moyen") inter[c.entreprise_id] = 1; });
    var relances = C.filter(estRelance), attente = C.filter(function (c) { return c.statut_suivi === "En attente de réponse"; }), rdv = C.filter(function (c) { return c.statut_suivi === "Rendez-vous prévu"; });
    var actions = C.filter(function (c) { return c.prochaine_action && c.statut_suivi !== "Clos"; });
    var ids = Object.keys(S.selection), vusSel = ids.filter(function (id) { return ents[id]; }).length;
    function n(v, lib, icone, i) { return h("div", { class: "chiffre", style: "--i:" + i }, ic(icone), h("b", null, v), lib); }
    rendre(h("p", { class: "surtitre" }, "Salon SIREXE 2026"), h("h2", null, "Bilan"),
      h("div", { class: "grille" },
        ids.length ? h("div", { class: "chiffre large" }, ic("cible"), h("b", null, vusSel + " / " + ids.length), "entreprises de ma sélection déjà rencontrées", h("div", { class: "jauge" }, h("span", { style: "width:" + Math.round(100 * vusSel / ids.length) + "%" }))) : null,
        n(Object.keys(ents).length, "entreprises rencontrées", "entreprise", 1), n(C.length, "contacts enregistrés", "contacts", 2), n(relances.length, "à relancer", "relance", 3), n(rdv.length, "rendez-vous ou suivis prévus", "stage", 4),
        n(C.filter(function (c) { return c.cv_remis; }).length, "CV remis", "cv", 5), n(Object.keys(inter).length, "entreprises intéressées", "etoile", 6), n(attente.length, "en attente de réponse", "parole", 7), n(C.filter(function (c) { return !c.sync || c.sync.statut !== "synced"; }).length, "à synchroniser", "nuage", 8)),
      h("h3", null, ic("relance"), "À relancer"), relances.length ? relances.map(carteContact) : h("p", { class: "aide" }, "Rien à relancer."),
      h("h3", null, ic("cible"), "Actions à réaliser"), actions.length ? actions.map(function (c, i) { return h("a", { class: "carte", href: "#/contact/" + encodeURIComponent(c.id), style: "--i:" + i }, h("span", { class: "avatar s-personne" }, ic("cible")), h("span", { class: "corps" }, h("b", null, c.prochaine_action), h("span", { class: "meta" }, [c.entreprise_nom, [c.prenoms, c.nom].filter(Boolean).join(" ")].filter(Boolean).join(" · "))), ic("fleche", "fleche")); }) : h("p", { class: "aide" }, "Aucune action notée."));
  }

  /* Plans officiels */
  var PLANS = [["hall1", "Hall 1", "plans/hall1.png"], ["hall2", "Hall 2", "plans/hall2.png"], ["esplanade", "Esplanade", "plans/esplanade.png"]];
  function vuePlans() {
    var cur = PLANS[0], zoom = 100, img = h("img", { alt: "Plan officiel", src: cur[2], style: "width:100%" }), zone = h("div", { class: "plan", tabindex: "0", "aria-label": "Plan, défiler pour se déplacer" }, img);
    function appliquer() { img.style.width = zoom + "%"; }
    function bt(txt, f, cl) { return h("button", { class: "petit " + (cl || ""), onclick: f }, txt); }
    var sel = h("div", { class: "puces" }, PLANS.map(function (p) { return h("button", { class: "puce", "aria-pressed": p === cur ? "true" : "false", onclick: function (ev) { cur = p; img.src = p[2]; img.alt = "Plan officiel : " + p[1]; zoom = 100; appliquer(); sel.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", b === ev.target ? "true" : "false"); }); } }, p[1]); }));
    rendre(h("h2", null, "Plans officiels"), sel,
      h("div", { class: "ligne", style: "margin-bottom:8px" }, bt("Zoom +", function () { zoom = Math.min(400, zoom + 40); appliquer(); }), bt("Zoom −", function () { zoom = Math.max(100, zoom - 40); appliquer(); }), bt("Ajuster", function () { zoom = 100; appliquer(); }, "second")),
      zone, h("p", { class: "note" }, "Plans publiés par sirexe.ci (copies du 2026-11-17). Ils montrent les stands avec les noms, sans coordonnées ni numéros lisibles : aucune position n'est ajoutée. Les pavillons Mines, Pétrole et Énergie sont repérables par leur couleur."));
  }

  /* Réglages */
  function exporter(nom, contenu, type) {
    var u = URL.createObjectURL(new Blob([contenu], { type: type })), a = h("a", { href: u, download: nom }); document.body.append(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000);
  }
  function exporterCsv() {
    var cols = ["id", "rencontre_le", "entreprise_nom", "secteur", "hall", "stand", "nom", "prenoms", "fonction", "service", "email", "telephone", "profil_pro", "autres_coordonnees", "sujet", "interet", "types_stage", "cv_remis", "documents_demandes", "conseils", "infos", "prochaine_action", "date_relance", "statut_suivi"];
    function cel(x) { var s = Array.isArray(x) ? x.join(" / ") : x == null ? "" : String(x); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }   // neutralise les formules Excel
    exporter("sirexe-contacts-" + aujourdhui() + ".csv", "﻿" + cols.join(";") + "\r\n" + S.contacts.map(function (c) { return cols.map(function (k) { return cel(c[k]); }).join(";"); }).join("\r\n"), "text/csv;charset=utf-8");
  }
  function vueReglages() {
    var c = S.cfg || { owner: "diakitedaoudabakarypro-sketch", repo: "sirexe-2026-donnees", branch: "main", dossier: "contacts", token: "" };
    var form = h("form", { novalidate: true, autocomplete: "off" },
      h("h3", null, "Synchronisation GitHub"),
      champ("g-owner", "Compte GitHub", "text", c.owner, { ph: "votre-compte" }), champ("g-repo", "Dépôt PRIVÉ de destination", "text", c.repo, { ph: "sirexe-contacts" }),
      champ("g-branch", "Branche", "text", c.branch || "main"), champ("g-dossier", "Dossier", "text", c.dossier || "contacts"),
      h("label", { for: "g-token" }, "Jeton d'accès GitHub"), h("input", { id: "g-token", type: "password", autocomplete: "off", value: c.token, placeholder: "github_pat_…" }),
      h("p", { class: "aide" }, "Le jeton reste dans ce téléphone, jamais dans le code ni dans le dépôt."),
      h("p", { class: "erreur", id: "err-g", hidden: true }),
      h("div", { class: "ligne", style: "margin-top:10px" }, h("button", { type: "submit" }, "Enregistrer"), h("button", { type: "button", class: "second", id: "bt-test" }, "Tester la connexion")));
    function lire() { return { owner: $("#g-owner").value.trim(), repo: $("#g-repo").value.trim(), branch: $("#g-branch").value.trim() || "main", dossier: ($("#g-dossier").value.trim() || "contacts").replace(/^\/+|\/+$/g, ""), token: $("#g-token").value.trim() }; }
    function msg(t, bon) { var n = $("#err-g"); n.textContent = t; n.hidden = !t; n.style.color = bon ? "var(--ok)" : ""; }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault(); var n = lire();
      if (!/^[\w.-]+$/.test(n.owner) || !/^[\w.-]+$/.test(n.repo)) return msg("Compte et dépôt : lettres, chiffres, tiret, point ou tiret bas seulement.");
      ecrireMeta("github", n).then(function () { S.cfg = n; msg("Réglages enregistrés.", true); majPastille(); synchroniser(false); }, function () { msg("Enregistrement impossible sur ce téléphone."); });
    });
    form.querySelector("#bt-test").addEventListener("click", function () {
      var n = lire(); if (!n.token || !n.owner || !n.repo) return msg("Renseigner compte, dépôt et jeton.");
      msg("Test en cours…", true);
      gh(n, "GET", "").then(function (r) {
        if (!r.ok) throw erreurHttp(r);
        return r.json().then(function (j) {
          if (!j.private) return msg("ATTENTION : ce dépôt n'est pas privé. Ne pas l'utiliser pour des contacts.");
          if (j.permissions && j.permissions.push === false) return msg("Dépôt privé trouvé, mais ce jeton ne peut pas écrire (permission « Contents : Read and write »).");
          msg("Connexion réussie : dépôt privé « " + j.full_name + " », écriture autorisée.", true);
        });
      }).catch(function (e) { msg(e.message || "Échec du test."); });
    });
    var att = S.contacts.filter(function (x) { return !x.sync || x.sync.statut !== "synced"; }).length;
    rendre(h("p", { class: "surtitre" }, "Application"), h("h2", null, "Réglages"),
      h("details", { open: !c.token }, h("summary", null, "Créer le jeton GitHub (une seule fois, 3 minutes)"), h("div", null, h("ol", { class: "liste" },
        h("li", null, "Ouvrir ", h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener noreferrer" }, "github.com/settings/personal-access-tokens/new"), " (connecté à son compte GitHub)."),
        h("li", null, "Token name : sirexe-telephone. Expiration : 30 days."),
        h("li", null, "Repository access : « Only select repositories », puis cocher uniquement « sirexe-2026-donnees »."),
        h("li", null, "Permissions, Repository permissions, Contents : « Read and write ». Rien d'autre."),
        h("li", null, "Generate token, copier le jeton (github_pat_…, affiché une seule fois), le coller ci-dessous, Enregistrer, puis Tester la connexion.")))),
      h("div", { class: "groupe" }, form),
      h("div", { class: "groupe" }, h("h3", null, ic("nuage"), "Synchroniser"), h("p", { class: "aide" }, att + " contact(s) en attente. L'envoi repart tout seul au retour de la connexion."),
        h("button", { class: "gros", onclick: function () { synchroniser(true); } }, "Synchroniser maintenant")),
      h("div", { class: "groupe" }, h("h3", null, ic("telecharger"), "Sauvegarde sur le téléphone"),
        h("div", { class: "ligne" }, h("button", { class: "second", onclick: function () { exporter("sirexe-sauvegarde-" + aujourdhui() + ".json", JSON.stringify(S.contacts, null, 2), "application/json"); } }, "Exporter tout (JSON)"), h("button", { class: "second", onclick: exporterCsv }, "Exporter (CSV)"))),
      h("details", null, h("summary", null, "Journal de synchronisation (sans données personnelles)"), h("div", null, S.journal.length ? h("ul", { class: "liste" }, S.journal.slice(0, 15).map(function (j) { return h("li", null, fmt(j.le) + " · " + j.id + " · " + j.resultat); })) : h("p", { class: "aide" }, "Aucun envoi."))),
      h("p", { class: "aide" }, "Version " + APP_VERSION + " · mise à jour automatique · " + S.exposants.length + " exposants · annuaire du " + fmtJour((S.extrait || "").slice(0, 10))));
  }

  /* ---------- démarrage ---------- */
  function fetchJson(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function demarrer() {
    var plans = Promise.all([fetchJson("data/exposants.json"), fetchJson("data/selection.json").catch(function () { return { entreprises: [] }; })]);
    return db().then(function () { return Promise.all([plans, chargerContacts(), lireMeta("github"), lireMeta("journal")]); }, function (e) { throw { stockage: true, e: e }; }).then(function (r) {
      S.exposants = r[0][0].exposants; S.extrait = r[0][0].extrait_le; S.selectionNote = r[0][1].note || "";
      (r[0][1].entreprises || []).forEach(function (p) { S.selection[p.id] = p; });
      if (Object.keys(S.selection).length) S.filtre.secteur = "prio";   // l'accueil montre d'abord ma sélection
      document.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest(".bas a, .puce, .fab, .segment button, .gros, .actions .btn")) vib(); }, true);
      try { if (sessionStorage.getItem("sirexe-maj")) { sessionStorage.removeItem("sirexe-maj"); setTimeout(function () { toast("Application mise à jour : version " + APP_VERSION); }, 700); } } catch (e) {}
      S.cfg = r[2]; S.journal = r[3] || [];
      window.addEventListener("hashchange", vueCourante);
      window.addEventListener("online", function () { majPastille(); synchroniser(false); });
      window.addEventListener("offline", majPastille);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) synchroniser(false); });
      setInterval(function () { synchroniser(false); }, 60000);
      vueCourante(); S.pret = true; synchroniser(false);
    }).catch(function (e) {
      if (window.console) console.error("Démarrage SIREXE :", e && e.e || e);
      if (e && e.stockage) bloquant("Ce navigateur refuse d'enregistrer des données (navigation privée ou stockage bloqué). Ouvrir l'application dans Chrome en navigation normale : sans cela, les contacts seraient perdus.");
      else rendre(h("p", { class: "note" }, "Impossible de charger les données de l'application. Rouvrir avec une connexion une première fois."));
    });
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    /* Mise à jour automatique (souhait de Daouda) : chaque publication s'installe seule à l'ouverture avec internet.
       Garde-fou : jamais de rechargement pendant une saisie de contact ; la mise à jour attend la fin du formulaire. */
    var avaitVersion = !!navigator.serviceWorker.controller, enAttente = false;   // première visite : ni bandeau ni rechargement
    function saisieEnCours() { return /^#\/(ajout|contact)\//.test(location.hash || ""); }
    function recharger() { if (window.__rechargement) return; window.__rechargement = true; try { sessionStorage.setItem("sirexe-maj", "1"); } catch (e) {} location.reload(); }
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
      function verifier() { if (navigator.onLine) reg.update().catch(function () {}); }
      document.addEventListener("visibilitychange", function () { if (!document.hidden) verifier(); });
      setInterval(verifier, 5 * 60000);
    }).catch(function () {});
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!avaitVersion) return;
      if (saisieEnCours()) { enAttente = true; $("#maj").hidden = false; $("#btn-maj").onclick = recharger; return; }
      recharger();
    });
    window.addEventListener("hashchange", function () { if (enAttente && !saisieEnCours()) recharger(); });
  }
  demarrer();
})();
