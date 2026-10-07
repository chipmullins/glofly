import express from "express";

const app = express();
const PORT = 4000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "Glofly" });
});

app.listen(PORT, () => {
  console.log(`Glofly server running at http://localhost:${PORT}`);
});