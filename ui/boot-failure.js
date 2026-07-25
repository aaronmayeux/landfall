/**
 * boot-failure.js — the app explaining itself when it cannot start. SPEC §5.
 *
 * ==> WHY THIS EXISTS <==
 * `boot()` was called bare. Anything that threw during startup — a missing
 * library, a WebGL context the browser would not grant — left a BLACK SCREEN
 * and a console message no ordinary person will ever see. Landfall enforces
 * "never ship silence on failure" for every feed, every layer and every async
 * surface in the app, and did not apply it to ITSELF.
 *
 * That is the worst place to have the gap. A dead feed still leaves an app
 * that can explain the dead feed. A dead boot leaves nothing, and a stranger
 * who followed a shared link during a storm sees an app that is simply
 * broken, with no way to tell whether it is them, their browser, or the site.
 *
 * ==> IT NAMES A CAUSE ONLY WHEN IT KNOWS ONE <==
 * WebGL is detectable and is by far the likeliest cause on a phone, so it
 * gets its own specific message and its own specific remedy. Everything else
 * gets an honest generic one. **It never guesses** — a wrong diagnosis sends
 * someone to change a setting that was not the problem, which is worse than
 * "something went wrong" because it costs them time and trust.
 *
 * ==> NO TOKENS IMPORT, DELIBERATELY <==
 * This runs when the app has failed, so it must not depend on anything that
 * could be part of the failure — not tokens.js, not the CSS custom properties
 * main.js writes at boot (applyTokens may be the thing that never ran). The
 * few literal colours below are the ONE sanctioned exception to §9's
 * zero-hardcoded-hex rule, and they exist so this panel renders even if every
 * other system is down. They deliberately match the ocean/text tokens by eye.
 *
 * Imports: nothing at all. Called only from main.js's boot catch.
 */

/**
 * Can this browser actually give us WebGL?
 *
 * Both engines need it: MapLibre GL renders the map on WebGL and Three.js
 * draws the clear globe. Without a context neither can start, and the failure
 * surfaces as an opaque throw from inside a library.
 *
 * Wrapped completely — on some browsers `getContext` itself throws rather
 * than returning null, and a capability probe that can crash is not a probe.
 *
 * @returns {boolean} true if a context was granted.
 */
export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * Replace the screen with a readable explanation.
 *
 * @param {Error|unknown} error  What was thrown. Used only to decide the
 *        generic detail line; never rendered raw (§5 — no exception text in
 *        front of a user).
 */
export function showBootFailure(error) {
  try {
    /* Ask the specific question first. If WebGL is missing, that IS the
     * answer, whatever the thrown error happened to say. */
    const webglMissing = !hasWebGL();

    const host = document.createElement('div');
    host.setAttribute('role', 'alert');
    host.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'gap:16px', 'padding:24px',
      /* Safe-area insets by hand: this cannot rely on the app's CSS having
       * loaded, and on a phone the text must clear the notch. */
      'padding-top:calc(24px + env(safe-area-inset-top))',
      'padding-bottom:calc(24px + env(safe-area-inset-bottom))',
      'background:#070D18', 'color:#E8F1F8',
      'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'text-align:center',
    ].join(';');

    const title = document.createElement('h1');
    title.style.cssText = 'margin:0;font-size:1.25rem;font-weight:600';
    title.textContent = webglMissing
      ? 'Landfall needs 3D graphics'
      : 'Landfall could not start';

    const body = document.createElement('p');
    body.style.cssText = 'margin:0;max-width:34em;color:#9DB3C7';
    body.textContent = webglMissing
      ? 'This app draws a 3D globe, which needs a graphics feature called ' +
        'WebGL. Your browser is not providing it. This is usually a browser ' +
        'privacy or hardware-acceleration setting rather than a problem with ' +
        'your device.'
      : 'Something went wrong while starting up. This is a problem on our ' +
        'end, not yours.';

    /* THE REMEDY IS ONLY SHOWN FOR THE CAUSE WE ACTUALLY IDENTIFIED.
     * Brave is named because its fingerprinting protection blocks WebGL by
     * default on some builds and it is the single most common cause of this
     * exact screen — but the wording covers any browser, because naming only
     * Brave would read as "works fine everywhere else" to someone on
     * something else entirely. */
    const help = document.createElement('p');
    help.style.cssText = 'margin:0;max-width:34em;color:#647C93;font-size:0.9rem';
    help.textContent = webglMissing
      ? 'Try turning off fingerprint or shield protection for this site — in ' +
        'Brave, tap the shield icon in the address bar and set Shields to ' +
        'down for landfall.getgravitate.app. On other browsers, check that ' +
        'hardware acceleration is switched on.'
      : 'Reloading may fix it. If it keeps happening, the site itself is ' +
        'likely broken and reloading will not help.';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    /* 44px minimum target and a real focus ring, because §10 applies to the
     * failure screen exactly as much as to the app. */
    retry.style.cssText = [
      'min-height:44px', 'min-width:140px', 'padding:0 20px',
      'border-radius:22px', 'cursor:pointer',
      'border:1px solid rgba(120,190,225,0.16)',
      'background:rgba(16,30,48,0.86)', 'color:#E8F1F8',
      'font:inherit', 'font-size:0.95rem',
    ].join(';');
    retry.addEventListener('click', () => window.location.reload());

    host.append(title, body, help, retry);
    document.body.appendChild(host);

    /* Keep the real error in the console for whoever can read one. It is not
     * shown above — §5 says errors reach people in human language — but
     * throwing it away would make a genuine bug undebuggable. */
    console.error('[landfall] boot failed:', error);
  } catch {
    /* If even this fails, do the one thing that cannot: plain text. An
     * unstyled sentence beats a black screen. */
    try {
      document.body.textContent =
        'Landfall could not start. Please reload the page.';
    } catch {
      /* Nothing left to try. */
    }
  }
}
