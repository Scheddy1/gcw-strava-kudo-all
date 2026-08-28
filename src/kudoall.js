let _intl;

try {
    if (window.chrome !== undefined && chrome.i18n) {
        _intl = chrome.i18n;
    } else if (window.browser !== undefined && browser.i18n) {
        _intl = browser.i18n;
    } else {
        throw new Error("No i18n provider");
    }
} catch (err) {
    _intl = {
        getMessage: function (messageName, substitutions) {
            return substitutions ? substitutions : messageName;
        },
    };
}

function getMessage(messageName, substitutions) {
    return _intl.getMessage(messageName, substitutions);
}

// === Debug toggle ===
const DEBUG = false;
const log = (...args) => DEBUG && console.log("[KudoAll]", ...args);

// === Small utils ===
function debounce(fn, waitMs) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), waitMs);
    };
}

function patchSpaNavigation(onChange) {
    if (window.__gcwKudoAllHistoryPatched) return;
    window.__gcwKudoAllHistoryPatched = true;

    const fire = () => window.dispatchEvent(new Event("gcw-locationchange"));
    const _ps = history.pushState;
    const _rs = history.replaceState;

    history.pushState = function () {
        const r = _ps.apply(this, arguments);
        fire();
        return r;
    };

    history.replaceState = function () {
        const r = _rs.apply(this, arguments);
        fire();
        return r;
    };

    window.addEventListener("popstate", fire);
    window.addEventListener("gcw-locationchange", onChange);
}

function isHostStrava() {
    return /^(.+\.)?strava\.com$/i.test(window.location.hostname);
}

function isHostGarmin() {
    const h = window.location.hostname.toLowerCase();
    return (
        h === "connect.garmin.com" ||
        h === "connect.garmin.cn" ||
        h === "connectus.garmin.cn"
    );
}

// =========================
// ======= STRAVA ==========
// =========================
const Strava = (() => {
    const BTN_ID = "gcw-kudo-all-strava";

    function getContainer() {
        return document.querySelector(".user-nav.nav-group");
    }

    function findKudosButtons(container) {
        const selector =
            "button[data-testid='kudos_button'] > svg[data-testid='unfilled_kudos']";

        const root = container || document;
        return Array.from(root.querySelectorAll(selector));
    }

    function createFilter(athleteLink) {
        const href = athleteLink.href
            .replace("https://www.strava.com", "")
            .replace("https://strava.com", "");

        return (item) => !item.querySelector(`a[href^="${href}"]`);
    }

    function getKudosButtons() {
        const athleteLink = document.querySelector(
            "#athlete-profile a[href^='/athletes']"
        );

        if (!athleteLink) {
            return findKudosButtons();
        }

        let activities = document.querySelectorAll(
            "div[data-testid='web-feed-entry']"
        );

        if (activities.length < 1) {
            return findKudosButtons();
        }

        activities = Array.from(activities).filter(createFilter(athleteLink));

        if (activities.length < 1) {
            return findKudosButtons();
        }

        return activities.flatMap(findKudosButtons).filter(Boolean);
    }

    function createButton() {
        const label = getMessage("kudo_all", "Kudo All");

        const navItemLi = document.createElement("li");
        const navItemA = document.createElement("a");

        navItemLi.className = "nav-item";
        navItemLi.style.marginRight = "10px";

        navItemA.href = "#";
        navItemA.className = "btn btn-default btn-sm empty";
        navItemA.id = BTN_ID;

        const navItemIcon = document.createElement("span");
        navItemIcon.className = "app-icon icon-kudo";
        navItemIcon.style.marginRight = "5px";

        const navItemText = document.createElement("span");
        navItemText.className = "ka-progress text-caption1";
        navItemText.textContent = label;

        navItemA.append(navItemIcon);
        navItemA.append(navItemText);
        navItemLi.append(navItemA);

        return navItemLi;
    }

    function kudoAllHandler(event) {
        event.preventDefault();

        const icons = getKudosButtons();
        const len = icons.length;
        if (len < 1) return;

        for (let i = 0; i < len; i++) {
            const item = icons[i];
            if (!item) continue;

            const parentItem = item.parentElement;
            if (parentItem) parentItem.click();
        }
    }

    function ensureButton() {
        const container = getContainer();
        if (!container) return;

        if (document.getElementById(BTN_ID)) return;

        const buttonLi = createButton();
        container.prepend(buttonLi);

        const a = buttonLi.querySelector(`#${BTN_ID}`);
        (a || buttonLi).addEventListener("click", kudoAllHandler);

        log("Strava button injected");
    }

    const scheduleEnsure = debounce(ensureButton, 200);

    function init() {
        log("Strava init");

        scheduleEnsure();

        const obs = new MutationObserver(scheduleEnsure);
        obs.observe(document.documentElement, { childList: true, subtree: true });

        patchSpaNavigation(scheduleEnsure);
    }

    return { init };
})();

