# WitchyWorlds Website

Static site for the WitchyWorlds Minecraft network. The pages live at the root:

- `index.html` – homepage with community overview and CTA links
- `rules.html` – server rules and expectations
- `servers.html` – active server listings with copy-to-clipboard IP buttons
- `register.html` – panel sign-up form that provisions a free starter server

## Assets

Place the PNG artwork for server cards under `assets/img/` with the following
filenames so the existing `<img>` tags continue to work:

- `server-atm10.png`
- `server-tts10.png`

The repository intentionally omits the image binaries. Upload your own artwork
when deploying the site. Aim for at least 960×540 resolution for crisp visuals.

## Running the site with automated server provisioning

The Pterodactyl-powered registration flow requires a small Node.js server. The
server proxies requests to the panel’s **application API** so keys stay on the
backend and never reach the browser.

1. Copy `.env.example` to `.env` and fill in your panel details:

   ```bash
   cp .env.example .env
   ```

   Required variables:

   - `PTERODACTYL_BASE_URL` – e.g. `https://panel.witchyworlds.top`
   - `PTERODACTYL_APP_KEY` – application API key (starts with `ptla_`)
   - `PTERODACTYL_ALLOCATION_ID` – allocation ID to attach to new servers
   - `PTERODACTYL_NEST_ID` / `PTERODACTYL_EGG_ID` – egg metadata used during provisioning
   - Optional overrides for resource limits (`PTERODACTYL_MEMORY_MB`, etc.)

2. Start the site with Node.js 18 or newer:

   ```bash
    node server.js
   ```

3. Visit [http://localhost:3000](http://localhost:3000) and use the **Free Server**
   navigation link to test the flow.

The server automatically fetches egg defaults (startup command, Docker image,
environment variables) and deploys a Minecraft server with the configured
limits as soon as the panel account is created.
