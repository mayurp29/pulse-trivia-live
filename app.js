import { APP_CONFIG } from "./config.js";

const HOST_STUDIO_STORAGE_KEY = "pulse-trivia-host-studio-v2";
const urlParams = new URLSearchParams(window.location.search);
const requestedRoomCode = String(urlParams.get("room") || "").trim().toUpperCase();
const requestedScreen = String(urlParams.get("screen") || "").trim().toLowerCase();

const DEFAULT_QUESTION_SET = [
  {
    id: "q1",
    type: "multiple-choice",
    prompt: "Which city is known as the Windy City?",
    options: ["Chicago", "Boston", "Seattle", "Denver"],
    correctAnswer: "Chicago",
    timeLimitSec: 20,
  },
  {
    id: "q2",
    type: "short-answer",
    prompt: "Fill in the blank: The capital of Texas is ____.",
    acceptedAnswers: ["Austin"],
    timeLimitSec: 20,
  },
  {
    id: "q3",
    type: "short-answer",
    prompt: "Name the person in the photo.",
    acceptedAnswers: ["Serena Williams", "Serena"],
    timeLimitSec: 15,
    imageUrl: "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Serena%20Williams%202004.jpg&width=700",
  },
  {
    id: "q4",
    type: "multiple-choice",
    prompt: "Which team sport uses a scrum?",
    options: ["Volleyball", "Rugby", "Basketball", "Baseball"],
    correctAnswer: "Rugby",
    timeLimitSec: 18,
  },
];

function createEmptyDraft(type = "multiple-choice") {
  return {
    type,
    prompt: "",
    timeLimitSec: 20,
    imageUrl: "",
    imageName: "",
    options: ["", "", "", ""],
    correctOptionIndex: 0,
    acceptedAnswers: "",
    isWeighted: false,
    pointValue: 1000,
    fastestBonusPoints: 250,
  };
}

const savedDraftState = loadSavedDraftState();

const state = {
  adapter: null,
  modeLabel: "Loading...",
  game: null,
  players: [],
  answers: [],
  currentPlayerId: window.localStorage.getItem("pulse-trivia-player-id") || "",
  currentPlayerName: window.localStorage.getItem("pulse-trivia-player-name") || "",
  role: window.localStorage.getItem("pulse-trivia-role") || "",
  roomCode: requestedRoomCode || window.localStorage.getItem("pulse-trivia-room-code") || "",
  viewMode: requestedScreen === "present" ? "presentation" : "default",
  selectedAnswer: "",
  typedAnswer: "",
  currentTimerId: null,
  unsubscribe: null,
  autoRevealLock: false,
  lastSubmittedQuestionIndex: Number(window.localStorage.getItem("pulse-trivia-submitted-index") || -1),
  savedGames: savedDraftState.savedGames,
  draftQuestions: savedDraftState.draftQuestions,
  questionDraft: savedDraftState.questionDraft,
  hostDraftName: savedDraftState.hostDraftName,
  gameTitleDraft: savedDraftState.gameTitleDraft,
  editingGameId: savedDraftState.editingGameId,
  editingQuestionIndex: savedDraftState.editingQuestionIndex,
  joinPreviewTitle: "",
};

const el = {
  app: document.getElementById("app"),
  modeChip: document.getElementById("mode-chip"),
  heroTitle: document.getElementById("hero-title"),
};

const hasSupabaseConfig = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
const supabaseClient = hasSupabaseConfig
  ? window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey)
  : null;

state.modeLabel = hasSupabaseConfig ? "Live Mode: Supabase" : "Demo Mode: Browser Storage";
el.modeChip.textContent = state.modeLabel;

