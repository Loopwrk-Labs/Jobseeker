// Fathom (AI meeting notetaker) → Jobseeker. Fathom POSTs one webhook per
// finished recording ("new meeting content ready"), signed with Standard
// Webhooks (HMAC-SHA256 over "id.timestamp.body", secret "whsec_<base64>").

const API = 'https://api.fathom.ai/external/v1';

export interface FathomConfig { apiKey: string; webhookId: string; secret: string; connectedAt: string }

export async function getConfig(db: D1Database): Promise<FathomConfig | null> {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'fathom'").first<{ value: string }>();
  try {
    return r ? (JSON.parse(r.value) as FathomConfig) : null;
  } catch {
    return null;
  }
}

async function saveConfig(db: D1Database, cfg: FathomConfig | null) {
  if (!cfg) await db.prepare("DELETE FROM app_settings WHERE key = 'fathom'").run();
  else await db.prepare("INSERT INTO app_settings (key, value) VALUES ('fathom', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(JSON.stringify(cfg)).run();
}

/** Registers our webhook in Fathom with the user's API key. */
export async function connect(db: D1Database, apiKey: string, origin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const old = await getConfig(db);
  if (old?.webhookId) await disconnect(db).catch(() => null);
  const res = await fetch(`${API}/webhooks`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      destination_url: `${origin}/fathom/webhook`,
      triggered_for: ['my_recordings'],
      include_transcript: true,
      include_summary: true,
      include_action_items: true,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: res.status === 401 ? 'Fathom ne prihvata ovaj API ključ.' : `Fathom je vratio grešku ${res.status}. ${t.slice(0, 200)}` };
  }
  const w = (await res.json()) as { id: string; secret: string };
  await saveConfig(db, { apiKey, webhookId: w.id, secret: w.secret, connectedAt: new Date().toISOString() });
  return { ok: true };
}

