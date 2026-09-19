// Blank API_URL = same site. Vercel forwards /api/* to the bot on the VPS
// (see "rewrites" in vercel.json), so the browser never talks to the VPS directly.
window.ENV = {
  API_URL: "",
  API_KEY: localStorage.getItem("apiKey") || "",
};

// Ask for the key once per browser and remember it (it is never stored in code).
if (!window.ENV.API_KEY) {
  const k = prompt("Enter your dashboard API key:");
  if (k) {
    localStorage.setItem("apiKey", k.trim());
    window.ENV.API_KEY = k.trim();
  }
}
