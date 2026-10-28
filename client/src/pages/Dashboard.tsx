import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Language, type Room } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LANGUAGES, languageLabel } from '../lib/languages';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('javascript');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRooms()
      .then(({ rooms }) => setRooms(rooms))
      .catch((err) => setError(err.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const { room } = await api.createRoom(name.trim() || 'Untitled', language);
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create room');
    }
  }

  async function remove(room: Room) {
    if (!confirm(`Delete "${room.name}" for everyone? This cannot be undone.`)) return;
    await api.deleteRoom(room.id);
    setRooms((list) => list?.filter((r) => r.id !== room.id) ?? null);
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">{'</>'}</span> CodeSync
        </div>
        <div className="topbar-right">
          <span className="muted">{user?.name}</span>
          <button className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dashboard">
        <form className="card new-room" onSubmit={create}>
          <h2>New room</h2>
          <div className="row">
            <input placeholder="e.g. Mock interview: arrays" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button className="btn btn-primary">Create</button>
          </div>
        </form>

        {error && <p className="error">{error}</p>}

        <h2 className="section-title">Your rooms</h2>
        {rooms === null && !error && <p className="muted">Loading…</p>}
        {rooms?.length === 0 && <p className="muted">No rooms yet. Create one and share the link with a friend.</p>}
        <ul className="room-list">
          {rooms?.map((room) => (
            <li key={room.id} className="room-item">
              <Link to={`/room/${room.id}`} className="room-link">
                <span className="room-name">{room.name}</span>
                <span className="muted">
                  {languageLabel(room.language)} · {room.role === 'owner' ? 'You own this' : `by ${room.ownerName}`} ·
                  edited {timeAgo(room.updatedAt)}
                </span>
              </Link>
              {room.role === 'owner' && (
                <button className="btn btn-ghost btn-sm" onClick={() => remove(room)} aria-label={`Delete ${room.name}`}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
