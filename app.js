/* Curator Desk — GitHub App Device Flow + stockage JSON */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  // Client ID public de l'application GitHub.
  const CLIENT_ID = "Iv23liqABtr8bq6w625x";

  const DEVICE_CODE_URL = "https://github.com/login/device/code";
  const TOKEN_URL = "https://github.com/login/oauth/access_token";
  const API_URL = "https://api.github.com";

  const TOKEN_KEY = "curatorDesk.githubRefreshToken";
  const CONFIG_KEY = "curatorDesk.githubRepoConfig";

  const state = {
    owner: "",
    repo: "",
    branch: "main",
    token: "",
    refreshToken: localStorage.getItem(TOKEN_KEY) || "",
    data: {
      playlists: [],
      tracks: [],
      settings: { soonDays: 7 }
    },
    sha: null,
    path: "data/curator.json",
    connected: false,
    busy: false,
    deviceAuthInProgress: false,
    devicePollTimer: null
  };

  /* =========================================================
     UTILITAIRES
  ========================================================= */

  const todayISO = () => {
    const d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  };

  const uid = prefix =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  const validSpotifyUrl = value =>
    !value || /^https:\/\/open\.spotify\.com\/(track|playlist|album)\/[A-Za-z0-9]+/.test(value);

  const dateLabel = value =>
    value
      ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        })
      : "—";

  function daysUntil(value) {
    if (!value) return null;

    const [year, month, day] = value.split("-").map(Number);

    const target = Date.UTC(year, month - 1, day);
    const now = new Date();
    const current = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    return Math.round((target - current) / 86400000);
  }

  function showNotice(message, error = false) {
    const notice = $("notice");

    notice.textContent = message;
    notice.classList.remove("hidden", "error");

    if (error) notice.classList.add("error");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setStatus(message, error = false) {
    $("connectionStatus").textContent = message;
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

    $("disconnectBtn").disabled =
      !state.connected &&
      !state.refreshToken &&
      !state.deviceAuthInProgress;

    $("connectBtn").disabled = state.deviceAuthInProgress;
  }

  /* =========================================================
     CONFIGURATION LOCALE
  ========================================================= */

  function saveRepoConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      owner: state.owner,
      repo: state.repo,
      branch: state.branch
    }));
  }

  function loadRepoConfig() {
    try {
      const config = JSON.parse(
        localStorage.getItem(CONFIG_KEY) || "{}"
      );

      state.owner = config.owner || "";
      state.repo = config.repo || "";
      state.branch = config.branch || "main";

      if (state.owner) $("repoOwner").value = state.owner;
      if (state.repo) $("repoName").value = state.repo;

      $("branchName").value = state.branch;
    } catch {
      state.owner = "";
      state.repo = "";
      state.branch = "main";
    }
  }

  function storeRefreshToken(token) {
    state.refreshToken = token || "";

    if (state.refreshToken) {
      localStorage.setItem(TOKEN_KEY, state.refreshToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  /* =========================================================
     STATUT DES PLACEMENTS
  ========================================================= */

  function getStatus(track) {
    if (track.status === "removed") {
      return {
        key: "removed",
        label: "Retiré",
        tone: "gray"
      };
    }

    const start = daysUntil(track.placementStart);
    const end = daysUntil(track.placementEnd);

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

    if (end !== null && end <= (Number(state.data.settings?.soonDays) || 7)) {
      return {
        key: "soon",
        label: end === 0 ? "Fin aujourd'hui" : `Fin dans ${end} j`,
        tone: "yellow"
      };
    }

    return {
      key: "active",
      label: "En cours",
      tone: "green"
    };
  }

  const playlistById = id =>
    state.data.playlists.find(playlist => playlist.id === id);

  function trackLink(track) {
    if (!track.spotifyUrl || !validSpotifyUrl(track.spotifyUrl)) {
      return "";
    }

    return `<a href="${esc(track.spotifyUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>`;
  }

  /* =========================================================
     AFFICHAGE DES TABLEAUX
  ========================================================= */

  function trackRow(track, actions = true) {
    const status = getStatus(track);
    const playlist = playlistById(track.playlistId);

    return `
      <tr>
        <td>
          <div class="track-name">${esc(track.title)}</div>
          <div class="subline">${esc(track.artist)}</div>
        </td>

        <td>${esc(playlist?.name || "Playlist supprimée")}</td>

        <td>${dateLabel(track.placementEnd)}</td>

        <td>
          <span class="badge ${status.tone}">
            ${esc(status.label)}
          </span>
        </td>

        <td>${trackLink(track)}</td>

        ${actions ? `
          <td>
            <div class="row-actions">
              <button class="small-btn" data-edit-track="${esc(track.id)}">
                Modifier
              </button>

              ${
                track.status === "removed"
                  ? `<button class="small-btn" data-restore-track="${esc(track.id)}">Réactiver</button>`
                  : `<button class="small-btn" data-remove-track="${esc(track.id)}">Retiré</button>`
              }

              <button
                class="small-btn"
                data-delete-track="${esc(track.id)}"
                aria-label="Supprimer"
              >✕</button>
            </div>
          </td>
        ` : ""}
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
            ${items.map(track => trackRow(track, actions)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  /* =========================================================
     TABLEAU DE BORD
  ========================================================= */

  function renderDashboard() {
    const tracks = state.data.tracks;

    const active = tracks.filter(track =>
      track.status !== "removed" &&
      ["active", "soon", "overdue"].includes(getStatus(track).key)
    );

    const soon = tracks.filter(
      track => getStatus(track).key === "soon"
    );

    const overdue = tracks.filter(
      track => getStatus(track).key === "overdue"
    );

    $("statPlaylists").textContent =
      state.data.playlists.filter(p => p.active !== false).length;

    $("statActive").textContent = active.length;
    $("statSoon").textContent = soon.length;
    $("statOverdue").textContent = overdue.length;

    const priorities = tracks
      .filter(track => ["overdue", "soon"].includes(getStatus(track).key))
      .sort((a, b) =>
        (daysUntil(a.placementEnd) ?? 9999) -
        (daysUntil(b.placementEnd) ?? 9999)
      );

    $("priorityList").innerHTML =
      tableHtml(priorities.slice(0, 8), true);

    const recent = [...tracks]
      .sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || "")
      )
      .slice(0, 5);

    $("recentList").innerHTML = tableHtml(recent, true);
  }

  function renderPlacements() {
    const query = $("placementSearch").value
      .trim()
      .toLocaleLowerCase("fr");

    const filter = $("statusFilter").value;

    const rows = state.data.tracks
      .filter(track => {
        const playlist = playlistById(track.playlistId);

        const searchable = [
          track.title,
          track.artist,
          playlist?.name,
          track.notes
        ].join(" ").toLocaleLowerCase("fr");

        const status = getStatus(track).key;

        return (!query || searchable.includes(query)) &&
          (filter === "all" || status === filter);
      })
      .sort((a, b) =>
        (a.placementEnd || "9999").localeCompare(b.placementEnd || "9999")
      );

    $("placementsList").innerHTML = tableHtml(rows, true);
  }

  function renderPlaylists() {
    $("playlistsGrid").innerHTML = state.data.playlists.length
      ? state.data.playlists.map(playlist => {
          const tracks = state.data.tracks.filter(
            track => track.playlistId === playlist.id
          );

          const active = tracks.filter(
            track => track.status !== "removed"
          ).length;

          const spotifyLink =
            playlist.spotifyUrl && validSpotifyUrl(playlist.spotifyUrl)
              ? `<a href="${esc(playlist.spotifyUrl)}" target="_blank" rel="noopener noreferrer">Spotify ↗</a>`
              : "";

          return `
            <article class="playlist-card">
              <div class="playlist-symbol">♫</div>

              <h3>${esc(playlist.name)}</h3>
              <p>${esc(playlist.genre || "Genre non renseigné")}</p>
              <p>${esc(playlist.description || "Aucune description.")}</p>

              <div class="playlist-meta">
                <span>
                  ${active} placement${active !== 1 ? "s" : ""}
                  actif${active !== 1 ? "s" : ""}
                </span>
                <span>${spotifyLink}</span>
              </div>

              <div class="playlist-actions">
                <button class="small-btn" data-edit-playlist="${esc(playlist.id)}">
                  Modifier
                </button>
                <button class="small-btn" data-delete-playlist="${esc(playlist.id)}">
                  Supprimer
                </button>
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

  /* =========================================================
     DEVICE FLOW GITHUB
  ========================================================= */

  async function oauthPost(url, fields) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(fields)
    });

    const raw = await response.text();

    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}

    if (!response.ok) {
      throw new Error(
        body.error_description ||
        body.message ||
        `GitHub a répondu ${response.status}`
      );
    }

    if (body.error) {
      const messages = {
        authorization_pending:
          "Autorisation en attente. Termine la validation dans GitHub.",
        slow_down:
          "GitHub demande d'attendre un peu plus longtemps.",
        expired_token:
          "Le code d'autorisation a expiré. Recommence la connexion.",
        access_denied:
          "Autorisation refusée sur GitHub."
      };

      throw new Error(
        messages[body.error] ||
        body.error_description ||
        body.error
      );
    }

    return body;
  }

  async function requestDeviceCode() {
    const body = await oauthPost(DEVICE_CODE_URL, {
      client_id: CLIENT_ID
    });

    if (!body.device_code || !body.user_code) {
      throw new Error("GitHub n'a pas fourni de code d'autorisation.");
    }

    return body;
  }

  function showDeviceAuth(code, verificationUri) {
    $("deviceAuth").classList.remove("hidden");
    $("deviceCode").value = code;

    $("verificationLink").href =
      verificationUri || "https://github.com/login/device";

    $("deviceAuthMessage").textContent =
      "Ouvre GitHub, saisis ce code et autorise l'application. Garde cette page ouverte.";
  }

  function hideDeviceAuth() {
    $("deviceAuth").classList.add("hidden");
    $("deviceCode").value = "";
    $("deviceAuthMessage").textContent = "";
  }

  function stopDevicePolling() {
    if (state.devicePollTimer) {
      clearTimeout(state.devicePollTimer);
    }

    state.devicePollTimer = null;
    state.deviceAuthInProgress = false;
    updateConnectionUi();
  }

  async function pollForDeviceToken(device) {
    const deadline = Date.now() +
      Number(device.expires_in || 900) * 1000;

    let interval = Math.max(5, Number(device.interval) || 5);

    while (Date.now() < deadline && state.deviceAuthInProgress) {
      await new Promise(resolve => {
        state.devicePollTimer = setTimeout(resolve, interval * 1000);
      });

      state.devicePollTimer = null;

      if (!state.deviceAuthInProgress) return false;

      let body;

      try {
        body = await oauthPost(TOKEN_URL, {
          client_id: CLIENT_ID,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        });
      } catch (error) {
        const message = String(error.message);

        if (message.includes("Autorisation en attente")) {
          continue;
        }

        if (message.includes("demande d'attendre")) {
          interval += 5;
          continue;
        }

        throw error;
      }

      if (!body.access_token) {
        throw new Error("GitHub n'a pas fourni de jeton d'accès.");
      }

      state.token = body.access_token;

      if (body.refresh_token) {
        storeRefreshToken(body.refresh_token);
      } else {
        throw new Error(
          "GitHub n'a pas fourni de jeton de renouvellement. Vérifie les réglages de ton application."
        );
      }

      return true;
    }

    if (state.deviceAuthInProgress) {
      throw new Error(
        "Le code d'autorisation a expiré. Recommence la connexion."
      );
    }

    return false;
  }

  async function refreshAccessToken() {
    if (!state.refreshToken) {
      throw new Error("Reconnecte-toi à GitHub pour autoriser l'accès.");
    }

    const body = await oauthPost(TOKEN_URL, {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: state.refreshToken
    });

    if (!body.access_token) {
      throw new Error("GitHub n'a pas fourni de nouveau jeton d'accès.");
    }

    state.token = body.access_token;

    // GitHub peut faire tourner le jeton de renouvellement.
    if (body.refresh_token) {
      storeRefreshToken(body.refresh_token);
    }

    return state.token;
  }

  async function ensureAccessToken() {
    if (!state.token) {
      await refreshAccessToken();
    }
  }

  /* =========================================================
     API GITHUB
  ========================================================= */

  async function gh(path, options = {}) {
    await ensureAccessToken();

    const makeRequest = () => fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": `Bearer ${state.token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    let response = await makeRequest();

    // Si le jeton d'accès a expiré, on tente un renouvellement.
    if (response.status === 401 && state.refreshToken) {
      state.token = "";
      await refreshAccessToken();
      response = await makeRequest();
    }

    const raw = await response.text();

    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}

    if (!response.ok) {
      throw new Error(body.message || `GitHub a répondu ${response.status}`);
    }

    return body;
  }

  async function connect() {
    const owner = $("repoOwner").value.trim();
    const repo = $("repoName").value.trim();
    const branch = $("branchName").value.trim() || "main";

    if (!owner || !repo) {
      setStatus("Renseigne le compte GitHub et le dépôt.", true);
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

    saveRepoConfig();

    state.deviceAuthInProgress = true;
    updateConnectionUi();

    setStatus("Demande d'un code d'autorisation à GitHub…");

    try {
      const device = await requestDeviceCode();

      showDeviceAuth(
        device.user_code,
        device.verification_uri
      );

      setStatus("En attente de ton autorisation sur GitHub…");

      const authorized = await pollForDeviceToken(device);

      if (!authorized || !state.token) {
        throw new Error("La connexion GitHub a été interrompue.");
      }

      stopDevicePolling();

      // Vérifie l'accès au dépôt avant de charger les données.
      await gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      );

      await loadData();

      state.connected = true;

      hideDeviceAuth();

      setStatus("Connecté. Les données sont chargées depuis GitHub.");

      showNotice(
        "Données chargées depuis GitHub. Les modifications seront enregistrées dans le dépôt privé."
      );

      renderAll();
    } catch (error) {
      stopDevicePolling();

      state.connected = false;

      setStatus(
        `${error.message} Vérifie que l'application est installée sur ce dépôt et possède les permissions nécessaires.`,
        true
      );
    } finally {
      updateConnectionUi();
    }
  }

  /* =========================================================
     CHARGEMENT ET SAUVEGARDE DES DONNÉES
  ========================================================= */

  async function loadData() {
    const path = state.path
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const url =
      `/repos/${encodeURIComponent(state.owner)}` +
      `/${encodeURIComponent(state.repo)}` +
      `/contents/${path}?ref=${encodeURIComponent(state.branch)}`;

    try {
      const file = await gh(url);

      state.sha = file.sha;

      const decoded = decodeURIComponent(
        escape(atob((file.content || "").replace(/\n/g, "")))
      );

      const data = JSON.parse(decoded);

      state.data = {
        playlists: Array.isArray(data.playlists) ? data.playlists : [],
        tracks: Array.isArray(data.tracks) ? data.tracks : [],
        settings: data.settings || { soonDays: 7 }
      };
    } catch (error) {
      if (String(error.message).includes("Not Found")) {
        state.sha = null;

        state.data = {
          playlists: [],
          tracks: [],
          settings: { soonDays: 7 }
        };

        await saveData("Initialiser les données Curator Desk");
      } else {
        throw error;
      }
    }
  }

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
      const path = state.path
        .split("/")
        .map(encodeURIComponent)
        .join("/");

      const url =
        `/repos/${encodeURIComponent(state.owner)}` +
        `/${encodeURIComponent(state.repo)}` +
        `/contents/${path}`;

      const content = btoa(
        unescape(
          encodeURIComponent(
            JSON.stringify({
              ...state.data,
              updatedAt: new Date().toISOString()
            }, null, 2)
          )
        )
      );

      const payload = {
        message,
        content,
        branch: state.branch
      };

      if (state.sha) {
        payload.sha = state.sha;
      }

      const result = await gh(url, {
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

  async function mutate(callback, message) {
    if (!state.connected) {
      showNotice(
        "Connecte-toi à GitHub dans « Connexion & données » avant de modifier les données.",
        true
      );
      return;
    }

    const previousData = JSON.stringify(state.data);

    callback();

    try {
      await saveData(message);

      renderAll();
      showNotice("Modifications enregistrées sur GitHub.");
    } catch (error) {
      state.data = JSON.parse(previousData);

      renderAll();

      showNotice(
        `Enregistrement impossible : ${error.message}`,
        true
      );
    }
  }

  /* =========================================================
     FORMULAIRES
  ========================================================= */

  function openPlacement(id = null) {
    if (!state.data.playlists.length) {
      showNotice(
        "Crée d'abord une playlist avant d'ajouter un placement.",
        true
      );

      go("playlists");
      return;
    }

    const track = id
      ? state.data.tracks.find(item => item.id === id)
      : null;

    $("placementForm").reset();

    $("placementId").value = track?.id || "";

    $("placementModalTitle").textContent = track
      ? "Modifier le placement"
      : "Nouveau placement";

    $("trackTitle").value = track?.title || "";
    $("trackArtist").value = track?.artist || "";

    $("trackPlaylist").innerHTML = state.data.playlists
      .map(playlist =>
        `<option value="${esc(playlist.id)}">${esc(playlist.name)}</option>`
      )
      .join("");

    $("trackPlaylist").value =
      track?.playlistId || state.data.playlists[0].id;

    $("trackUrl").value = track?.spotifyUrl || "";
    $("trackStart").value = track?.placementStart || todayISO();
    $("trackEnd").value = track?.placementEnd || "";
    $("trackNotes").value = track?.notes || "";

    $("placementDialog").showModal();
  }

  function openPlaylist(id = null) {
    const playlist = id
      ? state.data.playlists.find(item => item.id === id)
      : null;

    $("playlistForm").reset();

    $("playlistId").value = playlist?.id || "";

    $("playlistModalTitle").textContent = playlist
      ? "Modifier la playlist"
      : "Nouvelle playlist";

    $("playlistTitle").value = playlist?.name || "";
    $("playlistUrl").value = playlist?.spotifyUrl || "";
    $("playlistGenre").value = playlist?.genre || "";
    $("playlistDescription").value = playlist?.description || "";

    $("playlistDialog").showModal();
  }

  async function submitPlacement(event) {
    event.preventDefault();

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
      ? state.data.tracks.find(track => track.id === id)
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
      const index = state.data.tracks.findIndex(
        track => track.id === record.id
      );

      if (index >= 0) {
        state.data.tracks[index] = record;
      } else {
        state.data.tracks.push(record);
      }
    }, id ? "Modifier un placement" : "Ajouter un placement");
  }

  async function submitPlaylist(event) {
    event.preventDefault();

    const id = $("playlistId").value;
    const spotifyUrl = $("playlistUrl").value.trim();

    if (!validSpotifyUrl(spotifyUrl)) {
      showNotice("Le lien doit être un lien Spotify valide.", true);
      return;
    }

    const old = id
      ? state.data.playlists.find(playlist => playlist.id === id)
      : null;

    const playlist = {
      id: id || uid("playlist"),
      name: $("playlistTitle").value.trim(),
      spotifyUrl,
      genre: $("playlistGenre").value.trim(),
      description: $("playlistDescription").value.trim(),
      active: true,
      createdAt: old?.createdAt || new Date().toISOString()
    };

    $("playlistDialog").close();

    await mutate(() => {
      const index = state.data.playlists.findIndex(
        item => item.id === playlist.id
      );

      if (index >= 0) {
        state.data.playlists[index] = playlist;
      } else {
        state.data.playlists.push(playlist);
      }
    }, id ? "Modifier une playlist" : "Ajouter une playlist");
  }

  /* =========================================================
     NAVIGATION
  ========================================================= */

  function go(view) {
    document.querySelectorAll(".view").forEach(element => {
      element.classList.add("hidden");
    });

    $(`view-${view}`).classList.remove("hidden");

    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.view === view);
    });

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

  /* =========================================================
     ÉVÉNEMENTS
  ========================================================= */

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => go(button.dataset.view));
  });

  document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () => go(button.dataset.goto));
  });

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

  $("connectBtn").addEventListener("click", connect);

  $("disconnectBtn").addEventListener("click", () => {
    if (state.devicePollTimer) {
      clearTimeout(state.devicePollTimer);
    }

    state.devicePollTimer = null;
    state.deviceAuthInProgress = false;

    state.token = "";
    state.refreshToken = "";
    state.connected = false;
    state.sha = null;

    localStorage.removeItem(TOKEN_KEY);

    hideDeviceAuth();

    setStatus(
      "Déconnecté. Le jeton de renouvellement a été effacé de ce navigateur."
    );

    updateConnectionUi();
  });

  $("copyDeviceCodeBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("deviceCode").value);
      setStatus("Code copié.");
    } catch {
      $("deviceCode").focus();
      $("deviceCode").select();
      setStatus("Sélectionne le code puis copie-le manuellement.");
    }
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => {
      $(button.dataset.close).close();
    });
  });

  document.body.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.editTrack) {
      openPlacement(button.dataset.editTrack);
    }

    if (button.dataset.removeTrack) {
      await mutate(() => {
        const track = state.data.tracks.find(
          item => item.id === button.dataset.removeTrack
        );

        if (track) track.status = "removed";
      }, "Marquer un placement comme retiré");
    }

    if (button.dataset.restoreTrack) {
      await mutate(() => {
        const track = state.data.tracks.find(
          item => item.id === button.dataset.restoreTrack
        );

        if (track) track.status = "active";
      }, "Réactiver un placement");
    }

    if (
      button.dataset.deleteTrack &&
      confirm("Supprimer définitivement ce placement ?")
    ) {
      await mutate(() => {
        state.data.tracks = state.data.tracks.filter(
          track => track.id !== button.dataset.deleteTrack
        );
      }, "Supprimer un placement");
    }

    if (button.dataset.editPlaylist) {
      openPlaylist(button.dataset.editPlaylist);
    }

    if (button.dataset.deletePlaylist) {
      const playlist = state.data.playlists.find(
        item => item.id === button.dataset.deletePlaylist
      );

      if (!playlist) return;

      if (state.data.tracks.some(track => track.playlistId === playlist.id)) {
        showNotice(
          "Cette playlist contient des placements. Réaffecte ou supprime-les avant de supprimer la playlist.",
          true
        );
        return;
      }

      if (confirm(`Supprimer la playlist « ${playlist.name} » ?`)) {
        await mutate(() => {
          state.data.playlists = state.data.playlists.filter(
            item => item.id !== playlist.id
          );
        }, "Supprimer une playlist");
      }
    }
  });

  /* =========================================================
     EXPORT ET IMPORT JSON
  ========================================================= */

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob(
      [JSON.stringify(state.data, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `curator-backup-${todayISO()}.json`;
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("importFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());

      if (!Array.isArray(data.playlists) || !Array.isArray(data.tracks)) {
        throw new Error("Format de sauvegarde invalide.");
      }

      if (!confirm("Remplacer les données actuelles par cette sauvegarde ?")) {
        return;
      }

      await mutate(() => {
        state.data = {
          playlists: data.playlists,
          tracks: data.tracks,
          settings: data.settings || { soonDays: 7 }
        };
      }, "Restaurer une sauvegarde JSON");
    } catch (error) {
      showNotice(`Import impossible : ${error.message}`, true);
    } finally {
      event.target.value = "";
    }
  });

  /* =========================================================
     INITIALISATION ET RECONNEXION
  ========================================================= */

  loadRepoConfig();

  $("branchName").value = state.branch;

  renderAll();

  // Essaie de restaurer la session sur ce navigateur.
  if (state.refreshToken && state.owner && state.repo) {
    (async () => {
      try {
        setStatus("Restauration de la connexion GitHub…");

        await refreshAccessToken();

        await gh(
          `/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}`
        );

        await loadData();

        state.connected = true;

        setStatus("Connexion GitHub restaurée.");

        renderAll();
      } catch (error) {
        state.connected = false;

        setStatus(
          `Reconnexion automatique impossible : ${error.message}. Clique sur « Connecter avec GitHub ».`,
          true
        );

        updateConnectionUi();
      }
    })();
  }
})();
