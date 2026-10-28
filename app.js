/* =========================================================
   CURATOR DESK
   Connexion GitHub + Suivi artistes + Placements + Instagram
========================================================= */

(() => {
  "use strict";

  /* =========================================================
     CONFIGURATION ET UTILITAIRES
  ========================================================= */

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

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value ?? "");
  }

  function setHtml(id, value) {
    const element = $(id);
    if (element) element.innerHTML = value;
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value ?? "";
  }

  function listen(id, eventName, handler) {
    const element = $(id);

    if (element) {
      element.addEventListener(eventName, handler);
    } else {
      console.warn(`Curator Desk : élément HTML absent : #${id}`);
    }
  }

  function validSpotifyUrl(value) {
    if (!value) return true;

    return /^https:\/\/open\.spotify\.com\/(track|playlist|album)\/[A-Za-z0-9]+(?:[/?#].*)?$/.test(value);
  }

  function validInstagramUrl(value) {
    if (!value) return true;

    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" &&
        [
          "instagram.com",
          "www.instagram.com",
          "m.instagram.com"
        ].includes(url.hostname.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  function validRepoPart(value) {
    return /^[A-Za-z0-9_.-]+$/.test(value);
  }

  function dateLabel(value) {
    if (!value) return "—";

    const [year, month, day] = value.split("-").map(Number);

    if (!year || !month || !day) return "—";

    return new Date(
      Date.UTC(year, month - 1, day, 12)
    ).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    });
  }

  function daysUntil(value) {
    if (!value) return null;

    const [year, month, day] = value.split("-").map(Number);

    if (!year || !month || !day) return null;

    const target = Date.UTC(year, month - 1, day);

    const now = new Date();

    const current = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    return Math.round((target - current) / 86400000);
  }

  function loadSavedConfig() {
    try {
      return JSON.parse(
        localStorage.getItem(CONFIG_KEY) || "{}"
      );
    } catch {
      return {};
    }
  }

  /* =========================================================
     ÉTAT DE L'APPLICATION
  ========================================================= */

  const savedConfig = loadSavedConfig();

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
     STATUT DES ÉCHANGES
  ========================================================= */

  function pipelineStageOf(track) {
    if (VALID_STAGES.has(track.pipelineStatus)) {
      return track.pipelineStatus;
    }

    /*
      Compatibilité avec les anciens morceaux :
      une fiche disposant déjà d'une playlist et de dates
      est considérée comme placée.
    */

    if (
      track.playlistId &&
      track.placementStart &&
      track.placementEnd
    ) {
      return "placed";
    }

    return "to_contact";
  }

  function isPlaced(track) {
    return pipelineStageOf(track) === "placed";
  }

  function stageInfo(value) {
    return (
      PIPELINE_STAGES.find(stage => stage.value === value) ||
      PIPELINE_STAGES[0]
    );
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

    const soonDays =
      Number(state.data.settings?.soonDays) || 7;

    if (end !== null && end <= soonDays) {
      return {
        key: "soon",
        label: end === 0
          ? "Fin aujourd'hui"
          : `Fin dans ${end} j`,
        tone: "yellow"
      };
    }

    return {
      key: "active",
      label: "En cours",
      tone: "green"
    };
  }

  function playlistById(id) {
    return state.data.playlists.find(
      playlist => playlist.id === id
    );
  }

  function trackLink(track) {
    if (
      !track.spotifyUrl ||
      !validSpotifyUrl(track.spotifyUrl)
    ) {
      return "";
    }

    return `
      <a
        href="${esc(track.spotifyUrl)}"
        target="_blank"
        rel="noopener noreferrer"
      >Spotify ↗</a>
    `;
  }

  function instagramButton(track) {
    if (
      !track.instagramUrl ||
      !validInstagramUrl(track.instagramUrl)
    ) {
      return `<span class="muted-inline">Non renseigné</span>`;
    }

    return `
      <a
        class="small-btn instagram-button"
        href="${esc(track.instagramUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Ouvrir Instagram de ${esc(track.artist)}"
      >Instagram ↗</a>
    `;
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
          <div class="track-name">
            ${esc(track.title)}
          </div>

          <div class="subline">
            ${esc(track.artist)}
          </div>

          ${trackLink(track)}
        </td>

        <td>
          ${esc(playlist?.name || "Playlist introuvable")}
        </td>

        <td>
          ${dateLabel(track.placementEnd)}
        </td>

        <td>
          <span class="badge ${status.tone}">
            ${esc(status.label)}
          </span>
        </td>

        <td>
          ${trackLink(track)}
        </td>

        ${actions ? `
          <td>
            <div class="row-actions">

              <button
                class="small-btn"
                data-edit-track="${esc(track.id)}"
              >Modifier</button>

              ${
                track.status === "removed"
                  ? `
                    <button
                      class="small-btn"
                      data-restore-track="${esc(track.id)}"
                    >Réactiver</button>
                  `
                  : `
                    <button
                      class="small-btn"
                      data-remove-track="${esc(track.id)}"
                    >Retiré</button>
                  `
              }

              <button
                class="small-btn"
                data-delete-track="${esc(track.id)}"
                aria-label="Supprimer le morceau"
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
          Aucun placement à afficher.
          Tu peux ajouter un morceau depuis « Suivi artistes »,
          même s'il n'est pas encore placé.
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
          Aucun morceau ici pour le moment.
          Clique sur « Ajouter un morceau » pour commencer
          à suivre tes discussions avec les artistes.
        </div>
      `;
    }

    const rows = items.map(track => {
      const currentStage = pipelineStageOf(track);

      const playlist = playlistById(track.playlistId);

      const placement = isPlaced(track)
        ? `
            ${esc(playlist?.name || "Playlist introuvable")}

            <div class="subline">
              Début : ${dateLabel(track.placementStart)}
            </div>

            <div class="subline">
              Fin : ${dateLabel(track.placementEnd)}
            </div>
          `
        : `
            <span class="muted-inline">
              Pas encore placé
            </span>
          `;

      const updated =
        track.updatedAt ||
        track.createdAt ||
        "";

      const note = track.notes
        ? `
            <div class="subline note-preview">
              ${esc(track.notes)}
            </div>
          `
        : "";

      const options = PIPELINE_STAGES.map(stage => `
        <option
          value="${stage.value}"
          ${stage.value === currentStage ? "selected" : ""}
        >${esc(stage.label)}</option>
      `).join("");

      return `
        <tr>
          <td>
            <div class="track-name">
              ${esc(track.title)}
            </div>

            <div class="subline">
              ${esc(track.artist)}
            </div>

            ${trackLink(track)}

            ${note}
          </td>

          <td>
            ${instagramButton(track)}
          </td>

          <td>
            <select
              class="input pipeline-select"
              data-stage-track="${esc(track.id)}"
              aria-label="Statut de ${esc(track.title)}"
            >
              ${options}
            </select>
          </td>

          <td>
            ${placement}
          </td>

          <td>
            ${dateLabel(updated.slice(0, 10))}
          </td>

          <td>
            <div class="row-actions">

              <button
                class="small-btn"
                data-edit-track="${esc(track.id)}"
              >Modifier</button>

              <button
                class="small-btn"
                data-delete-track="${esc(track.id)}"
                aria-label="Supprimer le morceau"
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

          <tbody>
            ${rows}
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

    const placedTracks = tracks.filter(isPlaced);

    const active = placedTracks.filter(track =>
      track.status !== "removed" &&
      ["active", "soon", "overdue"].includes(
        getStatus(track).key
      )
    );

    const soon = placedTracks.filter(
      track => getStatus(track).key === "soon"
    );

    const overdue = placedTracks.filter(
      track => getStatus(track).key === "overdue"
    );

    const inPipeline = tracks.filter(track => {
      const stage = pipelineStageOf(track);

      return (
        stage !== "placed" &&
        stage !== "declined"
      );
    });

    setText(
      "statPlaylists",
      state.data.playlists.filter(
        playlist => playlist.active !== false
      ).length
    );

    setText("statActive", active.length);
    setText("statPipeline", inPipeline.length);
    setText("statSoon", soon.length);
    setText("statOverdue", overdue.length);

    const priorities = placedTracks
      .filter(track =>
        ["overdue", "soon"].includes(
          getStatus(track).key
        )
      )
      .sort((a, b) =>
        (daysUntil(a.placementEnd) ?? 9999) -
        (daysUntil(b.placementEnd) ?? 9999)
      );

    setHtml(
      "priorityList",
      tableHtml(priorities.slice(0, 8), true)
    );

    const recent = [...tracks]
      .sort((a, b) =>
        (
          b.updatedAt ||
          b.createdAt ||
          ""
        ).localeCompare(
          a.updatedAt ||
          a.createdAt ||
          ""
        )
      )
      .slice(0, 6);

    setHtml(
      "recentList",
      pipelineTableHtml(recent)
    );
  }

  /* =========================================================
     RECHERCHE ET AFFICHAGE DES PLACEMENTS
  ========================================================= */

  function renderPlacements() {
    const searchElement = $("placementSearch");
    const filterElement = $("statusFilter");

    const query = (searchElement?.value || "")
      .trim()
      .toLocaleLowerCase("fr");

    const filter = filterElement?.value || "all";

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
        ]
          .join(" ")
          .toLocaleLowerCase("fr");

        const status = getStatus(track).key;

        return (
          (!query || searchable.includes(query)) &&
          (filter === "all" || status === filter)
        );
      })
      .sort((a, b) =>
        (a.placementEnd || "9999").localeCompare(
          b.placementEnd || "9999"
        )
      );

    setHtml(
      "placementsList",
      tableHtml(rows, true)
    );
  }

  /* =========================================================
     RECHERCHE ET AFFICHAGE DU SUIVI ARTISTES
  ========================================================= */

  function renderPipeline() {
    const searchElement = $("pipelineSearch");
    const filterElement = $("pipelineStatusFilter");

    const query = (searchElement?.value || "")
      .trim()
      .toLocaleLowerCase("fr");

    const filter = filterElement?.value || "all";

    const rows = [...state.data.tracks]
      .filter(track => {
        const stage = pipelineStageOf(track);

        const playlist = playlistById(track.playlistId);

        const searchable = [
          track.title,
          track.artist,
          track.instagramUrl,
          track.notes,
          playlist?.name
        ]
          .join(" ")
          .toLocaleLowerCase("fr");

        return (
          (!query || searchable.includes(query)) &&
          (filter === "all" || stage === filter)
        );
      })
      .sort((a, b) =>
        (
          b.updatedAt ||
          b.createdAt ||
          ""
        ).localeCompare(
          a.updatedAt ||
          a.createdAt ||
          ""
        )
      );

    setHtml(
      "pipelineList",
      pipelineTableHtml(rows)
    );
  }

  /* =========================================================
     AFFICHAGE DES PLAYLISTS
  ========================================================= */

  function renderPlaylists() {
    const container = $("playlistsGrid");

    if (!container) return;

    container.innerHTML = state.data.playlists.length
      ? state.data.playlists.map(playlist => {
          const tracks = state.data.tracks.filter(track =>
            track.playlistId === playlist.id &&
            isPlaced(track)
          );

          const active = tracks.filter(
            track => track.status !== "removed"
          ).length;

          const spotifyLink =
            playlist.spotifyUrl &&
            validSpotifyUrl(playlist.spotifyUrl)
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
                <button
                  class="small-btn"
                  data-edit-playlist="${esc(playlist.id)}"
                >Modifier</button>

                <button
                  class="small-btn"
                  data-delete-playlist="${esc(playlist.id)}"
                >Supprimer</button>
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
     NOTIFICATIONS
  ========================================================= */

  function showNotice(message, error = false) {
    const notice = $("notice");

    if (!notice) {
      if (error) {
        console.error(message);
      } else {
        console.info(message);
      }

      return;
    }

    notice.textContent = message;

    notice.classList.remove("hidden", "error");

    if (error) {
      notice.classList.add("error");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function setStatus(message, error = false) {
    const element = $("connectionStatus");

    if (!element) return;

    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function updateConnectionUi() {
    setText(
      "connectionLabel",
      state.connected
        ? `${state.owner}/${state.repo}`
        : "Non connecté à GitHub"
    );

    const dot = document.querySelector(".status-dot");

    if (dot) {
      dot.style.background = state.connected
        ? "var(--green)"
        : "var(--yellow)";
    }

    const disconnectButton = $("disconnectBtn");

    if (disconnectButton) {
      disconnectButton.disabled = !state.connected;
    }
  }

  /* =========================================================
     API GITHUB
  ========================================================= */

  async function gh(path, options = {}) {
    if (!state.token) {
      throw new Error(
        "Aucun jeton GitHub n'est enregistré."
      );
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
    } catch {
      body = {};
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Jeton invalide ou expiré");
      }

      if (response.status === 403) {
        throw new Error(
          "Accès refusé. Vérifie les permissions du jeton."
        );
      }

      if (response.status === 404) {
        throw new Error("Dépôt ou fichier introuvable");
      }

      throw new Error(
        body.message ||
        `GitHub a répondu ${response.status}`
      );
    }

    return body;
  }

  /* =========================================================
     CONNEXION ET RESTAURATION
  ========================================================= */

  async function connect(automatic = false) {
    const owner =
      ($("repoOwner")?.value || "").trim() ||
      state.owner;

    const repo =
      ($("repoName")?.value || "").trim() ||
      state.repo;

    const branch =
      ($("branchName")?.value || "").trim() ||
      state.branch ||
      "main";

    const token =
      ($("tokenInput")?.value || "").trim() ||
      state.token ||
      localStorage.getItem(TOKEN_KEY) ||
      "";

    if (!owner || !repo || !token) {
      setStatus(
        "Renseigne le compte GitHub, le dépôt et le jeton.",
        true
      );
      return;
    }

    if (
      !validRepoPart(owner) ||
      !validRepoPart(repo)
    ) {
      setStatus(
        "Nom de compte ou de dépôt invalide.",
        true
      );
      return;
    }

    state.owner = owner;
    state.repo = repo;
    state.branch = branch;
    state.token = token;

    const connectButton = $("connectBtn");

    if (connectButton) {
      connectButton.disabled = true;
    }

    setStatus(
      automatic
        ? "Restauration de la connexion GitHub…"
        : "Connexion et chargement…"
    );

    try {
      /*
        Vérifie d'abord l'accès au dépôt.
        Cela évite d'initialiser les données si le dépôt
        n'est pas accessible.
      */

      await gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      );

      localStorage.setItem(TOKEN_KEY, token);

      localStorage.setItem(
        CONFIG_KEY,
        JSON.stringify({
          owner,
          repo,
          branch
        })
      );

      setValue("tokenInput", token);

      await loadData();

      state.connected = true;

      setStatus(
        "Connecté. La connexion est mémorisée dans ce navigateur."
      );

      if (!automatic) {
        showNotice(
          "Données chargées depuis GitHub. La connexion est mémorisée dans ce navigateur et les modifications seront enregistrées dans le dépôt."
        );
      }

      renderAll();

    } catch (error) {
      state.connected = false;

      setStatus(
        `${error.message}. Vérifie le dépôt, le jeton et ses permissions.`,
        true
      );

      console.error("Connexion GitHub :", error);

    } finally {
      if (connectButton) {
        connectButton.disabled = false;
      }

      updateConnectionUi();
    }
  }

  /* =========================================================
     CHARGEMENT DES DONNÉES
  ========================================================= */

  function decodeBase64Utf8(value) {
    const binary = atob(value.replace(/\n/g, ""));
    const bytes = Uint8Array.from(
      binary,
      character => character.charCodeAt(0)
    );

    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Utf8(value) {
    return btoa(
      unescape(
        encodeURIComponent(value)
      )
    );
  }

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

      const decoded = decodeBase64Utf8(
        file.content || ""
      );

      const data = JSON.parse(decoded);

      state.data = {
        playlists: Array.isArray(data.playlists)
          ? data.playlists
          : [],

        tracks: Array.isArray(data.tracks)
          ? data.tracks
          : [],

        settings: data.settings || {
          soonDays: 7
        }
      };

    } catch (error) {
      /*
        Si le fichier de données n'existe pas encore,
        on initialise les tableaux. Le dépôt a déjà été
        vérifié dans connect().
      */

      if (
        String(error.message).includes("introuvable")
      ) {
        state.sha = null;

        state.data = {
          playlists: [],
          tracks: [],
          settings: { soonDays: 7 }
        };

        await saveData(
          "Initialiser les données Curator Desk"
        );

      } else {
        throw error;
      }
    }
  }

  /* =========================================================
     SAUVEGARDE SUR GITHUB
  ========================================================= */

  async function saveData(
    message = "Mettre à jour les données Curator Desk"
  ) {
    if (!state.token) {
      throw new Error(
        "Connecte-toi à GitHub avant d'enregistrer."
      );
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

      const serialized = JSON.stringify({
        ...state.data,
        updatedAt: new Date().toISOString()
      }, null, 2);

      const payload = {
        message,
        content: encodeBase64Utf8(serialized),
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

  /* =========================================================
     MODIFICATIONS AVEC ANNULATION SI ÉCHEC
  ========================================================= */

async function mutate(callback, message) {
  if (!state.connected) {
    showNotice(
      "Tu n'es pas connecté à GitHub. Va dans « Connexion & données », connecte-toi et attends la confirmation avant d'enregistrer.",
      true
    );
    return false;
  }

  const previousData = JSON.stringify(state.data);

  try {
    callback();

    await saveData(message);

    renderAll();

    showNotice("✅ Modifications enregistrées sur GitHub.");

    return true;

  } catch (error) {
    // Annule les changements en mémoire si GitHub refuse la sauvegarde.
    state.data = JSON.parse(previousData);

    renderAll();

    showNotice(
      `❌ Enregistrement impossible : ${error.message}`,
      true
    );

    console.error("Erreur de sauvegarde GitHub :", error);

    return false;
  }
}

  /* =========================================================
     CHAMPS OBLIGATOIRES SI LE MORCEAU EST PLACÉ
  ========================================================= */

  function syncPlacementFields() {
    const statusElement = $("trackWorkflowStatus");

    if (!statusElement) return;

    const isPlacedStage =
      statusElement.value === "placed";

    const playlistInput = $("trackPlaylist");
    const startInput = $("trackStart");
    const endInput = $("trackEnd");

    if (playlistInput) {
      playlistInput.required = isPlacedStage;
    }

    if (startInput) {
      startInput.required = isPlacedStage;
    }

    if (endInput) {
      endInput.required = isPlacedStage;
    }

    setText(
      "placementFieldsHint",
      isPlacedStage
        ? "Pour enregistrer un morceau comme placé, renseigne une playlist, une date de début et une date de fin."
        : "Tant que le morceau n’est pas placé, la playlist et les dates restent facultatives. Tu pourras les compléter plus tard."
    );
  }

  /* =========================================================
     OUVERTURE DU FORMULAIRE D'UN MORCEAU
  ========================================================= */

  function openTrack(id = null, defaultStage = "to_contact") {
    const track = id
      ? state.data.tracks.find(item => item.id === id)
      : null;

    let initialStage = track
      ? pipelineStageOf(track)
      : defaultStage;

    /*
      CORRECTION DU BOUTON D'AJOUT :
      si aucune playlist n'existe encore, ne bloque pas
      l'ouverture du formulaire. On commence simplement
      avec un statut « À contacter ».
    */

    if (
      !track &&
      initialStage === "placed" &&
      state.data.playlists.length === 0
    ) {
      initialStage = "to_contact";
    }

    const form = $("placementForm");

    if (form) {
      form.reset();
    }

    setValue("placementId", track?.id || "");

    setText(
      "placementModalTitle",
      track
        ? "Modifier le morceau"
        : "Ajouter un morceau"
    );

    setValue("trackTitle", track?.title || "");
    setValue("trackArtist", track?.artist || "");
    setValue("trackUrl", track?.spotifyUrl || "");

    /*
      Nouveau champ :
      le lien Instagram est conservé séparément pour
      chaque morceau.
    */

    setValue(
      "trackInstagram",
      track?.instagramUrl || ""
    );

    setValue("trackNotes", track?.notes || "");

    setValue(
      "trackWorkflowStatus",
      initialStage
    );

    const playlistSelect = $("trackPlaylist");

    if (playlistSelect) {
      playlistSelect.innerHTML =
        `<option value="">Aucune playlist pour le moment</option>` +
        state.data.playlists.map(playlist => `
          <option value="${esc(playlist.id)}">
            ${esc(playlist.name)}
          </option>
        `).join("");

      playlistSelect.value = track?.playlistId || "";
    }

    setValue(
      "trackStart",
      track?.placementStart || ""
    );

    setValue(
      "trackEnd",
      track?.placementEnd || ""
    );

    syncPlacementFields();

    const dialog = $("placementDialog");

    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      showNotice(
        "Le formulaire est introuvable. Vérifie que index.html contient la fenêtre placementDialog.",
        true
      );
    }
  }

  /* =========================================================
     OUVERTURE DU FORMULAIRE PLAYLIST
  ========================================================= */

  function openPlaylist(id = null) {
    const playlist = id
      ? state.data.playlists.find(item => item.id === id)
      : null;

    const form = $("playlistForm");

    if (form) {
      form.reset();
    }

    setValue("playlistId", playlist?.id || "");

    setText(
      "playlistModalTitle",
      playlist
        ? "Modifier la playlist"
        : "Nouvelle playlist"
    );

    setValue("playlistTitle", playlist?.name || "");
    setValue("playlistUrl", playlist?.spotifyUrl || "");
    setValue("playlistGenre", playlist?.genre || "");
    setValue(
      "playlistDescription",
      playlist?.description || ""
    );

    const dialog = $("playlistDialog");

    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      showNotice(
        "Le formulaire de playlist est introuvable.",
        true
      );
    }
  }

  /* =========================================================
     ENREGISTREMENT D'UN MORCEAU
  ========================================================= */

async function submitTrack(event) {
  event.preventDefault();

  const id = $("placementId")?.value || "";

  const title = ($("trackTitle")?.value || "").trim();
  const artist = ($("trackArtist")?.value || "").trim();

  const spotifyUrl = ($("trackUrl")?.value || "").trim();
  const instagramUrl = ($("trackInstagram")?.value || "").trim();

  const playlistId = $("trackPlaylist")?.value || "";

  const start = $("trackStart")?.value || "";
  const end = $("trackEnd")?.value || "";

  const workflowStatus =
    $("trackWorkflowStatus")?.value || "to_contact";

  const notes =
    ($("trackNotes")?.value || "").trim();

  // Vérifier le titre et l'artiste
  if (!title || !artist) {
    showNotice(
      "Renseigne au minimum le titre du morceau et le nom de l'artiste.",
      true
    );
    return;
  }

  // Vérifier le lien Spotify
  if (!validSpotifyUrl(spotifyUrl)) {
    showNotice(
      "Le lien Spotify n'est pas valide.",
      true
    );
    return;
  }

  // Vérifier le lien Instagram
  if (!validInstagramUrl(instagramUrl)) {
    showNotice(
      "Colle un lien Instagram valide, par exemple https://www.instagram.com/nomdelartiste/.",
      true
    );
    return;
  }

  // Vérifier les dates
  if (start && end && end < start) {
    showNotice(
      "La date de fin doit être égale ou postérieure à la date de début.",
      true
    );
    return;
  }

  // Un morceau placé doit avoir une playlist et des dates
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

  // Retrouver la fiche existante en cas de modification
  const old = id
    ? state.data.tracks.find(item => item.id === id)
    : null;

  // Préparer la fiche du morceau
  const record = {
    ...(old || {}),

    id: id || uid("track"),

    title,
    artist,

    spotifyUrl,
    instagramUrl,

    playlistId,
    placementStart: start,
    placementEnd: end,

    pipelineStatus: workflowStatus,

    notes,

    status: old?.status === "removed"
      ? "removed"
      : "active",

    createdAt:
      old?.createdAt || new Date().toISOString(),

    updatedAt: new Date().toISOString()
  };

  /*
   * IMPORTANT :
   * On tente d'abord de sauvegarder les données sur GitHub.
   * On ne ferme le formulaire qu'en cas de réussite.
   */

  const saved = await mutate(() => {
    const index = state.data.tracks.findIndex(
      item => item.id === record.id
    );

    if (index >= 0) {
      // Modifier un morceau existant
      state.data.tracks[index] = record;
    } else {
      // Ajouter un nouveau morceau
      state.data.tracks.push(record);
    }
  }, id
    ? "Mettre à jour le suivi d'un morceau"
    : "Ajouter un morceau au suivi"
  );

  // Fermer le formulaire uniquement si GitHub confirme la sauvegarde
  if (saved === true) {
    const dialog = $("placementDialog");

    if (dialog?.open) {
      dialog.close();
    }

    showNotice(
      "✅ Morceau enregistré avec succès dans les données GitHub."
    );
  } else {
    // La sauvegarde a échoué : garder le formulaire ouvert.
    showNotice(
      "❌ Le morceau n'a pas été enregistré. Vérifie le message d'erreur et réessaie.",
      true
    );
  }
}

  /* =========================================================
     ENREGISTREMENT D'UNE PLAYLIST
  ========================================================= */

  async function submitPlaylist(event) {
    event.preventDefault();

    const id = $("playlistId")?.value || "";

    const spotifyUrl =
      ($("playlistUrl")?.value || "").trim();

    if (
      !validSpotifyUrl(spotifyUrl)
    ) {
      showNotice(
        "Le lien Spotify de la playlist n'est pas valide.",
        true
      );
      return;
    }

    const old = id
      ? state.data.playlists.find(
          item => item.id === id
        )
      : null;

    const playlist = {
      ...(old || {}),

      id: id || uid("playlist"),

      name: ($("playlistTitle")?.value || "").trim(),

      spotifyUrl,

      genre: ($("playlistGenre")?.value || "").trim(),

      description:
        ($("playlistDescription")?.value || "").trim(),

      active: true,

      createdAt:
        old?.createdAt ||
        new Date().toISOString()
    };

    const dialog = $("playlistDialog");

    if (dialog) {
      dialog.close();
    }

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
     NAVIGATION ENTRE LES PAGES
  ========================================================= */

  function go(view) {
    document.querySelectorAll(".view").forEach(element => {
      element.classList.add("hidden");
    });

    const target = $(`view-${view}`);

    if (target) {
      target.classList.remove("hidden");
    } else {
      showNotice(
        `La page « ${view} » est absente de index.html. Vérifie que le HTML est à jour.`,
        true
      );
      return;
    }

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

    setText(
      "pageTitle",
      titles[view] || "Curator Desk"
    );

    if (view === "placements") {
      renderPlacements();
    }

    if (view === "pipeline") {
      renderPipeline();
    }
  }

  /* =========================================================
     AJOUT D'UN MORCEAU — BOUTONS CORRIGÉS
  ========================================================= */

  function openTrackSafely(stage = "to_contact") {
    try {
      /*
        Si aucune playlist n'est disponible, le formulaire
        s'ouvre en mode suivi, sans exiger de dates.
      */

      if (
        stage === "placed" &&
        state.data.playlists.length === 0
      ) {
        stage = "to_contact";
      }

      openTrack(null, stage);

    } catch (error) {
      console.error(
        "Erreur lors de l'ouverture du formulaire :",
        error
      );

      showNotice(
        `Impossible d'ouvrir le formulaire : ${error.message}`,
        true
      );
    }
  }

  /* =========================================================
     MODIFICATION RAPIDE DU STATUT
  ========================================================= */

  async function handlePipelineStageChange(event) {
    const select = event.target.closest(
      "[data-stage-track]"
    );

    if (!select) return;

    const track = state.data.tracks.find(
      item => item.id === select.dataset.stageTrack
    );

    if (!track) return;

    const nextStage = select.value;

    /*
      Pour passer à « Placé », il faut renseigner
      les informations du placement dans le formulaire.
    */

    if (
      nextStage === "placed" &&
      (
        !track.playlistId ||
        !track.placementStart ||
        !track.placementEnd
      )
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

  /* =========================================================
     ACTIONS SUR LES MORCEAUX ET PLAYLISTS
  ========================================================= */

  function bindDelegatedActions() {
    document.body.addEventListener("click", async event => {
      const button = event.target.closest("button");

      if (!button) return;

      if (button.dataset.editTrack) {
        openTrack(button.dataset.editTrack);
        return;
      }

      if (button.dataset.removeTrack) {
        await mutate(() => {
          const track = state.data.tracks.find(
            item => item.id === button.dataset.removeTrack
          );

          if (track) {
            track.status = "removed";
          }

        }, "Marquer un placement comme retiré");

        return;
      }

      if (button.dataset.restoreTrack) {
        await mutate(() => {
          const track = state.data.tracks.find(
            item => item.id === button.dataset.restoreTrack
          );

          if (track) {
            track.status = "active";
          }

        }, "Réactiver un placement");

        return;
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

        return;
      }

      if (button.dataset.editPlaylist) {
        openPlaylist(button.dataset.editPlaylist);
        return;
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

        if (
          confirm(
            `Supprimer la playlist « ${playlist.name} » ?`
          )
        ) {
          await mutate(() => {
            state.data.playlists =
              state.data.playlists.filter(
                item => item.id !== button.dataset.deletePlaylist
              );

          }, "Supprimer une playlist");
        }
      }
    });
  }

  /* =========================================================
     EXPORT JSON
  ========================================================= */

  function exportData() {
    const blob = new Blob(
      [JSON.stringify(state.data, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `curator-backup-${todayISO()}.json`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /* =========================================================
     IMPORT JSON
  ========================================================= */

  async function importData(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      const data = JSON.parse(
        await file.text()
      );

      if (
        !Array.isArray(data.playlists) ||
        !Array.isArray(data.tracks)
      ) {
        throw new Error(
          "Format de sauvegarde invalide."
        );
      }

      if (
        !confirm(
          "Remplacer les données actuelles par cette sauvegarde ?"
        )
      ) {
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
      showNotice(
        `Import impossible : ${error.message}`,
        true
      );

    } finally {
      event.target.value = "";
    }
  }

  /* =========================================================
     INITIALISATION DES ÉVÉNEMENTS
  ========================================================= */

  function initializeEvents() {
    document.querySelectorAll(".nav-item").forEach(button => {
      button.addEventListener("click", () => {
        go(button.dataset.view);
      });
    });

    document.querySelectorAll("[data-goto]").forEach(button => {
      button.addEventListener("click", () => {
        go(button.dataset.goto);
      });
    });

    setText(
      "todayLabel",
      new Date().toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short"
      })
    );

    /*
      Tous les boutons d'ajout passent par openTrackSafely.
      L'absence de playlist ne bloque plus l'ouverture.
    */

    listen("quickAdd", "click", () => {
      openTrackSafely("to_contact");
    });

    listen("addPipelineTrack", "click", () => {
      openTrackSafely("to_contact");
    });

    listen("addPlacement", "click", () => {
      openTrackSafely("placed");
    });

    listen("addPlaylist", "click", () => {
      openPlaylist();
    });

    listen("placementForm", "submit", submitTrack);
    listen("playlistForm", "submit", submitPlaylist);

    listen(
      "trackWorkflowStatus",
      "change",
      syncPlacementFields
    );

    listen(
      "placementSearch",
      "input",
      renderPlacements
    );

    listen(
      "statusFilter",
      "change",
      renderPlacements
    );

    listen(
      "pipelineSearch",
      "input",
      renderPipeline
    );

    listen(
      "pipelineStatusFilter",
      "change",
      renderPipeline
    );

    listen("connectBtn", "click", () => {
      connect();
    });

    listen("disconnectBtn", "click", () => {
      state.token = "";
      state.connected = false;
      state.sha = null;

      localStorage.removeItem(TOKEN_KEY);

      setValue("tokenInput", "");

      setStatus(
        "Déconnecté. Le jeton mémorisé a été effacé de ce navigateur."
      );

      updateConnectionUi();
    });

    document.querySelectorAll("[data-close]").forEach(button => {
      button.addEventListener("click", () => {
        const dialog = $(button.dataset.close);

        if (dialog) {
          dialog.close();
        }
      });
    });

    listen(
      "pipelineList",
      "change",
      handlePipelineStageChange
    );

    listen(
      "recentList",
      "change",
      handlePipelineStageChange
    );

    listen("exportBtn", "click", exportData);
    listen("importFile", "change", importData);

    bindDelegatedActions();
  }

  /* =========================================================
     INITIALISATION ET RECONNEXION
  ========================================================= */

  function initialize() {
    setValue("repoOwner", state.owner);
    setValue("repoName", state.repo);
    setValue("branchName", state.branch);
    setValue("tokenInput", state.token);

    initializeEvents();

    renderAll();

    /*
      Restaure la connexion à partir du token mémorisé
      et de la configuration conservée dans Edge.
    */

    if (
      state.token &&
      state.owner &&
      state.repo
    ) {
      connect(true);
    }
  }

  initialize();

})();
