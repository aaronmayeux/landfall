/**
 * first-run.js — the two one-time nudges (SPEC §14 Phase 5).
 *
 * 1. HOME: a first-visit hint to set a home location — the app's personal
 *    features (distance, closest approach, scope) are dead until one exists.
 *    It appears after the entry has settled, never over the opening moment,
 *    and it NEVER triggers the OS location-permission dialog itself — §8's
 *    "never prompted on first launch" rule is about that dialog, and it
 *    holds. The nudge is a signpost to the home flow, nothing more.
 *
 * 2. INSTALL: shown only after home is SET — the moment the user has
 *    invested and the app has become personally useful. Capability-based
 *    (see pwa.js): a captured Chromium prompt gets a real Install button;
 *    iOS Safari gets one line of Share-sheet directions; a browser that
 *    cannot install a PWA gets nothing at all.
 *
 * NEVER NAGS. Each nudge shows once, ever: acting on it, dismissing it, or
 * (for home) setting home through any other door all end it permanently.
 * A hurricane app that pesters is the wrong brand.
 *
 * State is two flags in guarded localStorage. This is NOT a third copy of
 * the prefs-store shape (§12's extract-on-third rule): no subscribers, no
 * validated value sets, no emit — just read-once/write-on-change flags. If
 * this file ever grows either of those, the shared-factory extraction is
 * due and settings-prefs.js's header says how.
 *
 * Imports: config/, data/home.js, and the install seam handed in by main.js.
 * Owns #nudge-host and nothing else.
 */

import { FIRST_RUN, STORAGE_KEY } from '../config/constants.js';
import { hasHome, subscribeHome } from '../data/home.js';
import { showDisclaimer } from './disclaimer.js';

/* --- persisted flags ------------------------------------------------------ */

function readFlags() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.firstRun)) || {};
  } catch {
    return {};
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(
      STORAGE_KEY.firstRun,
      JSON.stringify({ ...readFlags(), [key]: true })
    );
  } catch {
    /* Session-only memory. The nudge may reappear next visit on a device
     * that cannot persist — mildly repetitive, never wrong. */
  }
}

/* --- the chip ------------------------------------------------------------- */

function buildChip({ host, text, actionLabel, onAction, onDismiss }) {
  const chip = document.createElement('div');
  chip.className = 'nudge';
  chip.dataset.visible = 'false';

  const msg = document.createElement('span');
  msg.className = 'nudge-text';
  msg.textContent = text;
  chip.appendChild(msg);

  if (actionLabel) {
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'nudge-action';
    act.textContent = actionLabel;
    act.addEventListener('click', onAction);
    chip.appendChild(act);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nudge-dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', onDismiss);
  chip.appendChild(close);

  host.appendChild(chip);
  /* Two frames so the transition runs on entry — same trick as the drawer. */
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      chip.dataset.visible = 'true';
    })
  );
  return chip;
}

function removeChip(chip) {
  if (!chip) return;
  chip.dataset.visible = 'false';
  setTimeout(() => chip.remove(), 400);
}

/* --- wiring --------------------------------------------------------------- */

/**
 * @param {object} deps
 * @param {HTMLElement} deps.host - #nudge-host
 * @param {() => void} deps.onOpenHome - opens the home view (drawer.go)
 * @param {object} deps.install - the pwa.js seam:
 *   {isInstalled, canPromptInstall, needsManualInstall, onInstallReady, requestInstall}
 */
export function createFirstRun({ host, onOpenHome, install }) {
  const flags = readFlags();
  let homeChip = null;
  let installChip = null;
  let homeWasSet = hasHome();

  /* ---- home nudge ---- */

  function endHomeNudge(flag) {
    if (flag) writeFlag('homeNudgeDone');
    removeChip(homeChip);
    homeChip = null;
  }

  /* ---- disclaimer, ahead of everything ----
   *
   * SPEC §17 A1. It shows IMMEDIATELY — it is not delayed like the home
   * nudge, because the point of that delay is to leave the opening moment to
   * the globe (§9) and advice can wait, whereas "this is not the National
   * Hurricane Center" cannot be said after the user has already read a cone.
   *
   * The home nudge is CHAINED BEHIND IT rather than racing it. Two chips
   * stacked on arrival is noise, and it would put dismissible advice
   * alongside a notice that is deliberately not dismissible — which teaches
   * that both are the same kind of thing. `showDisclaimer` calls back
   * immediately when it has already been acknowledged, so a returning user
   * sees the unchanged 8-second home delay. */
  showDisclaimer({ host, onAcknowledged: queueHomeNudge });

  function queueHomeNudge() {
    if (flags.homeNudgeDone || hasHome()) return;
    setTimeout(() => {
      /* Re-check at fire time — home may have been set during the wait. */
      if (hasHome() || readFlags().homeNudgeDone) return;
      homeChip = buildChip({
        host,
        text: 'Set your home to see each storm’s distance and closest approach.',
        actionLabel: 'Set home',
        onAction: () => {
          endHomeNudge(true);
          onOpenHome();
        },
        onDismiss: () => endHomeNudge(true),
      });
    }, FIRST_RUN.homeNudgeDelayMs);
  }

  /* ---- install nudge ---- */

  function endInstallNudge(flag) {
    if (flag) writeFlag('installNudgeDone');
    removeChip(installChip);
    installChip = null;
  }

  function showInstallNudge() {
    if (installChip || readFlags().installNudgeDone) return;
    if (install.isInstalled()) return;

    if (install.canPromptInstall()) {
      installChip = buildChip({
        host,
        text: 'Install Landfall for full screen and quicker access.',
        actionLabel: 'Install',
        onAction: async () => {
          const accepted = await install.requestInstall();
          /* Declining the NATIVE dialog is an answer too — done either way. */
          endInstallNudge(true);
          if (accepted) writeFlag('installNudgeDone');
        },
        onDismiss: () => endInstallNudge(true),
      });
    } else if (install.needsManualInstall()) {
      installChip = buildChip({
        host,
        text: 'Add Landfall to your Home Screen: tap Share, then “Add to Home Screen”.',
        actionLabel: null,
        onDismiss: () => endInstallNudge(true),
      });
    }
    /* Neither signal: this browser cannot install a PWA. The honest UI for a
     * missing capability is nothing (pwa.js). */
  }

  function maybeQueueInstallNudge() {
    if (readFlags().installNudgeDone || install.isInstalled()) return;
    setTimeout(showInstallNudge, FIRST_RUN.installNudgeDelayMs);
  }

  /* Home flipping unset -> set is the trigger moment. Fire-on-subscribe gives
   * us the boot state first, so the transition test below is real. */
  subscribeHome((home) => {
    const nowSet = !!home;
    if (nowSet && homeChip) endHomeNudge(true); // set through any other door
    if (nowSet && !homeWasSet) maybeQueueInstallNudge();
    homeWasSet = nowSet;
  });

  /* Returning visitor: home already set (maybe weeks ago, maybe on this boot
   * before we subscribed), still browser-bound. One hint, then never again. */
  if (homeWasSet && !flags.installNudgeDone && !install.isInstalled()) {
    setTimeout(showInstallNudge, FIRST_RUN.homeNudgeDelayMs);
  }

  /* Chromium's install event can arrive AFTER a nudge moment passed with only
   * the iOS/no-capability answer available. If a chip is not up and the
   * moment already came (home is set), upgrade to the real button. */
  install.onInstallReady(() => {
    if (homeWasSet && !installChip && !readFlags().installNudgeDone) {
      maybeQueueInstallNudge();
    }
  });
}
