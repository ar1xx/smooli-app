import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { sget, sset, authRegister, authLogin, authLogout, getUser } from "./storage.js";

/* ============================================================
   SMOOLI — слушать музыку вместе
   Design tokens:
   --bg-0:#0A0A0C  --bg-1:#141416  --bg-2:#1C1C20  --line: rgba(255,255,255,.08)
   --amber:#E8B94E  --amber-soft: rgba(232,185,78,.18)
   --text:#F1F1F3  --muted:#8B8B93
   Light theme: --bg-0:#FFFDF6 --bg-1:#FFF8E6 --bg-2:#FFF2D1 --text:#221D0F --muted:#8A7E5C
   Fonts: display "Space Grotesk", body "Inter"
   Signature: liquid-glass dock + specular play-bar, real Socket.IO sync (no polling)
   ============================================================ */

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap";

function useInjectFonts() {
  useEffect(() => {
    if (document.getElementById("smooli-fonts")) return;
    const l = document.createElement("link");
    l.id = "smooli-fonts";
    l.rel = "stylesheet";
    l.href = FONT_LINK;
    document.head.appendChild(l);
  }, []);
}

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

function getToken() {
  try {
    const raw = window.sessionStorage.getItem("smooli:session");
    if (raw) return JSON.parse(raw)?.token;
  } catch {}
  return null;
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getTrackTrimValue(track, duration, key) {
  const raw = track?.[key];
  if (raw === null || raw === undefined || raw === "") {
    return key === "trimEndSec" ? duration : 0;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return key === "trimEndSec" ? duration : 0;
  if (track?.[key] !== undefined && track?.[key] !== null) {
    if (key === "trimStartSec" && track?.trimStartSec !== undefined && track?.trimStartSec !== null) return numeric;
    if (key === "trimEndSec" && track?.trimEndSec !== undefined && track?.trimEndSec !== null) return numeric;
  }
  if (duration > 0 && numeric <= 100) return (numeric / 100) * duration;
  return numeric;
}

function getFadeVolume(track, currentTime, duration) {
  if (!track || !duration) return 1;
  const start = getTrackTrimValue(track, duration, "trimStartSec");
  const end = getTrackTrimValue(track, duration, "trimEndSec");
  const length = Math.max(0, end - start);
  if (length <= 0) return 1;
  const rel = Math.max(0, Math.min(currentTime - start, length));
  const fadeAmount = Math.min(3, length / 2);
  let volume = 1;
  if (track.fadeIn && rel < fadeAmount) {
    volume = rel / Math.max(1, fadeAmount);
  }
  if (track.fadeOut && rel > length - fadeAmount) {
    volume = Math.min(volume, (length - rel) / Math.max(1, fadeAmount));
  }
  return Math.max(0, Math.min(1, volume));
}

const THEMES = {
  dark: {
    bg0: "#0A0A0C", bg1: "#141416", bg2: "#1C1C20", bg3: "#232327",
    line: "rgba(255,255,255,.09)", text: "#F1F1F3", muted: "#6B7280",
    amber: "#E8B94E", amberSoft: "rgba(232,185,78,.16)", danger: "#E5697A",
    glassFrom: "rgba(255,255,255,.10)", glassTo: "rgba(255,255,255,.02)",
  },
  light: {
    bg0: "#FFFDF6", bg1: "#FFF7E3", bg2: "#FCEFC9", bg3: "#F7E6AE",
    line: "rgba(60,50,10,.12)", text: "#221D0F", muted: "#6B7280",
    amber: "#C99A26", amberSoft: "rgba(201,154,38,.18)", danger: "#B3384A",
    glassFrom: "rgba(255,255,255,.55)", glassTo: "rgba(255,255,255,.10)",
  },
};

const STR = {
  ru: {
    login: "Вход", nickname: "Никнейм", password: "Пароль", ready: "Готово",
    createAccount: "Ещё нет аккаунта? Создать", haveAccount: "Уже есть аккаунт? Войти",
    myMusic: "Моя музыка", friends: "Друзья", invites: "Приглашения", settings: "Настройки",
    addTrack: "Добавить трек", createRoom: "Создать руму", albums: "Альбомы", tracks: "Треки",
    editTrack: "Изменить трек", editCover: "Изменить обложку", addToAlbum: "Добавить в альбом",
    deleteTrack: "Удалить трек", deleteFriend: "Удалить из друзей", cancel: "Отмена", save: "Сохранить",
    addFriend: "Добавить друга", searchUsername: "Введите никнейм", search: "Искать", sentRequest: "Отправлено", invite: "Пригласить",
    noInvites: "Пока нет приглашений", noFriends: "Пока нет друзей",
    language: "Язык", theme: "Тема", logout: "Выйти из аккаунта", support: "Поддержать автора",
    suggestion: "Предложить идею", sendIdea: "Отправить идею", thanksIdea: "Спасибо! Идея сохранена.",
    leaveRoom: "Выйти", joined: "в руме", mix: "Микс румы", play: "Играть", pause: "Пауза",
    accept: "Принять", decline: "Отклонить", newAlbum: "Новый альбом", albumName: "Название альбома",
    emptyMusic: "Пока нет треков. Добавьте первый трек.", noAlbums: "Пока нет альбомов.", clickAlbumToOpen: "Нажмите на альбом, чтобы открыть его и добавить трек.", nicknameHint: "4–16 символов, латиница",
    wrongCreds: "Неверный никнейм или пароль", takenNick: "Этот никнейм уже занят",
    invalidNick: "Никнейм должен быть 4–16 латинских символов",
    fadeIn: "Появление звука",
    fadeOut: "Затухание звука",
    resetTrim: "Сбросить обрезку",
    trimHint: "Перетащите ползунки, чтобы задать начало и конец трека."
  },
  en: {
    login: "Sign in", nickname: "Nickname", password: "Password", ready: "Done",
    createAccount: "No account? Create one", haveAccount: "Have an account? Sign in",
    myMusic: "My music", friends: "Friends", invites: "Invites", settings: "Settings",
    addTrack: "Add track", createRoom: "Create room", albums: "Albums", tracks: "Tracks",
    editTrack: "Edit track", editCover: "Edit cover", addToAlbum: "Add to album",
    deleteTrack: "Delete track", deleteFriend: "Remove friend", cancel: "Cancel", save: "Save",
    addFriend: "Add friend", searchUsername: "Enter nickname", search: "Search", sentRequest: "Sent", invite: "Invite",
    noInvites: "No invites yet", noFriends: "No friends yet",
    language: "Language", theme: "Theme", logout: "Log out", support: "Support the author",
    suggestion: "Suggest an idea", sendIdea: "Send idea", thanksIdea: "Thanks! Idea saved.",
    leaveRoom: "Leave", joined: "in room", mix: "Room mix", play: "Play", pause: "Pause",
    accept: "Accept", decline: "Decline", newAlbum: "New album", albumName: "Album name",
    emptyMusic: "No tracks yet. Add your first track.", noAlbums: "No albums yet.", clickAlbumToOpen: "Click an album to open it and add a track.", nicknameHint: "4-16 latin characters",
    wrongCreds: "Wrong nickname or password", takenNick: "This nickname is taken",
    invalidNick: "Nickname must be 4-16 latin characters",
    fadeIn: "Fade in",
    fadeOut: "Fade out",
    resetTrim: "Reset trim",
    trimHint: "Drag the sliders to set the track start and end."
  },
};

/* ---------- small UI atoms ---------- */

function GlassButton({ children, onClick, style, active, danger, disabled, t }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onClick={onClick}
      style={{
        fontFamily: "'Inter',sans-serif",
        fontWeight: 600,
        fontSize: 14,
        color: danger ? t.danger : active ? t.bg0 : t.text,
        background: active
          ? `linear-gradient(180deg, ${t.amber}, ${t.amber})`
          : `linear-gradient(180deg, ${t.glassFrom}, ${t.glassTo})`,
        border: `1px solid ${t.line}`,
        borderRadius: 14,
        padding: "10px 16px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        boxShadow: pressed
          ? "inset 0 2px 6px rgba(0,0,0,.35)"
          : "0 1px 0 rgba(255,255,255,.12) inset, 0 6px 14px rgba(0,0,0,.18)",
        transform: pressed ? "scale(0.96) translateY(1px)" : "scale(1)",
        transition: "transform .12s ease, box-shadow .12s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GlassCard({ children, style, t, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: `linear-gradient(160deg, ${t.glassFrom}, ${t.glassTo})`,
        border: `1px solid ${t.line}`,
        borderRadius: 20,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "0 1px 0 rgba(255,255,255,.10) inset, 0 10px 30px rgba(0,0,0,.25)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TextField({ value, onChange, placeholder, type = "text", t, maxLength, onKeyDown }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      maxLength={maxLength}
      onKeyDown={onKeyDown}
      style={{
        width: "100%",
        boxSizing: "border-box",
        fontFamily: "'Inter',sans-serif",
        fontSize: 15,
        color: t.text,
        background: t.bg2,
        border: `1px solid ${t.line}`,
        borderRadius: 12,
        padding: "12px 14px",
        outline: "none",
      }}
    />
  );
}

function Waveform({ t, active, levels = [] }) {
  const defaultBars = [6, 12, 8, 16, 10, 14, 7, 11, 9, 5];
  const hasRealLevels = levels.length > 0;
  const bars = hasRealLevels ? levels : defaultBars.map((value) => value / 40);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 18, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
      {bars.map((value, i) => {
        const baseLevel = Math.max(0, Math.min(1, value));
        const         height = active ? Math.max(3, Math.round(baseLevel * 18)) : Math.max(2, Math.round(baseLevel * 6));
        const opacity = active ? 0.5 + baseLevel * 0.5 : 0.15;
        return (
          <div
            key={i}
            style={{
              width: 2,
              height,
              borderRadius: 1,
              boxSizing: "border-box",
              background: `rgba(232,185,78,${opacity})`,
              transition: "height .1s ease-out, background .1s ease-out",
            }}
          />
        );
      })}
    </div>
  );
}

function Timeline({ t, progress, trimStart, trimEnd, duration, effectiveTrimmedDuration, onSeek, hoverTime, setHoverTime }) {
  const trackRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const getRelativeRatio = (clientX) => {
    if (!trackRef.current || !duration || effectiveTrimmedDuration <= 0.1) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const getRelativeTime = (clientX) => {
    return getRelativeRatio(clientX) * effectiveTrimmedDuration;
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    const relative = getRelativeTime(e.clientX);
    onSeek(trimStart + relative);
  };

  const handleMouseMove = (e) => {
    if (!trackRef.current) return;
    const relative = getRelativeTime(e.clientX);
    setHoverTime(relative);
    if (isDragging) {
      onSeek(trimStart + relative);
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const relative = getRelativeTime(e.clientX);
      onSeek(trimStart + relative);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, trimStart, effectiveTrimmedDuration, onSeek]);

  /* non-passive wheel listener so preventDefault works (React onWheel is passive) */
  useEffect(() => {
    const trackEl = trackRef.current;
    if (!trackEl) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const scrollAmount = effectiveTrimmedDuration * 0.01;
      const delta = e.deltaY > 0 ? scrollAmount : -scrollAmount;
      const currentPos = Math.max(0, Math.min(effectiveTrimmedDuration, (progress - trimStart) + delta));
      onSeek(trimStart + currentPos);
    };
    trackEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => trackEl.removeEventListener("wheel", handleWheel);
  }, [effectiveTrimmedDuration, progress, trimStart, onSeek]);

  const progressRatio = effectiveTrimmedDuration > 0.1
    ? Math.max(0, Math.min(1, (progress - trimStart) / effectiveTrimmedDuration))
    : 0;
  const hoverRatioValue = hoverTime !== null && effectiveTrimmedDuration > 0.1
    ? Math.max(0, Math.min(1, hoverTime / effectiveTrimmedDuration))
    : null;

  const thumbPercent = progressRatio * 100;

  return (
    <div
      ref={trackRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHoverTime(null); }}
      style={{
        position: "relative",
        flex: 1,
        height: 6,
        borderRadius: 3,
        background: t.line,
        cursor: "pointer",
        overflow: "visible",
      }}
    >
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        height: "100%",
        width: `${thumbPercent}%`,
        borderRadius: 3,
        background: t.amber,
        pointerEvents: "none",
      }} />
      {hoverRatioValue !== null && (
        <div style={{
          position: "absolute",
          top: -8,
          left: `${hoverRatioValue * 100}%`,
          transform: "translateX(-50%)",
          width: 3,
          height: 22,
          borderRadius: 2,
          background: t.amber,
          opacity: 0.6,
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        position: "absolute",
        left: `${thumbPercent}%`,
        top: "50%",
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: t.amber,
        boxShadow: `0 0 8px ${t.amber}88`,
        border: `2px solid ${t.bg0}`,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

/* ---------- Auth ---------- */

function AuthScreen({ t, lang, onAuthed }) {
  const s = STR[lang];
  const [mode, setMode] = useState("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [grow, setGrow] = useState(false);

  const validNick = /^[A-Za-z0-9_]{4,16}$/.test(nickname);

  const submit = async () => {
    setError("");
    if (!validNick) { setError(s.invalidNick); return; }
    if (!password) { setError(s.wrongCreds); return; }
    setBusy(true);
    if (mode === "signup") {
      const ok = await authRegister(nickname, password);
      if (!ok) { setError(s.takenNick); setBusy(false); return; }
      const data = await authLogin(nickname, password);
      if (data?.token) {
        window.sessionStorage.setItem("smooli:session", JSON.stringify({ nickname: data.nickname, token: data.token, roomId: null }));
        setGrow(true);
        setTimeout(() => onAuthed(data.nickname), 350);
      } else {
        setError(s.wrongCreds); setBusy(false);
      }
    } else {
      const data = await authLogin(nickname, password);
      if (data?.token) {
        window.sessionStorage.setItem("smooli:session", JSON.stringify({ nickname: data.nickname, token: data.token, roomId: null }));
        setGrow(true);
        setTimeout(() => onAuthed(data.nickname), 350);
      } else {
        setError(s.wrongCreds); setBusy(false);
      }
    }
  };

  return (
    <div style={{
      minHeight: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
      background: `radial-gradient(120% 100% at 50% -10%, ${t.amberSoft}, transparent 60%), ${t.bg0}`,
    }}>
      <div style={{
        fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 40,
        letterSpacing: -1, color: t.text, marginBottom: 4,
      }}>Smooli</div>
      <div style={{ fontFamily: "'Inter',sans-serif", color: t.muted, fontSize: 13, marginBottom: 28 }}>
        {lang === "ru" ? "слушайте музыку вместе, одновременно" : "listen together, in sync"}
      </div>

      <GlassCard t={t} style={{ width: 320, maxWidth: "100%", padding: 22, transform: grow ? "scale(38)" : "scale(1)", transition: "transform .5s cubic-bezier(.6,.1,.3,1)", transformOrigin: "50% 60%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: grow ? 0 : 1, transition: "opacity .2s" }}>
          <TextField t={t} value={nickname} onChange={setNickname} placeholder={s.nickname} maxLength={16} />
          <div style={{ fontSize: 11, color: t.muted, fontFamily: "'Inter',sans-serif", marginTop: -4 }}>{s.nicknameHint}</div>
          <TextField t={t} value={password} onChange={setPassword} placeholder={s.password} type="password" maxLength={32} />
          {error && <div style={{ color: t.danger, fontSize: 12, fontFamily: "'Inter',sans-serif" }}>{error}</div>}
          <GlassButton t={t} active onClick={submit} disabled={busy} style={{ marginTop: 6, textAlign: "center" }}>
            {s.ready}
          </GlassButton>
          <div
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            style={{ textAlign: "center", fontSize: 12.5, color: t.amber, cursor: "pointer", fontFamily: "'Inter',sans-serif", marginTop: 4 }}
          >
            {mode === "login" ? s.createAccount : s.haveAccount}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

/* ---------- Track gear menu ---------- */

function TrackGear({ t, track, onOpenSettings }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button
        onClick={() => onOpenSettings(track)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: t.muted,
          fontSize: 18,
          padding: 6,
          width: 34,
          height: 34,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
        aria-label="settings"
      >⚙</button>
    </div>
  );
}

function TrackSettingsModal({ t, s, track, albums, onUpdate, onDelete, onAddToAlbum, onClose }) {
  const [start, setStart] = useState(() => getTrackTrimValue(track, 0, "trimStartSec"));
  const [end, setEnd] = useState(() => getTrackTrimValue(track, 0, "trimEndSec"));
  const [trackDuration, setTrackDuration] = useState(0);
  const [fadeIn, setFadeIn] = useState(!!track.fadeIn);
  const [fadeOut, setFadeOut] = useState(!!track.fadeOut);
  const [cover, setCover] = useState(track.cover);
  const coverInput = useRef(null);

  useEffect(() => {
    const audio = document.createElement("audio");
    const cleanup = () => {
      audio.pause();
      audio.removeAttribute("src");
    };
    audio.src = track.fileDataUrl;
    const onMeta = () => {
      const duration = audio.duration || 0;
      setTrackDuration(duration);
      setStart(getTrackTrimValue(track, duration, "trimStartSec"));
      setEnd(getTrackTrimValue(track, duration, "trimEndSec"));
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.load();
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      cleanup();
    };
  }, [track.fileDataUrl, track]);

  useEffect(() => {
    setFadeIn(!!track.fadeIn);
    setFadeOut(!!track.fadeOut);
    setCover(track.cover);
  }, [track.fadeIn, track.fadeOut, track.cover]);

  const resetTrim = () => {
    setStart(0);
    setEnd(trackDuration || 0);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <GlassCard t={t} style={{ width: "100%", maxWidth: 520, padding: 20, position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{track.title}</div>
            <div style={{ fontSize: 12, color: t.muted }}>{s.editTrack}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: t.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ fontSize: 12, color: t.muted }}>Start: {formatTime(start)}</div>
          <input type="range" min={0} max={trackDuration || 0} step={1} value={Math.min(start, trackDuration || 0)} onChange={(e) => setStart(Math.min(+e.target.value, Math.max(0, end - 1)))} />
          <div style={{ fontSize: 12, color: t.muted }}>End: {formatTime(end)}</div>
          <input type="range" min={0} max={trackDuration || 0} step={1} value={Math.min(end, trackDuration || 0)} onChange={(e) => setEnd(Math.max(+e.target.value, Math.min(start + 1, trackDuration || 0)))} />
          <label style={{ fontSize: 13, color: t.text, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={fadeIn} onChange={(e) => setFadeIn(e.target.checked)} /> {s.fadeIn ?? "Fade in"}
          </label>
          <label style={{ fontSize: 13, color: t.text, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={fadeOut} onChange={(e) => setFadeOut(e.target.checked)} /> {s.fadeOut ?? "Fade out"}
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <GlassButton t={t} onClick={() => coverInput.current.click()} style={{ flex: 1, textAlign: "center" }}>{s.editCover}</GlassButton>
            <GlassButton t={t} style={{ flex: 1, textAlign: "center" }} onClick={resetTrim}>{s.resetTrim ?? "Reset trim"}</GlassButton>
          </div>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setCover(reader.result);
              reader.readAsDataURL(f);
            }}
          />
          {cover && <div style={{ minHeight: 120, borderRadius: 14, background: `url(${cover}) center/cover`, border: `1px solid ${t.line}` }} />}
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.addToAlbum}</div>
            {albums.length === 0 ? (
              <div style={{ color: t.muted, fontSize: 12 }}>{s.noAlbums ?? "No albums yet"}</div>
            ) : (
              albums.map((album) => {
                const already = album.trackIds?.includes(track.id);
                return (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => {
                      if (!already) onAddToAlbum(track.id, album.id);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: `1px solid ${t.line}`,
                      borderRadius: 12,
                      padding: "10px 12px",
                      background: already ? t.bg2 : t.bg1,
                      color: already ? t.muted : t.text,
                      cursor: already ? "default" : "pointer",
                      opacity: already ? 0.7 : 1,
                      fontFamily: "'Inter',sans-serif",
                      fontSize: 13,
                    }}
                  >
                    {album.name} {already ? `(${s.saved ?? "Added"})` : `+`}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          <GlassButton t={t} style={{ flex: 1, textAlign: "center" }} onClick={onClose}>{s.cancel}</GlassButton>
          <GlassButton t={t} active style={{ flex: 1, textAlign: "center" }} onClick={() => {
            onUpdate(track.id, {
              trimStartSec: start,
              trimEndSec: end,
              trimStart: start,
              trimEnd: end,
              fadeIn,
              fadeOut,
              cover,
            });
            onClose();
          }}>{s.save}</GlassButton>
          <GlassButton t={t} danger style={{ flex: 1, textAlign: "center" }} onClick={() => { onDelete(track.id); onClose(); }}>{s.deleteTrack}</GlassButton>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: t.muted }}>{s.trimHint ?? "Use the sliders to trim the track and toggle fade in/out."}</div>
      </GlassCard>
    </div>
  );
}

function MenuRow({ t, label, onClick, danger }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 10px", borderRadius: 10, cursor: "pointer",
        fontFamily: "'Inter',sans-serif", fontSize: 13.5,
        color: danger ? t.danger : t.text,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = t.bg2)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </div>
  );
}

/* ---------- Main App ---------- */

export default function Smooli() {
  useInjectFonts();
  const [theme, setTheme] = useState("dark");
  const [lang, setLang] = useState("ru");
  const t = THEMES[theme];
  const s = STR[lang];

  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("music");
  const [loaded, setLoaded] = useState(false);

  const [tracks, setTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [friends, setFriends] = useState([]);
  const [invites, setInvites] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);

  const audioRef = useRef(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hoverTime, setHoverTime] = useState(null);
  const [settingsTrack, setSettingsTrack] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [waveLevels, setWaveLevels] = useState([]);
  const [wavePeaks, setWavePeaks] = useState([]);
  const suppressBroadcast = useRef(false);
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const waveAnimationRef = useRef(null);
  const nowPlayingRef = useRef(nowPlaying);
  const tracksRef = useRef(tracks);
  const userRef = useRef(user);
  const lastSentPosRef = useRef(0);
  const analyserInitializedRef = useRef(false);

  useEffect(() => { nowPlayingRef.current = nowPlaying; }, [nowPlaying]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { userRef.current = user; }, [user]);

  const ensureAnalyser = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || analyserInitializedRef.current) return;
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      const source = audioContextRef.current.createMediaElementSource(audio);
      sourceRef.current = source;
      
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(audioContextRef.current.destination);
      analyserRef.current = analyser;
      analyserInitializedRef.current = true;
    } catch (e) {
      console.warn("Audio analyser init failed:", e);
    }
  }, []);

  const updateWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const audio = audioRef.current;
    
    if (analyser && audio && !audio.paused) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);
      
      const bars = 24;
      const step = Math.floor(bufferLength / bars);
      const levels = [];
      
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += dataArray[i * step + j];
        }
        const average = sum / step / 255;
        levels.push(average);
      }
      
      setWaveLevels(levels);
    }
    
    waveAnimationRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  useEffect(() => {
    return () => {
      if (waveAnimationRef.current) {
        cancelAnimationFrame(waveAnimationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const currentTrack = nowPlaying ? tracks.find((tr) => tr.id === nowPlaying) : null;
  const trimStart = currentTrack ? getTrackTrimValue(currentTrack, duration, "trimStartSec") : 0;
  const trimEnd = currentTrack ? getTrackTrimValue(currentTrack, duration, "trimEndSec") : duration;
  const trimmedDuration = Math.max(0, trimEnd - trimStart);
  const effectiveTrimmedDuration = trimmedDuration > 0 ? trimmedDuration : Math.max(0, duration - trimStart);

  /* single persistent socket connection */
  useEffect(() => {
    const token = getToken();
    const socket = io("/", { autoConnect: true, auth: { token } });
    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  /* bootstrap session */
  useEffect(() => {
    (async () => {
      try {
        const raw = window.sessionStorage.getItem("smooli:session");
        if (raw) {
          const session = JSON.parse(raw);
          if (session?.nickname && session?.token) {
            const u = await getUser(session.nickname);
            if (u) {
              setUser(session.nickname);
              if (session.roomId) setRoomId(session.roomId);
            }
          }
        }
      } catch {
        // ignore corrupted session
      }
      setLoaded(true);
    })();
  }, []);

  const persistSession = useCallback(async (nickname, rId) => {
    try {
      const raw = window.sessionStorage.getItem("smooli:session");
      const session = raw ? JSON.parse(raw) : {};
      window.sessionStorage.setItem("smooli:session", JSON.stringify({ ...session, nickname, roomId: rId || null }));
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const ux = user;
      setTracks((await sget(`tracks`, false)) || []);
      setAlbums((await sget(`albums`, false)) || []);
      const u = await getUser(ux);
      setFriends(u?.friends || []);
      setInvites((await sget(`invites`, false)) || []);
      setFriendRequests((await sget(`friend_requests:pending`, false)) || []);
      const prefs = await sget(`prefs`, false);
      if (prefs) { setTheme(prefs.theme || "dark"); setLang(prefs.lang || "ru"); }
    })();
  }, [user]);

  /* live invites: server pushes invite:<nickname> the instant a friend invites you */
  useEffect(() => {
    if (!user || !socketRef.current) return;
    const socket = socketRef.current;
    const handler = (invite) => setInvites((prev) => [invite, ...prev]);
    socket.on(`invite:${user}`, handler);
    return () => socket.off(`invite:${user}`, handler);
  }, [user]);

  const savePrefs = useCallback(async (next) => {
    if (!user) return;
    await sset(`prefs`, { theme: next.theme ?? theme, lang: next.lang ?? lang }, false);
  }, [user, theme, lang]);

  const persistTracks = async (list) => { setTracks(list); if (user) await sset(`tracks`, list, false); };
  const persistAlbums = async (list) => { setAlbums(list); if (user) await sset(`albums`, list, false); };

  const TOAST_KEY = "smooli:settingsSavedAt";
  const markSettingsSaved = useCallback(() => {
    const text = s.saved || s.ready || "Saved";
    setToastMessage(text);
    setToastVisible(true);
    try { window.localStorage.setItem(TOAST_KEY, Date.now().toString()); } catch (e) {}
  }, [s.saved, s.ready]);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(TOAST_KEY);
      if (value) {
        const timestamp = Number(value);
        if (Number.isFinite(timestamp) && Date.now() - timestamp < 10000) {
          setToastMessage(s.saved || s.ready || "Saved");
          setToastVisible(true);
        } else {
          window.localStorage.removeItem(TOAST_KEY);
        }
      }
    } catch (e) {}
  }, [s.saved, s.ready]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => {
      setToastVisible(false);
    }, 45);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  useEffect(() => {
    if (toastVisible || !toastMessage) return;
    const cleanup = window.setTimeout(() => setToastMessage(""), 1200);
    return () => window.clearTimeout(cleanup);
  }, [toastVisible, toastMessage]);

  /* ---- room: join via socket, get instant pushes, no polling ---- */
  useEffect(() => {
    const socket = socketRef.current;
    if (!roomId || !socket || !user) { setRoom(null); return; }

    let cancelled = false;
    (async () => {
      const r = await sget(`room:${roomId}`, true);
      if (!cancelled) {
        setRoom(r);
        if (r?.sharedTracks) {
          setTracks((prev) => {
            const merged = [...prev];
            for (const t of Object.values(r.sharedTracks)) {
              if (!merged.find((tr) => tr.id === t.id)) merged.push(t);
            }
            return merged;
          });
        }
      }
    })();

    socket.emit("room:join", { roomId, nickname: user });

    const onPlayback = (patch) => {
      setRoom((prev) => (prev ? { ...prev, playback: patch } : prev));
    };
    const onMix = ({ mix, sharedTracks }) => {
      setRoom((prev) => (prev ? { ...prev, mix } : prev));
      if (sharedTracks) {
        setTracks((prev) => {
          const merged = [...prev];
          for (const t of Object.values(sharedTracks)) {
            if (!merged.find((tr) => tr.id === t.id)) merged.push(t);
          }
          return merged;
        });
      }
    };
    socket.on("room:playback", onPlayback);
    socket.on("room:mix", onMix);

    return () => {
      cancelled = true;
      socket.emit("room:leave", { roomId });
      socket.off("room:playback", onPlayback);
      socket.off("room:mix", onMix);
    };
  }, [roomId, user]);

  /* apply remote room playback state to local audio element the instant it arrives */
  useEffect(() => {
    if (!room || !audioRef.current) return;
    const pb = room.playback;
    if (!pb || !pb.trackId) return;
    if (pb.actor === userRef.current) return;
    
    const audio = audioRef.current;
    const localTrack = tracksRef.current.find((tr) => tr.id === pb.trackId);
    const elapsedSince = (now() - pb.updatedAt) / 1000;
    const targetPos = pb.isPlaying ? pb.position + elapsedSince : pb.position;
    
    suppressBroadcast.current = true;
    
    if (localTrack && nowPlayingRef.current !== pb.trackId) {
      const url = localTrack.fileDataUrl;
      if (audio.src !== url) {
        audio.pause();
        audio.src = url;
        audio.load();
        const applyRemote = () => {
          audio.removeEventListener("loadedmetadata", applyRemote);
          audio.currentTime = Math.max(0, targetPos);
          if (pb.isPlaying) audio.play().catch(() => {});
          else audio.pause();
          setIsPlaying(pb.isPlaying);
          setNowPlaying(pb.trackId);
          suppressBroadcast.current = false;
        };
        audio.addEventListener("loadedmetadata", applyRemote);
        if (audio.readyState >= 1) {
          audio.removeEventListener("loadedmetadata", applyRemote);
          applyRemote();
        }
      } else {
        audio.currentTime = Math.max(0, targetPos);
        if (pb.isPlaying && audio.paused) audio.play().catch(() => {});
        if (!pb.isPlaying && !audio.paused) audio.pause();
        setIsPlaying(pb.isPlaying);
        suppressBroadcast.current = false;
      }
    } else {
      if (Math.abs(audio.currentTime - targetPos) > 0.3) {
        audio.currentTime = Math.max(0, targetPos);
      }
      if (pb.isPlaying && audio.paused) audio.play().catch(() => {});
      if (!pb.isPlaying && !audio.paused) audio.pause();
      setIsPlaying(pb.isPlaying);
      suppressBroadcast.current = false;
    }
  }, [room]);

  const broadcastPlayback = useCallback((patch) => {
    if (!roomId || suppressBroadcast.current || !socketRef.current) return;
    const payload = { roomId, ...patch, actor: userRef.current };
    socketRef.current.emit("room:playback", payload);
    setRoom((prev) => (prev ? { ...prev, playback: { ...payload, updatedAt: now() } } : prev));
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    
    const id = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !nowPlayingRef.current || audio.paused) return;
      
      const pos = audio.currentTime;
      if (Math.abs(pos - lastSentPosRef.current) < 0.5) return;
      
      lastSentPosRef.current = pos;
      broadcastPlayback({ trackId: nowPlayingRef.current, position: pos, isPlaying: true });
    }, 1500);
    
    return () => window.clearInterval(id);
  }, [roomId, broadcastPlayback]);

  useEffect(() => {
    let rafId;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && nowPlaying) {
        const dur = audio.duration;
        if (dur > 0 && Number.isFinite(dur)) setDuration(dur);
        if (!audio.paused) {
          setProgress(audio.currentTime || 0);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [nowPlaying]);

  const playLocalTrack = (track, broadcast = true) => {
    const audio = audioRef.current;
    const url = track.fileDataUrl;
    if (!audio || !url) return;
    
    ensureAnalyser();
    
    const isNewSrc = audio.src !== url;
    if (isNewSrc) {
      audio.pause();
      audio.src = url;
      audio.load();
    }
    
    setProgress(0);
    setDuration(0);
    setWaveLevels([]);
    
      const applyStart = () => {
      	const startTime = getTrackTrimValue(track, audio.duration || 0, "trimStartSec");
      	audio.currentTime = startTime || 0;
      	audio.volume = getFadeVolume(track, audio.currentTime || 0, audio.duration || 0);
      	setNowPlaying(track.id);
      	setIsPlaying(true);
      	lastSentPosRef.current = startTime || 0;
      	if (broadcast) broadcastPlayback({ trackId: track.id, position: startTime || 0, isPlaying: true });
      	audio.play().catch(() => {});
      };
    
    if (isNewSrc) {
      const onReady = () => {
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplay", onReady);
        applyStart();
      };
      audio.addEventListener("loadedmetadata", onReady);
      audio.addEventListener("canplay", onReady);
      if (audio.readyState >= 1) {
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplay", onReady);
        applyStart();
      }
    } else {
      applyStart();
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !nowPlaying) return;
    if (audio.paused) { 
      const pos = audio.currentTime;
      ensureAnalyser();
      audio.play(); setIsPlaying(true); 
      broadcastPlayback({ trackId: nowPlaying, isPlaying: true, position: pos });
      lastSentPosRef.current = pos;
    }
    else { 
      audio.pause(); setIsPlaying(false); 
      broadcastPlayback({ trackId: nowPlaying, isPlaying: false, position: audio.currentTime });
      lastSentPosRef.current = audio.currentTime;
    }
  };

  const seekToTime = (seconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = audio.duration || duration;
    if (!dur || !Number.isFinite(dur)) return;
    const safeSeconds = Math.max(0, Math.min(seconds, dur));
    audio.currentTime = safeSeconds;
    audio.volume = getFadeVolume(currentTrack, safeSeconds, dur);
    setProgress(safeSeconds);
    lastSentPosRef.current = safeSeconds;
    broadcastPlayback({ trackId: nowPlaying, position: safeSeconds, isPlaying });
    
    if (analyserRef.current && !audio.paused && !waveAnimationRef.current) {
      updateWaveform();
    }
  };

  const buildPlayQueue = () => {
    if (!room?.mix) return [];
    const queue = [];
    for (const id of [...(room.mix.trackIds || [])].reverse()) {
      const track = tracks.find((tr) => tr.id === id);
      if (track) queue.push(track);
    }
    for (const albumId of [...(room.mix.albumIds || [])].reverse()) {
      const album = albums.find((a) => a.id === albumId);
      if (album?.trackIds) {
        for (const id of album.trackIds) {
          const track = tracks.find((tr) => tr.id === id);
          if (track) queue.push(track);
        }
      }
    }
    return queue;
  };

  const playNextInMix = () => {
    const queue = buildPlayQueue();
    if (!nowPlaying || queue.length === 0) return false;
    const currentIndex = queue.findIndex((tr) => tr.id === nowPlaying);
    if (currentIndex === -1 || currentIndex >= queue.length - 1) return false;
    const nextTrack = queue[currentIndex + 1];
    if (!nextTrack) return false;
    playLocalTrack(nextTrack, true);
    return true;
  };

  const broadcastMix = (mix, sharedTracks) => {
    if (!roomId || !socketRef.current) return;
    const payload = { roomId, mix };
    if (sharedTracks) payload.sharedTracks = sharedTracks;
    socketRef.current.emit("room:mix", payload);
  };

  if (!loaded) return null;

  if (!user) {
    return (
      <div style={{ width: "100%", height: "100%" }}>
        <style>{GLOBAL_CSS(t)}</style>
        <AuthScreen t={t} lang={lang} onAuthed={async (nick) => { setUser(nick); await persistSession(nick, null); }} />
      </div>
    );
  }

  return (
    <div style={{
      width: "100%", height: "100%", background: t.bg0, color: t.text,
      fontFamily: "'Inter',sans-serif", display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
    }}>
      <style>{GLOBAL_CSS(t)}</style>
      <audio
        ref={audioRef}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setDuration(audio.duration || 0);
          const track = tracks.find((tr) => tr.id === nowPlaying);
          if (!track) return;
          const startTime = getTrackTrimValue(track, audio.duration || 0, "trimStartSec");
          if (Math.abs(audio.currentTime - startTime) > 0.3) audio.currentTime = startTime;
          setProgress(audio.currentTime || 0);
        }}
        onTimeUpdate={() => {
          if (!nowPlaying) return;
          const audio = audioRef.current;
          if (!audio) return;
          setProgress(audio.currentTime || 0);
          const track = tracks.find((tr) => tr.id === nowPlaying);
          if (track) {
            const fade = getFadeVolume(track, audio.currentTime || 0, audio.duration || 0);
            audio.volume = fade;
            const endSec = getTrackTrimValue(track, audio.duration || 0, "trimEndSec");
            if (endSec > 0 && audio.currentTime >= endSec) {
              if (!playNextInMix()) {
                audio.pause(); setIsPlaying(false);
              }
            }
          }
        }}
        onEnded={() => {
          if (!playNextInMix()) { setIsPlaying(false); setProgress(0); }
        }}
        onPlay={() => {
          setIsPlaying(true);
          ensureAnalyser();
          if (analyserRef.current && !waveAnimationRef.current) {
            updateWaveform();
          }
        }}
        onPause={() => {
          setIsPlaying(false);
          if (waveAnimationRef.current) {
            cancelAnimationFrame(waveAnimationRef.current);
            waveAnimationRef.current = null;
          }
        }}
      />

      <div style={{ padding: "18px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 22 }}>Smooli</div>
          {user && <span style={{ fontSize: 13, color: t.muted, fontWeight: 500 }}>· {user}</span>}
        </div>
        {roomId && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: t.muted }}>{s.joined}</span>
            <button
              onClick={async () => { setRoomId(null); await persistSession(user, null); }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px 18px",
                borderRadius: 24,
                border: `1px solid ${t.line}`,
                background: `linear-gradient(180deg, ${t.glassFrom}, ${t.glassTo})`,
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                color: t.text,
                fontFamily: "'Inter',sans-serif",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                overflow: "hidden",
                boxShadow: "0 1px 0 rgba(255,255,255,.10) inset, 0 6px 14px rgba(0,0,0,.18)",
                transition: "transform .12s ease, box-shadow .12s ease",
                minWidth: 90,
                height: 38,
              }}
              onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.96)"; e.currentTarget.style.boxShadow = "inset 0 2px 6px rgba(0,0,0,.25)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 1px 0 rgba(255,255,255,.10) inset, 0 6px 14px rgba(0,0,0,.18)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 1px 0 rgba(255,255,255,.10) inset, 0 6px 14px rgba(0,0,0,.18)"; }}
            >
              <span style={{
                position: "absolute",
                fontSize: 160,
                opacity: 0.28,
                filter: "none",
                userSelect: "none",
                pointerEvents: "none",
                lineHeight: 1,
              }}>🚪</span>
              <span style={{ position: "relative", zIndex: 1 }}>{s.leaveRoom}</span>
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 20px 140px" }}>
        {tab === "music" && !roomId && (
          <MusicTab
            t={t} s={s} tracks={tracks} albums={albums}
            waveLevels={waveLevels}
            onAddTrack={async (file) => {
              const reader = new FileReader();
              reader.onload = async () => {
                const track = { id: uid(), title: file.name.replace(/\.[^.]+$/, ""), cover: null, fileDataUrl: reader.result, trimStartSec: 0, trimEndSec: null, trimStart: 0, trimEnd: 100, addedAt: now() };
                await persistTracks([track, ...tracks]);
              };
              reader.readAsDataURL(file);
            }}
            onUpdateTrack={async (id, patch) => persistTracks(tracks.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)))}
            onDeleteTrack={async (id) => persistTracks(tracks.filter((tr) => tr.id !== id))}
            onOpenSettings={(track) => setSettingsTrack(track)}
            onAddToAlbum={async (trackId, albumId) => {
              persistAlbums(albums.map((a) => (a.id === albumId && !a.trackIds.includes(trackId) ? { ...a, trackIds: [...a.trackIds, trackId] } : a)));
            }}
            onRemoveFromAlbum={async (albumId, trackIds) => {
              persistAlbums(albums.map((a) => (a.id === albumId ? { ...a, trackIds: a.trackIds.filter((id) => !trackIds.includes(id)) } : a)));
            }}
            onNewAlbum={async (name) => persistAlbums([{ id: uid(), name, trackIds: [] }, ...albums])}
            onPlay={(track) => playLocalTrack(track)}
            nowPlaying={nowPlaying}
            isPlaying={isPlaying}
            onCreateRoom={async () => {
              const rId = uid();
              const r = { id: rId, members: [user], mix: { trackIds: [], albumIds: [] }, playback: null, createdAt: now(), sharedTracks: {} };
              await sset(`room:${rId}`, r, true);
              setRoomId(rId); setRoom(r);
              await persistSession(user, rId);
            }}
          />
        )}

        {tab === "music" && roomId && room && (
          <RoomTab
            t={t} s={s} room={room} tracks={tracks} albums={albums} user={user} waveLevels={waveLevels}
            onPlay={(track) => playLocalTrack(track)}
            nowPlaying={nowPlaying} isPlaying={isPlaying}
            onAddToMix={async (kind, id) => {
              const mix = { trackIds: [...(room.mix?.trackIds || [])], albumIds: [...(room.mix?.albumIds || [])] };
              if (kind === "track" && !mix.trackIds.includes(id)) mix.trackIds.push(id);
              if (kind === "album" && !mix.albumIds.includes(id)) mix.albumIds.push(id);
              const sharedTracks = { ...(room.sharedTracks || {}) };
              if (kind === "track") {
                const track = tracks.find((tr) => tr.id === id);
                if (track) sharedTracks[id] = track;
              }
              if (kind === "album") {
                const album = albums.find((a) => a.id === id);
                if (album?.trackIds) {
                  for (const tid of album.trackIds) {
                    const track = tracks.find((tr) => tr.id === tid);
                    if (track) sharedTracks[tid] = track;
                  }
                }
              }
              const nextRoom = { ...room, mix, sharedTracks };
              setRoom(nextRoom);
              await sset(`room:${roomId}`, nextRoom, true);
              broadcastMix(mix, sharedTracks);
            }}
            onRemoveFromMix={async (kind, id) => {
              const mix = { trackIds: [...(room.mix?.trackIds || [])], albumIds: [...(room.mix?.albumIds || [])] };
              if (kind === "track") mix.trackIds = mix.trackIds.filter((x) => x !== id);
              if (kind === "album") mix.albumIds = mix.albumIds.filter((x) => x !== id);
              const sharedTracks = { ...(room.sharedTracks || {}) };
              if (kind === "track") {
                delete sharedTracks[id];
              }
              if (kind === "album") {
                const album = albums.find((a) => a.id === id);
                if (album?.trackIds) {
                  for (const tid of album.trackIds) {
                    delete sharedTracks[tid];
                  }
                }
              }
              const nextRoom = { ...room, mix, sharedTracks };
              setRoom(nextRoom);
              await sset(`room:${roomId}`, nextRoom, true);
              broadcastMix(mix, sharedTracks);
            }}
          />
        )}

        {tab === "friends" && (
          <FriendsTab
            t={t} s={s} user={user} friends={friends}
            onFriendsChange={setFriends}
            onInviteToRoom={async (friendNick) => {
              if (!roomId) return;
              await fetch("/api/invites/send", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })() },
                body: JSON.stringify({ toNickname: friendNick, roomId }),
              });
              const r = await sget(`room:${roomId}`, true);
              if (r && !r.members.includes(friendNick)) {
                r.members.push(friendNick);
                await sset(`room:${roomId}`, r, true);
                setRoom(r);
              }
            }}
            hasRoom={!!roomId}
          />
        )}

        {tab === "invites" && (
          <InvitesTab
            t={t} s={s} invites={invites}
            onRespond={async (inv, accept) => {
              const remaining = invites.filter((i) => i.id !== inv.id);
              setInvites(remaining);
              await sset(`invites`, remaining, false);
              const res = await fetch("/api/invites/respond", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })() },
                body: JSON.stringify({ inviteId: inv.id, accept }),
              });
              if (accept && res.ok) {
                const data = await res.json();
                if (data.roomId) setRoomId(data.roomId);
                await persistSession(user, data.roomId);
              }
            }}
            friendRequests={friendRequests}
            onAcceptFriend={async (req) => {
              const res = await fetch("/api/friend-requests/respond", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })() },
                body: JSON.stringify({ requestId: req.id, accept: true }),
              });
              if (res.ok) {
                const me = await getUser(user);
                setFriends(me?.friends || []);
                setFriendRequests((await sget(`friend_requests:pending`, false)) || []);
              }
            }}
            onDeclineFriend={async (req) => {
              await fetch("/api/friend-requests/respond", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })() },
                body: JSON.stringify({ requestId: req.id, accept: false }),
              });
              setFriendRequests((await sget(`friend_requests:pending`, false)) || []);
            }}
          />
        )}

        {tab === "settings" && (
          <SettingsTab
            t={t} s={s} theme={theme} lang={lang}
            onTheme={(v) => { setTheme(v); savePrefs({ theme: v }); }}
            onLang={(v) => { setLang(v); savePrefs({ lang: v }); }}
            onLogout={async () => { try { await authLogout(); window.sessionStorage.removeItem("smooli:session"); } catch {}; setUser(null); setRoomId(null); }}
          />
        )}
        {settingsTrack && (
          <TrackSettingsModal
            t={t}
            s={s}
            track={settingsTrack}
            albums={albums}
            onUpdate={async (id, patch) => {
              const next = tracks.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr));
              await persistTracks(next);
              setSettingsTrack(next.find((tr) => tr.id === id) || null);
              markSettingsSaved();
            }}
            onDelete={async (id) => {
              await persistTracks(tracks.filter((tr) => tr.id !== id));
              setSettingsTrack(null);
            }}
            onAddToAlbum={async (trackId, albumId) => {
              await persistAlbums(albums.map((a) => (a.id === albumId && !a.trackIds.includes(trackId) ? { ...a, trackIds: [...a.trackIds, trackId] } : a)));
            }}
            onClose={() => setSettingsTrack(null)}
          />
        )}
        {toastMessage && (
          <div style={{
            position: "fixed",
            left: "50%",
            top: "55%",
            transform: toastVisible ? "translate(-50%, -50%)" : "translate(-50%, -40%)",
            opacity: toastVisible ? 1 : 0,
            transition: "opacity 0.8s ease, transform 0.8s ease",
            zIndex: 250,
            padding: "12px 16px",
            minWidth: 160,
            borderRadius: 16,
            background: "rgba(72, 187, 120, 0.14)",
            border: "1px solid rgba(72, 187, 120, 0.28)",
            color: "#44b070",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "center",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.09)",
          }}>
            {toastMessage}
          </div>
        )}
      </div>

      {nowPlaying && (
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 86 }}>
          <GlassCard t={t} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={togglePlay} style={{ border: "none", background: t.amber, color: t.bg0, width: 34, height: 34, borderRadius: "50%", cursor: "pointer", fontSize: 14 }}>
              {isPlaying ? "❚❚" : "▶"}
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: t.muted, minWidth: 34, fontVariantNumeric: "tabular-nums" }}>{formatTime(Math.max(0, progress - trimStart))}</span>
                  <Timeline
                    t={t}
                    progress={progress}
                    trimStart={trimStart}
                    trimEnd={trimEnd}
                    duration={duration}
                    effectiveTrimmedDuration={effectiveTrimmedDuration}
                    onSeek={seekToTime}
                    hoverTime={hoverTime}
                    setHoverTime={setHoverTime}
                  />
                  <span style={{ fontSize: 11, color: t.muted, minWidth: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTime(trimmedDuration)}</span>
                </div>
                {hoverTime !== null && <div style={{ fontSize: 10, color: t.amber, marginTop: -2, marginLeft: 42, fontVariantNumeric: "tabular-nums" }}>{formatTime(hoverTime)}</div>}
              </div>
            </div>
            <Waveform t={t} active={isPlaying} levels={waveLevels} />
          </GlassCard>
        </div>
      )}

      <div style={{ position: "absolute", left: 16, right: 16, bottom: 18 }}>
        <GlassCard t={t} style={{ padding: 8, display: "flex", justifyContent: "space-around" }}>
          <DockItem t={t} label={s.myMusic} icon="🎵" active={tab === "music"} onClick={() => setTab("music")} />
          <DockItem t={t} label={s.friends} icon="👥" active={tab === "friends"} onClick={() => setTab("friends")} />
           <DockItem t={t} label={s.invites} icon="✉️" active={tab === "invites"} badge={invites.length + friendRequests.length} onClick={() => setTab("invites")} />
          <DockItem t={t} label={s.settings} icon="⚙" active={tab === "settings"} onClick={() => setTab("settings")} />
        </GlassCard>
      </div>
    </div>
  );
}

