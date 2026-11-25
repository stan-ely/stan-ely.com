import init, {
  process_quantized_msgpack,
  query_top_k_wasm,
  get_song,
} from "./pkg/rustic_rhythms.js";

const songIdInput = document.getElementById("songIdInput");
const runBtn = document.getElementById("runBtn");
const resultsDiv = document.getElementById("results");
const container = document.getElementById("song-toast-container");
const statusDiv = document.getElementById("songStatus");
const errorDiv = document.getElementById("songIdError");

const songDetailsDiv = document.getElementById("songDetails");

const WEIGHTS_URL =
  "https://file-246a3f.gitlab.io/rustic-rhythms/quantized_weights_with_song_data.msgpack";

// Set once the 1.3MB model has actually loaded. The run button is never
// enabled while this is false, no matter what the input validates to.
let wasmReady = false;

// Persistent status line. Unlike showToast(), this does not disappear — a
// failed model load has to stay on screen or the demo looks functional while
// every query fails.
function setStatus(message, isError = false) {
  if (!statusDiv) return;
  statusDiv.textContent = message;
  statusDiv.classList.toggle("is-error", Boolean(message) && isError);
}

// Helper to fetch and show song details for a given index
async function showSongDetails(index) {
  songDetailsDiv.classList.remove("active");
  songDetailsDiv.textContent = "";
  if (isNaN(index) || index < 0 || index > 75000) return;

  try {
    // Try to get the song details
    const details = await get_song(index);
    if (details && details.title && details.artist) {
      songDetailsDiv.innerHTML = `
        <div class="song-card" style="margin-bottom:0;">
          <div class="song-title">${details.title}</div>
          <div class="song-artist">${details.artist}</div>
        </div>
      `;
      songDetailsDiv.classList.add("active");
    } else {
      songDetailsDiv.textContent = "Song details unavailable.";
      songDetailsDiv.classList.add("active");
    }
  } catch (err) {
    songDetailsDiv.textContent = "Song details unavailable.";
    songDetailsDiv.classList.add("active");
  }
}

// Custom cached fetch
async function fetchWithCache(url) {
  const cacheName = "rustic-rhythms-cache";

  // Open cache storage
  const cache = await caches.open(cacheName);

  // Check if cached response exists
  const cachedResponse = await cache.match(url);
  if (cachedResponse) {
    console.log("Serving from cache");
    return cachedResponse;
  }

  // If not cached, fetch from network
  const networkResponse = await fetch(url);
  if (networkResponse && networkResponse.ok) {
    // Put a clone of response in cache
    cache.put(url, networkResponse.clone());
  }
  return networkResponse;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "song-toast";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2500);
}

// Initialize WASM module
async function initializeWasm() {
  wasmReady = false;
  songIdInput.disabled = true;
  runBtn.disabled = true;
  setStatus("Loading the model (~1.3MB)…");

  try {
    const response = await fetchWithCache(WEIGHTS_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    await init();

    // Call your WASM function with binary data
    process_quantized_msgpack(bytes);

    wasmReady = true;
    songIdInput.disabled = false;
    setStatus("");
  } catch (err) {
    // Leave input and run button disabled, and keep the message on screen.
    setStatus(
      "The recommendation model failed to load, so the demo can't run: " +
        (err && err.message ? err.message : err),
      true
    );
    if (statusDiv) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", () => {
        initializeWasm();
      });
      statusDiv.appendChild(retryBtn);
    }
  }
}
initializeWasm();

// Validate input and enable button. Writes to the inline error element rather
// than firing a toast, which used to pop on every keystroke.
function validateInput({ quiet = false } = {}) {
  const val = parseInt(songIdInput.value, 10);
  const valid = !isNaN(val) && val >= 0 && val <= 75000;

  songIdInput.classList.toggle("input-error", !valid);
  if (errorDiv) {
    errorDiv.textContent =
      valid || quiet ? "" : "Please enter a song ID between 0 and 75000.";
  }

  // The button can never be enabled before the model is ready.
  runBtn.disabled = !wasmReady || !valid;
  return valid;
}

songIdInput.addEventListener("input", () => {
  // Don't scold the user for an empty field they haven't filled in yet.
  validateInput({ quiet: songIdInput.value === "" });
  resultsDiv.textContent = ""; // Clear previous results on input change
  const queryIndex = parseInt(songIdInput.value, 10);
  showSongDetails(queryIndex);
});

runBtn.addEventListener("click", async () => {
  const queryIndex = parseInt(songIdInput.value, 10);
  resultsDiv.textContent = "Loading top 10 songs...";
  try {
    const top10 = await query_top_k_wasm(queryIndex, 10);
    if (!Array.isArray(top10) || top10.length === 0) {
      resultsDiv.textContent = "No results found.";
      return;
    }
    // Clear previous results
    resultsDiv.innerHTML = "";
    top10.forEach(({ title, artist }) => {
      const card = document.createElement("div");
      card.className = "song-card";
      const titleDiv = document.createElement("div");
      titleDiv.className = "song-title";
      titleDiv.textContent = title === '' ? '(Unknown Title)' : title;
      const artistDiv = document.createElement("div");
      artistDiv.className = "song-artist";
      artistDiv.textContent = artist === '' ? '(Unknown Artist)' : artist;
      card.appendChild(titleDiv);
      card.appendChild(artistDiv);
      resultsDiv.appendChild(card);
    });
  } catch (err) {
    resultsDiv.textContent = "Error fetching top songs: " + err.message;
  }
});

// Disable input/button till WASM initialized
songIdInput.disabled = true;
runBtn.disabled = true;
