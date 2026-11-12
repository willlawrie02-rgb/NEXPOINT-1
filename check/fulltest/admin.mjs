// The full test: the consultancy sign-up and the admin boards.
import { APEX, PRINT, MILL, OPPS, API, Refused, Soft, mustBeZZ, isZZ, isZZSlug, differs, wait, skip, hand, askEnter, askLine } from "./core.mjs";
import { windowFor, go, see, shows, text, whoAmI, apiGet, signIn, signOut, adminWindow, adminGo, saveVia, wantDirect, ADMIN, allow, pollUntil, invoiceRaised } from "./browser.mjs";
import { same, made, acct, today, MARK, stampOf, newcomer, pageErrors, typeahead, fillIfEmpty, emailLink, pdfOk, nearest, termsOf, HUBS, openAnswer, answer, findForm, search, cardOf, companyPage, prospectName, prospectRow, openProspect, fits } from "./kit.mjs";

const consultancy = [{
  id: "in.consultancy", title: "Every way in: the consultancy sign-up (never signed)", pass: "computer", needs: ["admin", "host", "window"],
  steps: [
    { id: "link", once: true, does: "Admin: makes a consultancy link for the ZZ host's folder, at your own address", shows: "\"Link ready\"",
      run: async (ctx) => {
        const a = acct(ctx, "host");
        if (!isZZSlug(a.folder)) skip("accounts.host.folder is not filled in (the company's zz- folder name)");
        const w = await adminGo(ctx, "consultancy.html");
        const ids = () => w.page.locator('[id^="link-"]').evaluateAll((els) => els.map((e) => e.id));
        const before = await ids();
        await w.page.fill("#f-slug", a.folder);
        await w.page.fill("#f-client", a.company);
        await w.page.fill("#f-address", "ZZ test address: not a real agreement");
        await w.page.fill("#f-signer", "ZZ Full Test");
        await w.page.fill("#f-email", ctx.settings.admin.email);
        await w.page.click("#f-submit");
        await see(w.page, "#given-title", "Link ready", "after making the link", 30000);
        ctx.did();
        /* The new link's row is the one that was not there before. Its number is
           kept; its address opens a real agreement, so it stays in memory only. */
        const mine = (await ids()).filter((id) => !before.includes(id));
        if (mine.length === 1) made(ctx).link = mine[0];
        ctx.left.push(`a consultancy link for ${a.company} (the runner revokes it)`);
        const url = await w.page.inputValue("#given-url");
        if (!/^https:\/\/nexpoint\.co\.uk\/sign\/\?t=[0-9a-f]{64}$/.test(url)) differs("the link", url.replace(/[0-9a-f]{56}$/, "…"), `${APEX}/sign/?t=…`);
        if (mine.length !== 1) differs("the new link's row", `${mine.length} new rows`, "one");
        ctx.cache.signUrl = url;
      } },
    { id: "read", does: "Opens the link", shows: "\"Welcome, <ZZ company>.\"; the retainer line; Sign is greyed out. Never signed",
      run: async (ctx) => {
        if (!ctx.cache.signUrl) skip("the link was made on an earlier run and its address is not kept between runs");
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        /* Whatever this page shows, the link is still revoked in the next step. */
        try {
          await go(w.page, ctx.cache.signUrl);
          const head = await see(w.page, "#signBody h1", "Welcome,", "the agreement page", 30000);
          mustBeZZ(head.replace(/^Welcome,\s*/, "").replace(/\.$/, ""), "the company on the agreement page");
          await see(w.page, "#signBody", "Retainer", "the summary");
          if (!(await w.page.locator("#signBtn").isDisabled())) differs("the Sign button before anything is typed", "can be pressed", "greyed out");
        } catch (e) { throw new Soft(String(e.message || e).split("\n")[0]); }
      } },
    { id: "revoke", once: true, does: "Admin: revokes the link", shows: "The question under the link, with no pop-up; then the link reads revoked",
      run: async (ctx) => {
        const a = acct(ctx, "host"), id = made(ctx).link;
        if (!id) skip("the runner does not know which link it made, so it revokes none. Revoke it by hand on the Consultancy page");
        const w = await adminGo(ctx, "consultancy.html");
        const row = w.page.locator(`#${id}`);
        await row.waitFor({ state: "visible" }).catch(() => differs("the link on the Consultancy page", "not among the open links", id));
        if (!(await row.textContent()).includes(a.company)) throw new Refused("refused: that link is not the ZZ host's");
        mustBeZZ(a.company, "the link to revoke");
        await row.locator('[data-act="askRevoke"]').click();
        await see(w.page, `#${id} .inline-choice`, "Revoke this link?", "the question under the link");
        const sent = w.page.waitForResponse((r) => r.url() === `${API}/consultancy/links/revoke`, { timeout: 30000 });
        await row.locator('[data-act="revoke"]').click();
        if ((await sent).ok()) ctx.did(); else differs("revoking", "the API refused", "revoked");
        /* A revoked link moves under Finished, which is folded. */
        await w.page.waitForFunction((i) => !!document.querySelector(`#finished #${i}`), id, { timeout: 20000 })
          .catch(() => differs("the link after revoking", "not under Finished", "under Finished, revoked"));
      } },
    { id: "dead", does: "Opens the revoked link again", shows: "\"This link is no longer valid.\"",
      run: async (ctx) => {
        if (!ctx.cache.signUrl) skip("the link's address is not kept between runs");
        const w = ctx.lastWindow = await windowFor(ctx, "stranger");
        await go(w.page, ctx.cache.signUrl);
        await see(w.page, "#signBody", "no longer valid", "the revoked link", 30000);
      } },
  ],
}];

