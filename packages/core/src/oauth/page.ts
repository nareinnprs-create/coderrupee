// Branded HTML pages for local OAuth callback servers.
//
// These are served by the loopback HTTP servers that finish an OAuth exchange
// (MCP, Codex/ChatGPT, xAI, Snowflake, DigitalOcean, ...). The functions return
// a fully self-contained HTML string with no external assets, so they work
// offline and drop into any transport (`res.end(...)`, Effect `response.end`,
// etc.).
//
// The visual language mirrors the CoderRupee app: the design tokens are a curated
// subset of the OC-2 semantic tokens in `packages/ui/src/styles/theme.css`, and
// the wordmark is the same geometry as `packages/ui/src/components/logo.tsx`.
// Keep this file in sync with those sources when the brand changes.

export interface CallbackPageOptions {
  /** Friendly integration name shown as a subtitle, e.g. "xAI", "Snowflake", "MCP". */
  provider?: string
  /** Attempt to close the window shortly after success. Defaults to true. */
  autoClose?: boolean
}

export function success(options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization successful",
    body: renderCard({
      status: "success",
      headline: "Authorization successful",
      message: provider ? `CoderRupee is now connected to ${escapeHtml(provider)}.` : "CoderRupee is now authorized.",
      footnote: "You can close this window.",
    }),
    script: options?.autoClose === false ? undefined : AUTO_CLOSE_SCRIPT,
  })
}

export function error(detail: string, options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization failed",
    body: renderCard({
      status: "error",
      headline: "Authorization failed",
      message: provider
        ? `CoderRupee couldn't finish connecting to ${escapeHtml(provider)}.`
        : "CoderRupee couldn't complete authorization.",
      detail,
      footnote: "Close this window and try again from CoderRupee.",
    }),
  })
}

export interface BootstrapOptions {
  /** Same-origin path the in-browser script POSTs the parsed callback to. */
  tokenPath: string
  provider?: string
}

// For flows where the credential arrives in the URL fragment (implicit grant),
// the browser must relay it back to the loopback server. This renders a pending
// page whose script reads the fragment, POSTs it to `tokenPath`, then resolves
// to the success or error state in place.
export function bootstrap(options: BootstrapOptions) {
  return renderDocument({
    title: "Finishing sign-in",
    body: renderCard({
      status: "pending",
      headline: "Finishing sign-in",
      message: options.provider
        ? `Completing your ${escapeHtml(options.provider)} authorization.`
        : "Completing authorization.",
      footnote: "You can close this window once sign-in finishes.",
    }),
    script: bootstrapScript(options),
  })
}

export * as OauthCallbackPage from "./page"

type Status = "pending" | "success" | "error"

function renderCard(input: { status: Status; headline: string; message: string; detail?: string; footnote: string }) {
  const detail = input.detail?.trim()
  return `<main class="card" id="oc-card" data-status="${input.status}" role="status" aria-live="polite">
      <div class="brand">${WORDMARK}</div>
      <div class="status" aria-hidden="true">
        <span class="icon icon-pending">${ICON_SPINNER}</span>
        <span class="icon icon-success">${ICON_CHECK}</span>
        <span class="icon icon-error">${ICON_CROSS}</span>
      </div>
      <h1 class="headline" id="oc-headline">${escapeHtml(input.headline)}</h1>
      <p class="message" id="oc-message">${input.message}</p>
      <pre class="detail" id="oc-detail"${detail ? "" : " hidden"}>${detail ? escapeHtml(detail) : ""}</pre>
      <p class="footnote" id="oc-footnote">${escapeHtml(input.footnote)}</p>
    </main>`
}

