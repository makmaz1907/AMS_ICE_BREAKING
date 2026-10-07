import { FormEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { EventLogo, Logo, PoweredBy } from "../Brand";
import { post, useGame, useRemainingSeconds } from "../game";
import type { GameState, Team } from "../types";

type HostAction = "start" | "finish" | "pause" | "add-time" | "reset" | "lobby" | "approval" | "live-result" | "approve" | "reject" | "remove" | "approve-all";
type Command = (action: HostAction, extra?: object) => void;
const hostTokenKey = "bkb-host-token";
function savedHostToken() { try { return sessionStorage.getItem(hostTokenKey); } catch { return null; } }
function saveHostToken(token: string | null) { try { if (token) sessionStorage.setItem(hostTokenKey, token); else sessionStorage.removeItem(hostTokenKey); } catch { /* storage blocked: the PIN is asked again after a reload */ } }
// Phones can't reach "localhost", so in local dev the QR code asks the dev server for this machine's LAN address.
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

// Removing a team takes two clicks: the first turns the button into "Emin misiniz?" for a few seconds.
function Scoreboard({ teams, command }: { teams: Team[]; command: Command }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { if (!confirming) return; const timer = window.setTimeout(() => setConfirming(null), 4_000); return () => window.clearTimeout(timer); }, [confirming]);
  // Animated ranking: rows slide to their new place (FLIP with the Web Animations API) and a "+N" bubble rises next to each new score.
  const rows = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const scores = useRef(new Map<string, number>());
  const [gains, setGains] = useState<Record<string, number>>({});
  const gainTimer = useRef(0);
  useLayoutEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    rows.current.forEach((row, id) => {
      const top = row.getBoundingClientRect().top;
      const before = tops.current.get(id);
      next.set(id, top);
      if (!still && before !== undefined && before !== top) row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    tops.current = next;
  }, [teams]);
  useEffect(() => {
    const fresh: Record<string, number> = {};
    for (const team of teams) { const before = scores.current.get(team.id); if (before !== undefined && team.score > before) fresh[team.id] = team.score - before; scores.current.set(team.id, team.score); }
    if (!Object.keys(fresh).length) return;
    setGains(fresh);
    // Kept in a ref: a later state update without new points must not cancel the timer and leave the bubbles on screen.
    window.clearTimeout(gainTimer.current);
    gainTimer.current = window.setTimeout(() => setGains({}), 2_400);
  }, [teams]);
  useEffect(() => () => window.clearTimeout(gainTimer.current), []);
  return <aside className="panel rounded-3xl p-6"><p className="eyebrow">Canlı skor</p>{teams.length ? <ol className="mt-5 space-y-3">{teams.map((team, index) => <li className="group relative flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3" key={team.id} ref={(row) => { if (row) rows.current.set(team.id, row); else rows.current.delete(team.id); }}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${index === 0 && team.score > 0 ? "bg-brand-yellow text-navy" : "bg-future text-white"}`}>{index + 1}</span><span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span><button className={`btn btn-sm ${confirming === team.id ? "bg-brand-red text-white" : "text-white/50 opacity-0 hover:text-brand-orange focus:opacity-100 group-hover:opacity-100"}`} onClick={() => { if (confirming === team.id) { setConfirming(null); command("remove", { teamId: team.id }); } else setConfirming(team.id); }} type="button">{confirming === team.id ? "Emin misiniz?" : "Çıkar"}</button><strong className={`text-3xl tabular-nums text-turquoise ${gains[team.id] ? "score-pop" : ""}`} key={`${team.id}-${team.score}`}>{team.score}</strong>{gains[team.id] ? <span className="score-gain">+{gains[team.id]}</span> : null}</li>)}</ol> : <p className="mt-5 text-white/55">Henüz takım yok. QR kodu okutan takımlar burada görünecek.</p>}</aside>;
}

// The host screen is usually the projector, so names waiting for approval stay hidden until the host chooses to show them.
function Approvals({ state, command, lobby }: { state: GameState; command: Command; lobby: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const pending = state.pendingTeams ?? [];
  if (!lobby && !pending.length) return null;
  return <section className="panel rounded-3xl p-6"><div className="flex flex-wrap items-center justify-between gap-3"><p className="eyebrow">Katılım onayı</p>{lobby && <button className={`btn btn-sm ${state.approvalRequired ? "btn-blue" : "btn-ghost"}`} onClick={() => command("approval", { enabled: !state.approvalRequired })} type="button">Host onayı: {state.approvalRequired ? "Açık" : "Kapalı"}</button>}</div>{pending.length ? <><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span><strong className="text-3xl text-brand-yellow">{pending.length}</strong> takım onay bekliyor</span><div className="flex gap-2"><button className="btn btn-ghost btn-sm" onClick={() => setRevealed(!revealed)} type="button">{revealed ? "Gizle" : "Göster"}</button><button className="btn btn-primary btn-sm" onClick={() => command("approve-all")} type="button">Tümünü onayla</button></div></div>{revealed && <ul className="mt-4 space-y-2">{pending.map((team) => <li className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-2" key={team.id}><span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span><button className="btn btn-sm bg-brand-green text-navy" onClick={() => command("approve", { teamId: team.id })} type="button">Onayla</button><button className="btn btn-sm border border-brand-orange text-brand-orange" onClick={() => command("reject", { teamId: team.id })} type="button">Reddet</button></li>)}</ul>}</> : <p className="mt-4 text-sm text-white/55">{state.approvalRequired ? "Onay bekleyen takım yok." : "Takımlar onaysız katılıyor."}</p>}</section>;
}

// A destructive action takes two clicks: the first turns the button into "Emin misiniz?" for a few seconds.
function ConfirmButton({ label, onConfirm, className = "btn btn-ghost btn-sm" }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const timer = window.setTimeout(() => setArmed(false), 4_000); return () => window.clearTimeout(timer); }, [armed]);
  return <button className={armed ? "btn btn-sm bg-brand-red text-white" : className} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }} type="button">{armed ? "Emin misiniz?" : label}</button>;
}

// Shown on every screen after the lobby, so the host can always get back to the QR code.
function ExitActions({ command }: { command: Command }) {
  return <div className="flex flex-wrap gap-2"><ConfirmButton label="Lobiye dön" onConfirm={() => command("lobby")} /><ConfirmButton label="Oyunu sıfırla" onConfirm={() => command("reset")} /></div>;
}

// Lobby settings that apply to the whole game.
function Settings({ state, command }: { state: GameState; command: Command }) {
  return <section className="panel rounded-3xl p-6"><p className="eyebrow">Oyun ayarları</p><div className="mt-4 flex items-center justify-between gap-4"><div><p className="font-semibold">İşlem turunda ara sonuç</p><p className="text-sm text-white/55">Telefonlar yazılan işlemin sonucunu ve hedefe uzaklığını anlık gösterir.</p></div><button className={`btn btn-sm ${state.liveResult ? "btn-blue" : "btn-ghost"}`} onClick={() => command("live-result", { enabled: !state.liveResult })} type="button">{state.liveResult ? "Açık" : "Kapalı"}</button></div></section>;
}

// Bottom strip of the lobby and game screens: the LE AMS event mark on the left (the lobby already shows it large), "powered by aXet" on the right.
function Footer({ event = true }: { event?: boolean }) {
  return <footer className="mt-auto flex items-end justify-between gap-6 pt-10">{event ? <EventLogo className="h-12 w-auto lg:h-14" /> : <span />}<PoweredBy className="h-10 w-auto opacity-90 lg:h-14" /></footer>;
}

// Logo, the round label and the screen title; the right side holds the timer or the screen's main actions.
function Header({ eyebrow, title, children }: { eyebrow: ReactNode; title: string; children?: ReactNode }) {
  return <header className="mb-8 flex flex-wrap items-center justify-between gap-6"><div className="flex items-center gap-6"><Logo className="h-14 w-auto lg:h-20" /><div className="border-l border-white/15 pl-6"><p className="eyebrow">{eyebrow}</p><h1 className="font-serif text-3xl font-bold lg:text-5xl">{title}</h1></div></div>{children}</header>;
}

export function HostPage() {
  const [pin, setPin] = useState("");
  const [token, setToken] = useState(savedHostToken);
  const [error, setError] = useState("");
  const { state, serverNow } = useGame({ token, onUnauthorized: () => { saveHostToken(null); setToken(null); setError("Host oturumunun süresi doldu. PIN'i yeniden girin."); } });
  const [joinUrl, setJoinUrl] = useState(`${window.location.origin}/join`);
  const remaining = useRemainingSeconds(state, serverNow);
  useEffect(() => { if (isLocalHost) fetch(`/api/join-url?port=${window.location.port || "80"}`).then((response) => response.json()).then(({ url }) => setJoinUrl(url)).catch(() => undefined); }, []);
  async function authenticate(event: FormEvent) { event.preventDefault(); const result = await post<{ token: string }>("/api/host-login", { pin }); if (result.ok) { saveHostToken(result.token); setToken(result.token); setError(""); } else setError(result.message ?? "PIN doğrulanamadı."); }
  function command(action: HostAction, extra: object = {}) { post("/api/host-command", { action, ...extra }, token).then((result) => { if (result.status === 401) { saveHostToken(null); setToken(null); } setError(result.ok ? "" : result.message ?? "Komut uygulanamadı."); }); }
  const notice = error ? <p className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-brand-red px-6 py-3 font-semibold text-white shadow-2xl">{error}</p> : null;
  if (!token) return <main className="app-shell flex min-h-screen items-center justify-center p-6"><form className="panel w-full max-w-md rounded-3xl p-10" onSubmit={authenticate}><Logo className="mx-auto w-56" /><EventLogo className="mx-auto mt-1 h-12 w-auto" /><p className="eyebrow mt-6 text-center">Host girişi</p><h1 className="mt-2 text-center font-serif text-4xl font-bold">Bir Kelime Bir İşlem</h1><label className="mt-8 block text-sm font-semibold text-white/75" htmlFor="host-pin">Host PIN</label><input autoFocus className="field mt-2" id="host-pin" onChange={(event) => setPin(event.target.value)} type="password" value={pin} />{error && <p className="mt-3 text-brand-orange">{error}</p>}<button className="btn btn-primary mt-6 w-full">Giriş yap</button><PoweredBy className="mx-auto mt-8 h-7 w-auto opacity-90" /></form></main>;
  const isActive = state.phase === "word" || state.phase === "number";
  // The countdown turns to the brand's attention colours in the last seconds.
  const urgency = remaining <= 5 ? "text-brand-orange" : remaining <= 10 ? "text-brand-yellow" : "text-turquoise";
  const barColor = remaining <= 5 ? "bg-brand-orange" : remaining <= 10 ? "bg-brand-yellow" : "bg-gradient-to-r from-future to-turquoise";
  if (isActive && state.round) return <main className="app-shell flex min-h-screen flex-col p-6 lg:p-10"><Header eyebrow={`${state.matchRound}. tur / ${state.totalRounds} · ${state.round.type === "word" ? "Kelime" : "İşlem"}`} title={state.round.type === "word" ? "Bir Kelime" : "Bir İşlem"}><div className="text-right">{state.paused && <p className="eyebrow text-brand-yellow">Süre durduruldu</p>}<strong className={`font-serif text-7xl tabular-nums lg:text-8xl ${urgency}`}>{remaining}</strong><span className="ml-2 text-2xl text-white/55">sn</span></div></Header><div className="h-3 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full transition-[width] duration-300 ${barColor}`} style={{ width: `${(remaining / state.round.durationSeconds) * 100}%` }} /></div><div className="mt-8 grid gap-8 xl:grid-cols-[1fr_380px]"><section className="panel rounded-3xl p-8 text-center lg:p-12">{state.round.type === "word" ? <><p className="eyebrow">En uzun kelimeyi bulun · ★ joker herhangi bir harfin yerine geçer</p><div className="mt-8 flex flex-wrap justify-center gap-4">{state.round.letters.map((letter, index) => <span className="tile tile-pop h-24 w-20 text-5xl 2xl:h-28 2xl:w-24 2xl:text-6xl" key={`${state.round!.id}-${index}`} style={{ animationDelay: `${index * 70}ms` }}>{letter}</span>)}<span className="tile-joker tile-pop h-24 w-20 text-4xl 2xl:h-28 2xl:w-24 2xl:text-5xl" style={{ animationDelay: `${state.round.letters.length * 70}ms` }}>★</span></div></> : <><p className="eyebrow">Sayıları kullanarak hedefe ulaşın · en yakın takım en çok puanı alır</p><div className="mt-8 flex flex-wrap justify-center gap-4">{state.round.numbers.map((number, index) => <span className="tile tile-pop h-24 w-20 text-4xl 2xl:h-28 2xl:w-24 2xl:text-5xl" key={`${state.round!.id}-${index}`} style={{ animationDelay: `${index * 70}ms` }}>{number}</span>)}</div><p className="eyebrow mt-12">Hedef sayı</p><strong className="mt-2 block font-serif text-8xl text-turquoise lg:text-9xl">{state.round.target}</strong>{state.round.description && <p className="mt-4 text-white/75">{state.round.description}</p>}</>}<div className="mt-12 flex flex-wrap justify-center gap-3"><button className="btn btn-ghost" onClick={() => command("pause")}>{state.paused ? "Süreyi devam ettir" : "Süreyi durdur"}</button><button className="btn btn-ghost" onClick={() => command("add-time", { seconds: 15 })}>15 sn ekle</button>{state.round.type === "number" && <button className="btn btn-ghost" onClick={() => command("live-result", { enabled: !state.liveResult })}>{state.liveResult ? "Ara sonucu gizle" : "Ara sonucu göster"}</button>}<button className="btn btn-primary" onClick={() => command("finish")}>Turu bitir</button></div><div className="mt-6 flex justify-center"><ExitActions command={command} /></div></section><div className="space-y-8"><Approvals command={command} lobby={false} state={state} /><Scoreboard command={command} teams={state.teams} /></div></div><Footer />{notice}</main>;
  if (state.phase === "round-results") return <main className="app-shell flex min-h-screen flex-col p-6 lg:p-10"><Header eyebrow={`${state.matchRound}. tur sonucu`} title="Cevaplar"><div className="flex flex-wrap items-center gap-3"><ExitActions command={command} /><button className="btn btn-primary px-8 py-4 text-lg" onClick={() => command("start")}>Sonraki turu başlat</button></div></Header><div className="grid gap-8 xl:grid-cols-[1fr_380px]"><section className="panel rounded-3xl p-6 lg:p-8">{state.themedWord && <p className="mb-5 rounded-2xl border-l-4 border-turquoise bg-future/20 p-4">Gizli kelime: <strong className="text-turquoise">{state.themedWord}</strong></p>}{state.numberSolution && <p className="mb-5 rounded-2xl border-l-4 border-turquoise bg-future/20 p-4">En iyi çözüm: <strong className="font-serif text-xl text-turquoise">{state.numberSolution}</strong></p>}{state.submissions.length ? state.submissions.map((item) => <div className="border-b border-white/10 py-4 last:border-0" key={`${item.teamId}-${item.answer}`}><div className="flex flex-wrap items-center gap-4"><span className="min-w-0 flex-1 truncate text-white/75">{item.teamName}</span><strong className="font-serif text-2xl tracking-wide">{item.answer}{item.value !== undefined ? ` = ${item.value}` : ""}</strong><span className={`rounded-full px-3 py-1 text-sm font-semibold ${item.status === "accepted" ? "bg-brand-green/15 text-brand-green" : "bg-brand-orange/15 text-brand-orange"}`}>{item.status === "accepted" ? (item.meanings ? "TDK doğruladı" : "Geçerli") : "Reddedildi"}</span><strong className="w-16 text-right text-2xl tabular-nums text-turquoise">+{item.score}</strong></div>{item.status === "accepted" && item.meanings?.length ? <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-white/65">{item.meanings.map((meaning, index) => <li key={`${item.teamId}-${item.answer}-${index}`}>{meaning}</li>)}</ol> : null}</div>) : <p className="text-white/55">Bu turda kabul edilen cevap yok.</p>}</section><div className="space-y-8"><Approvals command={command} lobby={false} state={state} /><Scoreboard command={command} teams={state.teams} /></div></div><Footer />{notice}</main>;
  // Podium order on screen: 2nd, 1st, 3rd, with the winner in the attention-grabbing yellow.
  const podium = [{ team: state.teams[1], place: 2, style: "h-32 bg-future text-white" }, { team: state.teams[0], place: 1, style: "h-44 bg-brand-yellow text-navy" }, { team: state.teams[2], place: 3, style: "h-24 bg-future-150 text-white" }];
  if (state.phase === "game-results") return <main className="app-shell flex min-h-screen items-center justify-center p-6"><section className="panel confetti w-full max-w-5xl rounded-3xl p-8 text-center lg:p-10"><Logo className="mx-auto w-44" /><EventLogo className="mx-auto mt-1 h-11 w-auto" /><p className="eyebrow mt-6">Oyun tamamlandı</p><h1 className="mt-3 font-serif text-5xl font-bold lg:text-6xl">Kazanan: <span className="text-brand-yellow">{state.winner?.name ?? "—"}</span></h1><div className="mt-8 grid grid-cols-3 items-end gap-4">{podium.map(({ team, place, style }) => <div className="flex flex-col items-center" key={place}>{team && <><strong className="max-w-full truncate text-xl lg:text-2xl">{team.name}</strong><span className="mt-1 text-white/65">{team.score} puan</span></>}<div className={`mt-4 flex w-full items-start justify-center rounded-t-3xl pt-4 font-serif text-5xl font-bold ${team ? style : "h-16 bg-white/5 text-white/25"}`}>{place}</div></div>)}</div><div className="mt-8 flex flex-wrap justify-center gap-3"><a className="btn btn-ghost" href="/api/results.csv">Sonuçları CSV indir</a><a className="btn btn-ghost" href="/api/results.json">Sonuçları JSON indir</a><button className="btn btn-primary" onClick={() => command("start")}>Yeni oyun başlat</button></div><div className="mt-4 flex justify-center"><ExitActions command={command} /></div><PoweredBy className="mx-auto mt-8 h-8 w-auto opacity-90" /></section>{notice}</main>;
  return <main className="app-shell flex min-h-screen flex-col p-6 lg:p-10"><Header eyebrow={<span lang="en">Kurumsal ice breaker</span>} title="Bir Kelime Bir İşlem"><div className="flex gap-3"><ConfirmButton className="btn btn-ghost" label="Oyunu sıfırla" onConfirm={() => command("reset")} /><button className="btn btn-primary px-8" onClick={() => command("start")}>Oyunu başlat</button></div></Header><div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]"><section className="panel flex flex-col items-center rounded-3xl p-8 text-center lg:p-10"><EventLogo className="mb-8 h-20 w-auto lg:h-24" /><p className="eyebrow">Telefonunuzla katılın</p><h2 className="mt-2 text-2xl font-semibold">QR kodu okutun, takımınıza bir ad verin</h2><div className="mt-8 rounded-3xl bg-white p-5 shadow-2xl ring-8 ring-future/40"><QRCodeSVG fgColor="#070F26" includeMargin={false} size={260} value={joinUrl} /></div><p className="mt-8 text-sm text-white/55">veya şu adrese gidin</p><p className="mt-1 break-all text-lg font-semibold text-turquoise">{joinUrl}</p></section><div className="space-y-8"><Settings command={command} state={state} /><Approvals command={command} lobby state={state} /><Scoreboard command={command} teams={state.teams} /></div></div><Footer event={false} />{notice}</main>;
}