// =========================
// ======= GARMIN ===========
// =========================
const GC = (() => {
    const MOUNT_ID = "gcw-kudo-all-gc-mount";
    const BTN_ID = "gcw-kudo-all-gc-btn";
    const STYLE_ID = "gcw-kudo-all-style";

    const ACTIVITY_LINK_SELECTOR = [
        "a[href*='/app/activity/']",
        "a[href*='/app/activities/']",
        "a[href*='/modern/activity/']",
    ].join(",");

    const ACTIVITY_CARD_SELECTOR = [
        "[class*='ActivityCard_activityContainer']",
        "[data-testid='activity-card']",
        "article",
    ].join(",");

    const LIKE_CONCURRENCY = 4;
    const MAX_ACTIVITIES = 250;

    let isRunning = false;

    function onNewsfeed() {
        const p = window.location.pathname || "";
        return (
            p === "/app/newsfeed" ||
            p.startsWith("/app/newsfeed/") ||
            p === "/modern/newsfeed" ||
            p.startsWith("/modern/newsfeed/")
        );
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
      #${BTN_ID}.gcw-header-btn{
        margin: 0 8px 0 0;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        border: 0;
        background: transparent;
        cursor: pointer;
        font-size: 18px;
        line-height: 36px;
        user-select: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      #${BTN_ID}.gcw-header-btn:hover{
        background: rgba(0,0,0,.06);
      }
      #${BTN_ID}.gcw-header-btn[data-gcw-kudo-all-liked="true"]{
        color: #d92828;
      }
      #${BTN_ID}.gcw-floating{
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 999999;
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
        padding: 10px 12px;
        border-radius: 10px;
        border: 0;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(0,0,0,.18);
        background: #111;
        color: #fff;
      }
    `;
        document.head.appendChild(style);
    }

    function isVisibleElement(el) {
        if (!el) return false;

        const st = window.getComputedStyle(el);
        if (
            st.display === "none" ||
            st.visibility === "hidden" ||
            st.opacity === "0"
        ) {
            return false;
        }

        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > 0;
    }

    function findHeader() {
        return (
            document.querySelector(".header-nav") ||
            document.querySelector("header, [role='banner']")
        );
    }

    function findUploadImportButton(header) {
        if (!header) return null;

        let btn = header.querySelector(
            '[aria-label="Aktivität hochladen oder importieren"]'
        );
        if (btn) return btn;

        const btns = [...header.querySelectorAll("[aria-label]")];
        return (
            btns.find((b) => {
                const a = (b.getAttribute("aria-label") || "").toLowerCase();
                return (
                    a.includes("aktivität") ||
                    a.includes("hochladen") ||
                    a.includes("import") ||
                    a.includes("upload")
                );
            }) || null
        );
    }

    function ensureMount(header) {
        if (!header) return null;

        let mount = document.getElementById(MOUNT_ID);
        if (!mount) {
            mount = document.createElement("span");
            mount.id = MOUNT_ID;
            mount.style.display = "inline-flex";
            mount.style.alignItems = "center";
        }

        const uploadBtn = findUploadImportButton(header);

        if (uploadBtn) {
            // The mount must be a sibling of Garmin's complete upload nav item.
            // Putting it inside that item inherits the upload control's tooltip.
            const uploadItem = uploadBtn.closest(
                "li, .header-nav-item, [class*='HeaderNavItem_'], [class*='headerNavItem']"
            );
            const anchor = uploadItem || uploadBtn;
            const parent = anchor.parentElement;

            if (
                parent &&
                (mount.parentElement !== parent || mount.nextSibling !== anchor)
            ) {
                parent.insertBefore(mount, anchor);
            }

            if (parent) return mount;
        }

        if (mount.parentElement !== header) {
            header.appendChild(mount);
        }

        return mount;
    }

    function createButton(isFloating = false) {
        const label = getMessage("kudo_all", "Kudo All");

        const btn = document.createElement("button");
        btn.id = BTN_ID;
        btn.type = "button";
        btn.setAttribute("aria-label", label);
        btn.title = label;

        if (isFloating) {
            btn.className = "gcw-floating";
            btn.textContent = label;
        } else {
            btn.className = "gcw-header-btn";
            btn.textContent = "♥";
        }

        return btn;
    }

    function normalizeAria(el) {
        return (el.getAttribute("aria-label") || "")
            .toLowerCase()
            .trim();
    }

    function isSafeUnlikedButton(button) {
        if (button.dataset.gcwKudoAllLiked === "true") return false;

        const aria = normalizeAria(button);
        const pressed = (button.getAttribute("aria-pressed") || "")
            .toLowerCase()
            .trim();

        if (pressed === "true") return false;

        // Garmin DE already-liked state:
        // "Gefällt nicht" = already liked / clicking would remove it.
        if (aria === "gefällt nicht") return false;
        if (aria.includes("gefällt nicht")) return false;

        // Generic already-liked / remove states.
        if (aria.includes("entfernen")) return false;
        if (aria.includes("remove")) return false;
        if (aria.includes("unlike")) return false;

        // Only these exact states are safe to click.
        if (aria === "gefällt mir") return true;
        if (aria === "like") return true;

        return false;
    }

    function activityIdFromLink(link) {
        if (!link) return null;

        try {
            const pathname = new URL(link.href, window.location.origin).pathname;
            const match = pathname.match(
                /\/(?:app|modern)\/activit(?:y|ies)\/(\d+)(?:\/|$)/
            );
            return match ? match[1] : null;
        } catch (_) {
            return null;
        }
    }

    function findActivityCard(link) {
        if (!link) return null;

        const explicitCard = link.closest(ACTIVITY_CARD_SELECTOR);
        if (explicitCard) return explicitCard;

        // Fail closed: never climb into a generic feed container because that
        // could associate a comment button with the wrong activity.
        return null;
    }

    function isCommentLikeButton(button) {
        const cls = (button.className || "").toString().toLowerCase();
        if (cls.includes("like-link")) return true;

        return Boolean(
            button.closest(
                "[data-testid*='comment'], [class*='CommentItem_'], [class*='Comment_comment']"
            )
        );
    }

    function findPrimaryLikeButton(card) {
        const selector = [
            'button[aria-label="Gefällt mir"]',
            'button[aria-label="Like"]',
        ].join(",");

        return (
            Array.from(card.querySelectorAll(selector)).find(
                (button) =>
                    isVisibleElement(button) &&
                    isSafeUnlikedButton(button) &&
                    !isCommentLikeButton(button)
            ) || null
        );
    }

    function findActivityTargets() {
        const targets = [];
        const seenActivityIds = new Set();

        for (const link of document.querySelectorAll(ACTIVITY_LINK_SELECTOR)) {
            if (targets.length >= MAX_ACTIVITIES) break;

            const activityId = activityIdFromLink(link);
            if (!activityId || seenActivityIds.has(activityId)) continue;

            const card = findActivityCard(link);
            if (!card || !isVisibleElement(card)) continue;

            const likeButton = findPrimaryLikeButton(card);
            if (!likeButton) continue;

            seenActivityIds.add(activityId);
            targets.push({ activityId, likeButton });
        }

        return targets;
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function likeActivity(activityId) {
        const url =
            "/gc-api/conversation-service/conversation/like/ACTIVITY/" +
            encodeURIComponent(activityId);

        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: "{}",
            });

            if (response.ok || response.status === 409) return;

            if (response.status === 429 && attempt === 0) {
                const retryAfter = Number(response.headers.get("Retry-After"));
                await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 750);
                continue;
            }

            throw new Error(`Garmin like request failed (${response.status})`);
        }
    }

    function markLiked(button) {
        if (!button || !button.isConnected) return;

        const aria = normalizeAria(button);
        button.dataset.gcwKudoAllLiked = "true";
        button.setAttribute("aria-pressed", "true");
        button.setAttribute(
            "aria-label",
            aria === "gefällt mir" ? "Gefällt nicht" : "Unlike"
        );
    }

    async function runWithConcurrency(items, worker) {
        let nextIndex = 0;

        async function runWorker() {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                await worker(items[index], index);
            }
        }

        const workerCount = Math.min(LIKE_CONCURRENCY, items.length);
        await Promise.all(Array.from({ length: workerCount }, runWorker));
    }

    async function kudoAllHandler(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!onNewsfeed()) return;
        if (isRunning) return;

        isRunning = true;

        const uiBtn = document.getElementById(BTN_ID);
        const oldText = uiBtn?.textContent || "♥";
        const oldTitle = uiBtn?.title || "Kudo All";

        let completed = 0;
        let failed = 0;

        try {
            if (uiBtn) {
                uiBtn.textContent = "…";
                uiBtn.title = "Kudo All läuft…";
            }

            const targets = findActivityTargets();

            await runWithConcurrency(targets, async (target) => {
                try {
                    await likeActivity(target.activityId);
                    markLiked(target.likeButton);
                    completed++;
                } catch (error) {
                    failed++;
                    log("Garmin activity failed", target.activityId, error);
                } finally {
                    if (uiBtn) {
                        uiBtn.title = `Kudo All läuft… (${completed + failed}/${targets.length})`;
                    }
                }
            });

            log("Garmin activities processed", { completed, failed });
        } finally {
            isRunning = false;

            if (uiBtn) {
                uiBtn.textContent = oldText;
                uiBtn.title = failed
                    ? `${oldTitle} (${completed} erfolgreich, ${failed} fehlgeschlagen)`
                    : `${oldTitle} (${completed})`;
            }
        }
    }

    function ensureButton() {
        if (!isHostGarmin()) return;
        if (!onNewsfeed()) return;

        document.documentElement.dataset.gcwKudoAll = "1";
        ensureStyles();

        const header = findHeader();
        const existing = document.getElementById(BTN_ID);

        if (header) {
            const mount = ensureMount(header);
            if (!mount) return;

            if (existing && existing.isConnected) {
                if (existing.classList.contains("gcw-floating")) {
                    existing.remove();
                } else {
                    if (existing.parentElement !== mount) {
                        mount.appendChild(existing);
                    }
                    return;
                }
            }

            const btn = createButton(false);
            btn.addEventListener("click", kudoAllHandler);
            mount.appendChild(btn);

            log("Garmin header button injected");
            return;
        }

        if (!existing) {
            const fb = createButton(true);
            fb.addEventListener("click", kudoAllHandler);
            document.body.appendChild(fb);
            log("Garmin floating fallback injected");
        }
    }

    const scheduleEnsure = debounce(ensureButton, 200);

    function init() {
        scheduleEnsure();

        const obs = new MutationObserver(scheduleEnsure);
        obs.observe(document.documentElement, { childList: true, subtree: true });

        patchSpaNavigation(() => setTimeout(scheduleEnsure, 250));

        const retry = setInterval(() => {
            ensureButton();
            if (document.getElementById(BTN_ID)) clearInterval(retry);
        }, 500);

        setTimeout(() => clearInterval(retry), 20000);
    }

    return { init };
})();

// =========================
// ========== INIT ==========
// =========================
(function start() {
    log("Kudo All content script start");

    if (isHostStrava()) {
        Strava.init();
    } else if (isHostGarmin()) {
        GC.init();
    }
})();
