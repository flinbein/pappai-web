# pappai-web

The workspace panel and interactive terminal for [pappai](https://github.com/flinbein/pappai). Select a node to see its ID and documentation at `/nodes/:id`. Each entry shows its feature type and description. Use the arrow to expand its children, or select its name to open the manual at `/nodes/:id/methods/:name`. Method pages include a call form and CLI pages include a terminal. On a phone, breadcrumbs switch columns in place and preserve the current form while you navigate between panes. Reload or use Back to return to the pane selected for that history entry. Opening a method URL in a new tab opens its form. Files open in the controller's file browser.

The second column also offers controls for the system interfaces advertised by this node. For example, a supported `$.lifecycle` version supplies Start and Stop, and `$.children` supplies creation forms. The controller checks each call against the current permissions. A service with an unfamiliar version can still be explored through its documentation and generic method forms.

Open `/terminal` and use **+** to launch a command (default `/bin/sh -i`). Enter the command and its arguments on one line, or choose **Edit as rows** to enter each word separately. Single and double quotes group words, backslash escapes characters, and empty quoted words represent empty arguments. **Environment** accepts a name and value per row. Each terminal tab owns one WebSocket and PTY. Tabs show the program title. Hover over the status icon for the launch state or exit code. A startup error appears in the tab in place of the terminal. Navigating between tabs and workspace panes preserves running programs and scrollback. A program that exits leaves its output available until its terminal tab is removed. Browser windows in the same login session share one panel connection and a terminal catalog through a SharedWorker. Other windows display a scaled, diagonally shaded preview. Selecting a terminal by tab, horizontal scroll or two-finger swipe takes control of that terminal. Returning to a window takes control of its displayed terminal after a short pause. Clicking another tab or **+** as you return leaves the previous terminal with its current owner. If the diagonally shaded preview is still visible, the first key or click activates it and is consumed. The next input reaches the program. Closing one window keeps terminals running in the others. Signing out ends the shared sessions.

Choose a terminal theme when launching a tab or change it live with the palette button. Swipe between tabs and the launch form with two fingers. Use Ctrl+Shift+C to copy a selection or open a selectable scrollback snapshot. The package includes 12 local palettes and their [source notices](public/terminal-theme-notices.txt).

For a new TEAM, **Node permissions** previews the default rules for managing descendants and creating immediate children. Leave **Team folder** empty to use the controller's default. Enter a folder to include a file write rule, or choose **Custom rules** to edit the JSON. An explicit `[]` gives the TEAM an empty rule list. **No restrictions** sets local rules to `null` and is also available under **Edit permissions** for an existing node. Review the JSON and submit the form to apply it. An APP needs an unrestricted permission path to the workspace to act as an administrator.

## CLI methods

Select an advertised CLI in **Documentation**, or use a PROFILE shortcut in **Actions**. Open **+** to read the CLI documentation and input schema in the launch form. Selecting a running terminal gives its output the full pane. The launch form shows the target node and method. Enter arguments, set environment variables and choose a theme. The browser checks the method’s JSON Schema and marks invalid fields before opening a terminal. A method that accepts no arguments or environment needs only a theme and **Run**.

The method page shows its own sessions and a **+** tab for another launch. Reloading either the method page or the global terminal page restores its selected tab and opens its group. If the tab has been removed or its shared session has ended, the page opens **+**. The global **Terminal** tool groups these sessions by node and method alongside ordinary shell tabs. Open a group to switch between its sessions. The star is green while a session is running, yellow while starting, red after a failure, and gray when all sessions closed successfully or disconnected. The group label shows the method followed by the node name. Its color follows the open group's tabs. Select the label to collapse the group. Collapsing the selected terminal’s group selects **+**. Swiping skips collapsed groups. Groups slide open and closed. Closing a tab slides the remaining tabs into place. Both transitions respect the system’s reduced motion setting. The global **+** always opens a shell launch form. Closing a starting or running terminal, or a group containing one, asks for confirmation.

## Runner installation

Select **Manage runners** on the workspace node to open `/nodes/~/runners`. The separate **Documentation** entry for `$.runners.add` opens its JSON call form. Choose an npm package specification or a Git repository with an optional ref. The installation name is editable. For an existing executable, choose **Custom path** and enter its absolute entrypoint under `/run/pappai/private/runners/<name>/`. The directory supplies the name.

The embedded terminal streams preparation output. You can navigate within the workspace and reopen **Manage runners** to see progress. A successful preparation registers the reported entrypoint. If registration fails, **Retry registration** reuses that entrypoint. Reloading the browser or signing out closes the terminal.

To update, select an existing installation in the same form. Its saved package or repository appears when available. **Update runner** prepares the release and restarts the runner using its new entrypoint. **Roll back** restarts it with the previous entrypoint when one is available. After registration or restart, the panel refreshes workspace help. For a runner that advertises `getVersion`, **Check CLI status** opens that method’s call form.

## Development

Use Node.js 24 LTS or later. Run `npm ci`, then `npm run dev`. For local development, start the controller on port 3000 with `PAPPAI_ORIGIN=http://localhost:5173`, then open `http://localhost:5173`. Vite forwards the API and terminal WebSocket to the controller. Use a separate development database for passkeys registered on localhost.

The supported browsers are current desktop Chrome and Chrome for Android. Build with `npm run build` and verify the resulting release with `npm test`. TypeScript checks and Vite 8 compile both HTML entry points. The terminal uses xterm.js.

## Panel subscriptions

The signed-in panel uses one `/api/ws/web` connection for RPC and event subscriptions. Components can register a listener with the following hook:

```tsx
usePappaiEvent(
  { node: appId, events: '$.lifecycle.statusChanged' },
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
