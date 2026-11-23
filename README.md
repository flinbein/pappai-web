# pappai-web

The workspace panel and interactive terminal for [pappai](https://github.com/flinbein/pappai). Both pages run on the controller origin. The panel uses WebAuthn, the controller's session and JSON RPC. Each terminal tab owns a separate WebSocket and PTY.

## Development

Use Node.js 24 LTS or later. Run `npm ci`, then `npm run dev`. For local development, start the controller on port 3000 with `PAPPAI_ORIGIN=http://localhost:5173`, then open `http://localhost:5173`. Vite forwards the API and terminal WebSocket to the controller. Use a separate development database for passkeys registered on localhost.

The supported browsers are current desktop Chrome and Chrome for Android. Build with `npm run build` and verify the resulting release with `npm test`. TypeScript checks and Vite 8 compile both HTML entry points. The terminal uses xterm.js.

## Distribution

GitHub Actions builds and checks the interface on pull requests. Each push to master produces an npm archive and publishes it as `@flinbein/pappai-web`. The archive contains the compiled `dist` directory. Its assets use URLs containing the package version so old tabs can continue to use their own release.

The GitHub-hosted `publish.yml` workflow uses npm trusted publishing. Configure GitHub owner `flinbein`, repository `pappai-web`, workflow `publish.yml` and direct publishing on the npm package. The workflow run number offsets the patch version in package.json. A rerun reuses its version and compares the archive integrity when the version already exists. The first package can be created by publishing the tested workflow archive under the scope owner's npm login.

The controller ships with a pinned interface and supports installing a separate release while it is running. See [serving and updating the web interface](https://github.com/flinbein/pappai/blob/master/docs/dev/web-interface.md).
