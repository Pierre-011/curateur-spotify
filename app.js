/* Curator Desk — GitHub-backed JSON storage. No Spotify API. */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[c]));

  const validSpotifyUrl = s =>
    !s || /^https:\/\/open\.spotify\.com\/(track|playlist|album)\/[A-Za-z0-9]+/.test(s);

  const TOKEN_KEY = "curatorDesk.githubToken";
  const CONFIG_KEY = "curatorDesk.githubRepoConfig";

  const savedConfig = (() => {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    } catch {
      return {};
    }
  })();

  const state = {
    owner: savedConfig.owner || "",
    repo: savedConfig.repo || "",
    branch: savedConfig.branch || "main",
    token: localStorage.getItem(TOKEN_KEY) || "",
    data: {
      playlists: [],
      tracks: [],
      settings: { soonDays: 7 }
    },
    sha: null,
    path: "data/curator.json",
    connected: false,
    busy: false
  };

  const dateLabel = s =>
    s
      ? new Date(`${s}T12:00:00`).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        })
      : "—";

  const daysUntil = s => {
    if (!s) return null;

    const [y, m, d] = s.split("-").map(Number);
    const target = Date.UTC(y, m - 1, d);
    const now = new Date();
    const current = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    return Math.round((target - current) / 86400000);
  };

  function getStatus(t) {
    if (t.status === "removed") {
      return { key: "removed", label: "Retiré", tone: "gray" };
    }

    const start = daysUntil(t.placementStart);
    const end = daysUntil(t.placementEnd);

    if (start !== null && start > 0) {
      return {
        key: "upcoming",
        label: `Débute dans ${start} j`,
        tone: "gray"
      };
    }

    if (end !== null && end < 0) {
      return {
        key: "overdue",
        label: `Retard ${Math.abs(end)} j`,
        tone: "red"
      };
    }

    if (
      end !== null &&
      end <= (Number(state.data.settings?.soonDays) || 7)
    ) {
      return {
        key: "soon",
        label: end === 0 ? "Fin aujourd'hui" : `Fin dans ${end} j`,
        tone: "yellow"
      };
    }

    return { key: "active", label: "En cours", tone: "green" };
  }

  const playlistById = id =>
    state.data.playlists.find(p => p.id === id);

  const trackLink = t =>
    validSpotifyUrl(t.spotifyUrl) && t.spotifyUrl
      ? `<a href="${esc(t.spotifyUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>`
      : "";

  function trackRow(t, actions = true) {
    const s = getStatus(t);
    const p = playlistById(t.playlistId);

    return `
      <tr>
        <td>
          <div class="track-name">${esc(t.title)}</div>
          <div class="subline">${esc(t.artist)}</div>
        </td>
        <td>${esc(p?.name || "Playlist supprimée")}</td>
        <td>${dateLabel(t.placementEnd)}</td>
        <td><span class="badge ${s.tone}">${esc(s.label)}</span></td>
        <td>${trackLink(t)}</td>
        ${
          actions
            ? `<td>
                <div class="row-actions">
                  <button class="small-btn" data-edit-track="${esc(t.id)}">Modifier</button>
                  ${
                    t.status === "removed"
                      ? `<button class="small-btn" data-restore-track="${esc(t.id)}">Réactiver</button>`
                      : `<button class="small-btn" data-remove-track="${esc(t.id)}">Retiré</button>`
                  }
                  <button class="small-btn" data-delete-track="${esc(t.id)}" aria-label="Supprimer">✕</button>
                </div>
              </td>`
            : ""
        }
      </tr>
    `;
  }

  function tableHtml(items, actions = true) {
    if (!items.length) {
      return `
        <div class="empty">
          Rien à afficher pour le moment.
          Ajoute un placement pour commencer.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Morceau / artiste</th>
              <th>Playlist</th>
              <th>Fin du placement</th>
              <th>Statut</th>
              <th>Lien</th>
              ${actions ? "<th>Actions</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${items.map(t => trackRow(t, actions)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDashboard() {
    const active = state.data.tracks.filter(t =>
      t.status !== "removed" &&
      ["active", "soon", "overdue"].includes(getStatus(t).key)
    );

    const soon = state.data.tracks.filter(
      t => getStatus(t).key === "soon"
    );

    const overdue = state.data.tracks.filter(
      t => getStatus(t).key === "overdue"
    );

    $("statPlaylists").textContent =
      state.data.playlists.filter(p => p.active !== false).length;

    $("statActive").textContent = active.length;
    $("statSoon").textContent = soon.length;
    $("statOverdue").textContent = overdue.length;

    const priorities = state.data.tracks
      .filter(t => ["overdue", "soon"].includes(getStatus(t).key))
      .sort(
        (a, b) =>
          (daysUntil(a.placementEnd) ?? 9999) -
          (daysUntil(b.placementEnd) ?? 9999)
      );

    $("priorityList").innerHTML =
      tableHtml(priorities.slice(0, 8), true);

    const recent = [...state.data.tracks]
      .sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || "")
      )
      .slice(0, 5);

    $("recentList").innerHTML = tableHtml(recent, true);
  }

  function renderPlacements() {
    const q = $("placementSearch").value
      .trim()
      .toLocaleLowerCase("fr");

    const filter = $("statusFilter").value;

    const rows = state.data.tracks
      .filter(t => {
        const p = playlistById(t.playlistId);

        const hay = [
          t.title,
          t.artist,
          p?.name,
          t.notes
        ].join(" ").toLocaleLowerCase("fr");

        const s = getStatus(t).key;

        return (!q || hay.includes(q)) &&
          (filter === "all" || s === filter);
      })
      .sort((a, b) =>
        (a.placementEnd || "9999").localeCompare(b.placementEnd || "9999")
      );

    $("placementsList").innerHTML = tableHtml(rows, true);
  }

  function renderPlaylists() {
    $("playlistsGrid").innerHTML = state.data.playlists.length
      ? state.data.playlists.map(p => {
          const tracks = state.data.tracks.filter(
            t => t.playlistId === p.id
          );

          const active = tracks.filter(
            t => t.status !== "removed"
          ).length;

          return `
            <article class="playlist-card">
              <div class="playlist-symbol">♫</div>
              <h3>${esc(p.name)}</h3>
              <p>${esc(p.genre || "Genre non renseigné")}</p>
              <p>${esc(p.description || "Aucune description.")}</p>
              <div class="playlist-meta">
                <span>
                  ${active} placement${active !== 1 ? "s" : ""}
                  actif${active !== 1 ? "s" : ""}
                </span>
                <span>
                  ${
                    p.spotifyUrl && validSpotifyUrl(p.spotifyUrl)
                      ? `<a href="${esc(p.spotifyUrl)}" target="_blank" rel="noopener">Spotify ↗</a>`
                      : ""
                  }
                </span>
              </div>
              <div class="playlist-actions">
                <button class="small-btn" data-edit-playlist="${esc(p.id)}">Modifier</button>
                <button class="small-btn" data-delete-playlist="${esc(p.id)}">Supprimer</button>
              </div>
            </article>
          `;
        }).join("")
      : `
        <div class="empty">
          Aucune playlist. Ajoute ta première playlist pour commencer.
        </div>
      `;
  }

  function renderAll() {
    renderDashboard();
    renderPlacements();
    renderPlaylists();
    updateConnectionUi();
  }

  function showNotice(msg, error = false) {
    const n = $("notice");
    n.textContent = msg;
    n.classList.remove("hidden", "error");

    if (error) n.classList.add("error");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setStatus(msg, error = false) {
    $("connectionStatus").textContent = msg;
    $("connectionStatus").classList.toggle("error", error);
  }

  function updateConnectionUi() {
    $("connectionLabel").textContent = state.connected
      ? `${state.owner}/${state.repo}`
      : "Non connecté à GitHub";

    const dot = document.querySelector(".status-dot");

    if (dot) {
      dot.style.background = state.connected
        ? "var(--green)"
        : "var(--yellow)";
    }

    $("disconnectBtn").disabled = !state.connected;
  }

  /* Connexion à l'API GitHub avec un token classique. */
  async function gh(path, options = {}) {
    if (!state.token) {
      throw new Error("Aucun jeton GitHub n'est enregistré.");
    }

    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": `Bearer ${state.token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    let body = {};

    try {
      body = text ? JSON.parse(text) : {};
    } catch {}

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Jeton invalide ou expiré");
      }

      if (response.status === 403) {
        throw new Error("Accès refusé. Vérifie les permissions du jeton.");
      }

      if (response.status === 404) {
        throw new Error("Dépôt ou fichier introuvable");
      }

      throw new Error(body.message || `GitHub a répondu ${response.status}`);
    }

    return body;
  }

  /* Connexion manuelle, puis mémorisation dans Edge. */
  async function connect(automatic = false) {
    const owner = $("repoOwner").value.trim() || state.owner;
    const repo = $("repoName").value.trim() || state.repo;
    const branch = $("branchName").value.trim() || state.branch || "main";

    const token =
      $("tokenInput").value.trim() ||
      state.token ||
      localStorage.getItem(TOKEN_KEY) ||
      "";

    if (!owner || !repo || !token) {
      setStatus("Renseigne le compte, le dépôt et le jeton.", true);
      return;
    }

    if (
      !/^[A-Za-z0-9_.-]+$/.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repo)
    ) {
      setStatus("Nom de compte ou de dépôt invalide.", true);
      return;
    }

    state.owner = owner;
    state.repo = repo;
    state.branch = branch;
    state.token = token;

    $("connectBtn").disabled = true;

    setStatus(
      automatic
        ? "Restauration de la connexion GitHub…"
        : "Connexion et chargement…"
    );

    try {
      await gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      );

      localStorage.setItem(TOKEN_KEY, token);

      localStorage.setItem(
        CONFIG_KEY,
        JSON.stringify({ owner, repo, branch })
      );

      $("tokenInput").value = token;

      await loadData();

      state.connected = true;

      setStatus(
        "Connecté. La connexion sera mémorisée dans ce navigateur."
      );

      if (!automatic) {
        showNotice(
          "Données chargées depuis GitHub. La connexion est mémorisée dans ce navigateur et les modifications seront enregistrées dans le dépôt privé."
        );
      }

      renderAll();
    } catch (e) {
      state.connected = false;

      setStatus(
        `${e.message}. Vérifie le dépôt, le jeton et ses permissions.`,
        true
      );
    } finally {
      $("connectBtn").disabled = false;
      updateConnectionUi();
    }
  }

  /* Chargement des données du dépôt privé. */
  async function loadData() {
    const url =
      `/repos/${encodeURIComponent(state.owner)}` +
      `/${encodeURIComponent(state.repo)}` +
      `/contents/${state.path.split("/").map(encodeURIComponent).join("/")}` +
      `?ref=${encodeURIComponent(state.branch)}`;

    try {
      const f = await gh(url);

      state.sha = f.sha;

      const decoded = decodeURIComponent(
        escape(atob((f.content || "").replace(/\n/g, "")))
      );

      const data = JSON.parse(decoded);

      state.data = {
        playlists: Array.isArray(data.playlists) ? data.playlists : [],
        tracks: Array.isArray(data.tracks) ? data.tracks : [],
        settings: data.settings || { soonDays: 7 }
      };
    } catch (e) {
      if (
        String(e.message).includes("Not Found") ||
        String(e.message).includes("introuvable")
      ) {
        state.sha = null;

        state.data = {
          playlists: [],
          tracks: [],
          settings: { soonDays: 7 }
        };

        await saveData("Initialiser les données Curator Desk");
      } else {
        throw e;
      }
    }
  }

  /* Enregistrement des données sur GitHub. */
  async function saveData(
    message = "Mettre à jour les données Curator Desk"
  ) {
    if (!state.connected && !state.token) {
      throw new Error("Connecte-toi à GitHub avant d'enregistrer.");
    }

    if (state.busy) {
      throw new Error(
        "Un enregistrement est déjà en cours. Réessaie dans quelques secondes."
      );
    }

    state.busy = true;
    setStatus("Enregistrement sur GitHub…");

    try {
      const path =
        `/repos/${encodeURIComponent(state.owner)}` +
        `/${encodeURIComponent(state.repo)}` +
        `/contents/${state.path.split("/").map(encodeURIComponent).join("/")}`;

      const payload = {
        message,
        content: btoa(
          unescape(
            encodeURIComponent(
              JSON.stringify({
                ...state.data,
                updatedAt: new Date().toISOString()
              }, null, 2)
            )
          )
        ),
        branch: state.branch
      };

      if (state.sha) {
        payload.sha = state.sha;
      }

      const result = await gh(path, {
        method: "PUT",
        body: JSON.stringify(payload)
      });

      state.sha = result.content.sha;
      state.connected = true;

      setStatus("Enregistré sur GitHub ✓");
      updateConnectionUi();
    } finally {
      state.busy = false;
    }
  }

  async function mutate(fn, message) {
    if (!state.connected) {
      showNotice(
        "Connecte-toi à GitHub dans « Connexion & données » avant de modifier les données.",
        true
      );
      return;
    }

    const before = JSON.stringify(state.data);

    fn();

    try {
      await saveData(message);
      renderAll();
      showNotice("Modifications enregistrées sur GitHub.");
    } catch (e) {
      state.data = JSON.parse(before);
      renderAll();
      showNotice(`Enregistrement impossible : ${e.message}`, true);
    }
  }

  /* Formulaire de placement. */
  function openPlacement(id = null) {
    if (!state.data.playlists.length) {
      showNotice(
        "Crée d'abord une playlist avant d'ajouter un placement.",
        true
      );

      go("playlists");
      return;
    }

    const t = id
      ? state.data.tracks.find(x => x.id === id)
      : null;

    $("placementForm").reset();
    $("placementId").value = t?.id || "";

    $("placementModalTitle").textContent = t
      ? "Modifier le placement"
      : "Nouveau placement";

    $("trackTitle").value = t?.title || "";
    $("trackArtist").value = t?.artist || "";

    $("trackPlaylist").innerHTML = state.data.playlists
      .map(p =>
        `<option value="${esc(p.id)}">${esc(p.name)}</option>`
      )
      .join("");

    $("trackPlaylist").value =
      t?.playlistId || state.data.playlists[0].id;

    $("trackUrl").value = t?.spotifyUrl || "";
    $("trackStart").value = t?.placementStart || todayISO();
    $("trackEnd").value = t?.placementEnd || "";
    $("trackNotes").value = t?.notes || "";

    $("placementDialog").showModal();
  }

  /* Formulaire de playlist. */
  function openPlaylist(id = null) {
    const p = id
      ? state.data.playlists.find(x => x.id === id)
      : null;

    $("playlistForm").reset();
    $("playlistId").value = p?.id || "";

    $("playlistModalTitle").textContent = p
      ? "Modifier la playlist"
      : "Nouvelle playlist";

    $("playlistTitle").value = p?.name || "";
    $("playlistUrl").value = p?.spotifyUrl || "";
    $("playlistGenre").value = p?.genre || "";
    $("playlistDescription").value = p?.description || "";

    $("playlistDialog").showModal();
  }

  async function submitPlacement(e) {
    e.preventDefault();

    const id = $("placementId").value;
    const title = $("trackTitle").value.trim();
    const artist = $("trackArtist").value.trim();
    const spotifyUrl = $("trackUrl").value.trim();
    const start = $("trackStart").value;
    const end = $("trackEnd").value;

    if (start && end && end < start) {
      showNotice(
        "La date de fin doit être égale ou postérieure à la date de début.",
        true
      );
      return;
    }

    if (!validSpotifyUrl(spotifyUrl)) {
      showNotice(
        "Le lien doit être un lien Spotify valide (track, playlist ou album).",
        true
      );
      return;
    }

    const old = id
      ? state.data.tracks.find(t => t.id === id)
      : null;

    const record = {
      id: id || uid("track"),
      title,
      artist,
      spotifyUrl,
      playlistId: $("trackPlaylist").value,
      placementStart: start,
      placementEnd: end,
      notes: $("trackNotes").value.trim(),
      status: old?.status === "removed" ? "removed" : "active",
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    $("placementDialog").close();

    await mutate(() => {
      const i = state.data.tracks.findIndex(
        t => t.id === record.id
      );

      if (i >= 0) {
        state.data.tracks[i] = record;
      } else {
        state.data.tracks.push(record);
      }
    }, id ? "Modifier un placement" : "Ajouter un placement");
  }

  async function submitPlaylist(e) {
    e.preventDefault();

    const id = $("playlistId").value;
    const spotifyUrl = $("playlistUrl").value.trim();

    if (!validSpotifyUrl(spotifyUrl)) {
      showNotice("Le lien doit être un lien Spotify valide.", true);
      return;
    }

    const p = {
      id: id || uid("playlist"),
      name: $("playlistTitle").value.trim(),
      spotifyUrl,
      genre: $("playlistGenre").value.trim(),
      description: $("playlistDescription").value.trim(),
      active: true,
      createdAt: id
        ? (
            state.data.playlists.find(x => x.id === id)?.createdAt ||
            new Date().toISOString()
          )
        : new Date().toISOString()
    };

    $("playlistDialog").close();

    await mutate(() => {
      const i = state.data.playlists.findIndex(x => x.id === p.id);

      if (i >= 0) {
        state.data.playlists[i] = p;
      } else {
        state.data.playlists.push(p);
      }
    }, id ? "Modifier une playlist" : "Ajouter une playlist");
  }

  /* Navigation. */
  function go(view) {
    document.querySelectorAll(".view").forEach(el =>
      el.classList.add("hidden")
    );

    $(`view-${view}`).classList.remove("hidden");

    document.querySelectorAll(".nav-item").forEach(b =>
      b.classList.toggle("active", b.dataset.view === view)
    );

    const titles = {
      dashboard: "Vue d'ensemble",
      placements: "Placements",
      playlists: "Playlists",
      settings: "Connexion & données"
    };

    $("pageTitle").textContent = titles[view] || "Curator Desk";

    if (view === "placements") {
      renderPlacements();
    }
  }

  /* Événements. */
  document.querySelectorAll(".nav-item").forEach(b =>
    b.addEventListener("click", () => go(b.dataset.view))
  );

  document.querySelectorAll("[data-goto]").forEach(b =>
    b.addEventListener("click", () => go(b.dataset.goto))
  );

  $("todayLabel").textContent = new Date().toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });

  $("quickAdd").addEventListener("click", () => openPlacement());
  $("addPlacement").addEventListener("click", () => openPlacement());
  $("addPlaylist").addEventListener("click", () => openPlaylist());

  $("placementForm").addEventListener("submit", submitPlacement);
  $("playlistForm").addEventListener("submit", submitPlaylist);

  $("placementSearch").addEventListener("input", renderPlacements);
  $("statusFilter").addEventListener("change", renderPlacements);

  $("connectBtn").addEventListener("click", () => connect());

  /* Déconnexion et suppression du token mémorisé. */
  $("disconnectBtn").addEventListener("click", () => {
    state.token = "";
    state.connected = false;
    state.sha = null;

    localStorage.removeItem(TOKEN_KEY);
    $("tokenInput").value = "";

    setStatus(
      "Déconnecté. Le jeton mémorisé a été effacé de ce navigateur."
    );

    updateConnectionUi();
  });

  document.querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", () => $(b.dataset.close).close())
  );

  document.body.addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;

    if (b.dataset.editTrack) {
      openPlacement(b.dataset.editTrack);
    }

    if (b.dataset.removeTrack) {
      await mutate(() => {
        const t = state.data.tracks.find(
          x => x.id === b.dataset.removeTrack
        );

        if (t) t.status = "removed";
      }, "Marquer un placement comme retiré");
    }

    if (b.dataset.restoreTrack) {
      await mutate(() => {
        const t = state.data.tracks.find(
          x => x.id === b.dataset.restoreTrack
        );

        if (t) t.status = "active";
      }, "Réactiver un placement");
    }

    if (
      b.dataset.deleteTrack &&
      confirm("Supprimer définitivement ce placement ?")
    ) {
      await mutate(() => {
        state.data.tracks = state.data.tracks.filter(
          t => t.id !== b.dataset.deleteTrack
        );
      }, "Supprimer un placement");
    }

    if (b.dataset.editPlaylist) {
      openPlaylist(b.dataset.editPlaylist);
    }

    if (b.dataset.deletePlaylist) {
      const p = state.data.playlists.find(
        x => x.id === b.dataset.deletePlaylist
      );

      if (!p) return;

      if (state.data.tracks.some(t => t.playlistId === p.id)) {
        showNotice(
          "Cette playlist contient des placements. Réaffecte ou supprime-les avant de supprimer la playlist.",
          true
        );
        return;
      }

      if (confirm(`Supprimer la playlist « ${p.name} » ?`)) {
        await mutate(() => {
          state.data.playlists = state.data.playlists.filter(
            x => x.id !== b.dataset.deletePlaylist
          );
        }, "Supprimer une playlist");
      }
    }
  });

  /* Export JSON. */
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob(
      [JSON.stringify(state.data, null, 2)],
      { type: "application/json" }
    );

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `curator-backup-${todayISO()}.json`;
    a.click();

    URL.revokeObjectURL(a.href);
  });

  /* Import JSON. */
  $("importFile").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const d = JSON.parse(await file.text());

      if (!Array.isArray(d.playlists) || !Array.isArray(d.tracks)) {
        throw new Error("Format de sauvegarde invalide.");
      }

      if (!confirm("Remplacer les données actuelles par cette sauvegarde ?")) {
        return;
      }

      await mutate(() => {
        state.data = {
          playlists: d.playlists,
          tracks: d.tracks,
          settings: d.settings || { soonDays: 7 }
        };
      }, "Restaurer une sauvegarde JSON");
    } catch (err) {
      showNotice(`Import impossible : ${err.message}`, true);
    } finally {
      e.target.value = "";
    }
  });

  /* Initialisation et restauration de la connexion. */
  if (state.owner) $("repoOwner").value = state.owner;
  if (state.repo) $("repoName").value = state.repo;

  $("branchName").value = state.branch;

  if (state.token) {
    $("tokenInput").value = state.token;
  }

  renderAll();

  /* Si le token et la configuration sont enregistrés, reconnecte-toi. */
  if (state.token && state.owner && state.repo) {
    connect(true);
  }
})();