function createId() {
  return crypto.randomUUID();
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  while (code.length < 6) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function getBaseAppUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getJoinUrl(roomCode) {
  return `${getBaseAppUrl()}?room=${encodeURIComponent(roomCode)}`;
}

function getPresentationUrl(roomCode) {
  return `${getBaseAppUrl()}?screen=present&room=${encodeURIComponent(roomCode)}`;
}

function getQrImageUrl(roomCode) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(getJoinUrl(roomCode))}`;
}

function openPresentationWindow(roomCode = state.game?.room_code || state.roomCode) {
  if (!roomCode) {
    return null;
  }

  return window.open(getPresentationUrl(roomCode), "_blank", "noopener,noreferrer");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function deepClone(value) {
  return structuredClone(value);
}

function createSavedGameRecord(title, questions, id = createId()) {
  return {
    id,
    title,
    questions: deepClone(questions),
    updatedAt: new Date().toISOString(),
  };
}

function createSampleGameRecord() {
  return createSavedGameRecord("Sample Trivia Round", DEFAULT_QUESTION_SET, "sample-trivia-round");
}

function syncSampleSavedGames(savedGames) {
  const sampleGame = createSampleGameRecord();
  const others = Array.isArray(savedGames) ? savedGames.filter((game) => game.id !== sampleGame.id) : [];
  return [sampleGame, ...others].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function loadSavedDraftState() {
  const sampleGame = createSampleGameRecord();
  const fallback = {
    savedGames: [sampleGame],
    draftQuestions: [],
    questionDraft: createEmptyDraft(),
    hostDraftName: "",
    gameTitleDraft: "",
    editingGameId: "",
    editingQuestionIndex: -1,
  };
  const saved = safeJsonParse(window.localStorage.getItem(HOST_STUDIO_STORAGE_KEY), null);
  if (!saved) {
    return fallback;
  }

  return {
    savedGames:
      Array.isArray(saved.savedGames) && saved.savedGames.length
        ? syncSampleSavedGames(saved.savedGames)
        : fallback.savedGames,
    draftQuestions: Array.isArray(saved.draftQuestions) ? saved.draftQuestions : fallback.draftQuestions,
    questionDraft: saved.questionDraft ? { ...createEmptyDraft(saved.questionDraft.type), ...saved.questionDraft } : fallback.questionDraft,
    hostDraftName: String(saved.hostDraftName || ""),
    gameTitleDraft: String(saved.gameTitleDraft || ""),
    editingGameId: String(saved.editingGameId || ""),
    editingQuestionIndex: Number(saved.editingQuestionIndex ?? -1),
  };
}

function persistDraftState() {
  window.localStorage.setItem(
    HOST_STUDIO_STORAGE_KEY,
    JSON.stringify({
      savedGames: state.savedGames,
      draftQuestions: state.draftQuestions,
      questionDraft: state.questionDraft,
      hostDraftName: state.hostDraftName,
      gameTitleDraft: state.gameTitleDraft,
      editingGameId: state.editingGameId,
      editingQuestionIndex: state.editingQuestionIndex,
    }),
  );
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.display_name.localeCompare(b.display_name);
  });
}

function getCurrentQuestion(game) {
  if (!game || game.current_question_index < 0) {
    return null;
  }

  return game.questions_json?.[game.current_question_index] || null;
}

function getPlayerAnswer(questionIndex, playerId = state.currentPlayerId) {
  return state.answers.find(
    (answer) => answer.question_index === questionIndex && answer.player_id === playerId,
  );
}

function computeRemainingSeconds(game, question) {
  if (!game?.question_started_at || !question?.timeLimitSec) {
    return question?.timeLimitSec || 0;
  }

  const started = new Date(game.question_started_at).getTime();
  const totalMs = question.timeLimitSec * 1000;
  const elapsedMs = Date.now() - started;
  return Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000));
}

function computeTimerPercent(game, question) {
  if (!question?.timeLimitSec || !game?.question_started_at) {
    return 100;
  }

  const started = new Date(game.question_started_at).getTime();
  const totalMs = question.timeLimitSec * 1000;
  const elapsedMs = Date.now() - started;
  return Math.max(0, Math.min(100, ((totalMs - elapsedMs) / totalMs) * 100));
}

function scoreAnswer(question, answerRecord, questionStartedAt) {
  const submittedAtMs = new Date(answerRecord.answered_at).getTime();
  const startedMs = new Date(questionStartedAt).getTime();
  const responseMs = Math.max(0, submittedAtMs - startedMs);
  const acceptedAnswers =
    question.type !== "multiple-choice"
      ? (question.acceptedAnswers || []).map(normalizeText)
      : [normalizeText(question.correctAnswer)];
  const isCorrect = acceptedAnswers.includes(normalizeText(answerRecord.answer_text));

  if (!isCorrect) {
    return {
      isCorrect,
      responseMs,
      basePoints: 0,
    };
  }

  return {
    isCorrect,
    responseMs,
    basePoints: Number(question.pointValue || 1000),
  };
}

function showToast(message) {
  window.alert(message);
}

function persistSession() {
  if (state.currentPlayerId) {
    window.localStorage.setItem("pulse-trivia-player-id", state.currentPlayerId);
  }
  if (state.currentPlayerName) {
    window.localStorage.setItem("pulse-trivia-player-name", state.currentPlayerName);
  }
  if (state.role) {
    window.localStorage.setItem("pulse-trivia-role", state.role);
  }
  if (state.roomCode) {
    window.localStorage.setItem("pulse-trivia-room-code", state.roomCode);
  }
  window.localStorage.setItem("pulse-trivia-submitted-index", String(state.lastSubmittedQuestionIndex));
}

function resetTransientAnswerState() {
  state.selectedAnswer = "";
  state.typedAnswer = "";
}

function clearSession() {
  [
    "pulse-trivia-player-id",
    "pulse-trivia-player-name",
    "pulse-trivia-role",
    "pulse-trivia-room-code",
    "pulse-trivia-submitted-index",
  ].forEach((key) => window.localStorage.removeItem(key));
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function formatAnswerList(question) {
  if (!question) {
    return "";
  }

  if (question.type !== "multiple-choice") {
    return (question.acceptedAnswers || []).join(" / ");
  }

  return question.correctAnswer;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateHeroTitle() {
  const title = state.game?.title || state.joinPreviewTitle || "";
  if (el.heroTitle) {
    el.heroTitle.textContent = title;
    el.heroTitle.style.display = title ? "" : "none";
  }
}

function buildDemoAdapter() {
  const STORAGE_KEY = "pulse-trivia-demo-db";
  const CHANNEL_KEY = "pulse-trivia-demo-events";

  function readDb() {
    return safeJsonParse(window.localStorage.getItem(STORAGE_KEY), {
      games: [],
      players: [],
      answers: [],
    });
  }

  function writeDb(db) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    window.localStorage.setItem(
      CHANNEL_KEY,
      JSON.stringify({ at: Date.now(), token: Math.random().toString(36).slice(2) }),
    );
  }

  function findGameByCode(db, roomCode) {
    return db.games.find((game) => game.room_code === roomCode.toUpperCase());
  }

  return {
    async createGame({ hostName, title, questions }) {
      const db = readDb();
      const game = {
        id: createId(),
        room_code: createRoomCode(),
        title,
        host_name: hostName,
        status: "lobby",
        phase: "lobby",
        current_question_index: -1,
        question_started_at: null,
        reveal_at: null,
        questions_json: questions,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.games.push(game);
      writeDb(db);
      return game;
    },

    async getGame(roomCode) {
      const db = readDb();
      return findGameByCode(db, roomCode) || null;
    },

    async joinGame({ roomCode, displayName }) {
      const db = readDb();
      const game = findGameByCode(db, roomCode);
      if (!game) {
        throw new Error("Room not found.");
      }

      const existing = db.players.find(
        (player) => player.game_id === game.id && normalizeText(player.display_name) === normalizeText(displayName),
      );
      if (existing) {
        return existing;
      }

      const player = {
        id: createId(),
        game_id: game.id,
        display_name: displayName,
        score: 0,
        joined_at: new Date().toISOString(),
      };
      db.players.push(player);
      writeDb(db);
      return player;
    },

    async getSnapshot(gameId) {
      const db = readDb();
      return {
        game: db.games.find((entry) => entry.id === gameId) || null,
        players: db.players.filter((entry) => entry.game_id === gameId),
        answers: db.answers.filter((entry) => entry.game_id === gameId),
      };
    },

    async updateGame(gameId, patch) {
      const db = readDb();
      const game = db.games.find((entry) => entry.id === gameId);
      if (!game) {
        throw new Error("Game not found.");
      }

      Object.assign(game, patch, { updated_at: new Date().toISOString() });
      writeDb(db);
      return game;
    },

    async submitAnswer(payload) {
      const db = readDb();
      const existingIndex = db.answers.findIndex(
        (answer) =>
          answer.game_id === payload.gameId &&
          answer.player_id === payload.playerId &&
          answer.question_index === payload.questionIndex,
      );
      const record = {
        id: existingIndex >= 0 ? db.answers[existingIndex].id : createId(),
        game_id: payload.gameId,
        player_id: payload.playerId,
        question_id: payload.questionId,
        question_index: payload.questionIndex,
        answer_text: payload.answerText,
        is_correct: null,
        response_ms: null,
        points_awarded: 0,
        answered_at: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        db.answers.splice(existingIndex, 1, record);
      } else {
        db.answers.push(record);
      }

      writeDb(db);
      return record;
    },

    async applyScoring(gameId, scoring) {
      const db = readDb();
      const playersById = new Map(
        db.players.filter((entry) => entry.game_id === gameId).map((player) => [player.id, player]),
      );

      scoring.answers.forEach((updatedAnswer) => {
        const index = db.answers.findIndex((entry) => entry.id === updatedAnswer.id);
        if (index >= 0) {
          db.answers[index] = { ...db.answers[index], ...updatedAnswer };
        }
      });

      scoring.playerScores.forEach(({ playerId, score }) => {
        const player = playersById.get(playerId);
        if (player) {
          player.score = score;
        }
      });

      writeDb(db);
    },

    subscribe(gameId, callback) {
      const handler = async (event) => {
        if (event.key !== CHANNEL_KEY) {
          return;
        }

        const snapshot = await this.getSnapshot(gameId);
        callback(snapshot);
      };

      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}

function buildSupabaseAdapter(client) {
  return {
    async createGame({ hostName, title, questions }) {
      const roomCode = createRoomCode();
      const { data, error } = await client
        .from("games")
        .insert({
          room_code: roomCode,
          title,
          host_name: hostName,
          questions_json: questions,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },

    async getGame(roomCode) {
      const { data, error } = await client
        .from("games")
        .select("*")
        .eq("room_code", roomCode.toUpperCase())
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    },

    async joinGame({ roomCode, displayName }) {
      const game = await this.getGame(roomCode);
      if (!game) {
        throw new Error("Room not found.");
      }

      const { data: existing, error: existingError } = await client
        .from("players")
        .select("*")
        .eq("game_id", game.id)
        .ilike("display_name", displayName)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        return existing;
      }

      const { data, error } = await client
        .from("players")
        .insert({
          game_id: game.id,
          display_name: displayName,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },

    async getSnapshot(gameId) {
      const [{ data: game, error: gameError }, { data: players, error: playersError }, { data: answers, error: answersError }] =
        await Promise.all([
          client.from("games").select("*").eq("id", gameId).single(),
          client.from("players").select("*").eq("game_id", gameId),
          client.from("answers").select("*").eq("game_id", gameId),
        ]);

      if (gameError) {
        throw gameError;
      }
      if (playersError) {
        throw playersError;
      }
      if (answersError) {
        throw answersError;
      }

      return {
        game,
        players,
        answers,
      };
    },

    async updateGame(gameId, patch) {
      const { data, error } = await client
        .from("games")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", gameId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },

    async submitAnswer(payload) {
      const { data, error } = await client
        .from("answers")
        .upsert(
          {
            game_id: payload.gameId,
            player_id: payload.playerId,
            question_id: payload.questionId,
            question_index: payload.questionIndex,
            answer_text: payload.answerText,
            answered_at: new Date().toISOString(),
          },
          { onConflict: "game_id,player_id,question_index" },
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },

    async applyScoring(gameId, scoring) {
      if (scoring.answers.length) {
        const { error: answersError } = await client.from("answers").upsert(scoring.answers);
        if (answersError) {
          throw answersError;
        }
      }

      await Promise.all(
        scoring.playerScores.map(async ({ playerId, score }) => {
          const { error } = await client.from("players").update({ score }).eq("id", playerId);
          if (error) {
            throw error;
          }
        }),
      );
    },

    subscribe(gameId, callback) {
      const channel = client
        .channel(`pulse-trivia-${gameId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` },
          async () => callback(await this.getSnapshot(gameId)),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` },
          async () => callback(await this.getSnapshot(gameId)),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "answers", filter: `game_id=eq.${gameId}` },
          async () => callback(await this.getSnapshot(gameId)),
        )
        .subscribe();

      return () => {
        client.removeChannel(channel);
      };
    },
  };
}

state.adapter = hasSupabaseConfig ? buildSupabaseAdapter(supabaseClient) : buildDemoAdapter();

