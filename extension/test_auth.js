const logEl = document.getElementById('log');
function log(msg) {
    console.log(msg);
    logEl.textContent += msg + '\n';
}

document.getElementById('test-btn').addEventListener('click', () => {
    log('Button clicked!');
    try {
        const GOOGLE_CLIENT_ID = '461115625041-lp7uhcsip7r1uk6bv70rtqap60nkd4mb.apps.googleusercontent.com';
        const redirectUrl = chrome.identity.getRedirectURL();
        log('Redirect URL: ' + redirectUrl);

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUrl);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', 'openid profile email');

        log('Auth URL: ' + authUrl.toString());
        log('Calling launchWebAuthFlow...');

        chrome.identity.launchWebAuthFlow(
            { url: authUrl.toString(), interactive: true },
            (responseUrl) => {
                log('Callback triggered!');
                if (chrome.runtime.lastError) {
                    log('Runtime error: ' + chrome.runtime.lastError.message);
                } else if (!responseUrl) {
                    log('No response URL and no error.');
                } else {
                    log('Response URL: ' + responseUrl);
                }
            }
        );
    } catch (e) {
        log('Exception: ' + e.message);
    }
});
