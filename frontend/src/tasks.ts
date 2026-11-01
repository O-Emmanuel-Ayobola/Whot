import type { Shape } from "../../src/types";

export type TaskCategory = "card" | "risk" | "social" | "progression";
export type TaskKind = "round" | "daily" | "weekly" | "hidden" | "curse" | "combo";

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  kind: TaskKind;
  xp: number;
  target?: number;
  hidden?: boolean;
}

export interface RoundTaskStats {
  playedValues: Record<string, number>;
  shapesPlayed: Shape[];
  draws: number;
  pickTwoTaken: number;
  held14Turns: number;
  whotPlayedAtTwo: boolean;
  whotChosenShape: Shape | null;
  fastPlay: boolean;
  checkUp: boolean;
  lastPlayedCardValue: number | null;
  lastPlayedCardShape: Shape | null;
  won: boolean;
  finalCardValue: number | null;
  finalCardShape: Shape | null;
  finalActiveShape: Shape | null;
}

export const emptyRoundStats = (): RoundTaskStats => ({
  playedValues: {}, shapesPlayed: [], draws: 0, pickTwoTaken: 0, held14Turns: 0,
  whotPlayedAtTwo: false, whotChosenShape: null, fastPlay: false, checkUp: false,
  lastPlayedCardValue: null, lastPlayedCardShape: null, won: false,
  finalCardValue: null, finalCardShape: null, finalActiveShape: null,
});

export const TASKS: TaskDefinition[] = [
  { id: "circle_finish", title: "Last Card Swagger", description: "Finish a round on a Circle.", category: "card", kind: "round", xp: 120 },
  { id: "check_up", title: "Slap and Shout", description: "Reach one card before anyone else notices.", category: "card", kind: "round", xp: 90 },
  { id: "three_fives", title: "Number Loyalty", description: "Play three 5s in one round.", category: "card", kind: "round", xp: 140, target: 3 },
  { id: "clean_market", title: "Clean Sweep", description: "Win without drawing from the market.", category: "card", kind: "round", xp: 180 },
  { id: "pick_two_survivor", title: "Pick-Two Survivor", description: "Take two Pick-Two penalties in a row and still win.", category: "card", kind: "round", xp: 220, target: 2 },
  { id: "whot_flex", title: "Whot Flex", description: "Play Whot 20 while you have exactly two cards.", category: "card", kind: "round", xp: 150 },
  { id: "shape_hopper", title: "Shape Hopper", description: "Play every shape at least once in a round.", category: "card", kind: "round", xp: 200, target: 5 },
  { id: "poker_face", title: "Poker Face", description: "Call a Whot shape and finish the round in that shape.", category: "risk", kind: "round", xp: 210 },
  { id: "hold_the_line", title: "Hold the Line", description: "Keep a General Market card for five turn changes.", category: "risk", kind: "round", xp: 190, target: 5 },
  { id: "double_or_nothing", title: "Double or Nothing", description: "Accept the dare and win the round for a bonus.", category: "risk", kind: "daily", xp: 180 },
  { id: "read_the_room", title: "Read the Room", description: "Guess the next active shape correctly.", category: "risk", kind: "daily", xp: 110 },
  { id: "roast_mode", title: "Roast Mode", description: "Send a taunt after winning a trick.", category: "social", kind: "round", xp: 70 },
  { id: "compliment_loser", title: "Compliment the Loser", description: "Send a Nice reaction after losing a round.", category: "social", kind: "round", xp: 90 },
  { id: "pass_the_dare", title: "Pass the Dare", description: "Accept a mini-dare for the next round.", category: "social", kind: "daily", xp: 80 },
  { id: "team_pact", title: "Team Pact", description: "Complete a secret signal challenge in Team Whot.", category: "social", kind: "weekly", xp: 250 },
  { id: "daily_dare", title: "Daily Dare", description: "Complete today's table dare.", category: "progression", kind: "daily", xp: 150 },
  { id: "weekly_circle", title: "Circle Week", description: "Win five rounds with a Circle finish.", category: "progression", kind: "weekly", xp: 500, target: 5 },
  { id: "collection_quest", title: "Collection Quest", description: "Complete task milestones to unlock card backs.", category: "progression", kind: "weekly", xp: 300, target: 3 },
  { id: "boss_table", title: "Boss Table", description: "Beat a story bot with its special rule active.", category: "progression", kind: "hidden", xp: 300 },
  { id: "mystery_task", title: "Mystery Task", description: "Accept a face-down task and reveal it only after accepting.", category: "progression", kind: "hidden", xp: 180, hidden: true },
];

export function taskById(id: string) { return TASKS.find(task => task.id === id); }

export function completedRoundTasks(stats: RoundTaskStats): string[] {
  const completed: string[] = [];
  if (stats.won && stats.finalCardShape === "circle") completed.push("circle_finish");
  if (stats.checkUp) completed.push("check_up");
  if (stats.won && stats.draws === 0) completed.push("clean_market");
  if ((stats.playedValues["5"] ?? 0) >= 3) completed.push("three_fives");
  if (stats.pickTwoTaken >= 2 && stats.won) completed.push("pick_two_survivor");
  if (stats.whotPlayedAtTwo) completed.push("whot_flex");
  if (new Set(stats.shapesPlayed).size >= 5) completed.push("shape_hopper");
  if (stats.won && stats.whotChosenShape && stats.finalActiveShape === stats.whotChosenShape) completed.push("poker_face");
  if (stats.held14Turns >= 5) completed.push("hold_the_line");
  if (stats.fastPlay) completed.push("speed_dare");
  return completed;
}

export interface TaskStore {
  completed: string[];
  weeklyCircleWins: number;
  collectionMilestones: number;
  dailyKey: string;
  weeklyKey: string;
  dailyAccepted: string[];
  activeDareIds: string[];
  mysteryRevealed: boolean;
  taskXp: number;
}

export const taskStoreKey = "whot-task-progress";
export function todayKeyLocal() { return new Date().toISOString().slice(0, 10); }
export function weekKeyLocal() {
  const d = new Date();
  const first = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${Math.ceil((((d.getTime() - first.getTime()) / 86400000) + first.getDay() + 1) / 7)}`;
}
export function defaultTaskStore(): TaskStore {
  return { completed: [], weeklyCircleWins: 0, collectionMilestones: 0, dailyKey: todayKeyLocal(), weeklyKey: weekKeyLocal(), dailyAccepted: [], activeDareIds: ["circle_finish", "three_fives", "daily_dare"], mysteryRevealed: false, taskXp: 0 };
}
export function loadTaskStore(): TaskStore {
  try {
    const parsed = { ...defaultTaskStore(), ...(JSON.parse(localStorage.getItem(taskStoreKey) ?? "{}")) } as TaskStore;
    if (parsed.dailyKey !== todayKeyLocal()) return { ...parsed, dailyKey: todayKeyLocal(), dailyAccepted: [], mysteryRevealed: false };
    if (parsed.weeklyKey !== weekKeyLocal()) return { ...parsed, weeklyKey: weekKeyLocal(), weeklyCircleWins: 0, collectionMilestones: 0 };
    return parsed;
  } catch { return defaultTaskStore(); }
}
export function saveTaskStore(store: TaskStore) {
  localStorage.setItem(taskStoreKey, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent("whot-task-change"));
}