// ================================================================ 6. the admin
const admin = [{
  id: "admin.door", title: "The admin: signing in", pass: "computer", needs: ["admin", "window"],
  steps: [
    { id: "door", does: "Opens the admin and waits for you to sign in", shows: "The side menu with nine items; \"Working as …\" with your address",
      run: async (ctx) => {
        const w = await adminWindow(ctx);
        const n = await w.page.locator(".rail .nav a").count();
        if (n !== 9) differs("the side menu", `${n} items`, "nine");
      } },
  ],
}, {
  id: "admin.company", title: "The admin: Contacts and a company page, with fast saves on", pass: "computer", needs: ["admin", "host", "window"],
  from: "queue CY11 and DA9 (plan 079)",
  steps: [
    { id: "open", does: "Contacts: finds the ZZ host and opens its page", shows: "The page titled with the ZZ name; Portal user on its person; a Terms line",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "host").company);
        if (!(await shows(w.page, 'span.tag.mini:has-text("Portal user")'))) differs("the company's people", "nobody tagged Portal user", "Portal user");
        if (!(await shows(w.page, 'dt:has-text("Terms")'))) differs("the account block", "no Terms line", "Terms");
      } },
    { id: "note", does: "Adds a note", shows: "With fast saves on: \"Saved\", and the note on the timeline at once",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "host").company), body = `${MARK} ${ctx.stamp}: a test note, please ignore.`;
        if (await shows(w.page, '[data-act="composerPick"][data-pick="note"]', 1500)) await w.page.click('[data-act="composerPick"][data-pick="note"]');
        await w.page.fill("#cp-note", body);
        const saved = await saveVia(w.page, () => w.page.click('[data-act="noteAdd"]'));
        ctx.left.push(`a test note on ${acct(ctx, "host").company}`);
        if (!saved.direct) throw new Soft(`the note was queued for the engine ("${saved.toast}"): fast saves read off, so CY11's switch is not on`);
        wantDirect(saved, "the note");
        await see(w.page, ".tl", body, "the note on the timeline at once");
      } },
    { id: "edit", does: "Edits the website field, then puts it back", shows: "\"Saved\" both times; the value survives a reload",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, test = "https://example.com/zz-full-test";
        let w = await companyPage(ctx, company);
        await w.page.click('[data-act="openUi"][data-ui="editco"]');
        const old = await w.page.inputValue("#ec-web");
        await w.page.fill("#ec-web", old === test ? "" : test);
        const first = await saveVia(w.page, () => w.page.click('[data-act="saveCompany"]'));
        let kept = true;
        if (first.direct) {
          w = await companyPage(ctx, company);
          await w.page.click('[data-act="openUi"][data-ui="editco"]');
          kept = (await w.page.inputValue("#ec-web")) === (old === test ? "" : test);
          await w.page.fill("#ec-web", old === test ? "" : old);
          wantDirect(await saveVia(w.page, () => w.page.click('[data-act="saveCompany"]')), "putting the website back");
        }
        if (!first.direct) throw new Soft(`the edit was queued for the engine ("${first.toast}"): fast saves read off. The website field now reads ${test}; put it back by hand`);
        if (!kept) differs("the website after a reload", "the old value", test);
      } },
    { id: "task", does: "Adds a task, then marks it done", shows: "The task under the company; then gone from the open list",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "host").company), title = `${MARK} ${ctx.stamp}: a test task`;
        await w.page.click('[data-act="composerPick"][data-pick="task"]');
        await w.page.fill("#cp-title", title);
        const saved = await saveVia(w.page, () => w.page.click('[data-act="taskAdd"]'));
        if (!saved.direct) throw new Soft(`the task was queued for the engine ("${saved.toast}"): fast saves read off. Mark it done by hand once it shows`);
        const task = await nearest(w.page, '[data-act="taskDone"]', title, "task");
        if (!task) differs("the new task", "not listed with a Done button", title);
        const done = w.page.locator(`[data-act="taskDone"][data-task="${task}"]`).first();
        wantDirect(await saveVia(w.page, () => done.click()), "marking the task done");
      } },
  ],
}, {
  id: "admin.pipelines", title: "The admin: a pipeline card", pass: "computer", needs: ["admin", "host", "window"],
  steps: [
    { id: "add", once: true, does: "Pipelines: adds a hub card for the ZZ host", shows: "The card in the Accepted column",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, w = await adminGo(ctx, "pipelines.html?tab=hub");
        mustBeZZ(company, "the company for the card");
        /* The cards there before, so the runner only ever touches the one it adds. */
        made(ctx).before = await w.page.locator(".card[data-card]").evaluateAll((els) => els.map((e) => e.dataset.card));
        await w.page.click('[data-act="openUi"][data-ui="add"]');
        await w.page.fill("#ac-q", company);
        await w.page.click('[data-act="findCompany"]');
        const pick = w.page.locator('[data-act="pickCompany"]', { hasText: company }).first();
        await pick.waitFor({ state: "visible" }).catch(() => differs("finding the company", "not offered", company));
        await pick.click();
        await w.page.click('[data-act="toggleHub"][data-hub="print"]');
        const saved = await saveVia(w.page, () => w.page.click('[data-act="confirmAdd"]'));
        ctx.did();
        ctx.left.push(`a pipeline card for ${company} (the runner marks it dead)`);
        return saved.direct ? "" : `queued for the engine ("${saved.toast}"): fast saves read off, so the card shows after the next run`;
      } },
    { id: "move", does: "Moves it to In conversation, on the company page", shows: "The stage changes; \"Saved\"",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, w = await adminGo(ctx, "pipelines.html?tab=hub");
        const before = made(ctx).before || null;
        if (!before) skip("the runner does not know which card it added, so it moves none");
        const fresh = await w.page.locator(".card[data-card]", { hasText: company }).evaluateAll((els, old) => els.map((e) => e.dataset.card).filter((c) => !old.includes(c)), before);
        if (!fresh.length) wait("the new card is not on the board yet (the engine adds it at its next run)");
        if (fresh.length > 1) throw new Refused("refused: more than one new card for the ZZ host; the runner cannot tell which is its own");
        const id = made(ctx).card = fresh[0];
        await companyPage(ctx, company);
        await w.page.locator(`#card-${id}`).waitFor({ state: "visible" }).catch(() => differs("the card on the company page", "not shown", `#card-${id}`));
        wantDirect(await saveVia(w.page, () => w.page.click(`#card-${id} [data-act="setStage"][data-stage="conversation"]`)), "moving the card");
      } },
    { id: "dead", does: "Marks the card dead", shows: "\"Saved\"; the card leaves the board",
      run: async (ctx) => {
        const company = acct(ctx, "host").company, id = made(ctx).card;
        if (!id) skip("the runner does not know which card it added, so it marks none dead");
        const w = await companyPage(ctx, company);
        await w.page.click(`[data-act="openUi"][data-ui="dead:${id}"]`);
        await w.page.locator('[data-act="pickReason"]').first().click();
        await w.page.fill("#dd-note", "test data");
        wantDirect(await saveVia(w.page, () => w.page.click('[data-act="confirmDead"]')), "marking the card dead");
      } },
  ],
}, {
  id: "admin.prospects", title: "The admin: Prospects, with fast saves on", pass: "computer", needs: ["admin", "window"],
  from: "queue CY9, CY11 and DA9. Never onto a campaign: that goes into Smartlead",
  steps: [
    { id: "add", once: true, does: "Prospects: adds \"ZZ Full Test Prospect …\" as a Known contact", shows: "Queued for the engine",
      run: async (ctx) => {
        const p = await prospectRow(ctx);
        mustBeZZ(p.name, "the prospect to add");
        if (p.id) return "already there from an earlier run";
        await p.w.page.click('.head [data-act="toggleAdd"]');
        await p.w.page.fill("#add-name", p.name);
        await p.w.page.selectOption("#add-type", { label: "Known contact" });
        await p.w.page.click("#add-go");
        ctx.did();
        await see(p.w.page, "#toast", /./, "after adding");
        ctx.left.push(`the prospect ${p.name}, and the lead folder made when it is accepted`);
      } },
    { id: "sector", does: "Opens the row: a second sector on, Save, reload, off again, Save", shows: "The sector survives the reload; the row ends as it began",
      run: async (ctx) => {
        let p = await openProspect(ctx);
        const button = () => p.w.page.locator(`#plist [data-act="toggleMany"][data-id="${p.id}"][data-f="sectors"]`).first();
        const look = async () => button().evaluate((b) => `${b.getAttribute("aria-pressed")}|${b.className}`);
        const before = await look();
        await button().click();
        const on = await look();
        if (on === before) differs("pressing a sector", "nothing changed", "the sector lit");
        const saved = await saveVia(p.w.page, () => p.w.page.click(`#save-${p.id}`));
        if (!saved.direct) throw new Soft(`the edit was queued for the engine ("${saved.toast}"): fast saves read off. One sector on ${p.name} was changed`);
        p = await openProspect(ctx);
        if ((await look()) !== on) differs("the sector after a reload", "as it was before", "still on");
        await button().click();
        wantDirect(await saveVia(p.w.page, () => p.w.page.click(`#save-${p.id}`)), "taking the sector off again");
        if ((await look()) !== before) differs("the row at the end", "changed", "as it began");
      } },
    { id: "note", does: "Adds a note on the prospect", shows: "The note under the row at once",
      run: async (ctx) => {
        const p = await openProspect(ctx), body = `${MARK} ${ctx.stamp}: a test note, please ignore.`;
        if (!(await shows(p.w.page, `#note-${p.id}`, 1500))) await p.w.page.locator("#plist details summary", { hasText: "Notes" }).first().click();
        await p.w.page.fill(`#note-${p.id}`, body);
        const saved = await saveVia(p.w.page, () => p.w.page.click(`[data-act="addNote"][data-id="${p.id}"]`));
        if (!saved.direct) throw new Soft(`the note was queued for the engine ("${saved.toast}"): fast saves read off`);
        await see(p.w.page, "#plist p.note-item", body, "the note under the row");
      } },
    { id: "accept", once: true, does: "Accepts it as a Known contact, with no campaign", shows: "\"Accepted as a lead\"",
      run: async (ctx) => {
        const p = await openProspect(ctx);
        await p.w.page.selectOption(`#type-${p.id}`, { label: "Known contact" });
        const lit = await p.w.page.locator(`#plist [data-act="toggleMany"][data-id="${p.id}"][data-f="campaigns"][aria-pressed="true"]`).count();
        if (lit) throw new Refused("refused: a campaign is chosen on the row, and a campaign goes into Smartlead");
        await p.w.page.click(`#act-${p.id} [data-act="accept"][data-id="${p.id}"]`);
        ctx.did();
        await see(p.w.page, "#toast", "Accepted", "after Accept");
      } },
    { id: "in-contacts", does: "Looks for the accepted company in Contacts", shows: "The company, as a lead",
      run: async (ctx) => { await companyPage(ctx, prospectName(ctx)); } },
  ],
}, {
  id: "delete-login", title: "The admin: a login deleted, the person kept (uses up an account)", pass: "computer", optIn: true,
  needs: ["admin", "disposable", "window"], from: "queue CY10b, case 2 (plan 085)",
  steps: [
    { id: "role", once: true, does: "Gives the disposable account's person a role in Contacts", shows: "\"Saved\"",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "disposable").company);
        await w.page.locator('[data-act="editPerson"]').first().click();
        await w.page.locator("#pe-name").waitFor({ state: "visible" });
        await w.page.getByLabel(/role/i).first().fill("ZZ test role");
        await saveVia(w.page, () => w.page.click('[data-act="savePerson"]'));
      } },
    { id: "delete", once: true, does: "Delete user, and its confirmation", shows: "The question under the user, then queued",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "disposable").company);
        const user = await w.page.locator('[data-act="deleteUser"]').first().getAttribute("data-user");
        await w.page.click(`[data-act="deleteUser"][data-user="${user}"]`);
        await w.page.click(`[data-act="confirmDeleteUser"][data-user="${user}"]`);
        ctx.did();
        await see(w.page, "#toast", /./, "after Delete user");
      } },
    { id: "kept", does: "Opens the company page again", shows: "The person stays, with no Portal user tag; the timeline says a login was deleted",
      run: async (ctx) => {
        const w = await companyPage(ctx, acct(ctx, "disposable").company);
        if (await shows(w.page, 'span.tag.mini:has-text("Portal user")', 2000)) wait("the engine has not yet deleted the login (its next run)");
        await see(w.page, ".tl", "A portal login was deleted", "the timeline");
        if (!(await w.page.locator(".person-name").count())) differs("the person", "gone from Contacts", "kept, because they hold a role");
      } },
  ],
}];

export const ADMIN_JOURNEYS = [].concat(consultancy, admin);