function renderDocument(input: { title: string; body: string; script?: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(input.title)} · CoderRupee</title>
    <style>${STYLES}</style>
  </head>
  <body>
    ${input.body}${input.script ? `\n    <script>${input.script}</script>` : ""}
  </body>
</html>`
}

const AUTO_CLOSE_SCRIPT = `setTimeout(function(){try{window.close()}catch(e){}},2500)`

function bootstrapScript(options: BootstrapOptions) {
  return `var PROVIDER=${scriptString(options.provider ?? "")};
var TOKEN_URL=new URL(${scriptString(options.tokenPath)},window.location.origin).href;
(function(){
  var card=document.getElementById("oc-card"),headline=document.getElementById("oc-headline"),message=document.getElementById("oc-message"),detail=document.getElementById("oc-detail"),footnote=document.getElementById("oc-footnote");
  function fail(text){card.dataset.status="error";headline.textContent="Authorization failed";message.textContent=PROVIDER?("CoderRupee couldn't finish connecting to "+PROVIDER+"."):"CoderRupee couldn't complete authorization.";if(text){detail.textContent=text;detail.hidden=false}footnote.textContent="Close this window and try again from CoderRupee."}
  function ok(){card.dataset.status="success";headline.textContent="Authorization successful";message.textContent=PROVIDER?("CoderRupee is now connected to "+PROVIDER+"."):"CoderRupee is now authorized.";detail.hidden=true;footnote.textContent="You can close this window.";setTimeout(function(){try{window.close()}catch(e){}},2500)}
  try{
    var hash=new URLSearchParams((window.location.hash||"").slice(1));
    var search=new URLSearchParams(window.location.search||"");
    var err=hash.get("error")||search.get("error");
    var errDescription=hash.get("error_description")||search.get("error_description");
    var body=err?{error:err,error_description:errDescription||""}:{access_token:hash.get("access_token")||"",expires_in:hash.get("expires_in")||"0",state:hash.get("state")||""};
    fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(res){
      if(!res.ok)return res.text().catch(function(){return""}).then(function(t){throw new Error(t||("callback failed ("+res.status+")"))});
      if(err){fail(errDescription||err);return}
      ok();
    }).catch(function(e){fail(String(e&&e.message?e.message:e))});
  }catch(e){fail(String(e&&e.message?e.message:e))}
})()`
}

function scriptString(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// Curated subset of OC-2 tokens (packages/ui/src/styles/theme.css). Default is
// light; dark applies via prefers-color-scheme. The [data-theme] selectors let a
// host force a scheme without changing the default.
const LIGHT_VARS = `
    --oc-bg: #f8f8f8;
    --oc-card: #fcfcfc;
    --oc-text-strong: #171717;
    --oc-text-base: #6f6f6f;
    --oc-text-weak: #8f8f8f;
    --oc-border-weak: #e5e5e5;
    --oc-icon-strong: #171717;
    --oc-icon-base: #8f8f8f;
    --oc-icon-weak: #dbdbdb;
    --oc-success: #2dba26;
    --oc-error: #ed4831;
    --oc-detail-bg: #fff8f6;
    --oc-detail-border: #fdc3b7;
    --oc-shadow: 0 16px 48px -6px rgba(0,0,0,.10), 0 6px 12px -2px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.06);`

const DARK_VARS = `
    --oc-bg: #101010;
    --oc-card: #161616;
    --oc-text-strong: rgba(255,255,255,.936);
    --oc-text-base: rgba(255,255,255,.618);
    --oc-text-weak: rgba(255,255,255,.422);
    --oc-border-weak: #282828;
    --oc-icon-strong: #ededed;
    --oc-icon-base: #7e7e7e;
    --oc-icon-weak: #343434;
    --oc-success: #12c905;
    --oc-error: #fc533a;
    --oc-detail-bg: #28110c;
    --oc-detail-border: #6a1206;
    --oc-shadow: 0 16px 48px -6px rgba(0,0,0,.55), 0 6px 12px -2px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.4);`

const STYLES = `
  :root { color-scheme: light dark;${LIGHT_VARS}
    --oc-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --oc-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK_VARS} } }
  :root[data-theme="dark"] {${DARK_VARS} }
  :root[data-theme="light"] {${LIGHT_VARS} }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .brand .wordmark { filter: invert(1); } }
  :root[data-theme="dark"] .brand .wordmark { filter: invert(1); }
  :root[data-theme="light"] .brand .wordmark { filter: none; }

  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--oc-bg);
    color: var(--oc-text-base);
    font-family: var(--oc-font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .card {
    width: min(100%, 28rem);
    padding: 2.25rem 2rem 1.75rem;
    background: var(--oc-card);
    border: 1px solid var(--oc-border-weak);
    border-radius: 14px;
    box-shadow: var(--oc-shadow);
    text-align: center;
  }
  .brand { display: flex; justify-content: center; margin-bottom: 1.75rem; }
  .brand svg, .brand img { height: 19px; width: auto; }
  .status { display: flex; justify-content: center; margin-bottom: 1.125rem; }
  .icon { display: none; line-height: 0; }
  .icon svg { display: block; }
  .card[data-status="pending"] .icon-pending,
  .card[data-status="success"] .icon-success,
  .card[data-status="error"] .icon-error { display: block; }
  .icon-success { color: var(--oc-success); }
  .icon-error { color: var(--oc-error); }
  .icon-pending { color: var(--oc-text-weak); }
  .headline { margin: 0; font-size: 1.1875rem; font-weight: 500; line-height: 1.3; letter-spacing: -0.012em; color: var(--oc-text-strong); }
  .message { margin: 0.5rem 0 0; font-size: 0.9375rem; color: var(--oc-text-base); }
  .detail {
    margin: 1.25rem 0 0;
    padding: 0.75rem 0.875rem;
    text-align: left;
    font-family: var(--oc-font-mono);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--oc-text-strong);
    background: var(--oc-detail-bg);
    border: 1px solid var(--oc-detail-border);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 9.5rem;
    overflow: auto;
  }
  .detail[hidden] { display: none; }
  .footnote { margin: 1.5rem 0 0; font-size: 0.8125rem; color: var(--oc-text-weak); }
  .spinner { animation: oc-spin 0.8s linear infinite; transform-origin: center; }
  @keyframes oc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
`

// CoderRupee wordmark — embedded raster lockup (cropped + downscaled from
// packages/app/public/assets/CODER_RUPEE_wordmark_watermark.svg).
const WORDMARK_B64 = [
    "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"
  ].join("")

const WORDMARK = `<img class="wordmark" src="data:image/png;base64,${WORDMARK_B64}" width="360" height="38" alt="CoderRupee" />`

const ICON_CHECK = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.4 2.4 4.6-5.4" /></svg>`

const ICON_CROSS = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>`

const ICON_SPINNER = `<svg class="spinner" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.2" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>`
