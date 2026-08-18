/* ============================================================
   Ainex — auth
   Shows the login screen or the app depending on session state,
   handles the Google sign-in button, and exposes the current user
   to script.js via the 'ainex:signed-in' / 'ainex:signed-out' events.
   ============================================================ */

(function () {
  'use strict';

  const authScreen = document.getElementById('authScreen');
  const authLoading = document.getElementById('authLoading');
  const appEl = document.querySelector('.app');
  const googleBtn = document.getElementById('googleSignInBtn');
  const authError = document.getElementById('authError');
  const logoutBtn = document.getElementById('logoutBtn');

  function showAuthScreen() {
    authLoading.style.display = 'none';
    authScreen.style.display = 'flex';
    appEl.style.display = 'none';
    // Exposed so script.js can check this synchronously even if it loads
    // after this already ran (see the race-condition note below).
    window.__ainexAuthUser = null;
  }

  function showApp(user) {
    authLoading.style.display = 'none';
    authScreen.style.display = 'none';
    appEl.style.display = 'flex';
    window.__ainexAuthUser = user;
    document.dispatchEvent(new CustomEvent('ainex:signed-in', { detail: { user } }));
  }

  googleBtn.addEventListener('click', async () => {
    authError.textContent = '';
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      authError.textContent = error.message;
    }
    // On success, the browser redirects to Google and back — no further
    // action needed here; onAuthStateChange below picks up the session.
  });

  logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) {
      showApp(session.user);
    } else {
      showAuthScreen();
      document.dispatchEvent(new CustomEvent('ainex:signed-out'));
    }
  });

  // Initial check on page load (onAuthStateChange also fires once on
  // load, but this avoids a flash of the wrong screen while it resolves).
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session && data.session.user) {
      showApp(data.session.user);
    } else {
      showAuthScreen();
    }
  });
})();