function renderLanding() {
  updateHeroTitle();

  if (state.viewMode === "presentation") {
    el.app.innerHTML = `
      <section class="card card-pad presentation-empty-state">
        <h2>Presentation screen</h2>
        <p class="muted">Waiting for a live game room to load.</p>
      </section>
    `;
    return;
  }

  if (requestedRoomCode && !state.currentPlayerId && state.role !== "host") {
    el.app.innerHTML = `
      <div class="player-join-only-shell">
        <section class="card card-pad player-join-only-card">
          <div class="section-title">
            <h2>Join as a player</h2>
            <span class="tag">AAHOA Trivia</span>
          </div>
          <p class="muted">Enter your name to join this room.</p>
          <form id="join-form" class="form-row">
            <label>
              Your name
              <input id="player-name" name="playerName" value="${escapeHtml(state.currentPlayerName)}" placeholder="Player name" required />
            </label>
            <label>
              Room code
              <input id="room-code" name="roomCode" value="${escapeHtml(state.roomCode)}" placeholder="AB12CD" maxlength="6" required />
            </label>
            <div class="button-row">
              <button class="btn btn-primary" type="submit">Join room</button>
            </div>
          </form>
        </section>
      </div>
    `;
    document.getElementById("join-form").addEventListener("submit", handleJoinGame);
    return;
  }

  const draft = state.questionDraft;
  const isEditing = Boolean(state.editingGameId);
  const isEditingQuestion = state.editingQuestionIndex >= 0;
  const savedGamesMarkup = state.savedGames.length
    ? state.savedGames
        .map(
          (game) => `
            <article class="saved-game-card">
              <div class="saved-game-head">
                <div>
                  <h3>${escapeHtml(game.title)}</h3>
                  <div class="saved-game-meta">
                    <span>${game.questions.length} questions</span>
                    <span>Updated ${formatShortDate(game.updatedAt)}</span>
                  </div>
                </div>
                <span class="tag">Reusable</span>
              </div>
              <div class="button-row saved-game-actions">
                <button class="btn btn-primary saved-game-launch" data-game-id="${game.id}" type="button">Launch this game</button>
                <button class="btn btn-secondary saved-game-edit" data-game-id="${game.id}" type="button">Edit / add questions</button>
                <button class="btn btn-ghost saved-game-delete" data-game-id="${game.id}" type="button">Delete</button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty">No saved games yet. Create your first game.</div>`;
  const questionsMarkup = state.draftQuestions.length
    ? state.draftQuestions
        .map(
          (question, index) => `
            <article class="question-card">
              <div class="question-card-head">
                <div>
                  <div class="pill">Q${index + 1}</div>
                  <h3>${escapeHtml(question.prompt)}</h3>
                </div>
                <div class="button-row saved-game-actions">
                  <button class="btn btn-secondary question-edit" data-index="${index}" type="button">Edit</button>
                  <button class="btn btn-secondary question-remove" data-index="${index}" type="button">Remove</button>
                </div>
              </div>
              <div class="question-card-meta">
                <span>${getQuestionTypeLabel(question.type)}</span>
                <span>${question.timeLimitSec}s timer</span>
                <span>${question.imageUrl ? "Image included" : "No image"}</span>
                <span>${question.pointValue || 1000} pts</span>
              </div>
              ${
                question.imageUrl
                  ? `<img class="question-image-preview" src="${question.imageUrl}" alt="Question image" />`
                  : ""
              }
              <div class="tiny muted">
                ${
                  question.type === "multiple-choice"
                    ? `Correct answer: ${escapeHtml(question.correctAnswer)}`
                    : `Accepted answers: ${escapeHtml((question.acceptedAnswers || []).join(", "))}`
                }
                ${question.fastestBonusPoints ? ` | Fastest bonus: ${question.fastestBonusPoints} pts under 10s` : ""}
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty">No questions yet. Add your first one below.</div>`;

  el.app.innerHTML = `
    <div class="app-grid">
      <section class="card card-pad stack">
        <div class="section-title">
          <h2>Host a game</h2>
          <span class="tag">Game library</span>
        </div>
        <p class="muted">
          Create quizzes, save them, and launch any one into a live room whenever you need it.
        </p>

        <form id="launch-form" class="form-row">
          <label>
            Host name
            <input id="host-name" name="hostName" value="${escapeHtml(state.hostDraftName)}" placeholder="Host name" required />
          </label>
          <div class="metric-grid">
            <div class="metric">
              <div class="metric-label">Saved Games</div>
              <div class="metric-value">${state.savedGames.length}</div>
            </div>
            <div class="metric">
              <div class="metric-label">Live Rooms</div>
              <div class="metric-value">Multiple</div>
            </div>
            <div class="metric">
              <div class="metric-label">Fast Bonus Window</div>
              <div class="metric-value">5s</div>
            </div>
          </div>
          <div class="button-row">
            <button class="btn btn-primary" id="create-game-setup" type="button">${isEditing ? "Editing game below" : "Create new game"}</button>
            <button class="btn btn-secondary" id="load-samples" type="button">Load sample game</button>
          </div>
        </form>

        <div class="divider"></div>
        <div class="section-title">
          <h3>Saved games</h3>
          <span class="tag">${state.savedGames.length} total</span>
        </div>
        <div class="saved-game-list">${savedGamesMarkup}</div>

        <div class="divider"></div>
        <div class="section-title" id="game-editor-heading">
          <h3>${isEditing ? "Edit game" : "Create game"}</h3>
          <span class="tag">${isEditing ? "Save changes" : "Save quiz"}</span>
        </div>
        ${
          isEditing
            ? `
              <div class="notice">
                You are editing a saved quiz. Add more questions below, then click <strong>Save quiz changes</strong>.
              </div>
            `
            : ""
        }
        ${
          isEditingQuestion
            ? `
              <div class="notice">
                You are editing question ${state.editingQuestionIndex + 1}. Update the fields below, then click <strong>Save question changes</strong>.
              </div>
            `
            : ""
        }
        <form id="question-builder-form" class="form-row">
          <label>
            Game title
            <input id="game-title" name="gameTitle" value="${escapeHtml(state.gameTitleDraft)}" placeholder="AAHOA Board Trivia Round" required />
          </label>
          <div class="split-row">
            <label>
              Question type
              <select id="draft-type" name="type">
                <option value="multiple-choice" ${draft.type === "multiple-choice" ? "selected" : ""}>Multiple choice</option>
                <option value="short-answer" ${draft.type === "short-answer" ? "selected" : ""}>Short answer / name the person</option>
              </select>
            </label>
            <label>
              Time limit (seconds)
              <input id="draft-timer" name="timeLimitSec" type="number" min="5" max="60" value="${draft.timeLimitSec}" />
            </label>
          </div>
          <div class="split-row">
            <label class="checkbox-row">
              <span>Weighted question</span>
              <input id="draft-weighted" name="isWeighted" type="checkbox" ${draft.isWeighted ? "checked" : ""} />
            </label>
            <label>
              Question points
              <input id="draft-point-value" name="pointValue" type="number" min="100" step="100" value="${draft.pointValue}" />
            </label>
          </div>
          <label>
            Fastest correct bonus
            <input id="draft-fastest-bonus" name="fastestBonusPoints" type="number" min="0" step="50" value="${draft.fastestBonusPoints}" />
          </label>
          <div class="tiny muted">Only one player gets this bonus: the fastest correct answer received within 10 seconds.</div>
          <label>
            Question text
            <textarea id="draft-prompt" name="prompt" class="question-prompt-box">${escapeHtml(draft.prompt)}</textarea>
          </label>
          <label>
            Optional image
            <input id="draft-image" name="image" type="file" accept="image/*" />
          </label>
          ${
            draft.imageUrl
              ? `
                <div class="image-upload-card">
                  <img class="question-image-preview" src="${draft.imageUrl}" alt="Draft question image" />
                  <div class="tiny muted">${escapeHtml(draft.imageName || "Image attached")}</div>
                  <button class="btn btn-secondary" id="remove-draft-image" type="button">Remove image</button>
                </div>
              `
              : `<div class="tiny muted">Tip: keep images small so the room loads quickly on phones.</div>`
          }

          <div id="multiple-choice-fields" class="${draft.type === "multiple-choice" ? "" : "hidden"}">
            <div class="split-row">
              <label>
                Option A
                <input class="draft-option" data-option-index="0" value="${escapeHtml(draft.options[0] || "")}" />
              </label>
              <label>
                Option B
                <input class="draft-option" data-option-index="1" value="${escapeHtml(draft.options[1] || "")}" />
              </label>
            </div>
            <div class="split-row">
              <label>
                Option C
                <input class="draft-option" data-option-index="2" value="${escapeHtml(draft.options[2] || "")}" />
              </label>
              <label>
                Option D
                <input class="draft-option" data-option-index="3" value="${escapeHtml(draft.options[3] || "")}" />
              </label>
            </div>
            <label>
              Correct option
              <select id="draft-correct-index">
                <option value="0" ${draft.correctOptionIndex === 0 ? "selected" : ""}>Option A</option>
                <option value="1" ${draft.correctOptionIndex === 1 ? "selected" : ""}>Option B</option>
                <option value="2" ${draft.correctOptionIndex === 2 ? "selected" : ""}>Option C</option>
                <option value="3" ${draft.correctOptionIndex === 3 ? "selected" : ""}>Option D</option>
              </select>
            </label>
          </div>

          <div id="fill-in-fields" class="${draft.type !== "multiple-choice" ? "" : "hidden"}">
            <label>
              Accepted answers
              <input id="draft-accepted-answers" value="${escapeHtml(draft.acceptedAnswers)}" placeholder="Example: Serena Williams, Serena, S. Williams" />
            </label>
            <div class="tiny muted">Separate acceptable answers with commas. Great for nicknames, full names, and alternate spellings.</div>
          </div>

          <div class="button-row">
            <button class="btn btn-primary" type="submit">${isEditingQuestion ? "Save question changes" : "Add question"}</button>
            <button class="btn btn-secondary" id="save-game-setup" type="button">${isEditing ? "Save quiz changes" : "Save quiz"}</button>
            ${isEditingQuestion ? `<button class="btn btn-secondary" id="add-as-new-question" type="button">Add as new question</button>` : ""}
            ${isEditingQuestion ? `<button class="btn btn-secondary" id="cancel-question-edit" type="button">Cancel question edit</button>` : ""}
            <button class="btn btn-ghost" id="clear-questions" type="button">Reset editor</button>
          </div>
        </form>

        <div class="divider"></div>
        <div class="section-title">
          <h3>Questions in this game</h3>
          <span class="tag">${state.draftQuestions.length} total</span>
        </div>
        <div class="question-builder-list">${questionsMarkup}</div>
      </section>

      <aside class="card card-pad stack">
        <div class="section-title">
          <h2>Join as a player</h2>
          <span class="tag">Phone screen</span>
        </div>
        <p class="muted">
          Players join with their name and room code. The first few seconds carry the biggest speed bonus.
        </p>
        <form id="join-form" class="form-row">
          <label>
            Your name
            <input id="player-name" name="playerName" value="${escapeHtml(state.currentPlayerName)}" placeholder="Player name" required />
          </label>
          <label>
            Room code
            <input id="room-code" name="roomCode" value="${escapeHtml(state.roomCode)}" placeholder="AB12CD" maxlength="6" required />
          </label>
          <div class="button-row">
            <button class="btn btn-primary" type="submit">Join room</button>
          </div>
        </form>
        <div class="status-strip tiny">
          <strong>Mode:</strong> ${escapeHtml(state.modeLabel)}
        </div>
        <div class="notice">
          Correct answer in the first 5 seconds: biggest bonus. Later correct answers still score, just less.
        </div>
      </aside>
    </div>
  `;

  document.getElementById("launch-form").addEventListener("submit", (event) => event.preventDefault());
  document.getElementById("join-form").addEventListener("submit", handleJoinGame);
  document.getElementById("question-builder-form").addEventListener("submit", handleQuestionAdd);
  document.getElementById("draft-type").addEventListener("change", handleDraftTypeChange);
  document.getElementById("draft-image").addEventListener("change", handleDraftImageSelect);
  document.getElementById("save-game-setup").addEventListener("click", handleSaveGameSetup);
  document.getElementById("create-game-setup").addEventListener("click", () => {
    cacheLandingInputs();
    startNewGameSetup();
  });
  document.getElementById("load-samples").addEventListener("click", () => {
    cacheLandingInputs();
    state.savedGames = upsertSavedGameRecord(createSampleGameRecord());
    persistDraftState();
    renderLanding();
  });
  document.getElementById("clear-questions").addEventListener("click", () => {
    cacheLandingInputs();
    resetEditorState();
    persistDraftState();
    renderLanding();
  });

  const removeDraftImageButton = document.getElementById("remove-draft-image");
  if (removeDraftImageButton) {
    removeDraftImageButton.addEventListener("click", () => {
      cacheLandingInputs();
      state.questionDraft.imageUrl = "";
      state.questionDraft.imageName = "";
      persistDraftState();
      renderLanding();
    });
  }

  document.querySelectorAll(".question-remove").forEach((button) => {
    button.addEventListener("click", () => {
      cacheLandingInputs();
      const index = Number(button.dataset.index);
      state.draftQuestions.splice(index, 1);
      if (state.editingQuestionIndex === index) {
        state.questionDraft = createEmptyDraft();
        state.editingQuestionIndex = -1;
      } else if (state.editingQuestionIndex > index) {
        state.editingQuestionIndex -= 1;
      }
      persistDraftState();
      renderLanding();
    });
  });

  document.querySelectorAll(".question-edit").forEach((button) => {
    button.addEventListener("click", () => {
      cacheLandingInputs();
      loadQuestionIntoEditor(Number(button.dataset.index));
    });
  });

  document.querySelectorAll(".saved-game-edit").forEach((button) => {
    button.addEventListener("click", () => {
      loadGameIntoEditor(button.dataset.gameId || "");
    });
  });

  document.querySelectorAll(".saved-game-launch").forEach((button) => {
    button.addEventListener("click", () => {
      handleLaunchSavedGame(button.dataset.gameId || "");
    });
  });

  document.querySelectorAll(".saved-game-delete").forEach((button) => {
    button.addEventListener("click", () => {
      deleteSavedGame(button.dataset.gameId || "");
    });
  });

  const cancelQuestionEditButton = document.getElementById("cancel-question-edit");
  if (cancelQuestionEditButton) {
    cancelQuestionEditButton.addEventListener("click", cancelQuestionEdit);
  }

  const addAsNewQuestionButton = document.getElementById("add-as-new-question");
  if (addAsNewQuestionButton) {
    addAsNewQuestionButton.addEventListener("click", switchToAddNewQuestion);
  }
}

function cacheLandingInputs() {
  state.hostDraftName = document.getElementById("host-name")?.value.trim() || state.hostDraftName;
  state.gameTitleDraft = document.getElementById("game-title")?.value.trim() || state.gameTitleDraft;
  persistDraftState();
}

function formatShortDate(value) {
  if (!value) {
    return "recently";
  }

  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function resetEditorState() {
  state.draftQuestions = [];
  state.questionDraft = createEmptyDraft();
  state.gameTitleDraft = "";
  state.editingGameId = "";
  state.editingQuestionIndex = -1;
}

function startNewGameSetup() {
  resetEditorState();
  persistDraftState();
  renderLanding();
  window.requestAnimationFrame(() => {
    document.getElementById("game-editor-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("game-title")?.focus();
  });
  showToast("New game form is ready.");
}

function upsertSavedGameRecord(record) {
  const others = state.savedGames.filter((game) => game.id !== record.id);
  return [record, ...others].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function loadGameIntoEditor(gameId) {
  const game = state.savedGames.find((entry) => entry.id === gameId);
  if (!game) {
    showToast("Saved game not found.");
    return;
  }

  state.editingGameId = game.id;
  state.gameTitleDraft = game.title;
  state.draftQuestions = deepClone(game.questions);
  state.questionDraft = createEmptyDraft();
  state.editingQuestionIndex = -1;
  persistDraftState();
  renderLanding();
  window.requestAnimationFrame(() => {
    document.getElementById("game-editor-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("draft-prompt")?.focus();
  });
  showToast("Quiz loaded. Add more questions, then click Save quiz changes.");
}

function loadQuestionIntoEditor(index) {
  const question = state.draftQuestions[index];
  if (!question) {
    showToast("Question not found.");
    return;
  }

  const type = question.type === "multiple-choice" ? "multiple-choice" : "short-answer";
  const draft = createEmptyDraft(type);
  draft.prompt = question.prompt || "";
  draft.timeLimitSec = Number(question.timeLimitSec || 20);
  draft.imageUrl = question.imageUrl || "";
  draft.imageName = question.imageName || "";
  draft.isWeighted = Boolean(question.isWeighted);
  draft.pointValue = Number(question.pointValue || 1000);
  draft.fastestBonusPoints = Number(question.fastestBonusPoints || 0);

  if (type === "multiple-choice") {
    const options = Array.isArray(question.options) ? [...question.options] : [];
    while (options.length < 4) {
      options.push("");
    }
    draft.options = options.slice(0, 4);
    const correctIndex = draft.options.findIndex((option) => option === question.correctAnswer);
    draft.correctOptionIndex = correctIndex >= 0 ? correctIndex : 0;
  } else {
    draft.acceptedAnswers = Array.isArray(question.acceptedAnswers)
      ? question.acceptedAnswers.join(", ")
      : String(question.acceptedAnswers || "");
  }

  state.questionDraft = draft;
  state.editingQuestionIndex = index;
  persistDraftState();
  renderLanding();
  window.requestAnimationFrame(() => {
    document.getElementById("game-editor-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("draft-prompt")?.focus();
  });
  showToast(`Editing question ${index + 1}.`);
}

function cancelQuestionEdit() {
  state.questionDraft = createEmptyDraft(state.questionDraft.type);
  state.editingQuestionIndex = -1;
  persistDraftState();
  renderLanding();
  showToast("Question edit canceled.");
}

function switchToAddNewQuestion() {
  readDraftForm();
  state.editingQuestionIndex = -1;
  persistDraftState();
  renderLanding();
  window.requestAnimationFrame(() => {
    document.getElementById("draft-prompt")?.focus();
  });
  showToast("Now adding a brand-new question.");
}

function deleteSavedGame(gameId) {
  state.savedGames = state.savedGames.filter((game) => game.id !== gameId);
  if (state.editingGameId === gameId) {
    resetEditorState();
  }
  persistDraftState();
  renderLanding();
}

async function handleLaunchSavedGame(gameId) {
  const game = state.savedGames.find((entry) => entry.id === gameId);
  if (!game) {
    showToast("Saved game not found.");
    return;
  }

  const hostName = (document.getElementById("host-name")?.value || state.hostDraftName || "").trim();
  if (!hostName) {
    showToast("Enter a host name before launching a game.");
    return;
  }

  state.hostDraftName = hostName;
  persistDraftState();
  await launchGameFromTemplate(game, hostName);
}

function renderGame() {
  if (!state.game) {
    renderLanding();
    return;
  }

  updateHeroTitle();

  if (state.viewMode === "presentation") {
    renderPresentationMode();
    return;
  }

  const question = getCurrentQuestion(state.game);
  const rankedPlayers = sortPlayers(state.players);
  const isHost = state.role === "host";
  const me = state.players.find((player) => player.id === state.currentPlayerId);
  const currentAnswer = question ? getPlayerAnswer(state.game.current_question_index) : null;
  const hasSubmitted = Boolean(currentAnswer);
  const canSubmit = state.game.phase === "question" && question && !hasSubmitted && !isHost;
  const leaderboardMarkup = renderLeaderboard(rankedPlayers, me?.id);

  if (state.currentTimerId) {
    window.clearInterval(state.currentTimerId);
  }

  el.app.innerHTML = `
    <div class="session-grid">
      <section class="card card-pad">
        <div class="section-title">
          <div>
            <p class="eyebrow">Room Code</p>
            <div class="room-code">${escapeHtml(state.game.room_code)}</div>
          </div>
          <div class="stack">
            <span class="pill">${escapeHtml(state.game.title)}</span>
            <span class="pill">${isHost ? "Host View" : "Player View"}</span>
          </div>
        </div>
        <div class="metric-grid">
          <div class="metric">
            <div class="metric-label">Status</div>
            <div class="metric-value">${prettyStatus(state.game.phase)}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Players</div>
            <div class="metric-value">${state.players.length}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Question</div>
            <div class="metric-value">${state.game.current_question_index + 1}/${state.game.questions_json.length}</div>
          </div>
        </div>
      </section>

      <div class="question-layout ${isHost ? "question-layout-host" : ""}">
        <section class="card card-pad stack">
          ${renderMainPanel({ question, isHost, currentAnswer, canSubmit })}
        </section>
        <aside class="panel-grid">
          <section class="card card-pad">
            <div class="section-title">
              <h3>Leaderboard</h3>
              <span class="tag">Live</span>
            </div>
            ${leaderboardMarkup}
          </section>
          <section class="card card-pad">
            <div class="section-title">
              <h3>Players</h3>
              <span class="tag">${state.players.length} joined</span>
            </div>
            ${renderPlayersList()}
          </section>
        </aside>
      </div>
    </div>
  `;

  wireGameActions(question, isHost);
  startTimerLoop(question, isHost);
}

function prettyStatus(value) {
  const map = {
    lobby: "Lobby",
    question: "Live",
    reveal: "Reveal",
    finished: "Finished",
  };

  return map[value] || value;
}

function renderPlayersList() {
  if (!state.players.length) {
    return `<div class="empty">Waiting for players to join.</div>`;
  }

  return `
    <ul class="player-list">
      ${sortPlayers(state.players)
        .map(
          (player) => `
            <li>
              <span>${escapeHtml(player.display_name)}</span>
              <strong>${player.score} pts</strong>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderLeaderboard(rankedPlayers, currentPlayerId) {
  if (!rankedPlayers.length) {
    return `<div class="empty">Leaderboard will appear once players join.</div>`;
  }

  return `
    <ol class="leader-list">
      ${rankedPlayers
        .slice(0, 8)
        .map((player, index) => {
          const leaderClass = index === 0 ? "is-first" : "";
          const marker = player.id === currentPlayerId ? " (You)" : "";
          return `
            <li class="${leaderClass}">
              <span>${index + 1}. ${escapeHtml(player.display_name)}${marker}</span>
              <strong>${player.score} pts</strong>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderFullStandings(rankedPlayers, currentPlayerId = "") {
  if (!rankedPlayers.length) {
    return `<div class="empty">No final standings yet.</div>`;
  }

  return `
    <ol class="leader-list final-standings-list">
      ${rankedPlayers
        .map((player, index) => {
          const marker = player.id === currentPlayerId ? " (You)" : "";
          const leaderClass = index === 0 ? "is-first" : "";
          return `
            <li class="${leaderClass}">
              <span>${index + 1}. ${escapeHtml(player.display_name)}${marker}</span>
              <strong>${player.score} pts</strong>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderQuestionMedia(question) {
  if (!question?.imageUrl) {
    return "";
  }

  return `<img class="live-question-image" src="${question.imageUrl}" alt="Question image" />`;
}

function getRoundRankings(questionIndex) {
  const playersById = new Map(state.players.map((player) => [player.id, player]));
  return state.answers
    .filter((answer) => answer.question_index === questionIndex && Number(answer.points_awarded || 0) > 0)
    .map((answer) => ({
      playerId: answer.player_id,
      displayName: playersById.get(answer.player_id)?.display_name || "Player",
      points: Number(answer.points_awarded || 0),
      responseMs: Number(answer.response_ms || Number.MAX_SAFE_INTEGER),
    }))
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      if (a.responseMs !== b.responseMs) {
        return a.responseMs - b.responseMs;
      }
      return a.displayName.localeCompare(b.displayName);
    });
}

function renderRoundPodium(questionIndex) {
  const topThree = getRoundRankings(questionIndex).slice(0, 3);
  if (!topThree.length) {
    return `<div class="empty">No correct answers this round yet.</div>`;
  }

  const order = [1, 0, 2]
    .map((index) => topThree[index])
    .filter(Boolean);

  return `
    <div class="podium-wrap">
      ${order
        .map((entry) => {
          const placement = topThree.indexOf(entry) + 1;
          const levelClass = placement === 1 ? "is-first" : placement === 2 ? "is-second" : "is-third";
          const label = placement === 1 ? "1st" : placement === 2 ? "2nd" : "3rd";
          return `
            <div class="podium-slot ${levelClass}">
              <div class="podium-place">${label}</div>
              <div class="podium-name">${escapeHtml(entry.displayName)}</div>
              <div class="podium-points">${entry.points} pts</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getOverallWinnerName() {
  const rankedPlayers = sortPlayers(state.players);
  return rankedPlayers[0]?.display_name || state.players[0]?.display_name || "No players";
}

function renderPresentationMode() {
  const question = getCurrentQuestion(state.game);
  const rankedPlayers = sortPlayers(state.players);
  const qrImageUrl = getQrImageUrl(state.game.room_code);
  const joinUrl = getJoinUrl(state.game.room_code);
  const topFive = rankedPlayers.slice(0, 5);

  if (state.currentTimerId) {
    window.clearInterval(state.currentTimerId);
  }

  if (state.game.phase === "lobby") {
    el.app.innerHTML = `
      <section class="presentation-page">
        <div class="presentation-hero-panel">
          <p class="eyebrow">AAHOA Trivia Room</p>
          <h2 class="presentation-title">${escapeHtml(state.game.title)}</h2>
          <p class="presentation-subtitle">Scan the QR code to open the AAHOA join page, enter your name, and join this room.</p>
          <div class="presentation-room-block">
            <div class="metric-label">Room Code</div>
            <div class="room-code">${escapeHtml(state.game.room_code)}</div>
          </div>
          <div class="presentation-player-count">
            <div class="metric-label">Players joined</div>
            <div class="metric-value">${state.players.length}</div>
          </div>
          <div class="presentation-lobby-grid">
            <div class="presentation-lobby-card">
              <div class="section-title">
                <h3>Joined players</h3>
                <span class="tag">${state.players.length}</span>
              </div>
              ${
                rankedPlayers.length
                  ? `
                      <ol class="leader-list presentation-compact-list">
                        ${rankedPlayers
                          .slice(0, 12)
                          .map(
                            (player, index) => `
                              <li>
                                <span>${index + 1}. ${escapeHtml(player.display_name)}</span>
                                <strong>${player.score} pts</strong>
                              </li>
                            `,
                          )
                          .join("")}
                      </ol>
                    `
                  : `<div class="empty">No players have joined yet.</div>`
              }
            </div>
            <div class="presentation-lobby-card">
              <div class="section-title">
                <h3>How points work</h3>
                <span class="tag">Scoring</span>
              </div>
              <div class="notice">
                Correct answer: full question points.
                <br />
                Weighted questions: higher point values.
                <br />
                Fastest bonus: only one player earns it, and only if they are the fastest correct answer within 10 seconds.
                <br />
                Leaderboard updates after every reveal.
              </div>
            </div>
          </div>
          <div class="presentation-lobby-card">
            <div class="section-title">
              <h3>Current leaderboard</h3>
              <span class="tag">Top 5</span>
            </div>
            ${
              topFive.length
                ? `
                    <ol class="leader-list reveal-leader-list presentation-leaderboard">
                      ${topFive
                        .map(
                          (player, index) => `
                            <li class="${index === 0 ? "is-first" : ""}">
                              <span>${index + 1}. ${escapeHtml(player.display_name)}</span>
                              <strong>${player.score} pts</strong>
                            </li>
                          `,
                        )
                        .join("")}
                    </ol>
                  `
                : `<div class="empty">Leaderboard will appear as players join and answer.</div>`
            }
          </div>
          ${
            state.role === "host"
              ? `
                <div class="presentation-control-bar">
                  <button class="btn btn-primary" id="presentation-start-game">Begin question 1</button>
                </div>
              `
              : ""
          }
        </div>
        <div class="presentation-join-panel">
          <img class="presentation-qr" src="${qrImageUrl}" alt="QR code to join trivia room" />
          <div class="presentation-link-label">Join link</div>
          <div class="presentation-link">${escapeHtml(joinUrl)}</div>
        </div>
      </section>
    `;
    wirePresentationActions();
    return;
  }

  if (state.game.phase === "finished") {
    el.app.innerHTML = `
      <section class="presentation-page">
        <div class="presentation-slide presentation-finished-slide">
          <p class="eyebrow">Game Complete</p>
          <h2 class="presentation-title">${escapeHtml(state.game.title)}</h2>
          <div class="presentation-question">Winner: ${escapeHtml(getOverallWinnerName())}</div>
          <div class="section-title">
            <h3>Final standings</h3>
            <span class="tag">${rankedPlayers.length} players</span>
          </div>
          ${renderFullStandings(rankedPlayers)}
          ${
            topFive.length
              ? `
                <ol class="leader-list reveal-leader-list presentation-leaderboard">
                  ${topFive
                    .map(
                      (player, index) => `
                        <li class="${index === 0 ? "is-first" : ""}">
                          <span>${index + 1}. ${escapeHtml(player.display_name)}</span>
                          <strong>${player.score} pts</strong>
                        </li>
                      `,
                    )
                    .join("")}
                </ol>
              `
              : `<div class="empty">No scores yet.</div>`
          }
        </div>
      </section>
    `;
    return;
  }

  if (!question) {
    el.app.innerHTML = `
      <section class="presentation-page">
        <div class="presentation-slide">
          <h2 class="presentation-title">${escapeHtml(state.game.title)}</h2>
          <p class="muted">Waiting for the next question.</p>
        </div>
      </section>
    `;
    return;
  }

  if (state.game.phase === "reveal") {
    el.app.innerHTML = `
      <section class="presentation-page">
        <div class="presentation-slide reveal-slide presentation-full-slide">
          <div class="presentation-topline">
            <span class="pill">Answer review</span>
            <span class="pill">Round winners</span>
          </div>
          <div class="presentation-question">${escapeHtml(question.prompt)}</div>
          ${renderQuestionMedia(question)}
          <div class="answer-state answer-state-host">
            <p><strong>Correct answer:</strong> ${escapeHtml(formatAnswerList(question))}</p>
          </div>
          <div class="section-title">
            <h3>Top 3 this round</h3>
            <span class="tag">Fastest correct answers</span>
          </div>
          ${renderRoundPodium(state.game.current_question_index)}
          <div class="section-title">
            <h3>Overall top 5</h3>
            <span class="tag">Running leaderboard</span>
          </div>
          ${
            topFive.length
              ? `
                <ol class="leader-list reveal-leader-list presentation-leaderboard">
                  ${topFive
                    .map(
                      (player, index) => `
                        <li class="${index === 0 ? "is-first" : ""}">
                          <span>${index + 1}. ${escapeHtml(player.display_name)}</span>
                          <strong>${player.score} pts</strong>
                        </li>
                      `,
                    )
                    .join("")}
                </ol>
              `
              : `<div class="empty">No scores yet.</div>`
          }
          ${
            state.role === "host"
              ? renderPresentationControls({
                  phase: "reveal",
                  isLastQuestion: state.game.current_question_index >= state.game.questions_json.length - 1,
                })
              : ""
          }
        </div>
      </section>
    `;
    wirePresentationActions();
    return;
  }

  const remainingSeconds = computeRemainingSeconds(state.game, question);
  const timerPercent = computeTimerPercent(state.game, question);

  el.app.innerHTML = `
    <section class="presentation-page">
      <div class="presentation-slide presentation-full-slide">
        <div class="presentation-topline">
          <span class="pill">Question ${state.game.current_question_index + 1}</span>
          <span class="pill">${getQuestionTypeLabel(question.type)}</span>
          <span class="pill">Room ${escapeHtml(state.game.room_code)}</span>
        </div>
        <div class="presentation-question">${escapeHtml(question.prompt)}</div>
        ${renderQuestionMedia(question)}
        <div class="presentation-footer">
          <div class="timer-card presentation-timer">
            <div class="metric-label">Time left</div>
            <div class="timer-value" id="timer-value">${remainingSeconds}s</div>
            <div class="timer-bar"><span id="timer-fill" style="width:${timerPercent}%"></span></div>
          </div>
          <div class="presentation-status">
            <div class="notice">Players answer on their phones after joining with the QR code or room code.</div>
            <div class="presentation-mini-join">
              <img class="presentation-mini-qr" src="${qrImageUrl}" alt="QR code to join trivia room" />
              <div>
                <div class="metric-label">Join</div>
                <div class="tiny">${escapeHtml(state.game.room_code)}</div>
              </div>
            </div>
          </div>
        </div>
        ${
          state.role === "host"
            ? renderPresentationControls({
                phase: "question",
                remainingSeconds,
                isLastQuestion: false,
              })
            : ""
        }
      </div>
    </section>
  `;

  startTimerLoop(question, false);
  wirePresentationActions();
}

function renderPresentationControls({ phase, remainingSeconds = 0, isLastQuestion = false }) {
  return `
    <div class="presentation-control-bar">
      ${
        phase === "reveal"
          ? `<button class="btn btn-primary" id="presentation-next-question">${isLastQuestion ? "Finish game" : "Next question"}</button>`
          : `<button class="btn btn-primary" id="presentation-reveal-answer">${remainingSeconds === 0 ? "Reveal leaderboard" : "Reveal now"}</button>`
      }
      <button class="btn btn-secondary" id="presentation-end-game">End game</button>
    </div>
  `;
}

function wirePresentationActions() {
  const startButton = document.getElementById("presentation-start-game");
  if (startButton) {
    startButton.addEventListener("click", () => startQuestion(0));
  }

  const revealButton = document.getElementById("presentation-reveal-answer");
  if (revealButton) {
    revealButton.addEventListener("click", revealQuestion);
  }

  const nextButton = document.getElementById("presentation-next-question");
  if (nextButton) {
    nextButton.addEventListener("click", async () => {
      const nextIndex = state.game.current_question_index + 1;
      if (nextIndex >= state.game.questions_json.length) {
        await finishGame();
        return;
      }

      await startQuestion(nextIndex);
    });
  }

  const endButton = document.getElementById("presentation-end-game");
  if (endButton) {
    endButton.addEventListener("click", finishGame);
  }
}

function renderMainPanel({ question, isHost, currentAnswer, canSubmit }) {
  if (state.game.phase === "lobby") {
    return `
      <div class="section-title">
        <h2>Lobby</h2>
        <span class="tag">Join with the room code</span>
      </div>
      <p class="muted">
        ${isHost ? "Wait for players to join, then start question 1." : "You are in. Hang tight until the host starts the round."}
      </p>
      ${isHost ? renderHostLobbyControls() : renderPlayerLobbyCard()}
    `;
  }

  if (state.game.phase === "finished") {
    const rankedPlayers = sortPlayers(state.players);
    return `
      <div class="section-title">
        <h2>Game complete</h2>
        <span class="tag">Final results</span>
      </div>
      <p class="muted">
        ${isHost ? "You can start another room from the landing page." : "Thanks for playing."}
      </p>
      <div class="score-strip">
        <strong>Winner:</strong> ${escapeHtml(getOverallWinnerName())}
      </div>
      <div class="section-title">
        <h3>Full leaderboard</h3>
        <span class="tag">${rankedPlayers.length} players</span>
      </div>
      ${renderFullStandings(rankedPlayers, state.currentPlayerId)}
      <div class="button-row">
        <button class="btn btn-secondary" id="leave-room">Back to landing page</button>
      </div>
    `;
  }

  if (!question) {
    return `<div class="empty">No question is active yet.</div>`;
  }

  const remainingSeconds = computeRemainingSeconds(state.game, question);
  const timerPercent = computeTimerPercent(state.game, question);
  const answersForQuestion = state.answers.filter(
    (answer) => answer.question_index === state.game.current_question_index,
  );
  const rankedPlayers = sortPlayers(state.players);

  if (isHost && state.game.phase === "question") {
    return renderHostQuestionPresentation(question, remainingSeconds, timerPercent, answersForQuestion.length);
  }

  if (isHost && state.game.phase === "reveal") {
    return renderHostRevealPresentation(question, rankedPlayers);
  }

  return `
    <div class="timer-card">
      <div class="metric-label">Time left</div>
      <div class="timer-value" id="timer-value">${remainingSeconds}s</div>
      <div class="timer-bar"><span id="timer-fill" style="width:${timerPercent}%"></span></div>
    </div>

    <div class="section-title">
      <div>
        <p class="eyebrow">Question ${state.game.current_question_index + 1}</p>
        <div class="question-title">${escapeHtml(question.prompt)}</div>
      </div>
      <span class="tag">${getQuestionTypeLabel(question.type)}</span>
    </div>

    ${renderQuestionMedia(question)}

    <div class="question-meta">
      ${
        isHost
          ? `${answersForQuestion.length} of ${state.players.length} players have answered.`
          : "Correct answers in the first 5 seconds score the biggest bonus."
      }
    </div>

    ${
      state.game.phase === "question"
        ? renderQuestionInput(question, canSubmit, currentAnswer)
        : renderRevealPanel(question, currentAnswer)
    }

    ${isHost ? renderHostQuestionControls(question, remainingSeconds) : ""}
  `;
}

function renderHostQuestionPresentation(question, remainingSeconds, timerPercent, answerCount) {
  return `
    <div class="presentation-slide">
      <div class="presentation-topline">
        <span class="pill">Question ${state.game.current_question_index + 1}</span>
        <span class="pill">${getQuestionTypeLabel(question.type)}</span>
      </div>
      <div class="presentation-question">${escapeHtml(question.prompt)}</div>
      ${renderQuestionMedia(question)}
      <div class="presentation-footer">
        <div class="timer-card presentation-timer">
          <div class="metric-label">Time left</div>
          <div class="timer-value" id="timer-value">${remainingSeconds}s</div>
          <div class="timer-bar"><span id="timer-fill" style="width:${timerPercent}%"></span></div>
        </div>
        <div class="presentation-status">
          <div class="metric">
            <div class="metric-label">Responses</div>
            <div class="metric-value">${answerCount}/${state.players.length}</div>
          </div>
          <div class="notice">Ask players to answer now. You can reveal early or wait for the timer.</div>
        </div>
      </div>
      ${renderHostQuestionControls(question, remainingSeconds)}
    </div>
  `;
}

function renderHostRevealPresentation(question, rankedPlayers) {
  const topFive = rankedPlayers.slice(0, 5);
  return `
    <div class="presentation-slide reveal-slide">
      <div class="presentation-topline">
        <span class="pill">Answer review</span>
        <span class="pill">Round winners</span>
      </div>
      <div class="presentation-question">${escapeHtml(question.prompt)}</div>
      ${renderQuestionMedia(question)}
      <div class="answer-state answer-state-host">
        <p><strong>Correct answer:</strong> ${escapeHtml(formatAnswerList(question))}</p>
        <p><strong>Host cue:</strong> Review the answer, then move to the next question when you're ready.</p>
      </div>
      <div class="section-title">
        <h3>Top 3 this round</h3>
        <span class="tag">After question ${state.game.current_question_index + 1}</span>
      </div>
      ${renderRoundPodium(state.game.current_question_index)}
      <div class="section-title">
        <h3>Overall top 5</h3>
        <span class="tag">After question ${state.game.current_question_index + 1}</span>
      </div>
      ${
        topFive.length
          ? `
              <ol class="leader-list reveal-leader-list">
                ${topFive
                  .map(
                    (player, index) => `
                      <li class="${index === 0 ? "is-first" : ""}">
                        <span>${index + 1}. ${escapeHtml(player.display_name)}</span>
                        <strong>${player.score} pts</strong>
                      </li>
                    `,
                  )
                  .join("")}
              </ol>
            `
          : `<div class="empty">No scores yet.</div>`
      }
      ${renderHostQuestionControls(question, 0)}
    </div>
  `;
}

function renderHostLobbyControls() {
  const joinUrl = getJoinUrl(state.game.room_code);
  const qrImageUrl = getQrImageUrl(state.game.room_code);
  return `
    <div class="host-join-stage">
      <div class="host-join-copy">
        <div class="section-title">
          <h3>How players join</h3>
          <span class="tag">Before you start</span>
        </div>
        <div class="notice">
          1. Open the presentation tab on the big screen.
          <br />
          2. Ask players to scan the QR code or open the join page.
          <br />
          3. They enter their names and join the room.
          <br />
          4. Begin the first question when everyone is ready.
        </div>
        <div class="status-strip">
          <strong>Room code:</strong> ${escapeHtml(state.game.room_code)}
        </div>
        <div class="tiny muted">${escapeHtml(joinUrl)}</div>
      </div>
      <div class="host-join-qr-card">
        <img class="host-join-qr" src="${qrImageUrl}" alt="QR code to join trivia room" />
        <div class="tiny muted">Scan to open the join page with the room code prefilled.</div>
      </div>
    </div>
    <div class="button-row">
      <button class="btn btn-secondary" id="host-start-presentation">Open presentation tab</button>
      <button class="btn btn-primary" id="host-start-game">Start question 1</button>
      <button class="btn btn-secondary" id="leave-room">Back to landing page</button>
    </div>
  `;
}

function renderPlayerLobbyCard() {
  return `
    <div class="player-join-card">
      <p class="eyebrow">AAHOA Trivia Join</p>
      <h3>You're in the room</h3>
      <div class="status-strip"><strong>Room code:</strong> ${escapeHtml(state.game.room_code)}</div>
      <div class="notice">
        Stay on this page. The first question will appear automatically once the host begins the round.
      </div>
    </div>
    <div class="button-row">
      <button class="btn btn-secondary" id="leave-room">Leave room</button>
    </div>
  `;
}

function renderQuestionInput(question, canSubmit, currentAnswer) {
  if (question.type === "multiple-choice") {
    return `
      <form id="answer-form" class="stack">
        <div class="option-list">
          ${question.options
            .map((option, index) => {
              const checked = state.selectedAnswer === option ? "checked" : "";
              const selectedClass = state.selectedAnswer === option ? "is-selected" : "";
              return `
                <label class="option ${selectedClass}">
                  <input type="radio" name="answer" value="${escapeHtml(option)}" ${checked} ${canSubmit ? "" : "disabled"} />
                  <div>
                    <strong>${String.fromCharCode(65 + index)}.</strong> ${escapeHtml(option)}
                  </div>
                </label>
              `;
            })
            .join("")}
        </div>
        <button class="btn btn-primary" type="submit" ${canSubmit ? "" : "disabled"}>
          ${currentAnswer ? "Answer submitted" : "Submit answer"}
        </button>
      </form>
    `;
  }

  return `
    <form id="answer-form" class="stack">
      <label>
        Your answer
        <input id="typed-answer" name="typedAnswer" value="${escapeHtml(state.typedAnswer)}" placeholder="Type your answer" ${canSubmit ? "" : "disabled"} />
      </label>
      <button class="btn btn-primary" type="submit" ${canSubmit ? "" : "disabled"}>
        ${currentAnswer ? "Answer submitted" : "Submit answer"}
      </button>
    </form>
  `;
}

function renderRevealPanel(question, currentAnswer) {
  const myAnswerText = currentAnswer ? escapeHtml(currentAnswer.answer_text) : "No answer submitted";
  const answerState = currentAnswer
    ? currentAnswer.is_correct
      ? "Correct"
      : "Incorrect"
    : "No answer";
  const points = currentAnswer?.points_awarded ?? 0;

  return `
    <div class="answer-state">
      <p><strong>Correct answer:</strong> ${escapeHtml(formatAnswerList(question))}</p>
      <p><strong>Your answer:</strong> ${myAnswerText}</p>
      <p><strong>Result:</strong> ${answerState}</p>
      <p><strong>Points this round:</strong> ${points}</p>
    </div>
  `;
}

function renderHostQuestionControls(question, remainingSeconds) {
  const isReveal = state.game.phase === "reveal";
  const isLastQuestion = state.game.current_question_index >= state.game.questions_json.length - 1;

  return `
    <div class="divider"></div>
    <div class="section-title">
      <h3>Host controls</h3>
      <span class="tag">${remainingSeconds === 0 && !isReveal ? "Time is up" : "Live control"}</span>
    </div>
    <div class="button-row">
      ${
        isReveal
          ? `<button class="btn btn-primary" id="host-next-question">${isLastQuestion ? "Finish game" : "Start next question"}</button>`
          : `<button class="btn btn-primary" id="host-reveal-answer">${remainingSeconds === 0 ? "Reveal leaderboard" : "Reveal now"}</button>`
      }
      <button class="btn btn-secondary" id="host-open-presentation">Open presentation</button>
      <button class="btn btn-secondary" id="host-end-game">End game</button>
    </div>
    <div class="tiny muted">
      ${
        question.type !== "multiple-choice"
          ? "Tip: add multiple accepted answers for aliases, nicknames, and spelling variations."
          : "Tip: first 5 seconds score the strongest speed bonus."
      }
    </div>
  `;
}

function wireGameActions(question, isHost) {
  const leaveRoomButton = document.getElementById("leave-room");
  if (leaveRoomButton) {
    leaveRoomButton.addEventListener("click", leaveRoom);
  }

  const hostStartButton = document.getElementById("host-start-game");
  if (hostStartButton) {
    hostStartButton.addEventListener("click", async () => {
      openPresentationWindow();
      await startQuestion(0);
    });
  }

  const hostStartPresentationButton = document.getElementById("host-start-presentation");
  if (hostStartPresentationButton) {
    hostStartPresentationButton.addEventListener("click", () => {
      openPresentationWindow();
    });
  }

  const revealButton = document.getElementById("host-reveal-answer");
  if (revealButton) {
    revealButton.addEventListener("click", revealQuestion);
  }

  const nextButton = document.getElementById("host-next-question");
  if (nextButton) {
    nextButton.addEventListener("click", async () => {
      const nextIndex = state.game.current_question_index + 1;
      if (nextIndex >= state.game.questions_json.length) {
        await finishGame();
        return;
      }

      await startQuestion(nextIndex);
    });
  }

  const endButton = document.getElementById("host-end-game");
  if (endButton) {
    endButton.addEventListener("click", finishGame);
  }

  const openPresentationButton = document.getElementById("host-open-presentation");
  if (openPresentationButton) {
    openPresentationButton.addEventListener("click", () => {
      openPresentationWindow();
    });
  }

  if (!isHost && question && state.game.phase === "question") {
    const form = document.getElementById("answer-form");
    if (form) {
      form.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name === "answer") {
          state.selectedAnswer = target.value;
          renderGame();
        }
      });

      form.addEventListener("submit", handleAnswerSubmit);
    }
  }
}

function startTimerLoop(question, isHost) {
  if (!question || state.game.phase !== "question") {
    return;
  }

  state.currentTimerId = window.setInterval(async () => {
    const timerValue = document.getElementById("timer-value");
    const timerFill = document.getElementById("timer-fill");
    const remaining = computeRemainingSeconds(state.game, question);

    if (timerValue) {
      timerValue.textContent = `${remaining}s`;
    }

    if (timerFill) {
      timerFill.style.width = `${computeTimerPercent(state.game, question)}%`;
    }

    if (isHost && remaining <= 0 && !state.autoRevealLock) {
      state.autoRevealLock = true;
      try {
        await revealQuestion();
      } finally {
        state.autoRevealLock = false;
      }
    }
  }, 250);
}

function normalizeQuestion(question, index) {
  const type = question.type === "multiple-choice" ? "multiple-choice" : "short-answer";
  const base = {
    id: question.id || `q${index + 1}`,
    type,
    prompt: String(question.prompt || "").trim(),
    timeLimitSec: Number(question.timeLimitSec || 20),
    imageUrl: question.imageUrl || "",
    isWeighted: Boolean(question.isWeighted),
    pointValue: Math.max(100, Number(question.pointValue || 1000)),
    fastestBonusPoints: Math.max(0, Number(question.fastestBonusPoints || 0)),
  };

  if (type !== "multiple-choice") {
    return {
      ...base,
      acceptedAnswers: Array.isArray(question.acceptedAnswers)
        ? question.acceptedAnswers.map((answer) => String(answer).trim()).filter(Boolean)
        : [String(question.acceptedAnswers || "").trim()].filter(Boolean),
    };
  }

  return {
    ...base,
    options: Array.isArray(question.options)
      ? question.options.map((option) => String(option).trim()).filter(Boolean)
      : [],
    correctAnswer: String(question.correctAnswer || "").trim(),
  };
}

function readDraftForm() {
  const type = document.getElementById("draft-type")?.value || "multiple-choice";
  const options = Array.from(document.querySelectorAll(".draft-option")).map((input) => input.value.trim());

  state.questionDraft = {
    ...state.questionDraft,
    type,
    prompt: document.getElementById("draft-prompt")?.value.trim() || "",
    timeLimitSec: Number(document.getElementById("draft-timer")?.value || 20),
    isWeighted: Boolean(document.getElementById("draft-weighted")?.checked),
    pointValue: Number(document.getElementById("draft-point-value")?.value || 1000),
    fastestBonusPoints: Number(document.getElementById("draft-fastest-bonus")?.value || 0),
    options,
    correctOptionIndex: Number(document.getElementById("draft-correct-index")?.value || 0),
    acceptedAnswers: document.getElementById("draft-accepted-answers")?.value.trim() || "",
  };
  persistDraftState();
}

function handleDraftTypeChange(event) {
  cacheLandingInputs();
  readDraftForm();
  state.questionDraft.type = event.target.value;
  persistDraftState();
  renderLanding();
}

async function handleDraftImageSelect(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    cacheLandingInputs();
    state.questionDraft.imageUrl = String(reader.result || "");
    state.questionDraft.imageName = file.name;
    persistDraftState();
    renderLanding();
  };
  reader.readAsDataURL(file);
}

function handleQuestionAdd(event) {
  event.preventDefault();
  cacheLandingInputs();
  readDraftForm();
  const wasEditingQuestion = state.editingQuestionIndex >= 0;

  if (!state.questionDraft.prompt) {
    showToast("Please enter the question text.");
    return;
  }

  const questionIndex = state.editingQuestionIndex >= 0 ? state.editingQuestionIndex + 1 : state.draftQuestions.length + 1;
  const baseQuestion = {
    id: `q${questionIndex}`,
    type: state.questionDraft.type,
    prompt: state.questionDraft.prompt,
    timeLimitSec: Math.min(60, Math.max(5, Number(state.questionDraft.timeLimitSec || 20))),
    imageUrl: state.questionDraft.imageUrl,
    isWeighted: Boolean(state.questionDraft.isWeighted),
    pointValue: Math.max(100, Number(state.questionDraft.pointValue || 1000)),
    fastestBonusPoints: Math.max(0, Number(state.questionDraft.fastestBonusPoints || 0)),
  };

  if (state.questionDraft.type === "multiple-choice") {
    const options = state.questionDraft.options.map((option) => option.trim()).filter(Boolean);
    if (options.length < 2) {
      showToast("Please enter at least two answer options.");
      return;
    }

    const correctAnswer = state.questionDraft.options[state.questionDraft.correctOptionIndex]?.trim();
    if (!correctAnswer) {
      showToast("Please choose a filled-in correct option.");
      return;
    }

    const nextQuestion = {
      ...baseQuestion,
      options,
      correctAnswer,
    };

    if (state.editingQuestionIndex >= 0) {
      state.draftQuestions.splice(state.editingQuestionIndex, 1, nextQuestion);
    } else {
      state.draftQuestions.push(nextQuestion);
    }
  } else {
    const acceptedAnswers = state.questionDraft.acceptedAnswers
      .split(",")
      .map((answer) => answer.trim())
      .filter(Boolean);

    if (!acceptedAnswers.length) {
      showToast("Please add at least one accepted answer.");
      return;
    }

    const nextQuestion = {
      ...baseQuestion,
      acceptedAnswers,
    };

    if (state.editingQuestionIndex >= 0) {
      state.draftQuestions.splice(state.editingQuestionIndex, 1, nextQuestion);
    } else {
      state.draftQuestions.push(nextQuestion);
    }
  }

  state.questionDraft = createEmptyDraft(state.questionDraft.type);
  state.editingQuestionIndex = -1;
  persistDraftState();
  renderLanding();
  window.requestAnimationFrame(() => {
    document.getElementById("draft-prompt")?.focus();
  });
  showToast(
    wasEditingQuestion
      ? "Question updated. Click Save quiz changes."
      : state.editingGameId
        ? "Question added. Click Save quiz changes."
        : "Question added.",
  );
}

function handleSaveGameSetup() {
  cacheLandingInputs();

  if (!state.gameTitleDraft) {
    showToast("Please enter a game title before saving.");
    return;
  }

  if (!state.draftQuestions.length) {
    showToast("Add at least one question before saving this quiz.");
    return;
  }

  const record = createSavedGameRecord(
    state.gameTitleDraft,
    state.draftQuestions.map((question, index) => normalizeQuestion(question, index)),
    state.editingGameId || createId(),
  );

  state.savedGames = upsertSavedGameRecord(record);
  state.editingGameId = record.id;
  state.draftQuestions = deepClone(record.questions);
  persistDraftState();
  renderLanding();
  showToast("Quiz saved.");
}

async function launchGameFromTemplate(template, hostName) {
  const questions = template.questions.map((question, index) => normalizeQuestion(question, index));

  try {
    const game = await state.adapter.createGame({
      hostName,
      title: template.title,
      questions,
    });

    state.role = "host";
    state.game = game;
    state.roomCode = game.room_code;
    state.currentPlayerId = "";
    state.currentPlayerName = hostName;
    state.lastSubmittedQuestionIndex = -1;
    persistSession();
    await refreshSnapshot();
    subscribeToGame();
    renderGame();
    openPresentationWindow(game.room_code);
  } catch (error) {
    console.error(error);
    showToast(`Could not create room: ${error.message}`);
  }
}

async function handleJoinGame(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const displayName = String(form.get("playerName") || "").trim();
  const roomCode = String(form.get("roomCode") || "").trim().toUpperCase();

  if (!displayName || !roomCode) {
    showToast("Please enter your name and room code.");
    return;
  }

  try {
    const game = await state.adapter.getGame(roomCode);
    if (!game) {
      showToast("Room not found.");
      return;
    }

    const player = await state.adapter.joinGame({ roomCode, displayName });

    state.role = "player";
    state.game = game;
    state.roomCode = roomCode;
    state.currentPlayerId = player.id;
    state.currentPlayerName = player.display_name;
    state.lastSubmittedQuestionIndex = -1;
    persistSession();
    await refreshSnapshot();
    subscribeToGame();
    renderGame();
  } catch (error) {
    console.error(error);
    showToast(`Could not join room: ${error.message}`);
  }
}

async function refreshSnapshot() {
  if (!state.game?.id) {
    return;
  }

  const snapshot = await state.adapter.getSnapshot(state.game.id);
  state.game = snapshot.game;
  state.players = snapshot.players;
  state.answers = snapshot.answers;

  const currentQuestionIndex = state.game?.current_question_index ?? -1;
  if (currentQuestionIndex !== state.lastSubmittedQuestionIndex) {
    resetTransientAnswerState();
  }
}

function subscribeToGame() {
  if (state.unsubscribe) {
    state.unsubscribe();
  }

  if (!state.game?.id) {
    return;
  }

  state.unsubscribe = state.adapter.subscribe(state.game.id, (snapshot) => {
    state.game = snapshot.game;
    state.players = snapshot.players;
    state.answers = snapshot.answers;
    renderGame();
  });
}

async function startQuestion(questionIndex) {
  resetTransientAnswerState();
  state.lastSubmittedQuestionIndex = -1;
  persistSession();

  try {
    await state.adapter.updateGame(state.game.id, {
      status: "question",
      phase: "question",
      current_question_index: questionIndex,
      question_started_at: new Date().toISOString(),
      reveal_at: null,
    });
    await refreshSnapshot();
    renderGame();
  } catch (error) {
    console.error(error);
    showToast(`Could not start question: ${error.message}`);
  }
}

async function revealQuestion() {
  const question = getCurrentQuestion(state.game);
  if (!question || !state.game.question_started_at) {
    return;
  }

  try {
    const answersForQuestion = state.answers.filter(
      (answer) => answer.question_index === state.game.current_question_index,
    );

    const scoredAnswers = answersForQuestion.map((answer) => {
      const scoring = scoreAnswer(question, answer, state.game.question_started_at);
      return {
        ...answer,
        is_correct: scoring.isCorrect,
        response_ms: scoring.responseMs,
        points_awarded: scoring.basePoints,
      };
    });

    const fastestCorrectAnswer = scoredAnswers
      .filter((answer) => answer.is_correct && (answer.response_ms ?? Number.MAX_SAFE_INTEGER) <= 10000)
      .sort((a, b) => (a.response_ms ?? Number.MAX_SAFE_INTEGER) - (b.response_ms ?? Number.MAX_SAFE_INTEGER))[0];

    if (fastestCorrectAnswer && Number(question.fastestBonusPoints || 0) > 0) {
      fastestCorrectAnswer.points_awarded += Number(question.fastestBonusPoints || 0);
    }

    const answersByPlayer = new Map(scoredAnswers.map((answer) => [answer.player_id, answer.points_awarded]));

    const playerScores = state.players.map((player) => {
      const priorRoundScore = state.answers
        .filter(
          (answer) =>
            answer.player_id === player.id &&
            answer.question_index === state.game.current_question_index &&
            answer.points_awarded,
        )
        .reduce((sum, answer) => sum + answer.points_awarded, 0);
      const nextRoundScore = answersByPlayer.get(player.id) || 0;

      return {
        playerId: player.id,
        score: Math.max(0, player.score - priorRoundScore + nextRoundScore),
      };
    });

    await state.adapter.applyScoring(state.game.id, {
      answers: scoredAnswers,
      playerScores,
    });

    await state.adapter.updateGame(state.game.id, {
      phase: "reveal",
      status: "reveal",
      reveal_at: new Date().toISOString(),
    });
    await refreshSnapshot();
    renderGame();
  } catch (error) {
    console.error(error);
    showToast(`Could not reveal answers: ${error.message}`);
  }
}

async function finishGame() {
  try {
    await state.adapter.updateGame(state.game.id, {
      phase: "finished",
      status: "finished",
    });
    await refreshSnapshot();
    renderGame();
  } catch (error) {
    console.error(error);
    showToast(`Could not finish game: ${error.message}`);
  }
}

async function handleAnswerSubmit(event) {
  event.preventDefault();
  const question = getCurrentQuestion(state.game);
  if (!question) {
    return;
  }

  const answerText =
    question.type === "multiple-choice"
      ? state.selectedAnswer
      : String(document.getElementById("typed-answer")?.value || "").trim();

  if (!answerText) {
    showToast("Please choose or type an answer first.");
    return;
  }

  try {
    await state.adapter.submitAnswer({
      gameId: state.game.id,
      playerId: state.currentPlayerId,
      questionId: question.id,
      questionIndex: state.game.current_question_index,
      answerText,
    });
    state.lastSubmittedQuestionIndex = state.game.current_question_index;
    persistSession();
    await refreshSnapshot();
    renderGame();
  } catch (error) {
    console.error(error);
    showToast(`Could not submit answer: ${error.message}`);
  }
}

async function leaveRoom() {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  if (state.currentTimerId) {
    window.clearInterval(state.currentTimerId);
    state.currentTimerId = null;
  }

  state.game = null;
  state.players = [];
  state.answers = [];
  state.currentPlayerId = "";
  state.currentPlayerName = "";
  state.role = "";
  state.roomCode = "";
  state.selectedAnswer = "";
  state.typedAnswer = "";
  state.lastSubmittedQuestionIndex = -1;
  clearSession();
  renderLanding();
}

async function restoreSession() {
  if (!state.roomCode) {
    renderLanding();
    return;
  }

  if (requestedRoomCode && !state.currentPlayerId && state.role !== "host" && state.viewMode !== "presentation") {
    try {
      const previewGame = await state.adapter.getGame(state.roomCode);
      state.joinPreviewTitle = previewGame?.title || "AAHOA Trivia";
    } catch (error) {
      console.error(error);
    }
    renderLanding();
    return;
  }

  try {
    const game = await state.adapter.getGame(state.roomCode);
    if (!game) {
      clearSession();
      renderLanding();
      return;
    }

    state.game = game;
    await refreshSnapshot();
    subscribeToGame();
    renderGame();
  } catch (error) {
    console.error(error);
    renderLanding();
  }
}

restoreSession();

function getQuestionTypeLabel(type) {
  if (type === "multiple-choice") {
    return "Multiple choice";
  }

  return "Short answer";
}