export async function disconnect(db: D1Database): Promise<void> {
  const cfg = await getConfig(db);
  if (cfg?.webhookId) {
    await fetch(`${API}/webhooks/${encodeURIComponent(cfg.webhookId)}`, { method: 'DELETE', headers: { 'X-Api-Key': cfg.apiKey } }).catch(() => null);
  }
  await saveConfig(db, null);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Standard Webhooks verification, with a 5-minute replay window. */
export async function verify(secret: string, headers: Headers, body: string): Promise<boolean> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigs = headers.get('webhook-signature');
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig || sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

interface Meeting {
  recording_id: number | string;
  title?: string | null;
  meeting_title?: string | null;
  url?: string | null;
  share_url?: string | null;
  scheduled_start_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  calendar_invitees?: { name?: string | null; email?: string | null; is_external?: boolean }[] | null;
  transcript?: { speaker?: { display_name?: string | null }; text?: string; timestamp?: string }[] | null;
  default_summary?: { markdown_formatted?: string | null } | null;
  action_items?: { description?: string; assignee?: { name?: string | null } | null }[] | null;
}

const MAX_TRANSCRIPT = 900_000;

/** Stores a meeting and links it to the interview it belongs to (by time, then by invitee domain). */
export async function ingest(db: D1Database, m: Meeting): Promise<{ recordingId: number; interviewId: number | null }> {
  const start = m.recording_start_time ?? m.scheduled_start_time ?? null;
  const transcript = (m.transcript ?? []).map((t) => `[${t.timestamp ?? ''}] ${t.speaker?.display_name ?? '?'}: ${t.text ?? ''}`).join('\n').slice(0, MAX_TRANSCRIPT);
  const actions = (m.action_items ?? []).map((a) => `- ${a.description ?? ''}${a.assignee?.name ? ` (${a.assignee.name})` : ''}`).join('\n');
  const invitees = (m.calendar_invitees ?? []).map((i) => `${i.name ?? ''}${i.email ? ` <${i.email}>` : ''}`.trim()).filter(Boolean).join(', ');

  let interviewId: number | null = null;
  if (start) {
    const t = new Date(start).getTime();
    const near = await db
      .prepare('SELECT id, starts_at FROM interviews WHERE starts_at BETWEEN ? AND ? ORDER BY abs(julianday(starts_at) - julianday(?)) LIMIT 1')
      .bind(new Date(t - 90 * 60000).toISOString(), new Date(t + 90 * 60000).toISOString(), new Date(t).toISOString())
      .first<{ id: number }>();
    interviewId = near?.id ?? null;
  }
  if (!interviewId) {
    const domains = (m.calendar_invitees ?? []).map((i) => i.email?.split('@')[1]?.toLowerCase()).filter((d): d is string => !!d && !/gmail|outlook|hotmail|yahoo|icloud/.test(d));
    for (const d of domains) {
      const hit = await db
        .prepare(`SELECT i.id FROM interviews i JOIN contacts c ON c.job_id = i.job_id WHERE lower(c.email) LIKE ? AND i.starts_at > datetime('now','-3 days') ORDER BY i.starts_at DESC LIMIT 1`)
        .bind(`%@${d}`)
        .first<{ id: number }>();
      if (hit) { interviewId = hit.id; break; }
    }
  }

  // Fathom sends every recorded meeting. Only interviews keep their content;
  // other meetings are stored as a bare title + time so they can be linked by hand.
  const keep = interviewId !== null;
  await db
    .prepare(
      `INSERT INTO recordings (provider, external_id, title, started_at, ended_at, url, share_url, invitees, summary, action_items, transcript, interview_id)
       VALUES ('fathom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(external_id) DO UPDATE SET title=excluded.title, started_at=excluded.started_at, ended_at=excluded.ended_at, url=excluded.url,
         share_url=excluded.share_url, invitees=excluded.invitees, summary=coalesce(excluded.summary, recordings.summary),
         action_items=coalesce(excluded.action_items, recordings.action_items), transcript=coalesce(excluded.transcript, recordings.transcript),
         interview_id=coalesce(recordings.interview_id, excluded.interview_id)`,
    )
    .bind(String(m.recording_id), m.meeting_title || m.title || null, start, m.recording_end_time ?? null, m.url ?? null, m.share_url ?? null,
      keep ? invitees || null : null, keep ? m.default_summary?.markdown_formatted ?? null : null, keep ? actions || null : null, keep ? transcript || null : null, interviewId)
    .run();
  const row = await db.prepare('SELECT id, interview_id FROM recordings WHERE external_id = ?').bind(String(m.recording_id)).first<{ id: number; interview_id: number | null }>();
  return { recordingId: row!.id, interviewId: row!.interview_id };
}

/** After a manual link: pull the transcript and summary from Fathom's API. */
export async function fetchContent(db: D1Database, recordingId: number): Promise<boolean> {
  const cfg = await getConfig(db);
  const rec = await db.prepare('SELECT external_id FROM recordings WHERE id = ?').bind(recordingId).first<{ external_id: string }>();
  if (!cfg || !rec) return false;
  const h = { 'X-Api-Key': cfg.apiKey };
  const [t, sm] = await Promise.all([
    fetch(`${API}/recordings/${rec.external_id}/transcript`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<any>,
    fetch(`${API}/recordings/${rec.external_id}/summary`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<any>,
  ]);
  const items: any[] = Array.isArray(t?.transcript) ? t.transcript : Array.isArray(t) ? t : [];
  const transcript = items.map((x) => `[${x.timestamp ?? ''}] ${x.speaker?.display_name ?? '?'}: ${x.text ?? ''}`).join('\n').slice(0, MAX_TRANSCRIPT);
  const summary = sm?.summary?.markdown_formatted ?? sm?.markdown_formatted ?? null;
  await db.prepare('UPDATE recordings SET transcript = coalesce(?, transcript), summary = coalesce(?, summary) WHERE id = ?').bind(transcript || null, summary, recordingId).run();
  return !!(transcript || summary);
}
