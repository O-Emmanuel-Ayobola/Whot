import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Action, Card, EmoteId, MatchMode, RoomSettings, Shape } from "../../src/types";
import { createRoom, getActiveRooms, getApiHealth, getState, joinRoom, leaveRoom, reconnectRoom, heartbeatRoom, resetFinishedRoom, sendAction, startRoom, updateRoomSettings, spectateRoom, type ActiveRoom, type GameView, type LobbyView } from "./api";
import { gameAudio } from "./audio";
import { completedRoundTasks, loadTaskStore, saveTaskStore, taskById, TASKS, type RoundTaskStats, emptyRoundStats, type TaskStore } from "./tasks";
import "./styles.css";

const sessionKey = "whot-session";
const playerNameKey = "whot-player-name";

function loadPlayerName(): string {
  try { return localStorage.getItem(playerNameKey) ?? ""; } catch { return ""; }
}
function persistPlayerName(name: string) {
  try { localStorage.setItem(playerNameKey, name); } catch { /* Private browsing may block storage; continue without remembering it. */ }
}

type Session = { roomCode: string; playerToken: string; isHost: boolean };

function loadSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(sessionKey) ?? "null"); } catch { return null; }
}
function saveSession(session: Session) { localStorage.setItem(sessionKey, JSON.stringify(session)); }
function clearSession() { localStorage.removeItem(sessionKey); }


