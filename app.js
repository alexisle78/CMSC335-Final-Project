require("dotenv").config({ path: "./credentialsDontPost/.env" });
const express        = require("express");
const path           = require("path");
const mongoose       = require("mongoose");
const methodOverride = require("method-override");

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ── */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

/* ── MongoDB connection ── */
mongoose.connect(process.env.MONGO_CONNECTION_STRING)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

/* ── Saved Pick schema ── */
const savedPickSchema = new mongoose.Schema({
  sport:      String,
  teamName:   String,
  teamId:     String,
  year:       Number,
  playerName: String,
  pickNumber: Number,
  round:      Number,
  position:   String,
  college:    String,
  note:       String,
  savedOn:    { type: Date, default: Date.now },
});
const SavedPick = mongoose.model("SavedPick", savedPickSchema);

/* ── ESPN API helpers ── */
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

const SPORT_MAP = {
  nfl: { sport: "football",   league: "nfl"  },
  nba: { sport: "basketball", league: "nba"  },
};

async function fetchTeams(sport) {
  const { sport: s, league: l } = SPORT_MAP[sport];
  const url = `${ESPN_BASE}/${s}/${l}/teams?limit=100`;
  const res  = await fetch(url);
  const data = await res.json();
  return data.sports[0].leagues[0].teams
    .map(t => ({ id: t.team.id, name: t.team.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchDraftPicks(sport, teamId, year) {
  const { sport: s, league: l } = SPORT_MAP[sport];
  const url = `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/seasons/${year}/draft/athletes?limit=500`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!data.items || data.items.length === 0) return [];

  const athletes = await Promise.all(
    data.items.map(item => fetch(item.$ref).then(r => r.json()))
  );

  const withPicks = await Promise.all(
    athletes.map(async a => {
      if (!a.pick?.$ref) return null;
      const pickRes  = await fetch(a.pick.$ref);
      const pickData = await pickRes.json();
      return { athlete: a, pick: pickData };
    })
  );

  // ADD THESE TWO DEBUG LINES
  const valid = withPicks.filter(item => item !== null);
  console.log("Sample pick data:", JSON.stringify(valid[0]?.pick, null, 2));

  return valid
    .filter(item => {
      const teamRef = item.pick.team?.$ref || "";
      const match = teamRef.match(/teams\/(\d+)/);
      return match && String(match[1]) === String(teamId);
    })
    .map(item => ({
      round:      item.pick.round   || null,
      pickNumber: item.pick.overall || null,
      playerName: `${item.athlete.firstName} ${item.athlete.lastName}`,
      position:   item.athlete.position?.abbreviation || "—",
      college:    "—",
    }));
}

/* ── Routes ── */
app.get("/", (req, res) => {
  res.render("index");
});

app.get("/picks/teams", async (req, res) => {
  try {
    const teams = await fetchTeams(req.query.sport);
    res.json(teams);
  } catch {
    res.json([]);
  }
});

app.get("/picks/search", async (req, res) => {
  const { sport, teamId, teamName, year } = req.query;
  try {
    const picks = await fetchDraftPicks(sport, teamId, year);
    res.render("results", { sport, teamId, teamName, year, picks });
  } catch (err) {
    res.render("results", { sport, teamId, teamName, year, picks: [] });
  }
});

app.post("/picks/save", async (req, res) => {
  await SavedPick.create(req.body);
  res.redirect("/picks/saved");
});

app.get("/picks/saved", async (req, res) => {
  const savedPicks = await SavedPick.find().sort({ savedOn: -1 });
  res.render("saved", { savedPicks });
});

app.delete("/picks/saved/:id", async (req, res) => {
  await SavedPick.findByIdAndDelete(req.params.id);
  res.redirect("/picks/saved");
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
