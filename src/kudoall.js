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
    const MAX_ACTIVITIES = 500;

    let isRunning = false;
    const pendingActivityIds = new Set();
    let liveLikeButtons = new Map();

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
        margin: 0;
        width: 36px;
        min-width: 36px;
        height: 36px;
        padding: 0;
        flex: 0 0 36px;
        border-radius: 10px;
        border: 0;
        background: transparent;
        color: #111 !important;
        opacity: 1 !important;
        visibility: visible !important;
        appearance: none;
        -webkit-appearance: none;
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
      button.gcw-activity-liked{
        position: relative !important;
        color: #007cc3 !important;
      }
      button.gcw-activity-liked svg{
        visibility: hidden !important;
      }
      button.gcw-activity-liked::after{
        content: "♥";
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #007cc3;
        font: 24px/1 Arial, sans-serif;
        pointer-events: none;
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
        (document.head || document.documentElement).appendChild(style);
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

    function controlHint(el) {
        return [
            el.getAttribute("aria-label"),
            el.getAttribute("title"),
            el.getAttribute("data-original-title"),
            el.getAttribute("data-tooltip"),
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
    }

    function findUploadImportButton() {
        const exactButtons = document.querySelectorAll(
            [
                'button[aria-label="Aktivität hochladen oder importieren"]',
                'button[aria-label="Aktivitäten hochladen"]',
                'button[aria-label="Upload Activities"]',
                'button[title="Aktivitäten hochladen"]',
            ].join(",")
        );

        for (const exactButton of exactButtons) {
            if (isVisibleElement(exactButton)) return exactButton;
        }

        const candidates = document.querySelectorAll(
            "button, a, [role='button'], [aria-label], [title], " +
                "[data-original-title], [data-tooltip]"
        );

        for (const candidate of candidates) {
            const hint = controlHint(candidate);
            if (
                !hint.includes("hochladen") &&
                !hint.includes("upload") &&
                !hint.includes("import")
            ) {
                continue;
            }

            const control =
                candidate.closest("button, a, [role='button']") || candidate;
            if (isVisibleElement(control)) return control;
        }

        return null;
    }

    function ensureMount(uploadBtn) {
        let mount = document.getElementById(MOUNT_ID);
        if (!mount) {
            mount = document.createElement("span");
            mount.id = MOUNT_ID;
            mount.style.display = "inline-flex";
            mount.style.alignItems = "center";
            mount.style.flex = "0 0 auto";
            mount.style.visibility = "visible";
        }

        // Garmin's generated containers currently place injected children in a
        // different row. Anchor to the upload control's viewport coordinates
        // instead, keeping Kudo All exactly 8 px to its left.
        const rect = uploadBtn.getBoundingClientRect();
        const buttonSize = 36;
        const gap = 8;

        Object.assign(mount.style, {
            position: "fixed",
            left: `${Math.max(4, rect.left - buttonSize - gap)}px`,
            top: `${Math.max(4, rect.top + (rect.height - buttonSize) / 2)}px`,
            width: `${buttonSize}px`,
            height: `${buttonSize}px`,
            zIndex: "999999",
            pointerEvents: "auto",
        });

        if (mount.parentElement !== document.body) {
            (document.body || document.documentElement).appendChild(mount);
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
            // Keep the rescue button visible even if Garmin blocks a style tag.
            Object.assign(btn.style, {
                position: "fixed",
                right: "16px",
                bottom: "16px",
                zIndex: "999999",
            });
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

    function isKnownLikedButton(button) {
        const aria = normalizeAria(button);
        const pressed = (button.getAttribute("aria-pressed") || "")
            .toLowerCase()
            .trim();

        return (
            pressed === "true" ||
            aria.includes("gefällt nicht") ||
            aria.includes("entfernen") ||
            aria.includes("remove") ||
            aria.includes("unlike")
        );
    }

    function findPrimaryLikeControl(card) {
        const selector = [
            'button[aria-label="Gefällt mir"]',
            'button[aria-label="Like"]',
            'button[aria-label*="Gefällt nicht"]',
            'button[aria-label*="Unlike"]',
            'button[aria-label*="Remove"]',
        ].join(",");

        return (
            Array.from(card.querySelectorAll(selector)).find(
                (button) =>
                    !isCommentLikeButton(button) &&
                    (isSafeUnlikedButton(button) ||
                        isKnownLikedButton(button))
            ) || null
        );
    }

    function collectActivityTargets() {
        const seenActivityIds = new Set();
        const currentLiveButtons = new Map();

        for (const link of document.querySelectorAll(ACTIVITY_LINK_SELECTOR)) {
            const activityId = activityIdFromLink(link);
            if (!activityId || seenActivityIds.has(activityId)) continue;

            const card = findActivityCard(link);
            if (!card) continue;

            const likeButton = findPrimaryLikeControl(card);
            if (!likeButton) continue;

            seenActivityIds.add(activityId);

            if (isSafeUnlikedButton(likeButton)) {
                if (
                    pendingActivityIds.has(activityId) ||
                    pendingActivityIds.size < MAX_ACTIVITIES
                ) {
                    pendingActivityIds.add(activityId);
                    currentLiveButtons.set(activityId, likeButton);
                }
            } else if (isKnownLikedButton(likeButton)) {
                pendingActivityIds.delete(activityId);
            }
        }

        liveLikeButtons = currentLiveButtons;
        log("Garmin activity cache updated", {
            pending: pendingActivityIds.size,
            mounted: liveLikeButtons.size,
        });
    }

    function findActivityTargets() {
        collectActivityTargets();

        return Array.from(pendingActivityIds)
            .slice(0, MAX_ACTIVITIES)
            .map((activityId) => ({
                activityId,
                likeButton: liveLikeButtons.get(activityId) || null,
            }));
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getCsrfToken() {
        return (
            document
                .querySelector('meta[name="csrf-token"]')
                ?.getAttribute("content") || ""
        ).trim();
    }

    function requestErrorLabel(error) {
        if (error && error.gcwLabel) return error.gcwLabel;
        if (error instanceof TypeError) return "Netzwerkfehler";
        return "unbekannter Fehler";
    }

    async function likeActivity(activityId) {
        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            const error = new Error("Garmin CSRF token not found");
            error.gcwLabel = "CSRF-Token fehlt";
            throw error;
        }

        const path =
            "/gc-api/conversation-service/conversation/like/ACTIVITY/" +
            encodeURIComponent(activityId);
        const url = new URL(path, window.location.origin).href;

        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    "connect-csrf-token": csrfToken,
                },
            });

            if (response.status === 409) return;

            if (response.ok) {
                let result = null;
                try {
                    result = await response.json();
                } catch (_) {
                    // A successful native Garmin like currently returns JSON.
                }

                if (result && result.conversationLikePk) return;

                const error = new Error(
                    "Garmin returned success without a conversation like"
                );
                error.gcwLabel = `HTTP ${response.status} ohne Like`;
                throw error;
            }

            if (response.status === 429 && attempt === 0) {
                const retryHeader = response.headers.get("Retry-After");
                const retryAfter = retryHeader ? Number(retryHeader) : NaN;
                await sleep(
                    Number.isFinite(retryAfter) ? retryAfter * 1000 : 750
                );
                continue;
            }

            const error = new Error(
                `Garmin like request failed (${response.status})`
            );
            error.gcwLabel = `HTTP ${response.status}`;
            throw error;
        }
    }

    function markLiked(button) {
        if (!button || !button.isConnected) return;

        const aria = normalizeAria(button);
        button.dataset.gcwKudoAllLiked = "true";
        button.classList.add("gcw-activity-liked");
        button.setAttribute("aria-pressed", "true");
        button.setAttribute(
            "aria-label",
            aria === "gefällt mir" ? "Gefällt nicht" : "Unlike"
        );

        // Garmin keeps the React-rendered outline SVG until the feed is loaded
        // again. Update its paint as well; CSS supplies a filled-heart fallback.
        for (const svgPart of button.querySelectorAll("svg, svg path")) {
            svgPart.style.color = "#007cc3";
            svgPart.style.fill = "#007cc3";
        }
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
        const baseTitle = getMessage("kudo_all", "Kudo All");

        let completed = 0;
        let failed = 0;
        const failureLabels = new Set();

        try {
            if (uiBtn) {
                uiBtn.textContent = "…";
                uiBtn.title = "Kudo All läuft…";
            }

            const targets = findActivityTargets();

            await runWithConcurrency(targets, async (target) => {
                try {
                    await likeActivity(target.activityId);
                    pendingActivityIds.delete(target.activityId);
                    liveLikeButtons.delete(target.activityId);
                    markLiked(target.likeButton);
                    completed++;
                } catch (error) {
                    failed++;
                    failureLabels.add(requestErrorLabel(error));
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
                if (failed) {
                    const details = Array.from(failureLabels).join(", ");
                    uiBtn.title = `${baseTitle} (${completed} erfolgreich, ${failed} fehlgeschlagen: ${details})`;
                } else {
                    uiBtn.title = `${baseTitle} (${completed})`;
                }
            }
        }
    }

    function ensureFloatingButton(existing) {
        if (existing && existing.isConnected) {
            if (!existing.classList.contains("gcw-floating")) {
                existing.remove();
            } else {
                return existing;
            }
        }

        const fallback = createButton(true);
        fallback.addEventListener("click", kudoAllHandler);
        (document.body || document.documentElement).appendChild(fallback);
        log("Garmin floating fallback injected");
        return fallback;
    }

    function injectButton() {
        if (!isHostGarmin()) return;
        if (!onNewsfeed()) return;

        document.documentElement.dataset.gcwKudoAll = "1";
        ensureStyles();

        const uploadBtn = findUploadImportButton();
        const existing = document.getElementById(BTN_ID);

        if (uploadBtn) {
            const mount = ensureMount(uploadBtn);
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

        ensureFloatingButton(existing);
    }

    function ensureButton() {
        try {
            injectButton();
        } catch (error) {
            console.warn("[KudoAll] Garmin button injection failed", error);

            try {
                ensureFloatingButton(document.getElementById(BTN_ID));
            } catch (fallbackError) {
                console.warn(
                    "[KudoAll] Garmin fallback injection failed",
                    fallbackError
                );
            }
        }
    }

    const scheduleEnsure = debounce(ensureButton, 200);
    let collectScheduled = false;

    function scheduleCollect() {
        if (collectScheduled) return;
        collectScheduled = true;

        const scheduleFrame =
            window.requestAnimationFrame ||
            ((callback) => window.setTimeout(callback, 16));

        scheduleFrame(() => {
            collectScheduled = false;
            if (onNewsfeed()) collectActivityTargets();
        });
    }

    function handleLocationChange() {
        if (!onNewsfeed()) {
            pendingActivityIds.clear();
            liveLikeButtons.clear();
        }

        window.setTimeout(() => {
            scheduleEnsure();
            scheduleCollect();
        }, 250);
    }

    function handleViewportChange() {
        scheduleEnsure();
        scheduleCollect();
    }

    function init() {
        scheduleEnsure();
        scheduleCollect();

        const obs = new MutationObserver(() => {
            scheduleEnsure();
            scheduleCollect();
        });
        obs.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["href", "aria-label", "aria-pressed"],
        });

        patchSpaNavigation(handleLocationChange);
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, {
            passive: true,
        });

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