const profileKey = "whot-profile";
type CardBackId = "classic" | "burgundy" | "gold" | "midnight";
type TableThemeId = "baize" | "sunset" | "night" | "lagoon" | "royal" | "paper" | "cream" | "wine";
type Profile = {
  xp: number;
  wins: number;
  streak: number;
  bestStreak: number;
  badges: string[];
  cardBack: CardBackId;
  tableTheme: TableThemeId;
  lastWinDate: string | null;
  dailyClaimDate: string | null;
  dailyStreak: number;
  weeklyWins: number;
  weekKey: string;
  cardBackUses: Partial<Record<CardBackId, number>>;
  title: string;
};
const defaultProfile: Profile = { xp: 0, wins: 0, streak: 0, bestStreak: 0, badges: [], cardBack: "classic", tableTheme: "baize", lastWinDate: null, dailyClaimDate: null, dailyStreak: 0, weeklyWins: 0, weekKey: "", cardBackUses: { classic: 0, burgundy: 0, gold: 0, midnight: 0 }, title: "Table Rookie" };
function weekKey() { const d = new Date(); const first = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-W${Math.ceil((((d.getTime() - first.getTime()) / 86400000) + first.getDay() + 1) / 7)}`; }
function normalizeTheme(theme: TableThemeId | undefined): TableThemeId {
  if (theme === "cream") return "baize";
  if (theme === "wine") return "sunset";
  return theme && ["baize", "sunset", "night", "lagoon", "royal", "paper"].includes(theme) ? theme : "baize";
}
function loadProfile(): Profile {
  try {
    const parsed = { ...defaultProfile, ...(JSON.parse(localStorage.getItem(profileKey) ?? "{}")) };
    parsed.tableTheme = normalizeTheme(parsed.tableTheme);
    if (parsed.weekKey !== weekKey()) return { ...parsed, weeklyWins: 0, weekKey: weekKey() };
    return parsed;
  } catch { return { ...defaultProfile, weekKey: weekKey() }; }
}
function saveProfile(profile: Profile) { localStorage.setItem(profileKey, JSON.stringify(profile)); window.dispatchEvent(new CustomEvent("whot-profile-change")); }
function useProfile() { const [profile, setProfile] = useState<Profile>(() => loadProfile()); useEffect(() => { const sync = () => setProfile(loadProfile()); window.addEventListener("whot-profile-change", sync); return () => window.removeEventListener("whot-profile-change", sync); }, []); return [profile, (next: Profile) => saveProfile(next)] as const; }
type ReactionMeta = { label: string; icon: string; meaning: string; category: "strong" | "hit" | "check" | "win" | "loss" | "taunt" | "good" | "big" };
const reactionMeta: Record<EmoteId, ReactionMeta> = {
  GBAM:{label:"Gbam!",icon:"💥",meaning:"Exactly right",category:"strong"}, OYA_OYA:{label:"Oya, oya!",icon:"🙌",meaning:"Come on, let’s go",category:"strong"}, SHARP_SHARP:{label:"Sharp sharp!",icon:"⚡",meaning:"Quick and clean",category:"strong"}, NA_SO:{label:"Na so we do am.",icon:"😎",meaning:"That’s how it’s done",category:"strong"}, PEPPER_DEM:{label:"Pepper dem!",icon:"🌶️",meaning:"Show off",category:"strong"},
  CHAI:{label:"Chai! Wahala dey o.",icon:"😩",meaning:"Trouble is here",category:"hit"}, KAI:{label:"Kai!",icon:"😳",meaning:"Shock",category:"hit"}, NA_WA:{label:"Na wa o.",icon:"🤦",meaning:"What a thing",category:"hit"}, E_DON_HAPPEN:{label:"E don happen.",icon:"😮",meaning:"It’s done",category:"hit"}, CHOP_KNUCKLE:{label:"Chop knuckle!",icon:"👊",meaning:"Take that",category:"hit"},
  CHECK_UP:{label:"Check up! Who dey breathe?",icon:"👀",meaning:"I’m on one card",category:"check"}, LAST_CARD:{label:"Last card, abeg no vex.",icon:"🃏",meaning:"Last card, please don’t vex",category:"check"}, I_DEY_ONE:{label:"I dey one card o!",icon:"☝️",meaning:"I’m on one card",category:"check"}, EHEN_SEE:{label:"Ehen, see am!",icon:"👁️",meaning:"Look at that",category:"check"},
  I_DON_WIN:{label:"I don win!",icon:"🏆",meaning:"I have won",category:"win"}, DEM_GO_HEAR:{label:"Dem go hear am.",icon:"📣",meaning:"They’ll hear about it",category:"win"}, BABA_SHOW:{label:"Baba don show.",icon:"👑",meaning:"The boss has arrived",category:"win"}, SIT_DOWN:{label:"Sit down and watch.",icon:"🪑",meaning:"Taking the crown",category:"win"},
  NO_WAHALA:{label:"No wahala.",icon:"🙂",meaning:"No problem",category:"loss"}, E_GO_BETTER:{label:"E go better.",icon:"🤝",meaning:"It’ll get better",category:"loss"}, RUN_AM_BACK:{label:"Oya, run am back.",icon:"🔁",meaning:"Let’s go again",category:"loss"}, SAPA:{label:"Sapa don catch me.",icon:"💸",meaning:"I’m broke — joking about losing",category:"loss"},
  YOU_DEY_WHOT:{label:"You dey whot?",icon:"🤨",meaning:"Are you really playing?",category:"taunt"}, SHEY_SURE:{label:"Shey you sure?",icon:"🧐",meaning:"Are you sure?",category:"taunt"}, CALM_DOWN:{label:"Calm down, nah.",icon:"😌",meaning:"Relax",category:"taunt"}, SEE_PRESSURE:{label:"See pressure.",icon:"😅",meaning:"Look at that stress",category:"taunt"},
  ESE_O:{label:"Ese o.",icon:"🙏",meaning:"Thank you (Yoruba)",category:"good"}, DAALU:{label:"Daalu.",icon:"🙏",meaning:"Thank you (Igbo)",category:"good"}, NAGODE:{label:"Nagode.",icon:"🙏",meaning:"Thank you (Hausa)",category:"good"}, SORRY_O:{label:"Sorry o.",icon:"🫶",meaning:"Sorry",category:"good"}, KPELE:{label:"Kpele.",icon:"💛",meaning:"Sorry",category:"good"}, WELL_PLAYED:{label:"Well played, oga.",icon:"👏",meaning:"Well played, boss",category:"good"},
  OMO:{label:"Omo!",icon:"😲",meaning:"Wow!",category:"big"}, NA_SO_BIG:{label:"Na so?",icon:"🤯",meaning:"Is that so?",category:"big"}, WALAHI:{label:"Walahi!",icon:"😮",meaning:"I swear",category:"big"}, E_CHOKE:{label:"E choke!",icon:"🔥",meaning:"That’s impressive",category:"big"},
};
const reactionKeys = Object.keys(reactionMeta) as EmoteId[];
const pinnedKey = "whot-pinned-reactions";
const reactionPrefsKey = "whot-reaction-prefs";
const defaultPinnedReactions: EmoteId[] = ["GBAM", "CHAI", "CHECK_UP", "I_DON_WIN", "OYA_OYA", "WELL_PLAYED"];
function loadPinnedReactions(): EmoteId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(pinnedKey) ?? "null");
    if (Array.isArray(saved)) {
      const valid = [...new Set(saved.filter((value): value is EmoteId => typeof value === "string" && value in reactionMeta))].slice(0, 6);
      for (const fallback of defaultPinnedReactions) {
        if (valid.length >= 6) break;
        if (!valid.includes(fallback)) valid.push(fallback);
      }
      return valid;
    }
  } catch { /* Recover from malformed local preferences with the default set. */ }
  return [...defaultPinnedReactions];
}


function todayKey() { return new Date().toISOString().slice(0, 10); }
function titleForProfile(profile: Profile) {
  if (profile.wins >= 25) return "Table Legend";
  if (profile.wins >= 10) return "Sharp Shooter";
  if (profile.streak >= 5) return "Hot Hand";
  if (profile.wins >= 3) return "Table Regular";
  return "Table Rookie";
}
function rankForProfile(profile: Profile) {
  if (profile.xp >= 10000) return "Republic Champion";
  if (profile.xp >= 5000) return "Chief";
  if (profile.xp >= 2500) return "Market";
  if (profile.xp >= 1000) return "Compound";
  return "Roadside";
}

function ProfilePanel({ profile, onChange, onClose }: { profile: Profile; onChange: (profile: Profile) => void; onClose: () => void }) {
  const level = Math.floor(profile.xp / 500) + 1;
  const xpInLevel = profile.xp % 500;
  const unlockedBacks: CardBackId[] = level >= 5 ? ["classic", "burgundy", "gold", "midnight"] : level >= 3 ? ["classic", "burgundy", "gold"] : level >= 2 ? ["classic", "burgundy"] : ["classic"];
  const themeCatalog: { id: TableThemeId; name: string; note: string; unlock: number }[] = [
    { id: "baize", name: "Baize", note: "Classic green table", unlock: 1 },
    { id: "sunset", name: "Sunset", note: "Warm home-table glow", unlock: 1 },
    { id: "night", name: "Night Market", note: "Late-night table", unlock: 2 },
    { id: "lagoon", name: "Lagoon", note: "Cool teal felt", unlock: 3 },
    { id: "royal", name: "Royal", note: "Deep blue + gold", unlock: 4 },
    { id: "paper", name: "Paper", note: "Bright tabletop", unlock: 5 },
  ];
  const unlockedThemes = themeCatalog.filter(theme => level >= theme.unlock);
  const badges = [
    ["FIRST_WIN", "First Win", "Win your first round."],
    ["HOT_STREAK", "Hot Streak", "Reach a 3-win streak."],
    ["WHOT_WIN", "Whot Finish", "Win a round with Whot 20."],
  ];
  return <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="profile-panel" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
      <div className="settings-head"><div><p className="eyebrow">PLAYER PROFILE</p><h2>Your table identity</h2></div><button className="settings-close" type="button" onClick={onClose}>×</button></div>
      <div className="profile-hero"><div className="profile-avatar-large">{profile.wins >= 10 ? "★" : "W"}</div><div><strong>Level {level} • {profile.title}</strong><span>{profile.xp} XP</span><div className="xp-bar"><i style={{ width: `${(xpInLevel / 500) * 100}%` }} /></div></div></div>
      <div className="profile-stats"><div><b>{profile.wins}</b><span>Wins</span></div><div><b>{profile.streak}</b><span>Streak</span></div><div><b>{profile.bestStreak}</b><span>Best</span></div><div><b>{profile.weeklyWins}</b><span>This week</span></div></div>
      <div className="daily-challenge-card">
        <div><p className="eyebrow">DAILY CHALLENGE</p><strong>Win one round today</strong><span>{profile.lastWinDate === todayKey() ? "Completed ✓" : "Play a match to complete it"}</span></div>
        <button type="button" className="daily-claim" disabled={profile.lastWinDate !== todayKey() || profile.dailyClaimDate === todayKey()} onClick={() => onChange({ ...profile, xp: profile.xp + 150, dailyClaimDate: todayKey() })}>{profile.dailyClaimDate === todayKey() ? "Claimed" : "+150 XP"}</button>
      </div>
      <div className="profile-section"><p className="eyebrow">CARD BACK</p><div className="choice-grid">{unlockedBacks.map(back => <button key={back} className={`choice-cardback back-${back} ${profile.cardBack === back ? "selected" : ""}`} onClick={() => onChange({ ...profile, cardBack: back, cardBackUses: { ...profile.cardBackUses, [back]: (profile.cardBackUses?.[back] ?? 0) + 1 } })} type="button"><span>WHOT!</span><small>{back}</small></button>)}</div></div>
      <p className="profile-note"><strong>Most-used card back:</strong> {Object.entries(profile.cardBackUses ?? {}).sort((a,b) => b[1] - a[1])[0]?.[0] ?? profile.cardBack}</p><div className="profile-section"><div className="section-heading"><span>TABLE THEME</span><strong>{themeCatalog.find(t => t.id === profile.tableTheme)?.name ?? "Baize"}</strong></div><div className="theme-choices">{unlockedThemes.map(theme => <button key={theme.id} className={`theme-choice theme-${theme.id} ${profile.tableTheme === theme.id ? "selected" : ""}`} onClick={() => onChange({ ...profile, tableTheme: theme.id })} type="button"><span>{theme.name}</span><small>{theme.note}</small></button>)}</div></div>
      <div className="profile-section"><p className="eyebrow">BADGES</p><div className="badge-grid">{badges.map(([id, title, desc]) => <div className={`badge ${profile.badges.includes(id) ? "earned" : "locked"}`} key={id}><span>{profile.badges.includes(id) ? "★" : "○"}</span><div><strong>{title}</strong><small>{desc}</small></div></div>)}</div></div>
      <p className="profile-note"><strong>{titleForProfile(profile)}</strong> is your current table title. </p><p className="profile-note">Cosmetics and progression are stored on this device. They never change card odds or give a gameplay advantage.</p>
    </section>
  </div>;
}

function SoundSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(gameAudio.getSettings());
  const update = (key: "master" | "music" | "effects", value: number) => {
    if (key === "master") gameAudio.setMaster(value);
    else if (key === "music") gameAudio.setMusic(value);
    else gameAudio.setEffects(value);
    setSettings(gameAudio.getSettings());
  };
  return <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="sound-settings" role="dialog" aria-modal="true" aria-labelledby="sound-settings-title" onMouseDown={e => e.stopPropagation()}>
      <div className="settings-head"><div><p className="eyebrow">AUDIO & HAPTICS</p><h2 id="sound-settings-title">Sound settings</h2></div><button className="settings-close" type="button" onClick={onClose} aria-label="Close sound settings">×</button></div>
      <label className="range-row"><span>Master volume <strong>{Math.round(settings.master * 100)}%</strong></span><input type="range" min="0" max="1" step="0.01" value={settings.master} onChange={e => update("master", Number(e.target.value))} /></label>
      <label className="range-row"><span>Music <strong>{Math.round(settings.music * 100)}%</strong></span><input type="range" min="0" max="1" step="0.01" value={settings.music} onChange={e => update("music", Number(e.target.value))} /></label>
      <label className="range-row"><span>Sound effects <strong>{Math.round(settings.effects * 100)}%</strong></span><input type="range" min="0" max="1" step="0.01" value={settings.effects} onChange={e => update("effects", Number(e.target.value))} /></label>
      <label className="range-row"><span>Nigerian reaction voice pack <strong>Coming later</strong></span><input type="range" min="0" max="1" step="0.01" value={0} disabled aria-label="Nigerian reaction voice pack is not installed yet" /></label>
      <div className="settings-actions"><button className={`settings-toggle ${settings.muted ? "active" : ""}`} type="button" onClick={() => { if (settings.muted) void gameAudio.enable(); else gameAudio.disable(); setSettings(gameAudio.getSettings()); }}>{settings.muted ? "Sound muted" : "Sound on"}</button><button className={`settings-toggle ${settings.haptics ? "active" : ""}`} type="button" onClick={() => { gameAudio.setHaptics(!settings.haptics); setSettings(gameAudio.getSettings()); }}>Mobile haptics {settings.haptics ? "on" : "off"}</button><button className="settings-toggle" type="button" disabled title="Recorded Nigerian-accent reaction clips will be added in a later update">Recorded reaction voices · coming later</button><button className="settings-reset" type="button" onClick={() => { gameAudio.reset(); setSettings(gameAudio.getSettings()); }}>Reset audio</button></div>
      <p className="settings-note">Reaction voice playback is disabled for now because the game does not include recorded Nigerian-accent clips yet. Text reactions and non-verbal game effects still work. The background track is original and synthesized; music, effects and haptics remain independently controlled.</p>
    </section>
  </div>;
}

function TaskPanel({ onClose }: { onClose: () => void }) {
  const [store, setStore] = useState<TaskStore>(() => loadTaskStore());
  useEffect(() => { const sync = () => setStore(loadTaskStore()); window.addEventListener("whot-task-change", sync); return () => window.removeEventListener("whot-task-change", sync); }, []);
  const active = store.activeDareIds.map(taskById).filter(Boolean) as NonNullable<ReturnType<typeof taskById>>[];
  const daily = TASKS.filter(t => t.kind === "daily").slice(0, 4);
  const weekly = TASKS.filter(t => t.kind === "weekly").slice(0, 4);
  const accept = (id: string) => {
    const next = { ...store, dailyAccepted: store.dailyAccepted.includes(id) ? store.dailyAccepted : [...store.dailyAccepted, id], activeDareIds: store.activeDareIds.includes(id) ? store.activeDareIds : [...store.activeDareIds, id] };
    setStore(next); saveTaskStore(next);
  };
  const revealMystery = () => {
    const next = { ...store, mysteryRevealed: true, activeDareIds: store.activeDareIds.includes("mystery_task") ? store.activeDareIds : [...store.activeDareIds, "mystery_task"] };
    setStore(next); saveTaskStore(next);
  };
  return <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="task-panel" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
      <div className="settings-head"><div><p className="eyebrow">THE DARE DECK</p><h2>Table tasks</h2></div><button className="settings-close" type="button" onClick={onClose}>×</button></div>
      <div className="task-hero"><div><strong>{store.taskXp} Dare XP</strong><span>Finish challenges to earn bonus XP and unlock hidden badges.</span></div><div className="task-hero-mark">✦</div></div>
      <p className="eyebrow task-label">ACTIVE AT YOUR TABLE</p>
      <div className="task-grid">{active.map(task => <article className={`task-card ${store.completed.includes(task.id) ? "complete" : ""}`} key={task.id}><div className="task-card-top"><span>{task.category.toUpperCase()}</span><b>+{task.xp}</b></div><h3>{task.title}</h3><p>{task.description}</p><strong>{store.completed.includes(task.id) ? "Completed ✓" : "In play"}</strong></article>)}</div>
      <div className="task-columns">
        <section><p className="eyebrow">DAILY DARES</p>{daily.map(task => <div className="task-list-row" key={task.id}><div><strong>{task.title}</strong><span>{task.description}</span></div><button className="secondary" disabled={store.completed.includes(task.id)} onClick={() => accept(task.id)}>{store.completed.includes(task.id) ? "Done" : store.dailyAccepted.includes(task.id) ? "Accepted" : "Accept"}</button></div>)}</section>
        <section><p className="eyebrow">WEEKLY MISSIONS</p>{weekly.map(task => <div className="task-list-row" key={task.id}><div><strong>{task.title}</strong><span>{task.description}</span></div><b className="task-xp">+{task.xp}</b></div>)}</section>
      </div>
      <section className="mystery-task"><div><p className="eyebrow">MYSTERY TASK</p>{store.mysteryRevealed ? <><strong>Poker Face</strong><span>Win after choosing a Whot shape. You only get one reveal.</span></> : <><strong>Face-down dare</strong><span>Accept first. Then find out what the table asked of you.</span></>}</div><button className="primary" type="button" onClick={revealMystery} disabled={store.mysteryRevealed}>{store.mysteryRevealed ? "Revealed" : "Accept mystery"}</button></section>
      <p className="task-note">Some tasks are intentionally hidden until you trigger them. Your task progress is stored on this device, while the actual card play remains server-authoritative.</p>
    </section>
  </div>;
}

function Navigation({ roomCode, onHome, onReset, gameView }: { roomCode?: string; onHome: () => void; onReset?: () => void | Promise<void>; gameView?: GameView | LobbyView }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [profile, setProfile] = useProfile();
  const [soundOn, setSoundOn] = useState(gameAudio.isEnabled());
  const toggleSound = async () => {
    gameAudio.click();
    if (soundOn) gameAudio.disable();
    else await gameAudio.enable();
    setSoundOn(gameAudio.isEnabled());
  };
  return <>
    <nav className="navigation">
      <button className="nav-home" onClick={onHome} type="button"><span>←</span> Exit / Back to Home</button>
      <div className="nav-brand">WHOT<span>!</span></div>
      {roomCode ? <div className="nav-room">ROOM <strong>{roomCode}</strong></div> : <div className="nav-spacer" />}
      <div className="nav-actions">
        <button className="nav-profile" onClick={() => { gameAudio.click(); setProfileOpen(true); }} type="button">Level {Math.floor(profile.xp / 500) + 1} • {profile.wins} wins</button><button className="nav-dares" onClick={() => { gameAudio.click(); setTasksOpen(true); }} type="button">✦ Dares</button><button className="nav-settings" onClick={() => { gameAudio.click(); setSettingsOpen(true); }} type="button" aria-label="Open game menu">☰ Menu</button>
        <button className={`nav-sound ${soundOn ? "on" : ""}`} onClick={() => void toggleSound()} type="button" aria-label={soundOn ? "Mute game sound" : "Turn game sound on"}><span>{soundOn ? "♫" : "♪"}</span> {soundOn ? "Sound on" : "Sound off"}</button>
        <button className="nav-reset" onClick={() => { void (async () => { try { await onReset?.(); } finally { clearSession(); window.location.reload(); } })(); }} type="button">Reset Saved Session</button>
      </div>
    </nav>
    {settingsOpen && <div className="game-menu-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><section className="game-menu" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}><div className="settings-head"><div><p className="eyebrow">TABLE MENU</p><h2>While you play</h2></div><button className="settings-close" type="button" onClick={() => setSettingsOpen(false)}>×</button></div>{gameView && <button className="menu-link" type="button" onClick={() => { setSettingsOpen(false); setRulesOpen(true); }}><strong>Rules & tutorial</strong><span>Cards, actions, calls and house variants</span></button>}<SoundSettings onClose={() => setSettingsOpen(false)} /></section></div>}
    {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
    {profileOpen && <ProfilePanel profile={profile} onChange={setProfile} onClose={() => setProfileOpen(false)} />}
    {tasksOpen && <TaskPanel onClose={() => setTasksOpen(false)} />}
  </>;
}

const shapeMeta: Record<Shape, { label: string; glyph: string }> = {
  circle: { label: "Circle", glyph: "●" },
  triangle: { label: "Triangle", glyph: "▲" },
  cross: { label: "Cross", glyph: "✚" },
  square: { label: "Square", glyph: "■" },
  star: { label: "Star", glyph: "★" },
};

function CardView({ card, playable, onClick, compact = false, animate = false, flip = false, dealDelay = 0 }: { card: Card; playable?: boolean; onClick?: () => void; compact?: boolean; animate?: boolean; flip?: boolean; dealDelay?: number }) {
  const shape = card.shape;
  const meta = shape ? shapeMeta[shape] : { label: "Wild", glyph: "★" };
  const actionClass = [1, 2, 5, 8, 14, 20].includes(card.value) ? `action-${card.value}` : "";
  const className = `card card-${shape ?? "whot"} ${playable ? "playable" : ""} ${compact ? "compact" : ""} ${actionClass} ${animate ? (dealDelay ? "card-deal" : "card-enter") : ""} ${flip ? "card-flip" : ""}`;
  const content = <>
    <span className="card-corner">{card.value}</span><span className="card-symbol" aria-hidden="true">{meta.glyph}</span><strong className="card-value">{card.value === 20 ? "WHOT" : card.value}</strong><small>{meta.label}</small>{card.value === 20 && <span className="whot-burst">WHOT!</span>}
  </>;
  const label = `${card.value === 20 ? "Whot" : card.value} ${meta.label}`;
  const body = <span className="card-inner"><span className="card-face card-back-face" aria-hidden="true"><span className="back-logo">WHOT<span>!</span></span><span className="back-mark">✦</span></span><span className="card-face card-front-face">{content}</span></span>;
  const style = { "--deal-delay": `${dealDelay}ms` } as CSSProperties;
  return onClick ? <button className={className} style={style} onClick={onClick} type="button" aria-label={label}>{body}</button> : <div className={className} style={style} aria-label={label}>{body}</div>;
}

function HomeButton({ onClick }: { onClick: () => void }) { return <button className="secondary" type="button" onClick={onClick}>Back to Home</button>; }

type HouseRulePreset = { name: string; rules: Pick<RoomSettings, "stackPickTwo" | "pickThree" | "holdOn" | "suspension" | "generalMarket" | "startingHandSize" | "perksEnabled"> };
const houseRulesKey = "whot-house-rules";
const baseHouseRules: HouseRulePreset["rules"] = { stackPickTwo: true, pickThree: false, holdOn: true, suspension: true, generalMarket: true, startingHandSize: 5, perksEnabled: false };
const builtInHouseRules: HouseRulePreset[] = [
  { name: "Classic Home", rules: baseHouseRules },
  { name: "Auntie Ngozi's rules", rules: { stackPickTwo: true, pickThree: true, holdOn: true, suspension: true, generalMarket: true, startingHandSize: 5, perksEnabled: false } },
  { name: "Quick Family", rules: { stackPickTwo: true, pickThree: false, holdOn: true, suspension: true, generalMarket: false, startingHandSize: 4, perksEnabled: false } },
];
function loadHouseRules(): HouseRulePreset[] { try { return JSON.parse(localStorage.getItem(houseRulesKey) ?? "[]"); } catch { return []; } }
function saveHouseRules(presets: HouseRulePreset[]) { localStorage.setItem(houseRulesKey, JSON.stringify(presets)); }

function HouseRulesPanel({ initial, onClose, onApply }: { initial: Pick<RoomSettings, "stackPickTwo" | "pickThree" | "holdOn" | "suspension" | "generalMarket" | "startingHandSize" | "perksEnabled">; onClose: () => void; onApply: (rules: HouseRulePreset["rules"]) => void }) {
  const [rules, setRules] = useState({ ...initial });
  const [presetName, setPresetName] = useState("");
  const [saved, setSaved] = useState<HouseRulePreset[]>(() => loadHouseRules());
  const toggle = (key: "stackPickTwo" | "pickThree" | "holdOn" | "suspension" | "generalMarket" | "perksEnabled") => setRules(prev => ({ ...prev, [key]: !prev[key] }));
  const presets = [...builtInHouseRules, ...saved];
  return <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="house-rules-panel" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
      <div className="settings-head"><div><p className="eyebrow">PLAYED AT HOME</p><h2>House rules</h2></div><button className="settings-close" type="button" onClick={onClose}>×</button></div>
      <p className="house-rules-intro">Every family has its own table. Turn cards on or off, choose the starting hand, then save your version for the next gathering.</p>
      <div className="preset-row"><select onChange={e => { const preset = presets.find(x => x.name === e.target.value); if (preset) setRules({ ...preset.rules }); }} defaultValue=""><option value="">Load a saved ruleset…</option>{presets.map(p => <option key={p.name}>{p.name}</option>)}</select><input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Name this ruleset" maxLength={32}/><button className="secondary" type="button" onClick={() => { const name = presetName.trim(); if (!name) return; const next = [...saved.filter(x => x.name !== name), { name, rules: { ...rules } }]; setSaved(next); saveHouseRules(next); setPresetName(""); }}>Save</button></div>
      <div className="rule-grid">
        {([ ["stackPickTwo", "2 — Pick Two", "Fire-for-fire stacking. Each 2 adds two cards."], ["pickThree", "5 — Pick Three", "5 becomes +3 and another 5 can stack."], ["holdOn", "1 — Hold On", "Keep your turn after playing 1."], ["suspension", "8 — Suspension", "Skip the next player; 8s can chain."], ["generalMarket", "14 — General Market", "Everyone else draws one; you continue."], ["perksEnabled", "✦ — Secret Perks", "Optional power-ups. Off = pure card play."] ] as const).map(([key, title, desc]) => <button className={`rule-toggle ${rules[key] ? "on" : ""}`} key={key} type="button" onClick={() => toggle(key)}><span className="rule-number">{title.split(" ")[0]}</span><span><strong>{title.includes("—") ? title.slice(title.indexOf("—") + 2) : title}</strong><small>{desc}</small></span><i>{rules[key] ? "ON" : "OFF"}</i></button>)}
      </div>
      <div className="starting-hand"><div><p className="eyebrow">STARTING HAND</p><strong>{rules.startingHandSize} cards each</strong><span>Choose 3–7 cards for the opening deal.</span></div><input type="range" min="3" max="7" value={rules.startingHandSize} onChange={e => setRules(prev => ({ ...prev, startingHandSize: Number(e.target.value) }))}/><div className="hand-size-dots">{[3,4,5,6,7].map(n => <button key={n} type="button" className={rules.startingHandSize === n ? "active" : ""} onClick={() => setRules(prev => ({ ...prev, startingHandSize: n }))}>{n}</button>)}</div></div>
      <div className="rules-tutorial"><div><p className="eyebrow">TABLE TUTORIAL</p><h3>Same card. Different house.</h3><p>Card 5 can be a Pick Three in one home and just a normal five in another. The room host controls the rules before the first deal.</p></div><div className="rule-demo"><div className="demo-card demo-two">2<small>PICK TWO</small></div><span>→</span><div className="demo-card demo-five">5<small>{rules.pickThree ? "PICK THREE" : "NORMAL 5"}</small></div><span>→</span><div className="demo-card demo-eight">8<small>{rules.suspension ? "SUSPEND" : "NORMAL 8"}</small></div></div></div>
      <div className="settings-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="button" onClick={() => { onApply(rules); onClose(); }}>Use these house rules</button></div>
    </section>
  </div>;
}

function RulesPanel({ onClose }: { onClose: () => void }) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={onClose}><section className="house-rules-panel rules-page" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
    <div className="settings-head"><div><p className="eyebrow">HOW TO PLAY</p><h2>Rules & tutorial</h2></div><button className="settings-close" type="button" onClick={onClose}>×</button></div>
    <div className="rules-steps">
      <div><b>01</b><strong>Goal</strong><span>Be the first player to empty your hand. Match the top card by shape or number, or play a Whot 20.</span></div>
      <div><b>02</b><strong>Market</strong><span>If you cannot — or choose not to — play, draw one card and end your turn. The draw pile is called the Market.</span></div>
      <div><b>03</b><strong>Action cards</strong><span>1 = Hold On, 2 = Pick Two, 5 = Pick Three when enabled, 8 = Suspension, 14 = General Market, 20 = wild shape call.</span></div>
      <div><b>04</b><strong>Fire for Fire</strong><span>When stacking is enabled, 2s pass the +2 burden and 5s pass the +3 burden. The penalty accumulates.</span></div>
      <div><b>05</b><strong>Call your cards</strong><span>At 2 cards, say “Semi-last card.” At 1 card, say “Last card.” An opponent can Catch before the next turn for a 2-card penalty.</span></div>
      <div><b>06</b><strong>Whot 20</strong><span>Play 20 on anything, immediately name the required shape, and the next player must follow it or answer with another 20.</span></div>
      <div><b>07</b><strong>Classic table quirks</strong><span>Hold On chains, Suspension chains and General Market chains are supported by repeated plays. Multi-drop, false-catch, touch-and-follow and other family variants can be treated as house rules.</span></div>
      <div><b>08</b><strong>Perks are optional</strong><span>Secret Bounties and Shield, Peek and Swap perks are not core Whot rules. The host can turn them on or off before the deal.</span></div>
    </div>
    <div className="rules-example"><div className="demo-card demo-two">2<small>+2</small></div><span>+</span><div className="demo-card demo-two">2<small>+2</small></div><span>=</span><strong>DRAW 4</strong></div>
    <p className="rules-footnote">The standard deck in this game is 54 cards: 12 Circles, 12 Triangles, 9 Crosses, 9 Squares, 7 Stars and 5 Whot 20 cards. Stars count double for end-of-round penalty scoring.</p>
    <button className="primary full" type="button" onClick={onClose}>Back to table</button>
  </section></div>;
}

function ActiveRoomsPanel({ onConnect, playerName }: { onConnect: (session: Session) => void; playerName: string }) {
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [serviceStatus, setServiceStatus] = useState<"checking" | "online" | "offline">("checking");
  const [filter, setFilter] = useState<"all" | "open" | "live">("all");
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refreshRooms = async (quiet = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [roomsResult, healthResult] = await Promise.allSettled([getActiveRooms(), getApiHealth()]);
      if (roomsResult.status === "rejected") throw roomsResult.reason;
      setRooms(roomsResult.value);
      setLastUpdated(Date.now());
      if (healthResult.status === "fulfilled" && healthResult.value.ok && healthResult.value.storage === "available") {
        setServiceStatus("online");
        setRoomError("");
      } else {
        setServiceStatus("offline");
        setRoomError("The room list loaded, but the health check failed. Some room actions may not work until the game service is healthy.");
      }
    } catch (error) {
      setServiceStatus("offline");
      setRoomError(error instanceof Error ? error.message : "Could not load active rooms.");
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshRooms();
    // Keep the room directory fresh while visible, and refresh immediately
    // when someone returns to the tab after creating a room elsewhere.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRooms(true);
    }, 4000);
    const onFocus = () => void refreshRooms(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshRooms(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const openCount = rooms.filter((room) => room.phase === "lobby" && room.joinable).length;
  const liveCount = rooms.filter((room) => room.phase === "playing" && room.spectatable).length;
  const visibleRooms = rooms
    .filter((room) => filter === "all" || (filter === "open" && room.phase === "lobby" && room.joinable) || (filter === "live" && room.phase === "playing" && room.spectatable))
    .filter((room) => `${room.roomCode} ${room.hostName} ${room.phase} ${room.phase === "playing" ? "live" : "open"} ${room.matchMode}`.toLowerCase().includes(query.trim().toLowerCase()));

  const copyRoomCode = async (roomCode: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(roomCode);
      } else {
        const input = document.createElement("textarea");
        input.value = roomCode;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard access is unavailable");
      }
      setCopiedCode(roomCode);
      window.setTimeout(() => setCopiedCode((current) => current === roomCode ? null : current), 1600);
    } catch {
      setRoomError(`Room code ${roomCode} — copy it manually to share the invite.`);
    }
  };

  const connect = async (room: ActiveRoom, mode: "join" | "watch") => {
    const name = playerName.trim();
    if (!name) {
      setRoomError("Add your name in the room form above to join or watch a table.");
      return;
    }
    setRoomError("");
    setJoiningCode(room.roomCode);
    try {
      const result = mode === "join" ? await joinRoom(room.roomCode, name) : await spectateRoom(room.roomCode, name);
      const session = { roomCode: result.roomCode, playerToken: result.playerToken, isHost: result.isHost };
      saveSession(session);
      gameAudio.click();
      onConnect(session);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not connect to that table.");
      void refreshRooms(true);
    } finally {
      setJoiningCode(null);
    }
  };

  const modeLabel = (mode: ActiveRoom["matchMode"]) => mode === "quick" ? "Quick match" : mode === "best_of_3" ? "Best of 3" : "First to 3";
  return <section className="active-rooms-panel" aria-labelledby="active-rooms-title">
    <div className="active-rooms-head">
      <div>
        <p className="eyebrow"><span className="live-dot" /> THE TABLE IS OPEN</p>
        <h2 id="active-rooms-title">Active rooms <span>{rooms.length}</span></h2>
        <p>Find a public table, join the next deal, or watch a live round.</p>
        <div className={`room-service-status status-${serviceStatus}`} role="status" aria-live="polite">
          <i />{serviceStatus === "online" ? "Game service connected" : serviceStatus === "offline" ? "Game service unavailable" : "Checking game service…"}
        </div>
      </div>
      <button className="refresh-rooms" type="button" onClick={() => void refreshRooms(true)} disabled={refreshing || loading} aria-label="Refresh active rooms">{refreshing || loading ? "Refreshing…" : "↻ Refresh"}</button>
    </div>
    <div className="room-filter-tabs" role="group" aria-label="Filter rooms">
      <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All tables <span>{rooms.length}</span></button>
      <button type="button" className={filter === "open" ? "active" : ""} aria-pressed={filter === "open"} onClick={() => setFilter("open")}>Open rooms <span>{openCount}</span></button>
      <button type="button" className={filter === "live" ? "active" : ""} aria-pressed={filter === "live"} onClick={() => setFilter("live")}>Live now <span>{liveCount}</span></button>
    </div>
    <div className="active-rooms-tools">
      <div className="active-name-summary"><span className="active-name-avatar">{playerName.trim().slice(0, 1).toUpperCase() || "?"}</span><div><span>JOINING AS</span><strong>{playerName.trim() || "Enter your name above"}</strong></div></div>
      <label className="room-search-field"><span>⌕</span><input aria-label="Search active rooms" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search room code, host, or mode" /></label>
    </div>
    {roomError && <p className="error form-error active-room-error" role="status">{roomError}</p>}
    {loading ? <div className="active-room-grid rooms-skeleton" aria-label="Loading active rooms">{Array.from({ length: 3 }).map((_, index) => <article className="active-room-card skeleton-room" key={index} aria-hidden="true"><div className="skeleton-line skeleton-status" /><div className="skeleton-line skeleton-code" /><div className="skeleton-line skeleton-host" /><div className="skeleton-meta"><span /><span /></div><div className="skeleton-button" /></article>)}</div> : visibleRooms.length === 0 ? <div className="rooms-empty"><span className="empty-table-icon">♧</span><strong>{query ? "No rooms match that search." : rooms.length && filter !== "all" ? (filter === "open" ? "No joinable rooms right now." : "No live games right now.") : "No active tables yet."}</strong><p>{query ? "Try another room code or clear your search." : rooms.length && filter !== "all" ? "Choose another filter or check back in a moment." : "Create a room above and it will appear here for your friends."}</p><button className="text-button" type="button" onClick={() => void refreshRooms(true)}>Check again →</button></div> : <div className="active-room-grid">
      {visibleRooms.map((room) => {
        const isLive = room.phase === "playing";
        const available = isLive ? room.spectatable : room.joinable;
        return <article className={`active-room-card ${isLive ? "room-is-live" : "room-is-open"}`} key={room.roomCode}>
          <div className="active-room-card-top"><span className={`room-status ${isLive ? "status-live" : "status-open"}`}><i />{isLive ? "LIVE NOW" : room.joinable ? "OPEN TABLE" : "TABLE FULL"}</span><span className="room-mode-tag">{modeLabel(room.matchMode)}</span></div>
          <div className="active-room-code-row"><strong>{room.roomCode}</strong><div className="room-code-actions"><button className="copy-room-code" type="button" onClick={() => void copyRoomCode(room.roomCode)} aria-label={`Copy room code ${room.roomCode}`}>{copiedCode === room.roomCode ? "Copied ✓" : "Copy code"}</button><span className="room-player-count">♙ {room.playerCount}/{room.maxPlayers}</span></div></div>
          <p className="active-room-host">Hosted by <strong>{room.hostName}</strong></p>
          <div className="active-room-meta"><span>{room.startingHandSize} cards to start</span>{room.spectatorCount > 0 && <span>◉ {room.spectatorCount} watching</span>}</div>
          <button className={available ? (isLive ? "room-watch-button" : "room-join-button") : "room-join-button"} type="button" disabled={!available || joiningCode !== null} onClick={() => void connect(room, isLive ? "watch" : "join")}>
            {joiningCode === room.roomCode ? "Connecting…" : isLive ? "Watch live table ↗" : room.joinable ? "Join this table →" : "Table is full"}
          </button>
        </article>;
      })}
    </div>}
    <div className="active-rooms-foot"><span><i className="live-dot" /> Refreshes every few seconds</span><span>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for first update"}</span></div>
  </section>;
}

function Lobby({ onSession, notice }: { onSession: (session: Session) => void; notice?: string }) {
  const [playerName, setPlayerName] = useState(() => loadPlayerName());
  const [code, setCode] = useState("");
  const [matchMode, setMatchMode] = useState<MatchMode>("quick");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [watchCode, setWatchCode] = useState("");
  const [error, setError] = useState(notice ?? "");
  const [busy, setBusy] = useState(false);
  const [houseRulesOpen, setHouseRulesOpen] = useState(false);
  const [rules, setRules] = useState(() => loadHouseRules()[0]?.rules ?? baseHouseRules);
  const [rulesPageOpen, setRulesPageOpen] = useState(false);

  useEffect(() => { if (notice) setError(notice); }, [notice]);

  const run = async (fn: () => Promise<any>) => {
    setError(""); setBusy(true);
    try {
      const result = await fn();
      const session = { roomCode: result.roomCode, playerToken: result.playerToken, isHost: result.isHost };
      saveSession(session); onSession(session); gameAudio.click();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };
  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    const name = playerName.trim(); const roomCode = code.trim().toUpperCase();
    if (!name) return setError("Please enter your name before joining.");
    if (roomCode.length !== 4) return setError("Please enter the 4-character room code.");
    await run(() => joinRoom(roomCode, name));
  };

  const profile = loadProfile();
  return <main className={`home-screen app-theme-${profile.tableTheme}`}>
    <Navigation onHome={() => { clearSession(); window.location.reload(); }} />
    <div className="home-decor home-decor-one" /><div className="home-decor home-decor-two" />
    <section className="home-content">
      <div className="hero-copy">
        <div className="hero-kicker"><span /> PRIVATE MULTIPLAYER • ONLINE <span /></div>
        <div className="brand hero-brand">WHOT<span>!</span></div>
        <h1>The table feels<br /><em>better at home.</em></h1>
        <p>Make your own house rules, invite your people, and turn every round into the table everyone remembers.</p>
        <div className="hero-tags"><span>2–6 PLAYERS</span><span>HOUSE RULES</span><span>LIVE ROOMS</span><span>DARES + BOUNTIES</span></div>
        <div className="music-note"><span>♫</span> Adjustable game audio & effects</div>
        <div className="theme-preview-strip"><span>TABLE THEMES</span><i className={`theme-swatch swatch-${profile.tableTheme}`} /><i className="theme-swatch swatch-baize" /><i className="theme-swatch swatch-sunset" /><i className="theme-swatch swatch-night" /><b>Choose yours in Profile</b></div>
        <button className="rules-link" type="button" onClick={() => setRulesPageOpen(true)}>Read the rules & tutorial →</button>
      </div>
      <section className="lobby-card">
        <div className="lobby-accent" />
        <div className="lobby-card-head"><div><p className="eyebrow">READY TO PLAY?</p><h2>Enter the table.</h2></div><div className="mini-card-stack" aria-hidden="true"><span /><span /><span /></div></div>
        <div className="form-section">
          <label>Your name<input value={playerName} onChange={event => { setPlayerName(event.target.value); persistPlayerName(event.target.value); }} placeholder="e.g. Emmanuel" maxLength={24} autoComplete="nickname" /></label>
          <label>Game mode<select value={matchMode} onChange={event => setMatchMode(event.target.value as MatchMode)}><option value="quick">Quick Match</option><option value="best_of_3">Best of 3</option><option value="tournament">Tournament • First to 3</option></select></label>
          <button className="house-rules-button" type="button" onClick={() => setHouseRulesOpen(true)}>⚙ Edit house rules <span>{rules.pickThree ? "5 = Pick Three" : "5 = normal"} • {rules.startingHandSize} cards</span></button>
          <label>Room visibility<select value={visibility} onChange={event => setVisibility(event.target.value as "public" | "private")}><option value="public">Public — appears in Active Rooms</option><option value="private">Private — code only</option></select></label>
          <button className="primary full" type="button" disabled={busy || !playerName.trim()} onClick={() => run(() => createRoom(playerName.trim(), { ...rules, matchMode, visibility }))}>{busy ? "Creating room…" : "Create a room →"}</button>
        </div>
        <div className="or-divider"><span>OR JOIN WITH CODE</span></div>
        <form className="form-section" onSubmit={submitJoin}>
          <label>Room code<input className="room-input" value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase())} placeholder="WXYZ" maxLength={4} autoCapitalize="characters" /></label>
          <button className="primary full" type="submit" disabled={busy}>{busy ? "Joining…" : "Join with code →"}</button>
          <p className="form-hint">Enter the 4-character code shared by the host.</p>
          {error && <p className="error form-error" role="status">{error}</p>}
        </form>
        <div className="or-divider"><span>OR WATCH A LIVE ROOM</span></div>
        <form className="form-section spectator-form" onSubmit={async (event) => {
          event.preventDefault();
          const name = playerName.trim(); const roomCode = watchCode.trim().toUpperCase();
          if (!name) return setError("Please enter your name above before watching.");
          if (roomCode.length !== 4) return setError("Please enter the 4-character room code.");
          await run(() => spectateRoom(roomCode, name));
        }}>
          <label>Live room code<input className="room-input" value={watchCode} onChange={event => setWatchCode(event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase())} placeholder="WXYZ" maxLength={4} /></label>
          <button className="secondary full" type="submit" disabled={busy}>Watch by code ↗</button>
          <p className="form-hint">Watching is read-only — you cannot see anyone’s hand.</p>
        </form>
      </section>
      <ActiveRoomsPanel onConnect={onSession} playerName={playerName} />
    </section>
    {houseRulesOpen && <HouseRulesPanel initial={rules} onClose={() => setHouseRulesOpen(false)} onApply={setRules} />}
    {rulesPageOpen && <RulesPanel onClose={() => setRulesPageOpen(false)} />}
  </main>;
}

function LobbyRoom({ session, view, onStarted, onHome }: { session: Session; view: LobbyView; onStarted: () => void; onHome: () => void }) {
  const [error, setError] = useState("");
  const [houseRulesOpen, setHouseRulesOpen] = useState(false);
  const leave = async () => { try { await leaveRoom(session.roomCode, session.playerToken); } catch { /* local exit still works */ } finally { onHome(); } };
  const isHost = view.hostToken === session.playerToken;
  const connectedCount = view.players.filter(p => p.connected).length;
  const modeLabel = view.settings.matchMode === "best_of_3" ? "BEST OF 3" : view.settings.matchMode === "tournament" ? "TOURNAMENT • FIRST TO 3" : "QUICK MATCH";
  const championName = view.match.championToken ? view.players.find(p => p.token === view.match.championToken)?.name : undefined;
  const lastWinnerName = view.match.lastWinnerToken ? view.players.find(p => p.token === view.match.lastWinnerToken)?.name : undefined;
  const startLabel = view.match.championToken ? "Start New Match →" : view.match.roundNumber > 0 ? `Start Round ${view.match.roundNumber + 1} →` : "Start game →";
  const profile = loadProfile();
  return <main className={`room-screen app-theme-${profile.tableTheme}`}>
    <Navigation roomCode={view.roomId} onHome={() => void leave()} onReset={leave} gameView={view} />
    <div className="room-content">
      <div className="room-hero"><p className="eyebrow">{view.settings.visibility === "private" ? "PRIVATE TABLE" : "PUBLIC TABLE"}</p><div className="room-code-big">{view.roomId}</div><div className="room-hero-actions"><div className="mode-pill">{modeLabel}</div><button className="secondary share-room" type="button" onClick={async () => { const text = `Join my Whot room: ${view.roomId}`; try { if (typeof navigator.share === "function") await navigator.share({ title: "Join my Whot game", text }); else await navigator.clipboard.writeText(text); setError(typeof navigator.share === "function" ? "Invite shared." : "Room invite copied to clipboard."); gameAudio.click(); } catch { /* cancelled */ } }}>Share invite</button></div><h1>{view.match.championToken ? "The table has a champion." : "Waiting for your crew."}</h1><p>{view.match.championToken ? `${championName ?? "The winner"} won the match. Start a new one whenever you're ready.` : "Share the code above. The table opens when at least two players are ready."}</p></div>
      <section className="match-scoreboard">
        <div className="scoreboard-head"><div><p className="eyebrow">MATCH BOARD</p><strong>{modeLabel}</strong></div><span>ROUND {Math.max(1, view.match.roundNumber)} • FIRST TO {view.match.targetWins}</span></div>
        <div className="scoreboard-list">{view.players.filter(p => p.connected).map((p, index) => <div className={`score-row ${view.match.championToken === p.token ? "champion" : ""}`} key={p.token}><span className={`player-avatar avatar-${index % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><strong>{p.name}</strong><b>{view.match.wins[p.token] ?? 0}</b></div>)}</div>
        {lastWinnerName && !view.match.championToken && <p className="round-result">Last round: <strong>{lastWinnerName}</strong> won.</p>}
        {view.match.championToken && <p className="round-result champion-result">🏆 <strong>{championName ?? "Champion"}</strong> is the match champion.</p>}
      </section>
      <section className="competitive-strip">
        <div className="competitive-card"><p className="eyebrow">DAILY CHALLENGE</p><strong>Win one round today</strong><span>Finish it to claim +150 XP.</span></div>
        <div className="competitive-card"><p className="eyebrow">CURRENT TITLE</p><strong>{titleForProfile(loadProfile())}</strong><span>Build your streak and climb the table.</span></div>
        <div className="competitive-card"><p className="eyebrow">NEXT UNLOCK</p><strong>Level {Math.floor(loadProfile().xp / 500) + 2}</strong><span>Keep earning XP for cosmetics.</span></div>
      </section>
      <section className="house-rules-summary">
        <div><p className="eyebrow">HOUSE RULES</p><h3>{view.settings.startingHandSize} cards to start</h3><p>{view.settings.stackPickTwo ? "2 stacks" : "2 does not stack"} • {view.settings.pickThree ? "5 = Pick Three + stacks" : "5 is normal"} • {view.settings.holdOn ? "1 holds" : "1 is normal"} • {view.settings.suspension ? "8 suspends" : "8 is normal"} • {view.settings.generalMarket ? "14 is General Market" : "14 is normal"} • perks {view.settings.perksEnabled ? "on" : "off"}</p></div>
        <div className="room-settings-inline">
          <span className="mode-pill">{view.settings.visibility === "private" ? "PRIVATE" : "PUBLIC"}</span>
          {isHost && <button className="secondary" type="button" onClick={() => setHouseRulesOpen(true)}>Edit house rules</button>}
          {isHost && <button className="secondary" type="button" onClick={async () => { try { await updateRoomSettings(session.roomCode, session.playerToken, { visibility: view.settings.visibility === "private" ? "public" : "private" }); onStarted(); } catch (e) { setError(e instanceof Error ? e.message : "Could not change room visibility."); } }}>{view.settings.visibility === "private" ? "Make public" : "Make private"}</button>}
        </div>
      </section>
      <section className="rank-strip">
        <div><p className="eyebrow">YOUR RANK</p><strong>{rankForProfile(loadProfile())}</strong><span>XP {loadProfile().xp}</span></div>
        <div><p className="eyebrow">WEEKLY BOARD</p><strong>{loadProfile().weeklyWins} wins</strong><span>Your weekly score on this device</span></div>
        <div><p className="eyebrow">FRIENDS BOARD</p><strong>{[...view.players].sort((a,b) => (view.match.wins[b.token] ?? 0) - (view.match.wins[a.token] ?? 0))[0]?.name ?? "Your circle"}</strong><span>Top of this room • {Math.max(0, view.match.wins[[...view.players].sort((a,b) => (view.match.wins[b.token] ?? 0) - (view.match.wins[a.token] ?? 0))[0]?.token ?? ""] ?? 0)} wins</span></div>
      </section>
      <section className="room-panel">
        <div className="room-panel-top"><span>PLAYERS READY</span><strong>{connectedCount}/6</strong></div>
        <div className="players">
          {view.players.map((p, index) => <div className={`player-row ${p.connected ? "" : "disconnected"}`} key={p.name}>
            <div className="player-identity"><span className={`player-avatar avatar-${index % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><span>{p.name}</span></div><span className="player-status">{!p.connected ? "LEFT" : index === 0 ? "HOST" : "JOINED"}</span>
          </div>)}
          {Array.from({ length: Math.max(0, 6 - view.players.length) }).map((_, index) => <div className="player-row empty" key={`empty-${index}`}><div className="player-identity"><span className="player-avatar empty-avatar">+</span><span>Waiting for player</span></div><span>OPEN</span></div>)}
        </div>
        {isHost ? <button className="primary full" disabled={connectedCount < 2} onClick={async () => { try { await startRoom(session.roomCode, session.playerToken); await gameAudio.startMusic(); onStarted(); } catch (e) { setError(e instanceof Error ? e.message : "Could not start the game."); } }}>{connectedCount < 2 ? "Waiting for players..." : startLabel}</button> : <div className="waiting-message"><span className="pulse-dot" /> Waiting for the host to start the game.</div>}
        {error && <p className="error form-error">{error}</p>}
      </section>
      {houseRulesOpen && <HouseRulesPanel initial={view.settings} onClose={() => setHouseRulesOpen(false)} onApply={async (nextRules) => { try { await updateRoomSettings(session.roomCode, session.playerToken, nextRules); await onStarted(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update house rules."); } }} />}
    </div>
  </main>;
}

function CelebrationOverlay({ view, winner, onExit }: { view: GameView; winner: boolean; onExit: () => void }) {
  const winnerName = view.winnerToken ? view.players.find((player) => player.token === view.winnerToken)?.name ?? "Player" : "";
  const pieces = Array.from({ length: 56 }, (_, index) => ({
    id: index,
    left: `${(index * 17) % 101}%`,
    delay: `${(index % 14) * 55}ms`,
    duration: `${1.7 + (index % 7) * 0.18}s`,
    rotate: `${(index * 47) % 360}deg`,
    color: ["var(--primary)", "var(--highlight)", "var(--signal-bright)", "#3158B7", "#F3D3B8"][index % 5],
  }));

  return <div className={`result-overlay ${winner ? "result-win" : "result-ended"}`}>
    <div className="result-glow" />
    <div className="confetti" aria-hidden="true">{pieces.map((piece) => <i key={piece.id} style={{ left: piece.left, animationDelay: piece.delay, animationDuration: piece.duration, background: piece.color, transform: `rotate(${piece.rotate})` }} />)}</div>
    {winner ? <div className="winner-card-shower" aria-hidden="true"><span>★</span><span>✦</span><span>●</span><span>✚</span><span>★</span></div> : <div className="ended-mark" aria-hidden="true">×</div>}
    <p className="eyebrow">{winner ? "ROUND COMPLETE" : "TABLE CLOSED"}</p>
    <h2>{winner ? "WINNER" : "GAME HAS ENDED"}</h2>
    {winner && <div className="winner-name">{winnerName}</div>}
    <p className="result-copy">{winner ? `${winnerName} takes the table.` : "A player left the game, so this round has ended."}</p>
    {winner && <div className="result-reward-grid">
      <div><span>ROUND XP</span><strong>+100 XP</strong></div>
      <div><span>STATUS</span><strong>{view.topCard?.value === 20 ? "WHOT FINISH" : "ROUND WIN"}</strong></div>
      <div><span>PERKS</span><strong>{Object.values(view.yourPerks).reduce((sum, count) => sum + (count ?? 0), 0)} BANKED</strong></div>
    </div>}
    {winner && <div className="result-bounties">
      <div className="result-section-label">SECRET BOUNTIES REVEALED</div>
      <div className="result-bounty-list">{view.yourBounties.map(bounty => <span key={bounty.id} className={bounty.completed ? "completed" : "missed"}>{bounty.completed ? "✓" : "—"} {bounty.id.replaceAll("_", " ")}</span>)}</div>
    </div>}
    {winner && view.settings.matchMode !== "quick" && <div className="result-score"><span>Match score</span><div className="result-score-list">{view.players.map(p => <span key={p.token}>{p.name} <b>{view.match.wins[p.token] ?? 0}</b></span>)}</div></div>}
    <div className="result-progress"><span /></div>
    <small>Returning everyone to room {view.roomId}…</small>
    <div className="result-actions">
      <button className="result-exit-button primary-result" type="button" onClick={onExit}>{winner ? "RUN AM BACK" : "BACK TO ROOM"}</button>
      <button className="result-exit-button" type="button" onClick={onExit}>Exit to Home</button>
    </div>
  </div>;
}

function ReactionBar({ view, session, emoteOpen, setEmoteOpen, act }: { view: GameView; session: Session; emoteOpen: boolean; setEmoteOpen: (v: boolean) => void; act: (action: Action) => Promise<void>; }) {
  const [pinned, setPinned] = useState<EmoteId[]>(loadPinnedReactions);
  const [translate, setTranslate] = useState(false);
  const [prefs, setPrefs] = useState(() => { try { return JSON.parse(localStorage.getItem(reactionPrefsKey) ?? '{"hideOthers":false}') as {hideOthers:boolean}; } catch { return {hideOthers:false}; } });
  const holdRef = useRef<number | null>(null);
  const send = (id: EmoteId) => { setEmoteOpen(false); gameAudio.tap(); const meta = reactionMeta[id]; gameAudio.reaction(meta.label, meta.category === "hit" ? "hit" : meta.category === "win" || meta.category === "strong" ? "strong" : "normal"); void act({ type:"EMOTE", playerToken:session.playerToken, emote:id }); };
  const smart = view.pendingDraw > 0 ? reactionKeys.filter(k => reactionMeta[k].category === "hit") : view.winnerToken === session.playerToken ? reactionKeys.filter(k => reactionMeta[k].category === "win") : view.yourHand.length === 1 ? reactionKeys.filter(k => reactionMeta[k].category === "check") : pinned;
  const shown = [...smart, ...pinned].filter((x,i,a) => a.indexOf(x) === i).slice(0,6);
  const togglePin = (id: EmoteId) => { const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [...pinned, id].slice(-6); setPinned(next); localStorage.setItem(pinnedKey, JSON.stringify(next)); };
  const toggleHide = () => { const next = {...prefs, hideOthers:!prefs.hideOthers}; setPrefs(next); localStorage.setItem(reactionPrefsKey, JSON.stringify(next)); };
  return <div className="reaction-shell panel-game">
    <div className="reaction-pinned">{shown.map(id => <button key={id} className="reaction-chip" type="button" title={translate ? reactionMeta[id].meaning : reactionMeta[id].label} onClick={() => send(id)}><span>{reactionMeta[id].icon}</span><b>{translate ? reactionMeta[id].meaning : reactionMeta[id].label}</b></button>)}</div>
    <button className="emote-trigger" type="button" onPointerDown={() => { holdRef.current = window.setTimeout(() => { gameAudio.click(); setEmoteOpen(true); }, 420); }} onPointerUp={() => { if (holdRef.current) window.clearTimeout(holdRef.current); }} onPointerCancel={() => { if (holdRef.current) window.clearTimeout(holdRef.current); }} onClick={() => { gameAudio.click(); setEmoteOpen(!emoteOpen); }}>💬 React</button>
    {emoteOpen && <div className="emote-menu reaction-wheel"><div className="reaction-tools"><button type="button" onClick={() => setTranslate(!translate)}>Translate {translate ? "ON" : "OFF"}</button><button type="button" onClick={toggleHide}>{prefs.hideOthers ? "Show reactions" : "Hide others"}</button></div><div className="reaction-grid">{reactionKeys.map(id => <div className="reaction-item" key={id}><button type="button" onClick={() => send(id)}><span>{reactionMeta[id].icon}</span><b>{reactionMeta[id].label}</b><small>{reactionMeta[id].meaning}</small></button><button className={`pin-reaction ${pinned.includes(id) ? "active" : ""}`} type="button" aria-label={`Pin ${reactionMeta[id].label}`} onClick={() => togglePin(id)}>★</button></div>)}</div></div>}
  </div>;
}

function eventLabel(event: GameView["recentEvents"][number], view: GameView): string {
  const name = (token: string) => view.players.find(player => player.token === token)?.name ?? "Player";
  switch (event.type) {
    case "CARD_PLAYED": return `${name(event.playerToken)} played ${event.card.value === 20 ? "WHOT" : event.card.value}`;
    case "CARD_DRAWN": return `${name(event.playerToken)} drew ${event.count}`;
    case "PICK_TWO_PENDING": return `${name(event.playerToken)} → DRAW ${event.amount}`;
    case "PICK_THREE_PENDING": return `${name(event.playerToken)} → DRAW ${event.amount}`;
    case "GENERAL_MARKET": return `${name(event.playerToken)} → GENERAL MARKET`;
    case "TURN_SKIPPED": return `${name(event.playerToken)} → ${event.reason === "HOLD_ON" ? "HOLD ON" : "SUSPENSION"}`;
    case "PERK_USED": return `${name(event.playerToken)} used ${event.perk.replaceAll("_", " ")}`;
    case "SECRET_BOUNTY_COMPLETED": return "A secret bounty was completed!";
    case "PLAYER_WON": return `${name(event.playerToken)} wins the round`;
    case "LAST_CARD_CALLED": return event.callerToken === event.targetPlayerToken ? `${name(event.callerToken)} called LAST CARD` : `${name(event.callerToken)} caught ${name(event.targetPlayerToken)}`;
    case "TURN_STARTED": return `${name(event.playerToken)}'s turn`;
    case "BOUNTY_COMPLETED": return "A secret bounty was completed!";
  }
}

function Game({ session, view, refresh, onFinished, onHome }: { session: Session; view: GameView; refresh: () => Promise<void>; onFinished: (lobby: LobbyView) => void; onHome: () => void }) {
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [cardPulse, setCardPulse] = useState(0);
  const [initialDeal, setInitialDeal] = useState(true);
  const [shapePicker, setShapePicker] = useState(false);
  const [wildReveal, setWildReveal] = useState(false);
  const [playingCardId, setPlayingCardId] = useState<string | null>(null);
  const [screenShake, setScreenShake] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const previousTop = useRef(view.topCard?.id ?? null);
  const previousHandCount = useRef(view.yourHand.length);
  const previousTurn = useRef(view.currentPlayerToken);
  const previousPendingDraw = useRef(view.pendingDraw);
  const previousPlayerHands = useRef(new Map(view.players.map(p => [p.token, p.handCount])));
  const resultHandled = useRef(false);
  const roundTaskStats = useRef<RoundTaskStats>(emptyRoundStats());
  const previousTaskHand = useRef(view.yourHand.map(card => card.id));
  const previousTaskPending = useRef(view.pendingDraw);
  const previousTaskTurn = useRef(view.currentPlayerToken);
  const previousTaskTurnStartedAt = useRef(view.turnStartedAt);
  const previousTask14Ids = useRef(view.yourHand.filter(card => card.value === 14).map(card => card.id));
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (view.spectator) return;
    const stats = roundTaskStats.current;
    const currentIds = view.yourHand.map(card => card.id);
    const removed = previousTaskHand.current.filter(id => !currentIds.includes(id));
    const topChanged = view.topCard?.id && view.topCard.id !== previousTop.current;
    if (removed.length > 0 && topChanged && view.topCard) {
      const played = view.topCard;
      stats.playedValues[String(played.value)] = (stats.playedValues[String(played.value)] ?? 0) + 1;
      if (played.shape && !stats.shapesPlayed.includes(played.shape)) stats.shapesPlayed.push(played.shape);
      stats.lastPlayedCardValue = played.value;
      stats.lastPlayedCardShape = played.shape;
      if (view.yourHand.length === 1) stats.checkUp = true;
      if (played.value === 20 && previousTaskHand.current.length === 2) stats.whotPlayedAtTwo = true;
      if (played.value === 20) stats.whotChosenShape = view.activeShape;
      if (previousTaskTurn.current === session.playerToken && now - previousTaskTurnStartedAt.current < 3000) stats.fastPlay = true;
    }
    if (view.yourHand.length > previousTaskHand.current.length) {
      stats.draws += 1;
      if (previousTaskPending.current >= 2 && previousTaskTurn.current === session.playerToken) stats.pickTwoTaken += 1;
    }
    if (view.currentPlayerToken !== previousTaskTurn.current) {
      const stillHolding14 = previousTask14Ids.current.some(id => currentIds.includes(id));
      if (stillHolding14) stats.held14Turns += 1;
    }
    previousTaskHand.current = currentIds;
    previousTaskPending.current = view.pendingDraw;
    previousTask14Ids.current = view.yourHand.filter(card => card.value === 14).map(card => card.id);
    previousTaskTurn.current = view.currentPlayerToken;
    previousTaskTurnStartedAt.current = view.turnStartedAt;
    if (view.gameStatus === "won" && view.winnerToken === session.playerToken) {
      stats.won = true;
      stats.finalCardValue = view.topCard?.value ?? null;
      stats.finalCardShape = view.topCard?.shape ?? null;
      stats.finalActiveShape = view.activeShape;
    }
  }, [view.yourHand, view.topCard, view.pendingDraw, view.currentPlayerToken, view.turnStartedAt, view.gameStatus, view.winnerToken, view.spectator, session.playerToken, now]);

  useEffect(() => {
    if (view.gameStatus === "playing" || resultHandled.current) return;
    resultHandled.current = true;
    if (view.gameStatus === "won") {
      if (view.winnerToken === session.playerToken) gameAudio.win();
      else gameAudio.lose();
    } else {
      gameAudio.end();
    }
    gameAudio.stopMusic();
    const timer = window.setTimeout(() => {
      void (async () => {
        // Use the lobby returned by /reset directly instead of waiting for
        // another polling cycle. This prevents the result screen from
        // getting stuck when the room has already been reset by another
        // player or when polling briefly sees stale state.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const lobby = await resetFinishedRoom(session.roomCode, session.playerToken);
            onFinished(lobby);
            return;
          } catch {
            if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 750));
          }
        }
        await refreshRef.current();
      })();
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [view.gameStatus, view.winnerToken, session.playerToken, session.roomCode]);
  useEffect(() => {
    const nextId = view.topCard?.id ?? null;
    if (nextId && previousTop.current && nextId !== previousTop.current) {
      setCardPulse(p => p + 1);
      if (view.topCard) { gameAudio.card(view.topCard.value); gameAudio.slide(); }
    }
    previousTop.current = nextId;
  }, [view.topCard?.id, view.topCard?.value]);
  useEffect(() => {
    if (view.yourHand.length > previousHandCount.current) gameAudio.deal();
    if (view.yourHand.length < previousHandCount.current) gameAudio.slide();
    previousHandCount.current = view.yourHand.length;
  }, [view.yourHand.length]);
  useEffect(() => {
    if (view.pendingDraw > previousPendingDraw.current) {
      gameAudio.combo(view.pendingDraw);
      setScreenShake(true);
      const id = window.setTimeout(() => setScreenShake(false), 420);
      previousPendingDraw.current = view.pendingDraw;
      return () => window.clearTimeout(id);
    }
    previousPendingDraw.current = view.pendingDraw;
  }, [view.pendingDraw]);
  useEffect(() => {
    const next = new Map(view.players.map(p => [p.token, p.handCount]));
    const hadLastCard = Array.from(next.entries()).some(([token, count]) => token !== session.playerToken && count === 1 && (previousPlayerHands.current.get(token) ?? 2) !== 1);
    const meWentToLast = view.yourHand.length === 1 && previousHandCount.current !== 1;
    if (hadLastCard || meWentToLast) {
      gameAudio.slap();
      setScreenShake(true);
      const id = window.setTimeout(() => setScreenShake(false), 500);
      previousPlayerHands.current = next;
      return () => window.clearTimeout(id);
    }
    previousPlayerHands.current = next;
  }, [view.players, view.yourHand.length, session.playerToken]);
  useEffect(() => {
    if (view.currentPlayerToken !== previousTurn.current && view.currentPlayerToken === session.playerToken) gameAudio.turn();
    previousTurn.current = view.currentPlayerToken;
  }, [view.currentPlayerToken, session.playerToken]);
  useEffect(() => { if (!initialDeal) return; const id = window.setTimeout(() => setInitialDeal(false), Math.max(700, view.yourHand.length * 90 + 250)); gameAudio.shuffle(); return () => clearTimeout(id); }, []);
  const leave = async () => { gameAudio.stopMusic(); try { await leaveRoom(session.roomCode, session.playerToken); } catch { /* local exit still works */ } finally { onHome(); } };
  const remaining = Math.max(0, view.turnTimerSeconds * 1000 - (now - view.turnStartedAt));
  const seconds = Math.ceil(remaining / 1000);
  const myTurn = view.currentPlayerToken === session.playerToken;
  const top = view.topCard;
  const playable = useMemo(() => {
    const pendingCanStack = view.pendingDraw > 0 && view.settings.stackPickTwo;
    return new Set(view.yourHand.filter(card => !view.pendingDraw
      ? (card.value === 20 || card.value === top?.value || card.shape === view.activeShape)
      : pendingCanStack && card.value === 2
    ).map(c => c.id));
  }, [view]);
  useEffect(() => { if (myTurn && seconds > 0 && seconds <= 5 && now % 1000 < 260) gameAudio.tick(); }, [seconds, myTurn, now]);

  const act = async (action: Action) => {
    if (view.gameStatus !== "playing") return;
    setError("");
    try {
      const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const expectedVersion = view.stateVersion;
      await sendAction(session.roomCode, session.playerToken, { ...action, requestId, ...(action.type === "EMOTE" ? {} : { expectedVersion }) });
      if (action.type === "DRAW") gameAudio.draw();
      await refresh();
    }
    catch (e) {
      const message = e instanceof Error ? e.message : "Action failed. Please try again.";
      gameAudio.invalid();
      if (/stale action/i.test(message)) {
        await refresh();
        setError("The table changed while you were playing. Your table is updated — try that move again.");
      } else setError(message);
    }
  };
  const play = (card: Card) => {
    if (!myTurn || !playable.has(card.id)) { gameAudio.invalid(); setError(myTurn ? "That card cannot be played right now." : "It is not your turn yet."); return; }
    gameAudio.tap();
    setPlayingCardId(card.id);
    if (card.value === 20) {
      gameAudio.wildPause();
      setWildReveal(true);
      window.setTimeout(() => { setWildReveal(false); setShapePicker(true); setPlayingCardId(null); }, 520);
      return;
    }
    window.setTimeout(() => { void act({ type: "PLAY_CARD", playerToken: session.playerToken, cardId: card.id }); setPlayingCardId(null); }, 180);
  };
  const chooseShape = (selected: Shape) => { setShapePicker(false); gameAudio.wildChoose(); void act({ type: "PLAY_CARD", playerToken: session.playerToken, cardId: view.yourHand.find(c => c.value === 20 && playable.has(c.id))?.id ?? "", chosenShape: selected }); };
  const warning = view.yourHand.length === 1 ? "LAST CARD!" : view.players.some(p => p.token !== session.playerToken && p.connected && p.handCount === 1) ? "CHECK UP!" : "";

  const [profile, setProfile] = useProfile();
  const [emoteOpen, setEmoteOpen] = useState(false);
  const lastEmoteVisible = view.lastEmote && now - view.lastEmote.at < 2800 ? view.lastEmote : null;
  const lastReactionPlayed = useRef<number>(0);
  useEffect(() => { if (!lastEmoteVisible || lastEmoteVisible.at === lastReactionPlayed.current) return; lastReactionPlayed.current = lastEmoteVisible.at; const prefs = (() => { try { return JSON.parse(localStorage.getItem(reactionPrefsKey) ?? "{}"); } catch { return {}; } })(); if (prefs.hideOthers && lastEmoteVisible.playerToken !== session.playerToken) return; gameAudio.reaction(reactionMeta[lastEmoteVisible.emote].label, reactionMeta[lastEmoteVisible.emote].category === "hit" ? "hit" : reactionMeta[lastEmoteVisible.emote].category === "win" || reactionMeta[lastEmoteVisible.emote].category === "strong" ? "strong" : "normal"); }, [lastEmoteVisible?.at, session.playerToken]);
  const profileResultKey = `${session.roomCode}:${view.match.roundNumber}:${view.gameStatus}:${view.winnerToken ?? "none"}`;
  const resultKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (view.spectator) return;
    if (view.gameStatus === "playing" || resultKeyRef.current === profileResultKey) return;
    resultKeyRef.current = profileResultKey;
    if (view.gameStatus === "won") {
      const won = view.winnerToken === session.playerToken;
      roundTaskStats.current.won = won;
      roundTaskStats.current.finalCardValue = view.topCard?.value ?? null;
      roundTaskStats.current.finalCardShape = view.topCard?.shape ?? null;
      roundTaskStats.current.finalActiveShape = view.activeShape;
      const taskIds = completedRoundTasks(roundTaskStats.current);
      if (taskIds.length) {
        const taskStore = loadTaskStore();
        const fresh = taskIds.filter(id => !taskStore.completed.includes(id));
        const earned = fresh.reduce((sum, id) => sum + (taskById(id)?.xp ?? 0), 0);
        const nextTaskStore = { ...taskStore, completed: [...taskStore.completed, ...fresh], taskXp: taskStore.taskXp + earned, weeklyCircleWins: taskStore.weeklyCircleWins + (fresh.includes("circle_finish") ? 1 : 0), collectionMilestones: taskStore.collectionMilestones + fresh.length };
        saveTaskStore(nextTaskStore);
        if (fresh.length) gameAudio.win();
      }

      const wonTodayBefore = profile.lastWinDate === todayKey();
      const nextDailyStreak = won && !wonTodayBefore ? profile.dailyStreak + 1 : profile.dailyStreak;
      const next: Profile = { ...profile, xp: profile.xp + (won ? 100 : 25), wins: profile.wins + (won ? 1 : 0), weeklyWins: profile.weeklyWins + (won ? 1 : 0), weekKey: weekKey(), streak: won ? profile.streak + 1 : 0, bestStreak: won ? Math.max(profile.bestStreak, profile.streak + 1) : profile.bestStreak, badges: [...profile.badges], lastWinDate: won ? todayKey() : profile.lastWinDate, dailyStreak: nextDailyStreak, title: titleForProfile({ ...profile, wins: profile.wins + (won ? 1 : 0), streak: won ? profile.streak + 1 : 0 }) };
      if (won && !next.badges.includes("FIRST_WIN")) next.badges.push("FIRST_WIN");
      if (won && next.streak >= 3 && !next.badges.includes("HOT_STREAK")) next.badges.push("HOT_STREAK");
      if (won && view.topCard?.value === 20 && !next.badges.includes("WHOT_WIN")) next.badges.push("WHOT_WIN");
      setProfile(next);
    }
  }, [view.gameStatus, view.winnerToken, view.match.roundNumber, session.playerToken]);

  useEffect(() => {
    if (view.gameStatus === "playing" && view.yourHand.length > 0 && view.match.roundNumber > 0 && resultHandled.current) {
      resultHandled.current = false;
      roundTaskStats.current = emptyRoundStats();
      previousTaskHand.current = view.yourHand.map(card => card.id);
      previousTaskPending.current = view.pendingDraw;
      previousTaskTurn.current = view.currentPlayerToken;
      previousTaskTurnStartedAt.current = view.turnStartedAt;
      previousTask14Ids.current = view.yourHand.filter(card => card.value === 14).map(card => card.id);
    }
  }, [view.match.roundNumber, view.gameStatus]);

  return <main className={`game-shell theme-${profile.tableTheme} ${screenShake ? "screen-shake" : ""}`}>
    <Navigation roomCode={view.roomId} onHome={() => void leave()} onReset={leave} gameView={view} />
    <header className="game-header"><div><p className="eyebrow">{view.settings.matchMode === "quick" ? "MULTIPLAYER TABLE" : `${view.settings.matchMode === "best_of_3" ? "BEST OF 3" : "TOURNAMENT"} • ROUND ${view.match.roundNumber}`}</p><h1>Make your move.</h1><div className="live-score">{view.players.filter(p => p.connected).map(p => <span key={p.token}>{p.name} <b>{view.match.wins[p.token] ?? 0}</b></span>)}</div></div><div className={`turn ${myTurn ? "mine" : ""}`}><span className="turn-dot" />{myTurn ? `YOUR TURN • ${seconds}s` : `${view.players.find(p => p.token === view.currentPlayerToken)?.name ?? "Player"} • ${seconds}s`}</div></header>
    {warning && <div className="last-card-warning">{warning}</div>}
    <section className="table">
      <div className="table-light table-light-left" /><div className="table-light table-light-right" />
      <div className="opponents panel-game"><div className="section-heading"><span>AT THE TABLE</span><strong>{view.players.filter(p => p.connected).length}</strong></div>
        {view.players.filter(p => p.token !== session.playerToken).map((p, index) => <div className={`opponent ${p.connected ? "" : "left-player"} ${p.handCount === 1 ? "check-up" : ""}`} key={p.token}><div className="player-identity"><span className={`player-avatar avatar-${index % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><strong>{p.name}</strong></div><span>{p.connected ? `${p.handCount} cards` : "Left table"}{p.handCount === 1 && p.connected ? <> • CHECK UP <button className="catch-last" type="button" onClick={() => void act({ type: "CALL_LAST_CARD", playerToken: session.playerToken, targetPlayerToken: p.token })}>CATCH</button></> : ""}</span></div>)}
      </div>
      <div className="center-table">
        <div className="table-ring" /><div className="table-ring inner" />
        <div className="market-pile"><span className="pile-label">MARKET</span><div className="deck-stack" style={{ transform: `scale(${Math.max(0.78, Math.min(1, 0.78 + view.drawPileCount / 60 * 0.22))})` }} aria-label={`${view.drawPileCount} cards left in draw pile`}><div className={`deck-card deck-card-back back-${profile.cardBack}`}><span>WHOT<span>!</span></span></div><div className="deck-count">{view.drawPileCount}</div></div></div>
        <div className="discard"><p className="card-caption">TOP CARD</p>{top && <CardView key={`${top.id}-${cardPulse}`} card={top} compact animate flip />}</div>
        <div className="shape-status"><span>ACTIVE SHAPE</span><strong>{shapeMeta[view.activeShape].glyph} {shapeMeta[view.activeShape].label}</strong>{view.pendingDraw > 0 && <b>DRAW {view.pendingDraw}</b>}</div>
      </div>
      <ReactionBar view={view} session={session} emoteOpen={emoteOpen} setEmoteOpen={setEmoteOpen} act={act} />
      {view.settings.perksEnabled && <div className="secret panel-game"><div className="secret-icon">✦</div><p>SECRET BOUNTIES</p><div className="bounty-list">{view.yourBounties.map(bounty => <div className="bounty-row" key={bounty.id}><strong>{bounty.completed ? "Completed ✓" : "Active"}</strong><span>{bounty.completed ? "Reward earned" : "Secret objective"}</span><div className="secret-bar"><span className={bounty.completed ? "complete" : ""} style={{ width: `${bounty.completed ? 100 : Math.min(85, Math.max(12, bounty.progress * 25))}%` }} /></div></div>)}</div></div>}
      {view.settings.perksEnabled && <div className="perk-tray panel-game"><div className="section-heading"><span>YOUR PERKS</span><strong>{Object.values(view.yourPerks).reduce((sum, count) => sum + (count ?? 0), 0)}</strong></div><div className="perk-actions">
        <button type="button" className={view.yourPerks.SHIELD ? "perk available" : "perk"} disabled={!view.yourPerks.SHIELD || view.pendingDraw <= 0 || !myTurn} onClick={() => void act({ type: "USE_PERK", playerToken: session.playerToken, perk: "SHIELD" })}>Shield <b>{view.yourPerks.SHIELD ?? 0}</b></button>
        <button type="button" className={view.yourPerks.PEEK ? "perk available" : "perk"} disabled={!view.yourPerks.PEEK} onClick={() => void act({ type: "USE_PERK", playerToken: session.playerToken, perk: "PEEK" })}>Peek <b>{view.yourPerks.PEEK ?? 0}</b></button>
        <button type="button" className={view.yourPerks.SWAP ? "perk available" : "perk"} disabled={!view.yourPerks.SWAP} onClick={() => setSwapOpen(!swapOpen)}>Swap <b>{view.yourPerks.SWAP ?? 0}</b></button>
      </div>{swapOpen && <div className="swap-targets">{view.players.filter(player => player.token !== session.playerToken && player.connected && player.handCount > 0).map(player => <button key={player.token} type="button" onClick={() => { setSwapOpen(false); void act({ type: "USE_PERK", playerToken: session.playerToken, perk: "SWAP", targetPlayerToken: player.token }); }}>{player.name} · {player.handCount} cards</button>)}</div>}{view.peekedCards.length > 0 && <div className="peek-row"><span>TOP 3</span>{view.peekedCards.map(card => <CardView key={card.id} card={card} compact />)}</div>}</div>}
      <div className="event-log panel-game"><div className="section-heading"><span>TABLE LOG</span><strong>LIVE</strong></div>{view.recentEvents.slice(-6).reverse().map((event, index) => <div className="event-log-row" key={`${event.type}-${index}-${"timestamp" in event ? event.timestamp : ""}`}>{eventLabel(event, view)}</div>)}</div>
      <div className="hand-area">
        {view.spectator ? <div className="spectator-stage"><div className="spectator-icon">◉</div><p className="eyebrow">LIVE SPECTATOR</p><h2>You are watching this table.</h2><p>Hands are hidden. You can follow the turn, reactions, penalties and winner without affecting the match.</p><div className="spectator-stat"><span>PLAYERS</span><strong>{view.players.filter(p => p.connected).length}</strong><span>CARDS IN MARKET</span><strong>{view.drawPileCount}</strong></div></div> : <>
          <div className="hand-title"><div><span className="eyebrow">YOUR HAND</span><strong>{view.yourHand.length} cards</strong></div><span className="hand-tip">Tap a glowing card to play</span></div>
          <div className="hand">{view.yourHand.map((card, index) => <CardView key={card.id} card={card} playable={myTurn && playable.has(card.id)} onClick={() => play(card)} dealDelay={index * 85} animate={initialDeal} flip={playingCardId === card.id} />)}</div>
          {view.yourHand.length === 1 && <button className="last-card-call" type="button" onClick={() => { gameAudio.slap(); void act({ type: "CALL_LAST_CARD", playerToken: session.playerToken, targetPlayerToken: session.playerToken }); }}>LAST CARD</button>}
          <button className="draw" disabled={!myTurn || view.gameStatus !== "playing"} onClick={() => { gameAudio.tap(); void act({ type: "DRAW", playerToken: session.playerToken }); }}><span>＋</span>{view.pendingDraw ? `Draw ${view.pendingDraw}` : "Draw card"}</button>
        </>}
      </div>
    </section>
    {lastEmoteVisible && <div className="floating-emote"><strong>{lastEmoteVisible.playerName}</strong><span>{reactionMeta[lastEmoteVisible.emote].icon}</span><b>{reactionMeta[lastEmoteVisible.emote].label}</b></div>}
    {view.winnerToken && <div className="winner"><span>✦</span> {view.players.find(p => p.token === view.winnerToken)?.name ?? "Player"} wins the round!</div>}
    {view.gameStatus !== "playing" && <CelebrationOverlay view={view} winner={view.gameStatus === "won"} onExit={() => void leave()} />}
    {wildReveal && <div className="wild-spotlight" aria-live="polite"><div className="wild-spotlight-ring" /><div className="wild-spotlight-card">20</div><p>WHOT!</p><small>Choose your shape…</small></div>}
    {shapePicker && <div className="shape-picker-backdrop"><section className="shape-picker shape-picker-dramatic"><p className="eyebrow">WHOT 20</p><h2>Choose a shape</h2><p>Pick the shape that continues play.</p><div className="shape-options">{(Object.keys(shapeMeta) as Shape[]).map(shape => <button key={shape} className={`shape-option shape-option-${shape}`} type="button" onClick={() => chooseShape(shape)}><span>{shapeMeta[shape].glyph}</span>{shapeMeta[shape].label}</button>)}</div><button className="secondary" type="button" onClick={() => setShapePicker(false)}>Cancel</button></section></div>}
    {error.trim() && <div className="toast error">{error}</div>}
  </main>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setView] = useState<GameView | LobbyView | null>(null);
  const [error, setError] = useState("");
  const goHome = () => { clearSession(); setSession(null); setView(null); setError(""); };
  const refresh = async () => {
    if (!session) return;
    try { setView(await getState(session.roomCode, session.playerToken)); setError(""); }
    catch (e) {
      const message = e instanceof Error ? e.message : "Could not load room";
      if (/room not found|room has closed|host left|host.*inactive/i.test(message)) {
        clearSession();
        setSession(null);
        setView(null);
        setError("That table has closed because its host left or went offline.");
      } else setError(message);
    }
  };
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      try {
        await reconnectRoom(session.roomCode, session.playerToken);
      } catch { /* A closed/invalid session is handled by the normal state refresh below. */ }
      if (!cancelled) await refresh();
    })();
    const stateId = window.setInterval(refresh, 1500);
    const heartbeat = async () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      try { await heartbeatRoom(session.roomCode, session.playerToken); } catch { /* The normal state refresh will surface a closed room. */ }
    };
    const heartbeatId = window.setInterval(() => void heartbeat(), 12_000);
    const onOnline = () => void reconnectRoom(session.roomCode, session.playerToken).then(refresh).catch(refresh);
    const onVisible = () => { if (document.visibilityState === "visible") void reconnectRoom(session.roomCode, session.playerToken).then(refresh).catch(refresh); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(stateId); clearInterval(heartbeatId); window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); };
  }, [session]);
  if (!session) return <Lobby onSession={(next) => { setError(""); setSession(next); }} notice={error} />;
  if (error && !view) return <main className="error-screen"><Navigation roomCode={session.roomCode} onHome={goHome} /><div><div className="error-icon">!</div><h1>We lost the table.</h1><p className="muted">{error}</p><HomeButton onClick={goHome} /></div></main>;
  if (!view) return <main className="loading-screen"><Navigation roomCode={session.roomCode} onHome={goHome} /><div className="loader"><span /><span /><span /></div><p>Loading your table…</p></main>;
  if (view.phase === "lobby") return <LobbyRoom session={session} view={view} onStarted={refresh} onHome={goHome} />;
  return <Game session={session} view={view} refresh={refresh} onFinished={(lobby) => setView(lobby)} onHome={goHome} />;
}