function DockItem({ t, label, icon, active, onClick, badge }) {
  const [pressed, setPressed] = useState(false);
  const isGrayIcon = icon === "🎵" || icon === "👥" || icon === "✉️";
  return (
    <div
      onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)} onMouseLeave={() => setPressed(false)}
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer",
        position: "relative",
        transform: pressed ? "scale(0.9)" : "scale(1)", transition: "transform .12s ease",
        padding: "4px 10px", borderRadius: 12,
        background: active ? t.amberSoft : "transparent",
      }}
    >
      <div style={{ fontSize: 17, filter: active ? "brightness(0) invert(1)" : (isGrayIcon ? "grayscale(100%) brightness(0.6)" : "none") }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#FFFFFF" : "#6B7280", transition: "color .15s ease" }}>{label}</div>
      {badge > 0 && (
        <div style={{ position: "absolute", top: -2, right: 0, background: t.danger, color: "#fff", fontSize: 9, borderRadius: 8, minWidth: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
          {badge}
        </div>
      )}
    </div>
  );
}

/* ---------- Tabs ---------- */

function MusicTab({ t, s, tracks, albums, waveLevels, onAddTrack, onUpdateTrack, onDeleteTrack, onAddToAlbum, onRemoveFromAlbum, onNewAlbum, onPlay, nowPlaying, isPlaying, onCreateRoom, onOpenSettings }) {
  const fileInput = useRef(null);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [albumSettingsOpen, setAlbumSettingsOpen] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState([]);
  const currentAlbum = activeAlbum ? albums.find((a) => a.id === activeAlbum.id) || activeAlbum : null;
  const displayedAlbum = currentAlbum || activeAlbum;
  const albumTracks = displayedAlbum ? tracks.filter((tr) => displayedAlbum.trackIds.includes(tr.id)) : [];
  const remainingTracks = displayedAlbum ? tracks.filter((tr) => !displayedAlbum.trackIds.includes(tr.id)) : tracks;

  useEffect(() => {
    setAlbumSettingsOpen(false);
    setDeleteSelection([]);
  }, [displayedAlbum?.id]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ filter: activeAlbum ? "blur(10px)" : "none", transition: "filter .2s ease", pointerEvents: activeAlbum ? "none" : "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20 }}>{s.myMusic}</div>
          <GlassButton t={t} active onClick={() => fileInput.current.click()}>+ {s.addTrack}</GlassButton>
          <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f) onAddTrack(f); e.target.value = ""; }} />
        </div>

        <GlassButton t={t} onClick={onCreateRoom} style={{ display: "block", width: "100%", textAlign: "center", marginBottom: 18 }}>
          + {s.createRoom}
        </GlassButton>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: t.muted, fontWeight: 600 }}>{s.albums}</div>
          <span onClick={() => setNewAlbumOpen((v) => !v)} style={{ color: t.amber, fontSize: 13, cursor: "pointer" }}>+ {s.newAlbum}</span>
        </div>
        {newAlbumOpen && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <TextField t={t} value={albumName} onChange={setAlbumName} placeholder={s.albumName} />
            <GlassButton t={t} active onClick={() => { if (albumName.trim()) { onNewAlbum(albumName.trim()); setAlbumName(""); setNewAlbumOpen(false); } }}>{s.save}</GlassButton>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, marginBottom: 18 }}>
          {albums.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveAlbum(a)}
              style={{
                minWidth: 108,
                padding: 10,
                textAlign: "center",
                cursor: "pointer",
                border: "none",
                background: "transparent",
              }}
            >
              <GlassCard t={t} style={{ minWidth: 108, padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: 26 }}>💿</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                <div style={{ fontSize: 10.5, color: t.muted }}>{a.trackIds.length} {s.tracks.toLowerCase()}</div>
              </GlassCard>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: t.amber, marginBottom: 16 }}>{s.clickAlbumToOpen ?? "Click an album to open it and add tracks."}</div>

        <div style={{ fontSize: 13, color: t.muted, fontWeight: 600, marginBottom: 8 }}>{s.tracks}</div>
        {tracks.length === 0 && <div style={{ color: t.muted, fontSize: 13, padding: "20px 0" }}>{s.emptyMusic}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tracks.map((tr) => (
            <GlassCard key={tr.id} t={t} style={{ padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <div onClick={() => onPlay(tr)} style={{
                width: 42, height: 42, borderRadius: 10, cursor: "pointer",
                background: tr.cover ? `url(${tr.cover}) center/cover` : t.bg2,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
              }}>
                {!tr.cover && "🎧"}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, width: "100%" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr.title}</div>
                  {nowPlaying === tr.id && <Waveform t={t} active={isPlaying} levels={waveLevels} />}
                </div>
              </div>
              <TrackGear
                t={t}
                s={s}
                track={tr}
                albums={albums}
                onOpenSettings={onOpenSettings}
                onUpdate={onUpdateTrack}
                onDelete={onDeleteTrack}
                onAddToAlbum={onAddToAlbum}
              />
            </GlassCard>
          ))}
        </div>
      </div>

      {displayedAlbum && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.28)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", display: "flex", justifyContent: "center", alignItems: "center", padding: "24px 10px", pointerEvents: "none" }}>
          <div style={{ width: "100%", maxWidth: 520, pointerEvents: "auto" }}>
            <GlassCard t={t} style={{ padding: 20, borderRadius: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => setActiveAlbum(null)}
                  style={{ background: "none", border: "none", color: t.amber, cursor: "pointer", fontSize: 14, padding: 0 }}
                >
                  ← {s.albums}
                </button>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{displayedAlbum.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 12, color: t.muted }}>{displayedAlbum.trackIds.length} {s.tracks.toLowerCase()}</div>
                  <button
                    type="button"
                    onClick={() => setAlbumSettingsOpen((prev) => !prev)}
                    style={{
                      background: "none",
                      border: "1px solid rgba(255,255,255,.16)",
                      borderRadius: 14,
                      color: t.text,
                      cursor: "pointer",
                      padding: "8px 10px",
                      fontSize: 14,
                    }}
                  >
                    ⚙ {s.settings}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.tracks} в альбоме</div>
                <div style={{ display: "grid", gap: 10, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                  {albumTracks.length === 0 ? (
                    <div style={{ color: t.muted, fontSize: 13 }}>{s.emptyMusic}</div>
                  ) : (
                    albumTracks.map((tr) => (
                      <GlassCard
                        key={tr.id}
                        t={t}
                        style={{ padding: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer" }}
                        onClick={() => { setActiveAlbum(null); onPlay(tr); }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr.title}</div>
                        <div style={{ fontSize: 12, color: t.muted }}>В альбоме</div>
                      </GlassCard>
                    ))
                  )}
                </div>

                {albumSettingsOpen && (
                  <GlassCard t={t} style={{ padding: 14, borderRadius: 18, background: `linear-gradient(180deg, ${t.bg2}, ${t.bg1})` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{s.settings}</div>
                      <button
                        type="button"
                        onClick={() => setAlbumSettingsOpen(false)}
                        style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", fontSize: 16, padding: 0 }}
                      >✕</button>
                    </div>
                    <div style={{ fontSize: 13, color: t.muted, marginBottom: 10 }}>Выберите треки для удаления из альбома.</div>
                    <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 4 }}>
                      {tracks.filter((tr) => displayedAlbum.trackIds.includes(tr.id)).map((tr) => {
                        const selected = deleteSelection.includes(tr.id);
                        return (
                          <button
                            key={tr.id}
                            type="button"
                            onClick={() => {
                              setDeleteSelection((prev) => prev.includes(tr.id) ? prev.filter((id) => id !== tr.id) : [...prev, tr.id]);
                            }}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 12px",
                              borderRadius: 14,
                              border: `1px solid ${selected ? t.amber : t.line}`,
                              background: selected ? "rgba(232,185,78,.12)" : t.bg2,
                              color: t.text,
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            <span style={{ width: 18, height: 18, borderRadius: 6, border: `1px solid ${selected ? t.amber : t.line}`, background: selected ? t.amber : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: selected ? t.bg0 : t.muted }}>
                              {selected ? "✓" : ""}
                            </span>
                            <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{tr.title}</span>
                          </button>
                        );
                      })}
                    </div>
                    <GlassButton
                      t={t}
                      danger
                      disabled={deleteSelection.length === 0}
                      onClick={() => {
                        onRemoveFromAlbum(displayedAlbum.id, deleteSelection);
                        setDeleteSelection([]);
                        setAlbumSettingsOpen(false);
                      }}
                      style={{ width: "100%", marginTop: 12, opacity: deleteSelection.length === 0 ? 0.5 : 1 }}
                    >Удалить выбранные</GlassButton>
                  </GlassCard>
                )}

                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 10 }}>{s.addToAlbum}</div>
                {remainingTracks.length === 0 ? (
                  <div style={{ color: t.muted, fontSize: 13 }}>{s.saved ?? "All tracks added."}</div>
                ) : (
                  remainingTracks.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => onAddToAlbum(tr.id, displayedAlbum.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        background: "transparent",
                        padding: 0,
                        cursor: "pointer",
                      }}
                    >
                      <GlassCard t={t} style={{ padding: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr.title}</div>
                        <div style={{ color: t.amber, fontSize: 12 }}>+ {s.addToAlbum}</div>
                      </GlassCard>
                    </button>
                  ))
                )}
                <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                  <GlassButton
                    t={t}
                    active
                    onClick={() => {
                      if (albumTracks[0]) onPlay(albumTracks[0]);
                    }}
                    style={{ width: "100%", maxWidth: 220 }}
                  >
                    ▶ {s.play}
                  </GlassButton>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomTab({ t, s, room, tracks, albums, waveLevels, onPlay, nowPlaying, isPlaying, onAddToMix, onRemoveFromMix }) {
  const mixTracks = tracks.filter((tr) => room.mix?.trackIds?.includes(tr.id));
  const mixAlbums = albums.filter((a) => room.mix?.albumIds?.includes(a.id));
  return (
    <div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, margin: "10px 0" }}>{s.mix}</div>
      <div style={{ fontSize: 12, color: t.muted, marginBottom: 12 }}>{room.members?.join(", ")}</div>

      <div style={{ fontSize: 13, color: t.muted, fontWeight: 600, marginBottom: 6 }}>{s.tracks}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
        {mixTracks.length === 0 && <div style={{ color: t.muted, fontSize: 13 }}>—</div>}
        {[...mixTracks].reverse().map((tr) => (
          <GlassCard key={tr.id} t={t} style={{ padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <div onClick={() => onPlay(tr)} style={{ width: 38, height: 38, borderRadius: 9, cursor: "pointer", background: tr.cover ? `url(${tr.cover}) center/cover` : t.bg2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{!tr.cover && "🎧"}</div>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{tr.title}</div>
            {nowPlaying === tr.id && <Waveform t={t} active={isPlaying} levels={waveLevels} />}
            <span onClick={() => onRemoveFromMix("track", tr.id)} style={{ color: t.danger, cursor: "pointer", fontSize: 13 }}>✕</span>
          </GlassCard>
        ))}
      </div>

      <div style={{ fontSize: 13, color: t.muted, fontWeight: 600, marginBottom: 6 }}>{s.albums}</div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", marginBottom: 20 }}>
        {mixAlbums.map((a) => (
          <GlassCard key={a.id} t={t} style={{ minWidth: 100, padding: 10, textAlign: "center", position: "relative" }}>
            <span onClick={() => onRemoveFromMix("album", a.id)} style={{ position: "absolute", top: 4, right: 8, color: t.danger, cursor: "pointer", fontSize: 12 }}>✕</span>
            <div style={{ fontSize: 24 }}>💿</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</div>
          </GlassCard>
        ))}
      </div>

      <div style={{ fontSize: 13, color: t.muted, fontWeight: 600, marginBottom: 6 }}>+ {s.tracks} / {s.albums}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.filter((tr) => !room.mix?.trackIds?.includes(tr.id)).map((tr) => (
          <div key={tr.id} onClick={() => onAddToMix("track", tr.id)} style={{ fontSize: 13, color: t.text, cursor: "pointer", padding: "6px 4px" }}>+ {tr.title}</div>
        ))}
        {albums.filter((a) => !room.mix?.albumIds?.includes(a.id)).map((a) => (
          <div key={a.id} onClick={() => onAddToMix("album", a.id)} style={{ fontSize: 13, color: t.text, cursor: "pointer", padding: "6px 4px" }}>+ 💿 {a.name}</div>
        ))}
      </div>
    </div>
  );
}

function FriendsTab({ t, s, user, friends, onFriendsChange, onInviteToRoom, hasRoom }) {
  const [query, setQuery] = useState("");
  const [foundUser, setFoundUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sentRequests, setSentRequests] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [expandedFriend, setExpandedFriend] = useState(null);

  const loadRequests = async () => {
    const sent = (await sget(`friend_requests:sent`, false)) || [];
    const pending = (await sget(`friend_requests:pending`, false)) || [];
    setSentRequests(sent);
    setPendingRequests(pending);
  };

  useEffect(() => {
    loadRequests();
  }, [user, friends]);

  const deleteFriend = async (friendNick) => {
    await fetch(`/api/friends/${encodeURIComponent(friendNick)}`, {
      method: "DELETE",
      headers: { ...(() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })() },
    });
    const me = await getUser(user);
    onFriendsChange(me?.friends || []);
    setExpandedFriend(null);
  };

  const sendFriendRequest = async () => {
    const nick = query.trim();
    if (!nick) return;
    if (nick.toLowerCase() === user.toLowerCase()) return;
    if (friends.some((f) => f.toLowerCase() === nick.toLowerCase())) return;

    const sent = (await sget(`friend_requests:sent`, false)) || [];
    if (sent.some((r) => r.to.toLowerCase() === nick.toLowerCase() && r.status === "pending")) return;

    const targetPending = (await sget(`friend_requests:pending:${nick.toLowerCase()}`, true)) || [];
    if (targetPending.some((r) => r.from.toLowerCase() === user.toLowerCase() && r.status === "pending")) return;

    await fetch("/api/friend-requests/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })() },
      body: JSON.stringify({ to: nick }),
    });
    const req = { id: uid(), from: user, to: nick, status: "pending", at: now() };
    await sset(`friend_requests:sent`, [...sent, req], false);
    setSentRequests((prev) => [...prev, req]);
    setQuery("");
    setFoundUser(null);
  };

  const searchUser = async () => {
    const nick = query.trim();
    if (!nick) return;
    setSearching(true);
    const target = await getUser(nick);
    setFoundUser(target || null);
    setSearching(false);
  };

  const isFriend = query.trim() !== "" && friends.some((f) => f.toLowerCase() === query.trim().toLowerCase());
  const hasPendingTo = query.trim() !== "" && sentRequests.some((r) => r.to.toLowerCase() === query.trim().toLowerCase() && r.status === "pending");

  return (
    <div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, margin: "10px 0" }}>{s.friends}</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <TextField
          t={t}
          value={query}
          onChange={setQuery}
          placeholder={s.searchUsername}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (foundUser && !isFriend && !hasPendingTo) {
                sendFriendRequest();
              } else if (!foundUser) {
                searchUser();
              }
            }
          }}
        />
        {query.trim() !== "" && (
          isFriend ? (
            <span style={{ fontSize: 24, color: t.amber, cursor: "default", padding: "0 4px" }}>✅</span>
          ) : hasPendingTo ? (
            <GlassButton t={t} disabled style={{ fontSize: 13, padding: "0 14px", minWidth: 90, height: 38, opacity: 0.6 }}>{s.sentRequest}</GlassButton>
          ) : foundUser ? (
            <GlassButton t={t} onClick={sendFriendRequest} style={{ fontSize: 15, padding: "0 14px", minWidth: 44, height: 38, background: "#3A3A40", color: "#E8B94E", fontWeight: 700, border: "1px solid rgba(255,255,255,.12)" }}>➕</GlassButton>
          ) : (
            <GlassButton t={t} active onClick={searchUser} disabled={searching} style={{ fontSize: 15, padding: "0 16px", minWidth: 64, height: 38 }}>{searching ? "..." : s.search}</GlassButton>
          )
        )}
      </div>
      {friends.length === 0 && pendingRequests.length === 0 && <div style={{ color: t.muted, fontSize: 13 }}>{s.noFriends}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {friends.map((f) => (
          <GlassCard key={f} t={t} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{f}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {hasRoom && <GlassButton t={t} onClick={() => onInviteToRoom(f)} style={{ fontSize: 12, padding: "4px 10px", minWidth: "auto", height: 30 }}>{s.invite}</GlassButton>}
                <button
                  onClick={() => setExpandedFriend(expandedFriend === f ? null : f)}
                  style={{
                    background: "none",
                    border: "none",
                    color: t.muted,
                    cursor: "pointer",
                    fontSize: 18,
                    padding: 4,
                    width: 28,
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    transition: "background .15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = t.bg2)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  ⋮
                </button>
              </div>
            </div>
            {expandedFriend === f && (
              <div style={{
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: 6,
                borderTop: `1px solid ${t.line}`,
                animation: "fadeIn .15s ease",
              }}>
                <GlassButton
                  t={t}
                  danger
                  onClick={() => deleteFriend(f)}
                  style={{ fontSize: 13, padding: "6px 14px", minWidth: "auto", height: 32 }}
                >{s.deleteFriend}</GlassButton>
              </div>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

function InvitesTab({ t, s, invites, onRespond, friendRequests, onAcceptFriend, onDeclineFriend }) {
  function IconButton({ onClick, color, label, children }) {
    return (
      <button
        onClick={onClick}
        aria-label={label}
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "none",
          background: `linear-gradient(180deg, ${color.from}, ${color.to})`,
          color: t.bg0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 2px 6px ${color.shadow}`,
          transition: "transform .12s ease, box-shadow .12s ease",
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; e.currentTarget.style.boxShadow = `0 1px 3px ${color.shadow}`; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = `0 2px 6px ${color.shadow}`; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = `0 2px 6px ${color.shadow}`; }}
      >
        {children}
      </button>
    );
  }

  const CheckIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const CrossIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  return (
    <div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, margin: "10px 0" }}>{s.invites}</div>
      {invites.length === 0 && friendRequests.length === 0 && <div style={{ color: t.muted, fontSize: 13 }}>{s.noInvites}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {friendRequests.map((req) => (
          <GlassCard key={req.id} t={t} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13.5 }}>{req.from}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <IconButton onClick={() => onDeclineFriend(req)} label="Decline" color={{ from: "#f87171", to: "#ef4444", shadow: "rgba(239,68,68,.35)" }}>
                <CrossIcon />
              </IconButton>
              <IconButton onClick={() => onAcceptFriend(req)} label="Accept" color={{ from: t.amber, to: "#D4A43E", shadow: "rgba(232,185,78,.35)" }}>
                <CheckIcon />
              </IconButton>
            </div>
          </GlassCard>
        ))}
        {invites.map((inv) => (
          <GlassCard key={inv.id} t={t} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13.5 }}>{inv.from}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <IconButton onClick={() => onRespond(inv, false)} label="Decline" color={{ from: "#f87171", to: "#ef4444", shadow: "rgba(239,68,68,.35)" }}>
                <CrossIcon />
              </IconButton>
              <IconButton onClick={() => onRespond(inv, true)} label="Accept" color={{ from: t.amber, to: "#D4A43E", shadow: "rgba(232,185,78,.35)" }}>
                <CheckIcon />
              </IconButton>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

function SettingsTab({ t, s, theme, lang, onTheme, onLang, onLogout }) {
  const [idea, setIdea] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, margin: "10px 0" }}>{s.settings}</div>

      <SettingRow t={t} label={s.language}>
        <div style={{ display: "flex", gap: 6 }}>
          <GlassButton t={t} active={lang === "ru"} onClick={() => onLang("ru")}>RU</GlassButton>
          <GlassButton t={t} active={lang === "en"} onClick={() => onLang("en")}>EN</GlassButton>
        </div>
      </SettingRow>

      <SettingRow t={t} label={s.theme}>
        <div style={{ display: "flex", gap: 6 }}>
          <GlassButton t={t} active={theme === "dark"} onClick={() => onTheme("dark")}>🌑</GlassButton>
          <GlassButton t={t} active={theme === "light"} onClick={() => onTheme("light")}>☀️</GlassButton>
        </div>
      </SettingRow>

      <GlassCard t={t} style={{ padding: 14, marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{s.suggestion}</div>
        <textarea
          value={idea} onChange={(e) => setIdea(e.target.value)} rows={3}
          style={{ width: "100%", boxSizing: "border-box", background: t.bg2, border: `1px solid ${t.line}`, borderRadius: 10, color: t.text, padding: 10, fontFamily: "'Inter',sans-serif", fontSize: 13, resize: "none" }}
        />
        <GlassButton t={t} active style={{ marginTop: 8 }} onClick={async () => {
          if (!idea.trim()) return;
          const list = (await sget("suggestions:all", true)) || [];
          await sset("suggestions:all", [{ id: uid(), text: idea.trim(), at: now() }, ...list], true);
          setIdea(""); setSent(true); setTimeout(() => setSent(false), 2000);
        }}>{s.sendIdea}</GlassButton>
        {sent && <div style={{ color: t.amber, fontSize: 12, marginTop: 6 }}>{s.thanksIdea}</div>}
      </GlassCard>

      <GlassButton t={t} style={{ display: "block", width: "100%", textAlign: "center", marginTop: 16 }}>♥ {s.support}</GlassButton>
      <GlassButton t={t} danger style={{ display: "block", width: "100%", textAlign: "center", marginTop: 10 }} onClick={onLogout}>{s.logout}</GlassButton>
    </div>
  );
}

function SettingRow({ t, label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 2px", borderBottom: `1px solid ${t.line}` }}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

function GLOBAL_CSS(t) {
  return `
    input[type=range] { -webkit-appearance:none; height:4px; border-radius:2px; background:${t.line}; }
    input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:${t.amber}; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,.3); }
    * { box-sizing:border-box; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
  `;
}
