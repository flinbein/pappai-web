# pappai-web

The workspace panel and interactive terminal for [pappai](https://github.com/flinbein/pappai). The panel uses WebAuthn, the controller's session and JSON RPC. React Router opens a node summary at `/nodes/:id` and its method form at `/nodes/:id/methods/:name`. On a phone, the breadcrumbs switch visible columns in place, preserving the URL, form and result. Files open in the controller's file browser.

Open `/terminal` and use **+** to launch a command (default `/bin/sh -i`). Each terminal tab owns one WebSocket and PTY. Tabs show the program title and startup or exit status. Navigating between tabs and workspace panes preserves running programs and scrollback. A program that exits leaves its output available until its terminal tab is removed. Reloading the page or signing out ends its terminal connections.

## Development

Use Node.js 24 LTS or later. Run `npm ci`, then `npm run dev`. For local development, start the controller on port 3000 with `PAPPAI_ORIGIN=http://localhost:5173`, then open `http://localhost:5173`. Vite forwards the API and terminal WebSocket to the controller. Use a separate development database for passkeys registered on localhost.

The supported browsers are current desktop Chrome and Chrome for Android. Build with `npm run build` and verify the resulting release with `npm test`. TypeScript checks and Vite 8 compile both HTML entry points. The terminal uses xterm.js.

## Panel subscriptions

The signed-in panel uses one `/api/ws/web` connection for RPC and event subscriptions. Components can register a listener with the following hook:

```tsx
usePappaiEvent(
  { node: appId, events: '$.app.statusChanged' },
  event => updateStatus(event.data),
  { disabled: !appId, onSubscribed: reloadStatus },
);
```

The hook owns its subscription ID. It removes the listener on unmount and restores it on reconnect while the component is active. Changing the callback or passing an equivalent filter keeps the registration. `onSubscribed` is optional and runs after each successful registration. Use it to refresh data that may have changed while disconnected.

Registration is queued synchronously in a layout effect. A `call` from a passive effect in the same mount follows the subscription on the wire, even while the socket is opening. Disconnecting rejects interrupted calls. The panel refreshes its tree through `discover`; manual refresh also works when the USER can discover nodes but lacks permission for their events.

## Distribution

GitHub Actions builds and checks the interface on pull requests. Each push to master produces an npm archive and publishes it as `@flinbein/pappai-web`. The archive contains the compiled `dist` directory. Its assets use URLs containing the package version so old tabs can continue to use their own release.

The GitHub-hosted `publish.yml` workflow uses npm trusted publishing. Configure GitHub owner `flinbein`, repository `pappai-web`, workflow `publish.yml` and direct publishing on the npm package. The workflow run number offsets the patch version in package.json. A rerun reuses its version and compares the archive integrity when the version already exists. The first package can be created by publishing the tested workflow archive under the scope owner's npm login.

The controller ships with a pinned interface and supports installing a separate release while it is running. See [serving and updating the web interface](https://github.com/flinbein/pappai/blob/master/docs/dev/web-interface.md).
