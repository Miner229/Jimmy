import React from "react";
import { CalendarDays, Contact, GraduationCap, Layers3, ShoppingBag, Trophy, Users, Wrench } from "lucide-react";
import "./coming-soon.css";

const features = [
  [CalendarDays, "Sessions"], [Contact, "Sports Passport"], [Layers3, "Levels"], [Users, "Clubs"],
  [Trophy, "Rankings"], [GraduationCap, "Coaching"], [ShoppingBag, "Shop"], [Wrench, "Play Tools"],
];

export default function ComingSoon() {
  return <main className="cover-page">
    <div className="cover-glow" aria-hidden="true" />
    <div className="cover-court" aria-hidden="true"><i/><i/><i/><i/></div>
    <header className="cover-header">
      <span className="cover-logo"><img src="/branding/jimmiplay-logo-dark.jpg" alt="JimmiPlay" /></span>
      <a href="mailto:Hello@jimmiplay.com">Hello@jimmiplay.com</a>
    </header>
    <section className="cover-hero">
      <p className="cover-kicker">A new home for badminton</p>
      <h1>Find your people.<br/><span>Play your game.</span></h1>
      <p className="cover-copy">Sessions, clubs, coaching, rankings and everything you need to keep playing — together in one place.</p>
      <div className="cover-coming"><span/>Coming soon</div>
    </section>
    <section className="cover-features" aria-label="JimmiPlay features">
      {features.map(([Icon,label])=><div key={label}><Icon size={20}/><span>{label}</span></div>)}
    </section>
    <footer><span>Built for players, coaches and organisers.</span><span>© {new Date().getFullYear()} JimmiPlay</span></footer>
  </main>;
}
