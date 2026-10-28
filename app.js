/* Curator Desk — token GitHub classique + suivi des morceaux et placements */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const API_URL = "https://api.github.com";
  const TOKEN_KEY = "curatorDesk.githubToken";
  const CONFIG_KEY = "curatorDesk.githubRepoConfig";

  const PIPELINE_STAGES = [
    { value: "to_contact", label: "À contacter", tone: "gray" },
    { value: "contacted", label: "Contacté", tone: "blue" },
    { value: "discussion", label: "Discussion en cours", tone: "purple" },
    { value: "waiting", label: "En attente de réponse", tone: "yellow" },
    { value: "approved", label: "Accord obtenu", tone: "green" },
    { value: "placed", label: "Placé", tone: "green" },
    { value: "declined", label: "Refusé / abandonné", tone: "red" }
  ];

  const VALID_STAGES = new Set(
    PIPELINE_STAGES.map(stage => stage.value)
  );

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const uid = prefix =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const validSpotifyUrl = value =>
    !value || /^https:\/\/open\.spotify\.com\/(track|playlist|album)\/[A-Za-z0-9]+/.test(value);

  const validInstagramUrl = value => {
    if (!value) return true;

    try {
      const url = new URL(value);

      return url.protocol === "https:" &&
        ["instagram.com", "www.instagram.com", "m.instagram.com"]
          .includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  };

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

  /* =========================================================
     DATES ET STATUTS
  ========================================================= */

  const dateLabel = value => value
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

  function pipelineStageOf(track) {
    if (VALID_STAGES.has(track.pipelineStatus)) {
      return track.pipelineStatus;
    }

    // Compatibilité avec les anciennes fiches déjà placées.
    if (track.playlistId && track.placementStart && track.placementEnd) {
      return "placed";
    }

    return "to_contact";
  }

  function isPlaced(track) {
    return pipelineStageOf(track) === "placed";
  }

  function stageInfo(value) {
    return PIPELINE_STAGES.find(stage => stage.value === value)
      || PIPELINE_STAGES[0];
  }

  function getStatus(track) {
    if (track.status === "removed") {
      return { key: "removed", label: "Retiré", tone: "gray" };
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
    state.data.playlists.find(playlist => playlist.id === id);

  function trackLink(track) {
    if (!track.spotifyUrl || !validSpotifyUrl(track.spotifyUrl)) {
      return "";
    }

    return `<a href="${esc(track.spotifyUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>`;
  }

  /* =========================================================
     TABLEAU DES PLACEMENTS
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

        <td>${esc(playlist?.name || "Playlist introuvable")}</td>
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

              ${track.status === "removed"
                ? `<button class="small-btn" data-restore-track="${esc(track.id)}">Réactiver</button>`
                : `<button class="small-btn" data-remove-track="${esc(track.id)}">Retiré</button>`}

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
          Aucun placement à afficher. Ajoute un morceau depuis
          « Suivi artistes » ou enregistre un placement.
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
     TABLEAU DE SUIVI ARTISTES
  ========================================================= */

  function pipelineTableHtml(items) {
    if (!items.length) {
      return `
        <div class="empty">
          Aucun morceau ici pour le moment. Ajoute une musique
          pour commencer à suivre tes échanges avec l’artiste.
        </div>
      `;
    }

    const rows = items.map(track => {
      const stage = pipelineStageOf(track);

      const placement = isPlaced(track)
        ? `
            ${esc(playlistById(track.playlistId)?.name || "Playlist introuvable")}
            <div class="subline">Fin : ${dateLabel(track.placementEnd)}</div>
          `
        : `<span class="muted-inline">Pas encore placé</span>`;

      const updated = (
        track.updatedAt ||
        track.createdAt ||
        ""
      ).slice(0, 10);

      const note = track.notes
        ? `<div class="subline note-preview">${esc(track.notes)}</div>`
        : "";

      const instagramButton =
        track.instagramUrl && validInstagramUrl(track.instagramUrl)
          ? `
              <a
                class="small-btn instagram-button"
                href="${esc(track.instagramUrl)}"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ouvrir Instagram de ${esc(track.artist)}"
              >Instagram ↗</a>
            `
          : `<span class="muted-inline">Non renseigné</span>`;

      const options = PIPELINE_STAGES.map(item =>
        `<option value="${item.value}" ${item.value === stage ? "selected" : ""}>${esc(item.label)}</option>`
      ).join("");

      return `
        <tr>
          <td>
            <div class="track-name">${esc(track.title)}</div>
            <div class="subline">${esc(track.artist)}</div>
            ${trackLink(track)}
            ${note}
          </td>

          <td>${instagramButton}</td>

          <td>
            <select
              class="input pipeline-select"
              data-stage-track="${esc(track.id)}"
              aria-label="Statut de ${esc(track.title)}"
            >
              ${options}
            </select>
          </td>

          <td>${placement}</td>
          <td>${dateLabel(updated)}</td>

          <td>
            <div class="row-actions">
              <button class="small-btn" data-edit-track="${esc(track.id)}">
                Modifier
              </button>
              <button
                class="small-btn"
                data-delete-track="${esc(track.id)}"
                aria-label="Supprimer"
              >✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <div class="table-wrap">
        <table class="pipeline-table">
          <thead>
            <tr>
              <th>Morceau / artiste</th>
              <th>Instagram</th>
              <th>Statut des échanges</th>
              <th>Placement</th>
              <th>Mis à jour</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /* =========================================================
     TABLEAU DE BORD
  ========================================================= */

  function renderDashboard() {
    const placedTracks = state.data.tracks.filter(isPlaced);

    const active = placedTracks.filter(track =>
      track.status !== "removed" &&
      ["active", "soon", "overdue"].includes(getStatus(track).key)
    );

    const soon = placedTracks.filter(
      track => getStatus(track).key === "soon"
    );

    const overdue = placedTracks.filter(
      track => getStatus(track).key === "overdue"
    );

    const inPipeline = state.data.tracks.filter(track => {
      const stage = pipelineStageOf(track);
      return stage !== "placed" && stage !== "declined";
    });

    $("statPlaylists").textContent =
      state.data.playlists.filter(p => p.active !== false).length;

    $("statActive").textContent = active.length;
    $("statPipeline").textContent = inPipeline.length;
    $("statSoon").textContent = soon.length;
    $("statOverdue").textContent = overdue.length;

    const priorities = placedTracks
      .filter(track =>
        ["overdue", "soon"].includes(getStatus(track).key)
      )
      .sort((a, b) =>
        (daysUntil(a.placementEnd) ?? 9999) -
        (daysUntil(b.placementEnd) ?? 9999)
      );

    $("priorityList").innerHTML =
      tableHtml(priorities.slice(0, 8), true);

    const recent = [...state.data.tracks]
      .sort((a, b) =>
        (b.updatedAt || b.createdAt || "").localeCompare(
          a.updatedAt || a.createdAt || ""
        )
      )
      .slice(0, 6);

    $("recentList").innerHTML = pipelineTableHtml(recent);
  }

  /* =========================================================
     AFFICHAGE DES PLACEMENTS
  ========================================================= */

  function renderPlacements() {
    const query = $("placementSearch").value
      .trim()
      .toLocaleLowerCase("fr");

    const filter = $("statusFilter").value;

    const rows = state.data.tracks
      .filter(track => {
        if (!isPlaced(track)) return false;

        const playlist = playlistById(track.playlistId);

        const searchable = [
          track.title,
          track.artist,
          playlist?.name,
          track.notes,
          track.instagramUrl
        ].join(" ").toLocaleLowerCase("fr");

        const status = getStatus(track).key;

        return (
          (!query || searchable.includes(query)) &&
          (filter === "all" || status === filter)
        );
      })
      .sort((a, b) =>
        (a.placementEnd || "9999").localeCompare(b.placementEnd || "9999")
      );

    $("placementsList").innerHTML = tableHtml(rows, true);
  }

  /* =========================================================
     AFFICHAGE DU SUIVI ARTISTES
  ========================================================= */

  function renderPipeline() {
    const query = $("pipelineSearch").value
      .trim()
      .toLocaleLowerCase("fr");

    const filter = $("pipelineStatusFilter").value;

    const rows = [...state.data.tracks]
      .filter(track => {
        const stage = pipelineStageOf(track);

        const searchable = [
          track.title,
          track.artist,
          track.instagramUrl,
          track.notes,
          playlistById(track.playlistId)?.name
        ].join(" ").toLocaleLowerCase("fr");

        return (
          (!query || searchable.includes(query)) &&
          (filter === "all" || stage === filter)
        );
      })
      .sort((a, b) =>
        (b.updatedAt || b.createdAt || "").localeCompare(
          a.updatedAt || a.createdAt || ""
        )
      );

    $("pipelineList").innerHTML = pipelineTableHtml(rows);
  }

  /* =========================================================
     AFFICHAGE DES PLAYLISTS
  ========================================================= */

  function renderPlaylists() {
    $("playlistsGrid").innerHTML = state.data.playlists.length
      ? state.data.playlists.map(playlist => {
          const tracks = state.data.tracks.filter(track =>
            track.playlistId === playlist.id && isPlaced(track)
          );

          const active = tracks.filter(
            track => track.status !== "removed"
          ).length;

          const spotifyLink =
            playlist.spotifyUrl && validSpotifyUrl(playlist.spotifyUrl)
              ? `
                  <a
                    href="${esc(playlist.spotifyUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >Spotify ↗</a>
                `
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
    renderPipeline();
    renderPlaylists();
    updateConnectionUi();
  }

  /* =========================================================
     NOTIFICATIONS ET CONNEXION
  ========================================================= */

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

    $("disconnectBtn").disabled = !state.connected;
  }

  /* =========================================================
     API GITHUB
  ========================================================= */

  async function gh(path, options = {}) {
    if (!state.token) {
      throw new Error("Aucun jeton GitHub n'est enregistré.");
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": `Bearer ${state.token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const raw = await response.text();
    let body = {};

    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Jeton invalide ou expiré");
      }

      if (response.status === 403) {
        throw new Error(
          "Accès refusé. Vérifie les permissions du jeton"
        );
      }

      if (response.status === 404) {
        throw new Error("Dépôt ou fichier introuvable");
      }

      throw new Error(body.message || `GitHub a répondu ${response.status}`);
    }

    return body;
  }

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
        "Connecté. La connexion est mémorisée dans ce navigateur."
      );

      if (!automatic) {
        showNotice(
          "Données chargées depuis GitHub. La connexion est mémorisée dans ce navigateur et les modifications seront enregistrées dans le dépôt privé."
        );
      }

      renderAll();
    } catch (error) {
      state.connected = false;

      setStatus(
        `${error.message}. Vérifie le dépôt, le jeton et ses permissions.`,
        true
      );
    } finally {
      $("connectBtn").disabled = false;
      updateConnectionUi();
    }
  }

  /* =========================================================
     CHARGER LES DONNÉES DU DÉPÔT
  ========================================================= */

  async function loadData() {
    const path = state.path
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const url =
      `/repos/${encodeURIComponent(state.owner)}` +
      `/${encodeURIComponent(state.repo)}` +
      `/contents/${path}` +
      `?ref=${encodeURIComponent(state.branch)}`;

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
      if (
        String(error.message).includes("Not Found") ||
        String(error.message).includes("introuvable")
      ) {
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

  /* =========================================================
     ENREGISTRER LES DONNÉES SUR GITHUB
  ========================================================= */

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

      if (state.sha) payload.sha = state.sha;

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
     FORMULAIRE D'UN MORCEAU
  ========================================================= */

  function syncPlacementFields() {
    const isPlacedStage =
      $("trackWorkflowStatus").value === "placed";

    $("trackPlaylist").required = isPlacedStage;
    $("trackStart").required = isPlacedStage;
    $("trackEnd").required = isPlacedStage;

    $("placementFieldsHint").textContent = isPlacedStage
      ? "Pour enregistrer un morceau comme placé, renseigne une playlist, une date de début et une date de fin."
      : "Tant que le morceau n’est pas placé, la playlist et les dates restent facultatives. Tu pourras les compléter plus tard.";
  }

  function openTrack(id = null, defaultStage = "to_contact") {
    const track = id
      ? state.data.tracks.find(item => item.id === id)
      : null;

    const initialStage = track
      ? pipelineStageOf(track)
      : defaultStage;

    if (
      !track &&
      initialStage === "placed" &&
      !state.data.playlists.length
    ) {
      showNotice(
        "Crée d'abord une playlist avant d'enregistrer un placement.",
        true
      );
      go("playlists");
      return;
    }

    $("placementForm").reset();
    $("placementId").value = track?.id || "";

    $("placementModalTitle").textContent = track
      ? "Modifier le morceau"
      : "Ajouter un morceau";

    $("trackTitle").value = track?.title || "";
    $("trackArtist").value = track?.artist || "";
    $("trackUrl").value = track?.spotifyUrl || "";
    $("trackInstagram").value = track?.instagramUrl || "";
    $("trackNotes").value = track?.notes || "";
    $("trackWorkflowStatus").value = initialStage;

    $("trackPlaylist").innerHTML =
      `<option value="">Aucune playlist pour le moment</option>` +
      state.data.playlists.map(playlist =>
        `<option value="${esc(playlist.id)}">${esc(playlist.name)}</option>`
      ).join("");

    $("trackPlaylist").value = track?.playlistId || "";
    $("trackStart").value = track?.placementStart || "";
    $("trackEnd").value = track?.placementEnd || "";

    syncPlacementFields();
    $("placementDialog").showModal();
  }

  /* =========================================================
     FORMULAIRE D'UNE PLAYLIST
  ========================================================= */

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

  /* =========================================================
     ENREGISTRER UN MORCEAU OU UN PLACEMENT
  ========================================================= */

  async function submitTrack(event) {
    event.preventDefault();

    const id = $("placementId").value;
    const title = $("trackTitle").value.trim();
    const artist = $("trackArtist").value.trim();
    const spotifyUrl = $("trackUrl").value.trim();
    const instagramUrl = $("trackInstagram").value.trim();
    const playlistId = $("trackPlaylist").value;
    const start = $("trackStart").value;
    const end = $("trackEnd").value;
    const workflowStatus = $("trackWorkflowStatus").value;

    if (!validSpotifyUrl(spotifyUrl)) {
      showNotice(
        "Le lien doit être un lien Spotify valide (morceau, playlist ou album).",
        true
      );
      return;
    }

    if (!validInstagramUrl(instagramUrl)) {
      showNotice(
        "Colle un lien Instagram valide, par exemple https://www.instagram.com/nomdelartiste/.",
        true
      );
      return;
    }

    if (start && end && end < start) {
      showNotice(
        "La date de fin doit être égale ou postérieure à la date de début.",
        true
      );
      return;
    }

    if (
      workflowStatus === "placed" &&
      (!playlistId || !start || !end)
    ) {
      showNotice(
        "Pour marquer ce morceau comme placé, renseigne la playlist et les dates de début et de fin.",
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
      instagramUrl,
      playlistId,
      placementStart: start,
      placementEnd: end,
      pipelineStatus: workflowStatus,
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
    }, id
      ? "Mettre à jour le suivi d'un morceau"
      : "Ajouter un morceau au suivi"
    );
  }

  /* =========================================================
     ENREGISTRER UNE PLAYLIST
  ========================================================= */

  async function submitPlaylist(event) {
    event.preventDefault();

    const id = $("playlistId").value;
    const spotifyUrl = $("playlistUrl").value.trim();

    if (!validSpotifyUrl(spotifyUrl)) {
      showNotice("Le lien doit être un lien Spotify valide.", true);
      return;
    }

    const old = id
      ? state.data.playlists.find(item => item.id === id)
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
    }, id
      ? "Modifier une playlist"
      : "Ajouter une playlist"
    );
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
      button.classList.toggle(
        "active",
        button.dataset.view === view
      );
    });

    const titles = {
      dashboard: "Vue d'ensemble",
      placements: "Placements",
      pipeline: "Suivi artistes",
      playlists: "Playlists",
      settings: "Connexion & données"
    };

    $("pageTitle").textContent = titles[view] || "Curator Desk";

    if (view === "placements") renderPlacements();
    if (view === "pipeline") renderPipeline();
  }

  /* =========================================================
     ÉVÉNEMENTS
  ========================================================= */

  document.querySelectorAll(".nav-item").forEach(button =>
    button.addEventListener("click", () => go(button.dataset.view))
  );

  document.querySelectorAll("[data-goto]").forEach(button =>
    button.addEventListener("click", () => go(button.dataset.goto))
  );

  $("todayLabel").textContent = new Date().toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });

  $("quickAdd").addEventListener("click", () =>
    openTrack(null, "to_contact")
  );

  $("addPipelineTrack").addEventListener("click", () =>
    openTrack(null, "to_contact")
  );

  $("addPlacement").addEventListener("click", () =>
    openTrack(null, "placed")
  );

  $("addPlaylist").addEventListener("click", () => openPlaylist());

  $("placementForm").addEventListener("submit", submitTrack);
  $("playlistForm").addEventListener("submit", submitPlaylist);

  $("trackWorkflowStatus").addEventListener("change", syncPlacementFields);

  $("placementSearch").addEventListener("input", renderPlacements);
  $("statusFilter").addEventListener("change", renderPlacements);

  $("pipelineSearch").addEventListener("input", renderPipeline);
  $("pipelineStatusFilter").addEventListener("change", renderPipeline);

  $("connectBtn").addEventListener("click", () => connect());

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

  document.querySelectorAll("[data-close]").forEach(button =>
    button.addEventListener("click", () => {
      $(button.dataset.close).close();
    })
  );

  /* =========================================================
     ACTIONS SUR LES MORCEAUX ET LES PLAYLISTS
  ========================================================= */

  document.body.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.editTrack) {
      openTrack(button.dataset.editTrack);
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
      confirm("Supprimer définitivement ce morceau du suivi ?")
    ) {
      await mutate(() => {
        state.data.tracks = state.data.tracks.filter(
          track => track.id !== button.dataset.deleteTrack
        );
      }, "Supprimer un morceau du suivi");
    }

    if (button.dataset.editPlaylist) {
      openPlaylist(button.dataset.editPlaylist);
    }

    if (button.dataset.deletePlaylist) {
      const playlist = state.data.playlists.find(
        item => item.id === button.dataset.deletePlaylist
      );

      if (!playlist) return;

      if (
        state.data.tracks.some(
          track => track.playlistId === playlist.id
        )
      ) {
        showNotice(
          "Cette playlist est associée à un ou plusieurs morceaux. Modifie d'abord leurs fiches avant de la supprimer.",
          true
        );
        return;
      }

      if (confirm(`Supprimer la playlist « ${playlist.name} » ?`)) {
        await mutate(() => {
          state.data.playlists = state.data.playlists.filter(
            item => item.id !== button.dataset.deletePlaylist
          );
        }, "Supprimer une playlist");
      }
    }
  });

  /* =========================================================
     MODIFICATION RAPIDE DU STATUT DE SUIVI
  ========================================================= */

  async function handlePipelineStageChange(event) {
    const select = event.target.closest("[data-stage-track]");
    if (!select) return;

    const track = state.data.tracks.find(
      item => item.id === select.dataset.stageTrack
    );

    if (!track) return;

    const nextStage = select.value;

    if (
      nextStage === "placed" &&
      (!track.playlistId || !track.placementStart || !track.placementEnd)
    ) {
      select.value = pipelineStageOf(track);

      showNotice(
        "Pour passer au statut « Placé », clique sur Modifier et renseigne la playlist et les dates de placement.",
        true
      );
      return;
    }

    await mutate(() => {
      const current = state.data.tracks.find(
        item => item.id === select.dataset.stageTrack
      );

      if (current) {
        current.pipelineStatus = nextStage;
        current.updatedAt = new Date().toISOString();
      }
    }, `Changer le statut d'un morceau : ${stageInfo(nextStage).label}`);
  }

  $("pipelineList").addEventListener(
    "change",
    handlePipelineStageChange
  );

  $("recentList").addEventListener(
    "change",
    handlePipelineStageChange
  );

  /* =========================================================
     EXPORT JSON
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

  /* =========================================================
     IMPORT JSON
  ========================================================= */

  $("importFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());

      if (
        !Array.isArray(data.playlists) ||
        !Array.isArray(data.tracks)
      ) {
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
     INITIALISATION ET RECONNEXION AUTOMATIQUE
  ========================================================= */

  if (state.owner) $("repoOwner").value = state.owner;
  if (state.repo) $("repoName").value = state.repo;

  $("branchName").value = state.branch;

  if (state.token) $("tokenInput").value = state.token;

  renderAll();

  if (state.token && state.owner && state.repo) {
    connect(true);
  }
})();
