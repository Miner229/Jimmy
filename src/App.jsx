import AutoScrollFeatures from './AutoScrollFeatures.jsx';
import DiscoverFilters from './DiscoverFilters.jsx';
import { defaultFilters, filterSessions } from './discoverFilters.js';
import { CreateSheet, EventForm, ClubForm, CoachingFlow } from './CreateFlows';
import React, { useState, useReducer, useMemo } from "react";
import {
  Search, MapPin, Calendar, Clock, Users, Trophy, User, Home, ShoppingBag, Contact, GraduationCap, Layers,
  Filter, X, Check, Star, TrendingUp, Heart,
  Award, Settings, ArrowLeft, Plus, Minus, Shuffle, CreditCard,
  Building2, Bell, Wallet, ShieldCheck, ChevronRight, LogOut, Trash2, ClipboardList, ChevronDown
} from "lucide-react";

/* ---------------------------------------------------------------
   PHOTOGRAPHY
   Real, freely-licensed Unsplash photos, one per context, kept
   consistent so covers don't feel like a random stock-photo grab.
---------------------------------------------------------------- */
const PHOTOS = {
  hero: "photo-1515128926115-1da1b3c702c9",
  player: "photo-1771854399722-240c2accbd0c",
  session: "photo-1721760886713-1ab0c5045bf7",
  club: "photo-1743601587751-01dc32b707d2",
  tournament: "photo-1567220734778-52aeef6a84e8",
};
function Photo({ id, alt, className = "", overlay = true, children }) {
  return (
    <div className={`relative overflow-hidden bg-stone-800 ${className}`}>
      <img
        src={`https://images.unsplash.com/${id}?w=1000&h=750&fit=crop&q=70&auto=format`}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
      />
      {overlay && <div className="absolute inset-0 bg-gradient-to-t from-stone-900/80 via-stone-900/10 to-transparent" />}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------
   MOCK DATA — modeled on the live Flash x information architecture:
   level bands 1–9, reliability score, waitlist/FIFO refill, seat
   pricing, club-hosted sessions, sports-passport profile stats.
---------------------------------------------------------------- */
const LEVELS = [
  { n: 1, name: "Beginner", detail: "New player learning basic grip, serve and rally rhythm. Learning the basic rules and scoring, a correct racket grip and the forehand serve. The focus is on making clean contact and starting a simple rally." },
  { n: 2, name: "Improver", detail: "Can rally short exchanges and understands simple court positioning. Understands the basic rules of indoor badminton. Overhead clears, underarm lifts and net shots are still developing and cannot yet be placed reliably." },
  { n: 3, name: "Lower intermediate", detail: "Comfortable in social doubles with developing consistency. Can direct basic clears and lifts with some control. Footwork and recovery remain inconsistent, and unforced errors are common when moving or under pressure." },
  { n: 4, name: "Intermediate", detail: "Stable rallies, basic tactics and reliable serve/return. Has a working grasp of forward, backward and sideways footwork. Makes better choices when given time to attack, recovers more effectively and makes fewer unforced errors." },
  { n: 5, name: "Upper intermediate", detail: "Confident doubles player with pace control and net awareness. Can use the main strokes and basic tactics in games: smashes, drops, lifts, smash defence and net shots. Shot quality, accuracy and consistency still vary under pressure." },
  { n: 6, name: "Advanced", detail: "Strong movement, attack/defence patterns and competitive consistency. Has a broad technical repertoire, fluent footwork and varied tactical options. Can switch between attack and defence effectively, but power, speed and consistency can fall short against stronger opponents." },
  { n: 7, name: "Club advanced", detail: "Regular club or league player with high-tempo match experience. Sustains fast, demanding rallies and applies tactics consistently in club and league matches. Further progress depends on physical conditioning, technical reliability under pressure and experience against stronger competition." },
  { n: 8, name: "Professional", detail: "Has undergone long-term professional training and has a thorough command of badminton technique and tactics. This level marks the transition from amateur to professional play. Compared with higher-level players, the main areas to develop are experience in top-tier competition and a decisive signature shot or finishing weapon." },
  { n: 9, name: "Elite", detail: "Plays at the standard of a national or provincial professional athlete. Technique and tactical understanding are at the highest level, with a distinctive personal playing style and frequent outstanding performances in competition." },
];

// Illustrative venue coordinates: https://mapcarta.com/W1364508412
// Legacy September sample dates are kept in 2025, not rolled forward into live events.
const SESSIONS = [
  { id: "game-1", name: "Tuesday Improver Doubles", type: "Doubles", club: "Bromley Rally Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-02", date: "Tue 2 Sep", timeStart: "19:00", timeEnd: "21:00", price: 8, seats: 16, going: 9, male: 5, female: 4, levelMin: 2, levelMax: 4, courts: "4 courts · Courts 1–4", source: "Club hosted", reliability: 88, refundBy: "2 Sep, 02:00", tags: ["Level matched", "Shuttles included"] },
  { id: "game-2", name: "Bromley Fast Rotation", type: "Social", club: "Bromley Rally Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-04", date: "Thu 4 Sep", timeStart: "20:00", timeEnd: "22:00", price: 9, seats: 16, going: 16, male: 10, female: 6, levelMin: 4, levelMax: 6, courts: "4 courts · Courts 1–4", source: "Club hosted", reliability: 91, refundBy: "3 Sep, 20:00", tags: ["Waitlist refill", "Fast rotation"] },
  { id: "game-3", name: "Sunday Social Courts", type: "Social", club: "Bromley Rally Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-06", date: "Sun 6 Sep", timeStart: "10:00", timeEnd: "12:00", price: 7, seats: 16, going: 11, male: 8, female: 3, levelMin: 1, levelMax: 3, courts: "4 courts · Courts 1–4", source: "Club hosted", reliability: 84, refundBy: "5 Sep, 10:00", tags: ["Beginner friendly", "Racket support"] },
  { id: "game-4", name: "Advanced Matchplay", type: "Doubles", club: "Bromley Rally Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-09", date: "Tue 9 Sep", timeStart: "19:30", timeEnd: "21:30", price: 10, seats: 16, going: 14, male: 8, female: 6, levelMin: 6, levelMax: 8, courts: "3 courts · Courts 2–4", source: "Club hosted", reliability: 90, refundBy: "8 Sep, 19:30", tags: ["Competitive", "Level checked"] },
  { id: "game-5", name: "Greenwich Mixed Doubles", type: "Doubles", club: "Greenwich Shuttle Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-01", date: "Mon 1 Sep", timeStart: "18:30", timeEnd: "20:30", price: 8, seats: 16, going: 12, male: 8, female: 4, levelMin: 3, levelMax: 5, courts: "4 courts · Courts A–D", source: "Club hosted", reliability: 86, refundBy: "31 Aug, 18:30", tags: ["Balanced pairs", "Level matched"] },
  { id: "game-6", name: "Beginner Rally Night", type: "Coaching", club: "Greenwich Shuttle Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-03", date: "Wed 3 Sep", timeStart: "19:00", timeEnd: "20:30", price: 11, seats: 12, going: 10, male: 7, female: 3, levelMin: 1, levelMax: 2, courts: "2 courts · Courts A–B", source: "Coach led", reliability: 95, refundBy: "2 Sep, 19:00", tags: ["Coach led", "Rackets available"] },
  { id: "game-7", name: "Friday Full Court", type: "Social", club: "Greenwich Shuttle Club", location: "Crystal Palace", areaId: "GB.ENG.GLA", cityIds: ["2643743", "6693937"], coordinates: { latitude: 51.42009, longitude: -0.06889 }, dateISO: "2025-09-05", date: "Fri 5 Sep", timeStart: "19:30", timeEnd: "21:30", price: 9, seats: 16, going: 16, male: 9, female: 7, levelMin: 4, levelMax: 6, courts: "4 courts · Courts A–D", source: "Club hosted", reliability: 89, refundBy: "4 Sep, 19:30", tags: ["Full session", "Auto refill"] },
];
const seatsLeft = (s) => Math.max(0, s.seats - s.going);

const ROSTER_POOL = [
  { name: "Aisha Khan", level: 7, gender: "F" }, { name: "Priya Nair", level: 7, gender: "F" },
  { name: "Marcus Webb", level: 6, gender: "M" }, { name: "Sofia Reyes", level: 6, gender: "F" },
  { name: "Daniel Osei", level: 5, gender: "M" }, { name: "Emma Louis", level: 5, gender: "F" },
  { name: "Benny", level: 4, gender: "M" }, { name: "Chris Ade", level: 4, gender: "M" },
  { name: "Maya Solis", level: 4, gender: "F" }, { name: "Ravi Patel", level: 3, gender: "M" },
  { name: "Nina Patel", level: 3, gender: "F" }, { name: "Joe Brand", level: 2, gender: "M" },
  { name: "Leo Ford", level: 3, gender: "M" }, { name: "Amy Chu", level: 3, gender: "F" },
  { name: "Sam Ellis", level: 5, gender: "M" }, { name: "Kim Ahn", level: 4, gender: "F" },
  { name: "Tom Iwu", level: 2, gender: "M" }, { name: "Grace Lin", level: 6, gender: "F" },
  { name: "Owen Bell", level: 5, gender: "M" }, { name: "Nadia Farouk", level: 2, gender: "F" },
];
function rosterFor(session) {
  const offset = session.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % ROSTER_POOL.length;
  return Array.from({ length: session.going }, (_, i) => ROSTER_POOL[(offset + i) % ROSTER_POOL.length]);
}

// Real venue address supplied — used as the illustrative venue for events
// until per-club addresses are provided.
const VENUE_ADDRESS = "Crystal Palace, National Sports Centre, Ledrington Rd, London SE19 2BB";
const VENUE_MAP_EMBED = `https://www.google.com/maps?q=${encodeURIComponent(VENUE_ADDRESS)}&output=embed`;

const CLUBS = [
  { id: "bromley-rally-club", name: "Bromley Rally Club", location: "Crystal Palace, London SE19", members: 248, rating: 4.8, season: "Gold V", trust: 42, description: "Friendly doubles sessions for improver to upper-intermediate players in south east London.", ranking: 1, tournamentsHosted: 6 },
  { id: "greenwich-shuttle-club", name: "Greenwich Shuttle Club", location: "Crystal Palace, London SE19", members: 176, rating: 4.6, season: "Silver III", trust: 29, description: "A coach-led club with a strong beginner pathway and a busy Friday social scene.", ranking: 3, tournamentsHosted: 3 },
  { id: "hackney-smash", name: "Hackney Smash", location: "Crystal Palace, London SE19", members: 132, rating: 4.5, season: "Silver I", trust: 18, description: "East London's fastest-growing club, known for its competitive Thursday matchplay nights.", ranking: 4, tournamentsHosted: 2 },
  { id: "wimbledon-net-club", name: "Wimbledon Net Club", location: "Crystal Palace, London SE19", members: 205, rating: 4.7, season: "Gold II", trust: 37, description: "A long-established club with the borough's most active singles ladder.", ranking: 2, tournamentsHosted: 8 },
];

const RANKINGS = [
  { rank: 1, name: "Aisha Khan", initials: "AK", rating: 2340, matches: 88, wins: 71, winRate: 81 },
  { rank: 2, name: "Priya Nair", initials: "PN", rating: 2298, matches: 76, wins: 60, winRate: 79 },
  { rank: 3, name: "Marcus Webb", initials: "MW", rating: 2255, matches: 94, wins: 70, winRate: 74 },
  { rank: 4, name: "Sofia Reyes", initials: "SR", rating: 2201, matches: 65, wins: 47, winRate: 72 },
  { rank: 5, name: "Daniel Osei", initials: "DO", rating: 2178, matches: 82, wins: 57, winRate: 70 },
  { rank: 6, name: "Emma Louis", initials: "EL", rating: 2140, matches: 58, wins: 39, winRate: 67 },
  { rank: 7, name: "Benny", initials: "BS", rating: 2090, matches: 47, wins: 30, winRate: 64, isUser: true },
  { rank: 8, name: "Chris Ade", initials: "CA", rating: 2065, matches: 71, wins: 44, winRate: 62 },
  { rank: 9, name: "Maya Solis", initials: "MS", rating: 2011, matches: 53, wins: 31, winRate: 58 },
  { rank: 10, name: "Ravi Patel", initials: "RP", rating: 1988, matches: 66, wins: 37, winRate: 56 },
];

const TOURNAMENTS = [
  { id: "t1", name: "Bromley Autumn Open", location: "Bromley Rally Club", dates: "27–28 Sep", format: "Knockout", category: "Mixed doubles · Levels 3–6", entryFee: 15, participants: 32, status: "Open" },
  { id: "t2", name: "Wimbledon Ladder Finals", location: "Wimbledon Net Club", dates: "4 Oct", format: "Round robin + knockout", category: "Singles · Open level", entryFee: 10, participants: 16, status: "Open" },
  { id: "t3", name: "Greenwich Beginners Cup", location: "Greenwich Shuttle Club", dates: "18 Oct", format: "Group stage + knockout", category: "Doubles · Levels 1–3", entryFee: 8, participants: 24, status: "Closed" },
];

const BRACKET = {
  quarterfinals: [
    { a: "Aisha Khan / Priya Nair", b: "Chris Ade / Maya Solis", scoreA: 21, scoreB: 15, done: true },
    { a: "Marcus Webb / Sofia Reyes", b: "Daniel Osei / Emma Louis", scoreA: 18, scoreB: 21, done: true },
    { a: "Ravi Patel / Sam Ellis", b: "Nina Patel / Joe Brand", scoreA: 21, scoreB: 19, done: true },
    { a: "Benny / Kim Ahn", b: "Leo Ford / Amy Chu", scoreA: null, scoreB: null, done: false },
  ],
  semifinals: [
    { a: "Aisha Khan / Priya Nair", b: "Daniel Osei / Emma Louis", scoreA: 21, scoreB: 17, done: true },
    { a: "Ravi Patel / Sam Ellis", b: "TBD", scoreA: null, scoreB: null, done: false },
  ],
  final: [{ a: "Aisha Khan / Priya Nair", b: "TBD", scoreA: null, scoreB: null, done: false }],
};

const CLUB_BENEFITS = [
  "Priority booking — see and join new sessions before non-members",
  "Member pricing on selected sessions and coaching",
  "Session reminders and waitlist alerts for this club",
  "Faster entry into the club's tournaments and ladders",
];

const CURRENT_USER = {
  name: "Benny", initials: "BS", level: 4, homeArea: "Central London", preferredFormat: "Doubles", reliability: 96,
  stats: { activities: 18, clubs: 6, totalHours: 48.3, noShows: 0, wins: 30, losses: 17, winRate: 64, ranking: 7 },
  achievements: [
    { label: "10-win streak", detail: "Won 10 matches in a row" },
    { label: "Level 4 milestone", detail: "Promoted to intermediate" },
    { label: "Club regular", detail: "Booked 25+ sessions" },
  ],
  paymentHistory: [
    { id: "p1", label: "Tuesday Improver Doubles", date: "2 Sep", amount: 8, status: "Paid" },
    { id: "p2", label: "Wimbledon Ladder Finals entry", date: "28 Aug", amount: 10, status: "Paid" },
    { id: "p3", label: "Sunday Social Courts", date: "24 Aug", amount: 7, status: "Refunded" },
  ],
};

const ALLOCATION_PLAYERS = [
  { id: "p1", name: "Aisha Khan", level: 7, gender: "F" }, { id: "p2", name: "Priya Nair", level: 7, gender: "F" },
  { id: "p3", name: "Marcus Webb", level: 6, gender: "M" }, { id: "p4", name: "Sofia Reyes", level: 6, gender: "F" },
  { id: "p5", name: "Daniel Osei", level: 5, gender: "M" }, { id: "p6", name: "Emma Louis", level: 5, gender: "F" },
  { id: "p7", name: "Benny", level: 4, gender: "M" }, { id: "p8", name: "Chris Ade", level: 4, gender: "M" },
  { id: "p9", name: "Maya Solis", level: 4, gender: "F" }, { id: "p10", name: "Ravi Patel", level: 3, gender: "M" },
  { id: "p11", name: "Nina Patel", level: 3, gender: "F" }, { id: "p12", name: "Joe Brand", level: 2, gender: "M" },
];
function allocateCourts(players, courtCount) {
  const sorted = [...players].sort((a, b) => b.level - a.level);
  const courts = Array.from({ length: courtCount }, () => []);
  sorted.forEach((p, i) => courts[i % courtCount].push(p));
  return courts;
}

/* ---------------------------------------------------------------
   SHARED UI PRIMITIVES
---------------------------------------------------------------- */
function Button({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition active:scale-[0.98] disabled:opacity-40";
  const styles = {
    primary: "bg-stone-900 text-white hover:bg-stone-800",
    accent: "bg-yellow-400 text-stone-900 hover:bg-yellow-300",
    secondary: "bg-stone-100 text-stone-900 hover:bg-stone-200",
    outline: "border border-stone-300 text-stone-900 hover:bg-stone-50",
    ghost: "text-stone-600 hover:bg-stone-100",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props}>{children}</button>;
}
function Badge({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-stone-100 text-stone-600",
    accent: "bg-yellow-100 text-yellow-800",
    warn: "bg-amber-50 text-amber-700",
    live: "bg-red-50 text-red-700",
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
function Card({ children, className = "", onClick }) {
  return (
    <div onClick={onClick} className={`rounded-xl border border-stone-200 bg-white ${onClick ? "cursor-pointer hover:border-stone-300" : ""} ${className}`}>
      {children}
    </div>
  );
}
function Avatar({ initials, size = 10, tone = "dark" }) {
  const tones = {
    dark: "bg-stone-900 text-white",
    accent: "bg-yellow-100 text-yellow-800",
    white: "bg-white text-stone-900 border border-stone-200",
  };
  return (
    <div className={`h-${size} w-${size} shrink-0 rounded-full ${tones[tone]} flex items-center justify-center text-xs font-semibold`}>
      {initials}
    </div>
  );
}
function StatBlock({ label, value }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-stone-900 leading-none">{value}</p>
      <p className="mt-1 text-xs text-stone-500">{label}</p>
    </div>
  );
}
function SectionCard({ title, action, children }) {
  return (
    <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
function StatTile({ value, label, tone }) {
  const toneClass = tone === "yellow" ? "text-yellow-700" : tone === "muted" ? "text-stone-400" : "text-stone-900";
  return (
    <div className="rounded-lg bg-stone-50 p-3 text-center">
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-stone-500">{label}</p>
    </div>
  );
}
function BackRow({ label, onBack }) {
  return (
    <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}

/* ---------------------------------------------------------------
   NAVIGATION
---------------------------------------------------------------- */
const NAV_ITEMS = [
  { key: "discover", label: "Discover", icon: Home },
  { key: "clubs", label: "Clubs", icon: Building2 },
  { key: "rankings", label: "Rankings", icon: TrendingUp },
  { key: "tournaments", label: "Tournaments", icon: Trophy },
  { key: "bookings", label: "Bookings", icon: Calendar },
  { key: "organiser", label: "Organiser", icon: ClipboardList },
];
const MOBILE_NAV = ["discover", "clubs", "create", "rankings", "bookings"];

const NOTIFICATIONS = [
  { id: "n1", title: "Waitlist spot opened", detail: "A seat freed up in Bromley Fast Rotation.", time: "12m ago" },
  { id: "n2", title: "Booking confirmed", detail: "You're in for Tuesday Improver Doubles, 19:00.", time: "1h ago" },
  { id: "n3", title: "Score submitted", detail: "Your Advanced Matchplay result was recorded.", time: "Yesterday" },
];

function NotificationBell({ open, setOpen, align = "right" }) {
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications" className="relative rounded-lg p-2 text-stone-300 hover:bg-stone-800 hover:text-white">
        <Bell className="h-5 w-5" />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-yellow-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-40 mt-2 w-72 rounded-xl border border-stone-200 bg-white p-1.5 text-stone-900 shadow-xl`}>
            <p className="px-2.5 py-1.5 text-xs font-semibold text-stone-400">Notifications</p>
            {NOTIFICATIONS.map((n) => (
              <div key={n.id} className="rounded-lg px-2.5 py-2 hover:bg-stone-50">
                <div className="flex items-center justify-between"><p className="text-sm font-medium text-stone-900">{n.title}</p><span className="text-xs text-stone-400">{n.time}</span></div>
                <p className="text-xs text-stone-500">{n.detail}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tabs({ options, value, onChange }) {
  return (
    <div className="flex gap-5 border-b border-stone-200">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`relative -mb-px pb-2.5 text-sm font-medium transition ${value === opt.value ? "text-stone-900" : "text-stone-400 hover:text-stone-600"}`}
        >
          {opt.label}
          {value === opt.value && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-yellow-400" />}
        </button>
      ))}
    </div>
  );
}

function AccountMenu({ open, setOpen, go, openAccountModal }) {
  const items = [
    { label: "View profile", action: () => go("profile") },
    { label: "Settings", action: () => openAccountModal("settings") },
    { label: "Payment history", action: () => openAccountModal("history") },
  ];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="ml-1"><Avatar initials={CURRENT_USER.initials} size={9} tone="white" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-stone-200 bg-white p-1.5 text-stone-900 shadow-xl">
            <div className="flex items-center gap-2 border-b border-stone-100 px-2.5 py-2">
              <Avatar initials={CURRENT_USER.initials} size={8} tone="white" />
              <div><p className="text-sm font-medium text-stone-900">{CURRENT_USER.name}</p><p className="text-xs text-stone-400">Level {CURRENT_USER.level}</p></div>
            </div>
            <div className="py-1">
              {items.map((it) => (
                <button key={it.label} onClick={() => { setOpen(false); it.action(); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-50">
                  {it.label} <ChevronRight className="h-3.5 w-3.5 text-stone-300" />
                </button>
              ))}
            </div>
            <div className="border-t border-stone-100 pt-1">
              <button onClick={() => setOpen(false)} className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-400 hover:bg-stone-50"><LogOut className="h-3.5 w-3.5" /> Log out</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   ACCOUNT MODAL — settings, payment methods, payment history,
   and policies all live behind the avatar, not scattered on the
   profile page.
---------------------------------------------------------------- */
function AccountModal({ open, onClose, initialTab, paymentMethods, addPaymentMethod, removePaymentMethod, setDefaultMethod, flashToast }) {
  const tab = initialTab || "settings";
  const [form, setForm] = useState({ number: "", name: "", exp: "", cvc: "" });
  const [showAddCard, setShowAddCard] = useState(false);

  if (!open) return null;

  const submitCard = (e) => {
    e.preventDefault();
    if (form.number.replace(/\s/g, "").length < 12 || !form.name || !form.exp || form.cvc.length < 3) {
      flashToast("Check your card details and try again");
      return;
    }
    addPaymentMethod({ id: `pm${Date.now()}`, brand: "Card", last4: form.number.replace(/\s/g, "").slice(-4), exp: form.exp, default: paymentMethods.length === 0 });
    setForm({ number: "", name: "", exp: "", cvc: "" });
    setShowAddCard(false);
    flashToast("Card saved");
  };

  const title = {settings: 'Settings', methods: 'Payment methods', history: 'Payment history', policies: 'Policy'}[tab];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/50 p-4">
      <div className="mx-auto my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <h2 className="text-xl text-stone-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-96 overflow-y-auto px-5 py-5">
          {tab === "settings" && (
            <div className="space-y-4">
              <p className="text-xs text-stone-400">This is a preview — changes here aren't saved between sessions.</p>
              <label className="block text-xs font-medium text-stone-500">Full name
                <input defaultValue={CURRENT_USER.name} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" />
              </label>
              <label className="block text-xs font-medium text-stone-500">Home area
                <input defaultValue={CURRENT_USER.homeArea} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-stone-500">Level
                  <select defaultValue={CURRENT_USER.level} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
                    {LEVELS.map((l) => <option key={l.n} value={l.n}>Level {l.n} — {l.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium text-stone-500">Preferred format
                  <select defaultValue={CURRENT_USER.preferredFormat} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900">
                    <option>Doubles</option><option>Singles</option><option>Mixed doubles</option><option>Coaching</option>
                  </select>
                </label>
              </div>
              <Button variant="accent" onClick={() => flashToast("Profile updated")}>Save changes</Button>
            </div>
          )}

          {tab === "methods" && (
            <div className="space-y-3">
              {paymentMethods.length === 0 && <p className="text-sm text-stone-500">No payment methods saved yet.</p>}
              {paymentMethods.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border border-stone-200 p-3">
                  <CreditCard className="h-5 w-5 text-stone-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-stone-900">{m.brand} ending {m.last4}</p>
                    <p className="text-xs text-stone-500">Expires {m.exp}{m.default && <span className="ml-2 text-yellow-700">· Default</span>}</p>
                  </div>
                  {!m.default && <button onClick={() => setDefaultMethod(m.id)} className="text-xs text-stone-500 hover:text-stone-900">Make default</button>}
                  <button onClick={() => removePaymentMethod(m.id)} className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}

              {showAddCard ? (
                <form onSubmit={submitCard} className="space-y-3 rounded-lg border border-stone-200 p-3">
                  <label className="block text-xs font-medium text-stone-500">Card number
                    <input value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} placeholder="4242 4242 4242 4242" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="block text-xs font-medium text-stone-500">Name on card
                    <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Benny Smith" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium text-stone-500">Expiry
                      <input value={form.exp} onChange={(e) => setForm((f) => ({ ...f, exp: e.target.value }))} placeholder="MM/YY" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="block text-xs font-medium text-stone-500">CVC
                      <input value={form.cvc} onChange={(e) => setForm((f) => ({ ...f, cvc: e.target.value }))} placeholder="123" className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="accent" className="flex-1" type="submit">Save card</Button>
                    <Button variant="ghost" type="button" onClick={() => setShowAddCard(false)}>Cancel</Button>
                  </div>
                  <p className="text-xs text-stone-400">Card details are illustrative only — this preview doesn't process real payments. Ready to wire up to Stripe.</p>
                </form>
              ) : (
                <Button variant="outline" className="w-full" onClick={() => setShowAddCard(true)}><Plus className="h-4 w-4" /> Add payment method</Button>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-2">
              {CURRENT_USER.paymentHistory.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-stone-100 py-2.5 text-sm">
                  <div className="flex items-center gap-2 text-stone-700"><Wallet className="h-3.5 w-3.5 text-stone-400" />{p.label}</div>
                  <div className="flex items-center gap-3"><span className="text-stone-400">{p.date}</span><span className="font-medium">£{p.amount}</span><Badge tone={p.status === "Refunded" ? "warn" : "accent"}>{p.status}</Badge></div>
                </div>
              ))}
            </div>
          )}

          {tab === "policies" && (
            <div className="space-y-6">
              <section>
                <h3 className="text-sm font-semibold text-stone-900">Cancellations &amp; refunds</h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">Full refund if you cancel before the session's stated refund deadline. After that, seats can't be refunded but you can transfer to a friend from My bookings.</p>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function BrandLogo() {
  return <span className="brand-logo"><img src="/branding/jimmiplay-logo-dark.jpg" alt="JimmiPlay" width="1280" height="640" fetchPriority="high" /></span>;
}
function TopNav({ view, go, notifOpen, setNotifOpen, accountOpen, setAccountOpen, openAccountModal }) {
  return (
    <header className="hidden md:flex sticky top-0 z-20 items-center justify-between border-b border-stone-800 bg-stone-900 px-8 py-3">
      <button onClick={() => go("discover")} className="brand-home" aria-label="JimmiPlay — Discover">
        <BrandLogo />
      </button>
      <div className="flex items-center gap-1">
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <button key={item.key} onClick={() => go(item.key)} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${view === item.key ? "bg-stone-800 text-yellow-400" : "text-stone-300 hover:text-white"}`}>
              {item.label}
            </button>
          ))}
        </nav>
        <button aria-label="Create" onClick={() => go("create")} className="art-plus desktop-plus">+</button>
        <HeaderExtras go={go} setNotifOpen={setNotifOpen} setAccountOpen={setAccountOpen} openAccountModal={openAccountModal}/>
        <NotificationBell open={notifOpen} setOpen={setNotifOpen} />
        <AccountMenu open={accountOpen} setOpen={setAccountOpen} go={go} openAccountModal={openAccountModal} />
      </div>
    </header>
  );
}
function HeaderExtras({go,setNotifOpen,setAccountOpen,openAccountModal}) {
  const [menu,setMenu]=useState(null);
  const ref=React.useRef(null);
  React.useEffect(()=>{const close=e=>{if(!ref.current?.contains(e.target))setMenu(null);};const escape=e=>{if(e.key==='Escape')setMenu(null);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[]);
  const navigate=view=>{setMenu(null);go(view);};
  return <div className="header-extras" ref={ref}>{['fun','boring'].map(kind=><div className="mobile-more" key={kind}><button className="mobile-more-trigger" aria-expanded={menu===kind} onClick={()=>{setMenu(menu===kind?null:kind);setNotifOpen(false);setAccountOpen(false);}}><span>{kind==='fun'?'More':'Boring'}<br/>{kind==='fun'?'Fun':'Stuff'}</span><ChevronDown size={12}/></button>{menu===kind&&<div className="mobile-more-menu">{kind==='fun'?<><div className="mobile-more-shop" aria-disabled="true"><ShoppingBag size={18}/><span>Shop<small>Coming soon</small></span></div><button onClick={()=>navigate('coaching')}><GraduationCap size={18}/>Coaching</button><button onClick={()=>navigate('levels')}><Layers size={18}/>Level</button><button onClick={()=>navigate('tournaments')}><Trophy size={18}/>Tournaments</button><button onClick={()=>navigate('organiser')}><ClipboardList size={18}/>Organiser Portal</button></>:<><button onClick={()=>{setMenu(null);openAccountModal('policies');}}>Policy</button><button onClick={()=>navigate('terms')}>Terms &amp; Conditions</button><button onClick={()=>navigate('contact')}>Contact us</button><button onClick={()=>navigate('about')}>About us</button></>}</div>}</div>)}</div>;
}
function InformationPage({view,go}) {
 const titles={about:'About us',contact:'Contact us',terms:'Terms & Conditions'};
 return <main className="mx-auto max-w-2xl px-4 py-6 sm:px-8"><BackRow label="Back to discover" onBack={()=>go('discover')}/><h1 className="text-2xl">{titles[view]}</h1><div className="information-copy">{view==='about'?<><h2>Three people. One shared court.</h2><p>JimmiPlay began with Benny, a middle-aged badminton enthusiast who loved the game but was tired of hunting for a group to play with. He teamed up with two younger friends — a co-founder and an IT builder — to make finding your badminton people a little easier. Two young minds, one seasoned player, and plenty of enthusiasm.</p><h2>A bridge between organisers and players</h2><p>Our mission is to help organisers build thriving communities and help players find sessions, clubs and coaches that suit their level and location. Less chasing group chats. More time on court.</p><h2>More than a game</h2><p>We want to make sport easier to join, bring generations and backgrounds together, and create more opportunities for friendship, movement and belonging. By helping local organisers reach players and players find their people, we hope to support healthier, more connected communities — one rally at a time.</p></>:view==='contact'?<><p>Questions, ideas or a little help finding your way? We would love to hear from players, coaches and organisers.</p><a className="underline" href="mailto:Hello@jimmiplay.com">Hello@jimmiplay.com</a></>:<><h2>Platform preview</h2><p>JimmiPlay is currently a demonstration platform. Listings, profiles and booking records may contain sample data. Booking, payment and registration screens do not confirm a real reservation, payment or coach approval.</p><h2>Before joining a session</h2><p>Check the organiser, venue, level requirements and any event-specific rules before making plans. Treat other players and organisers with respect and describe your playing level honestly.</p><h2>Full service terms</h2><p>Final service terms have not yet been published. They will be made available before live transactions are enabled.</p><p>For questions, contact <a className="underline" href="mailto:Hello@jimmiplay.com">Hello@jimmiplay.com</a>.</p></>}</div></main>;
}
function MobileHeader({ title, go, notifOpen, setNotifOpen, accountOpen, setAccountOpen, openAccountModal }) {
  return (
    <header className="md:hidden sticky top-0 z-20 flex items-center justify-between border-b border-stone-800 bg-stone-900 px-4 py-3">
      <button onClick={() => go("discover")} className="brand-home" aria-label="JimmiPlay — Discover">
        <BrandLogo />
      </button>
      <HeaderExtras go={go} setNotifOpen={setNotifOpen} setAccountOpen={setAccountOpen} openAccountModal={openAccountModal}/>
      <div className="flex items-center gap-1">
        <NotificationBell open={notifOpen} setOpen={setNotifOpen} align="right" />
        <AccountMenu open={accountOpen} setOpen={setAccountOpen} go={go} openAccountModal={openAccountModal} />
      </div>
    </header>
  );
}
function BottomNav({ view, go }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 grid grid-cols-5 border-t border-stone-800 bg-stone-900">
      {MOBILE_NAV.map(key => key === "create" ? { key, label: "Create", icon: Plus } : NAV_ITEMS.find(i => i.key === key)).map((item) => {
        const Icon = item.icon;
        const active = view === item.key;
        return (
          <button key={item.key} aria-label={item.key === "create" ? "Create" : item.label} onClick={() => go(item.key)} className="flex flex-col items-center justify-center gap-0.5 py-2.5">
            {item.key === "create" ? <span className="art-plus">+</span> : <>
            <Icon className={`h-5 w-5 ${active ? "text-yellow-400" : "text-stone-500"}`} />
            <span className={`text-xs ${active ? "text-white font-medium" : "text-stone-500"}`}>{item.label}</span></>}
          </button>
        );
      })}
    </nav>
  );
}

/* ---------------------------------------------------------------
   SESSION CARD
---------------------------------------------------------------- */
function SessionCard({ session, onOpen, favorites, toggleFav }) {
  const left = seatsLeft(session);
  const full = left === 0;
  const isFav = favorites.includes(session.id);
  return (
    <Card onClick={() => onOpen(session.id)} className="overflow-hidden">
      <div className="flex">
        <Photo id={PHOTOS.session} alt={session.name} className="h-auto w-24 shrink-0 sm:w-32" overlay={false} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-stone-900">{session.name}</h3>
                <button onClick={(e) => { e.stopPropagation(); toggleFav(session.id); }} aria-label="Save session">
                  <Heart className={`h-4 w-4 ${isFav ? "fill-red-500 text-red-500" : "text-stone-300"}`} />
                </button>
              </div>
              <p className="text-sm text-stone-500">{session.location} · {session.type}{session.distanceKm != null && ` · ${session.distanceKm.toFixed(1)} km away`}</p>
            </div>
            <p className="shrink-0 text-lg font-semibold text-stone-900">£{session.price}</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
            <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5 text-stone-400" />{session.date}</span>
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-stone-400" />{session.timeStart}–{session.timeEnd}</span>
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-stone-400" />{session.going}/{session.seats} going</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Levels {session.levelMin}–{session.levelMax}</Badge>
            <Badge tone={full ? "warn" : left <= 3 ? "warn" : "neutral"}>{full ? "Waitlist" : `${left} seats left`}</Badge>
            <Badge tone="neutral">♂ {session.male} · ♀ {session.female}</Badge>
            {session.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------
   DISCOVER PAGE
---------------------------------------------------------------- */
function DiscoverPage({ openEvent, favorites, toggleFav, openAccountModal, go }) {
  const [featureInfo, setFeatureInfo] = useState(null);
  const [filters, setFilters] = useState({...defaultFilters});
  const [position, setPosition] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  function locate() {
    if (!navigator.geolocation) {setLocationMessage('Location is not supported by this browser.');return;}
    setLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(p=>{setPosition({latitude:p.coords.latitude,longitude:p.coords.longitude});setLocating(false);setLocationMessage('Distances are approximate, in a straight line.');},e=>{setLocating(false);setLocationMessage(e.code===1?'Location access denied. Enable it in your browser settings to find nearby sessions.':e.code===3?'Location request timed out. Please try again.':'Could not determine your location. Please try again.');setFilters(f=>({...f,radius:'any',sort:f.sort==='distance'?'smart':f.sort}));},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  }
  const filtered = useMemo(() => filterSessions(SESSIONS,filters,position), [filters,position]);

  const types = ["any", ...Array.from(new Set(SESSIONS.map((s) => s.type)))];

  return (
    <div>
      <section className="relative min-h-44 overflow-hidden bg-stone-900 sm:min-h-48">
        <div className="absolute inset-0 z-0">
          <Photo id={PHOTOS.hero} alt="Players on an indoor badminton court" className="h-full w-full" overlay={false} />
        </div>
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-stone-900 via-stone-900/75 to-stone-900/20" />
        <div className="relative z-10 flex min-h-44 max-w-lg flex-col justify-center px-4 py-6 sm:min-h-48 sm:px-8">
          <h1 className="jimmi-hero-title">Find your people.<br/><span>Play your game.</span></h1>
          <p className="jimmi-hero-description">Your badminton. Your community. All in one place.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="accent" onClick={() => document.getElementById("session-list")?.scrollIntoView({ behavior: "smooth" })}>
              <Search className="h-4 w-4" /> Find a session
            </Button>
          </div>
        </div>
      </section>

      <section className="jimmi-features" aria-label="Explore JimmiPlay features">
        <AutoScrollFeatures>
          {[
            {name:'Sessions',detail:'Find your next game',icon:Calendar,action:()=>document.getElementById('session-list')?.scrollIntoView({behavior:'smooth'})},
            {name:'Sports Passport',detail:'Your player journey',icon:Contact,action:()=>go('profile')},
            {name:'Levels',detail:'Find your level',icon:Layers,action:()=>setFeatureInfo(featureInfo==='levels'?null:'levels')},
            {name:'Clubs',detail:'Find your community',icon:Users,action:()=>go('clubs')},
            {name:'Rankings',detail:'Track your progress',icon:TrendingUp,action:()=>go('rankings')},
            {name:'Coaching',detail:'Learn and improve',icon:GraduationCap,action:()=>{setFilters(f=>({...f,type:'Coaching'}));document.getElementById('session-list')?.scrollIntoView({behavior:'smooth'});}},
            {name:'Shop',detail:'Shuttles & gear',icon:ShoppingBag,action:()=>setFeatureInfo(featureInfo==='shop'?null:'shop')},
            {name:'Tournaments',detail:'Rise to the challenge',icon:Trophy,action:()=>go('tournaments')},
          ].map(({name,detail,icon:Icon,action})=><button className="jimmi-feature" key={name} onClick={action}><span className="jimmi-feature-icon"><Icon size={25} strokeWidth={1.7}/></span><strong>{name}</strong><span className="jimmi-feature-detail">{detail}</span>{name==='Shop'&&<span className="jimmi-feature-soon">Coming soon</span>}</button>)}
        </AutoScrollFeatures>
        {featureInfo&&<div className="jimmi-feature-info"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{featureInfo==='levels'?'Find your level':'JimmiPlay Shop'}</h2><button aria-label="Close feature details" onClick={()=>setFeatureInfo(null)}><X size={18}/></button></div>{featureInfo==='levels'?<div className="jimmi-level-grid">{LEVELS.map(l=><div key={l.n}><strong>L{l.n} · {l.name}</strong><p>{l.detail}</p></div>)}</div>:<p>Shuttles and badminton gear, all in one place. The shop is coming soon.</p>}</div>}
      </section>

      <section id="session-list" className="discover-list">
        <h2 className="sr-only">Find badminton sessions</h2>
        <DiscoverFilters filters={filters} setFilters={setFilters} locate={locate} locating={locating} locationMessage={locationMessage} hasLocation={Boolean(position)} types={types}/>
        <div id="results" className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-500">No sessions match those filters. Try widening your search.</p>
          ) : filtered.map((s) => <SessionCard key={s.id} session={s} onOpen={openEvent} favorites={favorites} toggleFav={toggleFav} />)}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------
   EVENT DETAIL + PAYMENT
---------------------------------------------------------------- */
function EventDetailPage({ eventId, go, bookings, followedClubs, toggleFollow }) {
  const session = SESSIONS.find((s) => s.id === eventId) || SESSIONS[0];
  const left = seatsLeft(session);
  const full = left === 0;
  const isBooked = bookings.some((b) => b.id === session.id);
  const club = CLUBS.find((c) => c.name === session.club);
  const saved = club && followedClubs.includes(club.id);
  const roster = useMemo(() => rosterFor(session), [session]);
  const otherSessions = SESSIONS.filter((s) => s.club === session.club && s.id !== session.id);
  const [showRoster, setShowRoster] = useState(false);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <BackRow label="Back to discover" onBack={() => go("discover")} />
      <div className="relative">
        <Photo id={PHOTOS.session} alt={session.name} className="h-44 w-full rounded-xl sm:h-56" overlay={false} />
        <span className="absolute right-3 top-3"><Badge tone={full ? "warn" : "accent"}>{full ? "Waitlist" : "Spaces available"}</Badge></span>
      </div>

      <p className="mt-5 text-sm text-stone-500">{session.location} · {session.type}</p>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-stone-900">{session.name}</h1>
        <p className="shrink-0 text-2xl font-semibold text-stone-900">£{session.price}</p>
      </div>
      <p className="mt-1 text-sm text-stone-500">{session.date} · {session.timeStart}–{session.timeEnd} GMT+1</p>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-stone-200 p-3">
        {club ? (
          <button onClick={() => go("clubDetail", { clubId: club.id })} className="flex items-center gap-2 text-sm font-medium text-stone-900 hover:underline">
            <Building2 className="h-4 w-4 text-stone-400" />{session.club}
          </button>
        ) : <span className="text-sm text-stone-700">{session.club}</span>}
        {club && (
          <button onClick={() => toggleFollow(club.id)} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${saved ? "bg-yellow-100 text-yellow-800" : "border border-stone-300 text-stone-600 hover:bg-stone-50"}`}>
            <Heart className={`h-3.5 w-3.5 ${saved ? "fill-yellow-700" : ""}`} />{saved ? "Saved" : "Save club"}
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-3"><p className="text-xs text-stone-500">Level</p><p className="mt-1 text-sm font-medium">Levels {session.levelMin}–{session.levelMax}</p></Card>
        <Card className="p-3"><p className="text-xs text-stone-500">Courts</p><p className="mt-1 text-sm font-medium">{session.courts}</p></Card>
        <Card className="p-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-yellow-600" /><div><p className="text-xs text-stone-500">Reliability</p><p className="text-sm font-medium">{session.reliability}%</p></div></Card>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-900">Registered ({session.going}/{session.seats})</h2>
          <span className="text-xs text-stone-500">♂ {session.male} · ♀ {session.female}</span>
        </div>
        {!showRoster ? (
          <button onClick={() => setShowRoster(true)} className="mt-2 flex items-center gap-3">
            <div className="flex -space-x-2">
              {roster.slice(0, 8).map((p, i) => <Avatar key={i} initials={p.name.split(" ").map((w) => w[0]).join("")} />)}
              {roster.length > 8 && <div className="h-10 w-10 rounded-full bg-stone-100 flex items-center justify-center text-xs font-medium text-stone-500">+{roster.length - 8}</div>}
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-900">Show everyone's level <ChevronDown className="h-3.5 w-3.5" /></span>
          </button>
        ) : (
          <div className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200">
            {roster.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="flex items-center gap-2"><Avatar initials={p.name.split(" ").map((w) => w[0]).join("")} size={7} /><span className="text-stone-800">{p.name}</span></div>
                <span className="text-xs text-stone-500">Level {p.level} · {p.gender}</span>
              </div>
            ))}
            <button onClick={() => setShowRoster(false)} className="w-full px-3 py-2 text-center text-xs font-medium text-stone-500 hover:text-stone-900">Collapse</button>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-stone-900">Venue</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">{session.courts} · arrive 10 minutes early for warm-up and court allocation. Shuttles included.</p>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-stone-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />{VENUE_ADDRESS}</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-stone-200">
          <iframe title="Venue map" src={VENUE_MAP_EMBED} className="h-56 w-full" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-stone-900">Cancellations & refunds</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">Full refund if you cancel before {session.refundBy}. After that, seats can't be refunded but you can transfer your place to a friend from My bookings.</p>
      </div>

      {otherSessions.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-stone-900">More from {session.club}</h2>
          <div className="mt-2 space-y-2">
            {otherSessions.map((s) => (
              <button key={s.id} onClick={() => go("eventDetail", { eventId: s.id })} className="flex w-full items-center justify-between rounded-lg border border-stone-200 p-2.5 text-left hover:border-stone-300">
                <div><p className="text-sm font-medium text-stone-900">{s.name}</p><p className="text-xs text-stone-500">{s.date} · {s.timeStart}–{s.timeEnd}</p></div>
                <span className="text-xs text-stone-400">£{s.price}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {session.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
      </div>

      <div className="sticky bottom-16 md:bottom-0 mt-8 flex items-center justify-between rounded-xl border border-stone-200 bg-white p-4 shadow-lg">
        <div>
          <p className="text-xs text-stone-500">{full ? "Session full — join waitlist" : `${left} seats still open`}</p>
          <p className="text-lg font-semibold text-stone-900">£{session.price}</p>
        </div>
        {isBooked ? <Badge tone="accent">You're attending</Badge> : (
          <Button variant="accent" onClick={() => go("payment", { eventId: session.id })}>{full ? "Join waitlist" : "Attend"}</Button>
        )}
      </div>
    </div>
  );
}

function PaymentPage({ eventId, go, book }) {
  const session = SESSIONS.find((s) => s.id === eventId) || SESSIONS[0];
  const [step, setStep] = useState("review");
  const fee = Math.round(session.price * 0.05 * 100) / 100;
  const total = session.price + fee;
  const full = seatsLeft(session) === 0;

  if (step === "confirmed") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100"><Check className="h-7 w-7 text-yellow-700" /></div>
        <h1 className="mt-5 text-xl font-semibold text-stone-900">{full ? "Added to waitlist" : "Booking confirmed"}</h1>
        <p className="mt-2 text-sm text-stone-500">{session.name} · {session.date} at {session.timeStart}.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" onClick={() => go("eventDetail", { eventId: session.id })}>View session</Button>
          <Button variant="accent" onClick={() => go("bookings")}>Go to my bookings</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:px-8">
      <BackRow label="Back to session" onBack={() => go("eventDetail", { eventId: session.id })} />
      <h1 className="text-xl font-semibold text-stone-900">Confirm and pay</h1>
      <Card className="mt-5 p-4">
        <p className="font-medium text-stone-900">{session.name}</p>
        <p className="text-sm text-stone-500">{session.date} · {session.timeStart}–{session.timeEnd} · {session.club}</p>
        <div className="mt-4 space-y-2 border-t border-stone-100 pt-4 text-sm">
          <div className="flex justify-between text-stone-600"><span>Seat price</span><span>£{session.price.toFixed(2)}</span></div>
          <div className="flex justify-between text-stone-600"><span>Service fee</span><span>£{fee.toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold text-stone-900"><span>Total</span><span>£{total.toFixed(2)}</span></div>
        </div>
      </Card>
      <div className="mt-5">
        <h2 className="text-sm font-semibold text-stone-900">Payment method</h2>
        <Card className="mt-2 flex items-center gap-3 p-4">
          <CreditCard className="h-5 w-5 text-stone-400" />
          <div className="flex-1"><p className="text-sm font-medium text-stone-900">Visa ending 4242</p><p className="text-xs text-stone-500">Processed securely via Stripe</p></div>
          <Check className="h-4 w-4 text-yellow-600" />
        </Card>
      </div>
      <p className="mt-4 text-xs text-stone-400">No real payment is taken in this preview. Full refund available before {session.refundBy}.</p>
      <Button variant="accent" className="mt-6 w-full" onClick={() => { book(session.id); setStep("confirmed"); }}>
        {full ? "Join waitlist" : `Pay £${total.toFixed(2)}`}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------
   MY BOOKINGS
---------------------------------------------------------------- */
function BookingsPage({ bookings, cancel, go, openAccountModal }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">My bookings</h1>
        <button onClick={() => openAccountModal("history")} className="text-xs font-medium text-stone-500 hover:text-stone-900">Payment history →</button>
      </div>

      {bookings.length === 0 ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-stone-500">You don't have any upcoming bookings.</p>
          <Button variant="accent" className="mt-4" onClick={() => go("discover")}>Find a session</Button>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {bookings.map((b) => {
            const s = SESSIONS.find((x) => x.id === b.id);
            if (!s) return null;
            return (
              <Card key={b.id} className="flex items-center gap-4 p-4">
                <Photo id={PHOTOS.session} alt={s.name} className="h-16 w-16 rounded-lg shrink-0" overlay={false} />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-stone-900">{s.name}</p>
                  <p className="text-sm text-stone-500">{s.date} · {s.timeStart}–{s.timeEnd}</p>
                  <p className="text-xs text-stone-400">{s.club}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge tone="accent">Confirmed</Badge>
                  <button onClick={() => cancel(b.id)} className="text-xs text-stone-400 hover:text-red-600">Cancel</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   PROFILE — "Sports passport"
---------------------------------------------------------------- */
function ProfilePage({ bookings, go, followedClubs, openAccountModal }) {
  const u = CURRENT_USER;
  const myClubs = CLUBS.filter((c) => followedClubs.includes(c.id));
  const level = LEVELS.find((l) => l.n === u.level);
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <Badge tone="accent">Sports passport</Badge>
      <div className="mt-3 flex items-center gap-4">
        <button onClick={() => openAccountModal("settings")}><Avatar initials={u.initials} size={16} tone="white" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-stone-900">{u.name}</h1>
          <p className="text-sm text-stone-500">Badminton player · Level {u.level} ({level?.name})</p>
          <p className="text-xs text-stone-400">Home area: {u.homeArea} · Preferred format: {u.preferredFormat} · Reliability {u.reliability}</p>
        </div>
        <button onClick={() => openAccountModal("settings")} className="rounded-lg border border-stone-300 p-2 text-stone-500 hover:bg-stone-50"><Settings className="h-4 w-4" /></button>
      </div>

      <SectionCard title="Overview">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile value={u.stats.activities} label="Activities" />
          <StatTile value={u.stats.clubs} label="Clubs" />
          <StatTile value={`${u.stats.totalHours}h`} label="Total time" />
          <StatTile value={u.stats.noShows} label="No-shows" />
        </div>
      </SectionCard>

      <SectionCard title="Performance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile value={u.stats.wins} label="Wins" tone="yellow" />
          <StatTile value={u.stats.losses} label="Losses" tone="muted" />
          <StatTile value={`${u.stats.winRate}%`} label="Win rate" />
          <StatTile value={`#${u.stats.ranking}`} label="Ranking" />
        </div>
      </SectionCard>

      <SectionCard title="Achievements">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {u.achievements.map((a) => (
            <div key={a.label} className="flex items-center gap-3 rounded-lg border border-stone-200 p-3">
              <Award className="h-5 w-5 shrink-0 text-yellow-600" />
              <div><p className="text-sm font-medium text-stone-900">{a.label}</p><p className="text-xs text-stone-500">{a.detail}</p></div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={`Clubs you follow (${myClubs.length})`} action={<button onClick={() => openAccountModal("policies")} className="text-xs font-medium text-stone-500 hover:text-stone-900">Why follow? →</button>}>
        {myClubs.length === 0 ? (
          <p className="text-sm text-stone-500">You're not following any clubs yet — visit a club profile and tap "Join club".</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {myClubs.map((c) => (
              <button key={c.id} onClick={() => go("clubDetail", { clubId: c.id })} className="flex items-center gap-3 rounded-lg border border-stone-200 p-2.5 text-left hover:border-stone-300">
                <Photo id={PHOTOS.club} alt={c.name} className="h-10 w-10 rounded-md shrink-0" overlay={false} />
                <div><p className="text-sm font-medium text-stone-900">{c.name}</p><p className="text-xs text-stone-500">{c.location}</p></div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Upcoming events" action={<button onClick={() => go("bookings")} className="text-xs font-medium text-stone-500 hover:text-stone-900">See all →</button>}>
        {bookings.length === 0 ? <p className="text-sm text-stone-500">No upcoming bookings.</p> : (
          <div className="divide-y divide-stone-100">
            {bookings.map((b) => {
              const s = SESSIONS.find((x) => x.id === b.id);
              return s ? (
                <div key={b.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-stone-700">{s.name}</span><span className="text-stone-400">{s.date}</span>
                </div>
              ) : null;
            })}
          </div>
        )}
      </SectionCard>

      <button onClick={() => openAccountModal("methods")} className="mt-6 flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white p-4 text-left hover:border-stone-300">
        <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-stone-400" /><div><p className="text-sm font-medium text-stone-900">Payment & account settings</p><p className="text-xs text-stone-500">Payment methods, history, and policies</p></div></div>
        <ChevronRight className="h-4 w-4 text-stone-300" />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
   RANKINGS
---------------------------------------------------------------- */
function RankingsPage() {
  const [scope, setScope] = useState("local");
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <h1 className="text-xl font-semibold text-stone-900">Rankings</h1>
      <div className="mt-4 flex gap-2">
        {["local", "club"].map((s) => (
          <button key={s} onClick={() => setScope(s)} className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${scope === s ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"}`}>{s}</button>
        ))}
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-stone-200">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs text-stone-500">
            <tr><th className="px-4 py-2 font-medium">Rank</th><th className="px-4 py-2 font-medium">Player</th><th className="px-4 py-2 font-medium text-right">Matches</th><th className="px-4 py-2 font-medium text-right">Wins</th><th className="px-4 py-2 font-medium text-right">Win rate</th></tr>
          </thead>
          <tbody>
            {RANKINGS.map((p) => (
              <tr key={p.rank} className={`border-t border-stone-100 ${p.isUser ? "bg-yellow-50" : ""}`}>
                <td className="px-4 py-2.5 tabular-nums text-stone-500">{p.rank}</td>
                <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Avatar initials={p.initials} size={7} tone={p.isUser ? "accent" : "dark"} /><span className="font-medium text-stone-900">{p.name}</span></div></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-stone-500">{p.matches}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-stone-500">{p.wins}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{p.winRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CLUBS
---------------------------------------------------------------- */
function ClubsPage({ openClub, followedClubs }) {
  const myClubs = CLUBS.filter((c) => followedClubs.includes(c.id));
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <h1 className="text-xl font-semibold text-stone-900">Clubs</h1>

      <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Heart className="h-4 w-4 fill-yellow-600 text-yellow-600" />
          <h2 className="text-sm font-semibold text-stone-900">Clubs you follow ({myClubs.length})</h2>
        </div>
        {myClubs.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-600">You're not following any clubs yet — open a club below and tap "Join club" to keep it here.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {myClubs.map((c) => (
              <button key={c.id} onClick={() => openClub(c.id)} className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-white p-2 text-left hover:border-yellow-300">
                <Photo id={PHOTOS.club} alt={c.name} className="h-12 w-12 rounded-lg shrink-0" overlay={false} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">{c.name}</p>
                  <p className="text-xs text-stone-500">{c.location}</p>
                </div>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-stone-700"><Star className="h-3 w-3 fill-yellow-400 text-yellow-500" />{c.rating}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-stone-900">All clubs</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CLUBS.map((c) => {
          const isFollowing = followedClubs.includes(c.id);
          return (
            <Card key={c.id} onClick={() => openClub(c.id)} className="overflow-hidden">
              <Photo id={PHOTOS.club} alt={c.name} className="h-28 w-full" overlay={false}>
                {isFollowing && <span className="absolute left-2 top-2"><Badge tone="accent">Following</Badge></span>}
              </Photo>
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div><p className="font-semibold text-stone-900">{c.name}</p><p className="text-sm text-stone-500">{c.location}</p></div>
                  <span className="flex items-center gap-1 text-sm font-medium text-stone-900"><Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />{c.rating}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500"><span>{c.members} members</span><span>Season {c.season}</span><span>Club rank #{c.ranking}</span></div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
function ClubDetailPage({ clubId, go, followedClubs, toggleFollow }) {
  const club = CLUBS.find((c) => c.id === clubId) || CLUBS[0];
  const following = followedClubs.includes(club.id);
  const clubSessions = SESSIONS.filter((s) => s.club === club.name);
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <BackRow label="Back to clubs" onBack={() => go("clubs")} />
      <Photo id={PHOTOS.club} alt={club.name} className="h-40 w-full rounded-xl" overlay={false} />
      <div className="mt-5 flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-stone-900">{club.name}</h1><p className="mt-1 text-stone-500">{club.location}</p></div>
        <Button variant={following ? "secondary" : "accent"} onClick={() => toggleFollow(club.id)}>{following ? "Following ✓" : "Join club"}</Button>
      </div>

      <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5">
        <p className="text-xs font-semibold text-stone-500">What following gives you</p>
        <ul className="mt-1.5 space-y-1">
          {CLUB_BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-stone-600"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" />{b}</li>
          ))}
        </ul>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3"><p className="text-xs text-stone-500">Members</p><p className="mt-1 text-sm font-medium">{club.members}</p></Card>
        <Card className="p-3"><p className="text-xs text-stone-500">Rating</p><p className="mt-1 text-sm font-medium">{club.rating} / 5</p></Card>
        <Card className="p-3"><p className="text-xs text-stone-500">Season</p><p className="mt-1 text-sm font-medium">{club.season}</p></Card>
        <Card className="p-3"><p className="text-xs text-stone-500">Trust</p><p className="mt-1 text-sm font-medium">{club.trust} returning</p></Card>
      </div>
      <p className="mt-5 text-sm leading-6 text-stone-600">{club.description}</p>
      <h2 className="mt-6 text-sm font-semibold text-stone-900">Club schedule ({clubSessions.length})</h2>
      <div className="mt-2 space-y-2">
        {clubSessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between border-b border-stone-100 py-2 text-sm">
            <span className="text-stone-700">{s.name}</span><span className="text-stone-400">{s.date}</span>
          </div>
        ))}
      </div>
      <h2 className="mt-6 text-sm font-semibold text-stone-900">Tournament history</h2>
      <p className="mt-2 text-sm text-stone-600">{club.tournamentsHosted} tournaments hosted to date.</p>
    </div>
  );
}

/* ---------------------------------------------------------------
   TOURNAMENTS
---------------------------------------------------------------- */
function TournamentsPage({ openTournament, registeredTournaments }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="text-xl font-semibold text-stone-900">Tournaments</h1>
      <p className="mt-1 text-sm text-stone-500">Knockouts, ladders and cup days running across London clubs.</p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TOURNAMENTS.map((t) => {
          const open = t.status === "Open";
          const registered = registeredTournaments.includes(t.id);
          return (
            <Card key={t.id} onClick={() => openTournament(t.id)} className="overflow-hidden">
              <Photo id={PHOTOS.tournament} alt={t.name} className="h-32 w-full">
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="font-semibold text-white leading-tight">{t.name}</p>
                  <p className="text-xs text-stone-300">{t.location} · {t.dates}</p>
                </div>
                <span className="absolute right-2 top-2">
                  <Badge tone={registered ? "accent" : open ? "neutral" : "live"}>{registered ? "You're in ✓" : open ? "Open for entries" : "Closed"}</Badge>
                </span>
              </Photo>
              <div className="flex flex-wrap gap-1.5 p-3">
                <Badge tone="neutral">{t.format}</Badge>
                <Badge tone="neutral">{t.category}</Badge>
                <span className="inline-flex items-center rounded-md bg-stone-900 px-2 py-0.5 text-xs font-medium text-yellow-400">£{t.entryFee} entry</span>
                <Badge tone="neutral">{t.participants} players</Badge>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
function MatchBox({ match, highlight }) {
  const winnerA = match.done && match.scoreA > match.scoreB;
  const winnerB = match.done && match.scoreB > match.scoreA;
  return (
    <div className={`w-60 rounded-lg bg-white text-sm ${highlight ? "border-2 border-yellow-400" : "border border-stone-200"}`}>
      <div className={`flex items-center justify-between px-3 py-2.5 ${winnerA ? "bg-yellow-50" : ""}`}>
        <span className={`truncate ${winnerA ? "font-semibold text-stone-900" : "text-stone-600"}`}>{match.a}</span>
        <span className={`tabular-nums ${winnerA ? "font-semibold text-yellow-700" : "text-stone-400"}`}>{match.scoreA ?? "–"}</span>
      </div>
      <div className={`flex items-center justify-between border-t border-stone-100 px-3 py-2.5 ${winnerB ? "bg-yellow-50" : ""}`}>
        <span className={`truncate ${winnerB ? "font-semibold text-stone-900" : "text-stone-600"}`}>{match.b}</span>
        <span className={`tabular-nums ${winnerB ? "font-semibold text-yellow-700" : "text-stone-400"}`}>{match.scoreB ?? "–"}</span>
      </div>
    </div>
  );
}
function TournamentDetailPage({ tournamentId, go, registeredTournaments, toggleRegister }) {
  const t = TOURNAMENTS.find((x) => x.id === tournamentId) || TOURNAMENTS[0];
  const open = t.status === "Open";
  const registered = registeredTournaments.includes(t.id);
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <BackRow label="Back to tournaments" onBack={() => go("tournaments")} />
      <Photo id={PHOTOS.tournament} alt={t.name} className="h-48 w-full rounded-xl">
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-5">
          <div>
            <Badge tone={registered ? "accent" : open ? "neutral" : "live"}>{registered ? "You're registered" : open ? "Open for entries" : "Registration closed"}</Badge>
            <h1 className="mt-2 text-2xl font-semibold text-white">{t.name}</h1>
            <p className="text-sm text-stone-300">{t.location} · {t.dates}</p>
          </div>
        </div>
      </Photo>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">{t.format}</Badge>
          <Badge tone="neutral">{t.category}</Badge>
          <Badge tone="neutral">{t.participants} players</Badge>
        </div>
        {registered ? (
          <Button variant="secondary" onClick={() => toggleRegister(t.id)}>Registered ✓ — Withdraw</Button>
        ) : (
          <Button variant="accent" disabled={!open} onClick={() => toggleRegister(t.id)}>{open ? `Register · £${t.entryFee}` : "Closed"}</Button>
        )}
      </div>

      <h2 className="mt-8 text-sm font-semibold text-stone-900">Bracket</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-stone-50 p-5 pb-6">
        <div className="flex gap-8">
          {[{ title: "Quarterfinals", matches: BRACKET.quarterfinals }, { title: "Semifinals", matches: BRACKET.semifinals }, { title: "Final", matches: BRACKET.final, final: true }].map((round) => (
            <div key={round.title} className="flex flex-col justify-around gap-6">
              <span className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${round.final ? "bg-yellow-400 text-stone-900" : "bg-stone-200 text-stone-600"}`}>
                {round.final && <Trophy className="h-3 w-3" />} {round.title}
              </span>
              {round.matches.map((m, idx) => <MatchBox key={idx} match={m} highlight={round.final} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   SMART COURT ALLOCATION
---------------------------------------------------------------- */
function courtReducer(state, action) {
  switch (action.type) {
    case "REGENERATE": return { ...state, courts: allocateCourts(state.players, state.courtCount) };
    case "MOVE": {
      const { playerId, from, to } = action;
      if (from === to) return state;
      const courts = state.courts.map((c) => [...c]);
      const player = courts[from].find((p) => p.id === playerId);
      if (!player) return state;
      courts[from] = courts[from].filter((p) => p.id !== playerId);
      courts[to] = [...courts[to], player];
      return { ...state, courts };
    }
    case "SET_COURT_COUNT": return { ...state, courtCount: action.value, courts: allocateCourts(state.players, action.value) };
    default: return state;
  }
}
function CourtAllocationPage() {
  const [state, dispatch] = useReducer(courtReducer, { players: ALLOCATION_PLAYERS, courtCount: 4, courts: allocateCourts(ALLOCATION_PLAYERS, 4) });
  const [dragPlayer, setDragPlayer] = useState(null);
  const genderCount = (list, g) => list.filter((p) => p.gender === g).length;
  return (
    <div>
      <h2 className="text-sm font-semibold text-stone-900">Smart court allocation</h2>
      <p className="mt-1 text-sm text-stone-500">Balances courts by player level and gender. Drag a player onto another court to override, or regenerate.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-stone-600">Courts
          <select className="rounded-lg border border-stone-300 px-2 py-1 text-sm" value={state.courtCount} onChange={(e) => dispatch({ type: "SET_COURT_COUNT", value: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Button variant="outline" onClick={() => dispatch({ type: "REGENERATE" })}><Shuffle className="h-4 w-4" /> Regenerate</Button>
        <span className="text-xs text-stone-400">{state.players.length} players · M {genderCount(state.players, "M")} · F {genderCount(state.players, "F")}</span>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {state.courts.map((court, ci) => {
          const avgLevel = court.length ? (court.reduce((a, p) => a + p.level, 0) / court.length).toFixed(1) : "–";
          return (
            <div key={ci} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragPlayer) dispatch({ type: "MOVE", playerId: dragPlayer.id, from: dragPlayer.court, to: ci }); setDragPlayer(null); }} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold text-stone-900">Court {ci + 1}</p><Badge tone="neutral">avg lvl {avgLevel}</Badge></div>
              <div className="mt-2 space-y-1.5">
                {court.map((p) => (
                  <div key={p.id} draggable onDragStart={() => setDragPlayer({ id: p.id, court: ci })} className="flex cursor-grab items-center justify-between rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm active:cursor-grabbing">
                    <span className="text-stone-800">{p.name}</span><span className="flex items-center gap-1 text-xs text-stone-400">Lv {p.level} · {p.gender}</span>
                  </div>
                ))}
                {court.length === 0 && <p className="py-2 text-center text-xs text-stone-400">Drop a player here</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   SCORE ENTRY
---------------------------------------------------------------- */
function ScoreEntryPage() {
  const [teamA, setTeamA] = useState("Aisha Khan & Priya Nair");
  const [teamB, setTeamB] = useState("Marcus Webb & Sofia Reyes");
  const [scoreA, setScoreA] = useState(21);
  const [scoreB, setScoreB] = useState(17);
  const [submitted, setSubmitted] = useState([]);
  const [error, setError] = useState("");
  const submit = () => {
    if (!teamA.trim() || !teamB.trim()) { setError("Add both teams before submitting."); return; }
    if (scoreA === scoreB) { setError("Scores can't be tied — badminton games need a winner."); return; }
    setError("");
    setSubmitted((s) => [{ teamA, teamB, scoreA, scoreB, id: Date.now() }, ...s]);
  };
  return (
    <div className="max-w-xl">
      <h2 className="text-sm font-semibold text-stone-900">Record a match score</h2>
      <p className="mt-1 text-sm text-stone-500">Scores update player profiles, match history, and rankings automatically.</p>
      <Card className="mt-5 p-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input value={teamA} onChange={(e) => setTeamA(e.target.value)} className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm" placeholder="Team A players" />
            <div className="flex items-center gap-1.5">
              <button onClick={() => setScoreA((v) => Math.max(0, v - 1))} className="rounded-md border border-stone-300 p-1"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-8 text-center text-lg font-semibold tabular-nums">{scoreA}</span>
              <button onClick={() => setScoreA((v) => v + 1)} className="rounded-md border border-stone-300 p-1"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input value={teamB} onChange={(e) => setTeamB(e.target.value)} className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm" placeholder="Team B players" />
            <div className="flex items-center gap-1.5">
              <button onClick={() => setScoreB((v) => Math.max(0, v - 1))} className="rounded-md border border-stone-300 p-1"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-8 text-center text-lg font-semibold tabular-nums">{scoreB}</span>
              <button onClick={() => setScoreB((v) => v + 1)} className="rounded-md border border-stone-300 p-1"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <Button variant="accent" className="mt-4 w-full" onClick={submit}>Submit final score</Button>
      </Card>
      {submitted.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-stone-900">Recently submitted</h2>
          <div className="mt-2 space-y-2">
            {submitted.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm">
                <span className="text-stone-700">{m.teamA} vs {m.teamB}</span><span className="font-medium tabular-nums">{m.scoreA}–{m.scoreB}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   ORGANISER PORTAL — court allocation + score entry, in one place
---------------------------------------------------------------- */
function OrganiserPage() {
  const [tab, setTab] = useState("courts");
  const TABS = [
    { value: "courts", label: "Court allocation" },
    { value: "scores", label: "Record scores" },
  ];
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <Badge tone="accent">Organiser tools</Badge>
      <h1 className="mt-2 text-xl font-semibold text-stone-900">Organiser portal</h1>
      <p className="mt-1 text-sm text-stone-500">Run a session: balance courts by level and gender, then record final scores.</p>
      <div className="mt-4"><Tabs options={TABS} value={tab} onChange={setTab} /></div>
      <div className="mt-2">
        {tab === "courts" ? <CourtAllocationPage /> : <ScoreEntryPage />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ROOT APP
---------------------------------------------------------------- */
export default function FlashX() {
  const [view, setView] = useState("discover");
  const [createOpen, setCreateOpen] = useState(false);
  const [params, setParams] = useState({});
  const [bookings, setBookings] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [followedClubs, setFollowedClubs] = useState([]);
  const [registeredTournaments, setRegisteredTournaments] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([{ id: "pm1", brand: "Visa", last4: "4242", exp: "08/28", default: true }]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountModal, setAccountModal] = useState({ open: false, tab: "settings" });
  const [toast, setToast] = useState(null);

  const go = (v, p = {}) => { if(v === "create") { setCreateOpen(true); return; } setView(v); setParams(p); setNotifOpen(false); setAccountOpen(false); window.scrollTo(0, 0); };
  const book = (id) => setBookings((b) => (b.some((x) => x.id === id) ? b : [...b, { id }]));
  const cancel = (id) => setBookings((b) => b.filter((x) => x.id !== id));
  const toggleFav = (id) => setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const flashToast = (msg) => setToast(msg);

  const toggleFollow = (id) => {
    const club = CLUBS.find((c) => c.id === id);
    setFollowedClubs((f) => {
      const now = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      flashToast(now.includes(id) ? `You're now following ${club.name}` : `Unfollowed ${club.name}`);
      return now;
    });
  };
  const toggleRegister = (id) => {
    const t = TOURNAMENTS.find((x) => x.id === id);
    setRegisteredTournaments((r) => {
      const now = r.includes(id) ? r.filter((x) => x !== id) : [...r, id];
      flashToast(now.includes(id) ? `You're registered for ${t.name}` : `Withdrawn from ${t.name}`);
      return now;
    });
  };
  const openAccountModal = (tab = "settings") => { setAccountOpen(false); setNotifOpen(false); setAccountModal({ open: true, tab }); };
  const closeAccountModal = () => setAccountModal((m) => ({ ...m, open: false }));
  const addPaymentMethod = (m) => setPaymentMethods((list) => [...list, m]);
  const removePaymentMethod = (id) => setPaymentMethods((list) => {
    const removed = list.find((m) => m.id === id);
    const rest = list.filter((m) => m.id !== id);
    if (removed?.default && rest.length) rest[0].default = true;
    flashToast("Payment method removed");
    return rest;
  });
  const setDefaultMethod = (id) => setPaymentMethods((list) => list.map((m) => ({ ...m, default: m.id === id })));

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const titles = { discover: "Discover", clubs: "Clubs", rankings: "Rankings", tournaments: "Tournaments", bookings: "My bookings", profile: "Profile", organiser: "Organiser portal", eventDetail: "Session", payment: "Payment", clubDetail: "Club", tournamentDetail: "Tournament" };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <TopNav view={view} go={go} notifOpen={notifOpen} setNotifOpen={setNotifOpen} accountOpen={accountOpen} setAccountOpen={setAccountOpen} openAccountModal={openAccountModal} />
      <MobileHeader title={titles[view] || "JimmiPlay"} go={go} notifOpen={notifOpen} setNotifOpen={setNotifOpen} accountOpen={accountOpen} setAccountOpen={setAccountOpen} openAccountModal={openAccountModal} />

      {view === "discover" && <DiscoverPage go={go} openEvent={(id) => go("eventDetail", { eventId: id })} favorites={favorites} toggleFav={toggleFav} openAccountModal={openAccountModal} />}
      {view === "eventDetail" && <EventDetailPage eventId={params.eventId} go={go} bookings={bookings} followedClubs={followedClubs} toggleFollow={toggleFollow} />}
      {view === "payment" && <PaymentPage eventId={params.eventId} go={go} book={book} />}
      {view === "bookings" && <BookingsPage bookings={bookings} cancel={cancel} go={go} openAccountModal={openAccountModal} />}
      {view === "profile" && <ProfilePage bookings={bookings} go={go} followedClubs={followedClubs} openAccountModal={openAccountModal} />}
      {["about","contact","terms"].includes(view) && <InformationPage view={view} go={go}/>}
      {view === "levels" && <main className="mx-auto max-w-2xl px-4 py-6 sm:px-8"><BackRow label="Back to discover" onBack={()=>go('discover')}/><h1 className="text-2xl font-semibold">Badminton levels</h1><p className="mt-2 text-sm text-stone-500">Find the level that best describes your game.</p><div className="mt-5 space-y-3">{LEVELS.map(l=><section key={l.n} className="rounded-xl border border-stone-200 bg-white p-4"><div className="flex items-center gap-3"><Badge tone="accent">L{l.n}</Badge><h2 className="font-semibold">{l.name}</h2></div><p className="mt-2 text-sm text-stone-600">{l.detail}</p></section>)}</div></main>}
      {view === "rankings" && <RankingsPage />}
      {view === "clubs" && <ClubsPage openClub={(id) => go("clubDetail", { clubId: id })} followedClubs={followedClubs} />}
      {view === "clubDetail" && <ClubDetailPage clubId={params.clubId} go={go} followedClubs={followedClubs} toggleFollow={toggleFollow} />}
      {view === "tournaments" && <TournamentsPage openTournament={(id) => go("tournamentDetail", { tournamentId: id })} registeredTournaments={registeredTournaments} />}
      {view === "tournamentDetail" && <TournamentDetailPage tournamentId={params.tournamentId} go={go} registeredTournaments={registeredTournaments} toggleRegister={toggleRegister} />}
      {view === "organiser" && <OrganiserPage />}
      {view === "create-session" && <EventForm key="session" onBack={() => go("discover")} />}
      {view === "create-tournament" && <EventForm key="tournament" kind="tournament" onBack={() => go("discover")} />}
      {view === "create-club" && <ClubForm onBack={() => go("clubs")} />}
      {view === "coaching" && <CoachingFlow onBack={() => go("discover")} />}
      {createOpen && <CreateSheet onClose={() => setCreateOpen(false)} onChoose={kind => { setCreateOpen(false); go(kind === "coaching" ? "coaching" : `create-${kind}`); }} />}

      <AccountModal
        open={accountModal.open}
        initialTab={accountModal.tab}
        onClose={closeAccountModal}
        paymentMethods={paymentMethods}
        addPaymentMethod={addPaymentMethod}
        removePaymentMethod={removePaymentMethod}
        setDefaultMethod={setDefaultMethod}
        flashToast={flashToast}
      />

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl md:bottom-6">
          <span className="text-yellow-400">●</span> {toast}
        </div>
      )}

      <div className="h-16 md:hidden" />
      <BottomNav view={view} go={go} />
    </div>
  );
}
