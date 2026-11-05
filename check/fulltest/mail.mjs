// Reading the test mailboxes through Microsoft Graph. Read only: this file
// asks Graph for a token and then only ever sends GET. It never sends,
// moves, marks or deletes a message.
//
// The app, its tenant and its secret are the operator's, named in the
// settings file. The secret may be given as a path to a file that holds it
// (mail.client_secret_file), so no copy is made.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const GRAPH = "https://graph.microsoft.com/v1.0";
const lower = (s) => String(s || "").trim().toLowerCase();

export function mailSettings(settings) {
  const m = (settings && settings.mail) || {};
  let secret = String(m.client_secret || "").trim();
  if (!secret && m.client_secret_file) {
    try { secret = readFileSync(String(m.client_secret_file).replace(/^~(?=\/)/, homedir()), "utf8").trim(); } catch { secret = ""; }
  }
  const boxes = [].concat(m.mailboxes || []).map(lower).filter(Boolean);
  return { tenant: String(m.tenant_id || "").trim(), client: String(m.client_id || "").trim(), secret, boxes,
    sender: lower(m.sent_from), desk: lower(m.desk) };
}

export class Mail {
  constructor(settings, since) {
    this.s = mailSettings(settings);
    this.since = since;                 // only mail that arrived after the run began counts
    this.on = !!(this.s.tenant && this.s.client && this.s.secret && this.s.boxes.length);
    this.token = "";
    this.folders = new Map();
    this.expected = [];                 // {what, to, subject, box?} queued by the journeys
    this.unreadable = new Set();
  }
  /* Whether mail to this address lands in a mailbox the app may read: the
     mailbox itself, or a plus address of it (name+tag@domain). */
  boxFor(address) {
    const a = lower(address);
    const plain = a.replace(/\+[^@]*@/, "@");
    return this.s.boxes.find((b) => b === a || b === plain) || "";
  }
  async auth() {
    if (this.token) return this.token;
    const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.s.tenant)}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.s.client, client_secret: this.s.secret,
        scope: "https://graph.microsoft.com/.default" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Microsoft would not give a token (${r.status} ${String(j.error || "").slice(0, 60)})`);
    this.token = j.access_token;
    return this.token;
  }
  /* The one way this file talks to a mailbox. */
  async get(path) {
    const r = await fetch(`${GRAPH}${path}`, { method: "GET", headers: { Authorization: `Bearer ${await this.auth()}` } });
    if (!r.ok) throw new Error(`Graph answered ${r.status} for ${path.split("?")[0]}`);
    return r.json();
  }
  async folderName(box, id) {
    const key = `${box}|${id}`;
    if (!this.folders.has(key)) {
      const f = await this.get(`/users/${encodeURIComponent(box)}/mailFolders/${encodeURIComponent(id)}?$select=displayName`).catch(() => null);
      this.folders.set(key, f ? f.displayName : "a folder that could not be named");
    }
    return this.folders.get(key);
  }
  async recent(box) {
    const q = new URLSearchParams({
      $filter: `receivedDateTime ge ${this.since.toISOString()}`, $orderby: "receivedDateTime desc", $top: "50",
      $select: "id,subject,from,toRecipients,ccRecipients,receivedDateTime,parentFolderId",
    });
    const j = await this.get(`/users/${encodeURIComponent(box)}/messages?${q}`);
    return j.value || [];
  }
  /* The newest message since the run began, in this mailbox, to this
     address, whose subject fits. Null when there is none yet. */
  async find(box, { to, subject }) {
    const want = lower(to);
    for (const m of await this.recent(box)) {
      const people = [].concat(m.toRecipients || [], m.ccRecipients || []).map((p) => lower(p.emailAddress && p.emailAddress.address));
      if (want && !people.includes(want)) continue;
      const s = String(m.subject || "");
      if (subject instanceof RegExp ? !subject.test(s) : !s.includes(subject)) continue;
      return { id: m.id, subject: s, from: lower(m.from && m.from.emailAddress && m.from.emailAddress.address),
        folder: await this.folderName(box, m.parentFolderId), received: m.receivedDateTime };
    }
    return null;
  }
  async waitFor(box, want, ms = 90000) {
    const end = Date.now() + ms;
    for (;;) {
      const found = await this.find(box, want);
      if (found || Date.now() > end) return found;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  /* The first link in the message that opens one of the given pages of ours. */
  async linkIn(box, id, pathPart) {
    const m = await this.get(`/users/${encodeURIComponent(box)}/messages/${encodeURIComponent(id)}?$select=body`);
    const html = String((m.body && m.body.content) || "").replace(/&amp;/g, "&");
    const links = html.match(/https:\/\/nexpoint\.co\.uk\/[^\s"'<>)]+/g) || [];
    return links.find((l) => l.includes(pathPart)) || "";
  }
  /* A journey says what email its step should cause. Checked at the end. */
  expect(what, to, subject) { this.expected.push({ what, to, subject }); }
  /* Every expected email: found (who from, which folder) or not. */
  async settle(log = () => {}) {
    const rows = [];
    for (const e of this.expected) {
      const box = this.on ? this.boxFor(e.to) : "";
      const row = { what: e.what, to: e.to, result: "", ok: false, hand: false };
      if (!this.on) { row.result = "not checked: mail is not set up"; row.hand = true; }
      else if (!box) { row.result = "not checked: this address is not in a mailbox the runner may read"; row.hand = true; }
      else {
        try {
          const m = await this.waitFor(box, e, 60000);
          if (!m) row.result = "NOT FOUND in the mailbox";
          else {
            const fromOk = !this.s.sender || m.from === this.s.sender;
            const inboxOk = /^inbox$/i.test(m.folder);
            row.ok = fromOk && inboxOk;
            row.result = `arrived: "${m.subject}", from ${m.from}${fromOk ? "" : ` (expected ${this.s.sender})`}, in ${m.folder}${inboxOk ? "" : " (expected Inbox)"}`;
          }
        } catch (err) { row.result = `could not read the mailbox: ${String(err.message || err).slice(0, 120)}`; row.hand = true; }
      }
      log(`  ${row.ok ? "arrived     " : row.hand ? "BY HAND     " : "DIFFERED    "} ${e.what} -> ${e.to}`);
      rows.push(row);
    }
    return rows;
  }
}
