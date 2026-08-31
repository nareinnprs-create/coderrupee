<p align="center">
  <a href="https://coderrupee.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="CoderRupee logo">
    </picture>
  </a>
</p>
<p align="center">El agente de programación con IA de código abierto.</p>
<p align="center">
  <a href="https://coderrupee.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/coderrupee-ai"><img alt="npm" src="https://img.shields.io/npm/v/coderrupee-ai?style=flat-square" /></a>
  <a href="https://github.com/coderrupee/coderrupee/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/coderrupee/coderrupee/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![CoderRupee Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://coderrupee.ai)

---

### Instalación

```bash
# YOLO
curl -fsSL https://coderrupee.ai/install | bash

# Gestores de paquetes
npm i -g coderrupee-ai@latest        # o bun/pnpm/yarn
scoop install coderrupee             # Windows
choco install coderrupee             # Windows
brew install anomalyco/tap/coderrupee # macOS y Linux (recomendado, siempre al día)
brew install coderrupee              # macOS y Linux (fórmula oficial de brew, se actualiza menos)
sudo pacman -S coderrupee            # Arch Linux (Stable)
paru -S coderrupee-bin               # Arch Linux (Latest from AUR)
mise use -g coderrupee               # cualquier sistema
nix run nixpkgs#coderrupee           # o github:coderrupee/coderrupee para la rama dev más reciente
```

> [!TIP]
> Elimina versiones anteriores a 0.1.x antes de instalar.

### App de escritorio (BETA)

CoderRupee también está disponible como aplicación de escritorio. Descárgala directamente desde la [página de releases](https://github.com/coderrupee/coderrupee/releases) o desde [coderrupee.ai/download](https://coderrupee.ai/download).

| Plataforma            | Descarga                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `coderrupee-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `coderrupee-desktop-mac-x64.dmg`     |
| Windows               | `coderrupee-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, o AppImage         |

```bash
# macOS (Homebrew)
brew install --cask coderrupee-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/coderrupee-desktop
```

#### Directorio de instalación

El script de instalación respeta el siguiente orden de prioridad para la ruta de instalación:

1. `$CODERRUPEE_INSTALL_DIR` - Directorio de instalación personalizado
2. `$XDG_BIN_DIR` - Ruta compatible con la especificación XDG Base Directory
3. `$HOME/bin` - Directorio binario estándar del usuario (si existe o se puede crear)
4. `$HOME/.coderrupee/bin` - Alternativa por defecto

```bash
# Ejemplos
CODERRUPEE_INSTALL_DIR=/usr/local/bin curl -fsSL https://coderrupee.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://coderrupee.ai/install | bash
```

### Agentes

CoderRupee incluye dos agentes integrados que puedes alternar con la tecla `Tab`.

- **build** - Por defecto, agente con acceso completo para tareas de desarrollo
- **plan** - Agente de solo lectura para análisis y exploración de código
  - Deniega ediciones de archivos por defecto
  - Pide permiso antes de ejecutar comandos bash
  - Ideal para explorar codebases desconocidas o planificar cambios

Además, incluye un subagente **general** para búsquedas complejas y tareas de varios pasos.
Se usa internamente y se puede invocar con `@general` en los mensajes.

Más información sobre [agentes](https://coderrupee.ai/docs/agents).

### Documentación

Para más información sobre cómo configurar CoderRupee, [**ve a nuestra documentación**](https://coderrupee.ai/docs).

### Contribuir

Si te interesa contribuir a CoderRupee, lee nuestras [docs de contribución](./CONTRIBUTING.md) antes de enviar un pull request.

### Proyectos basados en CoderRupee

Si estás trabajando en un proyecto basado en CoderRupee y usas "coderrupee" como parte del nombre, por ejemplo, "coderrupee-dashboard" u "coderrupee-mobile", agrega una nota en tu README para aclarar que no está hecho por el equipo de CoderRupee y que no está afiliado con nosotros de ninguna manera.

---

**Únete a nuestra comunidad** [Discord](https://discord.gg/coderrupee) | [X.com](https://x.com/coderrupee)
