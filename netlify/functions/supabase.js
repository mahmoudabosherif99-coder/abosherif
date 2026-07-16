const SUPA_URL = "https://devxozrfoxvypllmhijj.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRldnhvenJmb3h2eXBsbG1oaWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTA1NzgsImV4cCI6MjA5Njc4NjU3OH0.JnYQyOnYf501SjkNtMBp1GGyLhtQQ8gAY6ElXnjrVRk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  const path = params.get("path") || "";
  const query = params.get("query") || "";
  const prefer = params.get("prefer") || "";
  const method = event.httpMethod;

  const supaUrl = `${SUPA_URL}/rest/v1/${path}${query ? "?" + query : ""}`;

  const headers = {
    "apikey": SUPA_KEY,
    "Authorization": `Bearer ${SUPA_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;

  const res = await fetch(supaUrl, {
    method,
    headers,
    body: method !== "GET" && method !== "DELETE" ? event.body : null,
  });

  const data = await res.text();
  return {
    statusCode: res.status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: data,
  };
};
