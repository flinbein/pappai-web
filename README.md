# pappai-web

The workspace panel and interactive terminal for [pappai](https://github.com/flinbein/pappai). The panel uses WebAuthn, the controller's session and JSON RPC. React Router opens a node summary at `/nodes/:id` and its method form at `/nodes/:id/methods/:name`. On a phone, the breadcrumbs switch visible columns in place, preserving the URL, form and result. Files open in the controller's file browser.

Open `/terminal` and use **+** to launch a command (default `/bin/sh -i`). Enter the command and its arguments on one line, or choose **Edit as rows** to enter each word separately. Single and double quotes group words, backslash escapes characters, and empty quoted words represent empty arguments. **Environment** accepts a name and value per row. Each terminal tab owns one WebSocket and PTY. Tabs show the program title. Hover over the status icon for the launch state or exit code. A startup error appears in the tab in place of the terminal. Navigating between tabs and workspace panes preserves running programs and scrollback. A program that exits leaves its output available until its terminal tab is removed. Browser windows in the same login session share one panel connection and a terminal catalog through a SharedWorker. Other windows display a scaled, diagonally shaded preview. Selecting a terminal or returning to its browser window automatically takes control. If the diagonally shaded preview is still visible, the first key or click activates it and is consumed. The next input reaches the program. Closing one window keeps terminals running in the others. Signing out ends the shared sessions.

Choose a terminal theme when launching a tab or change it live with the palette button. Swipe between tabs and the launch form with two fingers. Use Ctrl+Shift+C to copy a selection or open a selectable scrollback snapshot. The package includes 12 local palettes and their [source notices](public/terminal-theme-notices.txt).

## CLI methods

Open a PROFILE and select an advertised CLI method in **Actions**. The launch form shows the target node and method. Enter arguments, set environment variables and choose a theme. The browser checks the method’s JSON Schema and marks invalid fields before opening a terminal. A method that accepts no arguments or environment needs only a theme and **Run**.

The method page shows its own sessions and a **+** tab for another launch. The global **Terminal** tool groups these sessions by node and method alongside ordinary shell tabs. Open a group to switch between its sessions. The star is green while a session is running, yellow while starting, red after a failure, and gray when all sessions closed successfully or disconnected. The group label shows the method followed by the node name. Its color follows the open group's tabs. Select the label to collapse the group. Collapsing the selected terminal’s group selects **+**. Swiping skips collapsed groups. Groups slide open and closed. Closing a tab slides the remaining tabs into place. Both transitions respect the system’s reduced motion setting. The global **+** always opens a shell launch form. Closing a starting or running terminal, or a group containing one, asks for confirmation.

## Runner installation

Select the workspace node, expand **System methods**, and open `$.runners.add`. Choose an npm package specification or a Git repository with an optional ref. The installation name is editable. For an existing executable, choose **Custom path** and enter its absolute entrypoint under `/run/pappai/private/runners/<name>/`. The directory supplies the name.

The embedded terminal streams preparation output. You can navigate within the workspace and reopen the method to see progress. A successful preparation registers the reported entrypoint. If registration fails, **Retry registration** reuses that entrypoint. Reloading the browser or signing out closes the terminal.

To update, select an existing installation in the same form. Its saved package or repository appears when available. **Update runner** prepares the release and restarts the runner using its new entrypoint. **Roll back** restarts it with the previous entrypoint when one is available. After registration or restart, the panel refreshes workspace help. For a runner that advertises `getVersion`, **Check CLI status** opens that method’s call form.

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
